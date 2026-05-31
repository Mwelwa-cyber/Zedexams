/**
 * BulkAnswerKey — compact grid + paste box for setting every MCQ answer at
 * once, the way an admin reads off an ECZ marking key. Purely presentational:
 * the parent owns the questions list and the apply callbacks.
 *
 * Props:
 *   questions  — from collectAnswerableQuestions(sections)
 *   onSetOne(localId, index|'')        — set/clear a single answer
 *   onApplyMany({ localId: index })    — apply a parsed paste in one pass
 *   onSuggest()                        — (optional) ask AI to fill blank answers
 *   suggesting                         — (optional) AI request in flight
 */

import { useState } from 'react'
import { ANSWER_LETTERS, parseAnswerKey, countUnansweredQuestions } from './answerKeyUtils'

export default function BulkAnswerKey({ questions = [], onSetOne, onApplyMany, onSuggest, suggesting = false }) {
  const [pasteText, setPasteText] = useState('')
  const [pasteNote, setPasteNote] = useState('')

  const unanswered = countUnansweredQuestions(questions)

  if (!questions.length) {
    return (
      <p className="theme-text text-sm font-bold leading-relaxed">
        No multiple-choice questions to set answers for yet. Import or add questions first.
      </p>
    )
  }

  function handleApplyPaste() {
    const map = parseAnswerKey(pasteText, questions)
    const count = Object.keys(map).length
    if (!count) {
      setPasteNote('Could not read any answers from that text. Use letters like “A C B D…” or numbered like “1A 2C 3B”.')
      return
    }
    onApplyMany?.(map)
    setPasteNote(`Applied ${count} answer${count === 1 ? '' : 's'}.`)
    setPasteText('')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="theme-text text-sm font-bold leading-relaxed">
          Tap a letter to set each answer, or paste the whole key below.
        </p>
        <div className="flex items-center gap-2">
          {onSuggest && (
            <button
              type="button"
              onClick={onSuggest}
              disabled={suggesting || !unanswered}
              title={unanswered ? 'Let AI work out the blank answers (verify before publishing)' : 'All answers are already set'}
              className="rounded-lg border border-purple-300 bg-purple-50 px-2.5 py-1 text-xs font-black text-purple-800 transition-colors hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {suggesting ? 'Thinking…' : '✨ Suggest with AI'}
            </button>
          )}
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
            unanswered ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-900'
          }`}>
            {unanswered ? `${unanswered} unanswered` : 'All answered'}
          </span>
        </div>
      </div>

      {/* Answer grid */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {questions.map(q => (
          <div
            key={q.localId}
            className="theme-card theme-border flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
          >
            <span className="theme-text-muted w-8 shrink-0 text-right text-xs font-black tabular-nums">
              {q.number}.
            </span>
            <div className="flex flex-wrap gap-1">
              {ANSWER_LETTERS.slice(0, q.optionCount).map((letter, index) => {
                const selected = q.correctIndex === index
                return (
                  <button
                    key={letter}
                    type="button"
                    aria-pressed={selected}
                    title={`Question ${q.number} — option ${letter}`}
                    onClick={() => onSetOne?.(q.localId, selected ? '' : index)}
                    className={`h-7 w-7 rounded-md text-xs font-black transition-colors ${
                      selected
                        ? 'theme-accent-fill theme-on-accent'
                        : 'theme-border border theme-text hover:bg-black/5'
                    }`}
                  >
                    {letter}
                  </button>
                )
              })}
            </div>
            {q.hasImageOptions && (
              <span className="theme-text-muted ml-auto text-[10px] font-bold" title="This question's options are pictures">
                🖼️
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Paste box */}
      <div className="theme-card theme-border rounded-xl border p-3">
        <label className="theme-accent-text text-xs font-black uppercase tracking-wide">
          Paste an answer key
        </label>
        <p className="theme-text mt-1 text-xs font-bold leading-relaxed">
          One letter per question in order (e.g. <code className="font-mono">A C B D A…</code>),
          or numbered (e.g. <code className="font-mono">1A 2C 3B</code>).
        </p>
        <textarea
          value={pasteText}
          onChange={event => { setPasteText(event.target.value); setPasteNote('') }}
          rows={2}
          placeholder="A C B D A C …"
          className="theme-border theme-text mt-2 w-full rounded-lg border bg-transparent px-3 py-2 text-sm font-bold"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleApplyPaste}
            disabled={!pasteText.trim()}
            className="theme-accent-fill theme-on-accent rounded-lg px-3 py-1.5 text-xs font-black disabled:opacity-50"
          >
            Apply key
          </button>
          {pasteNote && <span className="theme-text text-xs font-bold">{pasteNote}</span>}
        </div>
      </div>
    </div>
  )
}
