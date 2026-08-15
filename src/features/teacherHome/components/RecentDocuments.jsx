/**
 * RecentDocuments — the teacher's latest documents with quick actions
 * (redesign §9 + risk review). Purely presentational: TeacherDashboard
 * shapes the items from the data it already fetched (no extra reads) and
 * owns the action handlers, with capabilities decided centrally by
 * src/utils/documentActions.js — the menu only ever shows actions that
 * genuinely work for that document type.
 *
 * Deliberately absent (see documentActions.js for the full rationale):
 *  - Download — exporters live inside each document view; the menu says so.
 *  - Trash/Delete — no soft-delete lifecycle exists yet, and a permanent
 *    delete is not an acceptable stand-in, so the dashboard offers no
 *    destructive action at all. Deletion stays in the Library.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { validateDocumentTitle } from '../../../utils/documentActions'
import { capture } from '../../../utils/analytics'

function MoreDots() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
      <circle cx="10" cy="4" r="1.7" />
      <circle cx="10" cy="10" r="1.7" />
      <circle cx="10" cy="16" r="1.7" />
    </svg>
  )
}

function RowMenu({ item, busy, onRenameStart, onDuplicate }) {
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
          {item.actions.canRename && (
            <button
              type="button"
              role="menuitem"
              className="teacher-recent-menu__item"
              onClick={() => { setOpen(false); onRenameStart(item) }}
            >
              Rename
            </button>
          )}
          {item.actions.canDuplicate && (
            <button
              type="button"
              role="menuitem"
              className="teacher-recent-menu__item"
              disabled={busy}
              onClick={() => { setOpen(false); onDuplicate(item) }}
            >
              {busy ? 'Duplicating…' : 'Duplicate'}
            </button>
          )}
          {/* Exporters are per-type and live in the document views — say so
              instead of offering a Download that couldn't work here. */}
          <p className="teacher-recent-menu__hint">Open this document to download or export it.</p>
        </div>
      )}
    </div>
  )
}

export default function RecentDocuments({ items = [], loading, onDuplicate, onRename }) {
  const [renaming, setRenaming] = useState(null) // { id, value, problem }
  const [duplicatingId, setDuplicatingId] = useState(null)

  if (loading) {
    return (
      <section className="teacher-recent teacher-defer" role="status" aria-label="Recent documents">
        <span className="sr-only">Loading your recent documents…</span>
        <div className="teacher-recent__skeleton" />
      </section>
    )
  }
  if (!items.length) return null

  async function handleDuplicate(item) {
    if (duplicatingId) return
    setDuplicatingId(item.id)
    try {
      await onDuplicate(item)
      capture('recent_document_duplicated', { type: item.tool })
    } finally {
      setDuplicatingId(null)
    }
  }

  async function submitRename(item) {
    const value = renaming?.value ?? ''
    const problem = validateDocumentTitle(value)
    if (problem) {
      setRenaming((r) => (r ? { ...r, problem } : r))
      return
    }
    setRenaming(null)
    if (value.trim() === item.title) return
    await onRename(item, value.trim())
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
                    aria-invalid={Boolean(renaming.problem)}
                    onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null) }}
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  {renaming.problem && (
                    <span className="teacher-recent-row__rename-problem" role="alert">{renaming.problem}</span>
                  )}
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
            {duplicatingId === item.id ? (
              <span className="teacher-recent-row__busy" role="status">Duplicating…</span>
            ) : (
              <span className="teacher-recent-row__time">{item.timeLabel}</span>
            )}
            <span className={`teacher-recent-row__status teacher-recent-row__status--${item.status}`}>
              {item.status === 'draft' ? 'Draft' : 'Ready'}
            </span>
            <RowMenu
              item={item}
              busy={duplicatingId === item.id}
              onRenameStart={(it) => setRenaming({ id: it.id, value: it.title })}
              onDuplicate={handleDuplicate}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
