/**
 * The two modes a learner can sit a past paper in, as DATA.
 *
 * The spec's §1 table is a contract between five screens — the cover's mode
 * cards, the runner chrome, the footer, the exit sheet and the results header
 * all state the same seven facts about a mode. Written out at each call site
 * they drift: the cover promising "your place is saved" while the runner
 * discards it is not a rendering bug anyone notices in review, and it is the
 * exact promise a 12-year-old is deciding on.
 *
 * So the table is declared once and every surface reads it. `test:paper-quiz-
 * modes` pins the shape, and the cover's feature columns are generated from
 * `MODE_FEATURES` rather than typed — a mode that grows a capability grows a
 * column, and one that loses a promise loses it everywhere at once.
 *
 * Pure: no React, no Firebase, no DOM. Imported by the plain-node tests.
 */

export const QUIZ_MODE = Object.freeze({
  EXAM: 'exam',
  PRACTICE: 'practice',
})

/** Every mode id, in the order the cover offers them. */
export const QUIZ_MODES = Object.freeze([QUIZ_MODE.EXAM, QUIZ_MODE.PRACTICE])

/**
 * §1, one row per mode.
 *
 * `clock`, `feedback`, `navigation`, `leaving`, `resumes`, `recorded` and
 * `offline` are the seven columns of the spec table. They are booleans and
 * short enums rather than prose so a screen can BRANCH on them; the prose a
 * learner reads lives in MODE_COPY below, beside them, so the two cannot
 * describe different modes.
 */
export const MODE_RULES = Object.freeze({
  [QUIZ_MODE.EXAM]: Object.freeze({
    id: QUIZ_MODE.EXAM,
    /** Counts down from the paper's own durationMin. Cannot be paused. */
    clock: true,
    /** Nothing until submit — no colours, no ticks, no score. */
    feedback: 'on_submit',
    /** Back/Next + flag + review grid. See "why exam mode still lets them go back". */
    navigation: 'free',
    /** Leaving voids the attempt. */
    leaving: 'voids',
    /** A reload resumes with the real remaining time. */
    resumes: true,
    /** Score, sections, weak topics and history are written. */
    recorded: true,
    /** Needs network to start and to submit. */
    offline: false,
    /** The whole paper, or it is not a rehearsal. */
    requiresWholePaper: true,
  }),
  [QUIZ_MODE.PRACTICE]: Object.freeze({
    id: QUIZ_MODE.PRACTICE,
    clock: false,
    feedback: 'instant',
    /** Forward only — you answer, you read the coaching, you continue. */
    navigation: 'forward',
    leaving: 'free',
    resumes: true,
    /** No score on the exam record. Feeds topic mastery only. */
    recorded: false,
    offline: true,
    requiresWholePaper: false,
  }),
})

/** The words on the cover's mode cards. */
export const MODE_COPY = Object.freeze({
  [QUIZ_MODE.EXAM]: Object.freeze({
    name: 'Exam',
    // The duration is interpolated by the caller so the card states the
    // PAPER's own minutes rather than a number typed into this file.
    tagline: 'Just like the real thing.',
    pill: 'Exam',
  }),
  [QUIZ_MODE.PRACTICE]: Object.freeze({
    name: 'Practice',
    tagline: 'No clock.',
    detail: 'Learn as you go, one question at a time.',
    pill: 'Practice',
  }),
})

/**
 * The four feature columns each mode card expands to show.
 *
 * Derived from MODE_RULES rather than written beside it, so a rule change that
 * is not reflected in the columns is impossible: there is only the one source.
 * `icon` is a name the component maps to an SVG — this module draws nothing.
 */
export const MODE_FEATURES = Object.freeze({
  [QUIZ_MODE.EXAM]: Object.freeze([
    { icon: 'clock', label: 'The clock counts down and cannot be paused' },
    { icon: 'lock', label: 'No answers shown until you finish' },
    { icon: 'flag', label: 'Flag hard questions and come back to them' },
    { icon: 'award', label: 'Get your score and review at the end' },
  ]),
  [QUIZ_MODE.PRACTICE]: Object.freeze([
    { icon: 'check', label: 'See if you are right straight away' },
    { icon: 'book', label: 'Every answer is explained' },
    { icon: 'eye', label: 'No clock, no pressure' },
    { icon: 'play', label: 'Your place is saved as you go' },
  ]),
})

/** True for a value that names a mode. */
export function isQuizMode(value) {
  return value === QUIZ_MODE.EXAM || value === QUIZ_MODE.PRACTICE
}

/**
 * Read a mode off anything — a URL param, a stored attempt, a payload.
 *
 * Falls back to EXAM rather than to PRACTICE, and that direction is
 * deliberate: an unreadable mode on a RESUMED attempt must not silently
 * downgrade a running exam to practice, which would discard the clock and
 * quietly stop recording a paper the learner is part-way through. There is no
 * remembered default on the cover — §1 — so nothing reads this to choose FOR a
 * learner; it only repairs a value that should already be one of the two.
 */
export function normalizeMode(value) {
  return isQuizMode(value) ? value : QUIZ_MODE.EXAM
}

/** The rules row for a mode. Never null — an unknown mode reads as exam. */
export function rulesFor(mode) {
  return MODE_RULES[normalizeMode(mode)]
}

/** Convenience predicates, so screens read as sentences. */
export const isExam = (mode) => normalizeMode(mode) === QUIZ_MODE.EXAM
export const isPractice = (mode) => normalizeMode(mode) === QUIZ_MODE.PRACTICE
