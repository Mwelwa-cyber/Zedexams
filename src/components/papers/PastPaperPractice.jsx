/**
 * /papers/:paperId/practice — timed practice runner (audit A2 PR 3).
 *
 * The audit's leverage point on past papers: practising under timed
 * pressure is the #1 thing that improves performance on the real
 * exam. We don't auto-grade — past papers are PDFs and the mark
 * scheme is the teacher / parent step — but we DO record the
 * attempt so the learner can see "your second attempt was 12
 * minutes faster" later.
 *
 * Layout:
 *   - Top bar: paper title + countdown timer + Submit button
 *   - Body: PDF.js viewer (re-uses #319) so the paper stays
 *     scrollable + zoomable
 *   - On submit / time-up: brief reflection prompt + "Save" → toast
 *     → bounce back to /papers/:id with the success message.
 *
 * Defence-in-depth:
 *   - `beforeunload` warning while the timer is running so a tab-
 *     close prompts the user.
 *   - On unmount before submit, we mark the attempt 'abandoned' so
 *     the analytics layer can tell the difference between a real
 *     submit and a ghost.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  abandonPaperAttempt,
  getPaper,
  resolvePaperUrl,
  startPaperAttempt,
  submitPaperAttempt,
} from '../../utils/pastPapers'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'
import Skeleton from '../ui/Skeleton'

const PdfJsViewer = lazy(() => import('./PdfJsViewer'))

const FALLBACK_DURATION_MINUTES = 60

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const mm = Math.floor(s / 60).toString().padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

export default function PastPaperPractice() {
  const { paperId } = useParams()
  const { currentUser, loading: authLoading } = useAuth()

  const [paper, setPaper] = useState(null)
  const [paperUrl, setPaperUrl] = useState(null)
  const [loadError, setLoadError] = useState(false)

  const [attemptId, setAttemptId] = useState(null)
  const [startedAtMs, setStartedAtMs] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [reflection, setReflection] = useState('')
  const [submitError, setSubmitError] = useState('')

  // Track whether we already finalised the attempt so the unmount
  // cleanup doesn't flip a successful submit into 'abandoned'.
  const finalisedRef = useRef(false)

  // ── Load the paper + storage URL ───────────────────────────────
  useEffect(() => {
    if (!paperId) return
    let cancelled = false
    ;(async () => {
      try {
        const row = await getPaper(paperId)
        if (cancelled) return
        if (!row || row.status !== 'published') {
          setLoadError(true)
          return
        }
        setPaper(row)
        if (row.pdfPath) {
          try {
            const url = await resolvePaperUrl(row.pdfPath)
            if (!cancelled) setPaperUrl(url)
          } catch (err) {
            console.warn('[PastPaperPractice] pdf url failed', err)
          }
        }
      } catch (err) {
        console.warn('[PastPaperPractice] load failed', err)
        if (!cancelled) setLoadError(true)
      }
    })()
    return () => { cancelled = true }
  }, [paperId])

  // ── Start the attempt as soon as we have paper + user ───────────
  useEffect(() => {
    if (!paper || !currentUser || attemptId) return
    let cancelled = false
    ;(async () => {
      try {
        const id = await startPaperAttempt({
          uid: currentUser.uid,
          paper,
          durationMinutes: paper.durationMinutes ?? FALLBACK_DURATION_MINUTES,
        })
        if (cancelled) return
        setAttemptId(id)
        setStartedAtMs(Date.now())
      } catch (err) {
        console.warn('[PastPaperPractice] startAttempt failed', err)
        if (!cancelled) setSubmitError('Could not start the practice run. Try again.')
      }
    })()
    return () => { cancelled = true }
  }, [paper, currentUser, attemptId])

  // ── Tick once a second while the timer is running ──────────────
  useEffect(() => {
    if (!startedAtMs || done) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAtMs, done])

  // ── beforeunload guard while running ───────────────────────────
  useEffect(() => {
    if (!startedAtMs || done) return
    function onBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [startedAtMs, done])

  // ── Best-effort abandon on unmount before submit ───────────────
  useEffect(() => () => {
    if (attemptId && !finalisedRef.current) {
      abandonPaperAttempt(attemptId).catch(() => {})
    }
  }, [attemptId])

  const durationMinutes = paper?.durationMinutes ?? FALLBACK_DURATION_MINUTES
  const elapsedSeconds = startedAtMs ? Math.floor((now - startedAtMs) / 1000) : 0
  const totalSeconds = durationMinutes * 60
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds)
  const timeUp = startedAtMs && remainingSeconds <= 0
  const lowTime = remainingSeconds < 5 * 60

  // ── Auto-submit when time runs out ─────────────────────────────
  useEffect(() => {
    if (timeUp && !done && !submitting && attemptId) {
      void handleSubmit({ auto: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp])

  const handleSubmit = useCallback(async ({ auto = false } = {}) => {
    if (!attemptId || submitting || done) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await submitPaperAttempt({
        attemptId,
        elapsedSeconds: Math.max(0, elapsedSeconds),
        reflection: reflection || (auto ? '(auto-submitted at time-up)' : ''),
        paperGrade: paper?.grade ?? null,
        paperSubject: paper?.subject ?? null,
      })
      finalisedRef.current = true
      setDone(true)
    } catch (err) {
      console.warn('[PastPaperPractice] submit failed', err)
      setSubmitError(err?.message || 'Could not save your attempt. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [attemptId, submitting, done, elapsedSeconds, reflection, paper?.grade, paper?.subject])

  if (authLoading) return null
  if (!currentUser) {
    return <Navigate to={`/login?next=/papers/${paperId}/practice`} replace />
  }

  if (loadError) {
    return (
      <div className="min-h-screen theme-bg flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl mb-3">📄</div>
        <h1 className="theme-text font-black text-xl">Paper not available</h1>
        <p className="theme-text-muted text-sm mt-2 max-w-sm">
          This paper may have been moved or unpublished.
        </p>
        <Link
          to="/papers"
          className="mt-6 theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black"
        >
          ← Back to archive
        </Link>
      </div>
    )
  }

  if (!paper) {
    return (
      <div className="min-h-screen theme-bg p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-10 w-2/3 rounded-md" />
        <Skeleton className="h-12 rounded-md" />
        <Skeleton className="h-96 rounded-radius-md" />
      </div>
    )
  }

  // Done state: success card with link back to mark scheme + papers list.
  if (done) {
    return (
      <div className="min-h-screen theme-bg flex flex-col items-center px-4 py-12">
        <SeoHelmet title="Practice complete" path={`/papers/${paperId}/practice`} noIndex />
        <div className="w-full max-w-md theme-card border theme-border rounded-radius-md p-6 text-center">
          <div className="text-5xl mb-2">🎯</div>
          <h1 className="theme-text font-display font-black text-2xl">Time recorded</h1>
          <p className="theme-text-muted text-sm mt-1">
            {paper.title}
          </p>
          <p className="theme-text font-black text-3xl tabular-nums mt-4">
            {fmtClock(elapsedSeconds)}
          </p>
          <p className="theme-text-muted text-xs">
            {durationMinutes} min target · {Math.round((elapsedSeconds / 60) * 10) / 10} min taken
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {paper.markSchemePath && (
              <button
                type="button"
                onClick={async () => {
                  const url = await resolvePaperUrl(paper.markSchemePath)
                  if (url) window.open(url, '_blank', 'noopener,noreferrer')
                }}
                className="theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
              >
                📝 Open mark scheme
              </button>
            )}
            <Link
              to={`/papers/${paperId}`}
              className="theme-card border theme-border rounded-full px-5 py-2.5 text-sm font-black hover:theme-bg-subtle"
            >
              Back to this paper
            </Link>
            <Link
              to="/papers"
              className="text-xs font-bold theme-text-muted hover:theme-text mt-1"
            >
              Browse more papers
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen theme-bg flex flex-col">
      <SeoHelmet title={`${paper.title} — practice`} path={`/papers/${paperId}/practice`} noIndex />

      {/* Top bar — sticky so the timer is always visible */}
      <header className="sticky top-0 z-20 theme-card border-b theme-border px-4 py-2 flex items-center gap-3 shadow-elev-sm">
        <Logo className="h-5 w-auto flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="theme-text font-black text-sm truncate">{paper.title}</p>
          <p className="theme-text-muted text-[11px]">
            Grade {paper.grade} · {paper.year} · {durationMinutes} min target
          </p>
        </div>
        <div
          aria-live="polite"
          className={`tabular-nums font-black text-2xl px-3 py-1 rounded-xl flex-shrink-0 ${
            lowTime ? 'bg-rose-100 text-rose-800 animate-pulse' : 'theme-bg-subtle theme-text'
          }`}
        >
          {fmtClock(remainingSeconds)}
        </div>
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={submitting || !attemptId}
          className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-black hover:opacity-90 disabled:opacity-50 flex-shrink-0"
        >
          {submitting ? 'Saving…' : 'Submit'}
        </button>
      </header>

      {submitError && (
        <p role="alert" className="bg-rose-100 text-rose-800 text-sm font-bold px-4 py-2">
          {submitError}
        </p>
      )}

      {/* Reflection input — short, optional, surfaces on the same screen
          so the learner can jot down "the trapezium question hurt"
          without leaving the runner. */}
      <div className="px-4 pt-3">
        <label className="block text-[11px] font-black theme-text-muted uppercase tracking-widest mb-1.5">
          Anything to remember? <span className="font-normal opacity-70 normal-case">(optional)</span>
        </label>
        <input
          type="text"
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          placeholder='e.g. "Section B was hard — review fractions before next attempt"'
          maxLength={1000}
          className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
        />
      </div>

      {/* PDF viewer — same component the regular paper page uses. */}
      <div className="flex-1 px-4 pt-3 pb-6">
        {paperUrl ? (
          <Suspense fallback={
            <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
              Loading viewer…
            </div>
          }>
            <PdfJsViewer url={paperUrl} title={paper.title} />
          </Suspense>
        ) : (
          <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
            Loading paper…
          </div>
        )}
      </div>
    </div>
  )
}
