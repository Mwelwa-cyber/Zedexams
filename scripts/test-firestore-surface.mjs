/**
 * The Firestore data layer's two structural guarantees.
 *
 * 1. `useFirestore()` still exposes exactly the surface it exposed before the
 *    role split. The split moved ~60 function bodies verbatim into four
 *    modules; the one thing a move like that can silently break is a key that
 *    fails to make it into the facade, and no component test would catch it
 *    (the call site just reads `undefined` and throws at click time, in one
 *    screen, in production). So the key set is pinned here.
 *
 * 2. The learner read path does not reach the authoring write path. This is
 *    the boundary the split exists to create: `attemptLimiter` and
 *    `learnerData` must not import the quiz write schema, the question schema
 *    or the question-write normaliser, directly or transitively, because
 *    `useSubscription` — and therefore the eager app shell — imports the
 *    limiter.
 *
 * Plain-node, no bundler: the modules are read as text and their relative
 * imports resolved on disk, so the check holds regardless of how Vite happens
 * to chunk the app on a given day.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// ── 1. The facade surface ────────────────────────────────────────────────────

// Recorded from the pre-split `useFirestore` on 2026-08-18. Adding a function
// to the data layer means adding it here on purpose; losing one fails.
const EXPECTED_SURFACE = [
  'approveContent', 'checkAndConsumeAttempt', 'confirmPayment', 'createAssessment',
  'createLesson', 'createQuiz', 'deleteAssessment', 'deleteLesson', 'deleteQuestion',
  'deleteQuiz', 'findUserByEmail', 'getActivePremiumCount', 'getAllLearners', 'getAllLessons', 'getAllPayments', 'getAllQuizzes', 'getAllResults',
  'getAllUsers', 'getAssessmentById', 'getAssessmentQuestions', 'getDashboardCounts',
  'getLessonById', 'getLessons', 'getMyAssessments', 'getMyLessons', 'getMyPayments',
  'getMyQuizzes', 'getPendingApprovals', 'getPendingPayments', 'getQuestions',
  'getQuizById', 'getQuizzes', 'getQuizzesByTeacher', 'getRecentConfirmedPayments',
  'getRecentResults', 'getResultById', 'getResultsForQuiz', 'getResultsInWindow',
  'getRevenueByDay', 'getTodayPaymentStats', 'getUserResults', 'getWeaknessAnalysis',
  'grantAccessByEmail', 'grantPremium', 'rejectContent', 'rejectPayment', 'revokePremium',
  'saveAssessmentQuestions', 'saveQuestions', 'saveResult', 'submitForApproval',
  'submitPaymentRequest', 'updateAssessment', 'updateAssessmentWithQuestions',
  'updateLesson', 'updateQuiz', 'updateQuizWithQuestions', 'updateUserRole',
  'withdrawFromApproval',
]

check('useFirestore() exposes exactly the recorded surface', () => {
  const src = read('src/hooks/useFirestore.js')
  const start = src.indexOf('return useMemo(() => ({')
  assert(start > 0, 'could not find the facade object literal')
  const body = src.slice(start, src.indexOf('}), [])', start))
  const keys = new Set()
  for (const line of body.split('\n')) {
    const m = line.replace(/\/\/.*$/, '').match(/^\s*([A-Za-z_$][\w$]*)\s*[,:]/)
    if (m) keys.add(m[1])
  }
  const missing = EXPECTED_SURFACE.filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !EXPECTED_SURFACE.includes(k))
  assert(missing.length === 0, `missing from the facade: ${missing.join(', ')}`)
  assert(extra.length === 0, `not in the recorded surface — add it deliberately: ${extra.join(', ')}`)
})

check('useLearnerFirestore() exposes only learner reads', () => {
  const src = read('src/hooks/useLearnerFirestore.js')
  const start = src.indexOf('const LEARNER_API = Object.freeze({')
  assert(start > 0, 'LEARNER_API not found')
  const body = src.slice(start, src.indexOf('})', start))
  const keys = body.split('\n')
    .map((l) => (l.match(/^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/) || [])[1]).filter(Boolean)
  const banned = keys.filter((k) => /^(create|update|delete|save|grant|revoke|confirm|reject|approve|submit|withdraw)/.test(k) && k !== 'saveResult')
  assert(banned.length === 0, `write-shaped functions on the learner surface: ${banned.join(', ')}`)
  assert(keys.includes('getUserResults') && keys.includes('getQuizzes'), 'learner surface lost a core read')
})

// ── 2. The learner path never reaches the authoring path ─────────────────────

const EXTS = ['', '.js', '.jsx', '/index.js', '/index.jsx']
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec)
  for (const e of EXTS) {
    const p = base + e
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.relative(ROOT, p)
  }
  return null
}
/** Every module statically reachable from `entry` (dynamic import() excluded — it is a separate chunk by definition). */
function staticClosure(entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()
    if (!f || seen.has(f) || !fs.existsSync(path.join(ROOT, f))) continue
    seen.add(f)
    const src = read(f)
    const re = /(?:^|\n)\s*(?:import|export)[^\n;]*?from\s*['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(src))) {
      const r = resolveImport(f, m[1])
      if (r) stack.push(r)
    }
  }
  return seen
}

const AUTHORING_ONLY = [
  'src/utils/questionWritePayload.js',
  'src/editor/schema/question.js',
  'src/utils/deleteQuizWithQuestions.js',
]

for (const entry of ['src/hooks/firestore/attemptLimiter.js', 'src/hooks/firestore/learnerData.js']) {
  check(`${entry} does not reach the authoring write path`, () => {
    const closure = staticClosure(entry)
    const hits = AUTHORING_ONLY.filter((m) => closure.has(m))
    assert(hits.length === 0, `reaches authoring-only modules: ${hits.join(', ')}`)
  })
}

check('the scoped learner hook is not reachable from the facade path', () => {
  // A re-export from useFirestore.js would be an import that works and
  // silently pulls the authoring + admin graphs — see useLearnerFirestore.js.
  const src = read('src/hooks/useFirestore.js')
  assert(!/useLearnerFirestore/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    'useFirestore.js re-exports useLearnerFirestore, which re-couples the chunks')
})

check('useSubscription does not import the whole Firestore surface', () => {
  const src = read('src/hooks/useSubscription.js')
  const imports = [...src.matchAll(/^\s*import[^\n;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  assert(!imports.some((i) => /\.\/useFirestore$/.test(i)),
    'useSubscription imports useFirestore again — that puts the authoring schemas back into the eager app shell')
})

// ── 3. Specs mock the module their component actually imports ────────────────

check('no spec mocks the facade for a component that uses the scoped hook', () => {
  // The drift this catches: a component migrates to `useLearnerFirestore` and
  // its spec keeps `vi.mock('.../useFirestore')`. The spec still PASSES —
  // Vitest happily mocks a module nobody imports — so the component silently
  // runs against the real data layer and the mock asserts nothing. Found the
  // hard way during this split; a green suite is not evidence the mock is wired.
  const specs = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.spec\.(js|jsx)$/.test(e.name)) specs.push(rel)
    }
  }
  walk('src')

  const broken = []
  for (const spec of specs) {
    const src = read(spec)
    const mocksFacade = /vi\.mock\(\s*['"][^'"]*hooks\/useFirestore['"]/.test(src)
    if (!mocksFacade) continue
    // The component under test is the spec path minus `.spec`.
    const base = spec.replace(/\.spec\.(js|jsx)$/, '')
    const target = ['.jsx', '.js'].map((e) => base + e).find((f) => fs.existsSync(path.join(ROOT, f)))
    if (!target) continue
    const t = read(target)
    if (/useLearnerFirestore/.test(t) && !/\buseFirestore\b\s*\(/.test(t)) {
      broken.push(`${spec} mocks useFirestore but ${path.basename(target)} imports useLearnerFirestore`)
    }
  }
  assert(broken.length === 0, broken.join('\n       '))
})

console.log(failures === 0 ? '\nfirestore surface: all checks passed' : `\nfirestore surface: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
