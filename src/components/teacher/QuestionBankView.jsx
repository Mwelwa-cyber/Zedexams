/**
 * The Assessment Paper Studio's Question Bank view — where the standalone
 * `/teacher/question-bank` page used to live.
 *
 * The bank is not a destination of its own any more. A question bank exists to
 * fill papers, and a page that could search a bank but not put anything in a
 * paper made the teacher copy text out of it by hand. So the browser moved into
 * the studio, and the only thing this view adds around it is an answer to
 * "Use — into what?" when no paper is open yet.
 *
 * **Use never dead-ends.** With a paper in progress, Use goes straight to the
 * placement step. With no paper open, it asks which paper first: one of the
 * teacher's recent ones, or a new one started with this question in it.
 */

import { useState } from 'react'
import QuestionBankBrowser from './QuestionBankBrowser'

function PaperChooser({ target, papers, onPick, onStartNew, onCancel }) {
  if (!target) return null
  const recent = (papers || []).slice(0, 8)
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="theme-card bg-white w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
        role="dialog"
        aria-label="Choose a paper"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-black text-gray-800 m-0">Insert into…</h2>
          <button type="button" onClick={onCancel} className="text-gray-400 text-xl leading-none" aria-label="Cancel">✕</button>
        </div>
        <p className="text-[13px] text-gray-500 m-0">
          No paper is open. Pick one to insert this question into — you choose the exact position next.
        </p>

        <button
          type="button"
          onClick={onStartNew}
          className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold py-2.5"
        >
          Start a new paper with this question
        </button>

        {recent.length > 0 && (
          <>
            <p className="text-[12px] font-black uppercase tracking-wide text-gray-500 m-0 pt-1">Your recent papers</p>
            <ul className="list-none p-0 m-0 space-y-1.5">
              {recent.map(paper => (
                <li key={paper.id}>
                  <button
                    type="button"
                    onClick={() => onPick(paper)}
                    className="w-full text-left rounded-xl border theme-border bg-white hover:border-orange-400 px-3.5 py-2.5"
                  >
                    <span className="block text-sm font-bold text-gray-800 truncate">
                      {paper.title || paper.name || 'Untitled paper'}
                    </span>
                    <span className="block text-[12px] text-gray-500">
                      {[paper.grade && `Grade ${paper.grade}`, paper.subject, `${paper.questionCount ?? 0} question${paper.questionCount === 1 ? '' : 's'}`]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-xl border theme-border text-sm font-bold text-gray-600 py-2.5"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * @param {object}   props
 * @param {string}   props.uid
 * @param {object}   props.initialFilters   seeded from the URL (the old
 *                                          standalone route redirects here with
 *                                          its filters intact)
 * @param {boolean}  props.hasOpenPaper     is there a paper worth inserting into?
 * @param {Array}    props.recentPapers     the teacher's saved papers
 * @param {Function} props.onUse            `(row, question)` — placement flow
 * @param {Function} props.onUseInPaper     `(paperId, row)` — open that paper
 *                                          and resume the insert there
 * @param {Function} props.onStartNewPaper  `(row, question)` — blank paper, then
 *                                          the placement flow
 * @param {Function} props.onFiltersChange  mirrors filters into the URL
 */
export default function QuestionBankView({
  uid,
  initialFilters = null,
  hasOpenPaper = false,
  recentPapers = [],
  onUse,
  onUseInPaper,
  onStartNewPaper,
  onFiltersChange = null,
  busyUseId = '',
}) {
  const [chooserTarget, setChooserTarget] = useState(null)

  function handleUse(row, question) {
    if (hasOpenPaper) { onUse?.(row, question); return }
    setChooserTarget({ row, question })
  }

  return (
    <div className="studio-v2">
      <div className="mx-auto max-w-6xl px-4 py-4 space-y-4">
        <div>
          <h1 className="text-2xl font-black text-gray-800 m-0">📚 Question Bank</h1>
          <p className="text-gray-500 text-sm mt-0.5 m-0">
            Your saved questions plus the platform Master Bank. Everything you create is captured here
            automatically. Inserting gives your paper its own editable copy — the bank record never changes.
          </p>
        </div>

        <QuestionBankBrowser
          uid={uid}
          variant="page"
          initialFilters={initialFilters}
          onUse={handleUse}
          useLabel="Use"
          busyUseId={busyUseId}
          onFiltersChange={onFiltersChange}
        />
      </div>

      <PaperChooser
        target={chooserTarget}
        papers={recentPapers}
        onCancel={() => setChooserTarget(null)}
        onPick={(paper) => {
          const target = chooserTarget
          setChooserTarget(null)
          if (target) onUseInPaper?.(paper.id, target.row)
        }}
        onStartNew={() => {
          const target = chooserTarget
          setChooserTarget(null)
          if (target) onStartNewPaper?.(target.row, target.question)
        }}
      />
    </div>
  )
}
