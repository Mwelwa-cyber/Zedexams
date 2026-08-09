#!/usr/bin/env node
/**
 * No Cloud Function may be provisioned below the cost of STARTING UP.
 *
 * ## The failure this exists to prevent
 *
 * Cloud Functions v2 loads the whole shared `functions/index.js` into every
 * instance — all 202 exports deploy from one source, so a beacon that touches
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

/**
 * Both SDK vocabularies, because this codebase deploys both generations.
 *
 *   v2 (`onRequest`/`onCall`/`onDocument*`): "128MiB" … "32GiB"
 *   v1 (`functions.runWith({...})`):         "128MB"  … "8GB"
 *
 * `functions/storageCleanup/onUserDeleted.js` is a v1 auth trigger declaring
 * `memory: "256MB"`. The first version of this guard understood only MiB/GiB,
 * so that declaration matched nothing and was silently skipped — a whole SDK
 * generation invisible to a guard whose entire purpose is that a memory
 * setting must not be invisible.
 *
 * MB is treated as MiB rather than as decimal megabytes. Cloud Functions'
 * "256MB" label allocates the same 256Mi container as v2's "256MiB"; reading it
 * as decimal (244 MiB) would fail a function that is in fact exactly at the
 * floor.
 */
const UNIT_MIB = { MiB: 1, GiB: 1024, MB: 1, GB: 1024 }

/**
 * Every `memory:` setting in a source, each marked resolved or NOT.
 *
 * Covers both declaration shapes, which is the point: DIRECT (declared in the
 * builder call, `onRequest({memory: "256MiB"}, h)`) and DELEGATED (declared in
 * a module and re-exported through index.js, which is the shape that actually
 * broke). Both are reached by scanning every file under `functions/` rather
 * than index.js alone.
 *
 * The right-hand side is captured up to the next `,` or `}` so a value that is
 * NOT a literal (`memory: SOME_CONSTANT`) is seen and reported rather than
 * failing to match. Skipping it silently would reproduce the original bug in a
 * new costume: an unreadable setting reported as no setting.
 */
export function scanMemoryDeclarations(source) {
  const out = []
  const re = /memory:\s*([^,}\n]+)/g
  let m
  while ((m = re.exec(source)) !== null) {
    const rawValue = m[1].trim()
    const line = source.slice(0, m.index).split('\n').length
    const literal = /^(['"`])(\d+)(MiB|GiB|MB|GB)\1$/.exec(rawValue)
    if (literal) {
      out.push({
        line,
        mib: Number(literal[2]) * UNIT_MIB[literal[3]],
        raw: `${literal[2]}${literal[3]}`,
        resolved: true,
      })
    } else {
      out.push({ line, mib: null, raw: rawValue, resolved: false })
    }
  }
  return out
}

// ── Self-check: prove the scanner sees every shape before trusting it ────────
// A guard whose coverage is asserted in a comment is a guard whose coverage is
// unknown. If the scanner stops understanding a shape this fails loudly, rather
// than the scan quietly returning fewer results and reporting "ok".
const SELF_CHECKS = [
  ['v2 direct, double quotes', 'onRequest({region: "us-central1", memory: "128MiB"}, h)', { mib: 128, resolved: true }],
  ['v2 direct, single quotes', "onRequest({ memory: '128MiB' }, h)", { mib: 128, resolved: true }],
  ['v2 direct, backticks', 'onRequest({ memory: `512MiB` }, h)', { mib: 512, resolved: true }],
  ['v2 GiB converts', 'onCall({memory: "1GiB"}, h)', { mib: 1024, resolved: true }],
  ['v1 runWith, MB vocabulary', 'functions.runWith({timeoutSeconds: 300, memory: "256MB"})', { mib: 256, resolved: true }],
  ['v1 GB converts', 'functions.runWith({memory: "1GB"})', { mib: 1024, resolved: true }],
  ['v1 below the floor is caught', 'functions.runWith({memory: "128MB"})', { mib: 128, resolved: true }],
  ['DELEGATED — declared in a module, re-exported from index.js', [
    'exports.apiTrackVisit = onRequest(',
    '    {region: "us-central1", timeoutSeconds: 15, memory: "128MiB"},',
    '    (req, res) => handleVisit(req, res),',
    ');',
  ].join('\n'), { mib: 128, resolved: true }],
  ['multiline options object', 'onRequest({\n  region: "us-central1",\n  memory: "128MiB",\n}, h)', { mib: 128, resolved: true }],
  ['non-literal is UNRESOLVED, never skipped', 'onRequest({memory: MEM_SETTING}, h)', { mib: null, resolved: false }],
]

for (const [name, src, expected] of SELF_CHECKS) {
  const [found] = scanMemoryDeclarations(src)
  if (!found) {
    console.error(`✗ self-check "${name}": scanner found NO declaration in a source that has one`)
    process.exit(1)
  }
  if (found.mib !== expected.mib || found.resolved !== expected.resolved) {
    console.error(
      `✗ self-check "${name}": expected mib=${expected.mib} resolved=${expected.resolved}, ` +
      `got mib=${found.mib} resolved=${found.resolved} (raw ${found.raw})`,
    )
    process.exit(1)
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith('.js')) yield full
  }
}

const violations = []
const unresolved = []
const declarations = []

for (const file of walk(FUNCTIONS_DIR)) {
  const rel = relative(ROOT, file)
  // A test file may legitimately reference a small value in a fixture.
  if (/\.test\.js$/.test(rel)) continue
  for (const d of scanMemoryDeclarations(readFileSync(file, 'utf8'))) {
    declarations.push({ rel, ...d })
    if (!d.resolved) unresolved.push({ rel, ...d })
    else if (d.mib < FLOOR_MIB) violations.push({ rel, ...d })
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

if (unresolved.length > 0) {
  console.error('\n✗ memory setting(s) this guard cannot resolve:\n')
  for (const v of unresolved) {
    console.error(`  • ${v.rel}:${v.line} → memory: ${v.raw}`)
  }
  console.error(
    '\n  An unreadable setting is not a safe setting. Inline the literal so the' +
    '\n  floor can be checked — a value only resolvable at runtime is exactly as' +
    '\n  invisible as the one that took apiTrackVisit down.\n',
  )
  process.exit(1)
}

const lowest = declarations.reduce((a, b) => (b.mib < a.mib ? b : a))
console.log(
  `function memory floor: ${declarations.length} declarations (all resolved), ` +
  `lowest ${lowest.raw} (${lowest.rel}:${lowest.line}), floor ${FLOOR_MIB}MiB — ok`,
)
