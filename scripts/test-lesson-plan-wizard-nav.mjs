/**
 * Guards the Lesson Plan Studio wizard's bottom action bar (Save & exit /
 * Back / Next / Generate).
 *
 * The bug this pins shut: the bar was `position: fixed; inset-inline: 0`, so it
 * was positioned against the WINDOW rather than the wizard's column. It
 * therefore spanned the teacher sidebar too and sat on top of the profile /
 * logout row, and — because a fixed bar occupies no flow space — the form had
 * to reserve a matching `padding-bottom: 128px` by hand, which went stale
 * whenever the bar grew (validation hint, second row of buttons) and left the
 * last field underneath it on small screens.
 *
 * The fix is structural, so the checks are structural: the bar is sticky, it is
 * the last child of the wizard's own column, and no reserved-clearance padding
 * is doing load-bearing work. Text-level, in the spirit of
 * test-lesson-plan-routing.mjs — runtime behaviour is covered by the wizard's
 * Vitest specs.
 *
 * Run: node scripts/test-lesson-plan-wizard-nav.mjs  (npm run test:lesson-plan-wizard-nav)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/declaredRoutes.mjs'

let passed = 0
function ok(cond, msg) {
  assert.ok(cond, msg)
  passed++
}

const css = readFileSync(
  join(ROOT, 'src/shared/styles/lessonStudio.css'),
  'utf8',
)
const wizard = readFileSync(
  join(ROOT, 'src/features/lessonPlanStudio/components/wizard/LessonPlanWizard.jsx'),
  'utf8',
)

const CSS_NO_COMMENTS = css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Every declaration block written for EXACTLY this selector, comments stripped.
 * A selector is declared more than once here (the base rule, the
 * shrink-on-scroll transition, the responsive bleed) and the bug could come
 * back in any of them, so they are all checked together.
 *
 * The leaf-rule pattern — a body containing no further `{` — also reaches rules
 * nested inside `@media`, which is where two of the `.lpw-nav` blocks live.
 * Descendant selectors (`.lpw-nav .lps-btn-primary`) and modifiers
 * (`.lpw-nav--compact`) are deliberately NOT matched: they style the buttons,
 * not the bar's positioning.
 */
function blocksFor(selector) {
  const out = []
  for (const [, selectors, body] of CSS_NO_COMMENTS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = selectors.split(',').map((s) => s.trim())
    if (parts.includes(selector)) out.push(body)
  }
  return out
}

const navBlocks = blocksFor('.lpw-nav')
ok(navBlocks.length > 0, '.lpw-nav is declared in lessonStudio.css')

const navCss = navBlocks.join('\n')
ok(
  /position:\s*sticky/.test(navCss),
  'the wizard action bar is position:sticky (scoped to the wizard column)',
)
ok(
  !/position:\s*fixed/.test(navCss),
  'the wizard action bar is never position:fixed — a fixed bar spans the window and covers the sidebar logout row',
)
ok(
  !/inset-inline:\s*0/.test(navCss) && !/(^|\s)(left|right):\s*0/.test(navCss),
  'the action bar does not pin itself to the window edges (that is what reached across the sidebar)',
)

// The bar has to paint above the form it overlaps while stuck, and below the
// Progress overlay (a z-50 modal) that can open on top of it.
const zMatch = navCss.match(/z-index:\s*(\d+)/)
ok(zMatch, 'the action bar declares a z-index (it overlaps the form while stuck)')
ok(Number(zMatch[1]) < 50, 'the action bar sits below the z-50 Progress overlay')

// The old failure mode: a hand-reserved clearance on the scrolling body. A
// sticky bar takes real flow space, so nothing needs to guess its height.
const bodyCss = blocksFor('.lpw-body').join('\n')
ok(
  !/padding-bottom/.test(bodyCss),
  '.lpw-body reserves no hand-measured clearance for the bar (the bar is in the flow now)',
)

// ── The bar belongs to the wizard column, not the page root ─────────────────

ok(
  /className="lpw-body[^"]*"/.test(wizard) && !/className="lpw-body[^"]*max-w-/.test(wizard),
  '.lpw-body spans the content column (the reading-width cap moved to .lpw-steps)',
)
ok(
  /className="lpw-steps[^"]*max-w-3xl/.test(wizard),
  '.lpw-steps carries the form reading width',
)

const bodyOpen = wizard.indexOf('className="lpw-body')
const stepsClose = wizard.indexOf('<StickyWizardNav')
ok(bodyOpen !== -1 && stepsClose > bodyOpen, 'StickyWizardNav renders inside .lpw-body')
ok(
  wizard.indexOf('lpw-steps') < stepsClose,
  'the action bar renders AFTER the step content, so scrolling to the end clears the last field',
)

// One bar for all five steps. This is what makes "the bar behaves the same on
// steps 2–5" a property of the markup rather than something to re-check by
// hand at each breakpoint: there is no per-step branch that could give one
// step different positioning.
ok(
  wizard.split('<StickyWizardNav').length - 1 === 1,
  'StickyWizardNav is rendered exactly once, outside the per-step switch',
)
ok(
  stepsClose > wizard.lastIndexOf('currentStep === REVIEW_STEP'),
  'the action bar renders outside every `currentStep === …` branch',
)

// The bar bleeds out to the CONTENT COLUMN's edges by cancelling its two
// ancestor gutters. Every value must therefore be negative: a positive or
// `auto` margin here would push it past the column it is supposed to match —
// which is the fixed-bar bug arriving through a different door.
const bleeds = [...navCss.matchAll(/margin-inline:\s*([^;]+);/g)].map((m) => m[1].trim())
ok(bleeds.length >= 3, 'the bar declares its column bleed at each breakpoint (base / 640 / 1024)')
ok(
  bleeds.every((v) => /^-[\d.]+rem$/.test(v)),
  `every .lpw-nav margin-inline cancels a gutter (negative rem); got ${bleeds.join(', ')}`,
)

// ── The step number is stated twice, not three times ────────────────────────
// The stepper says it (dots) and the sticky bar says it ("Step n of 5 — …").
// The step HEADER used to say it a third time, in caps, directly between them.
ok(
  !/Step \{currentStep \+ 1\} of \{WIZARD_STEPS\.length\}/.test(wizard),
  'the step header does not restate the step number — the stepper and the sticky bar already do',
)

console.log(`lesson-plan wizard nav: ${passed} checks passed`)
