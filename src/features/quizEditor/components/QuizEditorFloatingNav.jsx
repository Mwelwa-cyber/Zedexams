/**
 * QuizEditorFloatingNav — fixed-position floating buttons that follow the
 * teacher down a long quiz: Go to Top, Go to Bottom, optional Save Draft
 * + Publish shortcuts.
 *
 * Lives in the corner so it never blocks question text, fades out when
 * the page is short, and stays inside the safe area on mobile.
 *
 * Props
 *   onSaveDraft  — () => void
 *   onPublish    — () => void
 *   busy         — boolean; disables the save/publish shortcuts
 *   showPublish  — boolean; hide the Publish shortcut when not allowed
 */

import { useEffect, useState } from 'react'

export default function QuizEditorFloatingNav({
  onSaveDraft,
  onPublish,
  busy = false,
  showPublish = false,
}) {
  // Only show the nav when the page is taller than the viewport; otherwise
  // there's nothing to scroll to and the buttons just clutter the screen.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function update() {
      const doc = document.documentElement
      setVisible(doc.scrollHeight > doc.clientHeight + 200)
    }
    update()
    window.addEventListener('resize', update, { passive: true })
    // ResizeObserver gives us a signal when content grows (adding a
    // question, expanding a passage) without forcing a window resize.
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null
    if (ro) ro.observe(document.body)
    return () => {
      window.removeEventListener('resize', update)
      if (ro) ro.disconnect()
    }
  }, [])

  if (!visible) return null

  const goTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })
  const goBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })

  return (
    <div
      className="quiz-floating-nav fixed bottom-24 right-3 z-40 flex flex-col gap-2 sm:bottom-28 sm:right-5"
      role="toolbar"
      aria-label="Quiz editor quick navigation"
    >
      <button
        type="button"
        onClick={goTop}
        className="rounded-full bg-white shadow-elev-md ring-1 ring-black/10 hover:bg-slate-50 h-11 w-11 flex items-center justify-center text-slate-700"
        title="Go to top"
        aria-label="Go to top"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={goBottom}
        className="rounded-full bg-white shadow-elev-md ring-1 ring-black/10 hover:bg-slate-50 h-11 w-11 flex items-center justify-center text-slate-700"
        title="Go to bottom"
        aria-label="Go to bottom"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      </button>
      {onSaveDraft && (
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={busy}
          className="rounded-full bg-white shadow-elev-md ring-1 ring-black/10 hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none h-11 w-11 flex items-center justify-center text-slate-700"
          title="Save draft"
          aria-label="Save draft"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
        </button>
      )}
      {showPublish && onPublish && (
        <button
          type="button"
          onClick={onPublish}
          disabled={busy}
          className="rounded-full bg-[var(--accent)] text-white shadow-elev-md ring-1 ring-black/10 hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none h-11 w-11 flex items-center justify-center"
          title="Publish"
          aria-label="Publish"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 12 5 5L20 7" />
          </svg>
        </button>
      )}
    </div>
  )
}
