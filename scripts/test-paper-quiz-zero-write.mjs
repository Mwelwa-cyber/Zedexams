/**
 * The past-paper quiz route writes to Firestore ONLY through a callable.
 *
 * ── What this guard used to be, and why it changed ──────────────────────
 *
 * It pinned `PublicQuizRunner.jsx` as the Assessment Engine's Phase-3 canary:
 * that file could not import a Firebase module AT ALL, so a defect there could
 * not corrupt persisted data and a rollback was one toggle. The header said
 * lifting it would be "a plan change, not a diff".
 *
 * That plan change was made deliberately, on an explicit decision, when the
 * past-paper quiz gained EXAM MODE. An exam needs a server-anchored attempt —
 * a clock the client owns is not a clock, and a score the candidate computes
 * is not a score (spec §5). So the canary route no longer exists;
 * `PaperQuizPage` replaced it and the engine's ramp will need a different
 * first flip. (Its flags were still at 0, so nothing had ramped.)
 *
 * ── What survives, and it is the stronger half ──────────────────────────
 *
 * The route still performs NO DIRECT FIRESTORE WRITE. Every write —
 * the attempt, the answers, the score, the practice cursor, topic mastery —
 * goes through a callable running with the admin SDK, and `firestore.rules`
 * denies client writes to all three collections outright, for admins too. So
 * the property is no longer "this file cannot reach Firebase" (it must: it
 * reads the learner's own history) but "no Firestore WRITE API is reachable
 * from this route", which is what the rules already enforce and what this
 * guard makes cheap to keep true.
 *
 * That matters most for the ANONYMOUS practice path, which is the one this
 * route still serves on a public, crawled URL with no uid to write under.
 *
 * The build-stamp checks at the bottom of this file are unrelated to any of
 * that — they pin `VITE_BUILD_SHA` on every workflow step that builds the web
 * bundle — and are untouched.
 *
 * Run: node scripts/test-paper-quiz-zero-write.mjs  (test:paper-quiz-zero-write)
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROUTE = 'src/features/papers/quiz/pages/PaperQuizPage.jsx'

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

console.log('the past-paper quiz route writes only through a callable')

test('no Firestore WRITE API is importable anywhere in the route\'s own graph', () => {
  // Walks the route's WHOLE relative-import graph and refuses the write APIs
  // by NAME, because the loaders legitimately read and the history card
  // legitimately queries. A direct-specifier check on the page alone would
  // miss a write added to a helper — `pastPaperQuiz.js` is the natural place
  // — which is the shape of the bypass this walk was built for (Codex P2 on
  // #2149, r3733259619).
  //
  // `httpsCallable` is not on the list and must not be: a callable is how
  // every legitimate write on this route happens, and the thing being refused
  // is a write the RULES would refuse too.
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
    // pastPapers.js is deliberately NOT here: the route imports its one read
    // from pastPaperLookup.js, which the walk covers in full — a write inside
    // the loader the route actually calls fails this test (Codex P2 on #2151,
    // r3733319248).
  ])
  const WRITE_APIS = /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/
  const offenders = []
  const reached = reachableFrom(ROUTE, new Set(PREEXISTING_WRITERS.keys()))
  // A resolver that has gone blind reports zero offenders, which reads
  // exactly like a clean route. Fail rather than pass by inspecting nothing.
  assert.ok(reached.size > 20,
    `the walk found only ${reached.size} files from ${ROUTE} — the resolver has gone blind`)
  for (const file of reached) {
    const source = readFileSync(path.join(ROOT, file), 'utf8')
    for (const m of source.matchAll(/import\s+([^'"]+?)\s+from\s+['"][^'"]*firestore[^'"]*['"]/g)) {
      const hit = m[1].match(WRITE_APIS)
      if (hit) offenders.push(`${file} imports ${hit[1]}`)
    }
  }
  assert.deepEqual(offenders, [],
    `a Firestore write API is importable from the past-paper quiz route — every write here\n`
    + `belongs in a callable, and firestore.rules denies client writes to these collections:\n    ${offenders.join('\n    ')}`)
  // The allowlist must describe reality: an entry for a module that no longer
  // carries a write (or is no longer reached) is stale cover for a future one.
  for (const [file, reason] of PREEXISTING_WRITERS) {
    assert.ok(reason.length > 10, `${file} needs a real reason`)
    assert.match(readFileSync(path.join(ROOT, file), 'utf8'), WRITE_APIS,
      `${file} is allowlisted but carries no write API — remove the stale entry`)
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
/** package.json's script table, for resolving `npm run x` aliases. */
const NPM_SCRIPTS = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts

/**
 * Does this shell command produce the real web bundle — directly (`vite
 * build`) or through any chain of `npm run` aliases? `android:apk:debug` runs
 * `npm run android:sync` runs `vite build`: two hops, and a workflow moved
 * onto either alias ships a bundle the direct-match filter never saw
 * (Codex P2 on #2163, r3735614144).
 */
export function buildsBundle(command, scripts = NPM_SCRIPTS, seen = new Set()) {
  if (/\bvite build\b/.test(command)) return true
  for (const m of command.matchAll(/\bnpm run ([\w:.-]+)/g)) {
    const name = m[1]
    if (seen.has(name) || !scripts[name]) continue
    seen.add(name)
    if (buildsBundle(scripts[name], scripts, seen)) return true
  }
  return false
}

export function unstampedBuildSteps(source) {
  const lines = source.split('\n')
  const offenders = []
  lines.forEach((line, i) => {
    // `- run:` shorthand is valid step syntax (Codex P2 on #2163,
    // r3735614129) — the list marker and the run key share a line, and a
    // pattern demanding run: first skipped the whole step.
    const runKey = line.match(/^(\s*)(?:- )?run:\s*(.*)$/)
    if (!runKey) return
    const runIndent = line.match(/^\s*/)[0].length + (/^\s*- /.test(line) ? 2 : 0)
    // The run command may be inline, or a YAML block scalar whose text lives
    // on the FOLLOWING deeper-indented lines. The header allows chomping and
    // indentation indicators IN EITHER ORDER (`|2-` is as valid as `|-2` —
    // Codex P2 on #2163, r3735614151); matching only one order silently
    // dropped the other's command lines.
    let command = runKey[2]
    if (/^[|>](?:[+-][0-9]?|[0-9][+-]?)?\s*(#.*)?$/.test(runKey[2])) {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === '') { command += '\n'; continue }
        const indent = lines[j].match(/^\s*/)[0].length
        if (indent <= runIndent) break
        command += '\n' + lines[j]
      }
    }
    if (!buildsBundle(command)) return
    // Walk up to the step's `- ` marker (the run line itself, for shorthand).
    let start = i
    if (!/^\s*- /.test(line)) {
      for (let j = i; j >= 0; j -= 1) {
        const m = lines[j].match(/^(\s*)- /)
        if (m && m[1].length < runIndent) { start = j; break }
      }
    }
    const stepIndent = lines[start].match(/^\s*/)[0].length
    // Walk down to the next sibling step (or the end of the block).
    let end = lines.length
    for (let j = start + 1; j < lines.length; j += 1) {
      const m = lines[j].match(/^(\s*)\S/)
      if (m && m[1].length <= stepIndent && /^\s*- /.test(lines[j])) { end = j; break }
      if (m && m[1].length < stepIndent) { end = j; break }
    }
    // The stamp must be a real env KEY in this step — `^\s*VITE_BUILD_SHA:`
    // as a mapping entry — never a substring: a `# TODO: add VITE_BUILD_SHA`
    // comment satisfied the old includes() and re-created the comment bypass
    // one level down (Codex P2 on #2163, r3735614138).
    const step = lines.slice(start, end).join('\n')
    if (!/^\s*VITE_BUILD_SHA\s*:/m.test(step)) offenders.push(`step at line ${start + 1}`)
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

test('the four bypasses from #2163\'s definitive sweep are each pinned', () => {
  // All four Codex P2s (r3735614129/138/144/151), as one fixture per bypass.
  const flag = (fixture) => unstampedBuildSteps(fixture.join('\n')).length

  // 1. Shorthand `- run:` is a real step, not invisible.
  assert.equal(flag([
    'jobs:', '  b:', '    steps:',
    '      - run: npm run build',
  ]), 1, 'shorthand unstamped build is flagged')

  // 2. A comment mentioning the stamp is NOT a stamp — the key is.
  assert.equal(flag([
    'jobs:', '  b:', '    steps:',
    '      - name: build',
    '        # TODO: add VITE_BUILD_SHA',
    '        run: npm run build',
  ]), 1, 'comment-only stamp is refused')
  assert.equal(flag([
    'jobs:', '  b:', '    steps:',
    '      - name: build',
    '        env:',
    '          VITE_BUILD_SHA: abc',
    '        run: npm run build',
  ]), 0, 'a real env key passes')

  // 3. An npm alias that TRANSITIVELY builds the bundle counts as a build.
  assert.ok(buildsBundle('npm run android:apk:debug'), 'two hops to vite build')
  assert.equal(flag([
    'jobs:', '  b:', '    steps:',
    '      - run: npm run android:sync',
  ]), 1, 'unstamped alias build is flagged')

  // 4. Indentation-first block headers are parsed.
  assert.equal(flag([
    'jobs:', '  b:', '    steps:',
    '      - name: build',
    '        run: |2-',
    '          npm run build',
  ]), 1, 'a |2- block scalar build is flagged')
})

console.log(`\npaper-quiz callable-only writes: ${passed} passed`)
