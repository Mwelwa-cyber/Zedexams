// Active-assignment studio seed — one shared source so every generate-studio
// pre-fills grade/subject/curriculum from the teacher's ACTIVE Teaching Profile
// assignment, not just the legacy teacherPreferences.curriculum default.
//
// The seed shape { curriculum, grade, subject } matches curriculumSeedFromProfile
// and StudioCurriculumSelector's normalizeSelectorSeed exactly (server-ready
// values: 'cbc'/'previous', 'G5', 'mathematics'), and a Teaching Profile
// assignment already stores those same values — so it drops straight in.
//
// Persisted to localStorage by the dashboard (and other profile-aware surfaces)
// when the active assignment resolves, so studios can read it SYNCHRONOUSLY at
// mount without a Firestore round-trip or an async re-seed.
//
// Run tests: npm run test:active-assignment-seed

const SEED_KEY = (uid) => `zedexams:active-seed:${uid}`

/** Pure: the selector seed for an assignment, or null when it carries nothing. */
export function assignmentSelectorSeed(assignment) {
  if (!assignment) return null
  const grade = typeof assignment.grade === 'string' ? assignment.grade : ''
  const subject = typeof assignment.subject === 'string' ? assignment.subject : ''
  if (!grade && !subject) return null
  const curriculum = assignment.curriculumType === 'previous' ? 'previous' : 'cbc'
  return { curriculum, grade, subject }
}

function safeLocalStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** Persist the active assignment's seed (best-effort). Clears it when null. */
export function writeActiveAssignmentSeed(uid, assignment) {
  const ls = safeLocalStorage()
  if (!ls || !uid) return
  const seed = assignmentSelectorSeed(assignment)
  try {
    if (seed) ls.setItem(SEED_KEY(uid), JSON.stringify(seed))
    else ls.removeItem(SEED_KEY(uid))
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/** Read the persisted active-assignment seed, or null. Synchronous. */
export function readActiveAssignmentSeed(uid) {
  const ls = safeLocalStorage()
  if (!ls || !uid) return null
  try {
    const raw = ls.getItem(SEED_KEY(uid))
    if (!raw) return null
    const seed = JSON.parse(raw)
    if (!seed || typeof seed !== 'object') return null
    if (!seed.grade && !seed.subject) return null
    return { curriculum: seed.curriculum === 'previous' ? 'previous' : 'cbc', grade: seed.grade || '', subject: seed.subject || '' }
  } catch {
    return null
  }
}

/**
 * The seed a studio should open on, in priority order:
 *   1. a URL deep-link ('?grade=&subject=' from Quick Create / "Generate similar")
 *   2. the active Teaching Profile assignment (persisted)
 *   3. the legacy teacherPreferences.curriculum default
 * `urlSeed` is the studio's already-computed URL default; `profileSeed` is
 * curriculumSeedFromProfile(userProfile). Pure — pass the read seed in.
 */
export function resolveStudioSeed({ urlSeed, activeSeed, profileSeed } = {}) {
  if (urlSeed && (urlSeed.grade || urlSeed.subject || urlSeed.topic)) return urlSeed
  if (activeSeed && (activeSeed.grade || activeSeed.subject)) return activeSeed
  return profileSeed || null
}
