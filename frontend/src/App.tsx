import { useState, useEffect, useRef } from 'react';

interface Player {
  pseudo: string;
  stack: number;
  bet: number;
  folded: boolean;
}

interface TableState {
  players: Player[];
  started: boolean;
  community: { suit: string; rank: string }[];
  pot: number;
  phase: string;
  dealerIndex: number;
  currentPlayer: number;
  hand: { suit: string; rank: string }[];
}

type Message =
  | { type: 'state'; players: Player[]; started: boolean; community: any[]; pot: number; phase: string; dealerIndex: number; currentPlayer: number; hand: any[] }
  | { type: 'your_turn' }
  | { type: 'showdown'; winners: string[]; best: string; hand: any[]; yourBest: string | null; pot: number }
  | { type: 'error'; message: string };

const WS_URL = window.location.hostname === 'localhost'
  ? 'ws://localhost:8080'
  : 'ws://' + window.location.hostname + ':8080';

export default function App() {
  const [pseudo, setPseudo] = useState('');
  const [inputPseudo, setInputPseudo] = useState('');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [table, setTable] = useState<TableState | null>(null);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [showdown, setShowdown] = useState<{winners:string[],best:string,yourBest:string|null,pot:number}|null>(null);
  const [error, setError] = useState('');
  const raiseRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pseudo) return;
    const socket = new WebSocket(WS_URL);
    setWs(socket);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join', pseudo }));
    };
    socket.onmessage = (event) => {
      const msg: Message = JSON.parse(event.data);
      if (msg.type === 'state') {
        setTable({ ...msg });
        setIsMyTurn(false);
        setShowdown(null);
      }
      if (msg.type === 'your_turn') {
        setIsMyTurn(true);
      }
      if (msg.type === 'showdown') {
        setShowdown({ winners: msg.winners, best: msg.best, yourBest: msg.yourBest, pot: msg.pot });
        setIsMyTurn(false);
      }
      if (msg.type === 'error') {
        setError(msg.message);
      }
    };
    socket.onerror = () => setError('Erreur de connexion WebSocket');
    socket.onclose = () => setError('Déconnecté du serveur');
    return () => socket.close();
  }, [pseudo]);

  function sendAction(action: string, amount?: number) {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'action', action, amount }));
    setIsMyTurn(false);
  }

  if (!pseudo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-900">
        <h1 className="text-3xl font-bold text-white mb-6">Poker Texas Hold'em</h1>
        <input
          className="p-2 rounded mb-2 text-lg"
          placeholder="Ton pseudo..."
          value={inputPseudo}
          onChange={e => setInputPseudo(e.target.value)}
          onKeyDown={e => e.key==='Enter' && inputPseudo && setPseudo(inputPseudo)}
        />
        <button
          className="bg-yellow-500 px-4 py-2 rounded text-lg font-bold"
          disabled={!inputPseudo}
          onClick={() => setPseudo(inputPseudo)}
        >Rejoindre</button>
        {error && <div className="text-red-300 mt-2">{error}</div>}
      </div>
    );
  }

  if (!table) {
    return <div className="flex items-center justify-center min-h-screen bg-green-900 text-white">Connexion...</div>;
  }

  if (!table.started) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-900 text-white">
        <h2 className="text-2xl font-bold mb-4">Salle d'attente</h2>
        <div className="mb-4">Joueurs :</div>
        <ul className="mb-6">
          {table.players.map((p, i) => (
            <li key={p.pseudo} className="mb-1 flex items-center gap-2">
              <span className="font-bold">{p.pseudo}</span>
              {i === table.dealerIndex && <span className="text-yellow-300">(Dealer)</span>}
            </li>
          ))}
        </ul>
        <button
          className="bg-yellow-500 px-4 py-2 rounded text-lg font-bold"
          onClick={() => ws && ws.send(JSON.stringify({ type: 'start' }))}
          disabled={table.players.length < 2}
        >Démarrer la partie</button>
        {error && <div className="text-red-300 mt-2">{error}</div>}
      </div>
    );
  }

  function renderCard(card: {suit:string,rank:string}|null, hidden?:boolean) {
    if (!card) return <div className="w-10 h-14 bg-gray-700 rounded shadow-inner"/>;
    return (
      <div className={`w-10 h-14 rounded shadow-inner flex flex-col items-center justify-center text-xl font-bold ${hidden ? 'bg-gray-700' : 'bg-white'}`}
        style={{color: card.suit==='♥'||card.suit==='♦' ? '#e53e3e' : '#222'}}>
        {hidden ? '?' : card.rank}<br/>{hidden ? '?' : card.suit}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-green-900 flex flex-col items-center py-6">
      <h1 className="text-3xl font-bold text-white mb-2">Poker Texas Hold'em</h1>
      <div className="mb-2 text-white">Pot : <span className="font-bold">{table.pot}</span></div>
      <div className="flex gap-2 mb-4">
        {table.community.map((c,i) => <span key={i}>{renderCard(c)}</span>)}
        {Array.from({length:5-table.community.length}).map((_,i)=>(<span key={i}>{renderCard(null)}</span>))}
      </div>
      <div className="flex flex-wrap justify-center gap-6 mb-8">
        {table.players.map((p, i) => (
          <div key={p.pseudo} className={`flex flex-col items-center px-3 py-2 rounded ${i===table.currentPlayer ? 'bg-yellow-200' : 'bg-gray-800'} ${p.folded ? 'opacity-50' : ''}`}
          >
            <div className="font-bold text-lg">{p.pseudo} {i===table.dealerIndex && <span className="text-yellow-400">(D)</span>}</div>
            <div>Stack : {p.stack}</div>
            <div>Mise : {p.bet}</div>
            <div>{p.folded && <span className="text-red-400">(couché)</span>}</div>
            {p.pseudo===pseudo && table.hand && (
              <div className="flex gap-1 mt-2">
                {table.hand.map((c,i)=>(<span key={i}>{renderCard(c)}</span>))}
              </div>
            )}
          </div>
        ))}
      </div>
      {showdown && (
        <div className="bg-white rounded p-4 mb-4 text-center shadow-lg">
          <div className="font-bold text-lg mb-2">Showdown !</div>
          <div>Gagnant(s) : <span className="font-bold">{showdown.winners.join(', ')}</span></div>
          <div>Main gagnante : {showdown.best}</div>
          {showdown.yourBest && <div>Ta meilleure main : {showdown.yourBest}</div>}
          <div>Pot : {showdown.pot}</div>
        </div>
      )}
      {isMyTurn && (
        <div className="flex gap-2 mb-4">
          <button className="bg-red-500 px-4 py-2 rounded text-white font-bold" onClick={()=>sendAction('fold')}>Se coucher</button>
          <button className="bg-blue-500 px-4 py-2 rounded text-white font-bold" onClick={()=>sendAction('check')}>Check</button>
          <button className="bg-green-500 px-4 py-2 rounded text-white font-bold" onClick={()=>sendAction('call')}>Suivre</button>
          <form onSubmit={e=>{e.preventDefault(); sendAction('raise', Number(raiseRef.current?.value));}} className="flex gap-1">
            <input ref={raiseRef} type="number" min={1} placeholder="Relancer..." className="w-20 p-1 rounded"/>
            <button className="bg-yellow-500 px-2 rounded font-bold">Relancer</button>
          </form>
        </div>
      )}
      <div className="text-white mt-4">Phase : <span className="font-bold">{table.phase}</span></div>
      {error && <div className="text-red-300 mt-2">{error}</div>}
    </div>
  );
}
