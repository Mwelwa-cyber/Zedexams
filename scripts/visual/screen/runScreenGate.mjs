#!/usr/bin/env node
/**
 * The screen family's runner — compare against baselines, or record them.
 *
 * Same two modes and the same refusals as `runVisualGate.mjs`, deliberately:
 *
 *   --mode=compare                 (default) compare, never write
 *   --mode=update --bootstrap-missing --reason=… --source=…   record MISSING only
 *
 * ## It cannot approve its own first render
 *
 * A comparison run NEVER creates a baseline. A missing baseline is a failure,
 * reported as one, and the only way to file one is the update mode that the
 * CI-only writer workflows invoke with a written reason. That is why the gate
 * reports red until the bootstrap has run — correct, not broken.
 *
 * ## Baselines are keyed to the environment that drew them
 *
 * `tests/visual/baselines/screen/<chromium-version>/<fixture>/<viewport>.png`,
 * with the captured environment beside them. `assertComparableEnvironment`
 * refuses a comparison across a different Chromium, OS, font set or flag list —
 * so a locally recorded baseline is dead weight CI will never match, which is
 * what makes "CI-recorded or not at all" a mechanism rather than a policy.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { PNG } from 'pngjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { comparePages } from '../compareRender.js'
import {
  baselineIdentity, captureRenderEnvironment, assertToolchain, assertComparableEnvironment,
  resolveRenderChromium,
} from '../renderEnvironment.js'
import { renderScreenFixtures } from './screenStage.mjs'
import { SCREEN_FIXTURES, SCREEN_VIEWPORTS } from './screenFixtures.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const BASELINES = path.join(ROOT, 'tests/visual/baselines/screen')
const OUTPUT = path.join(ROOT, 'tests/visual/output/screen')

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const mode = arg('mode', 'compare')
const bootstrapMissing = flag('bootstrap-missing')
const onlyFixture = arg('fixture')

// Chromium must be RESOLVED before the environment is captured. Puppeteer's
// browser is not on PATH, so `captureRenderEnvironment()` alone records an
// empty `chromium` and `assertToolchain` then reports "Chromium not available"
// on a runner that has it — which is exactly what this did on its first CI run,
// one step after `reportEnvironment.mjs` reported the browser present. That
// script resolves first; so does this one now.
const chromiumPath = await resolveRenderChromium()
const environment = captureRenderEnvironment({ chromiumPath })
assertToolchain(['screen'], environment)
const identity = baselineIdentity('screen', environment)
const dir = path.join(BASELINES, identity.replace('screen/', ''))

const fixtures = onlyFixture ? SCREEN_FIXTURES.filter((f) => f.id === onlyFixture) : SCREEN_FIXTURES
if (onlyFixture && fixtures.length === 0) {
  console.error(`no screen fixture "${onlyFixture}"`)
  process.exit(1)
}

const baselinePath = (target) => path.join(dir, `${target}.png`)
const envPath = path.join(dir, 'environment.json')

const captures = await renderScreenFixtures({ fixtures, viewports: SCREEN_VIEWPORTS })

mkdirSync(OUTPUT, { recursive: true })
for (const c of captures) {
  const out = path.join(OUTPUT, `${c.target}.png`)
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, c.png)
}

if (mode === 'update') {
  if (!bootstrapMissing) {
    console.error('refusing to write: --mode=update needs --bootstrap-missing (replacing an approved baseline is the update workflow\'s job)')
    process.exit(1)
  }
  const reason = arg('reason')
  const source = arg('source')
  if (!reason || !source) {
    console.error('refusing to write without --reason and --source: a baseline recorded with no stated reason is indistinguishable from a regression nobody noticed')
    process.exit(1)
  }
  let wrote = 0
  for (const c of captures) {
    const file = baselinePath(c.target)
    // Bootstrap records only what is MISSING. Replacing an approved appearance
    // is a different act with a different workflow, and the refusal lives here
    // rather than in the YAML so it cannot be edited away in a dispatch.
    if (existsSync(file)) { console.log(`kept   ${c.target} (already recorded)`); continue }
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, c.png)
    wrote += 1
    console.log(`record ${c.target}`)
  }
  writeFileSync(envPath, `${JSON.stringify({ environment, reason, source }, null, 2)}\n`)
  console.log(`\n${wrote} baseline${wrote === 1 ? '' : 's'} recorded under ${identity}`)
  process.exit(0)
}

// ── compare ──────────────────────────────────────────────────────────────────
//
// Three states, and they are three different claims. Collapsing them is how a
// gate ends up saying something untrue about what it checked.
//
//   • EVERY baseline missing  → the family is UNARMED. Nothing has been
//     approved, so nothing can differ from it. Reporting "does not match the
//     recorded baselines" here is false — there are none — and failing on it
//     blocks the very pull request that introduces the gate. Green, and loud.
//   • SOME missing            → FAIL. A fixture added after the bootstrap has
//     no approved appearance, and quietly skipping it would let a new fixture
//     ride in unwatched behind a green gate. Its baseline must be recorded
//     deliberately, through the reviewed workflow.
//   • NONE missing            → compare, and fail on any difference.
//
// The unarmed window is real and worth naming: between this merging and the
// bootstrap running, the screen family is green and watching nothing. It is
// bounded by one dispatch, the state is shouted on every run, and the moment a
// single baseline exists the middle rule takes over.
const missing = captures.filter((c) => !existsSync(baselinePath(c.target)))

if (missing.length === captures.length) {
  console.warn('')
  console.warn('  ╔════════════════════════════════════════════════════════════════════╗')
  console.warn('  ║  SCREEN GATE UNARMED: 0 baselines recorded — comparisons skipped.  ║')
  console.warn('  ║  Dispatch the baseline bootstrap to arm.                           ║')
  console.warn('  ╚════════════════════════════════════════════════════════════════════╝')
  console.warn('')
  console.warn(`  ${captures.length} captures rendered and every declared page check passed, so the`)
  console.warn('  renderers are working — but NOTHING was compared, because no appearance')
  console.warn('  has been approved yet. This is not a pass for the pixels.')
  console.warn('')
  console.warn('  Arm it:  Actions → "Visual baseline bootstrap" → Run workflow')
  console.warn('           from main, with family=screen')
  console.warn(`\n  The rendered pages are in tests/visual/output/screen (${identity}).`)
  process.exit(0)
}

if (missing.length) {
  // Partial: some appearances are approved and some are not. Never green — a
  // fixture with no baseline is a fixture nobody has looked at.
  console.error(`\n${missing.length} of ${captures.length} screen captures have NO BASELINE RECORDED:`)
  for (const c of missing) console.error(`  ${identity}/${c.target}`)
  console.error('\nThis is not a difference — these appearances have never been approved.')
  console.error('A comparison run never creates a baseline; it cannot approve its own first render.')
  console.error('Dispatch the "Visual baseline bootstrap" workflow from main with family=screen.')
  process.exit(1)
}

assertComparableEnvironment(JSON.parse(readFileSync(envPath, 'utf8')).environment, environment)

// `comparePages` takes DECODED pages — `{width, height, data}` — and reports
// `changed`, not `identical`. Handing it raw bytes makes every comparison
// report "a page could not be read", and reading a non-existent `identical`
// makes that read as a difference: a gate that fails 100% of the time the
// moment it is armed, with a message that names the wrong cause. Caught by a
// control that recorded baselines and immediately re-compared against them.
const decode = (bytes) => PNG.sync.read(Buffer.from(bytes))

let differing = 0
for (const c of captures) {
  const result = comparePages(decode(readFileSync(baselinePath(c.target))), decode(c.png))
  if (!result.changed) { console.log(`  ok  ${c.target}`); continue }
  differing += 1
  console.error(`  ✗   ${c.target}: ${(result.reasons ?? []).join('; ') || 'differs from its baseline'}`)
}

if (differing) {
  console.error(`\n${differing} screen capture${differing === 1 ? ' DIFFERS' : 's DIFFER'} from the recorded baselines.`)
  console.error('The rendered pages are in tests/visual/output/screen for inspection.')
  process.exit(1)
}
console.log(`\nall ${captures.length} screen captures match their baselines (${identity})`)
