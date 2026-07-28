/**
 * Read-only rendering of a flashcard set as an interactive grid.
 * Click a card to flip it. Shared by the Flashcard Generator and the Library.
 *
 * Props:
 *   flashcards    — the deck object { cards: [], header: {} }
 *   masteredCards — optional Set<number> of mastered card indices (for badges)
 *   onStudy       — optional () => void; when provided, renders a Study button
 */

import { useState } from 'react'
import { renderText } from '../../../utils/mathRender'

export default function FlashcardsView({ flashcards, masteredCards, onStudy }) {
  const cards = flashcards?.cards || []
  const [flipped, setFlipped] = useState({})

  if (cards.length === 0) return null

  const toggle = (i) => setFlipped((f) => ({ ...f, [i]: !f[i] }))
  const masteredCount = masteredCards?.size ?? 0

  return (
    <div>
      {/* Progress bar + Study button */}
      {(onStudy || masteredCount > 0) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          {masteredCount > 0 ? (
            <div className="flex items-center gap-2 text-sm">
              <div className="h-2 w-32 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round((masteredCount / cards.length) * 100)}%` }}
                />
              </div>
              <span className="text-slate-600 font-medium">
                {masteredCount}/{cards.length} mastered
              </span>
            </div>
          ) : (
            <span className="text-sm text-slate-500">{cards.length} cards</span>
          )}
          {onStudy && (
            <button
              type="button"
              onClick={onStudy}
              className="studio-btn-primary text-sm px-4 py-2"
            >
              ▶ Study
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map((card, i) => {
          const isMastered = masteredCards?.has(i)
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className="text-left rounded-2xl border-2 p-4 min-h-[140px] transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={
                isMastered
                  ? { background: '#f0fdf4', borderColor: '#22c55e' }
                  : flipped[i]
                  ? { background: '#fff5e6', borderColor: '#d97757' }
                  : { background: '#ffffff', borderColor: '#0e2a32' }
              }
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Card {i + 1} · {card.category}
                </span>
                {isMastered ? (
                  <span className="text-[10px] font-bold text-emerald-600">✓ mastered</span>
                ) : (
                  <span className="text-[10px] text-slate-500">click to flip</span>
                )}
              </div>
              {!flipped[i] ? (
                <p className="theme-text font-bold">{renderText(card.front)}</p>
              ) : (
                <div>
                  <p className="theme-text text-sm">{renderText(card.back)}</p>
                  {card.example && (
                    <p className="text-xs text-slate-600 italic mt-2">e.g. {renderText(card.example)}</p>
                  )}
                  {card.hint && (
                    <p className="text-xs text-slate-600 italic mt-1">💡 {renderText(card.hint)}</p>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
