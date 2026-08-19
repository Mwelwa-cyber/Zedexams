/**
 * src/features/adminDailyQuiz/lib/adminDailyQuizCore.js
 *
 * Pure copy + status logic for the Daily Quiz console. No React, no
 * Firebase, so it tests under plain node (`test:admin-daily-quiz`).
 *
 * The chips here are the console's whole job — an admin reads this page to
 * answer "is today fine, and if not, whose fault is it". A chip that cannot
 * tell an unknown state from a healthy one makes the page worse than
 * nothing, so the rule below is that absence of information is its own
 * status.
 */

/**
 * The status chip for one grade's run.
 *
 * FOUR states, and the fourth is load-bearing. `thin` is not a failure of
 * the RUN — the job did exactly what it should and the bank could not fill
 * five questions — so it reads as a content problem, not a red cron. And a
 * document that does not exist yet before the cron has fired is `queued`,
 * not `missing`: calling it missing at 00:02 would train an admin to ignore
 * the one word that should mean something.
 */
export function runStatusChip(row) {
  if (!row || !row.exists) {
    return { key: 'queued', label: 'queued', bg: '#eef0fb', fg: '#6b7392' }
  }
  if (row.status === 'thin') {
    return { key: 'thin', label: '⚠ thin bank', bg: '#fdeceb', fg: '#a02a2a' }
  }
  if (row.createdBy === 'selfheal') {
    return { key: 'selfheal', label: '✓ self-heal', bg: '#e8f4fd', fg: '#1565a7' }
  }
  if (row.createdBy === 'monitor') {
    return { key: 'monitor', label: '✓ Vigil built', bg: '#e8f4fd', fg: '#1565a7' }
  }
  if (row.createdBy === 'admin') {
    return { key: 'admin', label: '✓ run by hand', bg: '#fff6e0', fg: '#8a6100' }
  }
  return { key: 'ok', label: '✓ written', bg: '#eaf7f0', fg: '#12734a' }
}

/**
 * Whether tomorrow's quiz can still be changed, in words.
 *
 * The clock lock is only HALF the rule — the other half is "has anyone
 * played", which is a fact about the database and is enforced server-side
 * in `canEditQuiz`. This copy says so rather than promising an edit window
 * the server may refuse: an admin who is told they have until 23:00 and is
 * then refused at 21:00 will assume the tool is broken.
 */
export function describeSwapState({ nowHour, cutoffHour = 23 } = {}) {
  // `Number(null)` is 0 and `Number(undefined)` is NaN, so a Number()-then-
  // isFinite() check alone reads a MISSING clock as midnight and leaves the
  // window open — a fail-open on the one value that decides whether an edit
  // is offered. Reject the empty cases before coercing.
  const hour = nowHour === null || nowHour === undefined || nowHour === ''
    ? NaN
    : Number(nowHour)
  if (!Number.isFinite(hour)) {
    return {
      locked: true,
      label: 'Edit window unknown',
      detail: 'We could not read the server clock, so no swap is offered. Reload the console.',
    }
  }
  if (hour >= cutoffHour) {
    return {
      locked: true,
      label: `🔒 Locked — swaps closed at ${cutoffHour}:00`,
      detail: 'Tomorrow’s quiz is now immutable. If an error is found, void the question rather '
        + 'than editing it.',
    }
  }
  return {
    locked: false,
    label: `🔓 Editable until ${cutoffHour}:00 tonight`,
    detail: 'At midnight the document becomes immutable — and it locks sooner if any learner has '
      + 'already played it, because changing a question would rank learners against different '
      + 'quizzes.',
  }
}

/**
 * Which selection rules bent, in words an admin can act on.
 *
 * "No rules relaxed" is stated rather than left blank: a blank line reads as
 * missing data, and the difference between "nothing bent" and "we don't know"
 * is exactly what this console exists to show.
 */
export function formatRelaxed(rulesRelaxed) {
  const rules = Array.isArray(rulesRelaxed) ? rulesRelaxed : []
  if (rules.length === 0) return 'No rules relaxed — the pool satisfied every constraint.'
  const words = {
    difficulty: 'the 2·2·1 difficulty mix',
    subject: 'the subject spread',
    freshness: 'the 30-day no-repeat rule',
  }
  const listed = rules.map((r) => words[r] || r)
  const tail = listed.length === 1
    ? listed[0]
    : `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1]}`
  return `Relaxed ${tail} — the pool could not fill five slots otherwise.`
}
