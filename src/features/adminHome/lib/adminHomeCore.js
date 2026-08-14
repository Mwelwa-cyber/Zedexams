/**
 * The admin dashboard's pure decisions: what needs an admin's attention, and
 * how a recent result is read.
 *
 * Pure — no React, no Firebase, no DOM. Lifted out of `AdminDashboard.jsx`
 * unchanged during the Wave 4 admin migration (slice 4), for the reason
 * `demoTrialsCore` records: pinning pure logic AS it is lifted is what stops a
 * move becoming a regression. Every rule below was inline in the component and
 * had no test of any kind.
 *
 * ## The one rule worth stating
 *
 * **An absent count is not a zero count, but it is treated as one here.** The
 * loader already collapses a failed `getGenerationsSummary` or
 * `getPendingPayments` into zeros so the dashboard stays mounted with its
 * shell and quick-actions usable. That is a deliberate availability choice
 * made at the call site, and this module inherits it rather than second-
 * guessing it: a missing count produces no attention item, so the queue can
 * under-report after a partial load. It never over-reports, which is the
 * direction that matters for a queue an admin works from.
 */

/** Recent scores at or below this percentage are worth an admin's attention. */
export const LOW_SCORE_THRESHOLD = 40

/**
 * Score bands for the recent-results table. Kept as names rather than colours
 * so the table owns its palette — `monochrome.js` checks printed ink, and a
 * hex in a pure module is a hex no renderer can override.
 */
export function scoreBand(percentage) {
  if (percentage >= 70) return 'green'
  if (percentage >= 50) return 'amber'
  return 'red'
}

/**
 * How many of these results fall below the threshold.
 *
 * Guards the type rather than trusting it: a result whose `percentage` never
 * got written is not a low score, it is an unknown one, and counting it would
 * page an admin about a document that says nothing.
 */
export function countLowScores(results) {
  if (!Array.isArray(results)) return 0
  return results.filter(r => typeof r?.percentage === 'number' && r.percentage < LOW_SCORE_THRESHOLD).length
}

/** English plural for a count, for the queue's own titles. */
const plural = (n, one, many) => (n === 1 ? one : many)

/**
 * The review queue, high priority first.
 *
 * Order is load-bearing rather than incidental: the two generation failures
 * are `high` because they mean content may already be wrong in front of
 * learners, and the three below them are `medium` because they mean work is
 * waiting. The list is built in that order and not sorted afterwards — a sort
 * over equal levels would leave the medium three in whatever order the
 * comparator happened to be stable in.
 */
export function buildAttentionItems(stats = {}) {
  const items = []
  const {
    gensFlagged = 0,
    gensFailed = 0,
    pending = 0,
    pendingPayments = 0,
    lowScores = 0,
  } = stats

  if (gensFlagged > 0) {
    items.push({
      to: '/admin/generations',
      icon: '!',
      title: `${gensFlagged} AI generation${plural(gensFlagged, '', 's')} flagged`,
      detail: 'Open the generation logs and inspect the flagged output.',
      level: 'high',
      action: 'Audit',
    })
  }
  if (gensFailed > 0) {
    items.push({
      to: '/admin/generations',
      icon: '✕',
      title: `${gensFailed} AI generation${plural(gensFailed, '', 's')} failed`,
      detail: 'A generator run errored out — check the logs for the cause.',
      level: 'high',
      action: 'Open logs',
    })
  }
  if (pending > 0) {
    items.push({
      to: '/admin/approvals',
      icon: '!',
      title: `${pending} content item${plural(pending, '', 's')} awaiting approval`,
      detail: 'Review learner-facing lessons and quizzes before they go live.',
      level: 'medium',
      action: 'Review',
    })
  }
  if (pendingPayments > 0) {
    items.push({
      to: '/admin/payments',
      icon: '$',
      title: `${pendingPayments} payment${plural(pendingPayments, '', 's')} pending`,
      detail: 'Confirm or reject MoMo requests to unblock premium access.',
      level: 'medium',
      action: 'Settle',
    })
  }
  if (lowScores > 0) {
    items.push({
      to: '/admin/results',
      icon: '↓',
      title: `${lowScores} recent score${plural(lowScores, '', 's')} below ${LOW_SCORE_THRESHOLD}%`,
      detail: 'Several learners are struggling on recent quizzes — review results.',
      level: 'medium',
      action: 'Review',
    })
  }
  return items
}

/**
 * A Firestore timestamp, a Date or a date string as the table prints it.
 *
 * Returns the em-dash for anything it cannot read, including an Invalid Date,
 * because a results table that throws takes the whole dashboard with it and a
 * row whose date is unknown is still a row worth showing.
 */
export function formatResultDate(value) {
  if (!value) return '—'
  try {
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
    if (!date || Number.isNaN(date.getTime?.())) return '—'
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}
