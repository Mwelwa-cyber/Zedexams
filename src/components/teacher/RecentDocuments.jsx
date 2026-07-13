/**
 * RecentDocuments — the teacher's latest documents with quick actions
 * (redesign §9). Purely presentational: TeacherDashboard shapes the items
 * from the data it already fetched (no extra reads) and owns the action
 * handlers (duplicate / rename / delete) so all Firestore writes go through
 * the same services the Library uses.
 *
 * Action honesty:
 *  - Duplicate appears only for client-created tools (the same
 *    CLIENT_CREATED_TOOLS constraint the Library documents — AI-generated
 *    docs are created server-side and can't be client-copied).
 *  - Rename appears only for test/exam papers, where `title` is a real
 *    first-class field; generation titles are derived from content, so a
 *    dashboard rename would silently not stick.
 *  - Delete is a permanent delete behind a ConfirmDialog — there is no
 *    trash/restore in the data model, so the menu never says "Move to
 *    Trash".
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ConfirmDialog from '../ui/ConfirmDialog'
import { capture } from '../../utils/analytics'

function MoreDots() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
      <circle cx="10" cy="4" r="1.7" />
      <circle cx="10" cy="10" r="1.7" />
      <circle cx="10" cy="16" r="1.7" />
    </svg>
  )
}

function RowMenu({ item, onRenameStart, onDuplicate, onDeleteAsk }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="teacher-recent-row__menuwrap" ref={wrapRef}>
      <button
        type="button"
        className="teacher-recent-row__more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${item.title}`}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreDots />
      </button>
      {open && (
        <div role="menu" className="teacher-recent-menu" aria-label={`${item.title} actions`}>
          <Link
            role="menuitem"
            to={item.to}
            className="teacher-recent-menu__item"
            onClick={() => capture('recent_document_opened', { type: item.tool, via: 'menu' })}
          >
            Open
          </Link>
          {item.canRename && (
            <button
              type="button"
              role="menuitem"
              className="teacher-recent-menu__item"
              onClick={() => { setOpen(false); onRenameStart(item) }}
            >
              Rename
            </button>
          )}
          {item.canDuplicate && (
            <button
              type="button"
              role="menuitem"
              className="teacher-recent-menu__item"
              onClick={() => { setOpen(false); onDuplicate(item) }}
            >
              Duplicate
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="teacher-recent-menu__item teacher-recent-menu__item--danger"
            onClick={() => { setOpen(false); onDeleteAsk(item) }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

export default function RecentDocuments({ items = [], loading, onDuplicate, onRename, onDelete }) {
  const [confirmItem, setConfirmItem] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(null) // { id, value }

  if (loading) {
    return (
      <section className="teacher-recent teacher-defer" role="status" aria-label="Recent documents">
        <span className="sr-only">Loading your recent documents…</span>
        <div className="teacher-recent__skeleton" />
      </section>
    )
  }
  if (!items.length) return null

  async function handleDelete() {
    if (!confirmItem) return
    setDeleting(true)
    try {
      await onDelete(confirmItem)
      capture('recent_document_deleted', { type: confirmItem.tool })
      setConfirmItem(null)
    } finally {
      setDeleting(false)
    }
  }

  async function submitRename(item) {
    const value = renaming?.value?.trim()
    setRenaming(null)
    if (!value || value === item.title) return
    await onRename(item, value)
    capture('recent_document_renamed', { type: item.tool })
  }

  return (
    <section className="teacher-recent teacher-defer" aria-label="Recent documents">
      <div className="teacher-section-head">
        <div className="teacher-dashboard-eyebrow">Recent documents</div>
        <Link to="/teacher/library" className="teacher-section-head__link">View all</Link>
      </div>
      <div className="teacher-recent__list">
        {items.map((item) => (
          <div key={`${item.kind}-${item.id}`} className="teacher-recent-row">
            <span className="teacher-recent-row__icon" aria-hidden="true">{item.icon}</span>
            <div className="teacher-recent-row__body">
              {renaming?.id === item.id ? (
                <form
                  className="teacher-recent-row__rename"
                  onSubmit={(e) => { e.preventDefault(); submitRename(item) }}
                >
                  <input
                    autoFocus
                    value={renaming.value}
                    maxLength={140}
                    aria-label={`New name for ${item.title}`}
                    onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null) }}
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <Link
                  to={item.to}
                  className="teacher-recent-row__title"
                  onClick={() => capture('recent_document_opened', { type: item.tool, via: 'row' })}
                >
                  {item.title}
                </Link>
              )}
              <span className="teacher-recent-row__meta">
                {[item.typeLabel, item.grade, item.subject].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className="teacher-recent-row__time">{item.timeLabel}</span>
            <span className={`teacher-recent-row__status teacher-recent-row__status--${item.status}`}>
              {item.status === 'draft' ? 'Draft' : 'Ready'}
            </span>
            <RowMenu
              item={item}
              onRenameStart={(it) => setRenaming({ id: it.id, value: it.title })}
              onDuplicate={onDuplicate}
              onDeleteAsk={setConfirmItem}
            />
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(confirmItem)}
        title="Delete this document?"
        message={confirmItem ? `"${confirmItem.title}" will be permanently deleted. This cannot be undone.` : ''}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmItem(null)}
      />
    </section>
  )
}
