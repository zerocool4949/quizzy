import { useI18n } from '../../i18n'

export default function TypedAnswers({
  typedInput,
  setTypedInput,
  artistCorrect,
  titleCorrect,
  lives,
  totalPoints,
  submitTypedAnswer
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      {/* Status indicators for artist and title */}
      <div className="flex justify-center gap-4 mb-2">
        <div className={`px-3 py-1 rounded-full text-sm ${
          artistCorrect ? 'bg-emerald-600/30 text-emerald-300' : 'bg-slate-800 text-slate-400'
        }`}>
          {t('game.artistLabel')} {artistCorrect ? t('game.status.ok') : t('game.status.pending')}
        </div>
        <div className={`px-3 py-1 rounded-full text-sm ${
          titleCorrect ? 'bg-emerald-600/30 text-emerald-300' : 'bg-slate-800 text-slate-400'
        }`}>
          {t('game.titleLabel')} {titleCorrect ? t('game.status.ok') : t('game.status.pending')}
        </div>
      </div>

      {/* Lives display */}
      {!(artistCorrect && titleCorrect) && lives > 0 && (
        <div className="flex justify-center gap-2 mb-2">
          {Array.from({ length: Math.max(lives, 0) }).map((_, i) => (
            <svg
              key={i}
              className={`w-6 h-6 transition-all ${
                i < lives ? 'text-rose-400' : 'text-slate-700'
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                clipRule="evenodd"
              />
            </svg>
          ))}
        </div>
      )}

      {/* Points earned so far */}
      {totalPoints > 0 && (
        <div className="text-center text-emerald-300 text-sm">
          {t('game.pointsPlus', { points: totalPoints })}
        </div>
      )}

      {/* Single input for artist or title */}
      {!(artistCorrect && titleCorrect) && lives > 0 && (
        <div>
          <label className="block text-sm text-slate-400 mb-2">
            {!artistCorrect && !titleCorrect && t('game.typeArtistOrTitle')}
            {artistCorrect && !titleCorrect && t('game.nowGuessTitle')}
            {!artistCorrect && titleCorrect && t('game.nowGuessArtist')}
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!typedInput.trim()) return
              submitTypedAnswer(null, typedInput.trim())
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder={t('game.typeYourAnswer')}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-hidden focus:border-teal-400"
              autoFocus
            />
            <button
              type="submit"
              disabled={!typedInput.trim()}
              className="btn-primary px-6"
            >
              {t('buttons.submit')}
            </button>
          </form>
        </div>
      )}

      {/* Done - both correct or out of lives */}
      {(artistCorrect && titleCorrect) && (
        <div className="text-center">
          <div className="p-4 rounded-xl bg-emerald-600/20">
            <p className="text-lg font-bold">{t('game.perfect')}</p>
            <p className="text-emerald-300">{t('game.pointsPlus', { points: totalPoints })}</p>
          </div>
        </div>
      )}

      {lives === 0 && !(artistCorrect && titleCorrect) && (
        <div className="text-center">
          <div className="p-4 rounded-xl bg-rose-600/20">
            <p className="text-lg font-bold">{t('game.outOfLives')}</p>
            {totalPoints > 0 && (
              <p className="text-emerald-300">{t('game.pointsPlus', { points: totalPoints })}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
