import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import LanguageSwitcher from './LanguageSwitcher';
import { useI18n } from '../i18n';
import Footer from './Footer';

export default function Home() {
  const { code: urlCode } = useParams();
  const [mode, setMode] = useState(urlCode ? 'join' : null); // null, 'create', 'join'
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState(urlCode?.toUpperCase() || '');
  const [joinAsSpectator, setJoinAsSpectator] = useState(false);
  const { createRoom, joinRoom, error, clearError } = useGame();
  const { t, tError } = useI18n();

  // If URL has a code, go straight to join mode
  useEffect(() => {
    if (urlCode) {
      setMode('join');
      setRoomCode(urlCode.toUpperCase());
    }
  }, [urlCode]);

  const handleCreate = (e) => {
    e.preventDefault();
    if (playerName.trim()) {
      createRoom(playerName.trim());
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (playerName.trim() && roomCode.trim()) {
      joinRoom(roomCode.trim(), playerName.trim(), joinAsSpectator);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <LanguageSwitcher />
      <div className="glow-orb w-64 h-64 bg-teal-400/30 -left-10 -top-10" />
      <div className="glow-orb w-80 h-80 bg-rose-400/30 -right-10 top-20" />
      <div className="glow-orb w-72 h-72 bg-blue-400/20 left-1/3 -bottom-10" />

      <div className="text-center mb-12 animate-fade-up">
        <h1 className="text-6xl md:text-7xl font-bold mb-4 bg-linear-to-r from-teal-300 via-cyan-300 to-sky-300 text-transparent bg-clip-text drop-shadow-sm">
          {t('app.title')}
        </h1>
        <p className="text-slate-300 text-lg">{t('app.tagline')}</p>
      </div>

      {error && (
        <div className="card bg-rose-900/40 border-rose-500/60 mb-6 max-w-md w-full animate-fade-up">
          <p className="text-rose-100">{tError(error)}</p>
          <button onClick={clearError} className="text-rose-200 text-sm mt-2 hover:underline">
            {t('home.dismiss')}
          </button>
        </div>
      )}

      {!mode && (
        <div className="card max-w-md w-full space-y-4 animate-fade-up">
          <button onClick={() => setMode('create')} className="btn-primary w-full text-lg">
            {t('buttons.createGame')}
          </button>
          <button onClick={() => setMode('join')} className="btn-secondary w-full text-lg">
            {t('buttons.joinGame')}
          </button>
        </div>
      )}

      {mode === 'create' && (
        <form onSubmit={handleCreate} className="card max-w-md w-full space-y-4 animate-fade-up">
          <h2 className="text-2xl font-bold text-center">{t('home.createRoomTitle')}</h2>
          <input
            type="text"
            placeholder={t('home.nicknamePlaceholder')}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="input"
            maxLength={15}
            autoFocus
          />
          <button type="submit" className="btn-primary w-full" disabled={!playerName.trim()}>
            {t('buttons.createRoom')}
          </button>
          <button type="button" onClick={() => setMode(null)} className="btn-secondary w-full">
            {t('buttons.back')}
          </button>
        </form>
      )}

      {mode === 'join' && (
        <form onSubmit={handleJoin} className="card max-w-md w-full space-y-4 animate-fade-up">
          <h2 className="text-2xl font-bold text-center">{t('home.joinRoomTitle')}</h2>
          <input
            type="text"
            placeholder={t('home.nicknamePlaceholder')}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="input"
            maxLength={15}
            autoFocus
          />
          <input
            type="text"
            placeholder={t('home.roomCodePlaceholder')}
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            className="input text-center text-2xl tracking-widest"
            maxLength={4}
          />
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={joinAsSpectator}
              onChange={(e) => setJoinAsSpectator(e.target.checked)}
              className="w-4 h-4 rounded-sm border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500 focus:ring-offset-slate-900"
            />
            {t('home.joinAsSpectator')}
          </label>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!playerName.trim() || roomCode.length < 4}
          >
            {t('buttons.joinRoom')}
          </button>
          <button type="button" onClick={() => setMode(null)} className="btn-secondary w-full">
            {t('buttons.back')}
          </button>
        </form>
      )}

      <Footer />
    </div>
  );
}
