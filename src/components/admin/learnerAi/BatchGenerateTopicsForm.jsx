import { useEffect, useMemo, useState } from 'react'
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import {
  listCbcTopics,
  preflightCurriculumRef,
  subtopicName,
} from '../../../utils/adminCbcKbService'

const PREFLIGHT_REASON_LABELS = Object.freeze({
  missing_required_inputs: 'Missing grade/subject/topic on the KB row.',
  no_curriculum_match: 'No matching topic or lesson module in the curriculum.',
  no_source_doc_ref: 'No approved-syllabus reference (sourceDocId) on the lesson module. Attach one in /admin/cbc-kb.',
  source_doc_not_found: 'sourceDocId points to a missing approvedSyllabi doc.',
  source_doc_grade_mismatch: 'Approved-syllabus doc is for a different grade.',
  source_doc_subject_mismatch: 'Approved-syllabus doc is for a different subject.',
  no_cited_excerpts: 'Lesson module has no outcomes/summary/competencies to cite.',
  permission_denied: 'Admin only — your session lacks admin role.',
  callable_error: 'Preflight call failed — try again.',
  resolver_error: 'Server resolver threw an error.',
})

function describeReason(reason, fallback) {
  if (PREFLIGHT_REASON_LABELS[reason]) return PREFLIGHT_REASON_LABELS[reason]
  if (fallback) return fallback
  return `Cannot generate (${reason || 'unknown'}).`
}

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

  // Run preflight against every visible subtopic, in parallel. The
  // dispatcher's strict resolver refuses tasks where the matched module
  // lacks an approved-syllabus reference; surfacing that here saves the
  // admin from queueing tasks that would only fail at quality_check.
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
    Promise.all(lookups.map(async ({ key, topic, subtopic }) => {
      const result = await preflightCurriculumRef({
        grade: topic.grade,
        subject: topic.subject,
        topic: topic.topic,
        subtopic: subtopicName(subtopic),
        term: Number(topic.term) || null,
      })
      return { key, result }
    })).then((results) => {
      if (cancelled) return
      setPreflight((prev) => {
        const next = { ...prev }
        for (const { key, result } of results) {
          if (result && result.ok) next[key] = { status: 'ok' }
          else next[key] = {
            status: 'fail',
            reason: (result && result.reason) || 'unknown',
            message: result && result.message,
          }
        }
        return next
      })
      // Drop any pre-existing selections that now fail preflight.
      setSelected((prev) => {
        const failKeys = new Set(
          results.filter((r) => !(r.result && r.result.ok)).map((r) => r.key),
        )
        if (failKeys.size === 0) return prev
        const next = { ...prev }
        for (const k of failKeys) delete next[k]
        return next
      })
    }).catch((err) => {
      if (cancelled) return
      console.warn('preflight batch failed', err)
    })
    return () => { cancelled = true }
  }, [topicsForSelection])

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
                          const tooltip = isBlocked ? describeReason(pf.reason, pf.message) : ''
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
                                    blocked · {pf.reason}
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
