/**
 * Phase 6, Slice 1 — the inventory is complete, accurate, and its contract bites.
 *
 * Three properties, each guarding a different way this could quietly stop being
 * true:
 *
 *   COMPLETE   every direct model call site in `functions/` appears in the
 *              inventory. Adding a generator without recording it fails here,
 *              so the un-migrated surface cannot grow silently.
 *
 *   ACCURATE   every recorded state matches what the source actually does. A
 *              record cannot claim `migrated` while the code says otherwise,
 *              and — the direction that matters more — a generator that GAINS
 *              a reservation without anyone updating its record also fails,
 *              so the inventory tracks reality rather than intent.
 *
 *   BINDING    the contract rejects the `partial` state. If it accepted a
 *              reservation-behind-a-guard as migrated, Phase 6 could be
 *              declared finished with five generators still bypassable.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites"). Auto-
 * discovered by scripts/run-all-tests.mjs — do not edit `test:all` by hand.
 */

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import {
  scanModelCallSites, scanFile, readProviderExports, PROVIDER_CALLS, NOT_A_MODEL_CALL,
} from './aiGenerators/scanModelCallSites.js'
import { INVENTORY, GENERATORS, CLASSES, TIERS, byTier, stateCounts } from './aiGenerators/inventory.js'
import { CLAUSES, checkContract, derivedState } from './aiGenerators/migrationContract.js'
import {
  exportedRunnerName, findRunnerCallers, VERIFIED_FORWARDERS,
} from './aiGenerators/runnerCallers.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const sites = scanModelCallSites(ROOT)
const recorded = new Set(INVENTORY.map((r) => r.file))

console.log('\n— the inventory is complete —')

test('every direct model call site in functions/ is recorded', () => {
  const missing = sites.map((s) => s.file).filter((f) => !recorded.has(f))
  assert.deepEqual(missing, [],
    `these call sites are not in the inventory:\n    ${missing.join('\n    ')}\n`
    + '  Add a record (and a tier, if a user waits on it) before merging.')
})

test('every recorded file still exists and still calls a model', () => {
  // The other direction: a record for a file that was deleted or that no longer
  // reaches a provider protects nothing and reads exactly like one that works.
  const stale = INVENTORY
    .filter((r) => !existsSync(join(ROOT, r.file)) || !scanFile(join(ROOT, r.file), ROOT))
    .map((r) => r.file)
  assert.deepEqual(stale, [], `these records no longer describe a model call site: ${stale.join(', ')}`)
})

test('no record is a duplicate', () => {
  assert.equal(recorded.size, INVENTORY.length, 'two records name the same file')
})

console.log('\n— the provider registry cannot silently miss a wrapper —')

test('every export of every provider module is classified', () => {
  // Completeness of the scan rests entirely on PROVIDER_CALLS being right, and
  // it was not: `callClaude` — the wrapper EVERY teacher tool uses — had to be
  // added by hand after the first scan reported the generators as making no
  // model call. A registry maintained by memory will lose that race again.
  //
  // So every export of every provider module must be classified as one or the
  // other. A new wrapper fails here until someone says which it is.
  const unclassified = []
  for (const [mod, names] of readProviderExports(ROOT)) {
    for (const name of names) {
      if (PROVIDER_CALLS.includes(name)) continue
      if (Object.prototype.hasOwnProperty.call(NOT_A_MODEL_CALL, name)) continue
      unclassified.push(`${mod} exports ${name}`)
    }
  }
  assert.deepEqual(unclassified, [],
    'these provider-module exports are neither a registered model call nor '
    + `declared not-a-call:\n    ${unclassified.join('\n    ')}\n`
    + '  Add to PROVIDER_CALLS, or to NOT_A_MODEL_CALL with a reason.')
})

test('no registered provider call is a phantom', () => {
  // The other direction, and the one that actually bit. The registry listed
  // `createEmbedding`, a name that appears nowhere in the repo, while the real
  // export — embedText, used by Qix's semantic dedup — was unregistered. A
  // phantom entry reads exactly like a working one and quietly covers nothing.
  const exported = new Set([...readProviderExports(ROOT).values()].flat())
  const phantom = PROVIDER_CALLS.filter((c) => !exported.has(c))
  assert.deepEqual(phantom, [],
    `these are registered as provider calls but no provider module exports them: ${phantom.join(', ')}`)
})

test('nothing is classified both ways', () => {
  const both = PROVIDER_CALLS.filter((c) => Object.prototype.hasOwnProperty.call(NOT_A_MODEL_CALL, c))
  assert.deepEqual(both, [], `classified as both a model call and not: ${both.join(', ')}`)
})

console.log('\n— every record says what it is for —')

test('each record carries a class, an entry point and what it produces', () => {
  for (const r of INVENTORY) {
    assert.ok(Object.values(CLASSES).includes(r.class), `${r.file}: unknown class ${r.class}`)
    assert.ok(r.entryPoint, `${r.file}: no entry point recorded`)
    assert.ok(r.produces, `${r.file}: nothing recorded about what it produces`)
    assert.equal(typeof r.incompleteResultSaveable, 'boolean',
      `${r.file}: whether a half-finished result can be saved is not recorded`)
  }
})

test('every generator has a migration tier, and nothing else does', () => {
  for (const r of GENERATORS) {
    assert.ok(TIERS[r.tier], `${r.file}: generator with no valid tier (got ${r.tier})`)
  }
  const nonGenerators = INVENTORY.filter((r) => r.class !== CLASSES.generator)
  for (const r of nonGenerators) {
    assert.equal(r.tier, null, `${r.file}: only generators carry a tier`)
  }
})

console.log('\n— the recorded state matches the source —')

test('no generator claims a state its code does not support', () => {
  const wrong = GENERATORS
    .map((r) => ({ file: r.file, claimed: r.state, actual: derivedState(r, ROOT) }))
    .filter((x) => x.claimed !== x.actual)
  assert.deepEqual(wrong, [],
    'these records disagree with the source:\n    '
    + wrong.map((w) => `${w.file}: says ${w.claimed}, code says ${w.actual}`).join('\n    '))
})

test('a generator that gains a reservation cannot stay recorded as unmigrated', () => {
  // The same assertion read from the other side, stated separately because it
  // is the one that keeps the inventory honest AS the phase progresses. The
  // check above would catch it, but a future edit that relaxes it would not
  // obviously be relaxing this.
  for (const r of GENERATORS.filter((x) => x.state === 'unmigrated')) {
    const scan = scanFile(join(ROOT, r.file), ROOT)
    assert.equal(scan.idempotency, 'none',
      `${r.file} now reserves an operation but is still recorded as unmigrated — update its record`)
  }
})

console.log('\n— the contract is binding —')

test('every generator recorded as migrated satisfies every clause', () => {
  for (const r of GENERATORS.filter((x) => x.state === 'migrated')) {
    const failures = checkContract(r, ROOT)
    assert.deepEqual(failures, [],
      `${r.file} claims migrated but fails: ${failures.map((f) => f.id).join(', ')}`)
  }
})

test('the contract REFUSES a reservation that can be skipped', () => {
  // The clause that makes this inventory worth writing. Without it, the five
  // #1861 generators would read as finished while a keyless request still
  // takes the unprotected path.
  const clause = CLAUSES.find((c) => c.id === 'idempotency-enforced')
  assert.ok(clause, 'the idempotency-enforced clause must exist')
  assert.equal(clause.holds({ idempotency: 'optional' }), false)
  assert.equal(clause.holds({ idempotency: 'none' }), false)
  assert.equal(clause.holds({ idempotency: 'enforced' }), true)
})

test('every partial generator fails the contract for a NAMED reason', () => {
  // "Partial" has to be actionable. If a record sits in that state without the
  // contract being able to say which clause it misses, the state is decoration.
  for (const r of GENERATORS.filter((x) => x.state === 'partial')) {
    const failures = checkContract(r, ROOT)
    assert.ok(failures.length > 0, `${r.file} is recorded partial but passes every clause`)
    for (const f of failures) assert.ok(f.defends, `${r.file}: clause ${f.id} does not say what it defends`)
  }
})

test('exactly the generators believed migrated are migrated, named one by one', () => {
  // Pinned as a LIST rather than a count. When a migration PR lands, the author
  // has to write the new file in here — which is the moment to check that the
  // record, the contract and the behavioural tests all agree, rather than
  // discovering later that a count went up and nothing else did.
  //
  // Slice 2 closed the five `partial` generators from #1861. The completion
  // condition for that slice was exact: 6 migrated, 0 partial, 20 unmigrated.
  const migrated = GENERATORS.filter((r) => r.state === 'migrated').map((r) => r.file).sort()
  assert.deepEqual(migrated, [
    'functions/teacherTools/generateAssessment.js',
    'functions/teacherTools/generateFlashcards.js',
    'functions/teacherTools/generateHomework.js',
    'functions/teacherTools/generateNotes.js',
    'functions/teacherTools/generateRubric.js',
    'functions/teacherTools/generateSbaTask.js',
    'functions/teacherTools/generateSchemeOfWork.js',
    'functions/teacherTools/generateWorksheet.js',
    'functions/teacherTools/regenerateAssessmentQuestion.js',
  ])
})

test('no generator is left in the partial state', () => {
  // The state that motivated Slice 2. It is allowed to exist as a CONCEPT — a
  // future migration will pass through it — but a generator sitting there at
  // rest means a server guarantee that disappears when the client omits a key.
  const partial = GENERATORS.filter((r) => r.state === 'partial').map((r) => r.file)
  assert.deepEqual(partial, [], `still partial: ${partial.join(', ')}`)
})

console.log('\n— everyone who calls a migrated runner carries a key —')

test('no caller invokes a migrated generator without an idempotency key', () => {
  // The check that was missing when Slice 2 shipped. It hardened five
  // generators and broke Aria, who calls four of them directly and passed no
  // key — her worksheet, flashcards, rubric and scheme_of_work jobs failed
  // outright while the whole suite stayed green.
  //
  // The migration contract cannot catch this: it asks what a generator does,
  // and the break was in something the generator does not know exists.
  const violations = []
  for (const r of GENERATORS.filter((x) => x.state === 'migrated')) {
    const source = readFileSync(join(ROOT, r.file), 'utf8')
    const runner = exportedRunnerName(source)
    if (!runner) continue
    for (const call of findRunnerCallers(ROOT, runner, r.file)) {
      if (call.carriesKey) continue
      if (call.forwardsAnObject && VERIFIED_FORWARDERS[call.file]) continue
      violations.push(`${call.file}:${call.line} calls ${runner}() with no idempotencyKey`)
    }
  }
  assert.deepEqual(violations, [],
    `these callers would be REFUSED at the reservation:\n    ${violations.join('\n    ')}\n`
    + '  A server-side caller with no browser should derive a stable key — see\n'
    + '  agentJobIdempotencyKey() in functions/aiOperationsCore.js.')
})

console.log('\n— what the phase is actually facing —')

test('the tiers cover every generator, in priority order', () => {
  const covered = [...byTier().values()].flat().length
  assert.equal(covered, GENERATORS.length,
    'a generator has a tier outside the declared set, so it would never be scheduled')
})

if (!process.exitCode) {
  const counts = stateCounts()
  const helpers = INVENTORY.filter((r) => r.class === CLASSES.helper).length
  const agents = INVENTORY.filter((r) => r.class === CLASSES.agent).length
  console.log(`\n  ${sites.length} direct model call sites under functions/`)
  console.log(`  ${GENERATORS.length} generators — `
    + `${counts.migrated} migrated, ${counts.partial} partial, ${counts.unmigrated} unmigrated`)
  console.log(`  ${agents} agents and ${helpers} helpers are out of scope for the contract`)
  for (const [tier, records] of byTier()) {
    const remaining = records.filter((r) => r.state !== 'migrated').length
    console.log(`    tier ${tier} · ${TIERS[tier]} — ${remaining}/${records.length} remaining`)
  }
  console.log(`\n✓ AI generator inventory — ${passed} tests passed`)
}
