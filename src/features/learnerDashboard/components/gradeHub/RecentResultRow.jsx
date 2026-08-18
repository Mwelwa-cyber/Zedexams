/**
 * One row in the recent-activity list: quiz name, subject/grade/date, score.
 */
import { memo } from 'react'
import { PencilLine } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'

const RecentResultRow = memo(function RecentResultRow({ result }) {
  const pctColor = p => p >= 70 ? 'text-green-600' : p >= 50 ? 'text-amber-600' : 'text-red-500'
  function fmt(ts) {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    const now = new Date()
    const days = Math.floor((now - d) / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return (
    <div className="flex items-center gap-3 py-3 border-b theme-border last:border-0">
      <div className="w-10 h-10 theme-accent-bg rounded-xl flex items-center justify-center text-lg flex-shrink-0">
        <Icon as={PencilLine} size="md" strokeWidth={2.1} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold theme-text text-sm truncate">{result.quizTitle || 'Quiz'}</p>
        <p className="theme-text-muted text-xs">{result.subject} · Grade {result.grade} · {fmt(result.completedAt)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`font-black text-lg ${pctColor(result.percentage)}`}>{result.percentage}%</p>
        <p className="theme-text-muted text-xs">{result.score}/{result.totalMarks}</p>
      </div>
    </div>
  )
})

export default RecentResultRow
