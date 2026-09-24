// Guards the instance caps on functions that never need to scale.
//
// Every Cloud Function here runs on 1 vCPU and, unless it says otherwise,
// may scale to 100 instances — so each one can claim up to 100 vCPUs of the
// project's Cloud Run CPU quota in its region. That quota is what failed
// deploys #811, #813 and #815 ("Quota exceeded for total allowable CPU per
// project per region"). A scheduled job runs once per tick and one instance
// serves 80 concurrent requests, so it never needs more than one; the admin
// tools below are used by a handful of staff.
//
// So:
//   - EVERY onSchedule function declares maxInstances. A new cron without one
//     silently goes back to 100.
//   - The admin callables listed in ADMIN_CAPPED keep theirs. Removing one is
//     a decision, not a tidy-up — update this list in the same PR.
//
// Text-level, like scripts/lib/functionsManifest.mjs, because the Tests job
// installs only the root package and cannot load functions/index.js.
//
// Run: node scripts/test-function-instance-caps.mjs  (test:function-instance-caps)

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const FUNCTIONS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'functions')

export const ADMIN_CAPPED = [
  'importBuiltInCbcTopics', 'importBuiltInAssessmentFormats', 'importCurriculumModules',
  'backfillKbSourceRefs', 'upsertSyllabusRow', 'deleteSyllabusRow', 'restoreSyllabusRow',
  'activateSyllabusVersion', 'rollbackSyllabusVersion', 'getAiBudgetEnforcement',
  'triggerWeeklyParentDigest', 'backfillReferralCodes', 'getTtsControlRoom',
  'adminSetUserStatus', 'adminSetUserRole', 'resetAdminMfa',
  'adminConfirmPayment', 'adminRejectPayment', 'adminGrantPremium', 'adminRevokePremium',
]

// Text of the balanced {...} starting at `open` (which must index a "{").
function objectAt(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return null
}

// `const NAME = {...}` in the same file, or null.
function constObject(src, name) {
  const m = new RegExp(`\\bconst\\s+${name}\\s*=\\s*\\{`).exec(src)
  return m ? objectAt(src, m.index + m[0].length - 1) : null
}

// Does the options argument starting at `at` declare maxInstances — directly,
// or through a same-file constant it names or spreads?
export function optionsDeclareCap(src, at) {
  const rest = src.slice(at)
  const lead = /^\s*/.exec(rest)[0].length
  const start = at + lead
  let text
  if (src[start] === '{') text = objectAt(src, start)
  else {
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(start))
    text = id ? constObject(src, id[0]) : null
  }
  if (!text) return false
  if (/\bmaxInstances\s*:/.test(text)) return true
  for (const [, name] of text.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
    const spread = constObject(src, name)
    if (spread && /\bmaxInstances\s*:/.test(spread)) return true
  }
  return false
}

// Every onSchedule( call in `src` whose options lack a cap, by line number.
export function uncappedSchedules(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:"'`])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length))
  const out = []
  for (const m of code.matchAll(/\bonSchedule\(/g)) {
    if (!optionsDeclareCap(code, m.index + m[0].length)) {
      out.push(code.slice(0, m.index).split('\n').length)
    }
  }
  return out
}

// The detector must be able to fail, or a green run proves nothing.
assert.deepEqual(uncappedSchedules('const a = onSchedule({schedule: "x"}, f)'), [1])
assert.deepEqual(uncappedSchedules('const a = onSchedule({maxInstances: 1, schedule: "x"}, f)'), [])
assert.deepEqual(uncappedSchedules('const O = {schedule: "x"};\nconst a = onSchedule(O, f)'), [2])
assert.deepEqual(uncappedSchedules('const O = {maxInstances: 1, schedule: "x"};\nconst a = onSchedule(O, f)'), [])
assert.deepEqual(uncappedSchedules('const B = {region: "r"};\nonSchedule({...B, schedule: "x"}, f)'), [2])
assert.deepEqual(uncappedSchedules('const B = {region: "r"};\nonSchedule({...B, maxInstances: 1, schedule: "x"}, f)'), [])
assert.deepEqual(uncappedSchedules('// onSchedule({schedule: "x"}) in a comment\nconst x = 1'), [])

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(full)
  }
  return out
}

let passed = 0
const failures = []
const files = walk(FUNCTIONS).map((f) => [relative(FUNCTIONS, f).split('\\').join('/'), readFileSync(f, 'utf8')])

let schedules = 0
for (const [rel, src] of files) {
  schedules += (src.replace(/\/\*[\s\S]*?\*\//g, '').match(/\bonSchedule\(/g) || []).length
  for (const line of uncappedSchedules(src)) failures.push(`functions/${rel}:${line} — onSchedule without maxInstances`)
}
assert.ok(schedules >= 41, `expected at least 41 onSchedule calls, found ${schedules} — the scan has stopped seeing them`)
passed++

for (const name of ADMIN_CAPPED) {
  const def = new RegExp(`(?:exports\\.${name}|\\b${name}\\s*[:=])\\s*=?\\s*onCall\\(`)
  const hit = files.find(([, src]) => def.test(src))
  if (!hit) { failures.push(`${name} — onCall definition not found`); continue }
  const [rel, src] = hit
  const m = def.exec(src)
  if (!optionsDeclareCap(src, m.index + m[0].length)) failures.push(`functions/${rel} — ${name} lost its maxInstances cap`)
  else passed++
}

if (failures.length) {
  console.error('Instance caps missing:')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log(`test:function-instance-caps OK — ${schedules} scheduled + ${passed - 1} admin functions capped`)
