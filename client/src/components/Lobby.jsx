import { useState, useEffect } from 'react';
import { useGame } from '../context/GameContext';
import LanguageSwitcher from './LanguageSwitcher';
import { useI18n } from '../i18n';

// In production, use same origin. In dev, use localhost:3001
const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

export default function Lobby() {
  const { roomCode, players, isHost, isSpectator, switchRole, startGame, leaveGame, gameState, updateSettings, roomSettings } = useGame();
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState(roomSettings?.categoryIds || []);
  const [answerMode, setAnswerMode] = useState(roomSettings?.answerMode || 'typed');
  const [difficulty, setDifficulty] = useState(roomSettings?.difficulty || 2);
  const [rounds, setRounds] = useState(roomSettings?.totalRounds || 10);
  const [countdown, setCountdown] = useState(3);
  const { t, tError } = useI18n();

  // Playlist import state
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');

  // Countdown timer effect
  useEffect(() => {
    if (gameState === 'countdown') {
      setCountdown(3);
      const interval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 1;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState]);

  // Fetch categories from server
  const fetchCategories = () => {
    fetch(`${API_URL}/api/categories`)
      .then(res => res.json())
      .then(data => {
        setCategories(data);
        // Keep existing selection, don't auto-select
      })
      .catch(err => console.error('Failed to fetch categories:', err));
  };

  // Fetch categories from server
  useEffect(() => {
    fetchCategories();
  }, []);

  // Import Spotify playlist
  const handleImportPlaylist = async () => {
    if (!importUrl.trim()) return;

    setImportLoading(true);
    setImportError('');

    try {
      const res = await fetch(`${API_URL}/api/playlists/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl })
      });

      const data = await res.json();

      if (!res.ok) {
        setImportError(data.error ? tError(data.error) : t('errors.importFailed'));
        return;
      }

      // Refresh categories and select the new one
      fetchCategories();
      setSelectedCategories(prev => [...prev, data.categoryId]);
      setImportUrl('');
      setShowImport(false);
    } catch (err) {
      setImportError(t('errors.importFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  // Delete imported playlist
  const handleDeletePlaylist = async (categoryId, e) => {
    e.stopPropagation();

    if (!confirm(t('lobby.deleteConfirm'))) return;

    try {
      const res = await fetch(`${API_URL}/api/playlists/${categoryId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        // Remove from selection if selected
        setSelectedCategories(prev => prev.filter(id => id !== categoryId));
        // Refresh categories
        fetchCategories();
      }
    } catch (err) {
      console.error('Failed to delete playlist:', err);
    }
  };

  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    const joinUrl = `${window.location.origin}/join/${roomCode}`;

    // Use fallback method that works on both HTTP and HTTPS
    const textArea = document.createElement('textarea');
    textArea.value = joinUrl;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      setCopied(true);
    } catch (err) {
      console.error('Copy failed:', err);
      // Try clipboard API as last resort
      navigator.clipboard?.writeText(joinUrl).then(() => setCopied(true));
    }

    document.body.removeChild(textArea);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleCategory = (categoryId) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(id => id !== categoryId);
      }
      return [...prev, categoryId];
    });
  };

  // Broadcast settings to other players whenever host changes them (debounced)
  useEffect(() => {
    // Movie/videogame mode doesn't need categories, other modes do
    if (!isHost) return;
    if (answerMode !== 'movie' && answerMode !== 'videogame' && selectedCategories.length === 0) return;

    const timeout = setTimeout(() => {
      updateSettings({
        categoryIds: selectedCategories,
        answerMode,
        difficulty,
        totalRounds: rounds
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [isHost, selectedCategories, answerMode, difficulty, rounds, updateSettings]);

  const [startWarning, setStartWarning] = useState(false);

  const handleStartGame = () => {
    // Movie/videogame mode doesn't need categories
    if (answerMode !== 'movie' && answerMode !== 'videogame' && selectedCategories.length === 0) {
      setStartWarning(true);
      setTimeout(() => setStartWarning(false), 3000);
      return;
    }
    startGame();
  };

  if (gameState === 'countdown') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative">
        <LanguageSwitcher />
        <div className="card text-center animate-fade-up">
          <h2 className="text-4xl font-bold mb-4">{t('game.getReady')}</h2>
          <div className="text-8xl font-bold text-teal-400 animate-pulse" key={countdown}>
            {countdown}
          </div>
          <p className="text-slate-300 mt-4">{t('game.gameStarting')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative">
      <LanguageSwitcher />
      <div className="card max-w-lg w-full animate-fade-up">
        <div className="text-center mb-6">
          <p className="text-slate-400 mb-2">{t('lobby.roomCode')}</p>
          <button
            onClick={copyLink}
            className="text-4xl font-bold tracking-widest text-teal-300 hover:text-teal-200 transition-colors"
            title={t('lobby.copyInvite')}
          >
            {roomCode}
          </button>
          <p className="text-slate-400 text-sm mt-2">
            {copied ? t('lobby.copied') : t('lobby.copyInvite')}
          </p>
        </div>

        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3 text-slate-300">
            {t('lobby.players', { count: players.filter(p => p.role !== 'spectator').length })}
          </h3>
          <div className="space-y-2">
            {players.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between bg-slate-800/60 rounded-lg px-4 py-3"
              >
                <span className="font-medium">{player.name}</span>
                <div className="flex items-center gap-2">
                  {player.role === 'spectator' && (
                    <span className="text-xs bg-slate-600/40 px-2 py-1 rounded-full text-slate-300">{t('lobby.spectatorTag')}</span>
                  )}
                  {player.isHost && (
                    <span className="text-xs bg-teal-600/40 px-2 py-1 rounded-full">{t('lobby.hostTag')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {isHost && (
          <div className="mb-6 p-4 bg-slate-900/40 rounded-xl space-y-4">
            {/* Compact row: Rounds + Difficulty + Mode */}
            <div className="flex gap-3">
              {/* Rounds */}
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('lobby.rounds')}</label>
                <div className="flex gap-1">
                  {[10, 15, 20].map((num) => (
                    <button
                      key={num}
                      onClick={() => setRounds(num)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-sm border transition-colors ${
                        rounds === num
                          ? 'bg-teal-600/30 border-teal-400 text-teal-200'
                          : 'bg-slate-800/60 border-slate-700 hover:bg-slate-700/60 text-slate-300'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty - hidden for movie/videogame mode */}
              {answerMode !== 'movie' && answerMode !== 'videogame' && (
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1">{t('lobby.difficulty')}</label>
                <div className="flex gap-1">
                  {[
                    { id: 1, name: t('lobby.difficultyShort.easy'), tooltipKey: 'easy' },
                    { id: 2, name: t('lobby.difficultyShort.medium'), tooltipKey: 'medium' },
                    { id: 3, name: t('lobby.difficultyShort.hard'), tooltipKey: 'hard' },
                  ].map((level) => (
                    <button
                      key={level.id}
                      onClick={() => setDifficulty(level.id)}
                      title={t(`lobby.difficultyTooltip.${level.tooltipKey}`)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-sm border transition-colors ${
                        difficulty === level.id
                          ? 'bg-teal-600/30 border-teal-400 text-teal-200'
                          : 'bg-slate-800/60 border-slate-700 hover:bg-slate-700/60 text-slate-300'
                      }`}
                    >
                      {level.name}
                    </button>
                  ))}
                </div>
              </div>
              )}
            </div>

            {/* Answer Mode Toggle */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{t('lobby.modeLabel')}</span>
              <div className="flex flex-1 bg-slate-900 rounded-lg p-0.5">
                <button
                  onClick={() => setAnswerMode('typed')}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    answerMode === 'typed'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('lobby.mode.typed')}
                </button>
                <button
                  onClick={() => setAnswerMode('mcq')}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    answerMode === 'mcq'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('lobby.mode.mcq')}
                </button>
                <button
                  onClick={() => setAnswerMode('movie')}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    answerMode === 'movie'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('lobby.mode.movie')}
                </button>
                <button
                  onClick={() => setAnswerMode('videogame')}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    answerMode === 'videogame'
                      ? 'bg-purple-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('lobby.mode.videogame')}
                </button>
              </div>
            </div>

            {/* Movie Mode Info */}
            {answerMode === 'movie' && (
              <div className="text-center p-4 bg-amber-900/20 rounded-xl border border-amber-600/30">
                <p className="text-amber-200 text-sm">{t('lobby.movieModeDescription')}</p>
              </div>
            )}

            {/* Videogame Mode Info */}
            {answerMode === 'videogame' && (
              <div className="text-center p-4 bg-purple-900/20 rounded-xl border border-purple-600/30">
                <p className="text-purple-200 text-sm">{t('lobby.videogameModeDescription')}</p>
              </div>
            )}

            {/* Category Selector - hidden for movie/videogame mode */}
            {answerMode !== 'movie' && answerMode !== 'videogame' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-400">
                  {t('lobby.categoriesLabel')} <span className="text-teal-300">({selectedCategories.length})</span>
                </label>
                <button
                  onClick={() => setShowImport(!showImport)}
                  className="text-xs px-2 py-0.5 rounded-sm bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50 transition-colors"
                >
                  {t('lobby.import')}
                </button>
              </div>

              {/* Import Playlist Form */}
              {showImport && (
                <div className="mb-2 p-2 bg-slate-900 rounded-lg border border-slate-700">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder={t('lobby.importPlaceholder')}
                      className="flex-1 px-2 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-sm text-white placeholder-slate-500 focus:outline-hidden focus:border-teal-500"
                    />
                    <button
                      onClick={handleImportPlaylist}
                      disabled={importLoading || !importUrl.trim()}
                      className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-sm hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {importLoading ? '...' : t('buttons.add')}
                    </button>
                  </div>
                  {importError && (
                    <p className="text-xs text-rose-400 mt-1">{importError}</p>
                  )}
                </div>
              )}

              {/* Grid of chips/tags */}
              <div className="max-h-48 overflow-y-auto bg-slate-900 rounded-lg border border-slate-700 p-2">
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((category, index) => (
                    <button
                      key={category.id}
                      onClick={() => toggleCategory(category.id)}
                      className={`group relative px-2.5 py-1 rounded-full text-xs font-medium transition-all animate-fade-up ${
                        selectedCategories.includes(category.id)
                          ? 'bg-teal-600 text-white ring-1 ring-teal-400'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                      } ${category.imported ? 'pr-6' : ''}`}
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      {category.name}
                      {category.imported && (
                        <span
                          onClick={(e) => handleDeletePlaylist(category.id, e)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 hover:text-rose-300 transition-opacity"
                          title={t('buttons.delete')}
                        >
                          ×
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {categories.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-2">{t('lobby.noCategories')}</p>
                )}
              </div>
            </div>
            )}
          </div>
        )}

        {!isHost && (
          <div className="mb-6 p-4 bg-slate-900/40 rounded-xl space-y-3">
            <p className="text-center text-slate-400 text-sm">{t('lobby.waitingForHost')}</p>
            {roomSettings && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('lobby.rounds')}</span>
                  <span className="text-slate-300">{roomSettings.totalRounds}</span>
                </div>
                {roomSettings.answerMode !== 'movie' && roomSettings.answerMode !== 'videogame' && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('lobby.difficulty')}</span>
                  <span className="text-slate-300">
                    {roomSettings.difficulty === 1
                      ? t('lobby.difficultyLabel.easy')
                      : roomSettings.difficulty === 2
                      ? t('lobby.difficultyLabel.medium')
                      : t('lobby.difficultyLabel.hard')}
                  </span>
                </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('lobby.modeLabel')}</span>
                  <span className="text-slate-300">
                    {roomSettings.answerMode === 'typed'
                      ? t('lobby.mode.typed')
                      : roomSettings.answerMode === 'movie'
                      ? t('lobby.mode.movie')
                      : roomSettings.answerMode === 'videogame'
                      ? t('lobby.mode.videogame')
                      : t('lobby.mode.mcq')}
                  </span>
                </div>
                {roomSettings.answerMode !== 'movie' && roomSettings.answerMode !== 'videogame' && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('lobby.categoriesLabel')}</span>
                  <span className="text-slate-300 text-right max-w-[60%]">
                    {roomSettings.categoryIds?.map(id =>
                      categories.find(c => c.id === id)?.name || id
                    ).join(', ') || '-'}
                  </span>
                </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {isHost ? (
            <div>
              {startWarning && (
                <p className="text-rose-400 text-sm text-center mb-2 animate-pulse">
                  {t('lobby.selectCategoryWarning')}
                </p>
              )}
              <button
                onClick={handleStartGame}
                className="btn-primary w-full text-lg"
                disabled={players.length < 1}
              >
                {t('buttons.startGame')}
              </button>
            </div>
          ) : null}
          {!isHost && (
            <button
              onClick={switchRole}
              className="w-full px-4 py-2 rounded-xl text-sm bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors"
            >
              {isSpectator ? t('buttons.switchToPlayer') : t('buttons.switchToSpectator')}
            </button>
          )}
          <button onClick={leaveGame} className="btn-secondary w-full">
            {t('buttons.leaveRoom')}
          </button>
        </div>
      </div>
    </div>
  );
}
