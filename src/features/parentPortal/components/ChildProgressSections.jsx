import { SUBJECTS } from '../../../config/curriculum'
import SubjectIcon from '../../../components/ui/SubjectIcon'

/**
 * ChildProgressSections — presentational render of the rendered child-progress
 * payload ({ summary, subjectBreakdown, recentResults }) returned by both the
 * public getProgressShare and the authenticated getChildProgress callables.
 * Kept prop-driven + firebase-free so it renders in the parent portal and is
 * easy to test in isolation.
 */

function fmtPct(n) {
  return typeof n === 'number' ? `${n}%` : '—'
}

function formatRelative(ms) {
  if (!ms) return ''
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function ResultRow({ row }) {
  const meta = SUBJECTS.find((s) => s.id === row.subject)
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg theme-bg-subtle text-base">
        <span aria-hidden="true">{meta?.icon || '📝'}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold theme-text">{row.quizTitle || meta?.label || 'Quiz'}</p>
        <p className="text-xs theme-text-muted">
          {meta?.label || row.subject || ''}
          {row.completedAtMs ? ` · ${formatRelative(row.completedAtMs)}` : ''}
        </p>
      </div>
      <span className="whitespace-nowrap text-sm font-black tabular-nums theme-text">
        {fmtPct(row.percentage)}
      </span>
    </li>
  )
}

export default function ChildProgressSections({ data }) {
  if (!data?.summary) return null
  const { summary, subjectBreakdown = [], recentResults = [] } = data

  return (
    <div className="space-y-4">
      {/* Headline KPIs */}
      <section className="theme-card rounded-radius-md border theme-border p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="font-display text-2xl font-black tabular-nums theme-text">{summary.totalAttempts}</p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider theme-text-muted">Quizzes done</p>
          </div>
          <div>
            <p className="font-display text-2xl font-black tabular-nums theme-text">{fmtPct(summary.averagePercentage)}</p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider theme-text-muted">Average score</p>
          </div>
          <div>
            <p className="font-display text-2xl font-black tabular-nums theme-text">
              {summary.currentStreak}{summary.currentStreak > 0 ? '🔥' : ''}
            </p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider theme-text-muted">Day streak</p>
          </div>
        </div>
      </section>

      {/* Subject breakdown */}
      {subjectBreakdown.length > 0 && (
        <section className="theme-card rounded-radius-md border theme-border p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider theme-text-muted">By subject</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {subjectBreakdown.map((row) => {
              const meta = SUBJECTS.find((s) => s.id === row.subject)
              return (
                <li key={row.subject} className="flex items-center gap-2 rounded-radius-md theme-bg-subtle px-3 py-2">
                  <SubjectIcon subject={meta} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold theme-text">
                    {meta?.shortLabel || meta?.label || row.subject}
                  </span>
                  <span className="whitespace-nowrap text-xs theme-text-muted">
                    {row.count}× · {fmtPct(row.averagePercentage)}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Recent quizzes */}
      {recentResults.length > 0 && (
        <section className="theme-card rounded-radius-md border theme-border p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider theme-text-muted">Recent quizzes</p>
          <ul className="divide-y divide-current/10">
            {recentResults.map((row, i) => (
              <ResultRow key={`${row.quizId || 'r'}-${i}`} row={row} />
            ))}
          </ul>
        </section>
      )}

      {summary.totalAttempts === 0 && (
        <section className="theme-card rounded-radius-md border theme-border p-6 text-center">
          <div className="mb-2 text-4xl">🌱</div>
          <h2 className="text-base font-black theme-text">No quizzes yet</h2>
          <p className="mt-2 text-sm theme-text-muted">
            Their results will appear here as they practise on ZedExams.
          </p>
        </section>
      )}
    </div>
  )
}
