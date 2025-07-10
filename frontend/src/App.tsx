import { useState, useEffect } from 'react';
import useWebSocket from 'react-use-websocket';

const WS_URL = 'ws://localhost:8080';

function App() {
  const [pseudo, setPseudo] = useState('');
  const [inputPseudo, setInputPseudo] = useState('');
  const [raiseAmount, setRaiseAmount] = useState(20);
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
        // Masquer automatiquement après 3 secondes
        setTimeout(() => setShowWinner(false), 3000);
      }
    }
  }, [lastMessage]);

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

  return (
    <div className="min-h-screen flex flex-col items-center p-6 space-y-6">
      <div className="w-full max-w-6xl">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            Poker Texas Hold'em
          </h1>
          <div className="flex items-center space-x-4">
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

            {/* Pot */}
            {gameState.pot > 0 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <div className="chip">{gameState.pot}</div>
              </div>
            )}

            {/* Joueurs */}
            <div className="grid grid-cols-3 gap-4">
              {gameState.players.map((p: any, i: number) => (
                <div key={i} className={`player-box ${i === gameState.currentPlayer ? 'player-box-active' : ''} ${p.folded ? 'player-box-folded' : ''}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium">{p.pseudo}</span>
                    <span>{p.stack}</span>
                  </div>
                  {i === gameState.dealerIndex && <div className="dealer-button">D</div>}
                  {p.bet > 0 && (
                    <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2">
                      <div className="chip">{p.bet}</div>
                    </div>
                  )}
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
                >
                  Suivre ({maxBet - player.bet})
                </button>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => sendMessage(JSON.stringify({ type: 'action', action: 'raise', amount: raiseAmount }))}
                  className="btn-action btn-raise"
                >
                  Relancer
                </button>
                <input
                  type="number"
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  className="input-primary w-24"
                  min={gameState.bigBlind}
                  step={gameState.bigBlind}
                />
              </div>
            </div>
          )}

          {/* Notification du gagnant */}
          {showWinner && showdown && (
            <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 winner-notification">
              <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-8 py-4 rounded-2xl shadow-2xl border border-emerald-500/30 backdrop-blur-sm animate-pulse-border">
                <div className="text-center">
                  <div className="text-2xl font-bold mb-2">
                    🎉 {showdown.winners.length > 1 ? 'Gagnants' : 'Gagnant'} 🎉
                  </div>
                  <div className="text-lg font-semibold mb-1">
                    {showdown.winners.join(' et ')}
                  </div>
                  <div className="text-sm opacity-90">
                    {showdown.best} • {showdown.pot} jetons
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
