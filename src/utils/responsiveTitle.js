/**
 * The mechanism behind a title that shortens by DROPPING WHOLE FACTS rather
 * than by cutting characters.
 *
 * Two places in the app need it and they arrived at it independently: the
 * assessment studio's document title (`src/components/teacher/paperNaming.js`,
 * where a phone cut "GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026"
 * down to "…INTEGRATED SCIEN…") and the past-paper archive's card rows (where
 * the same ellipsis threw away the fact that says whether a paper is a real
 * ECZ exam or a commercial mock).
 *
 * What is genuinely SHARED is only what is here: the separators, and the rule
 * that turns an available width into a tier. What must NOT be shared is the
 * priority order — an assessment paper is told apart by its type and term, a
 * past paper by its source and year — so each caller declares its own ordering
 * and its own thresholds and composes with these primitives.
 *
 * Pure: no React, no DOM, no measurement. Measuring is `useElementWidth`'s job
 * (`src/hooks/useElementWidth.js`); deciding what a measurement MEANS is here,
 * so it can be tested by passing a number.
 */

/** Join facts with the dot separator, dropping empties rather than printing gaps. */
export function joinDot(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

/** Join two halves with an em dash; either half alone is returned unchanged. */
export function joinDash(left, right) {
  const a = String(left ?? '').trim()
  const b = String(right ?? '').trim()
  if (a && b) return `${a} — ${b}`
  return a || b
}

/**
 * Which tier an available width falls into: 'wide' | 'medium' | 'narrow'.
 *
 * A non-finite width reads as 'wide', not as 'narrow'. Before the first
 * measurement lands there is no evidence the space is tight, and guessing
 * narrow makes every title flash through its shortest form on first paint.
 */
export function pickWidthTier(width, { wide, medium }) {
  const w = Number(width)
  if (!Number.isFinite(w)) return 'wide'
  if (w >= wide) return 'wide'
  if (w >= medium) return 'medium'
  return 'narrow'
}
