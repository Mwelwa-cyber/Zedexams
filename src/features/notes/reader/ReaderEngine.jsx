/**
 * ReaderEngine — the prototype-v3 note reader (learner redesign step 3).
 *
 * Renders a `noteFormat: 'study'` block list full-screen in the learner
 * design system: reading-progress bar, back row, kicker/title/meta,
 * the 📖 Learn / ⚡ Revise segment, keyword bubbles opening the
 * word-explainer sheet, and the interactive cards (ReaderBlock.jsx).
 *
 * ONE content source, TWO views. Learn and Revise are doorways into the
 * same `notes/{id}` — this component never forks the content, it renders
 * whatever `readerCore.planNoteView` places where. Nothing is authored
 * per mode, so editing the note once changes both views by construction.
 *
 * Learn mode paces the note: sections (level-2 headings) reveal one at
 * a time behind a "Continue ▾" button with progress dots — an honest
 * reveal of real content, the same idea as the teacher studios' Live
 * Generation Canvas. Revise mode shows the whole note at once, with the
 * key points hoisted to the top, the quiz and the label-diagram game
 * gone, and the exercises folded into a closed "Practice these later"
 * accordion — collapsed rather than deleted, since they are the same
 * blocks.
 *
 * The engine brings its own chrome (the prototype hides the bottom nav
 * while reading), so mount it full-screen — not inside LearnerLayout.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import '../../../shared/styles/learnerTheme.css'
import './reader.css'
import {
  buildGlossary,
  normalizeKeyword,
  planNoteView,
  readerMeta,
} from './readerCore'
import ReaderBlock, { InlineText, ZED_ART } from './ReaderBlock'

/** Word-explainer bottom sheet (prototype .word-sheet). */
function WordSheet({ entry, onClose }) {
  return (
    <div
      className={`lhx-word-sheet ${entry ? 'is-open' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label={entry ? `Meaning of ${entry.word}` : 'Word meaning'}
      aria-hidden={!entry}
    >
      {entry && (
        <>
          <button type="button" className="lhx-word-sheet-x" aria-label="Close word meaning" onClick={onClose}>✕</button>
          <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <img src={ZED_ART} alt="" aria-hidden="true" style={{ width: 48, height: 60, objectFit: 'contain', flexShrink: 0, borderRadius: 10 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="lhx-ws-word">{entry.word}</span>
              <div className="lhx-ws-meaning">{entry.meaning}</div>
              {entry.how && <div className="lhx-ws-how">{entry.how}</div>}
              {(entry.examples || []).length > 0 && (
                <div className="lhx-ex-card" style={{ fontSize: '13.5px', marginBottom: 0 }}>
                  {entry.examples.map((ex, i) => (
                    <div key={i}><InlineText text={ex} /></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function ReaderEngine({
  note = {},
  blocks = [],
  initialMode = 'learn',
  onBack,
  backLabel = 'Back to Notes',
  footer = null,
  // Furthest Learn-mode section the learner has reached on this device
  // (lib/learnStep.js). Revise's "Learn this properly" resumes here.
  resumeStep = 0,
  onStepReached = null,
  // Called whenever the learner flips doorway, so the page can keep the
  // URL honest and stop writing reading progress in Revise.
  onModeChange = null,
}) {
  const [mode, setMode] = useState(initialMode === 'revise' ? 'revise' : 'learn')
  const [shown, setShown] = useState(initialMode === 'revise' ? 0 : resumeStep)
  const [word, setWord] = useState(null) // glossary entry in the sheet
  const [practiceOpen, setPracticeOpen] = useState(false)
  const continueRef = useRef(null)

  const glossary = useMemo(() => buildGlossary(blocks), [blocks])
  const meta = useMemo(() => readerMeta(blocks), [blocks])
  const plan = useMemo(() => planNoteView(blocks, mode), [blocks, mode])
  const { maxStep } = plan
  const paced = mode === 'learn' && maxStep > 0
  // The Learn pass is finished once its last section has been revealed —
  // on this visit or on an earlier one (resumeStep).
  const learnDone = Math.max(shown, resumeStep) >= maxStep

  // Reading-progress bar driven by window scroll (the app scrolls the body).
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  const openWord = (raw) => {
    const entry = glossary.get(normalizeKeyword(raw))
    if (entry) setWord(entry)
  }

  const advance = () => {
    setShown((s) => {
      const next = Math.min(s + 1, maxStep)
      onStepReached?.(next)
      return next
    })
    // Bring the next section's continue point into view once it renders.
    setTimeout(() => continueRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 70)
  }

  // Flipping doorway never re-enters content — it re-places the SAME
  // blocks (readerCore.planNoteView). Learn resumes at the furthest
  // section already reached rather than restarting the note.
  const switchMode = (m) => {
    setMode(m)
    setWord(null)
    setPracticeOpen(false)
    if (m === 'learn') setShown(resumeStep)
    onModeChange?.(m)
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const renderEntry = ({ block, index, sectionNumber }) => (
    <ReaderBlock
      key={block.id || index}
      block={block}
      sectionNumber={sectionNumber}
      onWord={openWord}
      revealed={mode === 'revise'}
    />
  )

  // Learn paces the body one section at a time; Revise renders it whole.
  const body = (paced ? plan.main.filter((e) => e.step <= shown) : plan.main).map(renderEntry)

  const hasKeywords = glossary.size > 0

  return (
    <div className="lhx">
      <div className="lhx-note-prog" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      <div className="lhx-page" style={{ paddingBottom: 40 }}>
        <div className="lhx-back-row">
          <button type="button" className="lhx-back-btn" aria-label={backLabel} onClick={onBack}>‹</button>
          <div className="lhx-back-sub">{backLabel}</div>
        </div>

        <div>
          {note.kicker && <div className="lhx-note-kicker">{note.kicker}</div>}
          <h1 className="lhx-note-title">{note.title}</h1>
          <p className="lhx-note-meta">
            {meta.minutes} min read · {meta.sections} {meta.sections === 1 ? 'section' : 'sections'}
          </p>
          <div className="lhx-seg lhx-note-mode" role="tablist" aria-label="Reading mode">
            <button type="button" role="tab" aria-selected={mode === 'learn'} className="lhx-seg-btn" onClick={() => switchMode('learn')}>
              📖 Learn
            </button>
            <button type="button" role="tab" aria-selected={mode === 'revise'} className="lhx-seg-btn" onClick={() => switchMode('revise')}>
              ⚡ Revise
            </button>
          </div>
          {hasKeywords && mode === 'learn' && (
            <p className="lhx-note-hint">💡 Tap any purple word to see how to use it, with extra examples.</p>
          )}
          {/* Revising a topic never taught: offer the guided pass, resumed
              at the first section still un-revealed. */}
          {mode === 'revise' && !learnDone && (
            <button type="button" className="lhx-btn lhx-btn-block lhx-learn-properly" onClick={() => switchMode('learn')}>
              ▶ Learn this properly
            </button>
          )}
        </div>

        <div>
          {/* Revise hoists the key points above the note body. They are
              POSITIONED here, never re-entered — the same keypoints
              block the author wrote once. */}
          {plan.top.map(renderEntry)}

          {body}

          {/* Practice these later — the exercises Revise collapses.
              Children stay unmounted until the accordion is opened, so a
              closed panel cannot answer a question the learner never
              saw, and revision stays a reading pass. */}
          {mode === 'revise' && plan.practice.length > 0 && (
            <div className="lhx-revise-practice">
              <button
                type="button"
                className="lhx-revise-practice-head"
                aria-expanded={practiceOpen}
                onClick={() => setPracticeOpen((o) => !o)}
              >
                <span>✏️ Practice these later</span>
                <span className="lhx-revise-practice-count">
                  {plan.practice.length} {plan.practice.length === 1 ? 'exercise' : 'exercises'}
                  <i aria-hidden="true">{practiceOpen ? '▴' : '▾'}</i>
                </span>
              </button>
              {practiceOpen && <div>{plan.practice.map(renderEntry)}</div>}
            </div>
          )}

          {paced && shown < maxStep && (
            <>
              <div className="lhx-rv-dots" aria-hidden="true">
                {Array.from({ length: maxStep + 1 }, (_, i) => (
                  <span key={i} className={`lhx-rv-dot ${i === shown ? 'is-on' : ''}`} />
                ))}
              </div>
              <button ref={continueRef} type="button" className="lhx-btn lhx-btn-block lhx-rv-continue" onClick={advance}>
                {shown === 0 ? "Let's begin ▾" : 'Continue ▾'}
              </button>
            </>
          )}

          {/* End of the Learn pass: the note is already in the Notes tab
              — say so, and open the revision doorway onto the same note
              rather than leaving the learner to find it. */}
          {mode === 'learn' && shown >= maxStep && (
            <div className="lhx-saved-note">
              <div className="lhx-saved-note-line">📌 Saved to your Notes for revision</div>
              <button type="button" className="lhx-btn lhx-btn-block" onClick={() => switchMode('revise')}>
                ⚡ Revise this in Notes
              </button>
            </div>
          )}

          {(!paced || shown >= maxStep) && footer}
        </div>
      </div>

      <WordSheet entry={word} onClose={() => setWord(null)} />
    </div>
  )
}
