import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import ControlCentreLayout from './ControlCentreLayout'
import {
  listStagedCurriculumModules,
  promoteCurriculumModule,
  promoteCurriculumModuleWithAi,
  rejectCurriculumModule,
  runCurriculumWatcherNow,
} from '../../../utils/stagedCurriculumModules'

// Grade tokens the watcher accepts. Must match normaliseGradeToken()
// in functions/agents/learnerAi/runners/curriculumWatcher.js — adding
// a value here without teaching the server about it would just produce
// an "Unrecognised grade token" invalid-argument error.
const GRADE_TOKENS = ['ECE', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

const GRADE_LABELS = {
  ECE: 'ECE',
  1: 'G1', 2: 'G2', 3: 'G3', 4: 'G4',
  5: 'G5', 6: 'G6', 7: 'G7', 8: 'G8',
  9: 'G9', 10: 'G10', 11: 'G11', 12: 'G12',
}

// Human-readable explanations for each skip reason key the server
// reports. Keys must match the bucketed reason strings (everything
// before the first colon) in ingestSource() — keep these in sync.
const SKIP_REASON_LABELS = {
  grade_filtered:       'Wrong grade for this run',
  grade_undetected:     'Could not detect a grade',
  parse_text_too_short: 'Document had too little text',
  parse_unsupported:    'File format not supported',
  pdf_parse_failed:     'PDF could not be parsed',
  docx_parse_failed:    'Word doc could not be parsed',
  no_chunks:            'No usable content blocks',
  http_404:             'Source returned 404 (not found)',
  http_403:             'Source returned 403 (forbidden)',
  http_500:             'Source returned 500 (server error)',
  fetch_error:          'Network error during download',
  fetch_unavailable_in_runtime: 'Download not available in this environment',
  ingest_error:         'Unexpected error during ingest',
  persist_error:        'Could not save to Firestore',
  run_budget_exhausted: 'Per-run download budget reached',
}

// Admin queue for curriculumWatcher-ingested modules. Each row is one
// `curriculum/{id}` doc that the agent staged into the private RAG
// layer. Admin can either:
//   - Promote → server callable upserts a stub topic into
//     cbcKnowledgeBase/{activeVersion}/topics/{topicId} (merge:true,
//     so any rich admin edits are preserved). Admin still fills the
//     outcomes / subtopics / competencies via /admin/cbc-kb.
//   - Reject → flips reviewStatus to 'rejected' so the row drops out
//     of the queue. The underlying RAG chunks are NOT deleted.
//
// The list is loaded via callable (not a direct Firestore subscription)
// because firestore.rules close `curriculum/*` to all clients.

const CONFIDENCE_CLASSES = {
  high:   'bg-emerald-50 text-emerald-800 border-emerald-300',
  medium: 'bg-amber-50 text-amber-800 border-amber-300',
  low:    'bg-rose-50 text-rose-700 border-rose-300',
}

function ConfidencePill({ confidence }) {
  const cls = CONFIDENCE_CLASSES[confidence] || 'bg-slate-100 text-slate-700 border-slate-300'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {confidence || 'unknown'}
    </span>
  )
}

// Display label per documentType. Must stay in sync with the
// detectDocumentType enum in curriculumIngester.js + the Zod schema
// in src/schemas/learnerAi.js.
const DOCUMENT_TYPE_LABELS = {
  scheme_of_work: 'Scheme of work',
  lesson_plan:    'Lesson plan',
  assessment:     'Assessment',
  teachers_guide: 'Teacher’s guide',
  learners_book:  'Learner’s book',
  syllabus:       'Syllabus',
  module:         'Module',
  unknown:        'Unknown',
}

// Ordered filter chip definitions — same order as the keyword
// detection priority so admins read the queue in the same shape
// the agent classifies it.
const DOC_TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'scheme_of_work', label: 'Schemes of work' },
  { id: 'syllabus',       label: 'Syllabi' },
  { id: 'module',         label: 'Modules' },
  { id: 'lesson_plan',    label: 'Lesson plans' },
  { id: 'assessment',     label: 'Assessments' },
  { id: 'teachers_guide', label: 'Teacher guides' },
  { id: 'learners_book',  label: 'Learner books' },
  { id: 'unknown',        label: 'Uncategorised' },
]

function DocTypePill({ documentType }) {
  const label = DOCUMENT_TYPE_LABELS[documentType] || 'Unknown'
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-700">
      {label}
    </span>
  )
}

function formatGrade(g) {
  if (g == null) return '—'
  if (typeof g === 'number') return `Grade ${g}`
  return String(g)
}

function formatImportedAt(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch { return '' }
}

// ── Run-summary panel ─────────────────────────────────────────────
//
// Replaces the old one-line "X changed, Y ingested" notice with a
// structured panel that admins can actually act on:
//   - run scope (grades, include-unknown)
//   - aggregate totals
//   - per-source row: status, links discovered → fetched → staged,
//     and the bucketed skip reasons (with friendly labels)
//
// Stays open until the admin dismisses it so a long scrollable run
// can be cross-referenced against the staged-modules list below.

function formatScope(summary) {
  if (!summary.gradeFilter || !Array.isArray(summary.gradeFilter) || summary.gradeFilter.length === 0) {
    return 'All grades'
  }
  const labels = summary.gradeFilter.map((t) => GRADE_LABELS[t] || t)
  return `${labels.join(', ')}${summary.includeUnknownGrade ? ' (+ unknown)' : ''}`
}

function SkipReasonChip({ reasonKey, count }) {
  const label = SKIP_REASON_LABELS[reasonKey] || reasonKey
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-700"
      title={reasonKey}
    >
      {label}
      <span className="font-bold text-slate-900">· {count}</span>
    </span>
  )
}

function SourceRow({ id, info }) {
  const ingested = info.ingestedModuleCount || 0
  const skipped = info.ingestedSkippedCount || 0
  const discovered = info.linksDiscovered || 0
  const attempted = info.linksAttempted || 0
  const preFiltered = info.linksPreFiltered || 0
  const reasons = info.skipReasons || {}
  const reasonEntries = Object.entries(reasons).sort((a, b) => b[1] - a[1])
  const outcomeTone =
    info.outcome === 'changed' || info.outcome === 'first_snapshot' ? 'text-emerald-700' :
    info.outcome === 'unreachable' ? 'text-rose-700' :
    info.outcome === 'unchanged' ? 'text-slate-500' :
    'text-slate-600'

  return (
    <li className="border border-slate-200 rounded p-3 bg-white">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="text-xs font-bold text-slate-900">{id}</code>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${outcomeTone}`}>
          {info.outcome}
          {info.reason ? ` (${info.reason})` : ''}
        </span>
        {info.reportId && (
          <span className="text-[11px] text-slate-500">report {info.reportId.slice(0, 8)}…</span>
        )}
      </div>
      {(discovered > 0 || attempted > 0) && (
        <div className="text-xs text-slate-600 mt-1">
          Found <strong>{discovered}</strong> link(s) ·{' '}
          attempted <strong>{attempted}</strong>
          {preFiltered > 0 ? ` (${preFiltered} pre-filtered by grade)` : ''} ·{' '}
          staged <strong className="text-emerald-700">{ingested}</strong> ·{' '}
          skipped <strong className="text-amber-700">{skipped}</strong>
        </div>
      )}
      {reasonEntries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reasonEntries.map(([k, v]) => (
            <SkipReasonChip key={k} reasonKey={k} count={v} />
          ))}
        </div>
      )}
    </li>
  )
}

function RunSummary({ summary, onDismiss }) {
  const bySource = summary.bySource || {}
  const sourceIds = Object.keys(bySource).sort()
  const totalDiscovered = sourceIds.reduce((n, id) => n + (bySource[id].linksDiscovered || 0), 0)
  return (
    <div className="mb-3 border border-slate-300 rounded-lg bg-slate-50">
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Last watcher run</div>
          <div className="text-xs text-slate-600">
            Scope: <strong>{formatScope(summary)}</strong>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          Dismiss
        </button>
      </div>
      <div className="px-3 py-2 text-xs text-slate-700">
        <strong className="text-slate-900">{summary.ingestedTotal || 0}</strong> module(s) staged ·{' '}
        <strong className="text-slate-900">{summary.skippedTotal || 0}</strong> skipped ·{' '}
        <strong className="text-slate-900">{summary.changedCount || 0}</strong> source(s) changed ·{' '}
        <strong className="text-slate-900">{summary.unreachableCount || 0}</strong> unreachable ·{' '}
        <strong className="text-slate-900">{totalDiscovered}</strong> link(s) discovered
      </div>
      <ul className="px-3 pb-3 space-y-2">
        {sourceIds.map((id) => (
          <SourceRow key={id} id={id} info={bySource[id]} />
        ))}
        {sourceIds.length === 0 && (
          <li className="text-xs text-slate-500 italic">No per-source detail recorded.</li>
        )}
      </ul>
    </div>
  )
}

// ── Grade-picker modal ───────────────────────────────────────────
//
// Light-touch modal that gates "Run watcher now" on a deliberate
// grade choice. We keep the local state in the parent so reopening
// the picker remembers the last selection within the session.

function GradePickerModal({
  selectedGrades, includeUnknownGrade,
  onToggleGrade, onSelectAll, onClear, onChangeIncludeUnknown,
  onCancel, onRun,
}) {
  const count = selectedGrades.size
  const isAll = count === 0
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="grade-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="grade-picker-title" className="text-base font-semibold text-slate-900 mb-1">
          Which grades should the watcher download?
        </h2>
        <p className="text-xs text-slate-600 mb-3">
          Pick one or more. Documents the agent classifies as a different grade
          will be skipped (and logged) — so the queue stays focused on what
          you’re working on. Leave everything unchecked to download for all
          grades, like the daily scheduled run does.
        </p>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {GRADE_TOKENS.map((t) => {
            const active = selectedGrades.has(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleGrade(t)}
                className={
                  'text-xs font-semibold px-2.5 py-1 rounded-full border ' +
                  (active ?
                    'bg-blue-600 text-white border-blue-600' :
                    'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')
                }
              >
                {GRADE_LABELS[t] || t}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3 text-xs mb-3">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-blue-700 hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onClear}
            className="text-slate-600 hover:underline"
          >
            Clear
          </button>
          <span className="text-slate-500 ml-auto">
            {isAll ? 'All grades' : `${count} grade(s) selected`}
          </span>
        </div>

        <label className={
          'flex items-start gap-2 text-xs px-3 py-2 rounded border ' +
          (isAll ?
            'border-slate-200 bg-slate-50 text-slate-400' :
            'border-slate-300 bg-white text-slate-700')
        }>
          <input
            type="checkbox"
            disabled={isAll}
            checked={isAll ? true : includeUnknownGrade}
            onChange={(e) => onChangeIncludeUnknown(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Also keep documents where the watcher <em>can’t tell</em> the grade.
            {isAll ? ' (Always on when no grade is picked.)' :
              ' Off by default when you pick specific grades — turn on if you ' +
              'want to manually review uncategorised modules too.'}
          </span>
        </label>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRun}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700"
          >
            {isAll ? 'Run for all grades' : `Run for ${count} grade(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StagedModulesPanel() {
  const { isAdmin } = useAuth()
  const [modules, setModules] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')

  // Grade-picker modal state. `gradePickerOpen` toggles visibility,
  // `selectedGrades` is a Set<string> of normalised tokens that the
  // picker mutates and the submit handler reads. Empty set means
  // "All grades" (matches the server's null = unscoped behaviour).
  const [gradePickerOpen, setGradePickerOpen] = useState(false)
  const [selectedGrades, setSelectedGrades] = useState(() => new Set())
  const [includeUnknownGrade, setIncludeUnknownGrade] = useState(false)

  // Last run summary — when set, rendered as a structured panel
  // beneath the controls instead of the one-liner notice. We keep
  // both because non-run actions (promote/reject) still use `notice`.
  const [runSummary, setRunSummary] = useState(null)

  // Live counts per documentType so the filter chips can show a
  // count and disable empty filters. Computed against the full
  // module list, not the post-filter list, so the count never lies
  // about what you'd see if you clicked.
  const typeCounts = modules.reduce((acc, m) => {
    const t = m.documentType || 'unknown'
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  const filteredModules = typeFilter === 'all' ? modules :
    modules.filter((m) => (m.documentType || 'unknown') === typeFilter)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await listStagedCurriculumModules()
    if (!result.ok) {
      setError(result.error)
      setModules([])
    } else {
      setModules(result.modules)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      setError('Admin only.')
      setLoading(false)
      return
    }
    load()
  }, [isAdmin, load])

  async function handlePromote(m) {
    if (!confirm(
      `Promote "${m.topic || '(no topic)'}" to the canonical CBC knowledge base?\n\n` +
      `This creates a STUB topic under ${formatGrade(m.grade)} / ${m.subject || '(no subject)'}. ` +
      'You’ll still need to fill in subtopics + outcomes via /admin/cbc-kb.',
    )) return
    setBusyId(m.curriculumId)
    setError(null)
    setNotice(null)
    const result = await promoteCurriculumModule(m.curriculumId)
    if (!result.ok) {
      setError(result.error)
    } else {
      const where = result.alreadyPromoted ?
        `already promoted as ${result.topicId}` :
        `promoted to topic ${result.topicId} (version ${result.version})`
      setNotice(`"${m.topic || m.curriculumId}" — ${where}.`)
      await load()
    }
    setBusyId(null)
  }

  async function handlePromoteWithAi(m) {
    if (!confirm(
      `Promote "${m.topic || '(no topic)'}" using AI?\n\n` +
      `Claude will read the staged RAG chunks for this module and extract ` +
      `subtopics, specific outcomes, key competencies, values, and ` +
      `suggested materials before writing the topic to the canonical KB.\n\n` +
      `Cost: ~$0.02 per call. Takes ~10–30 seconds. The result is marked ` +
      `reviewStatus:"needs_review" so you can edit it in /admin/cbc-kb.`,
    )) return
    setBusyId(m.curriculumId)
    setError(null)
    setNotice(null)
    const result = await promoteCurriculumModuleWithAi(m.curriculumId)
    if (!result.ok) {
      setError(result.error)
    } else {
      const e = result.enrichment || {}
      const counts = result.alreadyPromoted ?
        'already promoted' :
        `${e.subtopicsCount || 0} subtopics, ${e.outcomesCount || 0} outcomes, ` +
        `${e.competenciesCount || 0} competencies, ${e.valuesCount || 0} values, ` +
        `${e.materialsCount || 0} materials`
      setNotice(
        `"${m.topic || m.curriculumId}" — promoted to ${result.topicId} ` +
        `with AI enrichment (${counts}). Review in /admin/cbc-kb.`,
      )
      await load()
    }
    setBusyId(null)
  }

  // The "Run watcher now" button just opens the grade picker. The
  // picker's Run button is what actually fires the callable so the
  // user has to make a conscious grade-scope choice each run.
  function openGradePicker() {
    setError(null)
    setGradePickerOpen(true)
  }

  function toggleGrade(token) {
    setSelectedGrades((prev) => {
      const next = new Set(prev)
      if (next.has(token)) next.delete(token); else next.add(token)
      return next
    })
  }

  function selectAllGrades() { setSelectedGrades(new Set(GRADE_TOKENS)) }
  function clearGrades()     { setSelectedGrades(new Set()) }

  async function handleRunWatcherWithScope() {
    const grades = [...selectedGrades]
    setGradePickerOpen(false)
    setRunning(true)
    setError(null)
    setNotice(null)
    setRunSummary(null)
    const result = await runCurriculumWatcherNow({
      grades,
      // When the user picked specific grades, default to skipping
      // documents whose grade can't be detected unless they opted in.
      // When they ran with no scope ("All grades"), keep everything.
      includeUnknownGrade: grades.length === 0 ? true : includeUnknownGrade,
    })
    if (!result.ok) {
      setError(result.error)
    } else {
      setRunSummary(result.summary || null)
      await load()
    }
    setRunning(false)
  }

  async function handleReject(m) {
    const reason = prompt(
      `Reject "${m.topic || '(no topic)'}"?\n\n` +
      'Optional: enter a short reason (recorded for audit). The underlying RAG chunks ' +
      'are NOT deleted — only the queue row is removed.',
      '',
    )
    if (reason === null) return // cancelled
    setBusyId(m.curriculumId)
    setError(null)
    setNotice(null)
    const result = await rejectCurriculumModule(m.curriculumId, reason || null)
    if (!result.ok) {
      setError(result.error)
    } else {
      setNotice(`"${m.topic || m.curriculumId}" — rejected.`)
      await load()
    }
    setBusyId(null)
  }

  return (
    <ControlCentreLayout title="Staged curriculum modules">
      <p className="text-sm text-slate-600 mb-4 max-w-3xl">
        Modules the <strong>curriculum watcher</strong> agent downloaded and
        parsed from the trusted Zambian source whitelist (CDC Repository,
        Ministry of Education, ECZ). Each row is searchable now via the
        private-RAG layer; click <em>Promote</em> to also add it as a stub
        in the canonical CBC knowledge base so teachers see it in topic
        dropdowns. Outcomes + subtopics still need to be filled in
        manually via <code>/admin/cbc-kb</code>.
      </p>

      {notice && (
        <div className="mb-3 px-3 py-2 rounded border border-emerald-300 bg-emerald-50 text-sm text-emerald-800 whitespace-pre-line">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 rounded border border-rose-300 bg-rose-50 text-sm text-rose-700">
          {error}
        </div>
      )}
      {runSummary && (
        <RunSummary
          summary={runSummary}
          onDismiss={() => setRunSummary(null)}
        />
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={openGradePicker}
          disabled={running || loading}
          title="Choose which grades to download, then run the curriculum-watcher agent. Takes 1–3 minutes."
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? 'Running watcher…' : 'Run watcher now…'}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading || running}
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="text-xs text-slate-500">
          {filteredModules.length} of {modules.length} staged module(s)
          {typeFilter !== 'all' ? ` (filter: ${DOCUMENT_TYPE_LABELS[typeFilter] || typeFilter})` : ' awaiting review'}
          {running && ' · watcher run in progress, this may take a couple of minutes'}
        </span>
      </div>

      {modules.length > 0 && (
        <nav
          aria-label="Filter by document type"
          className="mb-4 flex flex-wrap gap-1.5"
        >
          {DOC_TYPE_FILTERS.map((f) => {
            const count = f.id === 'all' ? modules.length : (typeCounts[f.id] || 0)
            const active = typeFilter === f.id
            const empty = count === 0
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setTypeFilter(f.id)}
                disabled={empty && !active}
                className={
                  'text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ' +
                  (active ?
                    'bg-blue-600 text-white border-blue-600' :
                    empty ?
                      'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' :
                      'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')
                }
              >
                {f.label} <span className="opacity-70">· {count}</span>
              </button>
            )
          })}
        </nav>
      )}

      {!loading && modules.length === 0 && !error && (
        <div className="border border-dashed border-slate-300 rounded p-6 text-center text-sm text-slate-500">
          No staged modules. The curriculum watcher will queue new modules here
          the next time it detects a change on a whitelisted source.
        </div>
      )}

      {!loading && modules.length > 0 && filteredModules.length === 0 && (
        <div className="border border-dashed border-slate-300 rounded p-6 text-center text-sm text-slate-500">
          No modules in this category. Pick another filter above.
        </div>
      )}

      {gradePickerOpen && (
        <GradePickerModal
          selectedGrades={selectedGrades}
          includeUnknownGrade={includeUnknownGrade}
          onToggleGrade={toggleGrade}
          onSelectAll={selectAllGrades}
          onClear={clearGrades}
          onChangeIncludeUnknown={setIncludeUnknownGrade}
          onCancel={() => setGradePickerOpen(false)}
          onRun={handleRunWatcherWithScope}
        />
      )}

      <ul className="space-y-3">
        {filteredModules.map((m) => (
          <li
            key={m.curriculumId}
            className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">
                    {m.topic || <span className="italic text-slate-400">(no topic detected)</span>}
                  </h3>
                  <DocTypePill documentType={m.documentType} />
                  <ConfidencePill confidence={m.confidence} />
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatGrade(m.grade)} · {m.subject || '—'}
                  {m.term ? ` · Term ${m.term}` : ''}
                  {' · '}{m.parsedFrom || '—'}
                  {m.chunkCount ? ` · ${m.chunkCount} chunk(s)` : ''}
                </div>
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => handlePromoteWithAi(m)}
                  disabled={busyId === m.curriculumId}
                  title="Run Claude over the RAG chunks to fill subtopics + outcomes automatically (~$0.02, ~10–30s)"
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {busyId === m.curriculumId ? 'Working…' : 'Promote with AI'}
                </button>
                <button
                  type="button"
                  onClick={() => handlePromote(m)}
                  disabled={busyId === m.curriculumId}
                  title="Create a stub topic; admin fills outcomes by hand in /admin/cbc-kb"
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Promote (stub)
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(m)}
                  disabled={busyId === m.curriculumId}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-rose-700 border border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-600 break-all">
              <span className="text-slate-400">Source: </span>
              <a
                href={m.sourceUrl || '#'}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-700 hover:underline"
              >
                {m.sourceName || m.sourceUrl || m.source || '—'}
              </a>
            </div>
            {m.anchorText && (
              <div className="text-xs text-slate-500 mt-1 italic">
                Link text: &ldquo;{m.anchorText}&rdquo;
              </div>
            )}
            <div className="text-[11px] text-slate-400 mt-2">
              Imported {formatImportedAt(m.importedAt) || '(no timestamp)'}
              {' · '}id <code className="text-slate-500">{m.curriculumId}</code>
            </div>
          </li>
        ))}
      </ul>
    </ControlCentreLayout>
  )
}
