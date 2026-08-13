/**
 * Which files can change what a printed paper looks like.
 *
 * ## Why this is a module and not a `paths:` filter
 *
 * It WAS a `paths:` filter, and that made the visual gate impossible to require.
 * A path-filtered workflow does not run on a pull request that touches nothing
 * on the list — and a check that never runs is not "passed", it is *missing*, so
 * branch protection holds the PR open forever waiting for a result that will
 * never arrive. The two properties are in direct conflict: a required check must
 * report on every pull request, and rendering eight papers through Chromium and
 * LibreOffice on every pull request is not something to do for a typo in a
 * README.
 *
 * Moving the classification INSIDE the workflow resolves it. The workflow starts
 * on every pull request, decides here whether printed output can be affected,
 * and reports one check either way — a full comparison, or "printed output not
 * affected". The expensive part still only runs when it can matter.
 *
 * ## This list is an optimisation, and it is not a guarantee
 *
 * An indirect dependency can always be missed. That is why `force` exists on the
 * manual dispatch, and why the list errs wide: a false positive costs eight
 * minutes of CI, a false negative ships a changed paper with a green gate.
 *
 * ## The list watches itself
 *
 * This file, the workflows and the baselines are on the list on purpose. Without
 * that, a pull request could weaken the gate — widen a tolerance, drop a
 * fixture, remove a path — WITHOUT running the gate that proves it is still
 * safe. Editing the gate must exercise the gate.
 */

/**
 * Glob-ish patterns, in the same dialect GitHub's `paths:` filter uses:
 * `**` crosses directory boundaries, `*` does not.
 */
export const PRINT_AFFECTING_PATHS = Object.freeze([
  // ── The renderers themselves ──────────────────────────────────────────
  'src/utils/assessmentToDocx.js',
  'src/utils/assessmentToPdf.js',
  'src/utils/assessmentPaperLayout.js',
  'src/utils/assessmentAnswerSheet.js',
  'src/engines/export-engine/sbaTaskToDocx.js',
  'src/engines/export-engine/sbaTaskToPdf.js',
  'src/utils/htmlToPdf.js',
  'src/components/teacher/views/PaperBlocks.jsx',
  'src/components/teacher/views/AssessmentPaperView.jsx',
  // ── Paper content, maths typesetting and print styling ────────────────
  'src/utils/paperContentModel.js',
  'src/utils/latexToUnicode.js',
  'src/utils/quizRichText.js',
  'src/editor/utils/safeRender.js',
  'src/editor/extensions/MathFraction.js',
  'src/editor/extensions/NumberBase.js',
  'src/editor/extensions/VerticalArithmetic.js',
  'src/components/teacher/studio/assessmentStudio.css',
  'src/**/*print*.css',
  // ── Diagrams, figures and the ink they use ────────────────────────────
  'src/components/diagrams/**',
  'functions/shared/assessment/diagramCatalogCore.js',
  'src/utils/figureSizing.js',
  'src/utils/figureLabelLayout.js',
  'src/utils/figureContrast.js',
  'src/utils/monochrome.js',
  'src/utils/imageWidth.js',
  'src/utils/svgRasterizer.js',
  // ── Page geometry and the measurement that reads it ───────────────────
  'src/config/paperPageGeometry.js',
  'src/utils/paperPaginationCore.js',
  'src/features/assessmentStudio/lib/paperPaginationMeasure.js',
  // ── Terminology that changes printed wording ──────────────────────────
  'src/config/paperTerminology.js',
  // Lives under components/, not config/ — the `paths:` filter this replaced
  // named src/config/paperTaxonomy.js, a file that does not exist, so the
  // assessment-type taxonomy has never been on the list. Found by the test that
  // checks every non-glob entry resolves: a pattern for a moved file protects
  // nothing and reads exactly like one that works.
  'src/components/teacher/paperTaxonomy.js',
  'src/config/assessmentBands.js',
  'src/config/educationLevels.js',
  // ── Fonts and print assets ───────────────────────────────────────────
  'public/fonts/**',
  'src/assets/print/**',
  // ── The gate itself: fixtures, comparison modules, baselines, workflow ─
  'scripts/visual/**',
  'tests/visual/baselines/**',
  '.github/workflows/visual-regression.yml',
  '.github/workflows/visual-baseline-update.yml',
  '.github/workflows/visual-baseline-bootstrap.yml',
  // ── Dependency changes can move a renderer under us ──────────────────
  'package-lock.json',
])

/**
 * Compile one pattern to a regular expression.
 *
 * `**` matches across `/`, `*` does not — the same distinction GitHub's filter
 * makes, so moving the list out of the YAML did not quietly change which files
 * it selects.
 */
export function patternToRegExp(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` may match nothing at all, so `a/**/b` also matches `a/b`.
        if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2 } else { out += '.*'; i += 1 }
      } else {
        out += '[^/]*'
      }
      continue
    }
    out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

const COMPILED = PRINT_AFFECTING_PATHS.map((p) => [p, patternToRegExp(p)])

/** Does this one file sit on the list? */
export function isPrintAffecting(file) {
  const path = String(file || '').trim()
  if (!path) return false
  return COMPILED.some(([, re]) => re.test(path))
}

/**
 * Classify a whole changed-file set.
 *
 * Returns the MATCHED files as well as the verdict, because a run that decides
 * to spend eight minutes rendering should be able to say which file made it, and
 * a run that decides not to should be able to prove it looked.
 *
 * An EMPTY changed-file set returns `requiresVisual: true`. An empty list is
 * more likely to mean the diff could not be derived than to mean a pull request
 * that changes nothing, and the safe reading of "I could not tell" is to render.
 */
export function classifyPrintScope(changedFiles = []) {
  const files = (Array.isArray(changedFiles) ? changedFiles : [])
    .map((f) => String(f || '').trim()).filter(Boolean)

  if (files.length === 0) {
    return {
      requiresVisual: true,
      reason: 'no-changed-files',
      summary: 'Could not determine which files changed, so the full suite runs.',
      matched: [],
    }
  }

  const matched = files.filter(isPrintAffecting)
  if (matched.length === 0) {
    return {
      requiresVisual: false,
      reason: 'unaffected',
      summary: files.length === 1
        ? 'Printed output not affected — the one changed file cannot reach a rendered paper.'
        : `Printed output not affected — none of the ${files.length} changed files can reach a rendered paper.`,
      matched: [],
    }
  }
  return {
    requiresVisual: true,
    reason: 'print-affecting',
    summary: `${matched.length} changed file${matched.length === 1 ? '' : 's'} can affect printed output `
      + `(e.g. ${matched.slice(0, 3).join(', ')}${matched.length > 3 ? ', …' : ''}).`,
    matched,
  }
}
