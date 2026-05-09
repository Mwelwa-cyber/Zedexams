/**
 * /my-papers — history of timed past-paper practice runs (audit A2 PR 4).
 *
 * Closes A2's user story: a learner who's done multiple practice
 * runs can see all of them in one place, sorted by paper, with
 * best-time + run-count per paper. One tap re-opens any paper or
 * launches a fresh practice run.
 *
 * Self-hides for users with no submitted attempts so a free-tier
 * learner who never opened a paper isn't shown an empty surface.
 *
 * Auth-gated. The Firestore composite index on
 * (userId + submittedAt) is shipped by A2 PR 3.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { listMyPaperAttempts } from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function fmtRelative(ts) {
  if (!ts) return ''
  const ms = ts?.toMillis ? ts.toMillis() : new Date(ts).getTime()
  if (!Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function PaperGroupCard({ group }) {
  const { paper, attempts, bestSeconds, lastAt } = group
  const subjectMeta = SUBJECTS.find((s) => s.id === paper.subject)
  return (
    <article className="theme-card border theme-border rounded-radius-md p-4 flex items-start gap-3">
      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl theme-bg-subtle">
        <span aria-hidden="true">{subjectMeta?.icon || '📄'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm truncate">{paper.title}</p>
        <p className="theme-text-muted text-xs mt-0.5">
          Grade {paper.grade}
          {subjectMeta ? ` · ${subjectMeta.label}` : ''}
          {paper.year ? ` · ${paper.year}` : ''}
        </p>
        <p className="theme-text-muted text-[11px] mt-1">
          {attempts.length} attempt{attempts.length === 1 ? '' : 's'} · best {fmtDuration(bestSeconds)} · last {fmtRelative(lastAt)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <Link
          to={`/papers/${paper.id}/practice`}
          className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-black hover:opacity-90"
        >
          Try again
        </Link>
        <Link
          to={`/papers/${paper.id}`}
          className="text-xs font-bold theme-text-muted hover:theme-text"
        >
          View paper
        </Link>
      </div>
    </article>
  )
}

export default function MyPapersHistory() {
  const { currentUser } = useAuth()
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setLoading(true)
    listMyPaperAttempts(currentUser.uid, { limit: 60 })
      .then((rows) => { if (!cancelled) setAttempts(rows) })
      .catch((err) => {
        console.warn('[MyPapersHistory] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  // Group by paperId. Each group keeps the snapshotted paper meta
  // from the most recent attempt (in case the underlying paper is
  // later unpublished or retitled).
  const groups = useMemo(() => {
    const byPaper = new Map()
    for (const a of attempts) {
      if (a.status !== 'submitted') continue
      const paperId = a.paperId
      const elapsed = Number(a.elapsedSeconds) || 0
      const submittedMs = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0
      const existing = byPaper.get(paperId)
      if (!existing) {
        byPaper.set(paperId, {
          paper: {
            id: paperId,
            title: a.paperTitle || 'Past paper',
            grade: a.paperGrade,
            subject: a.paperSubject,
            year: a.paperYear,
          },
          attempts: [a],
          bestSeconds: elapsed,
          lastAt: a.submittedAt,
          lastMs: submittedMs,
        })
      } else {
        existing.attempts.push(a)
        if (elapsed > 0 && (existing.bestSeconds === 0 || elapsed < existing.bestSeconds)) {
          existing.bestSeconds = elapsed
        }
        if (submittedMs > existing.lastMs) {
          existing.lastAt = a.submittedAt
          existing.lastMs = submittedMs
        }
      }
    }
    return [...byPaper.values()].sort((a, b) => b.lastMs - a.lastMs)
  }, [attempts])

  return (
    <div className="min-h-screen theme-bg pb-16">
      <SeoHelmet
        title="My past-paper practice"
        description="Your timed practice runs across the ECZ past-paper archive."
        path="/my-papers"
        noIndex
      />

      <header className="theme-hero px-4 pt-6 pb-12" data-bg-gradient="true">
        <div className="max-w-3xl mx-auto">
          <Link to="/papers" className="text-white/80 hover:text-white text-xs font-bold inline-flex items-center gap-1.5 mb-3">
            ← Browse all papers
          </Link>
          <p className="text-white/80 font-black text-xs uppercase tracking-widest">My practice</p>
          <h1 className="text-white text-2xl sm:text-3xl font-black mt-1">My past-paper runs</h1>
          <p className="text-white/85 text-sm sm:text-base mt-2 max-w-2xl">
            Every timed paper you&apos;ve practised. Tap a paper to retry it
            and watch your best time drop.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 -mt-6 space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-radius-md" />)}
          </div>
        ) : errored ? (
          <div role="alert" className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
            We couldn&apos;t load your runs. Please refresh and try again.
          </div>
        ) : groups.length === 0 ? (
          <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
            <div className="text-5xl mb-3">⏱️</div>
            <h2 className="theme-text font-black text-lg">No timed runs yet</h2>
            <p className="theme-text-muted text-sm mt-2 max-w-md mx-auto">
              Open any paper from the archive and tap &ldquo;🎯 Practise as
              timed exam&rdquo; to start one. Your runs will gather here so
              you can see your time get faster.
            </p>
            <Link
              to="/papers"
              className="mt-4 inline-block theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
            >
              Browse the archive
            </Link>
          </div>
        ) : (
          groups.map((g) => <PaperGroupCard key={g.paper.id} group={g} />)
        )}
      </main>
    </div>
  )
}
