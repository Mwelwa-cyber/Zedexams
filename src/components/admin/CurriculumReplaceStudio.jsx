import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'

import SeoHelmet from '../seo/SeoHelmet'
import {
  activateVersion,
  formatSubject,
  getActiveVersionMeta,
  invalidateKbCache,
  isPlausibleVersionId,
  subscribeDraftSummary,
  subscribeUploadStatus,
  suggestNextVersionId,
  uploadSyllabusFile,
} from '../../utils/syllabusReplaceService'

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
  const [expandedSubject, setExpandedSubject] = useState(null)

  const fileInputRef = useRef(null)
  const dropRef = useRef(null)

  function flashToast(msg, ms = 6000) {
    setToast(msg)
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

      {/* Currently active */}
      <section className="rounded-2xl border-2 theme-border bg-white p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wide theme-text-muted font-bold">
              Currently active syllabus
            </p>
            <p className="text-lg font-black break-all">
              {activeMetaStatus === 'loading' ? 'Loading…' :
                (activeMeta?.version || '—')}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshCaches}
            disabled={busy}
            className="px-3 py-2 rounded-lg border-2 theme-border font-bold text-sm hover:theme-card-hover disabled:opacity-40"
          >
            🔄 Refresh studio caches
          </button>
        </div>
        {activeMeta && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Stat
              label="RAG fallback"
              value={activeMeta.usePrivateCurriculum ?
                'ON (legacy)' : 'OFF (new syllabus is sole source)'}
              tone={activeMeta.usePrivateCurriculum ? 'amber' : 'emerald'}
            />
            <Stat
              label="Rollback target"
              value={activeMeta.previousVersion || '— (first activation)'}
            />
            <Stat
              label="Cache bust"
              value={String(activeMeta.cacheBust)}
            />
          </div>
        )}
      </section>

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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 max-w-md bg-slate-900 text-white text-sm rounded-2xl px-4 py-3 shadow-2xl whitespace-pre-line">
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
