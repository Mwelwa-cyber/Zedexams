/**
 * Read-only rendering of a flashcard set as an interactive grid.
 * Click a card to flip it. Shared by the Flashcard Generator and the Library.
 */

import { useState } from 'react'

export default function FlashcardsView({ flashcards }) {
  const cards = flashcards?.cards || []
  const [flipped, setFlipped] = useState({})

  if (cards.length === 0) return null

  const toggle = (i) => setFlipped((f) => ({ ...f, [i]: !f[i] }))

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {cards.map((card, i) => (
        <button
          key={i}
          type="button"
          onClick={() => toggle(i)}
          className={`text-left rounded-2xl border-2 p-4 min-h-[140px] transition-all ${
            flipped[i]
              ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-300'
              : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-300'
          } hover:-translate-y-0.5 hover:shadow-md`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
              Card {i + 1} · {card.category}
            </span>
            <span className="text-[10px] text-slate-500">click to flip</span>
          </div>
          {!flipped[i] ? (
            <p className="theme-text font-bold">{card.front}</p>
          ) : (
            <div>
              <p className="theme-text text-sm">{card.back}</p>
              {card.example && (
                <p className="text-xs text-slate-600 italic mt-2">e.g. {card.example}</p>
              )}
              {card.hint && (
                <p className="text-xs text-slate-600 italic mt-1">💡 {card.hint}</p>
              )}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
