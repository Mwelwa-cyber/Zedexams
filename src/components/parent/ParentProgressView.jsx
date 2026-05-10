/**
 * /parent/:token — public read-only progress dashboard for a parent.
 * Audit A3 PR 1.
 *
 * Renders the response from getProgressShare. The route is intentionally
 * unauthenticated — the token IS the permission, mirroring /shares.
 *
 * Three top-level states:
 *   - loading: spinner / skeleton
 *   - loaded ok: greeting + KPIs + subject breakdown + recent results
 *   - error: friendly "this link has been revoked / has expired / is
 *     not valid" page with no app chrome (parents don't need a side
 *     bar telling them to sign up — they're here to see their child).
 *
 * Mobile-first, no app chrome. Parents will mostly open the link from
 * a WhatsApp message on their phone.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getProgressShare } from '../../utils/parentShares'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'
import Skeleton from '../ui/Skeleton'
import SubjectIcon from '../ui/SubjectIcon'

function formatRelative(ms) {
  if (!ms) return ''
  const diffMs = Date.now() - ms
  if (diffMs < 60_000) return 'just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function fmtPct(n) {
  return typeof n === 'number' ? `${n}%` : '—'
}

function ResultRow({ row }) {
  const meta = SUBJECTS.find((s) => s.id === row.subject)
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex-shrink-0 w-9 h-9 rounded-lg theme-bg-subtle flex items-center justify-center text-base">
        <span aria-hidden="true">{meta?.icon || '📝'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-bold text-sm truncate">
          {row.quizTitle || meta?.label || 'Quiz'}
        </p>
        <p className="theme-text-muted text-xs">
          {meta?.label || row.subject || ''}
          {row.completedAtMs ? ` · ${formatRelative(row.completedAtMs)}` : ''}
        </p>
      </div>
      <span className="theme-text font-black text-sm tabular-nums whitespace-nowrap">
        {fmtPct(row.percentage)}
      </span>
    </li>
  )
}

function ErrorPanel({ title, body }) {
  return (
    <div className="min-h-screen theme-bg flex flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl mb-3">📭</div>
      <h1 className="theme-text font-black text-xl">{title}</h1>
      <p className="theme-text-muted text-sm mt-2 max-w-sm">{body}</p>
      <p className="theme-text-muted text-xs mt-6">
        Powered by <Link to="/" className="theme-accent-text font-bold">ZedExams</Link>
      </p>
    </div>
  )
}

export default function ParentProgressView() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    getProgressShare(token)
      .then((row) => { if (!cancelled) setData(row) })
      .catch((err) => {
        console.warn('[ParentProgressView] load failed', err)
        if (!cancelled) {
          // Map server messages to friendly headings.
          const msg = err?.message || ''
          if (/revoked/i.test(msg)) {
            setError({ title: 'This link has been revoked', body: 'Your child can send you a fresh link from their ZedExams profile.' })
          } else if (/expired/i.test(msg)) {
            setError({ title: 'This link has expired', body: 'Progress links expire after 90 days. Ask your child to send you a new one.' })
          } else if (/invalid/i.test(msg) || /not[- ]found/i.test(msg)) {
            setError({ title: 'This link is not valid', body: 'Check the URL, or ask your child to share a fresh link from their profile.' })
          } else {
            setError({ title: 'We can\'t open this link right now', body: 'Please check your connection and try again.' })
          }
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen theme-bg p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-2/3 rounded-md" />
        <Skeleton className="h-32 rounded-radius-md" />
        <Skeleton className="h-48 rounded-radius-md" />
      </div>
    )
  }

  if (error) {
    return (
      <>
        <SeoHelmet title="Progress link" path={`/parent/${token}`} noIndex />
        <ErrorPanel title={error.title} body={error.body} />
      </>
    )
  }

  if (!data) return null

  const greetingName = data.parentDisplayName ? data.parentDisplayName : 'there'
  const learnerLabel = data.learnerDisplayName

  return (
    <div className="min-h-screen theme-bg pb-12">
      <SeoHelmet
        title={`${learnerLabel}'s progress`}
        description={`A read-only weekly snapshot of ${learnerLabel}'s ZedExams progress, shared by their child.`}
        path={`/parent/${token}`}
        noIndex
      />

      <header className="theme-hero px-4 pt-6 pb-12" data-bg-gradient="true">
        <div className="max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 mb-4">
            <Logo className="h-6 w-auto" />
          </Link>
          <p className="text-white/80 font-black text-xs uppercase tracking-widest">
            Hi {greetingName} 👋
          </p>
          <h1 className="text-white text-2xl sm:text-3xl font-black mt-1">
            {learnerLabel}&apos;s ZedExams progress
          </h1>
          <p className="text-white/80 text-sm mt-2">
            Last {data.summary.windowDays} days
            {data.learnerGrade ? ` · Grade ${data.learnerGrade}` : ''}
            {data.learnerSchool ? ` · ${data.learnerSchool}` : ''}
          </p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 -mt-6 space-y-4">
        {/* Headline KPIs */}
        <section className="theme-card border theme-border rounded-radius-md p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="theme-text font-display font-black text-2xl tabular-nums">
                {data.summary.totalAttempts}
              </p>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1">
                Quizzes done
              </p>
            </div>
            <div>
              <p className="theme-text font-display font-black text-2xl tabular-nums">
                {fmtPct(data.summary.averagePercentage)}
              </p>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1">
                Average score
              </p>
            </div>
            <div>
              <p className="theme-text font-display font-black text-2xl tabular-nums">
                {data.summary.currentStreak}{data.summary.currentStreak > 0 ? '🔥' : ''}
              </p>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1">
                Day streak
              </p>
            </div>
          </div>
        </section>

        {/* Subject breakdown */}
        {data.subjectBreakdown.length > 0 && (
          <section className="theme-card border theme-border rounded-radius-md p-4">
            <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
              By subject
            </p>
            <ul className="grid sm:grid-cols-2 gap-2">
              {data.subjectBreakdown.map((row) => {
                const meta = SUBJECTS.find((s) => s.id === row.subject)
                return (
                  <li
                    key={row.subject}
                    className="flex items-center gap-2 theme-bg-subtle rounded-radius-md px-3 py-2"
                  >
                    <SubjectIcon subject={meta} size="sm" />
                    <span className="theme-text font-bold text-sm flex-1 min-w-0 truncate">
                      {meta?.shortLabel || meta?.label || row.subject}
                    </span>
                    <span className="theme-text-muted text-xs whitespace-nowrap">
                      {row.count}× · {fmtPct(row.averagePercentage)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Recent results */}
        {data.recentResults.length > 0 && (
          <section className="theme-card border theme-border rounded-radius-md p-4">
            <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
              Recent quizzes
            </p>
            <ul className="divide-y divide-current/10">
              {data.recentResults.map((row, i) => (
                <ResultRow key={`${row.quizId || 'r'}-${i}`} row={row} />
              ))}
            </ul>
          </section>
        )}

        {data.summary.totalAttempts === 0 && (
          <section className="theme-card border theme-border rounded-radius-md p-6 text-center">
            <div className="text-4xl mb-2">🌱</div>
            <h2 className="theme-text font-black text-base">No quizzes yet</h2>
            <p className="theme-text-muted text-sm mt-2">
              {learnerLabel} just got started. Their results will appear here as they
              practise on ZedExams.
            </p>
          </section>
        )}

        <p className="theme-text-muted text-[11px] text-center pt-2">
          Powered by <Link to="/" className="theme-accent-text font-bold">ZedExams</Link>
          {data.expiresAtMs && (
            <> · This link expires {new Date(data.expiresAtMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</>
          )}
        </p>
      </div>
    </div>
  )
}
