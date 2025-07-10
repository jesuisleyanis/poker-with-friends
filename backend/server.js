const WebSocket = require('ws');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// --- Gestion des tables et joueurs ---
const TABLE = {
  players: [], // { ws, pseudo, hand, stack, bet, folded }
  deck: [],
  community: [],
  started: false,
  pot: 0,
  dealerIndex: 0,
  currentPlayer: 0,
  phase: 'waiting', // waiting, preflop, flop, turn, river, showdown
  lastRaise: 0,
  minRaise: 20,
  smallBlind: 10,
  bigBlind: 20,
};

const INITIAL_STACK = 1000;

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('Nouveau joueur connecté');

  ws.on('close', () => {
    TABLE.players = TABLE.players.filter(p => p.ws !== ws);
    broadcastTableState();
    console.log('Joueur déconnecté');
  });

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Format JSON invalide' }));
      return;
    }
    if (data.type === 'join') {
      if (TABLE.players.find(p => p.pseudo === data.pseudo)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Pseudo déjà pris' }));
        return;
      }
      TABLE.players.push({ ws, pseudo: data.pseudo, hand: [], stack: INITIAL_STACK, bet: 0, folded: false });
      broadcastTableState();
    }
    if (data.type === 'start') {
      if (!TABLE.started && TABLE.players.length >= 2) {
        startGame();
      }
    }
    if (data.type === 'action') {
      handleAction(ws, data.action, data.amount);
    }
  });
});

function startGame() {
  TABLE.started = true;
  TABLE.deck = shuffle(createDeck());
  TABLE.community = [];
  TABLE.pot = 0;
  TABLE.phase = 'preflop';
  TABLE.dealerIndex = Math.floor(Math.random() * TABLE.players.length);
  TABLE.currentPlayer = (TABLE.dealerIndex + 1 + 1) % TABLE.players.length; // Après big blind
  TABLE.lastRaise = TABLE.bigBlind;
  // Reset joueurs
  for (let i = 0; i < TABLE.players.length; i++) {
    const player = TABLE.players[i];
    player.hand = [TABLE.deck.pop(), TABLE.deck.pop()];
    player.bet = 0;
    player.folded = false;
  }
  // Blinds
  const sbIndex = (TABLE.dealerIndex + 1) % TABLE.players.length;
  const bbIndex = (TABLE.dealerIndex + 2) % TABLE.players.length;
  TABLE.players[sbIndex].stack -= TABLE.smallBlind;
  TABLE.players[sbIndex].bet = TABLE.smallBlind;
  TABLE.players[bbIndex].stack -= TABLE.bigBlind;
  TABLE.players[bbIndex].bet = TABLE.bigBlind;
  TABLE.pot = TABLE.smallBlind + TABLE.bigBlind;
  broadcastTableState();
  notifyCurrentPlayer();
}

function handleAction(ws, action, amount) {
  const idx = TABLE.players.findIndex(p => p.ws === ws);
  if (idx !== TABLE.currentPlayer) return; // Pas à toi de jouer
  const player = TABLE.players[idx];
  if (player.folded) return;
  switch (action) {
    case 'fold':
      player.folded = true;
      player.bet = 0;
      break;
    case 'call': {
      const maxBet = Math.max(...TABLE.players.map(p => p.bet));
      const toCall = maxBet - player.bet;
      if (player.stack >= toCall) {
        player.stack -= toCall;
        player.bet += toCall;
        TABLE.pot += toCall;
      }
      break;
    }
    case 'check': {
      const maxBet = Math.max(...TABLE.players.map(p => p.bet));
      if (player.bet !== maxBet) return; // Impossible de check si on n'a pas misé autant
      break;
    }
    case 'raise': {
      const maxBet = Math.max(...TABLE.players.map(p => p.bet));
      const toCall = maxBet - player.bet;
      if (amount < TABLE.minRaise) return;
      if (player.stack >= toCall + amount) {
        player.stack -= (toCall + amount);
        player.bet += (toCall + amount);
        TABLE.pot += (toCall + amount);
        TABLE.lastRaise = amount;
      }
      break;
    }
    default:
      return;
  }
  nextPlayer();
}

function nextPlayer() {
  // Trouver le prochain joueur actif
  let next = TABLE.currentPlayer;
  let found = false;
  for (let i = 1; i <= TABLE.players.length; i++) {
    const idx = (TABLE.currentPlayer + i) % TABLE.players.length;
    if (!TABLE.players[idx].folded && TABLE.players[idx].stack > 0) {
      next = idx;
      found = true;
      break;
    }
  }
  TABLE.currentPlayer = next;
  // Vérifier si le tour est fini
  if (isBettingRoundOver()) {
    advancePhase();
  } else {
    broadcastTableState();
    notifyCurrentPlayer();
  }
}

function isBettingRoundOver() {
  const active = TABLE.players.filter(p => !p.folded && p.stack > 0);
  if (active.length <= 1) return true; // Plus qu'un joueur
  const maxBet = Math.max(...TABLE.players.map(p => p.bet));
  return active.every(p => p.bet === maxBet);
}

function getHandRank(cards) {
  // cards: tableau de 7 cartes {suit, rank}
  // Retourne un objet {rank: int, name: string, values: array} pour comparer les mains
  // 9: Quinte flush royale, 8: Quinte flush, 7: Carré, 6: Full, 5: Couleur, 4: Suite, 3: Brelan, 2: Double paire, 1: Paire, 0: Carte haute
  // Pour la simplicité, on code une version efficace mais pas ultra-optimisée
  const RANK_ORDER = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
  const byRank = {};
  const bySuit = {};
  for (const c of cards) {
    byRank[c.rank] = (byRank[c.rank]||[]).concat([c]);
    bySuit[c.suit] = (bySuit[c.suit]||[]).concat([c]);
  }
  const ranks = Object.keys(byRank).sort((a,b)=>RANK_ORDER[b]-RANK_ORDER[a]);
  // Flush ?
  let flushSuit = null;
  for (const suit in bySuit) if (bySuit[suit].length >= 5) flushSuit = suit;
  // Suite ?
  function getStraight(vals) {
    let arr = vals.map(r=>RANK_ORDER[r]).sort((a,b)=>b-a);
    if (arr[0] === 14) arr.push(1); // As bas
    for (let i=0; i<=arr.length-5; i++) {
      let ok = true;
      for (let j=1; j<5; j++) if (arr[i+j] !== arr[i]-j) ok = false;
      if (ok) return arr[i];
    }
    return null;
  }
  // Quinte flush ?
  if (flushSuit) {
    const flushRanks = bySuit[flushSuit].map(c=>c.rank);
    const straightHigh = getStraight(flushRanks);
    if (straightHigh) {
      if (straightHigh === 14) return {rank:9, name:'Quinte flush royale', values:[14]};
      return {rank:8, name:'Quinte flush', values:[straightHigh]};
    }
  }
  // Carré ?
  for (const r of ranks) if (byRank[r].length === 4)
    return {rank:7, name:'Carré', values:[RANK_ORDER[r], ...kickers(r,1)]};
  // Full ?
  let trips = null, pair = null;
  for (const r of ranks) if (byRank[r].length === 3 && !trips) trips = r;
  for (const r of ranks) if (byRank[r].length >= 2 && r !== trips && !pair) pair = r;
  if (trips && pair) return {rank:6, name:'Full', values:[RANK_ORDER[trips], RANK_ORDER[pair]]};
  // Couleur ?
  if (flushSuit) {
    const vals = bySuit[flushSuit].map(c=>RANK_ORDER[c.rank]).sort((a,b)=>b-a).slice(0,5);
    return {rank:5, name:'Couleur', values:vals};
  }
  // Suite ?
  const straightHigh = getStraight(ranks);
  if (straightHigh) return {rank:4, name:'Suite', values:[straightHigh]};
  // Brelan ?
  for (const r of ranks) if (byRank[r].length === 3)
    return {rank:3, name:'Brelan', values:[RANK_ORDER[r], ...kickers(r,2)]};
  // Double paire ?
  let pairs = ranks.filter(r=>byRank[r].length===2);
  if (pairs.length>=2) return {rank:2, name:'Double paire', values:[RANK_ORDER[pairs[0]],RANK_ORDER[pairs[1]],...kickers(pairs[0],1,pairs[1])]};
  // Paire ?
  if (pairs.length===1) return {rank:1, name:'Paire', values:[RANK_ORDER[pairs[0]],...kickers(pairs[0],3)]};
  // Carte haute
  return {rank:0, name:'Hauteur', values:ranks.map(r=>RANK_ORDER[r]).slice(0,5)};
  function kickers(exclude, n, exclude2) {
    return ranks.filter(r=>r!==exclude&&r!==exclude2).map(r=>RANK_ORDER[r]).slice(0,n);
  }
}

function showdown() {
  // Déterminer le(s) gagnant(s), distribuer le pot, notifier les joueurs
  const active = TABLE.players.filter(p=>!p.folded && p.hand.length===2);
  if (active.length === 0) return; // Personne ?
  // Évaluer chaque main
  for (const p of active) {
    p.best = getHandRank([...p.hand, ...TABLE.community]);
  }
  // Trouver le(s) meilleur(s)
  active.sort((a,b)=>{
    if (b.best.rank !== a.best.rank) return b.best.rank - a.best.rank;
    for (let i=0;i<5;i++) {
      if ((b.best.values[i]||0)!==(a.best.values[i]||0)) return (b.best.values[i]||0)-(a.best.values[i]||0);
    }
    return 0;
  });
  const best = active[0].best;
  const winners = active.filter(p=>compareHands(p.best, best)===0);
  const gain = Math.floor(TABLE.pot / winners.length);
  for (const w of winners) w.stack += gain;
  // Notifier
  for (const p of TABLE.players) {
    p.ws.send(JSON.stringify({
      type: 'showdown',
      winners: winners.map(w=>w.pseudo),
      best: best.name,
      hand: p.hand,
      yourBest: p.best ? p.best.name : null,
      pot: TABLE.pot,
    }));
  }
  setTimeout(newHand, 4000);
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return b.rank - a.rank;
  for (let i=0;i<5;i++) {
    if ((b.values[i]||0)!==(a.values[i]||0)) return (b.values[i]||0)-(a.values[i]||0);
  }
  return 0;
}

function newHand() {
  // Vérifier qu'il reste au moins 2 joueurs avec des jetons
  const inGame = TABLE.players.filter(p=>p.stack>0);
  if (inGame.length<2) {
    TABLE.started = false;
    TABLE.phase = 'waiting';
    broadcastTableState();
    return;
  }
  // Tourner le bouton
  TABLE.dealerIndex = (TABLE.dealerIndex+1)%TABLE.players.length;
  // Remettre les joueurs broke en spectateurs
  for (const p of TABLE.players) {
    if (p.stack<=0) { p.folded=true; p.hand=[]; }
  }
  // Relancer une main
  TABLE.deck = shuffle(createDeck());
  TABLE.community = [];
  TABLE.pot = 0;
  TABLE.phase = 'preflop';
  TABLE.lastRaise = TABLE.bigBlind;
  // Distribuer les mains
  for (let i = 0; i < TABLE.players.length; i++) {
    const player = TABLE.players[i];
    if (player.stack>0) {
      player.hand = [TABLE.deck.pop(), TABLE.deck.pop()];
      player.bet = 0;
      player.folded = false;
    } else {
      player.hand = [];
      player.folded = true;
    }
  }
  // Blinds
  const sbIndex = (TABLE.dealerIndex + 1) % TABLE.players.length;
  const bbIndex = (TABLE.dealerIndex + 2) % TABLE.players.length;
  if (TABLE.players[sbIndex].stack>=TABLE.smallBlind) {
    TABLE.players[sbIndex].stack -= TABLE.smallBlind;
    TABLE.players[sbIndex].bet = TABLE.smallBlind;
  } else {
    TABLE.players[sbIndex].bet = 0;
  }
  if (TABLE.players[bbIndex].stack>=TABLE.bigBlind) {
    TABLE.players[bbIndex].stack -= TABLE.bigBlind;
    TABLE.players[bbIndex].bet = TABLE.bigBlind;
  } else {
    TABLE.players[bbIndex].bet = 0;
  }
  TABLE.pot = (TABLE.players[sbIndex].bet||0) + (TABLE.players[bbIndex].bet||0);
  TABLE.currentPlayer = (TABLE.dealerIndex + 1 + 1) % TABLE.players.length;
  broadcastTableState();
  notifyCurrentPlayer();
}

// Remplacer advancePhase pour appeler showdown
function advancePhase() {
  for (const p of TABLE.players) p.bet = 0;
  if (TABLE.phase === 'preflop') {
    TABLE.community = [TABLE.deck.pop(), TABLE.deck.pop(), TABLE.deck.pop()];
    TABLE.phase = 'flop';
  } else if (TABLE.phase === 'flop') {
    TABLE.community.push(TABLE.deck.pop());
    TABLE.phase = 'turn';
  } else if (TABLE.phase === 'turn') {
    TABLE.community.push(TABLE.deck.pop());
    TABLE.phase = 'river';
  } else if (TABLE.phase === 'river') {
    TABLE.phase = 'showdown';
    showdown();
    return;
  }
  broadcastTableState();
  if (TABLE.phase !== 'showdown') {
    TABLE.currentPlayer = getFirstActivePlayer();
    notifyCurrentPlayer();
  }
}

function getFirstActivePlayer() {
  for (let i = 0; i < TABLE.players.length; i++) {
    if (!TABLE.players[i].folded && TABLE.players[i].stack > 0) return i;
  }
  return 0;
}

function notifyCurrentPlayer() {
  const player = TABLE.players[TABLE.currentPlayer];
  if (player) {
    player.ws.send(JSON.stringify({ type: 'your_turn' }));
  }
}

function broadcastTableState() {
  const state = {
    type: 'state',
    players: TABLE.players.map(p => ({ pseudo: p.pseudo, stack: p.stack, bet: p.bet, folded: p.folded })),
    started: TABLE.started,
    community: TABLE.community,
    pot: TABLE.pot,
    phase: TABLE.phase,
    dealerIndex: TABLE.dealerIndex,
    currentPlayer: TABLE.currentPlayer,
  };
  for (const player of TABLE.players) {
    player.ws.send(JSON.stringify({
      ...state,
      hand: player.hand,
    }));
  }
}

console.log('Serveur WebSocket lancé sur ws://localhost:8080'); 