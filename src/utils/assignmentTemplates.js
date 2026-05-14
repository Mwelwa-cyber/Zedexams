/**
 * Predefined assignment templates teachers can apply in one tap.
 *
 * Each template pre-fills the wizard with a sensible bundle of options
 * (timer, retakes, shuffle, scheduling defaults). Custom edits are
 * always allowed after selection — the template is a starting point,
 * not a lock.
 *
 * Templates are intentionally plain data so they can also be stored
 * server-side in the future (e.g., per-school overrides) without
 * touching the wizard's call sites.
 */

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

export const ASSIGNMENT_TEMPLATES = [
  {
    id: 'homework',
    label: 'Homework',
    description: 'Untimed, retakes allowed, due in 24 hours.',
    icon: '📓',
    defaults: {
      timed: false,
      allowRetakes: true,
      shuffleQuestions: false,
      lockAfterSubmission: false,
      notifyLearners: true,
      addToDailyChallenge: false,
      dueOffsetMs: MS_PER_DAY,
      openOffsetMs: 0,
    },
  },
  {
    id: 'topic-test',
    label: 'Topic test',
    description: 'Timed, single attempt, shuffled questions. Due in 3 days.',
    icon: '🧠',
    defaults: {
      timed: true,
      allowRetakes: false,
      shuffleQuestions: true,
      lockAfterSubmission: true,
      notifyLearners: true,
      addToDailyChallenge: false,
      dueOffsetMs: 3 * MS_PER_DAY,
      openOffsetMs: 0,
    },
  },
  {
    id: 'monthly-test',
    label: 'Monthly test',
    description: 'Timed, one attempt, locked on submit. Opens in 1 day, due in 7 days.',
    icon: '🗓️',
    defaults: {
      timed: true,
      allowRetakes: false,
      shuffleQuestions: true,
      lockAfterSubmission: true,
      notifyLearners: true,
      addToDailyChallenge: false,
      openOffsetMs: MS_PER_DAY,
      dueOffsetMs: 7 * MS_PER_DAY,
    },
  },
  {
    id: 'mock-exam',
    label: 'Mock exam',
    description: 'Strict timer, shuffled, single attempt, lock on submit.',
    icon: '🎯',
    defaults: {
      timed: true,
      allowRetakes: false,
      shuffleQuestions: true,
      lockAfterSubmission: true,
      notifyLearners: true,
      addToDailyChallenge: false,
      openOffsetMs: MS_PER_DAY,
      dueOffsetMs: 2 * MS_PER_DAY,
    },
  },
]

export function getTemplate(id) {
  return ASSIGNMENT_TEMPLATES.find((t) => t.id === id) ?? null
}

/**
 * Resolve a template's relative offsets into concrete Date objects
 * anchored to "now". Returns { openAt, dueAt } as Date | null.
 */
export function resolveTemplateDates(template, now = new Date()) {
  if (!template) return { openAt: null, dueAt: null }
  const base = now.getTime()
  const openAt = template.defaults.openOffsetMs > 0
    ? new Date(base + template.defaults.openOffsetMs)
    : null
  const dueAt = template.defaults.dueOffsetMs > 0
    ? new Date(base + template.defaults.dueOffsetMs)
    : null
  return { openAt, dueAt }
}
