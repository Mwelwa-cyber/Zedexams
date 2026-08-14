import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import Icon from '../../../shared/components/Icon'
import { Plus, Download, RefreshCw, GraduationCap } from '../../../shared/components/icons'
import { useSettingsSave } from '../lib/useSettingsSave'
import { useTeachingProfile } from '../lib/useTeachingProfile'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { teacherTimetableDescriptor } from '../../../hooks/draft/descriptors/handBuilt'
import DraftRecoveryPrompt from '../../../shared/components/DraftRecoveryPrompt'
import DraftStatusIndicator from '../../../shared/components/DraftStatusIndicator'
import { getGeneration } from '../../../utils/teacherLibraryService'
import {
  TT_DAY_LABELS,
  isTimetableV2,
  normalizeTeacherTimetable,
  migrateTimetableV1,
  computeWorkload,
  formatTeachingMinutes,
  mergeImportedBlocks,
  reconcileLinkedBlocks,
} from '../../../utils/teacherTimetableCore'
import { TIMETABLE_DAYS } from '../../../utils/teacherSettingsCore'
import { TimetableWeekGrid, TimetableListView } from '../components/timetable/TimetableViews'
import PeriodEditorModal from '../components/timetable/PeriodEditorModal'
import ImportClassTimetableModal from '../components/timetable/ImportClassTimetableModal'

const COVERAGE_STATUS_LABELS = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  'over-allocated': 'Over-allocated',
  'not-scheduled': 'Not scheduled',
  invalid: 'Invalid',
}

// My Teaching Timetable — the logged-in teacher's PERSONAL schedule, workload
// and assignment-coverage view. It deliberately does NOT rebuild a class's
// full timetable (assembly, breaks, every subject) — that stays in the Class
// Timetable Studio, which this page links to and syncs from. Every curriculum
// period here references a Teaching Assignment; the page keeps no grade or
// subject lists of its own.
export default function TimetablePanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const { uid, loading: profileLoading, assignments } = useTeachingProfile()
  const { run, saving, saved, error } = useSettingsSave()

  // Stored doc → v2. A legacy v1 grid is migrated in memory against the
  // teacher's assignments (confident matches link up; the rest become
  // needs-review with their original values preserved). Nothing is written
  // back until the teacher saves — the v1 value rides along under legacyV1.
  const source = useMemo(() => {
    const raw = userProfile?.timetable
    if (isTimetableV2(raw)) return normalizeTeacherTimetable(raw)
    return migrateTimetableV1(raw || {}, assignments)
  }, [userProfile?.timetable, assignments])

  const [doc, setDoc] = useState(null) // null → follow `source` until edited
  const [editorBlock, setEditorBlock] = useState(null) // block | 'new' | null
  const [linkedDetail, setLinkedDetail] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [syncMessages, setSyncMessages] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [highlightAssignmentId, setHighlightAssignmentId] = useState('')
  const [dayView, setDayView] = useState('mon')

  const view = doc || source
  const dirty = useMemo(
    () => doc != null && JSON.stringify(doc) !== JSON.stringify(source),
    [doc, source],
  )

  // Refresh/network protection: the working doc is continuously mirrored to
  // the local draft store (IndexedDB + cloud) and offered back after a reload.
  const draft = useDraftManager({
    studioId: 'settings_timetable',
    uid,
    draftId: 'settings_timetable-current',
    descriptor: teacherTimetableDescriptor,
    state: { doc: view },
    enabled: !!uid && !profileLoading && dirty,
    onRestore: (payload) => {
      if (payload?.doc) setDoc(normalizeTeacherTimetable(payload.doc))
    },
  })

  const workload = useMemo(
    () => computeWorkload({ assignments, blocks: view.scheduleBlocks }),
    [assignments, view.scheduleBlocks],
  )
  const conflictBlockIds = useMemo(
    () => new Set(workload.conflicts.flatMap((c) => c.blockIds)),
    [workload.conflicts],
  )
  const reviewBlocks = view.scheduleBlocks.filter((b) => b.migrationState === 'needs-review')
  const unsyncedBlocks = view.scheduleBlocks.filter(
    (b) => b.syncState === 'source-missing' || b.syncState === 'source-updated',
  )

  const updateDoc = useCallback((patch) => {
    setDoc((prev) => normalizeTeacherTimetable({ ...(prev || source), ...patch }))
  }, [source])

  const setBlocks = useCallback((blocks) => updateDoc({ scheduleBlocks: blocks }), [updateDoc])

  const onSave = () =>
    run(async () => {
      const next = normalizeTeacherTimetable(view)
      await updateProfileFields({ timetable: next })
      setDoc(null) // follow the new stored value
      draft.clear()
    })

  const upsertBlock = (block) => {
    const rest = view.scheduleBlocks.filter((b) => b.blockId !== block.blockId)
    setBlocks([...rest, block])
    setEditorBlock(null)
  }

  const removeBlock = (blockId) => {
    setBlocks(view.scheduleBlocks.filter((b) => b.blockId !== blockId))
    setEditorBlock(null)
    setLinkedDetail(null)
  }

  const onImport = (blocks) => {
    setBlocks(mergeImportedBlocks(view.scheduleBlocks, blocks))
    setImportOpen(false)
  }

  // Re-fetch every linked source timetable and reconcile: moved blocks update
  // in place, deleted sources are kept but marked — never silently removed.
  const refreshSync = async () => {
    const ids = [...new Set(view.scheduleBlocks
      .filter((b) => b.sourceType === 'class-timetable' && b.classTimetableId)
      .map((b) => b.classTimetableId))]
    if (ids.length === 0) return
    setSyncing(true)
    try {
      const sources = {}
      await Promise.all(ids.map(async (id) => {
        try {
          sources[id] = await getGeneration(id)
        } catch (err) {
          console.error('Timetable sync fetch failed:', err)
          // Leave unfetched → reconcile skips it rather than guessing.
        }
      }))
      const { blocks, changes } = reconcileLinkedBlocks(view.scheduleBlocks, sources)
      setBlocks(blocks)
      setSyncMessages(changes.length ? changes : ['Everything is in sync with your class timetables.'])
    } finally {
      setSyncing(false)
    }
  }

  const onEditBlock = (block) => {
    if (block.sourceType === 'class-timetable') setLinkedDetail(block)
    else setEditorBlock(block)
  }

  const hasAssignments = assignments.length > 0
  const hasBlocks = view.scheduleBlocks.length > 0
  const viewMode = view.displayPreferences.viewMode

  return (
    <SettingsDetailShell
      rowId="timetable"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <DraftRecoveryPrompt {...draft} label="timetable" />

      {/* Header actions */}
      <div className="tset-ttb-actions">
        <button type="button" className="tset-btn tset-btn--sm" onClick={() => setEditorBlock('new')} disabled={!hasAssignments}>
          <Icon as={Plus} size="sm" aria-hidden="true" /> Add period
        </button>
        <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={() => setImportOpen(true)}>
          <Icon as={Download} size="sm" aria-hidden="true" /> Import from Class Timetable
        </button>
        <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={refreshSync}
          disabled={syncing || !view.scheduleBlocks.some((b) => b.sourceType === 'class-timetable')}>
          <Icon as={RefreshCw} size="sm" aria-hidden="true" /> {syncing ? 'Syncing…' : 'Refresh sync'}
        </button>
        <Link to="/settings/teaching-profile" className="tset-btn tset-btn--ghost tset-btn--sm">
          <Icon as={GraduationCap} size="sm" aria-hidden="true" /> Add Teaching Assignment
        </Link>
        <span className="tset-ttb-actions__status">
          <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
        </span>
      </div>

      {/* Sync + review alerts */}
      {syncMessages.length > 0 && (
        <div className="tset-ttb-alert tset-ttb-alert--info" role="status">
          {syncMessages.map((m, i) => <p key={i}>{m}</p>)}
        </div>
      )}
      {reviewBlocks.length > 0 && (
        <div className="tset-ttb-alert tset-ttb-alert--error" role="alert">
          <p>
            <strong>Needs review:</strong> {reviewBlocks.length} period{reviewBlocks.length === 1 ? '' : 's'} from your
            old timetable could not be matched to a valid Teaching Assignment. The original values are preserved —
            open each one below to attach it to an assignment.
          </p>
        </div>
      )}

      {/* Weekly workload summary */}
      <section className="tset-section">
        <h2 className="tset-section__title">Weekly workload</h2>
        <dl className="tset-ttb-stats">
          <div><dt>Assigned load</dt><dd>{workload.assignedPeriods} periods</dd></div>
          <div><dt>Scheduled</dt><dd>{workload.scheduledPeriods} periods</dd></div>
          <div><dt>Unscheduled</dt><dd>{workload.unscheduledPeriods} periods</dd></div>
          <div><dt>Teaching time</dt><dd>{formatTeachingMinutes(workload.teachingMinutes)}</dd></div>
          <div><dt>Linked periods</dt><dd>{workload.linkedPeriods}</dd></div>
          <div><dt>Manual periods</dt><dd>{workload.manualPeriods + workload.legacyPeriods}</dd></div>
          <div><dt>Double periods</dt><dd>{workload.doublePeriods}</dd></div>
          <div><dt>Conflicts</dt><dd>{workload.conflictCount}</dd></div>
          <div><dt>Needs review</dt><dd>{workload.needsReviewCount}</dd></div>
        </dl>
      </section>

      {/* Assignment coverage */}
      <section className="tset-section">
        <h2 className="tset-section__title">Assignment coverage</h2>
        {!hasAssignments ? (
          <div className="tset-ttb-empty">
            <p><strong>Set up Teaching Assignments</strong></p>
            <p className="tset-section__hint">
              Your timetable is built from your Teaching Assignments — each one carries its curriculum,
              grade, subject, class and weekly periods.
            </p>
            <Link to="/settings/teaching-profile" className="tset-btn tset-btn--sm">Set up Teaching Assignments</Link>
          </div>
        ) : (
          <div className="tset-ttb-gridwrap">
            <table className="tset-ttb-coverage" aria-label="Assignment coverage">
              <thead>
                <tr>
                  <th scope="col">Teaching Assignment</th>
                  <th scope="col">Required</th>
                  <th scope="col">Scheduled</th>
                  <th scope="col">Remaining</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {workload.coverage.map((c) => (
                  <tr
                    key={c.assignmentId}
                    className={highlightAssignmentId === c.assignmentId ? 'tset-ttb-coverage__row--active' : ''}
                  >
                    <td>
                      <button
                        type="button"
                        className="tset-ttb-link"
                        onClick={() => setHighlightAssignmentId((cur) => (cur === c.assignmentId ? '' : c.assignmentId))}
                        aria-pressed={highlightAssignmentId === c.assignmentId}
                      >
                        {c.label}
                      </button>
                    </td>
                    <td>{c.required ?? '—'}</td>
                    <td>{c.scheduled}</td>
                    <td>{c.remaining ?? '—'}</td>
                    <td>
                      <span className={`tset-ttb-badge tset-ttb-badge--${c.status === 'complete' ? 'ok' : c.status === 'invalid' || c.status === 'over-allocated' ? 'error' : 'warn'}`}>
                        {COVERAGE_STATUS_LABELS[c.status] || c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Display preferences */}
      <section className="tset-section">
        <h2 className="tset-section__title">Display</h2>
        <div className="tset-grid">
          <FieldRow label="Default period length (minutes)" htmlFor="tt-mins"
            help="Used only as a fallback for manual periods. Linked Teaching Assignments and class timetable blocks keep their own duration.">
            <input
              id="tt-mins"
              className="studio-input"
              type="number"
              min={5}
              max={240}
              value={view.defaultPeriodLengthMinutes}
              onChange={(e) => updateDoc({ defaultPeriodLengthMinutes: Number(e.target.value) || 40 })}
            />
          </FieldRow>
          <FieldRow label="Timetable layout" htmlFor="tt-layout" help="A presentation preference — changing it never moves your periods.">
            <select
              id="tt-layout"
              className="studio-input"
              value={view.displayPreferences.timetableLayout}
              onChange={(e) => updateDoc({ displayPreferences: { ...view.displayPreferences, timetableLayout: e.target.value } })}
            >
              <option value="days-as-columns">Days across the top</option>
              <option value="days-as-rows">Days down the left</option>
            </select>
          </FieldRow>
        </div>
      </section>

      {/* Weekly teaching timetable */}
      <section className="tset-section">
        <div className="tset-ttb-viewhead">
          <h2 className="tset-section__title">Weekly teaching timetable</h2>
          <div className="tset-ttb-viewtabs" role="tablist" aria-label="Timetable view">
            {[['grid', 'Week grid'], ['day', 'Daily view'], ['list', 'List view']].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                className={`tset-chip${viewMode === mode ? ' tset-chip--on' : ''}`}
                onClick={() => updateDoc({ displayPreferences: { ...view.displayPreferences, viewMode: mode } })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!hasBlocks ? (
          <div className="tset-ttb-empty">
            <p><strong>No teaching periods scheduled</strong></p>
            <p className="tset-section__hint">
              {hasAssignments
                ? 'Import your lessons from a saved Class Timetable, or schedule one of your Teaching Assignments manually.'
                : 'Add Teaching Assignments first, then import your lessons from a saved Class Timetable or schedule a period manually.'}
            </p>
            <div className="tset-ttb-empty__actions">
              {!hasAssignments && (
                <Link to="/settings/teaching-profile" className="tset-btn tset-btn--sm">Add Teaching Assignment</Link>
              )}
              <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={() => setImportOpen(true)}>
                Import from Class Timetable
              </button>
              {hasAssignments && (
                <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={() => setEditorBlock('new')}>
                  Add period manually
                </button>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <TimetableWeekGrid
            blocks={view.scheduleBlocks}
            layout={view.displayPreferences.timetableLayout}
            conflictBlockIds={conflictBlockIds}
            highlightAssignmentId={highlightAssignmentId}
            onEdit={onEditBlock}
          />
        ) : viewMode === 'day' ? (
          <>
            <div className="tset-ttb-viewtabs" role="tablist" aria-label="Day">
              {TIMETABLE_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={dayView === d}
                  className={`tset-chip${dayView === d ? ' tset-chip--on' : ''}`}
                  onClick={() => setDayView(d)}
                >
                  {TT_DAY_LABELS[d]}
                </button>
              ))}
            </div>
            <TimetableListView
              blocks={view.scheduleBlocks}
              day={dayView}
              conflictBlockIds={conflictBlockIds}
              highlightAssignmentId={highlightAssignmentId}
              onEdit={onEditBlock}
            />
          </>
        ) : (
          <TimetableListView
            blocks={view.scheduleBlocks}
            conflictBlockIds={conflictBlockIds}
            highlightAssignmentId={highlightAssignmentId}
            onEdit={onEditBlock}
          />
        )}
      </section>

      {/* Conflicts and warnings */}
      {workload.conflicts.length > 0 && (
        <section className="tset-section">
          <h2 className="tset-section__title">Conflicts and warnings</h2>
          <ul className="tset-ttb-conflicts">
            {workload.conflicts.map((c, i) => (
              <li key={i} className={`tset-ttb-conflicts__item tset-ttb-conflicts__item--${c.severity}`}>
                <span className={`tset-ttb-badge tset-ttb-badge--${c.severity === 'error' ? 'error' : 'warn'}`}>
                  {c.severity === 'error' ? 'Conflict' : 'Warning'}
                </span>{' '}
                {c.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Unsynchronised / review periods */}
      {(unsyncedBlocks.length > 0 || reviewBlocks.length > 0) && (
        <section className="tset-section">
          <h2 className="tset-section__title">Periods needing attention</h2>
          <ul className="tset-ttb-conflicts">
            {reviewBlocks.map((b) => (
              <li key={b.blockId} className="tset-ttb-conflicts__item tset-ttb-conflicts__item--error">
                <span className="tset-ttb-badge tset-ttb-badge--error">Needs review</span>{' '}
                {TT_DAY_LABELS[b.day]} {b.startTime}–{b.endTime} — saved as{' '}
                {b.snapshot.label || 'an unrecognised subject'}, which is not available in your current
                Teaching Assignments. Original values preserved.{' '}
                <button type="button" className="tset-ttb-link" onClick={() => setEditorBlock(b)}>Review</button>
              </li>
            ))}
            {unsyncedBlocks.map((b) => (
              <li key={b.blockId} className="tset-ttb-conflicts__item tset-ttb-conflicts__item--warning">
                <span className="tset-ttb-badge tset-ttb-badge--warn">
                  {b.syncState === 'source-missing' ? 'Source missing' : 'Source updated'}
                </span>{' '}
                {b.snapshot.label || 'Linked period'} ({TT_DAY_LABELS[b.day]} {b.startTime}–{b.endTime})
                {b.syncState === 'source-missing'
                  ? ' — the linked Class Timetable block no longer exists. You can remove it or keep it as a record.'
                  : ' — updated from the source class timetable.'}
                {' '}
                <button type="button" className="tset-ttb-link" onClick={() => setLinkedDetail(b)}>Details</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Modals */}
      {editorBlock && (
        <PeriodEditorModal
          open
          initial={editorBlock === 'new' ? null : editorBlock}
          blocks={view.scheduleBlocks}
          assignments={assignments}
          defaultPeriodLengthMinutes={view.defaultPeriodLengthMinutes}
          onSubmit={upsertBlock}
          onClose={() => setEditorBlock(null)}
          onDelete={editorBlock === 'new' ? null : () => removeBlock(editorBlock.blockId)}
        />
      )}
      {importOpen && (
        <ImportClassTimetableModal
          open
          uid={uid}
          assignments={assignments}
          existingBlocks={view.scheduleBlocks}
          onImport={onImport}
          onClose={() => setImportOpen(false)}
        />
      )}
      {linkedDetail && (
        <div className="tset-tp-modal__overlay" role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setLinkedDetail(null) }}>
          <div className="tset-tp-modal" role="dialog" aria-modal="true" aria-label="Linked period details">
            <header className="tset-tp-modal__head">
              <h2 className="tset-section__title">Linked from Class Timetable</h2>
              <button type="button" className="tset-tp-iconbtn" onClick={() => setLinkedDetail(null)} aria-label="Close">✕</button>
            </header>
            <div className="tset-tp-modal__body">
              <p><strong>{linkedDetail.snapshot.label || 'Teaching period'}</strong></p>
              <p>
                {TT_DAY_LABELS[linkedDetail.day]} {linkedDetail.startTime}–{linkedDetail.endTime}
                {linkedDetail.blockType === 'double' ? ' · Double period' : ' · Single period'}
                {linkedDetail.roomId ? ` · ${linkedDetail.roomId}` : ''}
              </p>
              <p className="tset-help">
                This period is read-only here — it mirrors a block in your class timetable
                {linkedDetail.syncState === 'source-missing' ? ' (which no longer exists)' : ''}.
                Edit it in the Class Timetable Studio and use Refresh sync to pick up the change.
              </p>
              <div className="tset-tp-modal__actions">
                <button
                  type="button"
                  className="tset-btn tset-btn--danger tset-btn--sm"
                  onClick={() => removeBlock(linkedDetail.blockId)}
                >
                  Remove from my timetable
                </button>
                <Link to={`/teacher/library/${linkedDetail.classTimetableId}`} className="tset-btn tset-btn--sm">
                  Open class timetable
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </SettingsDetailShell>
  )
}
