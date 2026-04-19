/**
 * src/editor/QuizEditor.jsx
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE REPLACEMENT FOR YOUR CURRENT QUIZ EDITOR.      ║
 * ║                                                             ║
 * ║  In your codebase, find where you render your old editor    ║
 * ║  and replace it with this component.                        ║
 * ║                                                             ║
 * ║  BEFORE (remove):                                           ║
 * ║    import OldQuizEditor from './OldQuizEditor'              ║
 * ║    <OldQuizEditor question={q} onSave={save} />             ║
 * ║                                                             ║
 * ║  AFTER (add):                                               ║
 * ║    import QuizEditor from './editor/QuizEditor'             ║
 * ║    <QuizEditor question={q} onSave={save} />                ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Props:
 *   question   {object|null}    Existing question from DB, or null for new
 *   onSave     {function}       Called with the complete question object (Tiptap JSON)
 *   onCancel   {function}       Called when the teacher cancels
 *   className  {string}         Optional CSS class on the root element
 *
 * What "question" looks like going INTO this component (any format works):
 *   {
 *     id: 'q_123',                    // string
 *     type: 'mcq',                    // 'mcq' | 'tf' | 'short' | 'fill'
 *     topic: 'Fractions',             // string
 *     marks: 3,                       // number
 *     difficulty: 'medium',           // 'easy' | 'medium' | 'hard'
 *     instructions: null,             // Tiptap JSON | HTML string | null
 *     passage: null,                  // Tiptap JSON | HTML string | null
 *     questionText: "What is 3/4…?", // Tiptap JSON | HTML string | plain text
 *     explanation: null,              // Tiptap JSON | HTML string | null
 *     options: ['K 300', 'K 600'],    // string[]
 *     correct: 2,                     // number (index)
 *   }
 *
 * What "question" looks like coming OUT of onSave (always Tiptap JSON):
 *   {
 *     id: 'q_123',
 *     type: 'mcq',
 *     topic: 'Fractions',
 *     marks: 3,
 *     difficulty: 'medium',
 *     instructions: { type: 'doc', content: [...] },  // Tiptap JSON
 *     passage:      { type: 'doc', content: [...] },
 *     questionText: { type: 'doc', content: [...] },
 *     explanation:  { type: 'doc', content: [...] },
 *     options: ['K 300', 'K 600'],
 *     correct: 2,
 *     contentVersion: 2,
 *   }
 */

import { useState, useCallback } from 'react'
import RichEditor     from './components/RichEditor.jsx'
import AnswerOptions  from './components/AnswerOptions.jsx'
import QuizPreview    from './components/QuizPreview.jsx'
import { migrateQuestion } from './utils/migration.js'
import './editor.css'

const QUESTION_TYPES = [
  { v: 'mcq',   l: 'Multiple Choice' },
  { v: 'tf',    l: 'True / False' },
  { v: 'short', l: 'Short Answer' },
  { v: 'fill',  l: 'Fill in the Blank' },
]

const DIFFICULTIES = [
  { v: 'easy',   l: 'Easy' },
  { v: 'medium', l: 'Medium' },
  { v: 'hard',   l: 'Hard' },
]

// Generate a new question scaffold
function newQuestion() {
  return {
    id:           `q_${Date.now()}`,
    type:         'mcq',
    topic:        '',
    marks:        2,
    difficulty:   'medium',
    instructions: null,
    passage:      null,
    questionText: null,
    explanation:  null,
    options:      ['', '', '', ''],
    correct:      0,
    contentVersion: 2,
  }
}

export default function QuizEditor({ question = null, onSave, onCancel, className = '' }) {
  // ── State ─────────────────────────────────────────────────────
  // Migrate incoming question (handles all legacy formats safely)
  const [q, setQ] = useState(() =>
    question ? migrateQuestion(question) : newQuestion()
  )
  const [tab,   setTab]   = useState('editor')
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState('')

  // ── Field updater ─────────────────────────────────────────────
  const set = useCallback((key, value) => {
    setQ((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ── Save ──────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!q.questionText) {
      setToast('⚠ Please write the question text before saving.')
      setTimeout(() => setToast(''), 3000)
      return
    }
    const payload = { ...q, contentVersion: 2 }
    onSave?.(payload)
    setSaved(true)
    setToast('✓ Question saved')
    setTimeout(() => { setSaved(false); setToast('') }, 2500)
  }, [q, onSave])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className={`qe-page ${className}`}>
      <div className="qe-body">

        {/* Settings card — plain inputs, no rich editor */}
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Question Settings</span>
          </div>
          <div className="card-body">
            <div className="qe-row">
              <div className="qe-field" style={{ flex: 2 }}>
                <label className="qe-lbl">Topic / Strand</label>
                <input
                  className="qe-inp"
                  value={q.topic}
                  placeholder="e.g. Fractions, Algebra…"
                  onChange={(e) => set('topic', e.target.value)}
                />
              </div>
              <div className="qe-field">
                <label className="qe-lbl">Question Type</label>
                <select
                  className="qe-sel"
                  value={q.type}
                  onChange={(e) => set('type', e.target.value)}
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.v} value={t.v}>{t.l}</option>
                  ))}
                </select>
              </div>
              <div className="qe-field">
                <label className="qe-lbl">Difficulty</label>
                <select
                  className="qe-sel"
                  value={q.difficulty}
                  onChange={(e) => set('difficulty', e.target.value)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d.v} value={d.v}>{d.l}</option>
                  ))}
                </select>
              </div>
              <div className="qe-field">
                <label className="qe-lbl">
                  Marks<span className="rstar">*</span>
                </label>
                <input
                  className="qe-inp"
                  type="number"
                  min={1}
                  max={20}
                  value={q.marks}
                  onChange={(e) => set('marks', Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="qe-tabs">
          {[
            ['editor',  '✏️  Editor'],
            ['preview', '👁  Preview'],
          ].map(([v, l]) => (
            <button
              key={v}
              className={`qe-tab${tab === v ? ' on' : ''}`}
              onClick={() => setTab(v)}
            >
              {l}
            </button>
          ))}
        </div>

        {/* ── EDITOR TAB ── */}
        {tab === 'editor' && (
          <>
            {/* Instructions */}
            <div className="card">
              <div className="card-hd">
                <span className="card-title">📋 Instructions</span>
                <span className="cbadge bopt">Optional</span>
              </div>
              <div className="card-body">
                {/*
                 * KEY POINT: initialContent is passed only once (on mount).
                 * Subsequent updates from this field go through onChange → setQ.
                 * Do NOT pass q.instructions as initialContent on every render —
                 * that would re-create the editor and lose cursor position.
                 */}
                <RichEditor
                  initialContent={q.instructions}
                  onChange={(json) => set('instructions', json)}
                  placeholder="e.g. Read the passage carefully and answer the question that follows."
                  minHeight={60}
                />
              </div>
            </div>

            {/* Passage */}
            <div className="card">
              <div className="card-hd">
                <span className="card-title">📖 Passage / Story</span>
                <span className="cbadge bopt">Optional</span>
              </div>
              <div className="card-body">
                <RichEditor
                  initialContent={q.passage}
                  onChange={(json) => set('passage', json)}
                  placeholder="Paste or write the reading passage here. Supports formatting, tables, and math."
                  minHeight={120}
                />
              </div>
            </div>

            {/* Question text */}
            <div className="card">
              <div className="card-hd">
                <span className="card-title">❓ Question Text</span>
                <span className="cbadge breq">Required</span>
              </div>
              <div className="card-body">
                <RichEditor
                  initialContent={q.questionText}
                  onChange={(json) => set('questionText', json)}
                  placeholder="Write the question here. Click ∑ Math to insert fractions, powers, roots, symbols…"
                  minHeight={90}
                />
              </div>
            </div>

            {/* Answer options — plain inputs, not rich edited */}
            {(q.type === 'mcq' || q.type === 'tf') && (
              <div className="card">
                <div className="card-hd">
                  <span className="card-title">☑ Answer Options</span>
                </div>
                <div className="card-body">
                  <AnswerOptions
                    isTF={q.type === 'tf'}
                    options={q.options}
                    correct={q.correct}
                    onChange={(opts) => set('options', opts)}
                    onCorrect={(i) => set('correct', i)}
                  />
                </div>
              </div>
            )}

            {/* Explanation */}
            <div className="card">
              <div className="card-hd">
                <span className="card-title">💡 Explanation / Model Answer</span>
                <span className="cbadge bafter">Shown after attempt</span>
              </div>
              <div className="card-body">
                <RichEditor
                  initialContent={q.explanation}
                  onChange={(json) => set('explanation', json)}
                  placeholder="Explain the correct answer with step-by-step working. Use ∑ Math freely."
                  minHeight={100}
                />
              </div>
            </div>
          </>
        )}

        {/* ── PREVIEW TAB ── */}
        {tab === 'preview' && <QuizPreview question={q} />}

        {/* Save / Cancel bar */}
        <div className="savebar">
          <span className={`savestatus${saved ? ' saveok' : ''}`}>
            {saved ? '✓ Saved successfully' : `ID: ${q.id}`}
          </span>
          {onCancel && (
            <button type="button" className="btn btn-s" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="btn btn-ok" onClick={handleSave}>
            {saved ? '✓ Saved' : '💾 Save Question'}
          </button>
        </div>

        {/* Toast */}
        {toast && <div className="qe-toast" role="alert">{toast}</div>}
      </div>
    </div>
  )
}
