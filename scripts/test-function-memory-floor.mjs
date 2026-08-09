#!/usr/bin/env node
/**
 * No Cloud Function may be provisioned below the cost of STARTING UP.
 *
 * ## The failure this exists to prevent
 *
 * Cloud Functions v2 loads the whole shared `functions/index.js` into every
 * instance — every export in the codebase deploys from one source, so a beacon that touches
 * three modules still pays for the Anthropic client, the OpenAI client, docx,
 * Gemini, every teacherTool and every agent. Measured on Node 22:
 *
 *     bare node                    43 MiB RSS
 *     + require('functions/index') 148 MiB RSS      (2.7s)
 *
 * `apiTrackVisit` declared `memory: "128MiB"`. It was the ONLY declaration in
 * the codebase below 256MiB, and therefore the only function whose instance
 * exceeded its own limit before serving a request. It produced 80 ERRORs in a
 * 2h window — 100% of the server-side error volume in that period — while
 * every other function was fine.
 *
 * Nothing caught it. The Phase 5 frozen-surface manifest cannot see this
 * function's options (it is a `require('./x').y` delegation, which the
 * extractor classifies as factory-built and records as `optionsUnresolved`),
 * so the one function with a fatal memory setting sat squarely inside that
 * guard's known blind spot.
 *
 * ## What this checks, and what it deliberately does not
 *
 * It checks the floor only. It has no opinion on whether a function that asks
 * for 1GiB needs 1GiB — over-provisioning costs money, not availability, and
 * is a different review. Under-provisioning below the startup cost is not a
 * tuning question: the instance cannot run at all.
 *
 * The floor is written down rather than measured at test time, because
 * measuring means requiring index.js on every CI run (2.7s, and a number that
 * drifts with the runner). The measurement that justifies it is recorded above
 * and in `functions/visitorTracking.js`; re-run it if the floor is ever
 * questioned:
 *
 *     node -e "const m=()=>Math.round(process.memoryUsage().rss/1024/1024);
 *              require('./functions/index.js'); console.log(m(),'MiB')"
 *
 * Static check — plain `node`, no emulator, runs inside `test:all`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS_DIR = join(ROOT, 'functions')

/**
 * The floor, in MiB. 256 is both the Cloud Functions default and the value
 * every other function in this codebase already declares — so this ratchets in
 * what is already true rather than imposing a new policy.
 *
 * Raise it only with a fresh measurement. Lowering it means index.js got
 * dramatically cheaper to load, which is a Phase 5 outcome worth proving.
 */
const FLOOR_MIB = 256

/** Measured cost of requiring functions/index.js. Recorded, not asserted. */
const MEASURED_INDEX_LOAD_MIB = 148

const UNIT_MIB = { MiB: 1, GiB: 1024 }

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith('.js')) yield full
  }
}

const violations = []
const declarations = []

for (const file of walk(FUNCTIONS_DIR)) {
  const rel = relative(ROOT, file)
  // A test file may legitimately reference a small value in a fixture.
  if (/\.test\.js$/.test(rel)) continue
  const src = readFileSync(file, 'utf8')
  const re = /memory:\s*"(\d+)(MiB|GiB)"/g
  let m
  while ((m = re.exec(src)) !== null) {
    const mib = Number(m[1]) * UNIT_MIB[m[2]]
    const line = src.slice(0, m.index).split('\n').length
    declarations.push({ rel, line, mib, raw: `${m[1]}${m[2]}` })
    if (mib < FLOOR_MIB) violations.push({ rel, line, mib, raw: `${m[1]}${m[2]}` })
  }
}

// A guard that finds nothing to check is not passing — it is broken. If the
// declaration scan comes back empty the pattern has drifted (renamed option,
// reformatted source) and every real violation would slip through silently.
if (declarations.length === 0) {
  console.error('✗ found NO memory declarations under functions/ — the scan is broken, not clean')
  process.exit(1)
}

if (violations.length > 0) {
  console.error('\n✗ function(s) provisioned BELOW the startup cost:\n')
  for (const v of violations) {
    console.error(`  • ${v.rel}:${v.line} declares ${v.raw} (< ${FLOOR_MIB}MiB floor)`)
  }
  console.error(
    `\n  Every Cloud Functions v2 instance loads the whole of functions/index.js,` +
    `\n  which costs ~${MEASURED_INDEX_LOAD_MIB} MiB RSS before a single request. A function below the` +
    `\n  ${FLOOR_MIB}MiB floor exceeds its limit at startup and returns 500s under any load.` +
    `\n  This is what took apiTrackVisit down (80 errors in 2h).\n`,
  )
  process.exit(1)
}

const lowest = declarations.reduce((a, b) => (b.mib < a.mib ? b : a))
console.log(
  `function memory floor: ${declarations.length} declarations, ` +
  `lowest ${lowest.raw} (${lowest.rel}:${lowest.line}), floor ${FLOOR_MIB}MiB — ok`,
)
