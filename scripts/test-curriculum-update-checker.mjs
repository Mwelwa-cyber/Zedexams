#!/usr/bin/env node
/**
 * Curriculum Update Checker Agent — unit tests.
 *
 * Covers:
 *   - Trusted source whitelist + the assertWhitelisted refusal
 *   - sha256Hex stability
 *   - Frequency gating per source (weekly vs monthly)
 *   - summariseChange first-snapshot vs delta cases
 *   - Curriculum reports schema compatibility for the report shape
 *     this agent writes
 *   - Privacy invariant: ALLOWED_URLS only contains the hardcoded
 *     official Zambian sources
 *   - End-to-end Zod validation against curriculumUpdateReportWriteSchema
 *
 * Run: npm run test:curriculum-watcher  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/curriculumWatcher.js')
const RULES_TEXT = readFileSync(join(ROOT, 'firestore.rules'), 'utf8')

const fakeAdmin = {firestore: () => ({})}
fakeAdmin.firestore.FieldValue = {serverTimestamp: () => '__ts__'}

// Lightweight stubs for the few Cloud Functions APIs the runner +
// callable touch at module load time. Tests never invoke the wrapped
// handlers — they only exercise the pure helpers exported alongside.
class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const fakeFunctionsHttps = {
  onCall: (...args) => {
    // Last arg is always the handler; ignore the options object so the
    // wrapper is a no-op at module load.
    return args[args.length - 1]
  },
  HttpsError: FakeHttpsError,
}
const fakeFunctionsParams = {
  defineSecret: (name) => ({ name, value: () => null }),
}
const fakeAutomationGate = { loadAutomationSettings: async () => ({}) }
const fakeAiService = {
  getUserRole: async () => 'admin',
  callAnthropic: async () => '{}',
  getAnthropicApiKey: () => null,
}
const fakeCbcKnowledge = {
  getActiveKbVersion: async () => 'v1',
  invalidateKbCache: () => {},
}
const fakeV2Collections = {
  COLLECTIONS: { CURRICULUM_REPORTS: 'curriculumUpdateReports' },
  TASK_STEP_STATUS: { RUNNING: 'running', COMPLETED: 'completed' },
  SEVERITY: { INFO: 'info', WARNING: 'warning' },
}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === 'firebase-functions/v2/https') return fakeFunctionsHttps
  if (request === 'firebase-functions/params') return fakeFunctionsParams
  if (request === '../logger') {
    return {
      writeAgentLog: async () => {}, writeSupervisorLog: async () => {},
      updateLiveAgentState: async () => {}, writeTaskStep: async () => {},
    }
  }
  if (request === '../automationGate') return fakeAutomationGate
  if (request === '../aiService') return fakeAiService
  if (request === './cbcKnowledge') return fakeCbcKnowledge
  if (request === '../v2Collections') return fakeV2Collections
  return origLoad.call(this, request, parent, ...rest)
}

const w = await import(RUNNER)
const { curriculumUpdateReportWriteSchema } =
  await import('../src/schemas/learnerAi.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nTrusted source registry')

// Hostnames that must remain on the whitelist. Sources may be added but
// never removed silently — losing one of these is a regression.
const REQUIRED_HOSTNAMES = new Set([
  'www.moe.gov.zm',
  'www.cdc.gov.zm',
  'www.exams-council.org.zm',
  'library.cdcrepository.info',
  'www.edu.gov.zm',
])

const TRUSTED_HOSTNAME_SUFFIXES = [
  '.gov.zm', '.org.zm', 'cdcrepository.info',
]

test('every source is trusted, declared, and on a known suffix', () => {
  assert(w.TRUSTED_SOURCES.length >= 5,
    `expected at least 5 trusted sources, got ${w.TRUSTED_SOURCES.length}`)
  for (const s of w.TRUSTED_SOURCES) {
    const u = new URL(s.url)
    const okSuffix = TRUSTED_HOSTNAME_SUFFIXES.some(suffix =>
      u.hostname === suffix.replace(/^\./, '') || u.hostname.endsWith(suffix))
    assert(okSuffix, `untrusted hostname: ${u.hostname}`)
    assert(s.trustLevel === 'very_high', `trustLevel must be very_high, got ${s.trustLevel}`)
    assert(['weekly', 'monthly'].includes(s.frequency),
      `frequency must be weekly/monthly, got ${s.frequency}`)
  }
})

test('covers MoE + CDC + ECZ + CDC Repository + edu.gov.zm', () => {
  const ids = new Set(w.TRUSTED_SOURCES.map(s => s.id))
  assert(ids.has('moe-zambia'))
  assert(ids.has('cdc-zambia'))
  assert(ids.has('ecz-zambia'))
  assert(ids.has('cdc-repository'))
  assert(ids.has('moe-edu-zm-syllabi'))
})

test('every required hostname is present on the whitelist', () => {
  const hostnames = new Set(w.TRUSTED_SOURCES.map(s => new URL(s.url).hostname))
  for (const required of REQUIRED_HOSTNAMES) {
    assert(hostnames.has(required), `missing required hostname: ${required}`)
  }
})

test('ALLOWED_URLS matches registry one-to-one', () => {
  assert(w.ALLOWED_URLS.size === w.TRUSTED_SOURCES.length)
  for (const s of w.TRUSTED_SOURCES) {
    assert(w.ALLOWED_URLS.has(s.url), `${s.url} missing from ALLOWED_URLS`)
  }
})

test('ALLOWED_HOSTS covers every source hostname', () => {
  assert(w.ALLOWED_HOSTS instanceof Set, 'ALLOWED_HOSTS must be a Set')
  for (const s of w.TRUSTED_SOURCES) {
    const host = new URL(s.url).hostname.toLowerCase()
    assert(w.ALLOWED_HOSTS.has(host), `${host} missing from ALLOWED_HOSTS`)
  }
})

console.log('\nPrivacy / whitelist guard')

test('assertWhitelisted refuses non-whitelisted URL', () => {
  let threw = false
  try { w.assertWhitelisted('https://random.example.com/syllabus') }
  catch (e) {
    threw = true
    assert(/refused_non_whitelisted_url/.test(e.message))
  }
  assert(threw, 'must throw on non-whitelisted URL')
})
test('assertWhitelisted accepts each trusted URL', () => {
  for (const s of w.TRUSTED_SOURCES) {
    w.assertWhitelisted(s.url) // must not throw
  }
})
test('assertWhitelisted refuses empty / non-string', () => {
  let threw1 = false; try { w.assertWhitelisted('') } catch { threw1 = true }
  let threw2 = false; try { w.assertWhitelisted(null) } catch { threw2 = true }
  let threw3 = false; try { w.assertWhitelisted(123) } catch { threw3 = true }
  assert(threw1 && threw2 && threw3, 'must throw on empty/null/non-string')
})

test('assertWhitelisted permits same-host sub-paths (for crawler)', () => {
  // CDC Repository is crawlEnabled — the ingester needs to follow
  // links like /collect/syllabi/grade-7.pdf under the same hostname.
  w.assertWhitelisted('https://library.cdcrepository.info/collect/syllabi/grade-7.pdf')
  w.assertWhitelisted('https://www.edu.gov.zm/wp-content/uploads/2024/01/grade-5-mathematics.pdf')
})

test('assertWhitelisted refuses similar-looking but wrong hostnames', () => {
  // Defence-in-depth: the agent must not be tricked by typo-squat
  // hostnames or subdomain abuse.
  for (const hostile of [
    'https://evil.com/syllabus.pdf',
    'https://library.cdcrepository.info.evil.com/x',
    'https://www-edu.gov.zm/x',
  ]) {
    let threw = false
    try { w.assertWhitelisted(hostile) } catch { threw = true }
    assert(threw, `must refuse ${hostile}`)
  }
})

console.log('\nsha256Hex')

test('sha256Hex is deterministic', () => {
  const a = w.sha256Hex('hello world')
  const b = w.sha256Hex('hello world')
  assert(a === b, 'must be deterministic')
  assert(a.length === 64, 'sha256 hex must be 64 chars')
})
test('sha256Hex distinguishes different inputs', () => {
  assert(w.sha256Hex('a') !== w.sha256Hex('b'))
})

console.log('\nFrequency gating (dueForCheck)')

const weeklySrc = w.TRUSTED_SOURCES.find(s => s.frequency === 'weekly')
const monthlySrc = w.TRUSTED_SOURCES.find(s => s.frequency === 'monthly')
const NOW = Date.now()

test('no prior check → due', () => {
  assert(w.dueForCheck({source: weeklySrc, sourceState: null, nowMs: NOW}) === true)
})
test('fresh check (1s ago) → NOT due', () => {
  assert(w.dueForCheck({source: weeklySrc, sourceState: {lastCheckedAtMs: NOW - 1000}, nowMs: NOW}) === false)
})
test('weekly source, 8 days old → due', () => {
  assert(w.dueForCheck({source: weeklySrc, sourceState: {lastCheckedAtMs: NOW - 8 * 24 * 3600 * 1000}, nowMs: NOW}) === true)
})
test('weekly source, 5 days old → NOT due', () => {
  assert(w.dueForCheck({source: weeklySrc, sourceState: {lastCheckedAtMs: NOW - 5 * 24 * 3600 * 1000}, nowMs: NOW}) === false)
})
test('monthly source, 14 days old → NOT due', () => {
  assert(w.dueForCheck({source: monthlySrc, sourceState: {lastCheckedAtMs: NOW - 14 * 24 * 3600 * 1000}, nowMs: NOW}) === false)
})
test('monthly source, 31 days old → due', () => {
  assert(w.dueForCheck({source: monthlySrc, sourceState: {lastCheckedAtMs: NOW - 31 * 24 * 3600 * 1000}, nowMs: NOW}) === true)
})
test('Timestamp-like lastCheckedAt (toMillis) is honoured', () => {
  const ts = {toMillis: () => NOW - 5 * 1000}
  assert(w.dueForCheck({source: weeklySrc, sourceState: {lastCheckedAt: ts}, nowMs: NOW}) === false)
})

console.log('\nsummariseChange — first snapshot vs delta')

test('first snapshot (no old body) generates a baseline summary', () => {
  const s = w.summariseChange({source: weeklySrc, oldBody: null, newBody: '<html>hello</html>'})
  assert(/first snapshot/i.test(s.summary), `expected "first snapshot" in: ${s.summary}`)
  assert(s.recommendation.length > 0)
})
test('small delta → small-delta recommendation', () => {
  const s = w.summariseChange({source: weeklySrc, oldBody: 'a'.repeat(1000), newBody: 'a'.repeat(1050)})
  assert(/small delta/i.test(s.recommendation), `expected small-delta wording: ${s.recommendation}`)
})
test('large delta → urgent recommendation', () => {
  const s = w.summariseChange({source: weeklySrc, oldBody: 'a'.repeat(1000), newBody: 'b'.repeat(1500)})
  assert(/LARGE delta/i.test(s.recommendation), `expected LARGE delta wording: ${s.recommendation}`)
})
test('summary strips HTML for the preview', () => {
  const s = w.summariseChange({source: weeklySrc,
    oldBody: 'a'.repeat(1000),
    newBody: '<html><body><h1>Heading</h1><p>Real text</p></body></html>'})
  assert(!/<h1>/i.test(s.summary), 'HTML tags must be stripped from preview')
})

console.log('\nRules + isolation')

test('curriculumUpdateReports rule allows admin read + status update', () => {
  const idx = RULES_TEXT.indexOf('match /curriculumUpdateReports/')
  assert(idx >= 0)
  const slice = RULES_TEXT.slice(idx, idx + 400)
  assert(/allow read: if isAdmin/.test(slice))
  assert(/allow update: if isAdmin/.test(slice))
  assert(/'status'/.test(slice) || /"status"/.test(slice))
})

test('agent does not import collection("quizzes" | "cbcKnowledgeBase")', () => {
  const runner = readFileSync(RUNNER, 'utf8')
  assert(!/collection\(['"]quizzes['"]\)/.test(runner),
    'curriculum watcher must NOT touch quizzes')
  assert(!/collection\(['"]cbcKnowledgeBase['"]\)/.test(runner),
    'curriculum watcher must NOT mutate cbcKnowledgeBase')
})

console.log('\nReport shape — Zod validation')

test('per-source report passes curriculumUpdateReportWriteSchema', () => {
  const src = w.TRUSTED_SOURCES[0]
  const {summary, recommendation} = w.summariseChange({
    source: src, oldBody: null, newBody: '<html>x</html>',
  })
  const report = {
    sourceName: src.name,
    sourceUrl: src.url,
    trustLevel: src.trustLevel,
    updateType: src.updateType,
    affectedGrades: src.affectedGrades || [],
    affectedSubjects: src.affectedSubjects || [],
    summary,
    recommendation,
    status: 'pending_review',
    checkedAt: new Date(),
    reviewedBy: null,
    reviewedAt: null,
  }
  const parsed = curriculumUpdateReportWriteSchema.parse(report)
  assert(parsed.status === 'pending_review')
  assert(parsed.trustLevel === 'very_high')
})

test('report status is ALWAYS pending_review on creation', () => {
  // Source-text check on the runner: the inline literal must remain
  // 'pending_review' so no future tweak silently auto-applies updates.
  const runnerText = readFileSync(RUNNER, 'utf8')
  assert(/status:\s*['"]pending_review['"]/.test(runnerText),
    'agent must always set status:"pending_review" on new reports')
})

console.log('\nGrade-scope helpers')

test('normaliseGradeToken accepts numeric grades 1-12', () => {
  for (let g = 1; g <= 12; g++) {
    assert(w.normaliseGradeToken(g) === String(g), `numeric ${g} should normalise`)
    assert(w.normaliseGradeToken(String(g)) === String(g), `string '${g}' should normalise`)
  }
})
test('normaliseGradeToken accepts G-prefixed strings', () => {
  assert(w.normaliseGradeToken('G3') === '3')
  assert(w.normaliseGradeToken('g12') === '12')
})
test('normaliseGradeToken accepts ECE aliases', () => {
  assert(w.normaliseGradeToken('ECE') === 'ECE')
  assert(w.normaliseGradeToken('ece') === 'ECE')
  assert(w.normaliseGradeToken('PP') === 'ECE')
  assert(w.normaliseGradeToken('Early Childhood') === 'ECE')
})
test('normaliseGradeToken rejects garbage', () => {
  assert(w.normaliseGradeToken(null) === null)
  assert(w.normaliseGradeToken('') === null)
  assert(w.normaliseGradeToken('Grade 13') === null)
  assert(w.normaliseGradeToken('hello') === null)
  assert(w.normaliseGradeToken(0) === null)
  assert(w.normaliseGradeToken(99) === null)
})

test('buildGradeFilter returns null for empty/missing filter', () => {
  assert(w.buildGradeFilter(null) === null)
  assert(w.buildGradeFilter(undefined) === null)
  assert(w.buildGradeFilter([]) === null)
})
test('buildGradeFilter dedupes + normalises', () => {
  const f = w.buildGradeFilter(['3', 3, 'G3', '5'])
  assert(f instanceof Set)
  assert(f.size === 2, `expected 2 unique tokens, got ${f.size}`)
  assert(f.has('3') && f.has('5'))
})
test('buildGradeFilter ignores unrecognised tokens', () => {
  // Mixed garbage + valid → valid tokens come through, garbage drops.
  const f = w.buildGradeFilter(['hello', 'G7', 'ECE'])
  assert(f.size === 2)
  assert(f.has('7') && f.has('ECE'))
})

test('preFilterLinkByGrade skips obviously wrong-grade URLs', () => {
  const filter = w.buildGradeFilter(['3', '4'])
  const res = w.preFilterLinkByGrade(
    {url: 'https://example.com/grade-7-syllabus.pdf', anchorText: '', kind: 'pdf'},
    filter,
  )
  assert(res.skip === true)
  assert(/grade_filtered:7/.test(res.reason), `got ${res.reason}`)
})
test('preFilterLinkByGrade keeps in-scope URLs', () => {
  const filter = w.buildGradeFilter(['3', '4'])
  const res = w.preFilterLinkByGrade(
    {url: 'https://example.com/grade-3-math.pdf', anchorText: '', kind: 'pdf'},
    filter,
  )
  assert(res.skip === false)
})
test('preFilterLinkByGrade passes ambiguous URLs through', () => {
  // No grade marker visible at link-discovery time — must NOT skip
  // here so the post-classify gate gets to look at the PDF body.
  const filter = w.buildGradeFilter(['3'])
  const res = w.preFilterLinkByGrade(
    {url: 'https://example.com/uploads/file_2934.pdf', anchorText: '', kind: 'pdf'},
    filter,
  )
  assert(res.skip === false)
})
test('preFilterLinkByGrade respects ECE marker', () => {
  const filter = w.buildGradeFilter(['1', '2'])
  const res = w.preFilterLinkByGrade(
    {url: 'https://example.com/x', anchorText: 'Early Childhood Materials', kind: 'pdf'},
    filter,
  )
  assert(res.skip === true)
  assert(res.reason === 'grade_filtered:ECE')
})
test('preFilterLinkByGrade no-ops when filter is null', () => {
  const res = w.preFilterLinkByGrade(
    {url: 'https://example.com/grade-7-syllabus.pdf', anchorText: ''}, null,
  )
  assert(res.skip === false)
})

test('postFilterModuleByGrade skips out-of-scope detected grade', () => {
  const filter = w.buildGradeFilter(['3', '4'])
  const res = w.postFilterModuleByGrade({
    meta: {grade: 7, subject: 'mathematics'},
    gradeFilter: filter, includeUnknownGrade: true,
  })
  assert(res.skip === true)
  assert(res.reason === 'grade_filtered:7')
})
test('postFilterModuleByGrade keeps unknown grade when allowed', () => {
  const filter = w.buildGradeFilter(['3'])
  const res = w.postFilterModuleByGrade({
    meta: {grade: null, subject: 'mathematics'},
    gradeFilter: filter, includeUnknownGrade: true,
  })
  assert(res.skip === false)
})
test('postFilterModuleByGrade skips unknown grade when forbidden', () => {
  const filter = w.buildGradeFilter(['3'])
  const res = w.postFilterModuleByGrade({
    meta: {grade: null, subject: 'mathematics'},
    gradeFilter: filter, includeUnknownGrade: false,
  })
  assert(res.skip === true)
  assert(res.reason === 'grade_undetected')
})

console.log('\nCallable: normaliseRunOptions')

const promote = await import('../functions/teacherTools/promoteIngestedCurriculumModule.js')
const { normaliseRunOptions } = promote._internals

test('normaliseRunOptions defaults to unscoped + include-unknown', () => {
  const out = normaliseRunOptions({})
  assert(out.grades === null)
  assert(out.includeUnknownGrade === true)
})
test('normaliseRunOptions normalises grades + flips include-unknown default', () => {
  const out = normaliseRunOptions({grades: ['3', 'G4', 'ECE']})
  assert(Array.isArray(out.grades))
  assert(out.grades.length === 3)
  // Defaults to false when a scope is set so wrong/unknown-grade docs
  // don't sneak through.
  assert(out.includeUnknownGrade === false)
})
test('normaliseRunOptions honours explicit includeUnknownGrade=true', () => {
  const out = normaliseRunOptions({grades: ['3'], includeUnknownGrade: true})
  assert(out.includeUnknownGrade === true)
})
test('normaliseRunOptions throws on non-array grades', () => {
  let threw = false
  try { normaliseRunOptions({grades: '3'}) } catch (e) {
    threw = true
    assert(/grades must be an array/.test(e.message))
  }
  assert(threw, 'must throw on non-array grades')
})
test('normaliseRunOptions throws on unrecognised token', () => {
  let threw = false
  try { normaliseRunOptions({grades: ['Grade 99']}) } catch (e) {
    threw = true
    assert(/Unrecognised grade token/.test(e.message))
  }
  assert(threw)
})
test('normaliseRunOptions treats empty grades array as unscoped', () => {
  const out = normaliseRunOptions({grades: []})
  assert(out.grades === null)
  assert(out.includeUnknownGrade === true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
