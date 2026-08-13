// The Question Bank, docked inside the Assessment Paper Studio's builder.
//
// A side drawer on desktop and a bottom sheet on a phone. The paper stays
// visible and scrollable behind it and inserting never navigates away, because
// the builder lives in the studio's React state and this is a sibling overlay:
// the whole point is that finding a question and placing it are one continuous
// action rather than a round trip through another page.
//
// The bank UI itself is QuestionBankBrowser — the same component the studio's
// Question Bank view renders full-page, so a filter or an action exists in both
// places or in neither. This file is the shell: the drawer/sheet chrome, the
// paper's context defaults, and the "no questions for this topic" widening
// offer.
//
// Placement is NOT here. `onUse` hands the row up to AssessmentStudio, which
// asks where it should go (see questionBankPlacement.js) before anything is
// inserted.

import { useEffect, useMemo, useState } from 'react'
import QuestionBankBrowser, { EMPTY_BANK_FILTERS } from './QuestionBankBrowser'

export default function QuestionBankPanel({
  open, onClose, uid, context = {}, onUse, busyUseId = '',
}) {
  const { grade = '', subject = '', topic = '' } = context

  // The paper's grade/subject/topic seed the filters — and re-seed whenever the
  // panel is reopened against a different paper context. A key remount is the
  // honest way to do that: the browser owns its filter state, and a teacher who
  // changed a filter inside one opening should not have it silently reset while
  // the panel is still open.
  const contextKey = `${grade}|${subject}|${topic}`
  const [seedKey, setSeedKey] = useState(contextKey)
  useEffect(() => {
    if (open) setSeedKey(contextKey)
  }, [open, contextKey])

  const initialFilters = useMemo(
    () => ({ ...EMPTY_BANK_FILTERS, grade, subject, topic }),
    [grade, subject, topic],
  )

  return (
    <>
      {/* Dim only the small-screen backdrop; on desktop the builder stays fully
          interactive beside the drawer so the paper is never blocked. */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={[
          'fixed z-50 bg-slate-50 shadow-2xl flex flex-col transition-transform duration-200',
          // Phone: a bottom sheet that covers the lower 85% of the screen.
          'inset-x-0 bottom-0 top-[15vh] rounded-t-2xl border-t theme-border',
          // Desktop: the full-height right-hand drawer.
          'md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:w-[min(460px,100%)] md:rounded-none md:border-t-0 md:border-l',
          open ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full',
        ].join(' ')}
        aria-hidden={!open}
        aria-label="Question bank"
      >
        {/* The sheet's grab affordance — phone only. */}
        <div className="md:hidden pt-2 pb-1 flex justify-center" aria-hidden="true">
          <span className="block h-1 w-10 rounded-full bg-gray-300" />
        </div>

        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b theme-border bg-white">
          <div>
            <h3 className="font-black text-[15px] text-gray-800 m-0">📚 Question bank</h3>
            <p className="text-[12px] text-gray-500 m-0">
              Pick a question, then choose where it goes. Your paper keeps its own editable copy.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 hover:text-gray-700"
            aria-label="Close question bank"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {open && (
            <QuestionBankBrowser
              key={seedKey}
              uid={uid}
              variant="drawer"
              initialFilters={initialFilters}
              onUse={onUse}
              useLabel="Use"
              busyUseId={busyUseId}
              emptyHint="Questions you save to the bank show up here — including every question your papers create."
            />
          )}
        </div>
      </aside>
    </>
  )
}
