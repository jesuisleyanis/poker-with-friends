import { useState, useEffect } from 'react';
import useWebSocket from 'react-use-websocket';

const WS_URL = `ws://${import.meta.env.VITE_BACKEND_HOST}:${import.meta.env.VITE_BACKEND_PORT}`;

function App() {
  const [pseudo, setPseudo] = useState('');
  const [inputPseudo, setInputPseudo] = useState('');
  const [raiseAmount, setRaiseAmount] = useState(40); // Commencer avec 40 (20 + 20 de relance minimum)
  const [gameState, setGameState] = useState<any>(null);
  const [showdown, setShowdown] = useState<any>(null);
  const [showWinner, setShowWinner] = useState(false);
  const { sendMessage, lastMessage } = useWebSocket(WS_URL);

  useEffect(() => {
    if (lastMessage !== null) {
      const data = JSON.parse(lastMessage.data);
      if (data.type === 'state') {
        setGameState(data);
        setShowdown(null);
        setShowWinner(false);
      } else if (data.type === 'showdown') {
        setShowdown(data);
        setShowWinner(true);
        // Masquer automatiquement après 5 secondes (plus de temps pour voir les cartes)
        setTimeout(() => setShowWinner(false), 5000);
      }
    }
  }, [lastMessage]);

  // Mettre à jour raiseAmount quand l'état du jeu change
  useEffect(() => {
    if (gameState && gameState.started) {
      const maxBet = Math.max(...gameState.players.map((p: any) => p.bet));
      const minRaise = Math.max(gameState.bigBlind, gameState.lastRaise || gameState.bigBlind);
      const minTotalBet = maxBet + minRaise;
      
      // Ajuster raiseAmount si nécessaire
      if (raiseAmount < minTotalBet) {
        setRaiseAmount(minTotalBet);
      }
    }
  }, [gameState, raiseAmount]);

  if (!pseudo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md p-8 rounded-3xl shadow-2xl bg-slate-800/20 backdrop-blur-lg border border-white/10">
          <h1 className="text-4xl font-bold text-center mb-8 bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            Poker Texas Hold'em
          </h1>
          <form onSubmit={(e) => {
            e.preventDefault();
            setPseudo(inputPseudo);
            sendMessage(JSON.stringify({ type: 'join', pseudo: inputPseudo }));
          }} className="space-y-6">
            <div>
              <label htmlFor="pseudo" className="block text-sm font-medium text-gray-300 mb-2">
                Votre pseudo
              </label>
              <input
                type="text"
                id="pseudo"
                value={inputPseudo}
                onChange={(e) => setInputPseudo(e.target.value)}
                className="input-primary w-full"
                placeholder="Entrez votre pseudo"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Rejoindre la partie
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!gameState) return <div className="text-center p-8">Chargement...</div>;

  const playerIndex = gameState.players.findIndex((p: any) => p.pseudo === pseudo);
  const isCurrentPlayer = gameState.currentPlayer === playerIndex && gameState.started;
  const player = gameState.players[playerIndex];
  const maxBet = Math.max(...gameState.players.map((p: any) => p.bet));
  const canCheck = player.bet === maxBet;
  const callAmount = maxBet - player.bet;
  const minRaise = Math.max(gameState.bigBlind, gameState.lastRaise || gameState.bigBlind);
  const minTotalBet = maxBet + minRaise;

  return (
    <div className="min-h-screen flex flex-col items-center p-6 space-y-6">
      <div className="w-full max-w-6xl">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            Poker Texas Hold'em
          </h1>
          <div className="flex items-center space-x-4">
            {/* Pot en haut à droite */}
            {gameState.pot > 0 && (
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className="text-gray-300 font-medium">Pot total:</span>
                  <div className="chip text-lg">{gameState.pot}</div>
                </div>
                {/* Affichage des side pots */}
                {gameState.sidePots && gameState.sidePots.length > 1 && (
                  <div className="flex flex-col gap-1">
                    {gameState.sidePots.map((sidePot: any, i: number) => (
                      <div key={i} className="flex items-center space-x-2">
                        <span className="text-xs text-gray-400">Pot {i + 1}:</span>
                        <div className="chip text-xs">{sidePot.amount}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <span className="text-gray-300">
              {player.stack} jetons
            </span>
            {!gameState.started && (
              <button
                onClick={() => sendMessage(JSON.stringify({ type: 'start' }))}
                className="btn btn-primary"
              >
                Démarrer
              </button>
            )}
            {gameState.started && (
              <button
                onClick={() => sendMessage(JSON.stringify({ type: 'stop' }))}
                className="btn btn-fold"
              >
                Arrêter
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <div className="table-felt mb-8">
            {/* Cartes communes */}
            <div className="flex justify-center gap-2 mb-8">
              {gameState.community.map((card: any, i: number) => (
                <div key={i} className="card flex items-center justify-center text-2xl">
                  <span className={card.suit === '♥' || card.suit === '♦' ? 'text-red-500' : 'text-gray-900'}>
                    {card.rank}{card.suit}
                  </span>
                </div>
              ))}
            </div>

            {/* Joueurs */}
            <div className="grid grid-cols-3 gap-4">
              {gameState.players.map((p: any, i: number) => (
                <div key={i} className={`player-box ${i === gameState.currentPlayer ? 'player-box-active' : ''} ${p.folded ? 'player-box-folded' : ''} ${p.allIn ? 'player-box-allin' : ''} ${showdown && showdown.winners.includes(p.pseudo) ? 'player-box-winner winner-glow' : ''}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium">{p.pseudo}</span>
                    <div className="flex items-center gap-2">
                      <span>{p.stack}</span>
                      {p.allIn && <span className="text-xs bg-red-600 text-white px-2 py-1 rounded">ALL-IN</span>}
                      {showdown && showdown.winners.includes(p.pseudo) && (
                        <span className="text-xs bg-yellow-500 text-black px-2 py-1 rounded font-bold">GAGNANT</span>
                      )}
                    </div>
                  </div>
                  {i === gameState.dealerIndex && <div className="dealer-button">D</div>}
                  {p.bet > 0 && (
                    <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2">
                      <div className="chip">{p.bet}</div>
                    </div>
                  )}
                  
                  {/* Cartes du joueur */}
                  {p.pseudo === pseudo && gameState.hand && (
                    <div className="flex gap-2 mt-2">
                      {gameState.hand.map((card: any, j: number) => (
                        <div key={j} className="card flex items-center justify-center text-xl">
                          <span className={card.suit === '♥' || card.suit === '♦' ? 'text-red-500' : 'text-gray-900'}>
                            {card.rank}{card.suit}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Cartes révélées pendant le showdown */}
                  {showdown && showdown.revealedCards && showdown.revealedCards[p.pseudo] && p.pseudo !== pseudo && (
                    <div className="mt-2">
                      <div className="flex gap-2 mb-1">
                        {showdown.revealedCards[p.pseudo].hand.map((card: any, j: number) => (
                          <div key={j} className={`card card-revealed flex items-center justify-center text-xl ${showdown.revealedCards[p.pseudo].isWinner ? 'ring-2 ring-yellow-400' : ''}`}>
                            <span className={card.suit === '♥' || card.suit === '♦' ? 'text-red-500' : 'text-gray-900'}>
                              {card.rank}{card.suit}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-center">
                        <span className={showdown.revealedCards[p.pseudo].isWinner ? 'text-yellow-400 font-bold' : 'text-gray-400'}>
                          {showdown.revealedCards[p.pseudo].best}
                        </span>
                        {showdown.revealedCards[p.pseudo].isWinner && (
                          <span className="block text-yellow-400">🏆 GAGNANT</span>
                        )}
                        {showdown.revealedCards[p.pseudo].isAllIn && !showdown.revealedCards[p.pseudo].isWinner && (
                          <span className="block text-red-400">🔴 ALL-IN</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {isCurrentPlayer && !player.folded && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-slate-800/90 backdrop-blur-sm p-4 rounded-2xl shadow-xl border border-white/10">
              <button
                onClick={() => sendMessage(JSON.stringify({ type: 'action', action: 'fold' }))}
                className="btn-action btn-fold"
              >
                Se coucher
              </button>
              {canCheck ? (
                <button
                  onClick={() => sendMessage(JSON.stringify({ type: 'action', action: 'check' }))}
                  className="btn-action btn-check"
                >
                  Checker
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(JSON.stringify({ type: 'action', action: 'call' }))}
                  className="btn-action btn-call"
                  disabled={callAmount > player.stack}
                >
                  {callAmount >= player.stack ? `Tapis (${player.stack})` : `Suivre (${callAmount})`}
                </button>
              )}
              
              {/* Section Relance */}
              <div className="flex items-center gap-2 border-l border-white/20 pl-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={raiseAmount}
                      onChange={(e) => setRaiseAmount(Math.max(minTotalBet, Number(e.target.value)))}
                      className="input-primary w-20 text-center"
                      min={minTotalBet}
                      max={player.stack + player.bet}
                      step={gameState.bigBlind}
                    />
                    <button
                      onClick={() => sendMessage(JSON.stringify({ type: 'action', action: 'raise', amount: raiseAmount }))}
                      className="btn-action btn-raise"
                      disabled={raiseAmount < minTotalBet || raiseAmount > (player.stack + player.bet)}
                    >
                      Miser {raiseAmount}
                    </button>
                  </div>
                  <div className="text-xs text-gray-400 text-center">
                    Min: {minTotalBet} | Max: {player.stack + player.bet}
                  </div>
                </div>
                
                {/* Bouton All-in */}
                <button
                  onClick={() => sendMessage(JSON.stringify({ type: 'action', action: 'allin' }))}
                  className="btn-action btn-allin"
                  disabled={player.stack === 0}
                >
                  All-in ({player.stack + player.bet})
                </button>
              </div>
            </div>
          )}

          {/* Notification du gagnant améliorée */}
          {showWinner && showdown && (
            <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 winner-notification max-w-md">
              <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-8 py-4 rounded-2xl shadow-2xl border border-emerald-500/30 backdrop-blur-sm animate-pulse-border">
                <div className="text-center">
                  <div className="text-2xl font-bold mb-2">
                    🎉 {showdown.winners.length > 1 ? 'Gagnants' : 'Gagnant'} 🎉
                  </div>
                  <div className="text-lg font-semibold mb-1">
                    {showdown.winners.join(' et ')}
                  </div>
                  <div className="text-sm opacity-90 mb-2">
                    {showdown.best} • {showdown.pot} jetons
                  </div>
                  
                  {/* Affichage des cartes gagnantes */}
                  {showdown.revealedCards && showdown.winners.length === 1 && showdown.revealedCards[showdown.winners[0]] && (
                    <div className="mb-3 p-2 bg-black/20 rounded-lg">
                      <div className="text-xs mb-1">Cartes gagnantes:</div>
                      <div className="flex gap-1 justify-center">
                        {showdown.revealedCards[showdown.winners[0]].hand.map((card: any, i: number) => (
                          <div key={i} className="w-8 h-12 bg-white rounded text-black flex items-center justify-center text-xs">
                            <span className={card.suit === '♥' || card.suit === '♦' ? 'text-red-500' : 'text-gray-900'}>
                              {card.rank}{card.suit}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Affichage détaillé des side pots */}
                  {showdown.results && showdown.results.length > 1 && (
                    <div className="text-xs opacity-80 border-t border-emerald-500/30 pt-2">
                      <div className="font-medium mb-1">Détail des pots:</div>
                      {showdown.results.map((result: any, i: number) => (
                        <div key={i} className="flex justify-between items-center">
                          <span>Pot {i + 1} ({result.amount}):</span>
                          <span>{result.winners.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Indicateur de phase automatique */}
          {gameState.started && gameState.phase !== 'waiting' && (
            <div className="fixed top-20 right-6 bg-slate-800/90 backdrop-blur-sm p-3 rounded-xl border border-white/10">
              <div className="text-sm text-gray-300">
                <div className="font-medium capitalize">{gameState.phase}</div>
                {gameState.sidePots && gameState.sidePots.length > 1 && (
                  <div className="text-xs text-yellow-400 mt-1">
                    Side pots actifs
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
