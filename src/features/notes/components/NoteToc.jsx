// src/features/notes/components/NoteToc.jsx
//
// Table-of-contents navigation for a long study note. Three surfaces, one
// data source:
//   • xl screens  → a fixed rail in the left gutter ("On this page")
//   • < xl        → a floating "Contents" pill that opens a slide-over drawer
// Active section is highlighted (driven by useActiveSection). Hidden entirely
// for notes with fewer than 2 sections. Pure presentational + local open state.

import { useState } from 'react'
import { List, X } from '../../../shared/components/icons'

function jumpTo(id, after) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  after?.()
}

function TocList({ toc, activeKey, onJump, summaryByKey }) {
  return (
    <nav aria-label="Contents" className="space-y-0.5">
      {toc.map(e => (
        <div key={e.key}>
          <button
            type="button"
            onClick={() => onJump(e.id)}
            className={`block w-full text-left rounded-lg px-3 py-1.5 transition ${
              e.level === 3 ? 'pl-6 text-[13px]' : 'text-sm font-semibold'
            } ${
              activeKey === e.key
                ? 'bg-[#0F1B2D] text-white'
                : 'text-[#4A5A6E] hover:bg-white hover:text-[#0F1B2D]'
            }`}
          >
            {e.text}
          </button>
          {summaryByKey?.[e.key] && activeKey !== e.key && (
            <p className="px-3 pb-1 text-[11px] leading-snug text-[#6B7280]">{summaryByKey[e.key]}</p>
          )}
        </div>
      ))}
    </nav>
  )
}

export function NoteToc({ toc, activeKey, summaryByKey }) {
  const [open, setOpen] = useState(false)
  if (!Array.isArray(toc) || toc.length < 2) return null

  const onJump = (id) => jumpTo(id, () => setOpen(false))

  return (
    <>
      {/* xl: fixed rail in the left gutter (only where the centered article leaves room) */}
      <aside className="hidden xl:block fixed top-28 left-[max(1rem,calc(50%-37rem))] w-56 max-h-[70vh] overflow-auto">
        <div className="notes-card p-3">
          <div className="text-[10.5px] font-extrabold tracking-[0.16em] uppercase text-[#053541] mb-2 px-2">On this page</div>
          <TocList toc={toc} activeKey={activeKey} onJump={onJump} summaryByKey={summaryByKey} />
        </div>
      </aside>

      {/* < xl: floating Contents pill */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open contents"
        className="xl:hidden fixed bottom-5 right-4 z-30 notes-chip notes-chip-shadow inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 bg-[#0F1B2D] text-white text-sm font-semibold"
      >
        <List size={15} /> Contents
      </button>

      {/* < xl: slide-over drawer */}
      {open && (
        <div className="xl:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Contents">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[82%] max-w-xs bg-[#F5EFE1] border-l-2 border-[#0F1B2D] p-4 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="font-display text-xl text-[#0F1B2D]">Contents</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close contents" className="w-8 h-8 grid place-items-center rounded-lg border-2 border-[#0F1B2D] bg-white">
                <X size={15} />
              </button>
            </div>
            <TocList toc={toc} activeKey={activeKey} onJump={onJump} summaryByKey={summaryByKey} />
          </div>
        </div>
      )}
    </>
  )
}

export default NoteToc
