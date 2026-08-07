/**
 * Can this change alter what a learner SEES on screen?
 *
 * The screen family's twin of `printAffectingPaths.js`, and separate from it on
 * purpose: the two answer different questions about different renderers, and a
 * single list would render papers whenever a learner button moved and screens
 * whenever a page margin changed. Eight minutes of CI each way, on every
 * unrelated pull request.
 *
 * ## It errs WIDE, and that is the trade
 *
 * A false positive costs a render. A false negative ships a changed screen
 * behind a green gate — which is the failure the gate exists to prevent, and
 * which nobody finds until a learner does. So anything plausibly upstream of a
 * rendered question is listed, and the reuse of the shipping quiz classes makes
 * that list larger than the engine: `.zx-opt`, `.opt-grid` and `.question-text`
 * live in `src/index.css`, so a change there can restyle every option row.
 *
 * ## It is an optimisation, never a guarantee
 *
 * An indirect dependency can always be missed — the same caveat the print
 * classifier carries, and the reason `force` exists on the manual dispatch.
 * What it must never do is claim MORE certainty than it has: an empty
 * changed-file set means the diff could not be derived, and that reads as
 * "render", not as "nothing changed".
 */

/**
 * Every path whose change can reach a rendered question on screen.
 *
 * `**` matches across `/`; `*` does not — the same distinction the print list
 * makes, and `patternToRegExp` is imported from there so there is one compiler
 * rather than two that agree today.
 */
export const SCREEN_AFFECTING_PATHS = Object.freeze([
  // ── The engine's renderers: the subject ───────────────────────────────
  'src/engines/assessment-engine/render/**',
  // The model they draw. A normaliser that drops an option changes the screen
  // as surely as a component that fails to draw it.
  'src/engines/assessment-engine/normalise/**',
  'src/engines/assessment-engine/schemas/**',
  // ── Rich content and school notation ──────────────────────────────────
  'src/editor/RichContent.jsx',
  'src/editor/richPlainText.js',
  'src/editor/utils/safeRender.js',
  'src/editor/utils/sanitize.js',
  'src/editor/mathNotation.css',
  'src/editor/extensions/MathFraction.js',
  'src/editor/extensions/NumberBase.js',
  'src/editor/extensions/VerticalArithmetic.js',
  'src/editor/extensions/buildExtensions.js',
  // ── The shipping classes the renderers deliberately reuse ─────────────
  // `.zx-opt`, `.opt-grid`, `.zx-opt-letter`, `.question-text` and every
  // reading preference hang off this file. Reusing them is what keeps the
  // engine and the old runner visually indistinguishable; it also means this
  // stylesheet is upstream of every screen fixture.
  'src/index.css',
  'tailwind.config.js',
  'postcss.config.js',
  // ── The letters themselves ────────────────────────────────────────────
  'functions/shared/assessment/answerChoicesCore.js',
  'functions/shared/assessment/questionTypeCore.js',
  'functions/shared/assessment/richTextContentCore.js',
  // ── The gate itself: fixtures, stage, baselines, workflows ────────────
  'scripts/visual/screen/**',
  'scripts/visual/renderEnvironment.js',
  'scripts/visual/compareRender.js',
  'scripts/visual/renderGuards.js',
  'scripts/visual/pdfPages.js',
  'scripts/visual/gateVerdict.js',
  'tests/visual/baselines/screen/**',
  '.github/workflows/visual-regression.yml',
  '.github/workflows/visual-baseline-update.yml',
  '.github/workflows/visual-baseline-bootstrap.yml',
  // ── A dependency bump can move React, KaTeX or the bundler under us ───
  'package-lock.json',
])

// One compiler, imported rather than reimplemented. Two globbers that agree
// today are two globbers that can disagree tomorrow, and the disagreement
// would be a silently unrendered pull request.
import { patternToRegExp } from '../printAffectingPaths.js'

const COMPILED = SCREEN_AFFECTING_PATHS.map((p) => [p, patternToRegExp(p)])

/** Does this one file's change reach a rendered question on screen? */
export function isScreenAffecting(file) {
  const path = String(file || '').trim()
  if (!path) return false
  return COMPILED.some(([, re]) => re.test(path))
}

/**
 * Classify a whole changed-file set.
 *
 * Returns the MATCHED files as well as the verdict: a run that spends minutes
 * rendering should be able to say which file made it, and a run that declines
 * should be able to prove it looked.
 *
 * An EMPTY set returns `requiresScreen: true` — an empty list is far more
 * likely to mean the diff could not be derived than to mean a pull request that
 * changes nothing, and the safe reading of "I could not tell" is to render.
 */
export function classifyScreenScope(changedFiles = []) {
  const files = (Array.isArray(changedFiles) ? changedFiles : [])
    .map((f) => String(f || '').trim()).filter(Boolean)

  if (files.length === 0) {
    return {
      requiresScreen: true,
      reason: 'no-changed-files',
      summary: 'Could not determine which files changed, so the screen suite runs.',
      matched: [],
    }
  }

  const matched = files.filter(isScreenAffecting)
  if (matched.length === 0) {
    return {
      requiresScreen: false,
      reason: 'unaffected',
      summary: files.length === 1
        ? 'Learner screen not affected — the one changed file cannot reach a rendered question.'
        : `Learner screen not affected — none of the ${files.length} changed files can reach a rendered question.`,
      matched: [],
    }
  }
  return {
    requiresScreen: true,
    reason: 'screen-affecting',
    summary: `${matched.length} changed file${matched.length === 1 ? '' : 's'} can affect the learner screen `
      + `(e.g. ${matched.slice(0, 3).join(', ')}${matched.length > 3 ? ', …' : ''}).`,
    matched,
  }
}
