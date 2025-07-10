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
  bigBlind: 20,
  smallBlind: 10,
  lastBettor: -1, // Index du dernier joueur ayant misé/relancé
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
    if (data.type === 'start' && !TABLE.started && TABLE.players.length >= 2) {
      startGame();
    }
    if (data.type === 'action') {
      handleAction(ws, data.action, data.amount);
    }
    if (data.type === 'stop') {
      stopGame();
    }
  });
});

function startGame() {
  TABLE.started = true;
  TABLE.deck = shuffle(createDeck());
  TABLE.community = [];
  TABLE.pot = 0;
  TABLE.phase = 'preflop';
  TABLE.lastRaise = TABLE.bigBlind;
  TABLE.lastBettor = -1;

  // Distribuer les cartes et réinitialiser les états
  for (let i = 0; i < TABLE.players.length; i++) {
    const player = TABLE.players[i];
    player.hand = [TABLE.deck.pop(), TABLE.deck.pop()];
    player.bet = 0;
    player.folded = false;
  }

  // Gérer le bouton et les blinds
  TABLE.dealerIndex = Math.floor(Math.random() * TABLE.players.length);
  const sbIndex = (TABLE.dealerIndex + 1) % TABLE.players.length;
  const bbIndex = (TABLE.dealerIndex + 2) % TABLE.players.length;

  // Prélever les blinds
  TABLE.players[sbIndex].stack -= TABLE.smallBlind;
  TABLE.players[sbIndex].bet = TABLE.smallBlind;
  TABLE.players[bbIndex].stack -= TABLE.bigBlind;
  TABLE.players[bbIndex].bet = TABLE.bigBlind;
  TABLE.pot = TABLE.smallBlind + TABLE.bigBlind;

  // UTG (Under The Gun) commence
  TABLE.currentPlayer = (TABLE.dealerIndex + 3) % TABLE.players.length;
  broadcastTableState();
  notifyCurrentPlayer();
}

function handleAction(ws, action, amount) {
  const playerIndex = TABLE.players.findIndex(p => p.ws === ws);
  if (playerIndex !== TABLE.currentPlayer || TABLE.players[playerIndex].folded) return;

  const player = TABLE.players[playerIndex];
  const maxBet = Math.max(...TABLE.players.map(p => p.bet));
  const minRaise = TABLE.phase === 'preflop' ? TABLE.bigBlind : TABLE.lastRaise;

  switch (action) {
    case 'fold':
      player.folded = true;
      break;

    case 'call': {
      const toCall = maxBet - player.bet;
      if (toCall > 0) {
        const actualCall = Math.min(toCall, player.stack);
        player.stack -= actualCall;
        player.bet += actualCall;
        TABLE.pot += actualCall;
      }
      break;
    }

    case 'check':
      if (player.bet !== maxBet) return;
      break;

    case 'raise': {
      const toCall = maxBet - player.bet;
      if (amount < minRaise || player.stack < (toCall + amount)) return;
      
      player.stack -= (toCall + amount);
      player.bet += (toCall + amount);
      TABLE.pot += (toCall + amount);
      TABLE.lastRaise = amount;
      TABLE.lastBettor = playerIndex;
      break;
    }

    default:
      return;
  }

  // Passer au joueur suivant
  nextTurn();
}

function nextTurn() {
  if (isRoundComplete()) {
    advancePhase();
    return;
  }

  do {
    TABLE.currentPlayer = (TABLE.currentPlayer + 1) % TABLE.players.length;
  } while (
    TABLE.players[TABLE.currentPlayer].folded || 
    TABLE.players[TABLE.currentPlayer].stack === 0
  );

  broadcastTableState();
  notifyCurrentPlayer();
}

function isRoundComplete() {
  const activePlayers = TABLE.players.filter(p => !p.folded && p.stack > 0);
  if (activePlayers.length <= 1) return true;

  const maxBet = Math.max(...TABLE.players.map(p => p.bet));
  const allBetsEqual = activePlayers.every(p => p.bet === maxBet || p.stack === 0);
  const everyoneHadTurn = TABLE.lastBettor === -1 || 
    TABLE.currentPlayer === TABLE.lastBettor || 
    TABLE.players[TABLE.currentPlayer].bet === maxBet;

  return allBetsEqual && everyoneHadTurn;
}

function advancePhase() {
  // Reset des mises pour le nouveau tour
  TABLE.lastBettor = -1;
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

  // Premier joueur actif après le dealer
  TABLE.currentPlayer = getNextActivePlayer(TABLE.dealerIndex);
  broadcastTableState();
  notifyCurrentPlayer();
}

function getNextActivePlayer(fromIndex) {
  for (let i = 1; i <= TABLE.players.length; i++) {
    const idx = (fromIndex + i) % TABLE.players.length;
    if (!TABLE.players[idx].folded && TABLE.players[idx].stack > 0) return idx;
  }
  return fromIndex;
}

function stopGame() {
  TABLE.started = false;
  TABLE.phase = 'waiting';
  TABLE.community = [];
  TABLE.pot = 0;
  TABLE.lastBettor = -1;
  for (const p of TABLE.players) {
    p.hand = [];
    p.bet = 0;
    p.folded = false;
  }
  broadcastTableState();
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

function notifyCurrentPlayer() {
  const player = TABLE.players[TABLE.currentPlayer];
  if (player) {
    player.ws.send(JSON.stringify({ type: 'your_turn' }));
  }
}

function broadcastTableState() {
  const state = {
    type: 'state',
    players: TABLE.players.map(p => ({ 
      pseudo: p.pseudo, 
      stack: p.stack, 
      bet: p.bet, 
      folded: p.folded 
    })),
    started: TABLE.started,
    community: TABLE.community,
    pot: TABLE.pot,
    phase: TABLE.phase,
    dealerIndex: TABLE.dealerIndex,
    currentPlayer: TABLE.currentPlayer,
    lastRaise: TABLE.lastRaise,
    bigBlind: TABLE.bigBlind
  };

  for (const player of TABLE.players) {
    player.ws.send(JSON.stringify({
      ...state,
      hand: player.hand,
    }));
  }
}

console.log('Serveur WebSocket lancé sur ws://localhost:8080'); 