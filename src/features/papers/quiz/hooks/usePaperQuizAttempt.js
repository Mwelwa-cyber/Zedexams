/**
 * The attempt: its state, its clock anchor, and its writes.
 *
 * One hook rather than state scattered across the page, because the three
 * things this has to guarantee are all about ORDER, and order is what gets
 * lost when state lives in five `useState`s in a render function:
 *
 *   1. **An answer is durable before the next render.** Every tap writes to
 *      the local mirror synchronously and to the server on a debounce. §1:
 *      "never batched in memory until submit, because memory is exactly what a
 *      reload destroys."
 *   2. **The clock is anchored, not counted.** `startAttempt` returns the
 *      server's `now` beside `expiresAt`; the offset between it and the
 *      device's clock is measured once and applied to every later reading.
 *   3. **Nothing but `abandon` ends an attempt.** A failed patch, a dropped
 *      connection, a backgrounded tab and a reload all leave the attempt
 *      exactly where it was.
 *
 * ── Practice runs offline; exam does not ─────────────────────────────────
 *
 * §1's table. Practice keeps its whole state locally and syncs the cursor when
 * it can, so a learner on a bus finishes their paper. Exam needs the network
 * to START (there is no honest clock otherwise) and to SUBMIT (the server
 * marks) — but NOT in between: a connection that drops mid-exam leaves the
 * runner working and the answers queued, because a paper lost to a tunnel is
 * the same loss as a paper lost to a reload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { QUIZ_MODE, isExam } from '../lib/quizModes'
import { clockOffset, timeUsedSeconds } from '../lib/examClock'
import { fromServerRows, markPaper } from '../lib/attemptMarking'
import { mergeSessions, normalizeSession, resumeIndex, selectQuestions } from '../lib/practiceSession'
import {
  abandonAttempt as callAbandon,
  patchAttempt as callPatch,
  savePracticeProgress as callSaveProgress,
  startAttempt as callStart,
  submitAttempt as callSubmit,
  QUIZ_CALL,
} from '../services/paperQuizService'
import { resolveVisitorId } from '../../../../utils/visitorId'

const LOCAL_PREFIX = 'zedexams:paperQuizRun:'
const PATCH_DEBOUNCE_MS = 900

/** The words a learner reads when a start fails. Each names a way forward. */
const START_ERROR = {
  [QUIZ_CALL.UNAUTHENTICATED]: 'Please sign in again to sit this as an exam. Practice works without signing in.',
  [QUIZ_CALL.NEEDS_FULL_PAPER]: 'Exam mode covers the whole paper. Practise the free section for now — your marks and answers are free either way.',
  [QUIZ_CALL.UNAVAILABLE]: 'This paper\'s quiz is not ready yet. Try another paper.',
  [QUIZ_CALL.OFFLINE]: 'You need a connection to start an exam, so the clock is honest. Practice works offline.',
  [QUIZ_CALL.FAILED]: 'Something went wrong starting your paper. Please try again.',
}

function localKey(paperId, uid) {
  return `${LOCAL_PREFIX}${paperId}:${resolveVisitorId(uid)}`
}

function readLocal(paperId, uid) {
  try {
    return JSON.parse(window.localStorage.getItem(localKey(paperId, uid)) || 'null')
  } catch { return null }
}

function writeLocal(paperId, uid, value) {
  try {
    window.localStorage.setItem(localKey(paperId, uid), JSON.stringify(value))
  } catch { /* private mode, quota — the server copy is the durable one */ }
}

function clearLocal(paperId, uid) {
  try { window.localStorage.removeItem(localKey(paperId, uid)) } catch { /* ignore */ }
}

export function usePaperQuizAttempt({ paperId, uid }) {
  const [record, setRecord] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [flags, setFlags] = useState({})
  const [revealed, setRevealed] = useState({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [mode, setMode] = useState(QUIZ_MODE.EXAM)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [resumed, setResumed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [startError, setStartError] = useState('')
  const [marked, setMarked] = useState(null)
  const [timeUsedSec, setTimeUsedSec] = useState(null)
  const [finishReason, setFinishReason] = useState('')

  const patchTimer = useRef(null)
  const pendingPatch = useRef({ answers: {}, flags: null })
  const startedAtRef = useRef(0)

  // Flush any queued answers on unmount. The debounce means the last tap
  // before a learner backgrounds the app has not been sent yet, and that tap
  // is the single most likely one to matter.
  useEffect(() => () => {
    if (patchTimer.current) clearTimeout(patchTimer.current)
  }, [])

  const flushPatch = useCallback((attemptId) => {
    const queued = pendingPatch.current
    pendingPatch.current = { answers: {}, flags: null }
    if (!attemptId) return
    if (Object.keys(queued.answers).length === 0 && queued.flags == null) return
    // Fire and forget. A failed patch costs a cross-device resume, never the
    // answer on screen — the local mirror is what the next render reads.
    callPatch({ attemptId, answers: queued.answers, flags: queued.flags || undefined })
  }, [])

  const queuePatch = useCallback((attemptId, patch) => {
    pendingPatch.current = {
      answers: { ...pendingPatch.current.answers, ...(patch.answers || {}) },
      flags: patch.flags ?? pendingPatch.current.flags,
    }
    if (patchTimer.current) clearTimeout(patchTimer.current)
    patchTimer.current = setTimeout(() => flushPatch(attemptId), PATCH_DEBOUNCE_MS)
  }, [flushPatch])

  /**
   * Start or resume.
   *
   * For an EXAM this always goes to the server: the clock, the stripped
   * questions and the attempt id are all its answer, and a client that started
   * an exam on its own would be marking its own paper.
   *
   * For PRACTICE the local state is authoritative and the server call is an
   * optimisation — if it fails, practice starts anyway, because §1 says
   * practice is fully offline and a network failure must not be the thing that
   * stops a child studying.
   */
  const start = useCallback(async ({ mode: nextMode, strictForward, questions: catalogue, freeSet, unlocked }) => {
    setStartError('')
    setStarting(true)
    setMode(nextMode)
    setFinishReason('')
    setMarked(null)
    try {
      const exam = isExam(nextMode)
      const res = await callStart({
        paperId,
        mode: nextMode,
        strictForward,
        clientVersion: '',
        // §5.5 — an offline start is anchored to the device clock and flagged.
        unverifiedTiming: typeof navigator !== 'undefined' && navigator.onLine === false,
      })

      if (!res.ok) {
        if (exam) {
          setStartError(START_ERROR[res.reason] || START_ERROR[QUIZ_CALL.FAILED])
          return { ok: false, reason: res.reason }
        }
        // Practice falls back to the catalogue the page already loaded. The
        // free set still bounds it, exactly as before.
        return startPracticeLocally({ catalogue, freeSet, unlocked })
      }

      const data = res.data
      setRecord(data.attempt)
      setClockOffsetMs(clockOffset(data.attempt.serverNowMs, Date.now()))
      startedAtRef.current = data.attempt.startedAtMs || Date.now()
      setResumed(Boolean(data.resumed))

      // Exam questions arrive stripped; practice's arrive whole (§5.1/§5.4).
      const served = Array.isArray(data.questions) && data.questions.length
        ? data.questions
        : catalogue
      const bounded = exam ? served : boundToFreeSet(served, freeSet, unlocked)
      setQuestions(bounded)

      const serverAnswers = data.attempt.answers || {}
      setAnswers(serverAnswers)
      setFlags(Object.fromEntries((data.attempt.flags || []).map((id) => [id, true])))
      // A resumed PRACTICE run shows its coaching again for every question
      // already answered — the learner read it once, and hiding it now would
      // make a resume feel like a reset.
      setRevealed(exam ? {} : Object.fromEntries(Object.keys(serverAnswers).map((id) => [id, true])))
      setCurrentIndex(resumeIndex({ questions: bounded, answered: serverAnswers }))
      writeLocal(paperId, uid, { attemptId: data.attempt.attemptId, mode: nextMode, answers: serverAnswers })
      return { ok: true, resumed: Boolean(data.resumed) }
    } finally {
      setStarting(false)
    }

    function startPracticeLocally({ catalogue, freeSet: fs, unlocked: un }) {
      const local = normalizeSession(readLocal(paperId, uid))
      const bounded = boundToFreeSet(catalogue, fs, un)
      setRecord(null)
      setQuestions(bounded)
      setAnswers(local.answered)
      setRevealed(Object.fromEntries(Object.keys(local.answered).map((id) => [id, true])))
      setFlags({})
      setCurrentIndex(resumeIndex({ questions: bounded, answered: local.answered }))
      setResumed(Object.keys(local.answered).length > 0)
      startedAtRef.current = Date.now()
      return { ok: true, resumed: Object.keys(local.answered).length > 0 }
    }
  }, [paperId, uid])

  /** Record one answer. Returns nothing — the caller already knows the verdict. */
  const choose = useCallback(({ question, index, reveal }) => {
    if (!question) return
    setAnswers((prev) => {
      const next = { ...prev, [question.id]: index }
      writeLocal(paperId, uid, { attemptId: record?.attemptId || null, mode, answers: next })
      return next
    })
    if (reveal) setRevealed((prev) => ({ ...prev, [question.id]: true }))
    if (record?.attemptId) queuePatch(record.attemptId, { answers: { [question.id]: index } })
    else if (!isExam(mode) && uid) {
      // Practice with no server attempt (offline start). The cursor syncs on a
      // best-effort basis so another device can pick it up.
      callSaveProgress({ paperId, lastQuestionN: index + 1, answered: { [question.id]: index } })
    }
  }, [paperId, uid, record, mode, queuePatch])

  const toggleFlag = useCallback((questionId) => {
    setFlags((prev) => {
      const next = { ...prev }
      if (next[questionId]) delete next[questionId]
      else next[questionId] = true
      if (record?.attemptId) queuePatch(record.attemptId, { flags: Object.keys(next) })
      return next
    })
  }, [record, queuePatch])

  const goTo = useCallback((index) => setCurrentIndex(index), [])

  /**
   * Submit.
   *
   * Exam: the server marks and returns the marked paper. If the call fails we
   * do NOT fall back to marking locally — the client does not hold the key, so
   * "marking locally" would mean scoring every answer wrong. It reports the
   * failure and leaves the attempt open to try again.
   *
   * Practice: marked here, because practice holds the whole question (§5.4).
   */
  const submit = useCallback(async ({ questions: qs }) => {
    setSubmitting(true)
    try {
      if (record?.attemptId) flushPatch(record.attemptId)
      if (isExam(mode)) {
        if (!record?.attemptId) {
          setStartError(START_ERROR[QUIZ_CALL.FAILED])
          return { ok: false }
        }
        const res = await callSubmit({ attemptId: record.attemptId, answers })
        if (!res.ok) {
          setStartError(res.reason === QUIZ_CALL.OFFLINE
            ? 'We could not reach the server to mark your paper. Your answers are safe — try again in a moment.'
            : START_ERROR[QUIZ_CALL.FAILED])
          return { ok: false }
        }
        const data = res.data
        const m = fromServerRows(data.rows)
        setMarked(m)
        // The server returns the full questions WITH explanations at this
        // point — the paper is finished, so the key is no longer secret. The
        // results screen renders from these, not from the stripped copies the
        // runner held.
        if (Array.isArray(data.questions) && data.questions.length) setQuestions(data.questions)
        setTimeUsedSec(data.timeUsedSec ?? null)
        setFinishReason(data.status === 'expired' ? 'timeup' : 'submitted')
        clearLocal(paperId, uid)
        return { ok: true, marked: m, timeUsedSec: data.timeUsedSec }
      }
      const m = markPaper({ questions: qs, answers })
      setMarked(m)
      setTimeUsedSec(timeUsedSeconds({ startedAtMs: startedAtRef.current, submittedAtMs: Date.now() }))
      setFinishReason('completed')
      // Practice writes no attempt (§4.2) — only topic mastery, which the
      // server does when it has one. With no attempt there is nothing to
      // submit, so the cursor is all that is saved.
      if (uid) callSaveProgress({ paperId, lastQuestionN: qs.length, answered: answers })
      return { ok: true, marked: m }
    } finally {
      setSubmitting(false)
    }
  }, [record, mode, answers, paperId, uid, flushPatch])

  /** The exit sheet's "Leave — don't count this". The only thing that voids. */
  const abandon = useCallback(async () => {
    if (record?.attemptId) await callAbandon({ attemptId: record.attemptId })
    clearLocal(paperId, uid)
    setRecord(null)
    setAnswers({})
    setFlags({})
    setRevealed({})
    setCurrentIndex(0)
    setMarked(null)
  }, [record, paperId, uid])

  /** The fix-up set: the missed questions, in paper order, as practice. */
  const startFixup = useCallback((ids) => {
    const picked = selectQuestions(questions, ids)
    setMode(QUIZ_MODE.PRACTICE)
    setRecord(null)
    setQuestions(picked)
    setAnswers({})
    setRevealed({})
    setFlags({})
    setCurrentIndex(0)
    setMarked(null)
    setResumed(false)
    startedAtRef.current = Date.now()
  }, [questions])

  const reset = useCallback(() => {
    setRecord(null)
    setAnswers({})
    setFlags({})
    setRevealed({})
    setCurrentIndex(0)
    setMarked(null)
    setResumed(false)
    setFinishReason('')
    clearLocal(paperId, uid)
  }, [paperId, uid])

  const secondsIn = useCallback(
    () => Math.max(0, Math.floor((Date.now() - (startedAtRef.current || Date.now())) / 1000)),
    [],
  )

  return useMemo(() => ({
    record,
    questions,
    answers,
    flags,
    revealed,
    currentIndex,
    clockOffsetMs,
    resumed,
    starting,
    submitting,
    startError,
    marked,
    timeUsedSec,
    finishReason,
    ready: questions.length > 0,
    start,
    choose,
    toggleFlag,
    goTo,
    submit,
    abandon,
    startFixup,
    reset,
    secondsIn,
  }), [
    record, questions, answers, flags, revealed, currentIndex, clockOffsetMs, resumed,
    starting, submitting, startError, marked, timeUsedSec, finishReason,
    start, choose, toggleFlag, goTo, submit, abandon, startFixup, reset, secondsIn,
  ])
}

/**
 * Bound a PRACTICE run to the free set.
 *
 * Exam mode never reaches here — it requires the whole paper by rule
 * (`examAccess`), so bounding it would be bounding something that cannot
 * happen. Practice keeps today's behaviour exactly: the free set ends on a
 * section boundary, nothing renders AT the boundary, and the results screen
 * that follows carries the score, the review and the weakest topic free.
 */
function boundToFreeSet(questions, freeSet, unlocked) {
  const list = Array.isArray(questions) ? questions : []
  if (unlocked || !freeSet || freeSet.coversWholePaper) return list
  const to = Number(freeSet.toQuestion)
  if (!Number.isFinite(to) || to <= 0) return list
  return list.slice(0, to)
}

export { mergeSessions }
