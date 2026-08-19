/**
 * setupWizardCore — the first-run setup wizard, as rules rather than as JSX.
 *
 * The mockup's onboarding is two halves and only one of them was missing.
 * The half that already exists is the COMPLIANCE half — role picker, the
 * neutral age gate, the guardian-email hand-off — and it lives in
 * `src/utils/signupFlowCore.js` with its own tests. Nothing here re-decides
 * any of that; a learner reaches this wizard only once that flow has already
 * produced an account.
 *
 * What this owns is the half after the account exists: the four setup screens
 * (grade → subjects → Meet Zed → notifications) the prototype shows with a
 * four-dot progress bar.
 *
 * Written as pure rules, for the same two reasons signupFlowCore is:
 *
 *   1. THE GUARANTEE IS "NO SCREEN IS REACHED BEFORE IT IS EARNED", not "the
 *      button is disabled". A deep link to ?step=subjects, a refresh that
 *      loses React state and the browser back button all have to land
 *      somewhere legal, and each of those is a component-level `if` waiting
 *      to be forgotten. `resolveSetupStep` answers all three with one rule.
 *
 *   2. It is checkable under plain `node`, without a browser.
 *
 * Pure: no DOM, no storage, no React, no Firebase.
 */

/** The four screens, in the order the prototype shows them. */
export const SETUP_STEP = Object.freeze({
  GRADE: 'grade',
  SUBJECTS: 'subjects',
  ZED: 'zed',
  NOTIFICATIONS: 'notifications',
})

/** Step order — also the order of the four progress dots. */
export const SETUP_STEPS = Object.freeze([
  SETUP_STEP.GRADE,
  SETUP_STEP.SUBJECTS,
  SETUP_STEP.ZED,
  SETUP_STEP.NOTIFICATIONS,
])

/**
 * Is this a grade the learner side can actually serve?
 *
 * Deliberately strict about the string forms Firestore hands back ('7', 7,
 * ' 7 ') and deliberately silent about which grades exist — the caller passes
 * the catalogue, because the catalogue is config and this is a rule.
 */
export function normalizeGrade(value, allowed) {
  const n = Number(String(value ?? '').trim())
  if (!Number.isInteger(n)) return null
  if (Array.isArray(allowed) && !allowed.includes(n)) return null
  return n
}

/**
 * Does this learner still need to be set up?
 *
 * KEYED ON THE GRADE, NOT ON A "SETUP COMPLETED" FLAG, and that is the whole
 * design. Every learner who signed up before this wizard existed has a grade
 * (it was a required field) and no completion flag — so a flag-based test
 * would march the entire existing learner base back through onboarding on the
 * day it shipped. The grade is also the one answer the learner side genuinely
 * cannot run without: it decides the subject list, the topic catalogue, the
 * daily exam and the timetable.
 *
 * The consequence, stated rather than hidden: a learner who abandons the
 * wizard has no grade and meets it again next visit. That is the intended
 * behaviour — "finish setting up" — not a trap, because the wizard's first
 * step is the thing that clears it.
 */
export function needsSetup(profile, allowed) {
  if (!profile || typeof profile !== 'object') return false
  return normalizeGrade(profile.grade, allowed) === null
}

/**
 * The step the learner may actually be on.
 *
 * Total: every requested value, including garbage and undefined, resolves to
 * a legal step. The one ordering rule is that SUBJECTS cannot be reached
 * before a grade exists, because the subject list is derived from the grade —
 * a subjects screen with no grade behind it has nothing to offer.
 *
 * Meet Zed and the notification ask carry no prerequisite of their own: both
 * are things we tell the learner rather than ask them, so there is nothing
 * for them to be missing.
 */
export function resolveSetupStep({ requested, grade } = {}) {
  const step = SETUP_STEPS.includes(requested) ? requested : SETUP_STEP.GRADE
  if (step === SETUP_STEP.GRADE) return SETUP_STEP.GRADE
  if (grade === null || grade === undefined || grade === '') return SETUP_STEP.GRADE
  return step
}

/** 0-based position, for the progress dots. -1 for an unknown step. */
export function stepIndex(step) {
  return SETUP_STEPS.indexOf(step)
}

/** The next/previous step, or null at either end. */
export function nextStep(step) {
  const i = stepIndex(step)
  return i < 0 || i >= SETUP_STEPS.length - 1 ? null : SETUP_STEPS[i + 1]
}
export function prevStep(step) {
  const i = stepIndex(step)
  return i <= 0 ? null : SETUP_STEPS[i - 1]
}

/**
 * May the learner leave this step?
 *
 * Only the grade blocks. Subjects deliberately do NOT: "pick your subjects"
 * is a preference that narrows what we show first, not a gate, and a child
 * who taps Continue without choosing gets the grade's full set rather than an
 * empty app. Making it required would also make it a second way to be stuck
 * behind a screen, for an answer we can infer perfectly well.
 */
export function canAdvance(step, draft = {}) {
  if (step === SETUP_STEP.GRADE) return draft.grade !== null && draft.grade !== undefined && draft.grade !== ''
  return true
}

/**
 * The profile patch the wizard writes when it finishes.
 *
 * `subjects: []` is written as "no narrowing", never as "no subjects" — the
 * reader is `resolveSetupSubjects` below, and the two have to agree or an
 * empty pick would read as an empty app.
 *
 * The notification answer maps onto the EXISTING preference shape rather than
 * a new field: the wizard's one question ("want a gentle daily reminder?") is
 * the learning category plus the push channel, which is exactly what Settings
 * already toggles. A separate flag here would be a second source of truth for
 * the same switch, and the two would drift the first time either was edited.
 *
 * `currentPrefs` must be an ALREADY-NORMALIZED prefs object, and the whole
 * object is written back. That is not a style choice: the profile write is a
 * Firestore `updateDoc`, which REPLACES a map wholesale rather than merging
 * into it, so returning `{categories: {learning: x}}` would silently delete
 * every other category and both quiet-hours settings. Writing the full
 * normalized object is what the Settings page already does.
 */
export function buildSetupPatch({ grade, subjects, wantsReminders, currentPrefs } = {}) {
  const patch = {
    grade: String(grade),
    learnerSetup: { version: 1 },
  }
  const picked = Array.isArray(subjects) ? subjects.filter((s) => typeof s === 'string' && s) : []
  patch.learnerSubjects = picked
  if (typeof wantsReminders === 'boolean' && currentPrefs && typeof currentPrefs === 'object') {
    patch.notificationPrefs = {
      ...currentPrefs,
      categories: { ...currentPrefs.categories, learning: wantsReminders },
      channels: { ...currentPrefs.channels, push: wantsReminders },
    }
  }
  return patch
}

/**
 * Which subjects a learner's screens should show.
 *
 * The pair to `buildSetupPatch`: an empty or missing pick means "everything
 * the grade takes", never "nothing". A stored subject that is not in the
 * grade's catalogue is dropped rather than shown — a learner who picked
 * subjects in Grade 6 and moved up to Grade 7 must not carry a subject the
 * new grade does not sit.
 */
export function resolveSetupSubjects(picked, gradeSubjectIds) {
  const all = Array.isArray(gradeSubjectIds) ? gradeSubjectIds : []
  if (!Array.isArray(picked) || picked.length === 0) return all
  const kept = picked.filter((id) => all.includes(id))
  return kept.length > 0 ? kept : all
}

/* ─────────────────────────────────────────────────────────────────
 * Staged grade rollout
 * ───────────────────────────────────────────────────────────────── */

/** The three things that can be true of a learner's grade. */
export const GRADE_ACCESS = Object.freeze({
  /** The grade is open — the learner side serves it today. */
  OK: 'ok',
  /** A real catalogue grade that has not opened yet. Waitlist screen. */
  WAITLIST: 'waitlist',
  /** No grade, or nothing the catalogue recognises. The setup wizard's job. */
  UNKNOWN: 'unknown',
})

/**
 * May this learner use the learner app?
 *
 * Three-way rather than two, and the third value is the whole point. Narrowing
 * the wizard's grade list on its own would make an existing Grade 5 learner
 * fail `needsSetup` and get marched back through onboarding, where the only
 * button on offer relabels them Grade 7. That is a silent data change to a
 * child's profile, made by a rollout decision they never saw — so a grade that
 * exists but has not opened is its own answer, and it keeps the stored grade.
 *
 * UNKNOWN is returned rather than WAITLIST for a missing grade because the two
 * want opposite screens: a learner with no grade needs the wizard, and showing
 * them "your grade is coming soon" would be both false and a dead end. It is
 * also what keeps admins and parents — who legitimately have no grade of their
 * own — out of the waitlist when they open a learner screen.
 *
 * Pure: the caller passes both catalogues, for the same reason
 * `normalizeGrade` takes `allowed` — which grades are live is config, and this
 * is a rule.
 *
 * @param {object|null} profile      the learner's user profile
 * @param {number[]} liveGrades      grades open to learners today
 * @param {number[]} catalogueGrades every grade the product knows about
 */
export function resolveLearnerGradeAccess(profile, liveGrades, catalogueGrades) {
  if (!profile || typeof profile !== 'object') return GRADE_ACCESS.UNKNOWN
  if (normalizeGrade(profile.grade, liveGrades) !== null) return GRADE_ACCESS.OK
  if (normalizeGrade(profile.grade, catalogueGrades) !== null) return GRADE_ACCESS.WAITLIST
  return GRADE_ACCESS.UNKNOWN
}
