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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
  for (const field of ['runner:', 'engine:', 'flagSource:', 'build:']) {
    assert.match(source, new RegExp(field), `the event carries ${field.replace(':', '')}`)
  }
})

/**
 * The STEPS of a workflow that build the web bundle, each paired with whether
 * its own step text carries the VITE_BUILD_SHA stamp. Per-STEP, not per-file
 * (Codex P2 on #2161, r3735391298): a file-wide substring search is satisfied
 * by a comment or by a different, correctly stamped job, so a second
 * unstamped build step added to an already-stamped workflow would sail
 * through — the exact future this guard exists to refuse.
 *
 * A step runs from its `- ` list marker to the next marker at the same
 * indent; the env block that stamps a build lives INSIDE the step, so the
 * stamp must appear within that slice.
 */
export function unstampedBuildSteps(source) {
  const lines = source.split('\n')
  const offenders = []
  lines.forEach((line, i) => {
    const runKey = line.match(/^(\s*)run:\s*(.*)$/)
    if (!runKey) return
    const runIndent = runKey[1].length
    // The run command may be inline, or a YAML block scalar (`run: |`,
    // `run: >`, with optional chomping/indent indicators) whose text lives on
    // the FOLLOWING deeper-indented lines. Matching only the run: line made
    // block-scalar builds invisible — not flagged, not passed, just skipped
    // (github-actions security review on #2163): the guard's own
    // never-show-less-than-you-found rule, violated by the guard.
    let command = runKey[2]
    if (/^[|>][+-]?\d*\s*(#.*)?$/.test(runKey[2])) {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === '') { command += '\n'; continue }
        const indent = lines[j].match(/^\s*/)[0].length
        if (indent <= runIndent) break
        command += '\n' + lines[j]
      }
    }
    if (!/\b(npm run build|vite build)\b/.test(command)) return
    // Walk up to the step's `- ` marker (shallower indent than the run key).
    let start = i
    for (let j = i; j >= 0; j -= 1) {
      const m = lines[j].match(/^(\s*)- /)
      if (m && m[1].length < runIndent) { start = j; break }
    }
    const stepIndent = lines[start].match(/^\s*/)[0].length
    // Walk down to the next sibling step (or the end of the block).
    let end = lines.length
    for (let j = start + 1; j < lines.length; j += 1) {
      const m = lines[j].match(/^(\s*)\S/)
      if (m && m[1].length <= stepIndent && /^\s*- /.test(lines[j])) { end = j; break }
      if (m && m[1].length < stepIndent) { end = j; break }
    }
    const step = lines.slice(start, end).join('\n')
    if (!step.includes('VITE_BUILD_SHA')) offenders.push(`step at line ${start + 1}`)
  })
  return offenders
}

test('every BUILD STEP in a real-app workflow stamps VITE_BUILD_SHA — per step, not per file', () => {
  // Codex P1 on #2159 (r3734454514) + P2 on #2161 (r3735391298). Any workflow
  // that passes VITE_APP_VERSION into a build is building the real app, and
  // every one of its bundle-building steps must stamp the sha in ITS OWN env
  // — not somewhere else in the file. (The smoke build is deliberately
  // outside the rule: fake .env.smoke config, never reports.)
  const dir = path.join(ROOT, '.github', 'workflows')
  const offenders = []
  let checked = 0
  for (const file of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(file)) continue
    const source = readFileSync(path.join(dir, file), 'utf8')
    if (!source.includes('VITE_APP_VERSION')) continue
    checked += 1
    for (const where of unstampedBuildSteps(source)) offenders.push(`${file}: ${where}`)
  }
  assert.ok(checked >= 4, `only ${checked} real-app workflows found — the filter has gone blind`)
  assert.deepEqual(offenders, [],
    `these build steps ship a real bundle whose events all say build:'dev':\n    ${offenders.join('\n    ')}`)
})

test('the step guard is not fooled by a stamp elsewhere in the same file', () => {
  // The bypass r3735391298 names, pinned as a fixture so it cannot return:
  // one correctly stamped build step, one unstamped, plus the string in a
  // comment — the unstamped STEP must still be flagged.
  const fixture = [
    '# VITE_BUILD_SHA is mentioned here in prose, which proves nothing',
    'jobs:',
    '  build:',
    '    steps:',
    '      - name: stamped build',
    '        env:',
    '          VITE_BUILD_SHA: abc123',
    '        run: npm run build',
    '      - name: unstamped second build',
    '        run: npm run build',
  ].join('\n')
  const offenders = unstampedBuildSteps(fixture)
  assert.equal(offenders.length, 1, 'exactly the unstamped step is flagged')
  assert.match(offenders[0], /line 9/)
})

test('a block-scalar run is READ, not silently skipped', () => {
  // github-actions security review on #2163: `run: |` puts the command on the
  // FOLLOWING line, which the run-line regex never saw — a build step written
  // that way was not flagged and not passed, just invisible. Both scalar
  // styles are pinned, stamped and not.
  const fixture = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - name: stamped block-scalar build',
    '        env:',
    '          VITE_BUILD_SHA: abc123',
    '        run: |',
    '          echo building',
    '          npm run build',
    '      - name: unstamped folded build',
    '        run: >',
    '          npm run build',
    '      - name: unrelated block scalar',
    '        run: |',
    '          echo not a build',
  ].join('\n')
  const offenders = unstampedBuildSteps(fixture)
  assert.equal(offenders.length, 1, 'exactly the unstamped block-scalar build is flagged')
  assert.match(offenders[0], /line 10/)
})

console.log(`\npaper-quiz zero-write: ${passed} passed`)
