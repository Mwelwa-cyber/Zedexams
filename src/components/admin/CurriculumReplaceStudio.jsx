import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'

import SeoHelmet from '../seo/SeoHelmet'
import {
  activateVersion,
  auditArchivedData,
  deleteArchivedRag,
  deleteOldVersion,
  formatSubject,
  getActiveVersionMeta,
  invalidateKbCache,
  isPlausibleVersionId,
  rollbackVersion,
  subscribeDraftSummary,
  subscribeUploadStatus,
  suggestNextVersionId,
  uploadSyllabusFile,
} from '../../utils/syllabusReplaceService'
import { expandKbLessons } from '../../utils/adminCbcKbService'

const ACCEPT_XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * /admin/curriculum/replace
 *
 * End-to-end admin flow that supersedes the per-topic CbcKbAdmin form for
 * the case where a whole new national syllabus is replacing the previous
 * one. Reads/writes only happen through:
 *   - Storage at syllabus-uploads/{version}/{filename}.xlsx (the
 *     parseSyllabusUpload Cloud Function trigger parses each on finalize)
 *   - Firestore at cbcKnowledgeBase/{version}/{draftTopics,pacing,uploadStatus}
 *   - The activateSyllabusVersion callable (atomic promote + flip)
 */
export default function CurriculumReplaceStudio() {
  const [activeMeta, setActiveMeta] = useState(null)
  const [activeMetaStatus, setActiveMetaStatus] = useState('loading')
  const [versionId, setVersionId] = useState(() => suggestNextVersionId())
  const [versionLocked, setVersionLocked] = useState(false)

  const [uploads, setUploads] = useState([]) // [{ id, filename, upload, status, topicCount, error }]
  const [uploadStatusRows, setUploadStatusRows] = useState([])
  const [draftSummary, setDraftSummary] = useState({
    topicCount: 0, subtopicCount: 0, bySubject: {}, byGrade: {}, topics: [],
  })

  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [expandedSubject, setExpandedSubject] = useState(null)

  // Workspace tab — separates the sequential workflow from versions/audit
  // and the destructive cleanup actions. Audit is read-only; the two
  // delete paths are gated behind explicit user input (typed version
  // for delete-version, and a usePrivateCurriculum=false precondition
  // the server also enforces for delete-rag).
  const [activeTab, setActiveTab] = useState('workflow')
  const [audit, setAudit] = useState(null)
  const [deleteVersionInput, setDeleteVersionInput] = useState('')
  const [deleteVersionConfirm, setDeleteVersionConfirm] = useState('')
  const [expandingLessons, setExpandingLessons] = useState(false)
  const [expandResult, setExpandResult] = useState(null)
  const [expandError, setExpandError] = useState(null)

  // Phase 3 — session-only activity log fed by flashToast. Resets on
  // page reload; not persisted to Firestore.
  const [activity, setActivity] = useState([])

  const fileInputRef = useRef(null)
  const dropRef = useRef(null)

  function pushActivity(msg) {
    const level = /(✓|↩)/.test(msg) ? 'ok' :
      /(fail|error|refus|cannot|can't|Wait —)/i.test(msg) ? 'error' :
        /(PERMANENT|delete|destroy)/i.test(msg) ? 'warn' :
          'info'
    setActivity((a) => [
      { ts: Date.now(), level, msg },
      ...a,
    ].slice(0, 30))
  }

  function flashToast(msg, ms = 6000) {
    setToast(msg)
    pushActivity(msg)
    setTimeout(() => setToast(''), ms)
  }

  const loadActiveMeta = useCallback(async () => {
    setActiveMetaStatus('loading')
    try {
      const meta = await getActiveVersionMeta()
      setActiveMeta(meta)
      setActiveMetaStatus('ready')
    } catch {
      setActiveMetaStatus('error')
    }
  }, [])

  useEffect(() => { loadActiveMeta() }, [loadActiveMeta])

  // Live subscriptions for the locked-in version's uploadStatus + drafts.
  useEffect(() => {
    if (!versionLocked || !isPlausibleVersionId(versionId)) {
      return undefined
    }
    const unsubStatus = subscribeUploadStatus(versionId, (r) => {
      if (r.ok) setUploadStatusRows(r.rows)
    })
    const unsubSummary = subscribeDraftSummary(versionId, (r) => {
      if (r.ok) {
        setDraftSummary({
          topicCount: r.topicCount,
          subtopicCount: r.subtopicCount,
          bySubject: r.bySubject,
          byGrade: r.byGrade,
          topics: r.topics,
        })
      }
    })
    return () => { unsubStatus(); unsubSummary() }
  }, [versionLocked, versionId])

  // Drag-drop wiring on the dedicated drop zone.
  useEffect(() => {
    const el = dropRef.current
    if (!el) return undefined
    const prevent = (e) => { e.preventDefault(); e.stopPropagation() }
    const onDrop = (e) => {
      prevent(e)
      const files = Array.from(e.dataTransfer?.files || [])
      if (files.length) handleFiles(files)
    }
    el.addEventListener('dragenter', prevent)
    el.addEventListener('dragover', prevent)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragenter', prevent)
      el.removeEventListener('dragover', prevent)
      el.removeEventListener('drop', onDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionLocked, versionId])

  // Phase 4 — Escape closes whichever confirm modal is open. Standard
  // dialog UX; no behavioural change beyond intercepting Esc.
  useEffect(() => {
    if (!confirmOpen && !rollbackConfirmOpen) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (confirmOpen) setConfirmOpen(false)
      if (rollbackConfirmOpen) setRollbackConfirmOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmOpen, rollbackConfirmOpen])

  function handleFiles(files) {
    if (!versionLocked) {
      flashToast('Choose a version first, then upload files.')
      return
    }
    const xlsxFiles = files.filter((f) => /\.xlsx$/i.test(f.name))
    if (xlsxFiles.length === 0) {
      flashToast('Only .xlsx files are accepted.')
      return
    }
    for (const file of xlsxFiles) {
      const id = `${Date.now()}-${file.name}`
      setUploads((rows) => [
        ...rows,
        {
          id, filename: file.name, upload: 0, status: 'uploading',
          topicCount: null, error: null,
        },
      ])
      uploadSyllabusFile({
        version: versionId,
        file,
        onProgress: ({ bytesTransferred, totalBytes }) => {
          const pct = totalBytes ?
            Math.round((bytesTransferred / totalBytes) * 100) : 0
          setUploads((rows) => rows.map(
            (r) => (r.id === id ? { ...r, upload: pct } : r),
          ))
        },
      }).then(() => {
        setUploads((rows) => rows.map(
          (r) => (r.id === id ? { ...r, upload: 100, status: 'parsing' } : r),
        ))
      }).catch((err) => {
        setUploads((rows) => rows.map(
          (r) => (r.id === id ? {
            ...r, status: 'error', error: err?.message || 'Upload failed.',
          } : r),
        ))
      })
    }
  }

  // Merge parse status from Firestore into the per-file UI rows.
  const uploadsView = useMemo(() => {
    const byFilename = new Map(uploadStatusRows.map((r) => [r.filename, r]))
    return uploads.map((u) => {
      const fs = byFilename.get(u.filename)
      if (!fs) return u
      return {
        ...u,
        status: fs.status === 'parsed' ? 'parsed' :
          fs.status === 'error' ? 'error' :
            (u.status === 'uploading' ? u.status : 'parsing'),
        topicCount: typeof fs.topicCount === 'number' ? fs.topicCount : u.topicCount,
        error: fs.status === 'error' ? (fs.error || 'Parser failed.') : u.error,
        warnings: Array.isArray(fs.warnings) ? fs.warnings : [],
      }
    })
  }, [uploads, uploadStatusRows])

  const parsedFileCount = uploadsView.filter((u) => u.status === 'parsed').length
  const errorFileCount = uploadsView.filter((u) => u.status === 'error').length
  const inFlightCount = uploadsView.filter(
    (u) => u.status === 'uploading' || u.status === 'parsing',
  ).length

  function onLockVersion() {
    if (!isPlausibleVersionId(versionId)) {
      flashToast('Version must be 3–80 chars (letters/digits/dashes).')
      return
    }
    if (activeMeta && activeMeta.version === versionId) {
      flashToast(
        `"${versionId}" is already the active syllabus. Choose a new version id.`,
      )
      return
    }
    setVersionLocked(true)
  }

  function onResetVersion() {
    setVersionLocked(false)
    setUploads([])
    setUploadStatusRows([])
    setDraftSummary({
      topicCount: 0, subtopicCount: 0, bySubject: {}, byGrade: {}, topics: [],
    })
  }

  async function onActivate() {
    setBusy(true)
    try {
      const result = await activateVersion({
        version: versionId,
        expectedPreviousVersion: activeMeta?.version || null,
      })
      if (result.ok) {
        flashToast(
          `✓ Activated "${result.version}". ` +
          `Promoted ${result.promoted} topics. ` +
          `Old "${result.previousVersion}" archived for rollback.`,
          10_000,
        )
        await loadActiveMeta()
        setConfirmOpen(false)
      } else {
        flashToast(`Activate failed: ${result.error}`, 10_000)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onRefreshCaches() {
    setBusy(true)
    try {
      const result = await invalidateKbCache()
      flashToast(result.ok ?
        `✓ Cache bust counter is now ${result.cacheBust}. ` +
        'Studios will refresh within ~10 seconds.' :
        `Refresh failed: ${result.error}`)
    } finally {
      setBusy(false)
    }
  }

  async function onAudit() {
    setBusy(true)
    try {
      const result = await auditArchivedData()
      if (result.ok) {
        setAudit(result)
      } else {
        flashToast(`Audit failed: ${result.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteRag() {
    if (!window.confirm(
      'PERMANENTLY DELETE the legacy RAG data (curriculum/* + rag_chunks/*)?\n\n' +
      'This is irreversible. The server will also refuse if RAG fallback ' +
      'is still on (usePrivateCurriculum=true on _meta).',
    )) return
    setBusy(true)
    try {
      const result = await deleteArchivedRag()
      if (result.ok) {
        flashToast(
          `✓ Deleted curriculum/* (${result.deleted.curriculum}) and ` +
          `rag_chunks/* (${result.deleted.rag_chunks}). ` +
          'Re-audit to confirm.',
          10_000,
        )
        setAudit(null)
      } else {
        flashToast(`Delete failed: ${result.error}`, 10_000)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteVersion() {
    if (!deleteVersionInput.trim()) return
    if (deleteVersionInput !== deleteVersionConfirm) {
      flashToast('Type the same version id in both fields to confirm.')
      return
    }
    if (!window.confirm(
      `PERMANENTLY DELETE cbcKnowledgeBase/${deleteVersionInput}/topics/* ` +
      'and every lessons subcollection beneath it?\n\n' +
      'This is irreversible. The server refuses if this version is the ' +
      'current active or current rollback target.',
    )) return
    setBusy(true)
    try {
      const result = await deleteOldVersion({
        version: deleteVersionInput.trim(),
        confirmVersion: deleteVersionConfirm.trim(),
      })
      if (result.ok) {
        flashToast(
          `✓ Deleted ${result.deleted.topics} docs under ` +
          `"${result.version}".`,
          10_000,
        )
        setDeleteVersionInput('')
        setDeleteVersionConfirm('')
        setAudit(null)
      } else {
        flashToast(`Delete failed: ${result.error}`, 10_000)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onRollback() {
    setBusy(true)
    try {
      const result = await rollbackVersion({
        expectedCurrentVersion: activeMeta?.version || null,
      })
      if (result.ok) {
        flashToast(
          `↩ Rolled back to "${result.version}". ` +
          `"${result.previousVersion}" is now the ping-pong target. ` +
          'RAG fallback restored. Studios will refresh within ~10s.',
          10_000,
        )
        await loadActiveMeta()
        setRollbackConfirmOpen(false)
      } else {
        flashToast(`Rollback failed: ${result.error}`, 10_000)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onExpandLessons() {
    setExpandingLessons(true)
    setExpandResult(null)
    setExpandError(null)
    try {
      const result = await expandKbLessons({ version: activeMeta?.version || null })
      if (result.ok) {
        setExpandResult(result)
        flashToast(
          `✓ Expanded lessons on "${result.version}": ` +
          `${result.lessonsWritten} lesson docs written across ${result.topicsScanned} topics.`,
          10_000,
        )
      } else {
        setExpandError(result.error || 'Expand failed.')
        flashToast(`Expand lessons failed: ${result.error}`, 10_000)
      }
    } finally {
      setExpandingLessons(false)
    }
  }

  const activeVersionIsThis = Boolean(
    activeMeta && activeMeta.version === versionId,
  )

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 theme-text">
      <SeoHelmet title="Curriculum Replace · Admin · ZedExams" noindex />

      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-black">
          📚 Curriculum Replace Studio
        </h1>
        <p className="text-sm theme-text-muted">
          Upload a new national syllabus, watch the parser fill drafts,
          review the summary, then activate it. Old version stays in place
          as a rollback target.
        </p>
      </header>

      {/* Status dashboard — surfaces active syllabus, upload progress, drafts, rollback target at a glance */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard
          label="Active syllabus"
          icon="🏷️"
          value={activeMetaStatus === 'loading' ? 'Loading…' :
            (activeMeta?.version || '—')}
          badge={activeMeta ? (activeMeta.usePrivateCurriculum ?
            'RAG fallback ON' : 'Sole source') : null}
          badgeTone={activeMeta?.usePrivateCurriculum ? 'amber' : 'emerald'}
          meta={activeMeta ?
            `Cache bust ${activeMeta.cacheBust}` :
            'No active version yet'}
          tone={activeMeta ?
            (activeMeta.usePrivateCurriculum ? 'amber' : 'emerald') :
            'slate'}
        />
        <StatusCard
          label="Upload progress"
          icon="📤"
          value={!versionLocked ? 'Awaiting version' :
            uploadsView.length === 0 ? 'No files yet' :
              `${parsedFileCount}/${uploadsView.length} parsed`}
          badge={!versionLocked ? null :
            errorFileCount > 0 ? `${errorFileCount} failed` :
              inFlightCount > 0 ? `${inFlightCount} in flight` :
                uploadsView.length > 0 ? 'All parsed' : null}
          badgeTone={errorFileCount > 0 ? 'rose' :
            inFlightCount > 0 ? 'sky' : 'emerald'}
          meta={!versionLocked ? 'Lock a version id first (Step 1)' :
            uploadsView.length === 0 ? 'Drop .xlsx files in Step 2' :
              `${uploadsView.reduce((s, u) => s + (u.topicCount || 0), 0)} topics extracted`}
          tone={errorFileCount > 0 ? 'rose' :
            inFlightCount > 0 ? 'sky' :
              uploadsView.length > 0 && parsedFileCount === uploadsView.length ? 'emerald' :
                'slate'}
        />
        <StatusCard
          label="Draft summary"
          icon="📋"
          value={draftSummary.topicCount === 0 ? '—' :
            `${draftSummary.topicCount} topics`}
          badge={draftSummary.topicCount === 0 ? null :
            versionLocked ? 'Ready to activate' : null}
          badgeTone="emerald"
          meta={draftSummary.topicCount === 0 ? 'No drafts yet' :
            `${draftSummary.subtopicCount} subtopics · ${Object.keys(draftSummary.bySubject).length} subject${Object.keys(draftSummary.bySubject).length !== 1 ? 's' : ''}`}
          tone={draftSummary.topicCount === 0 ? 'slate' : 'emerald'}
        />
        <StatusCard
          label="Rollback target"
          icon="↩️"
          value={activeMeta?.previousVersion || 'None'}
          badge={activeMeta?.previousVersion ? 'Available' : 'First activation'}
          badgeTone={activeMeta?.previousVersion ? 'amber' : 'slate'}
          meta={activeMeta?.previousVersion ?
            'One-click rollback from the toolbar' :
            'No previous version to restore'}
          tone={activeMeta?.previousVersion ? 'amber' : 'slate'}
        />
      </section>

      {/* Quick-action toolbar — same buttons that used to live inside the active-syllabus card */}
      <section className="rounded-2xl border-2 theme-border bg-white p-3 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide theme-text-muted font-bold pl-1 pr-2">
          Quick actions
        </span>
        <button
          type="button"
          onClick={onRefreshCaches}
          disabled={busy}
          className="px-3 py-2 rounded-lg border-2 theme-border font-bold text-sm hover:theme-card-hover disabled:opacity-40"
        >
          🔄 Refresh studio caches
        </button>
        {activeMeta?.previousVersion && (
          <button
            type="button"
            onClick={() => setRollbackConfirmOpen(true)}
            disabled={busy}
            className="px-3 py-2 rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-900 font-bold text-sm hover:bg-amber-100 disabled:opacity-40"
            title={`Roll back to ${activeMeta.previousVersion}`}
          >
            ↩ Rollback to <span className="font-mono">{activeMeta.previousVersion}</span>
          </button>
        )}
        <div className="flex-1 min-w-0" />
        <span className="text-xs theme-text-muted hidden sm:inline">
          Activate appears in Workflow → Step 4 once drafts are parsed
        </span>
      </section>

      {/* Tab bar — separates Workflow (Steps 1-4) from Versions & audit and Danger zone */}
      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'workflow', label: 'Workflow', icon: '📝' },
          { id: 'versions', label: 'Versions & audit', icon: '🏷️' },
          { id: 'danger',   label: 'Danger zone', icon: '🗑️' },
        ]}
      />

      {activeTab === 'workflow' && (
      <div
        role="tabpanel"
        id="panel-workflow"
        aria-labelledby="tab-workflow"
        className="space-y-5"
      >

      {/* Step 1 — version id */}
      <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-3">
        <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
          Step 1 — Name this upload
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            disabled={versionLocked}
            placeholder="cbc-kb-2026-05-national"
            className="flex-1 min-w-[16rem] px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400 disabled:opacity-60 font-mono text-sm"
          />
          {!versionLocked ? (
            <button
              type="button"
              onClick={onLockVersion}
              className="px-4 py-2 rounded-lg font-black text-white bg-gradient-to-r from-emerald-500 to-sky-500"
            >
              Use this version →
            </button>
          ) : (
            <button
              type="button"
              onClick={onResetVersion}
              className="px-4 py-2 rounded-lg border-2 theme-border font-bold text-sm hover:theme-card-hover"
            >
              ← Change version
            </button>
          )}
        </div>
        {!versionLocked && (
          <p className="text-xs theme-text-muted">
            Defaults to <code>cbc-kb-{'{'}YYYY-MM{'}'}-national</code>. Drafts
            and parsed topics are stored under this id; the existing active
            syllabus stays untouched until you click Activate at the bottom.
          </p>
        )}
        {activeVersionIsThis && versionLocked && (
          <p className="text-xs text-rose-700 font-bold">
            ⚠ This is already the active syllabus. Choose a different version
            id to upload a replacement.
          </p>
        )}
      </section>

      {/* Step 2 — upload */}
      {versionLocked && !activeVersionIsThis && (
        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-3">
          <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
            Step 2 — Upload .xlsx files
          </p>
          <div
            ref={dropRef}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            role="button"
            tabIndex={0}
            className="rounded-2xl border-2 border-dashed theme-border bg-slate-50/60 hover:bg-emerald-50/40 cursor-pointer p-6 text-center transition focus:outline-none focus:border-emerald-400"
          >
            <p className="font-black text-base">
              Drop .xlsx files here, or click to browse
            </p>
            <p className="text-xs theme-text-muted mt-1">
              Workbook formats: single-subject syllabi (Mathematics Grade 4),
              ECE multi-subject (ECE Level 4-5), and Scheme-of-Work
              templates. Up to 25 MB per file.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_XLSX}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                if (files.length) handleFiles(files)
                e.target.value = ''
              }}
            />
          </div>
          {uploadsView.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs theme-text-muted">
                <span>{uploadsView.length} file{uploadsView.length !== 1 ? 's' : ''}</span>
                <span>· {parsedFileCount} parsed</span>
                {inFlightCount > 0 && <span>· {inFlightCount} in flight</span>}
                {errorFileCount > 0 && (
                  <span className="text-rose-700 font-bold">
                    · {errorFileCount} failed
                  </span>
                )}
              </div>
              <ul className="divide-y theme-border border-2 theme-border rounded-xl bg-white">
                {uploadsView.map((u) => (
                  <li key={u.id} className="p-3 flex items-start gap-3">
                    <StatusDot status={u.status} />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm truncate">{u.filename}</p>
                      <div className="text-xs theme-text-muted">
                        {u.status === 'uploading' && `Uploading… ${u.upload}%`}
                        {u.status === 'parsing' && 'Parsing on the server…'}
                        {u.status === 'parsed' && (
                          <span>
                            ✓ {u.topicCount ?? 0} topics extracted
                            {u.warnings && u.warnings.length > 0 &&
                              ` · ${u.warnings.length} warning(s)`}
                          </span>
                        )}
                        {u.status === 'error' && (
                          <span className="text-rose-700">{u.error}</span>
                        )}
                      </div>
                      {u.status === 'parsed' && Array.isArray(u.warnings) && u.warnings.length > 0 && (
                        <details className="mt-1.5 text-xs">
                          <summary className="cursor-pointer font-bold text-amber-800 select-none hover:text-amber-900">
                            ⚠ Show {u.warnings.length} parser warning{u.warnings.length !== 1 ? 's' : ''}
                          </summary>
                          <ul className="mt-1.5 ml-3 space-y-0.5 list-disc list-inside text-amber-900 bg-amber-50/60 rounded-lg p-2 border border-amber-200">
                            {u.warnings.map((w, i) => (
                              <li key={i} className="break-words">{w}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Step 3 — review summary */}
      {versionLocked && draftSummary.topicCount > 0 && (
        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-3">
          <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
            Step 3 — Review the parsed drafts
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Topics" value={String(draftSummary.topicCount)} />
            <Stat label="Sub-topics" value={String(draftSummary.subtopicCount)} />
            <Stat
              label="Subjects"
              value={String(Object.keys(draftSummary.bySubject).length)}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs theme-text-muted font-bold uppercase tracking-wide">
              By subject
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(draftSummary.bySubject)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([sj, n]) => {
                  const isOpen = expandedSubject === sj
                  return (
                    <div key={sj} className="rounded-xl border-2 theme-border">
                      <button
                        type="button"
                        onClick={() => setExpandedSubject(isOpen ? null : sj)}
                        className="w-full px-3 py-2 flex items-center justify-between text-sm font-bold hover:theme-card-hover"
                      >
                        <span>{isOpen ? '▾' : '▸'} {formatSubject(sj)}</span>
                        <span className="theme-text-muted">{n}</span>
                      </button>
                      {isOpen && (
                        <ul className="px-3 pb-2 text-xs space-y-1 max-h-64 overflow-y-auto">
                          {draftSummary.topics
                            .filter((t) => (t.subject || '') === sj)
                            .sort((a, b) => String(a.grade).localeCompare(b.grade))
                            .map((t) => (
                              <li key={t.id} className="flex items-baseline gap-2">
                                <span className="font-black text-slate-700 w-12 shrink-0">{t.grade}</span>
                                <span className="truncate">{t.topic}</span>
                                <span className="theme-text-muted">
                                  ({Array.isArray(t.subtopics) ? t.subtopics.length : 0})
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
          <p className="text-xs theme-text-muted">
            Need to correct an individual topic before activating? You can do
            it after activation through the <a href="/admin/cbc-kb" className="underline">CBC KB</a>
            {' '}page — the new topics will appear there once you click
            Activate below.
          </p>
        </section>
      )}

      {/* Step 4 — activate */}
      {versionLocked && draftSummary.topicCount > 0 && (
        <section className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/60 p-4 space-y-3">
          <p className="text-xs uppercase tracking-wide text-emerald-900 font-bold">
            Step 4 — Activate
          </p>
          <p className="text-sm">
            Promote these {draftSummary.topicCount} drafts into the live
            <code className="mx-1 px-1.5 py-0.5 rounded bg-white/70 font-mono">topics/*</code>
            collection and flip every studio to <span className="font-black">{versionId}</span>.
            The current active version (<span className="font-mono">{activeMeta?.version}</span>)
            becomes the one-click rollback target.
          </p>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || inFlightCount > 0}
            className="px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-sky-500 disabled:opacity-50"
          >
            {inFlightCount > 0 ?
              `Wait — ${inFlightCount} file(s) still in flight` :
              `Activate "${versionId}"`}
          </button>
        </section>
      )}

      </div>)}

      {/* Versions & audit tab — surfaces what audit used to hide inside Danger zone */}
      {activeTab === 'versions' && (
      <div
        role="tabpanel"
        id="panel-versions"
        aria-labelledby="tab-versions"
        className="space-y-5"
      >

        {/* Expand lessons — one-click maintenance to write lessons/ subcollection docs
            from the subtopics[] array on every live topic. Safe to run on an already-active
            version: uses merge:true so richer existing lesson data is never overwritten. */}
        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
                Expand lessons on active version
              </p>
              <p className="text-sm theme-text-muted mt-1">
                Writes individual lesson docs (one per subtopic per term) so AI agents
                can resolve subtopics exactly. Run this once after activating any
                version uploaded before this feature existed. Safe to re-run — never
                overwrites richer existing lesson data.
              </p>
            </div>
            <button
              type="button"
              onClick={onExpandLessons}
              disabled={expandingLessons || !activeMeta?.version}
              className="shrink-0 px-3 py-2 rounded-lg border-2 theme-border font-bold text-sm hover:theme-card-hover disabled:opacity-40"
            >
              {expandingLessons ? 'Expanding…' : '📖 Expand lessons'}
            </button>
          </div>
          {expandResult && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs font-mono text-emerald-900">
              ✓ Version: <strong>{expandResult.version}</strong> ·{' '}
              {expandResult.topicsScanned} topics scanned ·{' '}
              <strong>{expandResult.lessonsWritten}</strong> lesson docs written
              {expandResult.skipped > 0 && ` · ${expandResult.skipped} topics skipped (grade/subject filter)`}
            </div>
          )}
          {expandError && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              {expandError}
            </div>
          )}
        </section>

        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
                Versions & audit
              </p>
              <p className="text-sm theme-text-muted mt-1">
                Inventory of KB versions in Firestore plus any legacy RAG data still archived.
              </p>
            </div>
            <button
              type="button"
              onClick={onAudit}
              disabled={busy}
              className="px-3 py-2 rounded-lg border-2 theme-border font-bold text-sm hover:theme-card-hover disabled:opacity-40"
            >
              {busy ? 'Auditing…' : '🔍 Run audit'}
            </button>
          </div>
          {!audit && (
            <div className="rounded-xl border-2 border-dashed theme-border p-6 text-center theme-text-muted">
              <p className="text-sm">
                Click <span className="font-bold">Run audit</span> above to fetch the current Firestore inventory.
              </p>
            </div>
          )}
          {audit && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Stat label="Legacy curriculum/* docs" value={String(audit.counts.curriculum)} />
                <Stat label="Legacy rag_chunks/* docs" value={String(audit.counts.rag_chunks)} />
              </div>
              {Array.isArray(audit.versions) && audit.versions.length > 0 && (
                <div className="rounded-xl border-2 theme-border bg-white p-3 space-y-1.5">
                  <p className="font-bold text-sm mb-1">KB versions in Firestore</p>
                  <ul className="space-y-1.5">
                    {audit.versions.map((v) => (
                      <li
                        key={v.version}
                        className="flex items-center justify-between gap-3 text-sm border-b theme-border last:border-b-0 pb-1.5 last:pb-0"
                      >
                        <div className="flex items-baseline gap-2 min-w-0">
                          <code className="font-mono truncate">{v.version}</code>
                          <span className="theme-text-muted text-xs whitespace-nowrap">
                            {v.topicCount} topics
                          </span>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          {v.version === activeMeta?.version && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              active
                            </span>
                          )}
                          {v.version === activeMeta?.previousVersion && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              rollback target
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Diff card — compares draft topic count to active version's (uses audit data when available) */}
        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-3">
          <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
            Diff vs active version
          </p>
          {!versionLocked || draftSummary.topicCount === 0 ? (
            <p className="text-sm theme-text-muted">
              Lock a version and parse uploads in the Workflow tab to compare topic counts.
            </p>
          ) : !activeMeta ? (
            <p className="text-sm theme-text-muted">
              No active version to compare against.
            </p>
          ) : !audit ? (
            <p className="text-sm theme-text-muted">
              Run <span className="font-bold">🔍 Run audit</span> above to fetch the active version's topic count for a direct comparison.
            </p>
          ) : (
            <DiffStats
              activeVersion={activeMeta.version}
              activeCount={(audit.versions || []).find((v) => v.version === activeMeta.version)?.topicCount}
              draftVersion={versionId}
              draftCount={draftSummary.topicCount}
            />
          )}
        </section>

        {/* Activity feed — session-only log fed by flashToast */}
        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
                Activity (this session)
              </p>
              <p className="text-sm theme-text-muted mt-1">
                Recent toasts captured locally. Resets on page reload.
              </p>
            </div>
            {activity.length > 0 && (
              <button
                type="button"
                onClick={() => setActivity([])}
                className="px-3 py-1.5 rounded-lg border-2 theme-border font-bold text-xs hover:theme-card-hover"
              >
                Clear
              </button>
            )}
          </div>
          {activity.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed theme-border p-6 text-center theme-text-muted">
              <p className="text-sm">No activity yet this session.</p>
            </div>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {activity.map((a, i) => (
                <li
                  key={i}
                  className={`flex items-baseline gap-3 text-sm border-l-[3px] pl-2.5 py-0.5 ${
                    a.level === 'ok' ? 'border-emerald-400' :
                      a.level === 'warn' ? 'border-amber-400' :
                        a.level === 'error' ? 'border-rose-400' :
                          'border-slate-300'
                  }`}
                >
                  <span className="text-[10px] theme-text-muted font-mono shrink-0 whitespace-nowrap">
                    {new Date(a.ts).toLocaleTimeString()}
                  </span>
                  <span className="break-words">{a.msg}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>)}

      {/* Danger zone tab — destructive cleanup, formerly inline-collapsible at page bottom */}
      {activeTab === 'danger' && (
      <div
        role="tabpanel"
        id="panel-danger"
        aria-labelledby="tab-danger"
        className="space-y-5"
      >
        <section className="rounded-2xl border-2 border-rose-200 bg-rose-50/40 p-4">
          <p className="text-xs text-rose-900/90 leading-snug">
            These actions permanently delete data the migration archived.
            Run only after the new syllabus has been live and trusted for
            the verification window (recommend ≥ 2 weeks). The server
            enforces preconditions: RAG-data deletion refuses while RAG is
            still on; version deletion refuses on the active + rollback
            targets.
          </p>
        </section>

        {/* Delete RAG */}
        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-2">
          <p className="font-black text-sm text-rose-900">
            Delete legacy RAG (<code className="font-mono">curriculum/*</code>{' '}+{' '}
            <code className="font-mono">rag_chunks/*</code>)
          </p>
          <p className="text-xs theme-text-muted">
            Pre-Phase-A retrieval-grounding data. The server refuses if
            <code className="mx-1 px-1 rounded bg-rose-100 text-rose-900 font-mono">
              usePrivateCurriculum: true
            </code>
            — activate a Phase-C syllabus first (which sets the flag to
            false), then this deletion becomes available.
          </p>
          <button
            type="button"
            onClick={onDeleteRag}
            disabled={busy || activeMeta?.usePrivateCurriculum !== false}
            className="px-4 py-2 rounded-lg font-black text-white bg-gradient-to-r from-rose-500 to-rose-700 disabled:opacity-40"
          >
            {activeMeta?.usePrivateCurriculum !== false ?
              'RAG path still on — can\'t delete yet' :
              'Delete legacy RAG data'}
          </button>
        </section>

        {/* Delete old version */}
        <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-2">
          <p className="font-black text-sm text-rose-900">
            Delete an old KB version
          </p>
          <p className="text-xs theme-text-muted">
            Permanently removes{' '}
            <code className="font-mono">cbcKnowledgeBase/{'{version}'}/topics/*</code>
            {' '}and every <code>lessons</code> subcollection underneath. The
            server refuses if you target the active version or the rollback
            target — there's no recovery short of a Firestore backup
            restore.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={deleteVersionInput}
              onChange={(e) => setDeleteVersionInput(e.target.value)}
              placeholder="Version id"
              className="px-3 py-2 rounded-lg border-2 theme-border font-mono text-sm focus:outline-none focus:border-rose-400"
            />
            <input
              type="text"
              value={deleteVersionConfirm}
              onChange={(e) => setDeleteVersionConfirm(e.target.value)}
              placeholder="Type version id again to confirm"
              className="px-3 py-2 rounded-lg border-2 theme-border font-mono text-sm focus:outline-none focus:border-rose-400"
            />
          </div>
          <button
            type="button"
            onClick={onDeleteVersion}
            disabled={
              busy ||
              !deleteVersionInput ||
              deleteVersionInput !== deleteVersionConfirm
            }
            className="px-4 py-2 rounded-lg font-black text-white bg-gradient-to-r from-rose-500 to-rose-700 disabled:opacity-40"
          >
            Delete version
          </button>
        </section>
      </div>)}

      {/* Toast — ARIA live region so screen readers announce action results */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="fixed bottom-4 right-4 max-w-md bg-slate-900 text-white text-sm rounded-2xl px-4 py-3 shadow-2xl whitespace-pre-line"
        >
          {toast}
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3">
            <h2 className="text-lg font-black">Activate this syllabus?</h2>
            <p className="text-sm">
              This switches every studio (Lesson Plan, Weekly Forecast,
              Schemes, Assessment, Quiz, Notes, plus all future tools) to
              <span className="font-mono mx-1">{versionId}</span>.
            </p>
            <p className="text-sm">
              The current version (<span className="font-mono">{activeMeta?.version}</span>)
              stays in Firestore and can be restored in one click from this
              page later. RAG fallback turns OFF — the new syllabus is the
              sole source for any topic without a stored sub-topic module.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg border-2 theme-border font-bold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onActivate}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg font-black text-white bg-gradient-to-r from-emerald-500 to-sky-500 disabled:opacity-50"
              >
                {busy ? 'Activating…' : 'Confirm activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rollback modal */}
      {rollbackConfirmOpen && activeMeta?.previousVersion && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3">
            <h2 className="text-lg font-black">↩ Roll back this syllabus?</h2>
            <p className="text-sm">
              Switch every studio back to
              <span className="font-mono mx-1">{activeMeta.previousVersion}</span>.
              Current version
              <span className="font-mono mx-1">{activeMeta.version}</span>
              becomes the new rollback target — you can ping-pong by clicking
              Rollback again.
            </p>
            <p className="text-sm">
              RAG fallback turns back <span className="font-bold">ON</span>.
              No data is moved — both versions' <code>topics/*</code> stay in
              Firestore. Studios will refresh within ~10 seconds.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRollbackConfirmOpen(false)}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg border-2 theme-border font-bold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRollback}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg font-black text-white bg-gradient-to-r from-amber-500 to-rose-500 disabled:opacity-50"
              >
                {busy ? 'Rolling back…' : 'Confirm rollback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const toneClass = tone === 'amber' ?
    'border-amber-300 bg-amber-50/70 text-amber-900' :
    tone === 'emerald' ?
      'border-emerald-300 bg-emerald-50/70 text-emerald-900' :
      'theme-border bg-white'
  return (
    <div className={`rounded-xl border-2 px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide font-bold opacity-70">
        {label}
      </p>
      <p className="text-sm font-black break-all">{value}</p>
    </div>
  )
}

function StatusCard({ label, icon, value, badge, badgeTone, meta, tone }) {
  const toneClass = tone === 'emerald' ?
    'border-emerald-300 bg-emerald-50/40' :
    tone === 'amber' ?
      'border-amber-300 bg-amber-50/40' :
      tone === 'rose' ?
        'border-rose-300 bg-rose-50/40' :
        tone === 'sky' ?
          'border-sky-300 bg-sky-50/40' :
          'theme-border bg-white'
  const badgeClass = badgeTone === 'emerald' ?
    'bg-emerald-100 text-emerald-900' :
    badgeTone === 'amber' ?
      'bg-amber-100 text-amber-900' :
      badgeTone === 'rose' ?
        'bg-rose-100 text-rose-900' :
        badgeTone === 'sky' ?
          'bg-sky-100 text-sky-900' :
          'bg-slate-100 text-slate-700'
  return (
    <div className={`rounded-2xl border-2 p-4 space-y-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide font-bold theme-text-muted">
          {label}
        </p>
        {icon && <span className="text-lg leading-none">{icon}</span>}
      </div>
      <p className="text-base font-black break-all leading-tight">{value}</p>
      {badge && (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}`}>
          {badge}
        </span>
      )}
      {meta && <p className="text-xs theme-text-muted leading-snug">{meta}</p>}
    </div>
  )
}

function DiffStats({ activeVersion, activeCount, draftVersion, draftCount }) {
  const delta = activeCount != null ? draftCount - activeCount : null
  const deltaLabel = delta == null ? '—' :
    delta > 0 ? `+${delta} topics` :
      delta < 0 ? `${delta} topics` :
        'No change'
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Stat
        label={`Active · ${activeVersion}`}
        value={activeCount != null ? `${activeCount} topics` : 'Unknown'}
      />
      <Stat
        label={`Draft · ${draftVersion}`}
        value={`${draftCount} topics`}
        tone="emerald"
      />
      <Stat
        label="Delta"
        value={deltaLabel}
        tone={delta == null ? undefined : delta > 0 ? 'emerald' : delta < 0 ? 'amber' : undefined}
      />
    </div>
  )
}

function TabBar({ active, onChange, tabs }) {
  const navRef = useRef(null)

  // WAI-ARIA tablist keyboard pattern: arrow keys move + activate,
  // Home/End jump to first/last. Click + Enter/Space also activate
  // (standard button behaviour).
  function onKeyDown(e) {
    const idx = tabs.findIndex((t) => t.id === active)
    let next = null
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next != null) {
      e.preventDefault()
      onChange(tabs[next].id)
      const btns = navRef.current?.querySelectorAll('[role="tab"]')
      btns?.[next]?.focus()
    }
  }

  return (
    <nav
      ref={navRef}
      className="flex gap-1 border-b-2 theme-border overflow-x-auto -mx-1 px-1"
      role="tablist"
      onKeyDown={onKeyDown}
    >
      {tabs.map((t) => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-controls={`panel-${t.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-[3px] -mb-0.5 transition focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 rounded-t ${
              isActive ?
                'border-emerald-500 text-emerald-700' :
                'border-transparent theme-text-muted hover:text-slate-700'
            }`}
          >
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        )
      })}
    </nav>
  )
}

function StatusDot({ status }) {
  const map = {
    uploading: { c: 'bg-sky-400 animate-pulse', l: 'Up' },
    parsing: { c: 'bg-amber-400 animate-pulse', l: 'Pa' },
    parsed: { c: 'bg-emerald-500', l: '✓' },
    error: { c: 'bg-rose-500', l: '!' },
  }
  const s = map[status] || { c: 'bg-slate-300', l: '?' }
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-black text-white shrink-0 ${s.c}`}
      aria-label={status}
    >
      {s.l}
    </span>
  )
}
