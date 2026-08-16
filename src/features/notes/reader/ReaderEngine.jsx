/**
 * ReaderEngine — the prototype-v3 note reader (learner redesign step 3).
 *
 * Renders a `noteFormat: 'study'` block list full-screen in the learner
 * design system: reading-progress bar, back row, kicker/title/meta,
 * the 📖 Learn / ⚡ Revise segment, keyword bubbles opening the
 * word-explainer sheet, and the interactive cards (ReaderBlock.jsx).
 *
 * Learn mode paces the note: sections (level-2 headings) reveal one at
 * a time behind a "Continue ▾" button with progress dots — an honest
 * reveal of real content, the same idea as the teacher studios' Live
 * Generation Canvas. Revise mode shows the whole note at once with the
 * key points visible and the practice surfaces hidden
 * (readerCore.blockVisibleInMode).
 *
 * The engine brings its own chrome (the prototype hides the bottom nav
 * while reading), so mount it full-screen — not inside LearnerLayout.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import '../../../shared/styles/learnerTheme.css'
import './reader.css'
import {
  assignRevealSteps,
  blockVisibleInMode,
  buildGlossary,
  normalizeKeyword,
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
}) {
  const [mode, setMode] = useState(initialMode === 'revise' ? 'revise' : 'learn')
  const [shown, setShown] = useState(0)
  const [word, setWord] = useState(null) // glossary entry in the sheet
  const continueRef = useRef(null)

  const glossary = useMemo(() => buildGlossary(blocks), [blocks])
  const meta = useMemo(() => readerMeta(blocks), [blocks])
  const { steps, maxStep } = useMemo(() => assignRevealSteps(blocks), [blocks])
  const paced = mode === 'learn' && maxStep > 0

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
    setShown((s) => Math.min(s + 1, maxStep))
    // Bring the next section's continue point into view once it renders.
    setTimeout(() => continueRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 70)
  }
  const switchMode = (m) => {
    setMode(m)
    setWord(null)
    if (m === 'learn') setShown(0)
  }

  // Section numbering follows level-2 headings in document order.
  let sectionCounter = 0
  const rendered = []
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]
    if (!b || !blockVisibleInMode(b.type, mode)) continue
    if (paced && (steps[i] ?? 0) > shown) break
    let sectionNumber = null
    if (b.type === 'heading' && (b.level ?? 2) === 2) {
      sectionCounter += 1
      sectionNumber = sectionCounter
    }
    rendered.push(
      <ReaderBlock
        key={b.id || i}
        block={b}
        sectionNumber={sectionNumber}
        onWord={openWord}
      />,
    )
  }

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
            {meta.minutes} min read · {meta.sections} {meta.sections === 1 ? 'section' : 'sections'} · with Zed
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
        </div>

        <div>
          {rendered}
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
          {(!paced || shown >= maxStep) && footer}
        </div>
      </div>

      <WordSheet entry={word} onClose={() => setWord(null)} />
    </div>
  )
}
