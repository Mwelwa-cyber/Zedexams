/**
 * The past-paper canary persists NOTHING — held by a test, not a premise.
 *
 * docs/phase3-plan.md §7.3: "any Firestore write at all from the past-paper
 * route" is an unconditional rollback trigger, and §7.2 calls a single written
 * document a P1. That rule is only cheap to enforce if the write cannot be
 * introduced quietly — so this guard fails the build when either side of the
 * canary grows a path to one:
 *
 *   1. `PublicQuizRunner.jsx` may not import ANY firebase module or the
 *      engine's `persist/`. Its reads go through `utils/` loaders; the day it
 *      needs a write is the day the canary stops being the canary, and that is
 *      a plan change, not a diff.
 *   2. The engine front door (`engines/assessment-engine/index.js`) may not
 *      re-export `persist/`, and nothing reachable from it may import
 *      firebase. The quiz cutover will export persist deliberately, for a
 *      route that writes; the canary imports the front door, so what the front
 *      door exports is what the canary can reach.
 *
 * Run: node scripts/test-paper-quiz-zero-write.mjs  (test:paper-quiz-zero-write)
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER = 'src/components/papers/PublicQuizRunner.jsx'
const FRONT_DOOR = 'src/engines/assessment-engine/index.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

const importsOf = (source) => [
  ...[...source.matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ...[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
]

/** Resolve a relative specifier from `fromFile` to a repo-relative path. */
function resolveRelative(fromFile, spec) {
  const base = path.join(ROOT, path.dirname(fromFile), spec)
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`,
    path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate, 'utf8') !== null) return path.relative(ROOT, candidate)
      } catch { /* a directory; keep probing */ }
    }
  }
  return null
}

/**
 * Every file reachable from `entry` through relative imports. A file in `skip`
 * is neither scanned nor walked THROUGH — it is a declared boundary, and its
 * subtree is covered by the boundary's stated reason.
 */
function reachableFrom(entry, skip = new Set()) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file) || skip.has(file)) continue
    seen.add(file)
    const source = readFileSync(path.join(ROOT, file), 'utf8')
    for (const spec of importsOf(source)) {
      if (!spec.startsWith('.')) continue
      const resolved = resolveRelative(file, spec.replace(/[?#].*$/, ''))
      if (resolved && /\.(m?js|jsx)$/.test(resolved)) queue.push(resolved)
    }
  }
  return seen
}

console.log('the past-paper canary writes nothing')

test('the runner imports no firebase module and no persist/', () => {
  const specs = importsOf(readFileSync(path.join(ROOT, RUNNER), 'utf8'))
  const offenders = specs.filter((s) => /(^|\/)firebase(\/|$)|assessment-engine\/persist/.test(s))
  assert.deepEqual(offenders, [],
    `the canary route must not reach a write path:\n    ${offenders.join('\n    ')}`)
})

test('the engine front door does not export persist/', () => {
  const source = readFileSync(path.join(ROOT, FRONT_DOOR), 'utf8')
  const persistExports = importsOf(source).filter((s) => /\/persist\//.test(s))
  assert.deepEqual(persistExports, [],
    'persist/ reaches the front door with the QUIZ cutover, which writes — not with the canary, which must not')
})

test('nothing reachable from the canary\'s engine imports touches firebase', () => {
  // The engine constraint (§14.2: engines sit below services) applied to the
  // graph the canary actually pulls in — BOTH doors it imports through: the
  // node-safe front door AND the render area (which is .jsx and therefore
  // deliberately not on the front door). RichContent and friends come along
  // via render/ — they render, they must not write.
  const reached = new Set([
    ...reachableFrom(FRONT_DOOR),
    ...reachableFrom('src/engines/assessment-engine/render/index.js'),
  ])
  assert.ok(reached.size > 10, `the walk found only ${reached.size} files — the resolver has gone blind, which must fail rather than pass by inspecting nothing`)
  const offenders = []
  for (const file of reached) {
    const specs = importsOf(readFileSync(path.join(ROOT, file), 'utf8'))
    for (const spec of specs) {
      if (/^firebase(\/|$)|^@firebase\/|src\/firebase\//.test(spec) || /(^|\.\.?\/)+firebase\/config/.test(spec)) {
        offenders.push(`${file} → ${spec}`)
      }
    }
  }
  assert.deepEqual(offenders, [],
    `the engine graph reached firebase:\n    ${offenders.join('\n    ')}`)
})

test('no Firestore WRITE API is importable anywhere in the route\'s own graph', () => {
  // Codex P2 on #2149 (r3733259619): the walk above covers the ENGINE graph,
  // and the runner check reads only its direct specifiers — so a write added
  // to an existing helper (pastPaperQuiz.js is the natural place) stayed
  // invisible to a guard advertised as enforcing zero writes. This walks the
  // runner's whole relative-import graph and refuses the write APIs by NAME,
  // because the loaders legitimately read.
  //
  // The allowlist names modules that carried writes BEFORE the canary, for
  // jobs that are not this route's: an entry here needs a reason, and a new
  // module cannot ride in on an old one's.
  // BOUNDARY modules: neither scanned nor walked through. AuthContext is the
  // app session — profile bootstrap, FCM tokens, referral redemption all live
  // behind it, on every route; none of that is the canary's write path. What
  // the boundary buys is that a NEW write cannot ride into the route through
  // any module that is not one of these two, and adding a third boundary is a
  // reviewed diff of this list, with a reason.
  const PREEXISTING_WRITERS = new Map([
    ['src/contexts/AuthContext.jsx', 'the app session (profile bootstrap, FCM, referrals); mounted on every route, not a canary path'],
    // pastPapers.js is deliberately NOT here any more: the route now imports
    // its one read from pastPaperLookup.js, which the walk covers in full —
    // a write inside the loader the route actually calls fails this test
    // (Codex P2 on #2151, r3733319248).
  ])
  const WRITE_APIS = /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/
  const offenders = []
  for (const file of reachableFrom(RUNNER, new Set(PREEXISTING_WRITERS.keys()))) {
    const source = readFileSync(path.join(ROOT, file), 'utf8')
    for (const m of source.matchAll(/import\s+([^'"]+?)\s+from\s+['"][^'"]*firestore[^'"]*['"]/g)) {
      const hit = m[1].match(WRITE_APIS)
      if (hit) offenders.push(`${file} imports ${hit[1]}`)
    }
  }
  assert.deepEqual(offenders, [],
    `a Firestore write API is importable from the past-paper route — §7.3 calls one write a P1:\n    ${offenders.join('\n    ')}`)
  // The allowlist must describe reality: an entry for a module that no longer
  // carries a write (or is no longer reached) is stale cover for a future one.
  for (const [file, reason] of PREEXISTING_WRITERS) {
    assert.ok(reason.length > 10, `${file} needs a real reason`)
    assert.match(readFileSync(path.join(ROOT, file), 'utf8'), WRITE_APIS,
      `${file} is allowlisted but carries no write API — remove the stale entry`)
  }
})

test('the §7.2 observability event is wired, with the fields the dashboard reads', () => {
  // Observability must be emitting BEFORE the flip (§5.1(8)). The event name
  // and fields are pinned here so a rename cannot silently orphan the PostHog
  // query watching the ramp.
  const source = readFileSync(path.join(ROOT, RUNNER), 'utf8')
  assert.match(source, /capture\('assessment_engine_path'/, 'the runner emits assessment_engine_path')
  for (const field of ['runner:', 'engine:', 'flagSource:']) {
    assert.match(source, new RegExp(field), `the event carries ${field.replace(':', '')}`)
  }
})

console.log(`\npaper-quiz zero-write: ${passed} passed`)
