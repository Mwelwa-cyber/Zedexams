/**
 * QuestionAiAssistant — the "✨ AI" button mounted on every question card in
 * the quiz editor.
 *
 * Flow:
 *   1. Teacher clicks ✨ AI → a small menu of actions appears
 *      (Simplify / Make easier / Make harder / Rephrase / Suggest answer /
 *       Write explanation). The action list is tailored to the question type.
 *   2. Picking an action sends the question (as plain text) + its options +
 *      the correct-answer letter to the `editQuizQuestion` callable.
 *   3. The model's patch is shown in a preview modal — nothing is changed
 *      until the teacher clicks "Apply". This keeps the teacher in control:
 *      the AI suggests, the teacher decides.
 *   4. On Apply, the patch is converted from import markup into editor
 *      node-HTML (so any \frac / $…$ / table renders as a real node, reusing
 *      the import pipeline) and handed to `onApply`.
 *
 * Props
 *   question  — the question object ({ text, options, correctAnswer, type })
 *   subject   — quiz subject (for grade/subject-appropriate edits)
 *   grade     — quiz grade
 *   onApply   — function(editorPatch) where editorPatch may contain
 *               { text, options, correctAnswer, explanation } in editor format
 */

import { useEffect, useRef, useState } from 'react'
import { getRichPlainText } from '../../editor/RichContent.jsx'
import { importMarkupToRichHtml, importMarkupToOptionHtml } from './importRichText.js'
import { aiEditQuizQuestion } from '../../utils/aiAssistant'

// action key → { label, hint, supports(type) }. `supports` hides actions that
// can't apply to a question type (e.g. "Suggest answer" needs option choices).
const ACTIONS = [
  { key: 'simplify', label: 'Simplify', hint: 'Easier wording, same idea', supports: () => true },
  { key: 'easier', label: 'Make easier', hint: 'Lower the difficulty', supports: (t) => t === 'mcq' || t === 'truefalse' },
  { key: 'harder', label: 'Make harder', hint: 'Raise the difficulty', supports: (t) => t === 'mcq' || t === 'truefalse' },
  { key: 'rephrase', label: 'Rephrase', hint: 'Clearer phrasing, same meaning', supports: () => true },
  { key: 'suggest_answer', label: 'Suggest answer', hint: 'Work out the correct option', supports: (t) => t === 'mcq' || t === 'truefalse' },
  { key: 'explain', label: 'Write explanation', hint: 'A short answer explanation', supports: () => true },
]

function letterToIndex(value) {
  const s = String(value ?? '').trim().toUpperCase()
  if (/^[A-Z]$/.test(s)) return s.charCodeAt(0) - 65
  const n = Number(s)
  return Number.isInteger(n) ? n : null
}

function optionPlainText(opt) {
  if (opt == null) return ''
  if (typeof opt === 'string') {
    // Option strings may be HTML or Tiptap-JSON-as-string; getRichPlainText
    // handles both, and returns plain strings unchanged.
    return getRichPlainText(opt)
  }
  return getRichPlainText(opt)
}

export default function QuestionAiAssistant({ question, subject, grade, onApply }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [loadingAction, setLoadingAction] = useState(null)
  const [error, setError] = useState('')
  // preview = { action, raw } where raw is the model patch (markup strings).
  const [preview, setPreview] = useState(null)
  const rootRef = useRef(null)

  const type = question?.type || 'mcq'
  const actions = ACTIONS.filter((a) => a.supports(type))

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  async function runAction(action) {
    setMenuOpen(false)
    setError('')
    setLoadingAction(action)
    try {
      const options = Array.isArray(question?.options)
        ? question.options.map(optionPlainText)
        : []
      const correctLetter =
        typeof question?.correctAnswer === 'number' && options.length
          ? String.fromCharCode(65 + question.correctAnswer)
          : ''
      const { patch } = await aiEditQuizQuestion({
        action,
        question: getRichPlainText(question?.text) || '',
        options,
        correctAnswer: correctLetter,
        subject: subject || '',
        grade: grade || '',
        topic: question?.topic || '',
      })
      if (!patch || !Object.keys(patch).length) {
        setError('The AI did not suggest any changes.')
        return
      }
      setPreview({ action, raw: patch })
    } catch (err) {
      setError(err?.message || 'The AI editor is unavailable right now.')
    } finally {
      setLoadingAction(null)
    }
  }

  // Convert the model's markup patch into an editor-ready patch and apply it.
  function applyPreview() {
    const raw = preview?.raw || {}
    const editorPatch = {}
    if (raw.text) editorPatch.text = importMarkupToRichHtml(raw.text)
    // Only rewrite options for MCQ — True/False options are fixed, and
    // short-answer/numeric have none.
    if (Array.isArray(raw.options) && type === 'mcq') {
      editorPatch.options = raw.options.map(importMarkupToOptionHtml)
    }
    if (raw.correctAnswer != null && (type === 'mcq' || type === 'truefalse')) {
      const idx = letterToIndex(raw.correctAnswer)
      if (idx != null && idx >= 0) editorPatch.correctAnswer = idx
    }
    if (raw.explanation) editorPatch.explanation = importMarkupToRichHtml(raw.explanation)
    if (Object.keys(editorPatch).length) onApply(editorPatch)
    setPreview(null)
  }

  const busy = Boolean(loadingAction)

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => { setError(''); setMenuOpen((o) => !o) }}
        disabled={busy}
        title="Improve this question with AI"
        className="inline-flex items-center gap-1 rounded-lg border theme-border px-2 py-1 text-xs font-bold theme-text hover:theme-bg-subtle disabled:opacity-60"
      >
        <span aria-hidden="true">✨</span>
        <span>{busy ? 'Thinking…' : 'AI'}</span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-xl border theme-border theme-card shadow-lg"
        >
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              onClick={() => runAction(a.key)}
              className="block w-full px-3 py-2 text-left text-xs hover:theme-bg-subtle"
            >
              <span className="block font-bold theme-text">{a.label}</span>
              <span className="block theme-text-muted">{a.hint}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-800 shadow-lg">
          {error}
        </div>
      )}

      {preview && (
        <AiEditPreview
          action={preview.action}
          raw={preview.raw}
          question={question}
          onCancel={() => setPreview(null)}
          onApply={applyPreview}
        />
      )}
    </div>
  )
}

const ACTION_TITLE = {
  simplify: 'Simplified question',
  easier: 'Easier question',
  harder: 'Harder question',
  rephrase: 'Rephrased question',
  suggest_answer: 'Suggested answer',
  explain: 'Suggested explanation',
}

// Preview modal — shows what the AI proposes before anything changes. Renders
// the markup as plain text (with a tiny hint) so a teacher can read it without
// the editor; the real node rendering happens once applied.
function AiEditPreview({ action, raw, question, onCancel, onApply }) {
  const beforeText = getRichPlainText(question?.text) || ''
  const correctLetter = raw.correctAnswer != null ? String(raw.correctAnswer).trim().toUpperCase() : ''

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="theme-card theme-text w-full max-w-lg space-y-4 rounded-2xl border-2 theme-border p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black">✨ {ACTION_TITLE[action] || 'AI suggestion'}</h3>
          <button type="button" onClick={onCancel} className="theme-text-muted text-sm font-bold hover:opacity-70">✕</button>
        </div>

        {raw.note && (
          <p className="theme-bg-subtle rounded-lg px-3 py-2 text-xs theme-text-muted">{raw.note}</p>
        )}

        <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
          {raw.text && (
            <div className="space-y-1">
              <p className="text-xs font-bold theme-text-muted">Question</p>
              {beforeText && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-900 line-through decoration-rose-300">{beforeText}</p>
              )}
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 whitespace-pre-wrap">{raw.text}</p>
            </div>
          )}

          {Array.isArray(raw.options) && raw.options.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-bold theme-text-muted">Options</p>
              <ul className="space-y-1">
                {raw.options.map((opt, i) => (
                  <li
                    key={i}
                    className={`rounded-lg px-3 py-1.5 text-xs ${correctLetter === String.fromCharCode(65 + i) ? 'bg-emerald-100 font-bold text-emerald-900' : 'theme-bg-subtle'}`}
                  >
                    <span className="font-black">{String.fromCharCode(65 + i)}.</span> {opt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {correctLetter && !(Array.isArray(raw.options) && raw.options.length) && (
            <div className="space-y-1">
              <p className="text-xs font-bold theme-text-muted">Correct answer</p>
              <p className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-900">{correctLetter}</p>
            </div>
          )}

          {raw.explanation && (
            <div className="space-y-1">
              <p className="text-xs font-bold theme-text-muted">Explanation</p>
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 whitespace-pre-wrap">{raw.explanation}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border theme-border px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            className="theme-accent-fill theme-on-accent rounded-xl px-4 py-2 text-sm font-black shadow-sm hover:opacity-90"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
