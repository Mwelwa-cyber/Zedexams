/**
 * WorkspaceDrawer — the Class Timetable workspace's edit-in-place surface.
 *
 * Drawers, not navigation: "Day times", "Subjects", "Conflicts", "Layout
 * options" and the printable preview open OVER the grid so the teacher can
 * edit, close, and keep placing lessons without losing their place.
 *
 *   ≥ sm  : a fixed right-hand panel (full height).
 *   < sm  : a bottom sheet (max 88vh) with rounded top corners.
 *
 * Esc and the backdrop both close it; body scroll is locked while open.
 */

import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function WorkspaceDrawer({ open, title, onClose, wide = false, children }) {
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/45" onClick={() => onClose?.()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-hidden rounded-t-2xl shadow-2xl
          sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:max-h-none sm:rounded-none
          ${wide ? 'sm:w-[min(780px,94vw)]' : 'sm:w-[min(560px,94vw)]'}`}
        style={{ background: 'var(--zt-surface, #fdfcf8)' }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b theme-border px-4 py-3">
          <h2 className="m-0 text-sm font-black">{title}</h2>
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label={`Close ${title}`}
            className="studio-btn-ghost !px-2 !py-1"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
