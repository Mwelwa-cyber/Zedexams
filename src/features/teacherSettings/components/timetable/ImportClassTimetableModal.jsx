import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useFocusTrap from '../../../../hooks/useFocusTrap'
import { listMyGenerations } from '../../../../utils/teacherLibraryService'
import { normalizeAssignment, validateAssignment, assignmentLabel } from '../../../../utils/teachingProfileCore'
import {
  TT_DAY_LABELS,
  buildImportCandidates,
  candidateToBlock,
  linkKey,
} from '../../../../utils/teacherTimetableCore'

/**
 * Import lessons from the teacher's saved Class Timetable Studio documents.
 * Candidates are matched to Teaching Assignments by stable ids where the
 * source block carries them, else suggested by subject/label — and the teacher
 * confirms each assignment before import (a label hit alone never links
 * silently). Re-importing updates existing linked entries via their stable
 * linkKey (classTimetableId:scheduleBlockId) — it never duplicates.
 *
 * Props: open, uid, assignments, existingBlocks, onImport(blocks[]), onClose()
 */
export default function ImportClassTimetableModal({
  open,
  uid,
  assignments = [],
  existingBlocks = [],
  onImport,
  onClose,
}) {
  const panelRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sources, setSources] = useState([])
  // candidate key → { selected, assignmentId }
  const [choices, setChoices] = useState({})

  useFocusTrap(panelRef, { active: open, onEscape: () => onClose?.() })

  useEffect(() => {
    if (!open || !uid) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    listMyGenerations({ uid, tool: 'class_timetable' })
      .then((rows) => {
        if (cancelled) return
        setSources((rows || []).filter((r) => r.tool === 'class_timetable'))
      })
      .catch((err) => {
        console.error('Class timetable import list failed:', err)
        if (!cancelled) setError('Could not load your saved class timetables. Check your connection and try again.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, uid])

  const validAssignments = useMemo(
    () => (assignments || []).filter((a) => a?.id && normalizeAssignment(a).isActive && validateAssignment(a).valid),
    [assignments],
  )

  const alreadyLinked = useMemo(
    () => new Set((existingBlocks || []).map((b) => linkKey(b)).filter(Boolean)),
    [existingBlocks],
  )

  const groups = useMemo(
    () =>
      sources.map((g) => ({
        generation: g,
        title: g.inputs?.grade
          ? `${g.inputs.grade}${g.output?.header?.className ? ` · ${g.output.header.className}` : ''}`
          : 'Class timetable',
        candidates: buildImportCandidates({ generation: g, assignments, teacherId: uid }),
      })).filter((g) => g.candidates.length > 0),
    [sources, assignments, uid],
  )

  if (!open) return null

  const keyOf = (c) => `${c.classTimetableId}:${c.scheduleBlockId}`
  const choiceFor = (c) => choices[keyOf(c)] || {
    selected: alreadyLinked.has(keyOf(c)),
    assignmentId: c.suggestedAssignmentId,
  }
  const setChoice = (c, patch) =>
    setChoices((prev) => ({ ...prev, [keyOf(c)]: { ...choiceFor(c), ...patch } }))

  const selectedCandidates = groups
    .flatMap((g) => g.candidates)
    .map((c) => ({ candidate: c, choice: choiceFor(c) }))
    .filter(({ choice }) => choice.selected && choice.assignmentId)

  const handleImport = (list) => {
    const blocks = list.map(({ candidate, choice }) =>
      candidateToBlock(candidate, validAssignments.find((a) => a.id === choice.assignmentId)),
    )
    onImport(blocks)
  }

  const selectAll = () => {
    const next = {}
    for (const g of groups) {
      for (const c of g.candidates) {
        const cur = choiceFor(c)
        next[keyOf(c)] = { selected: !!cur.assignmentId, assignmentId: cur.assignmentId }
      }
    }
    setChoices(next)
  }

  const titleId = 'tt-import-modal-title'

  return (
    <div className="tset-tp-modal__overlay" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="tset-tp-modal tset-tp-modal--wide" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <div className="tset-tp-modal__handle" aria-hidden="true" />
        <header className="tset-tp-modal__head">
          <h2 id={titleId} className="tset-section__title">Import from Class Timetable</h2>
          <button type="button" className="tset-tp-iconbtn" onClick={() => onClose?.()} aria-label="Close">✕</button>
        </header>

        <div className="tset-tp-modal__body">
          {loading && <p className="tset-section__hint">Loading your saved class timetables…</p>}
          {error && <p className="tset-savebar__status tset-savebar__status--error" role="alert">{error}</p>}

          {!loading && !error && groups.length === 0 && (
            <p className="tset-section__hint">
              No lessons found in your saved class timetables. Build one in the{' '}
              <Link to="/teacher/generate/class-timetable">Class Timetable Studio</Link> first.
            </p>
          )}

          {!loading && groups.map((g) => (
            <section key={g.generation.id} className="tset-ttb-import-group">
              <header className="tset-ttb-import-group__head">
                <h3 className="tset-ttb-import-group__title">{g.title}</h3>
                <Link to={`/teacher/library/${g.generation.id}`} className="tset-ttb-link">
                  Open source timetable
                </Link>
              </header>
              <ul className="tset-ttb-import-list">
                {g.candidates.map((c) => {
                  const choice = choiceFor(c)
                  const key = keyOf(c)
                  const linked = alreadyLinked.has(key)
                  return (
                    <li key={key} className="tset-ttb-import-row">
                      <label className="tset-ttb-import-row__check">
                        <input
                          type="checkbox"
                          checked={choice.selected}
                          onChange={(e) => setChoice(c, { selected: e.target.checked })}
                          aria-label={`Import ${c.label} on ${TT_DAY_LABELS[c.day]} at ${c.startTime}`}
                        />
                        <span>
                          <strong>{c.label || 'Lesson'}</strong>
                          {' · '}{TT_DAY_LABELS[c.day]} {c.startTime}–{c.endTime}
                          {c.lengthInPeriods >= 2 ? ' · Double period' : ' · Single period'}
                          {linked ? ' · Already linked (re-import updates it)' : ''}
                        </span>
                      </label>
                      <select
                        className="studio-input tset-ttb-import-row__assignment"
                        value={choice.assignmentId}
                        onChange={(e) => setChoice(c, { assignmentId: e.target.value })}
                        aria-label={`Teaching Assignment for ${c.label}`}
                      >
                        <option value="">Attach to assignment…</option>
                        {validAssignments.map((a) => (
                          <option key={a.id} value={a.id}>{assignmentLabel(a)}</option>
                        ))}
                      </select>
                      {choice.selected && !choice.assignmentId && (
                        <p className="tset-ttb-warning">Choose a Teaching Assignment to import this lesson.</p>
                      )}
                      {c.matchType === 'label' && choice.assignmentId === c.suggestedAssignmentId && (
                        <p className="tset-help">Suggested by subject name — please confirm it's the right assignment.</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          <div className="tset-tp-modal__actions">
            <button type="button" className="tset-btn tset-btn--ghost" onClick={() => onClose?.()}>Cancel</button>
            {groups.length > 0 && (
              <>
                <button type="button" className="tset-btn tset-btn--ghost" onClick={selectAll}>
                  Select all matched
                </button>
                <button
                  type="button"
                  className="tset-btn"
                  disabled={selectedCandidates.length === 0}
                  onClick={() => handleImport(selectedCandidates)}
                >
                  Import selected ({selectedCandidates.length})
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
