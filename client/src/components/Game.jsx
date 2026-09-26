import { useEffect, useRef, useState } from 'react'
import { useGame } from '../context/GameContext'
import LanguageSwitcher from './LanguageSwitcher'
import { useI18n } from '../i18n'
import {
  GameLoading,
  GameCountdown,
  GameFinished,
  RoundResults,
  LiveScoreboard,
  MCQAnswers,
  TypedAnswers,
  MovieAnswers,
  VideogameAnswers
} from './game/index.js'

export default function Game() {
  const {
    gameState,
    currentRound,
    roundResults,
    gameResults,
    myAnswer,
    answerResult,
    loadingProgress,
    submitAnswer,
    submitTypedAnswer,
    playAgain,
    leaveGame,
    isHost,
    isSpectator,
    players,
  } = useGame()
  const { t } = useI18n()

  const audioRef = useRef(null)
  const volumeRef = useRef(0.7)
  const audioTimeoutRef = useRef(null)
  const [timeLeft, setTimeLeft] = useState(10)
  const [songProgress, setSongProgress] = useState(0)
  const [countdown, setCountdown] = useState(3)

  // Typed mode state
  const [typedInput, setTypedInput] = useState('')
  const [artistCorrect, setArtistCorrect] = useState(false)
  const [titleCorrect, setTitleCorrect] = useState(false)
  const [movieCorrect, setMovieCorrect] = useState(false)
  const [videogameCorrect, setVideogameCorrect] = useState(false)
  const [lives, setLives] = useState(null)
  const [totalPoints, setTotalPoints] = useState(0)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('quizzy-volume')
    const vol = saved ? parseFloat(saved) : 0.7
    volumeRef.current = vol
    return vol
  })
  const clipDuration = currentRound?.clipDuration || 10

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value)
    setVolume(newVolume)
    volumeRef.current = newVolume
    localStorage.setItem('quizzy-volume', newVolume.toString())
    if (audioRef.current) {
      audioRef.current.volume = newVolume
    }
  }

  // Countdown timer for "Get Ready" screen
  useEffect(() => {
    if (gameState === 'countdown') {
      setCountdown(3)
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 1
          }
          return prev - 1
        })
      }, 1000)
      return () => clearInterval(timer)
    }
  }, [gameState])

  // Reset typed mode state when new round starts
  useEffect(() => {
    if (gameState === 'playing') {
      setTypedInput('')
      setArtistCorrect(false)
      setTitleCorrect(false)
      setMovieCorrect(false)
      setVideogameCorrect(false)
      setLives(currentRound?.startingLives ?? null)
      setTotalPoints(0)
    }
  }, [gameState, currentRound?.roundNumber])

  // Handle typed answer results
  useEffect(() => {
    if (answerResult?.mode === 'typed') {
      if (typeof answerResult.livesLeft === 'number') setLives(answerResult.livesLeft)
      if (typeof answerResult.artistCorrect === 'boolean') setArtistCorrect(answerResult.artistCorrect)
      if (typeof answerResult.titleCorrect === 'boolean') setTitleCorrect(answerResult.titleCorrect)
      if (typeof answerResult.points === 'number') setTotalPoints(answerResult.points)
      setTypedInput('')
    }
    if (answerResult?.mode === 'movie') {
      if (typeof answerResult.livesLeft === 'number') setLives(answerResult.livesLeft)
      if (typeof answerResult.movieCorrect === 'boolean') setMovieCorrect(answerResult.movieCorrect)
      if (typeof answerResult.points === 'number') setTotalPoints(answerResult.points)
      setTypedInput('')
    }
    if (answerResult?.mode === 'videogame') {
      if (typeof answerResult.livesLeft === 'number') setLives(answerResult.livesLeft)
      if (typeof answerResult.videogameCorrect === 'boolean') setVideogameCorrect(answerResult.videogameCorrect)
      if (typeof answerResult.points === 'number') setTotalPoints(answerResult.points)
      setTypedInput('')
    }
  }, [answerResult])

  // Play audio when new round starts
  useEffect(() => {
    if (audioTimeoutRef.current) {
      clearTimeout(audioTimeoutRef.current)
      audioTimeoutRef.current = null
    }

    if (gameState === 'playing' && currentRound?.previewUrl) {
      const duration = currentRound.clipDuration || 10
      const answerTime = currentRound.answerTime || 5
      setTimeLeft(duration + answerTime)
      setSongProgress(0)
      if (audioRef.current) {
        audioRef.current.src = currentRound.previewUrl
        audioRef.current.volume = volumeRef.current
        audioRef.current.play().catch(() => {})

        audioTimeoutRef.current = setTimeout(() => {
          if (audioRef.current) audioRef.current.pause()
        }, duration * 1000)
      }
    }

    return () => {
      if (audioTimeoutRef.current) clearTimeout(audioTimeoutRef.current)
    }
  }, [gameState, currentRound])

  // Song progress tracker
  useEffect(() => {
    if (gameState !== 'playing') return

    const duration = currentRound?.clipDuration || 10
    const startTime = Date.now()

    const progressTimer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000
      const progress = Math.min((elapsed / duration) * 100, 100)
      setSongProgress(progress)
      if (progress >= 100) clearInterval(progressTimer)
    }, 50)

    return () => clearInterval(progressTimer)
  }, [gameState, currentRound])

  // Countdown timer
  useEffect(() => {
    if (gameState !== 'playing') return

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [gameState, currentRound])

  // Stop audio when round ends
  useEffect(() => {
    if (gameState === 'roundEnd' && audioRef.current) {
      audioRef.current.pause()
    }
  }, [gameState])

  // Render different screens based on game state
  if (gameState === 'loading') {
    return <GameLoading loadingProgress={loadingProgress} />
  }

  if (gameState === 'countdown') {
    return <GameCountdown countdown={countdown} />
  }

  if (gameState === 'finished' && gameResults) {
    return (
      <GameFinished
        gameResults={gameResults}
        isHost={isHost}
        playAgain={playAgain}
        leaveGame={leaveGame}
      />
    )
  }

  if (gameState === 'roundEnd' && roundResults) {
    return (
      <RoundResults
        roundResults={roundResults}
        answerResult={answerResult}
        isSpectator={isSpectator}
      />
    )
  }

  // Playing state
  return (
    <div className="min-h-screen flex flex-col items-center p-4 relative">
      <LanguageSwitcher />
      <audio ref={audioRef} />

      <div className="w-full max-w-4xl mx-auto">
        {/* Round progression bar */}
        <div className="w-full mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-slate-400">{t('game.roundProgress')}</span>
            <span className="text-sm text-slate-400">
              {t('game.roundOf', { current: currentRound?.roundNumber, total: currentRound?.totalRounds })}
            </span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: currentRound?.totalRounds || 10 }).map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-all ${
                  i < (currentRound?.roundNumber || 1) - 1
                    ? 'bg-emerald-400'
                    : i === (currentRound?.roundNumber || 1) - 1
                    ? 'bg-teal-400'
                    : 'bg-slate-700'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full">
          {/* Main game card */}
          <div className="card flex-1 md:max-w-lg animate-fade-up">
            {/* Timer */}
            <div className="text-center mb-6">
              <div
                className={`text-6xl font-bold tabular-nums ${
                  timeLeft <= 5 ? 'text-rose-400 animate-pulse' : 'text-teal-300'
                }`}
              >
                {timeLeft}
              </div>
              <span className="text-slate-400 text-sm">{t('game.secondsLeft')}</span>
            </div>

            {/* Song progress bar */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-slate-400">
                  {songProgress < 100 ? t('game.playing') : t('game.songEnded')}
                </span>
                <span className="text-xs text-slate-400">{t('game.clip', { seconds: clipDuration })}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-100 ${
                    songProgress >= 100 ? 'bg-slate-500' : 'bg-teal-500'
                  }`}
                  style={{ width: `${songProgress}%` }}
                />
              </div>
            </div>

            {/* Audio visualization */}
            <div className="flex flex-col items-center mb-6">
              <div className="w-20 h-20 bg-teal-600/30 rounded-full flex items-center justify-center mb-3">
                <div className={`w-14 h-14 bg-teal-500/40 rounded-full flex items-center justify-center ${songProgress < 100 ? 'animate-pulse' : ''}`}>
                  <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                  </svg>
                </div>
              </div>
              {/* Volume slider */}
              <div className="flex items-center gap-2 w-36">
                <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" clipRule="evenodd" />
                </svg>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="flex-1 h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-teal-400"
                />
                <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
              </div>
            </div>

            <p className="text-center text-slate-300 mb-4">
              {currentRound?.answerMode === 'movie' ? t('game.movieQuestion') : currentRound?.answerMode === 'videogame' ? t('game.videogameQuestion') : t('game.question')}
            </p>

            {/* Spectator indicator */}
            {isSpectator && (
              <div className="text-center p-4 rounded-xl bg-slate-800/60 border border-slate-600">
                <p className="text-slate-300">{t('game.spectating')}</p>
              </div>
            )}

            {/* Answer inputs based on mode */}
            {!isSpectator && currentRound?.answerMode === 'mcq' && (
              <MCQAnswers
                options={currentRound?.options}
                myAnswer={myAnswer}
                answerResult={answerResult}
                submitAnswer={submitAnswer}
              />
            )}

            {!isSpectator && currentRound?.answerMode === 'movie' && (
              <MovieAnswers
                typedInput={typedInput}
                setTypedInput={setTypedInput}
                movieCorrect={movieCorrect}
                lives={lives}
                totalPoints={totalPoints}
                submitTypedAnswer={submitTypedAnswer}
              />
            )}

            {!isSpectator && currentRound?.answerMode === 'videogame' && (
              <VideogameAnswers
                typedInput={typedInput}
                setTypedInput={setTypedInput}
                videogameCorrect={videogameCorrect}
                lives={lives}
                totalPoints={totalPoints}
                submitTypedAnswer={submitTypedAnswer}
              />
            )}

            {!isSpectator && currentRound?.answerMode === 'typed' && (
              <TypedAnswers
                typedInput={typedInput}
                setTypedInput={setTypedInput}
                artistCorrect={artistCorrect}
                titleCorrect={titleCorrect}
                lives={lives}
                totalPoints={totalPoints}
                submitTypedAnswer={submitTypedAnswer}
              />
            )}

            {myAnswer && !answerResult && currentRound?.answerMode !== 'typed' && (
              <p className="text-center text-slate-400 mt-4">{t('game.waitingForPlayers')}</p>
            )}
          </div>

          {/* Live Scoreboard */}
          <LiveScoreboard players={players} leaveGame={leaveGame} />
        </div>
      </div>
    </div>
  )
}
