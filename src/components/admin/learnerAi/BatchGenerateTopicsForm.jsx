import { useEffect, useMemo, useState } from 'react'
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import {
  backfillKbSourceRefs,
  countApprovedSyllabiFor,
  listCbcTopics,
  preflightCurriculumRef,
  subtopicName,
} from '../../../utils/adminCbcKbService'
import {
  fixHint,
  shortReason,
  summarizePreflightResults,
  summarizeReason,
} from '../../../utils/learnerAiReasons'

// Admin form that drives the learner-AI pipeline from the uploaded
// CBC syllabus. Reads cbcKnowledgeBase/{activeVersion}/topics/* via
// listCbcTopics() — the same store CurriculumReplaceStudio writes to —
// and queues one aiAgentTasks doc per (subtopic × generator). The
// dispatcher trigger (functions/agents/learnerAi/dispatcher.js)
// picks each doc up and walks the Supervisor → CurriculumReader →
// generator → QualityCheck → StandardsCheck → SupervisorReview chain.
//
// Term is read off the topic doc — admins never type "Term 1"/"Term 2".

const GENERATORS = Object.freeze([
  { taskType: 'practice_quiz', assessmentType: 'practice_quiz', label: 'Practice Quiz' },
  { taskType: 'exam_quiz',     assessmentType: 'topic_test',     label: 'Exam Quiz' },
  { taskType: 'notes',         assessmentType: null,             label: 'Notes' },
  { taskType: 'study_tips',    assessmentType: null,             label: 'Study Tips' },
])

const DEFAULT_PARAMETERS = Object.freeze({
  numQuestions: 10,
  difficulty: 'mixed',
  mode: 'topic',
  weakLearnerId: null,
  lessonNumber: null,
  allowedQuestionTypes: ['mcq', 'true_false', 'short_answer', 'matching'],
})

function uniqSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function makeBatchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function selectionKey(topicId, subtopicIdx) {
  return `${topicId}::${subtopicIdx}`
}

export default function BatchGenerateTopicsForm({ onBatchQueued }) {
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [allTopics, setAllTopics] = useState([])
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [selected, setSelected] = useState({}) // key -> { topic, subtopic }
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  // Preflight state: key -> { status: 'loading'|'ok'|'fail', reason?, message? }
  const [preflight, setPreflight] = useState({})
  // Cached approvedSyllabi count for the picked grade+subject so the
  // banner can tell the admin whether Backfill is worth pressing.
  const [syllabiCount, setSyllabiCount] = useState(null)
  // Backfill action state. dryRun-first: surfaces the projected delta
  // before the admin commits to a write.
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)
  const [backfillError, setBackfillError] = useState(null)
  // Force-refresh counter: bumped after a live backfill so the preflight
  // useEffect re-runs against the now-linked lesson modules without the
  // admin having to switch grades back and forth.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listCbcTopics()
      .then((topics) => {
        if (cancelled) return
        setAllTopics(Array.isArray(topics) ? topics : [])
        setLoadError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err && err.message ? err.message : 'Could not load curriculum.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const grades = useMemo(() => uniqSorted(allTopics.map((t) => t.grade)), [allTopics])

  const subjectsForGrade = useMemo(() => {
    if (!grade) return []
    return uniqSorted(allTopics.filter((t) => t.grade === grade).map((t) => t.subject))
  }, [allTopics, grade])

  const topicsForSelection = useMemo(() => {
    if (!grade || !subject) return []
    return allTopics
      .filter((t) => t.grade === grade && t.subject === subject)
      .sort((a, b) => {
        const termA = Number(a.term) || 0
        const termB = Number(b.term) || 0
        if (termA !== termB) return termA - termB
        return String(a.topic || '').localeCompare(String(b.topic || ''))
      })
  }, [allTopics, grade, subject])

  // Whenever the grade or subject changes, drop selections that no
  // longer belong to a visible topic. Avoids submitting orphaned IDs.
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(topicsForSelection.map((t) => t.id))
      const next = {}
      for (const [key, value] of Object.entries(prev)) {
        if (visibleIds.has(value.topic.id)) next[key] = value
      }
      return next
    })
  }, [topicsForSelection])

  // Refresh the approved-syllabi count whenever the admin picks (or
  // changes) a grade+subject pair. Cleared as soon as either selector
  // resets so the banner doesn't lie. Stale-result guard via cancelled.
  useEffect(() => {
    setBackfillResult(null)
    setBackfillError(null)
    if (!grade || !subject) { setSyllabiCount(null); return undefined }
    let cancelled = false
    countApprovedSyllabiFor(grade, subject).then((res) => {
      if (!cancelled) setSyllabiCount(res)
    }).catch((err) => {
      if (!cancelled) {
        console.warn('countApprovedSyllabiFor failed', err)
        setSyllabiCount({ total: 0, byTerm: {} })
      }
    })
    return () => { cancelled = true }
  }, [grade, subject])

  // Run preflight against every visible subtopic. The dispatcher's
  // strict resolver refuses tasks where the matched module lacks an
  // approved-syllabus reference; surfacing that here saves the admin
  // from queueing tasks that would only fail at quality_check.
  //
  // Concurrency capped at PREFLIGHT_CONCURRENCY. Firing 20+ callables
  // in parallel against a cold-start Cloud Function reliably exceeds
  // the 20-second client timeout for the tail of the burst, which
  // surfaces as `deadline_exceeded` on every chip. Chunking lets the
  // first batch warm a function instance, then subsequent batches
  // reuse it. Results stream into state as each chunk completes so
  // chips flip green progressively instead of all-at-once.
  useEffect(() => {
    if (topicsForSelection.length === 0) {
      setPreflight({})
      return undefined
    }
    let cancelled = false
    const initial = {}
    const lookups = []
    for (const topic of topicsForSelection) {
      const subtopics = Array.isArray(topic.subtopics) ? topic.subtopics : []
      subtopics.forEach((s, idx) => {
        const key = selectionKey(topic.id, idx)
        initial[key] = { status: 'loading' }
        lookups.push({ key, topic, subtopic: s })
      })
    }
    setPreflight(initial)

    const PREFLIGHT_CONCURRENCY = 4
    async function runOne({ key, topic, subtopic }) {
      const result = await preflightCurriculumRef({
        grade: topic.grade,
        subject: topic.subject,
        topic: topic.topic,
        subtopic: subtopicName(subtopic),
        term: Number(topic.term) || null,
      })
      return { key, result }
    }

    ;(async () => {
      const allResults = []
      for (let i = 0; i < lookups.length; i += PREFLIGHT_CONCURRENCY) {
        if (cancelled) return
        const slice = lookups.slice(i, i + PREFLIGHT_CONCURRENCY)
        const chunkResults = await Promise.all(slice.map(runOne))
        if (cancelled) return
        allResults.push(...chunkResults)
        // Stream chip updates so the admin sees progress instead of a
        // long all-loading state followed by a flash of greens/reds.
        setPreflight((prev) => {
          const next = { ...prev }
          for (const { key, result } of chunkResults) {
            if (result && result.ok) next[key] = { status: 'ok' }
            else next[key] = {
              status: 'fail',
              reason: (result && result.reason) || 'unknown',
              message: (result && result.message) || null,
              rawCode: (result && result.rawCode) || null,
            }
          }
          return next
        })
      }
      if (cancelled) return
      // Drop any pre-existing selections that now fail preflight.
      setSelected((prev) => {
        const failKeys = new Set(
          allResults.filter((r) => !(r.result && r.result.ok)).map((r) => r.key),
        )
        if (failKeys.size === 0) return prev
        const next = { ...prev }
        for (const k of failKeys) delete next[k]
        return next
      })
    })().catch((err) => {
      if (cancelled) return
      console.warn('preflight batch failed', err)
    })
    return () => { cancelled = true }
  }, [topicsForSelection, refreshTick])

  function toggleSubtopic(topic, subtopic, idx) {
    const key = selectionKey(topic.id, idx)
    const pf = preflight[key]
    if (pf && pf.status !== 'ok') return
    setSelected((prev) => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = { topic, subtopic }
      return next
    })
  }

  function toggleAllForTopic(topic) {
    setSelected((prev) => {
      const next = { ...prev }
      const subtopics = Array.isArray(topic.subtopics) ? topic.subtopics : []
      const okKeys = subtopics
          .map((_, idx) => selectionKey(topic.id, idx))
          .filter((k) => (preflight[k] && preflight[k].status === 'ok'))
      if (okKeys.length === 0) return prev
      const allSelected = okKeys.every((k) => next[k])
      if (allSelected) {
        for (const k of okKeys) delete next[k]
      } else {
        subtopics.forEach((s, idx) => {
          const key = selectionKey(topic.id, idx)
          if (preflight[key] && preflight[key].status === 'ok') {
            next[key] = { topic, subtopic: s }
          }
        })
      }
      return next
    })
  }

  const selectedEntries = useMemo(() => Object.values(selected), [selected])
  const totalTasks = selectedEntries.length * GENERATORS.length

  // Reduce per-chip preflight state into banner-friendly summary stats
  // (total, blocked count, dominant reason). Re-runs whenever a chip
  // flips state, so the banner stays in sync with the grid.
  const preflightSummary = useMemo(
    () => summarizePreflightResults(Object.values(preflight)),
    [preflight],
  )

  // Pick a representative underlying message for the dominant reason so
  // the banner can surface the actual SDK / server error inline instead
  // of forcing the admin to hover a single chip to read it.
  const dominantMessage = useMemo(() => {
    if (!preflightSummary.dominant) return null
    for (const v of Object.values(preflight)) {
      if (v && v.status === 'fail' &&
          v.reason === preflightSummary.dominant && v.message) {
        return v.rawCode ? `[${v.rawCode}] ${v.message}` : v.message
      }
    }
    return null
  }, [preflight, preflightSummary.dominant])

  async function runBackfill(dryRun) {
    if (backfilling) return
    setBackfilling(true)
    setBackfillError(null)
    setBackfillResult(null)
    try {
      // Scope the backfill to the picked grade+subject so a misclick on
      // a small slice doesn't trigger a full-KB walk. Server falls back
      // to the full KB when both filters are null.
      const result = await backfillKbSourceRefs({
        dryRun,
        grade: grade || null,
        subject: subject || null,
      })
      if (!result.ok) {
        setBackfillError(result.error || 'Backfill failed.')
        return
      }
      setBackfillResult(result)
      // On a real write, re-run preflight so chips refresh from the
      // freshly-linked sourceDocId values.
      if (!dryRun) {
        setPreflight({})
        setRefreshTick((t) => t + 1)
        // Also refresh the syllabi count — a backfill itself doesn't
        // add syllabi, but the admin may have uploaded one while
        // browsing, and the count widget belongs in the same banner.
        const next = await countApprovedSyllabiFor(grade, subject)
        setSyllabiCount(next)
      }
    } catch (err) {
      setBackfillError(err?.message || String(err))
    } finally {
      setBackfilling(false)
    }
  }

  async function handleSubmit() {
    if (submitting || selectedEntries.length === 0) return
    setSubmitError(null)
    setLastResult(null)
    setSubmitting(true)
    try {
      const batchId = makeBatchId()
      const batch = writeBatch(db)
      const tasksCol = collection(db, 'aiAgentTasks')
      const createdBy = (currentUser && currentUser.uid) || 'admin'
      const docIds = []
      for (const { topic, subtopic } of selectedEntries) {
        const subName = subtopicName(subtopic)
        for (const gen of GENERATORS) {
          const ref = doc(tasksCol)
          batch.set(ref, {
            taskType: gen.taskType,
            agentName: 'AI Supervisor Agent',
            status: 'queued',
            grade: topic.grade,
            subject: topic.subject,
            term: Number(topic.term) || null,
            topic: topic.topic,
            subtopic: subName,
            lessonNumber: null,
            assessmentType: gen.assessmentType,
            parameters: { ...DEFAULT_PARAMETERS },
            batchId,
            startedAt: null,
            completedAt: null,
            resultContentId: null,
            errorMessage: null,
            createdBy,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
          docIds.push(ref.id)
        }
      }
      await batch.commit()
      const result = {
        batchId,
        topicCount: selectedEntries.length,
        taskCount: docIds.length,
        firstTaskId: docIds[0] || null,
      }
      setLastResult(result)
      setSelected({})
      if (typeof onBatchQueued === 'function') onBatchQueued(result)
    } catch (err) {
      setSubmitError(err && err.message ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-slate-900">
          Generate from your uploaded curriculum
        </h2>
        <p className="text-xs text-slate-600 leading-snug mt-0.5">
          Pick subtopics from the CBC syllabus you uploaded. One press queues
          all four learner-AI generators (Practice Quiz, Exam Quiz, Notes,
          Study Tips) per subtopic. Grade, subject and term come straight from
          the uploaded KB — nothing is hand-typed.
        </p>
      </div>

      {loading && (
        <div className="text-xs text-slate-500">Loading curriculum…</div>
      )}

      {!loading && loadError && (
        <div className="text-xs text-rose-700">Failed to load curriculum: {loadError}</div>
      )}

      {!loading && !loadError && allTopics.length === 0 && (
        <div className="text-xs text-amber-800">
          No topics found in the active curriculum. Upload a syllabus at
          {' '}<code className="font-mono">/admin/curriculum/replace</code> or add
          topics at <code className="font-mono">/admin/cbc-kb</code>, then reload.
        </div>
      )}

      {!loading && !loadError && allTopics.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-700">
              <span className="block mb-1 font-semibold">Grade</span>
              <select
                value={grade}
                onChange={(e) => { setGrade(e.target.value); setSubject('') }}
                className="w-full text-xs rounded border border-slate-300 bg-white px-2 py-1.5"
              >
                <option value="">Select grade…</option>
                {grades.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-700">
              <span className="block mb-1 font-semibold">Subject</span>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!grade}
                className="w-full text-xs rounded border border-slate-300 bg-white px-2 py-1.5 disabled:opacity-50"
              >
                <option value="">{grade ? 'Select subject…' : 'Pick a grade first'}</option>
                {subjectsForGrade.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          {grade && subject && topicsForSelection.length === 0 && (
            <div className="text-xs text-amber-800">
              No topics found for {grade} · {subject}. Add some at{' '}
              <code className="font-mono">/admin/cbc-kb</code>.
            </div>
          )}

          {grade && subject && topicsForSelection.length > 0 && preflightSummary.blocked > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs">
              <div className="font-semibold text-amber-900 mb-1">
                {preflightSummary.blocked} of {preflightSummary.total} subtopics blocked
                {preflightSummary.dominant ? (
                  <> · most common: <span className="font-mono">{preflightSummary.dominant}</span></>
                ) : null}
              </div>
              {preflightSummary.dominant && (
                <p className="text-amber-900 leading-snug mb-2">
                  {summarizeReason(preflightSummary.dominant, dominantMessage)}{' '}
                  <span className="text-amber-800">{fixHint(preflightSummary.dominant)}</span>
                </p>
              )}
              {syllabiCount !== null && (
                <p className="text-[11px] text-amber-900 mb-2">
                  Approved syllabi on file for {grade} · {subject}:{' '}
                  <span className="font-bold">{syllabiCount.total}</span>
                  {syllabiCount.total === 0 && (
                    <>. Upload one at <code className="font-mono">/admin/curriculum/replace</code> before backfilling.</>
                  )}
                </p>
              )}
              {(preflightSummary.dominant === 'no_source_doc_ref' ||
                preflightSummary.dominant === 'source_doc_not_found') && (
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => runBackfill(true)}
                    disabled={backfilling || (syllabiCount && syllabiCount.total === 0)}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded border border-amber-400 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {backfilling ? 'Working…' : 'Preview backfill (dry run)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => runBackfill(false)}
                    disabled={backfilling || (syllabiCount && syllabiCount.total === 0) || !backfillResult || !backfillResult.dryRun}
                    title={
                      !backfillResult || !backfillResult.dryRun ?
                        'Run a dry run first so you can see what would change.' :
                        ''
                    }
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {backfilling ? 'Writing…' : 'Apply backfill'}
                  </button>
                </div>
              )}
              {backfillResult && (
                <div className="mt-2 text-[11px] text-amber-900 font-mono break-all">
                  {backfillResult.dryRun ? 'Dry run' : 'Applied'}:{' '}
                  would link <span className="font-bold">{backfillResult.updated}</span>,{' '}
                  already linked {backfillResult.alreadySet},{' '}
                  no syllabus match {backfillResult.noMatch}{' '}
                  (scanned {backfillResult.totalScanned}, syllabi {backfillResult.totalSyllabi}).
                </div>
              )}
              {backfillError && (
                <div className="mt-2 text-[11px] text-rose-700">
                  Backfill error: {backfillError}
                </div>
              )}
            </div>
          )}

          {topicsForSelection.length > 0 && (
            <div className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-white divide-y divide-slate-100">
              {topicsForSelection.map((topic) => {
                const subtopics = Array.isArray(topic.subtopics) ? topic.subtopics : []
                const allKeys = subtopics.map((_, idx) => selectionKey(topic.id, idx))
                const okKeys = allKeys.filter((k) => preflight[k] && preflight[k].status === 'ok')
                const allSelected = okKeys.length > 0 && okKeys.every((k) => selected[k])
                const failCount = allKeys.filter((k) => preflight[k] && preflight[k].status === 'fail').length
                const loadingCount = allKeys.filter((k) => !preflight[k] || preflight[k].status === 'loading').length
                return (
                  <div key={topic.id} className="p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {topic.topic || '(untitled topic)'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Term {Number(topic.term) || '?'} · {subtopics.length} subtopic{subtopics.length === 1 ? '' : 's'}
                          {failCount > 0 && (
                            <span className="ml-2 text-amber-700">{failCount} blocked</span>
                          )}
                          {loadingCount > 0 && (
                            <span className="ml-2 text-slate-400">{loadingCount} checking…</span>
                          )}
                        </div>
                      </div>
                      {okKeys.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleAllForTopic(topic)}
                          className="text-[11px] font-semibold text-emerald-700 hover:underline shrink-0"
                        >
                          {allSelected ? 'Clear all' : `Select all (${okKeys.length})`}
                        </button>
                      )}
                    </div>
                    {subtopics.length === 0 ? (
                      <div className="text-[11px] text-slate-400 italic">
                        No subtopics on this topic. Add some in /admin/cbc-kb.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {subtopics.map((s, idx) => {
                          const key = selectionKey(topic.id, idx)
                          const name = subtopicName(s)
                          const pf = preflight[key]
                          const isLoading = !pf || pf.status === 'loading'
                          const isBlocked = pf && pf.status === 'fail'
                          // Tooltip layers the full human label with the raw
                          // server message — the latter is the only signal
                          // for generic codes (callable_error / resolver_error)
                          // and would otherwise be silently swallowed.
                          const tooltip = isBlocked ?
                            `${summarizeReason(pf.reason, pf.message)}${fixHint(pf.reason) ? ` — ${fixHint(pf.reason)}` : ''}` :
                            ''
                          return (
                            <label
                              key={key}
                              title={tooltip}
                              className={
                                `flex items-start gap-2 text-xs p-1.5 rounded ${
                                  isBlocked
                                    ? 'text-slate-400 cursor-not-allowed bg-amber-50/40'
                                    : 'text-slate-700 cursor-pointer hover:bg-slate-50'
                                }`
                              }
                            >
                              <input
                                type="checkbox"
                                checked={!!selected[key]}
                                onChange={() => toggleSubtopic(topic, s, idx)}
                                disabled={isLoading || isBlocked}
                                className="mt-0.5"
                              />
                              <span className="leading-snug">
                                {name || `Subtopic ${idx + 1}`}
                                {isLoading && (
                                  <span className="ml-2 text-[10px] text-slate-400">checking…</span>
                                )}
                                {isBlocked && (
                                  <span className="ml-2 text-[10px] text-amber-700">
                                    {shortReason(pf.reason)}
                                  </span>
                                )}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <div className="text-[11px] text-slate-600">
              {selectedEntries.length === 0 ? (
                <>Select at least one subtopic to enable the queue button.</>
              ) : (
                <>
                  {selectedEntries.length} subtopic{selectedEntries.length === 1 ? '' : 's'} ·{' '}
                  queues {totalTasks} task{totalTasks === 1 ? '' : 's'} (4 generators each).
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || selectedEntries.length === 0}
              className="inline-flex items-center justify-center text-xs font-semibold px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? 'Queuing…' : `Queue all 4 generators × ${selectedEntries.length || 0}`}
            </button>
          </div>

          {lastResult && !submitError && (
            <div className="text-[11px] text-emerald-700 font-mono break-all">
              Queued {lastResult.taskCount} task{lastResult.taskCount === 1 ? '' : 's'} across{' '}
              {lastResult.topicCount} subtopic{lastResult.topicCount === 1 ? '' : 's'}. Batch{' '}
              <span className="font-semibold">{lastResult.batchId}</span> — watch the agent cards
              + activity timeline below for live progress.
            </div>
          )}
          {submitError && (
            <div className="text-[11px] text-rose-700">
              Failed to queue tasks: {submitError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
