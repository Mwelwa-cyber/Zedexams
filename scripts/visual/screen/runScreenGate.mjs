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
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { comparePages } from '../compareRender.js'
import {
  baselineIdentity, captureRenderEnvironment, assertToolchain, assertComparableEnvironment,
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

const environment = captureRenderEnvironment()
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
const missing = captures.filter((c) => !existsSync(baselinePath(c.target)))
if (missing.length) {
  console.error(`\n${missing.length} screen baseline${missing.length === 1 ? '' : 's'} do not exist yet:`)
  for (const c of missing) console.error(`  ${identity}/${c.target}`)
  console.error('\nA comparison run never creates a baseline — it cannot approve its own first render.')
  console.error('Dispatch the "Visual baseline bootstrap" workflow from main with family=screen.')
  process.exit(1)
}

assertComparableEnvironment(JSON.parse(readFileSync(envPath, 'utf8')).environment, environment)

let differing = 0
for (const c of captures) {
  const result = comparePages(readFileSync(baselinePath(c.target)), c.png)
  if (result.identical) { console.log(`  ok  ${c.target}`); continue }
  differing += 1
  console.error(`  ✗   ${c.target}: ${result.summary ?? 'differs from its baseline'}`)
}

if (differing) {
  console.error(`\n${differing} screen capture${differing === 1 ? '' : 's'} differ from their baselines.`)
  console.error('The rendered pages are in tests/visual/output/screen for inspection.')
  process.exit(1)
}
console.log(`\nall ${captures.length} screen captures match their baselines (${identity})`)
