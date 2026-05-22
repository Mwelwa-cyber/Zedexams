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

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === '../logger') {
    return {
      writeAgentLog: async () => {}, writeSupervisorLog: async () => {},
      updateLiveAgentState: async () => {}, writeTaskStep: async () => {},
    }
  }
  return origLoad.call(this, request, parent, ...rest)
}

const w = await import(RUNNER)
const { curriculumUpdateReportWriteSchema } =
  await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nTrusted source registry')

test('exactly 3 sources, all from official Zambian domains', () => {
  assert(w.TRUSTED_SOURCES.length === 3, 'expected 3 trusted sources')
  for (const s of w.TRUSTED_SOURCES) {
    const u = new URL(s.url)
    assert(u.hostname.endsWith('.gov.zm') || u.hostname.endsWith('.org.zm'),
      `untrusted hostname: ${u.hostname}`)
    assert(s.trustLevel === 'very_high', `trustLevel must be very_high, got ${s.trustLevel}`)
    assert(['weekly', 'monthly'].includes(s.frequency),
      `frequency must be weekly/monthly, got ${s.frequency}`)
  }
})

test('covers MoE + CDC + ECZ', () => {
  const ids = w.TRUSTED_SOURCES.map(s => s.id)
  assert(ids.includes('moe-zambia'))
  assert(ids.includes('cdc-zambia'))
  assert(ids.includes('ecz-zambia'))
})

test('ALLOWED_URLS matches registry one-to-one', () => {
  assert(w.ALLOWED_URLS.size === w.TRUSTED_SOURCES.length)
  for (const s of w.TRUSTED_SOURCES) {
    assert(w.ALLOWED_URLS.has(s.url), `${s.url} missing from ALLOWED_URLS`)
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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
