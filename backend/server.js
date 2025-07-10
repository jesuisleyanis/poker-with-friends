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
  players: [], // { ws, pseudo, hand, stack, bet, folded, hasActed, allIn, totalInvested }
  deck: [],
  community: [],
  started: false,
  pot: 0,
  sidePots: [], // [{ amount, eligiblePlayers: [indices] }]
  dealerIndex: 0,
  currentPlayer: 0,
  phase: 'waiting', // waiting, preflop, flop, turn, river, showdown
  lastRaise: 0,
  bigBlind: 20,
  smallBlind: 10,
  lastBettor: -1, // Index du dernier joueur ayant misé/relancé
  allInPlayers: [], // Joueurs all-in avec leur montant total investi
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
      TABLE.players.push({ 
        ws, 
        pseudo: data.pseudo, 
        hand: [], 
        stack: INITIAL_STACK, 
        bet: 0, 
        folded: false,
        hasActed: false,
        allIn: false,
        totalInvested: 0
      });
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
  TABLE.sidePots = []; // Reset side pots
  TABLE.allInPlayers = []; // Reset all-in players

  // Distribuer les cartes et réinitialiser les états
  for (let i = 0; i < TABLE.players.length; i++) {
    const player = TABLE.players[i];
    player.hand = [TABLE.deck.pop(), TABLE.deck.pop()];
    player.bet = 0;
    player.folded = false;
    player.hasActed = false;
    player.allIn = false;
    player.totalInvested = 0;
  }

  // Gérer le bouton et les blinds
  TABLE.dealerIndex = Math.floor(Math.random() * TABLE.players.length);
  const sbIndex = (TABLE.dealerIndex + 1) % TABLE.players.length;
  const bbIndex = (TABLE.dealerIndex + 2) % TABLE.players.length;

  // Prélever les blinds
  TABLE.players[sbIndex].stack -= TABLE.smallBlind;
  TABLE.players[sbIndex].bet = TABLE.smallBlind;
  TABLE.players[sbIndex].totalInvested = TABLE.smallBlind;
  TABLE.players[bbIndex].stack -= TABLE.bigBlind;
  TABLE.players[bbIndex].bet = TABLE.bigBlind;
  TABLE.players[bbIndex].totalInvested = TABLE.bigBlind;
  TABLE.pot = TABLE.smallBlind + TABLE.bigBlind;

  // En preflop, seule la petite blinde a "agi", la grosse blinde doit pouvoir agir
  TABLE.players[sbIndex].hasActed = true;
  TABLE.players[bbIndex].hasActed = false; // BB peut encore agir

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
        player.totalInvested += actualCall;
        TABLE.pot += actualCall;
        
        // Si le joueur fait tapis en suivant, marquer comme all-in
        if (player.stack === 0) {
          player.allIn = true;
          TABLE.allInPlayers.push({ index: playerIndex, amount: player.totalInvested });
        }
      }
      break;
    }

    case 'check':
      if (player.bet !== maxBet) return;
      break;

    case 'raise': {
      const toCall = maxBet - player.bet;
      const totalBetAmount = amount; // Le montant total que le joueur veut miser
      const raiseAmount = totalBetAmount - maxBet; // Le montant de la relance pure
      
      // Vérifications
      if (raiseAmount < minRaise || totalBetAmount > (player.stack + player.bet)) return;
      
      const actualBetAmount = totalBetAmount - player.bet; // Ce que le joueur doit ajouter
      
      player.stack -= actualBetAmount;
      player.bet = totalBetAmount;
      player.totalInvested += actualBetAmount;
      TABLE.pot += actualBetAmount;
      TABLE.lastRaise = raiseAmount;
      TABLE.lastBettor = playerIndex;
      
      // Si le joueur fait tapis en relançant, marquer comme all-in
      if (player.stack === 0) {
        player.allIn = true;
        TABLE.allInPlayers.push({ index: playerIndex, amount: player.totalInvested });
      }
      
      // Réinitialiser hasActed pour tous les autres joueurs actifs
      for (let i = 0; i < TABLE.players.length; i++) {
        if (i !== playerIndex && !TABLE.players[i].folded && TABLE.players[i].stack > 0) {
          TABLE.players[i].hasActed = false;
        }
      }
      break;
    }

    case 'allin': {
      const toCall = maxBet - player.bet;
      const allInAmount = player.stack;
      
      if (allInAmount === 0) return;
      
      player.stack = 0;
      player.bet += allInAmount;
      player.totalInvested += allInAmount;
      TABLE.pot += allInAmount;
      player.allIn = true;
      TABLE.allInPlayers.push({ index: playerIndex, amount: player.totalInvested });
      
      // Si le montant all-in est supérieur à une relance minimale après le call
      if (allInAmount > toCall + minRaise) {
        TABLE.lastRaise = allInAmount - toCall;
        TABLE.lastBettor = playerIndex;
        
        // Réinitialiser hasActed pour tous les autres joueurs actifs
        for (let i = 0; i < TABLE.players.length; i++) {
          if (i !== playerIndex && !TABLE.players[i].folded && TABLE.players[i].stack > 0) {
            TABLE.players[i].hasActed = false;
          }
        }
      }
      break;
    }

    default:
      return;
  }

  // Marquer le joueur comme ayant agi
  player.hasActed = true;

  // Passer au joueur suivant
  nextTurn();
}

function nextTurn() {
  // Calculer les side pots après chaque action
  calculateSidePots();
  
  if (isRoundComplete()) {
    advancePhase();
    return;
  }

  // Chercher le prochain joueur actif avec des jetons
  let attempts = 0;
  do {
    TABLE.currentPlayer = (TABLE.currentPlayer + 1) % TABLE.players.length;
    attempts++;
    
    // Éviter une boucle infinie
    if (attempts >= TABLE.players.length) {
      advancePhase();
      return;
    }
  } while (
    TABLE.players[TABLE.currentPlayer].folded || 
    TABLE.players[TABLE.currentPlayer].stack === 0
  );

  broadcastTableState();
  notifyCurrentPlayer();
}

function isRoundComplete() {
  const activePlayers = TABLE.players.filter(p => !p.folded);
  const playersWithChips = activePlayers.filter(p => p.stack > 0);
  
  // Si il ne reste qu'un seul joueur actif, la main est terminée
  if (activePlayers.length <= 1) return true;
  
  // Si tous les joueurs actifs sauf un sont à tapis, et que le dernier a agi
  if (playersWithChips.length <= 1) {
    if (playersWithChips.length === 0) return true;
    return playersWithChips[0].hasActed;
  }

  const maxBet = Math.max(...TABLE.players.map(p => p.bet));
  
  // Vérifier que tous les joueurs actifs ont soit la même mise, soit sont à tapis
  const allBetsEqual = activePlayers.every(p => p.bet === maxBet || p.stack === 0);
  
  // Si tous les joueurs actifs n'ont pas misé le même montant, le tour continue
  if (!allBetsEqual) return false;
  
  // Vérifier que tous les joueurs avec des jetons ont agi
  const allPlayersWithChipsActed = playersWithChips.every(p => p.hasActed);
  
  return allPlayersWithChipsActed;
}

function advancePhase() {
  // Calculer les side pots avant d'avancer
  calculateSidePots();
  
  // Vérifier s'il ne reste qu'un seul joueur actif
  const activePlayers = TABLE.players.filter(p => !p.folded);
  if (activePlayers.length <= 1) {
    // Le dernier joueur actif remporte tous les pots
    if (activePlayers.length === 1) {
      activePlayers[0].stack += TABLE.pot;
      // Notifier le gagnant
      for (const p of TABLE.players) {
        p.ws.send(JSON.stringify({
          type: 'showdown',
          winners: [activePlayers[0].pseudo],
          best: 'Seul joueur actif',
          hand: p.hand,
          yourBest: p.pseudo === activePlayers[0].pseudo ? 'Seul joueur actif' : null,
          pot: TABLE.pot,
          sidePots: TABLE.sidePots
        }));
      }
    }
    setTimeout(newHand, 2000);
    return;
  }

  // Reset des mises pour le nouveau tour
  TABLE.lastBettor = -1;
  for (const p of TABLE.players) {
    p.bet = 0;
    p.hasActed = false;
  }

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

  // Si tous les joueurs actifs sont all-in, avancer automatiquement
  if (areAllActivePlayersAllIn()) {
    setTimeout(() => {
      advancePhase();
    }, 1500); // Délai pour voir les cartes
    broadcastTableState();
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
  TABLE.sidePots = []; // Reset side pots
  TABLE.allInPlayers = []; // Reset all-in players
  for (const p of TABLE.players) {
    p.hand = [];
    p.bet = 0;
    p.folded = false;
    p.hasActed = false;
    p.allIn = false;
    p.totalInvested = 0;
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
  // Calculer les side pots finaux
  calculateSidePots();
  
  // Déterminer les joueurs actifs pour le showdown
  const activePlayers = TABLE.players.filter(p => !p.folded && p.hand.length === 2);
  if (activePlayers.length === 0) return;
  
  // Évaluer chaque main
  for (const p of activePlayers) {
    p.best = getHandRank([...p.hand, ...TABLE.community]);
  }
  
  // Distribuer chaque side pot
  const results = [];
  const allWinners = new Set();
  
  for (let i = 0; i < TABLE.sidePots.length; i++) {
    const sidePot = TABLE.sidePots[i];
    
    // Joueurs éligibles pour ce side pot
    const eligiblePlayers = activePlayers.filter(p => 
      sidePot.eligiblePlayers.includes(TABLE.players.indexOf(p))
    );
    
    if (eligiblePlayers.length === 0) continue;
    
    // Trouver le(s) meilleur(s) parmi les éligibles
    eligiblePlayers.sort((a, b) => {
      if (b.best.rank !== a.best.rank) return b.best.rank - a.best.rank;
      for (let j = 0; j < 5; j++) {
        if ((b.best.values[j] || 0) !== (a.best.values[j] || 0)) {
          return (b.best.values[j] || 0) - (a.best.values[j] || 0);
        }
      }
      return 0;
    });
    
    const bestHand = eligiblePlayers[0].best;
    const winners = eligiblePlayers.filter(p => compareHands(p.best, bestHand) === 0);
    
    // Distribuer le side pot
    const gain = Math.floor(sidePot.amount / winners.length);
    for (const winner of winners) {
      winner.stack += gain;
      allWinners.add(winner.pseudo);
    }
    
    results.push({
      potIndex: i,
      amount: sidePot.amount,
      winners: winners.map(w => w.pseudo),
      bestHand: bestHand.name
    });
  }
  
  // Préparer les cartes à révéler
  const revealedCards = {};
  
  // Révéler les cartes des gagnants
  for (const player of activePlayers) {
    if (allWinners.has(player.pseudo)) {
      revealedCards[player.pseudo] = {
        hand: player.hand,
        best: player.best.name,
        isWinner: true
      };
    }
  }
  
  // Révéler les cartes des joueurs all-in (même s'ils n'ont pas gagné)
  for (const player of TABLE.players) {
    if (player.allIn && !player.folded && player.hand.length === 2) {
      if (!revealedCards[player.pseudo]) {
        revealedCards[player.pseudo] = {
          hand: player.hand,
          best: player.best ? player.best.name : 'Main évaluée',
          isWinner: false,
          isAllIn: true
        };
      } else {
        revealedCards[player.pseudo].isAllIn = true;
      }
    }
  }
  
  const mainResult = results[results.length - 1] || { bestHand: 'Aucune main', winners: [] };
  
  // Notifier tous les joueurs
  for (const p of TABLE.players) {
    p.ws.send(JSON.stringify({
      type: 'showdown',
      winners: Array.from(allWinners),
      best: mainResult.bestHand,
      hand: p.hand,
      yourBest: p.best ? p.best.name : null,
      pot: TABLE.pot,
      sidePots: TABLE.sidePots,
      results: results,
      revealedCards: revealedCards
    }));
  }
  
  setTimeout(newHand, 6000); // Plus de temps pour voir les cartes révélées
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
  TABLE.lastBettor = -1;
  TABLE.sidePots = []; // Reset side pots
  TABLE.allInPlayers = []; // Reset all-in players
  
  // Distribuer les mains et réinitialiser les états
  for (let i = 0; i < TABLE.players.length; i++) {
    const player = TABLE.players[i];
    if (player.stack>0) {
      player.hand = [TABLE.deck.pop(), TABLE.deck.pop()];
      player.bet = 0;
      player.folded = false;
      player.hasActed = false;
      player.allIn = false;
      player.totalInvested = 0;
    } else {
      player.hand = [];
      player.folded = true;
      player.hasActed = false;
      player.allIn = false;
      player.totalInvested = 0;
    }
  }
  
  // Blinds
  const sbIndex = (TABLE.dealerIndex + 1) % TABLE.players.length;
  const bbIndex = (TABLE.dealerIndex + 2) % TABLE.players.length;
  if (TABLE.players[sbIndex].stack>=TABLE.smallBlind) {
    TABLE.players[sbIndex].stack -= TABLE.smallBlind;
    TABLE.players[sbIndex].bet = TABLE.smallBlind;
    TABLE.players[sbIndex].totalInvested = TABLE.smallBlind;
    TABLE.players[sbIndex].hasActed = true;
  } else {
    TABLE.players[sbIndex].bet = 0;
    TABLE.players[sbIndex].totalInvested = 0;
  }
  if (TABLE.players[bbIndex].stack>=TABLE.bigBlind) {
    TABLE.players[bbIndex].stack -= TABLE.bigBlind;
    TABLE.players[bbIndex].bet = TABLE.bigBlind;
    TABLE.players[bbIndex].totalInvested = TABLE.bigBlind;
    TABLE.players[bbIndex].hasActed = false; // BB peut encore agir en preflop
  } else {
    TABLE.players[bbIndex].bet = 0;
    TABLE.players[bbIndex].totalInvested = 0;
  }
  TABLE.pot = (TABLE.players[sbIndex].bet||0) + (TABLE.players[bbIndex].bet||0);
  TABLE.currentPlayer = (TABLE.dealerIndex + 3) % TABLE.players.length;
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
      folded: p.folded,
      allIn: p.allIn || false,
      totalInvested: p.totalInvested
    })),
    started: TABLE.started,
    community: TABLE.community,
    pot: TABLE.pot,
    phase: TABLE.phase,
    dealerIndex: TABLE.dealerIndex,
    currentPlayer: TABLE.currentPlayer,
    lastRaise: TABLE.lastRaise,
    bigBlind: TABLE.bigBlind,
    sidePots: TABLE.sidePots.map(sp => ({ amount: sp.amount, eligiblePlayers: sp.eligiblePlayers }))
  };

  for (const player of TABLE.players) {
    player.ws.send(JSON.stringify({
      ...state,
      hand: player.hand,
    }));
  }
}

function calculateSidePots() {
  // Réinitialiser les side pots
  TABLE.sidePots = [];
  
  // Récupérer tous les joueurs qui ont investi de l'argent (pas couchés)
  const activePlayers = TABLE.players
    .map((p, index) => ({ ...p, index }))
    .filter(p => !p.folded && (p.totalInvested > 0 || p.bet > 0));
  
  if (activePlayers.length === 0) return;
  
  // Utiliser le montant total investi pour calculer les side pots
  const investmentLevels = activePlayers.map(p => p.totalInvested).sort((a, b) => a - b);
  const uniqueLevels = [...new Set(investmentLevels)];
  
  let previousLevel = 0;
  
  for (const level of uniqueLevels) {
    if (level > previousLevel) {
      const potIncrement = level - previousLevel;
      const eligiblePlayers = activePlayers
        .filter(p => p.totalInvested >= level)
        .map(p => p.index);
      
      const potAmount = potIncrement * eligiblePlayers.length;
      
      if (potAmount > 0) {
        TABLE.sidePots.push({
          amount: potAmount,
          eligiblePlayers: eligiblePlayers
        });
      }
    }
    previousLevel = level;
  }
  
  // Calculer le pot total
  TABLE.pot = TABLE.sidePots.reduce((total, sidePot) => total + sidePot.amount, 0);
}

function areAllActivePlayersAllIn() {
  const activePlayers = TABLE.players.filter(p => !p.folded);
  const playersWithChips = activePlayers.filter(p => p.stack > 0);
  
  // Si il ne reste qu'un joueur avec des jetons ou moins, on peut avancer automatiquement
  return playersWithChips.length <= 1;
}

console.log('Serveur WebSocket lancé sur ws://localhost:8080'); 