// src/features/notes/components/StudyNoteReader.jsx
//
// Presentational renderer for a `noteFormat: 'study'` note — the structured,
// interactive study-note type (blocks[]). Used by BOTH the learner reader
// (LearnerNoteRead) and the admin editor's live preview, so authors see exactly
// what learners get. Pure + read-only: it renders whatever blocks it's given.
//
// Pattern mirrors SlideNotesReader.jsx (one component per block type, Tailwind
// + the notes-studio editorial type). The Practice Quiz block links to the
// existing quiz runner at /quiz/:quizId (the picker that sets quizId arrives in
// the quiz-linking phase; until then a note simply shows "coming soon").

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { mdInline } from '../lib/studyBlocks'

// Inline **bold**/*italic* → escaped HTML. Safe: mdInline escapes before adding tags.
function Inline({ text, as: Tag = 'span', className }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: mdInline(text) }} />
}

// Tone palette for callout cards — semantic, consistent with the app.
const TONES = {
  green: { bg: 'bg-emerald-50', border: 'border-emerald-200', title: 'text-emerald-800' },
  blue:  { bg: 'bg-blue-50',    border: 'border-blue-200',    title: 'text-blue-800' },
  amber: { bg: 'bg-amber-50',   border: 'border-amber-200',   title: 'text-amber-900' },
  red:   { bg: 'bg-red-50',     border: 'border-red-200',     title: 'text-red-800' },
}

function Callout({ tone = 'amber', title, children }) {
  const t = TONES[tone] || TONES.amber
  return (
    <section className={`rounded-2xl border ${t.border} ${t.bg} p-5 sm:p-6`}>
      {title && <div className={`font-semibold mb-2 ${t.title}`}>{title}</div>}
      <div className="text-[15px] leading-relaxed text-neutral-800 space-y-2">{children}</div>
    </section>
  )
}

const LEVEL_PILL = {
  easy:   'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  exam:   'bg-orange-100 text-orange-800',
}
function levelClass(level) {
  const l = String(level || '').toLowerCase()
  if (l.includes('exam')) return LEVEL_PILL.exam
  if (l.includes('med')) return LEVEL_PILL.medium
  return LEVEL_PILL.easy
}

// Interactive: answer hidden until the learner taps "Show answer".
function QuickCheck({ block }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <div className="flex items-start gap-3 p-4 sm:p-5 bg-neutral-50/70">
        <span className="text-lg leading-none mt-0.5" aria-hidden>❓</span>
        <div className="flex-1">
          <span className="font-semibold text-neutral-900"><Inline text={block.q} /></span>
          {block.level && (
            <span className={`ml-2 inline-block align-middle text-[11px] font-semibold px-2 py-0.5 rounded-full ${levelClass(block.level)}`}>
              {block.level}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--accent)] text-white hover:opacity-90 transition"
        >
          {open ? 'Hide answer' : 'Show answer'}
        </button>
      </div>
      {open && (
        <div className="p-4 sm:p-5 border-t border-neutral-100 text-[15px] leading-relaxed text-neutral-800">
          <Inline text={block.a} />
        </div>
      )}
    </section>
  )
}

function QuizCard({ block }) {
  const linked = !!(block.quizId && String(block.quizId).trim())
  return (
    <section className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-white to-neutral-50 p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden>🧪</span>
        <div className="flex-1">
          <div className="font-display text-xl text-neutral-900 leading-tight">Practice quiz</div>
          {block.quizTitle && <div className="text-sm text-neutral-600">{block.quizTitle}</div>}
        </div>
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${linked ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-500'}`}>
          {linked ? 'Ready' : 'Coming soon'}
        </span>
      </div>
      {block.questionCount ? (
        <div className="text-sm text-neutral-500 mt-2">{block.questionCount} questions</div>
      ) : null}
      <div className="mt-4">
        {linked ? (
          <Link
            to={`/quiz/${block.quizId}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-semibold hover:opacity-90 transition bg-[var(--accent)]"
          >
            ▶ Start practice quiz
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-neutral-200 text-neutral-500 cursor-not-allowed"
          >
            Practice quiz coming soon
          </button>
        )}
      </div>
    </section>
  )
}

function Block({ block }) {
  switch (block.type) {
    case 'objectives':
      return (
        <Callout tone="green" title="🎯 Learning objectives — by the end you should be able to:">
          <ul className="list-disc pl-5 space-y-1">
            {(block.items || []).map((it, i) => <li key={i}><Inline text={it} /></li>)}
          </ul>
        </Callout>
      )
    case 'think':
      return (
        <Callout tone="blue" title="💭 Think first">
          {(block.lines || []).map((l, i) => <p key={i}><Inline text={l} /></p>)}
        </Callout>
      )
    case 'keyidea':
      return <Callout tone="amber" title="⚡ Key idea"><p><Inline text={block.text} /></p></Callout>
    case 'note':
      return (
        <Callout tone="amber" title="🧠 Remember">
          {(block.lines || []).map((l, i) => <p key={i}><Inline text={l} /></p>)}
        </Callout>
      )
    case 'tip':
      return (
        <Callout tone="amber" title="💡 Study tip">
          {(block.lines || []).map((l, i) => <p key={i}><Inline text={l} /></p>)}
        </Callout>
      )
    case 'summary':
      return (
        <Callout tone="green" title="✅ Summary — key points">
          <ul className="list-disc pl-5 space-y-1">
            {(block.items || []).map((it, i) => <li key={i}><Inline text={it} /></li>)}
          </ul>
        </Callout>
      )
    case 'exam':
      return (
        <Callout tone="green" title="📝 Exam tip — how to answer">
          <p><strong>Question:</strong> <Inline text={block.q} /></p>
          <p><strong>Good answer:</strong> <Inline text={block.a} /></p>
        </Callout>
      )
    case 'mistake':
      return (
        <Callout tone="red" title="⚠️ Common mistake">
          <p><span className="font-semibold text-red-700">✘ Wrong:</span> <Inline text={block.wrong} /></p>
          <p><span className="font-semibold text-emerald-700">✔ Correct:</span> <Inline text={block.correct} /></p>
        </Callout>
      )
    case 'picture':
      // When the picture has been generated, show the image (same figure/
      // figcaption pattern as the 'image' block below). When there's no url
      // yet, fall back to the text callout so unpopulated notes still read
      // cleanly.
      if (block.url) {
        return (
          <figure className="my-2">
            <div className="rounded-2xl overflow-hidden bg-white border border-neutral-200">
              <img src={block.url} alt={block.caption || ''} loading="lazy" className="w-full h-auto object-contain" />
            </div>
            {block.caption && <figcaption className="font-display-italic text-sm text-neutral-500 text-center mt-2">{block.caption}</figcaption>}
          </figure>
        )
      }
      return (
        <Callout tone="blue" title={`🖼 Picture: ${block.caption || ''}`}>
          {(block.lines || []).map((l, i) => <p key={i} className="italic"><Inline text={l} /></p>)}
        </Callout>
      )
    case 'heading':
      return block.level === 2
        ? <h2 className="font-display text-2xl sm:text-3xl text-neutral-900 mt-4"><Inline text={block.text} /></h2>
        : <h3 className="font-display text-xl sm:text-2xl text-neutral-900 mt-2"><Inline text={block.text} /></h3>
    case 'paragraph':
      return <Inline as="p" className="text-[15px] leading-relaxed text-neutral-800" text={block.text} />
    case 'bullets':
      return (
        <ul className="list-disc pl-6 space-y-1 text-[15px] leading-relaxed text-neutral-800">
          {(block.items || []).map((it, i) => <li key={i}><Inline text={it} /></li>)}
        </ul>
      )
    case 'numbers':
      return (
        <ol className="list-decimal pl-6 space-y-1 text-[15px] leading-relaxed text-neutral-800">
          {(block.items || []).map((it, i) => <li key={i}><Inline text={it} /></li>)}
        </ol>
      )
    case 'keyterms':
      return (
        <section>
          <div className="font-semibold text-neutral-900 mb-2">🔑 Key words</div>
          <div className="overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-[14px]">
              <tbody>
                {(block.rows || []).map((r, i) => (
                  <tr key={i} className={i % 2 ? 'bg-white' : 'bg-neutral-50'}>
                    <td className="align-top font-semibold text-neutral-900 p-2.5 w-1/3 border-b border-neutral-100"><Inline text={r.term} /></td>
                    <td className="align-top text-neutral-700 p-2.5 border-b border-neutral-100"><Inline text={r.def || ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px] border-collapse">
            <thead>
              <tr>
                {(block.headers || []).map((h, i) => (
                  <th key={i} className="text-left bg-neutral-900 text-white font-semibold p-2.5 border border-white/20"><Inline text={h} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(block.rows || []).map((r, ri) => (
                <tr key={ri} className={ri % 2 ? 'bg-white' : 'bg-neutral-50'}>
                  {(block.headers || []).map((_, ci) => (
                    <td key={ci} className="align-top text-neutral-800 p-2.5 border border-neutral-200"><Inline text={(r.cells || [])[ci] || ''} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'image':
      if (!block.url) return null
      return (
        <figure className="my-2">
          <div className="rounded-2xl overflow-hidden bg-white border border-neutral-200">
            <img src={block.url} alt={block.caption || ''} loading="lazy" className="w-full h-auto object-contain" />
          </div>
          {block.caption && <figcaption className="font-display-italic text-sm text-neutral-500 text-center mt-2">{block.caption}</figcaption>}
        </figure>
      )
    case 'quickcheck':
      return <QuickCheck block={block} />
    case 'quiz':
      return <QuizCard block={block} />
    default:
      return null
  }
}

export function StudyNoteReader({ blocks }) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return <p className="text-sm text-neutral-500">This note has no content yet.</p>
  }
  return (
    <div className="study-note space-y-5">
      {blocks.map((block, i) => <Block key={block.id || i} block={block} />)}
    </div>
  )
}

export default StudyNoteReader
