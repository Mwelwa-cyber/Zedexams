import { useEffect } from 'react'
import { renderText } from '../../../utils/mathRender'

/**
 * Full-screen study overlay for a flashcard deck.
 *
 * Props:
 *   cards         — card objects array
 *   index         — current card index (controlled)
 *   isFlipped     — whether the answer side is showing (controlled)
 *   masteredCards — Set<number> of mastered card indices
 *   onPrev        — () => void
 *   onNext        — () => void
 *   onFlip        — () => void
 *   onClose       — () => void
 *   onMarkMastered — (index) => void
 *   onMarkReview   — (index) => void
 */
export default function FlashcardStudyOverlay({
  cards,
  index,
  isFlipped,
  masteredCards,
  onPrev,
  onNext,
  onFlip,
  onClose,
  onMarkMastered,
  onMarkReview,
}) {
  const card = cards[index]
  const total = cards.length
  const mastered = masteredCards?.size ?? 0
  const isMastered = masteredCards?.has(index)
  const isFirst = index === 0
  const isLast = index === total - 1

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onFlip() }
      else if (e.key === 'ArrowRight') onNext()
      else if (e.key === 'ArrowLeft') onPrev()
      else if (e.key === 'Escape') onClose()
      else if (e.key === 'g' || e.key === 'G') { if (isFlipped) onMarkMastered(index) }
      else if (e.key === 'r' || e.key === 'R') { if (isFlipped) onMarkReview(index) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFlip, onNext, onPrev, onClose, onMarkMastered, onMarkReview, index, isFlipped])

  if (!card) return null

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-2xl flex items-center justify-between mb-4 text-white/80 text-sm">
        <div className="flex items-center gap-3">
          <span>
            Card <span className="font-black">{index + 1}</span> of {total}
          </span>
          {mastered > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300">
              {mastered}/{total} mastered
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded-lg text-sm font-bold bg-white/10 hover:bg-white/20 transition"
        >
          Close (Esc)
        </button>
      </div>

      {/* Card */}
      <button
        type="button"
        onClick={onFlip}
        className="w-full max-w-2xl min-h-[280px] rounded-3xl border-4 p-8 text-left transition-all"
        style={
          isMastered
            ? { background: '#f0fdf4', borderColor: '#22c55e' }
            : isFlipped
            ? { background: '#fff5e6', borderColor: '#d97757' }
            : { background: '#ffffff', borderColor: '#0e2a32' }
        }
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">
            {isFlipped ? 'Answer' : 'Question'} · {card.category}
          </span>
          {isMastered && (
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              ✓ Mastered
            </span>
          )}
        </div>
        {!isFlipped ? (
          <p className="text-2xl sm:text-3xl font-black text-slate-900 leading-snug">
            {renderText(card.front)}
          </p>
        ) : (
          <div>
            <p className="text-xl sm:text-2xl text-slate-900 leading-snug">
              {renderText(card.back)}
            </p>
            {card.example && (
              <p className="mt-4 text-slate-600 italic">
                Example: {renderText(card.example)}
              </p>
            )}
            {card.hint && (
              <p className="mt-2 text-slate-600 italic">
                💡 {renderText(card.hint)}
              </p>
            )}
          </div>
        )}
      </button>

      {/* Controls */}
      <div className="mt-5 flex items-center gap-2 flex-wrap justify-center">
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="px-4 py-2.5 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          ← Prev
        </button>

        <button
          onClick={onFlip}
          className="px-5 py-2.5 rounded-xl font-black text-slate-900 bg-white hover:bg-slate-100 text-sm"
        >
          {isFlipped ? 'Show question' : 'Show answer'} (Space)
        </button>

        {isFlipped && (
          <>
            {isMastered ? (
              <button
                onClick={() => onMarkReview(index)}
                className="px-4 py-2.5 rounded-xl font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 text-sm transition"
              >
                ↺ Review again (R)
              </button>
            ) : (
              <button
                onClick={() => onMarkMastered(index)}
                className="px-4 py-2.5 rounded-xl font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 text-sm transition"
              >
                ✓ Got it (G)
              </button>
            )}
          </>
        )}

        <button
          onClick={onNext}
          disabled={isLast}
          className="px-4 py-2.5 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          Next →
        </button>
      </div>

      {/* Progress dots */}
      {total <= 30 && (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5 max-w-lg">
          {cards.map((_, i) => (
            <button
              key={i}
              onClick={() => { onNext(); }}
              aria-label={`Card ${i + 1}`}
              className={[
                'w-3 h-3 rounded-full transition-all',
                i === index
                  ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent'
                  : '',
                masteredCards?.has(i)
                  ? 'bg-emerald-400'
                  : 'bg-white/30',
              ].join(' ')}
            />
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-white/50">
        Space to flip · ← → to navigate · G = got it · R = review again · Esc to close
      </p>
    </div>
  )
}
