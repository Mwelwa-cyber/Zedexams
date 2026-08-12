#!/usr/bin/env node
/* global console, process */
/**
 * Regression tests for the Storage rules drift check (#2276).
 *
 * An admin was denied a read that storage.rules allows, and the Storage rules
 * emulator suite agreed with the repository -- so production had drifted from
 * git and nothing was watching. These tests pin the two things that make a
 * drift check worth having:
 *
 *   1. it fails on a real difference, and
 *   2. it does not fail on anything else.
 *
 * (2) is the harder half and most of what is below. deploy-hosting.yml waits
 * on deploy-firebase.yml, so a check that reds on a reformatted comment, a
 * renamed file, an API that reorders an array, or an API that simply did not
 * answer would strand the frontend over a non-problem. "We could not check"
 * is a third state here and stays one all the way to the exit code.
 *
 * Run: npm run test:storage-rules-drift  (also via npm run test:all)
 */
import {readFileSync} from 'node:fs'

import {
  EXIT,
  canonicalSource,
  compareRules,
  describeVerdict,
  effectiveSource,
  exitCodeFor,
  firstDifferingLine,
  readRulesetSource,
  selectStorageReleases,
  sourceDigest,
  unavailable,
  unreadable,
} from './storageRulesDrift.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({name, message: err.message})
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${expected}, got ${actual}`)
}

function assertSame(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  assert(a === e, `${label}: expected ${e}, got ${a}`)
}

// -- Fixtures ------------------------------------------------------------
//
// A miniature ruleset in the shape of the real one, plus the real file, so a
// change to either fails here rather than in production.

const RULES = [
  "rules_version = '2';",
  'service firebase.storage {',
  '  match /b/{bucket}/o {',
  '    // Papers: the owner, a teacher/admin, or an entitled reader.',
  '    // This is the rule #2276 was denied under.',
  '    match /papers/{ownerUid}/{fileName=**} {',
  '      allow read: if isVerified() && callerActive();',
  '      allow write: if ownsPath(ownerUid);',
  '    }',
  '  }',
  '}',
].join('\n')

const REPO_RULES = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8')

/** A firebaserules.googleapis.com ruleset payload. */
const ruleset = (content, name = 'storage.rules') => ({
  name: 'projects/examsprepzambia/rulesets/abc123',
  source: {files: [{name, content, fingerprint: 'not-compared'}]},
})

/** The deployed source, as the runner obtains it. */
const deployed = (payload) => {
  const read = readRulesetSource(payload)
  assert(read.ok, `fixture should be readable: ${read.reason}`)
  return read.source
}

const release = (product, bucket, id) => ({
  name: `projects/examsprepzambia/releases/${product}${bucket ? '/' + bucket : ''}`,
  rulesetName: `projects/examsprepzambia/rulesets/${id}`,
})

// -- It passes when production agrees with the repository -----------------

test('identical rules are a match', () => {
  const v = compareRules(RULES, deployed(ruleset(RULES)))
  assertEqual(v.status, 'match', 'status')
  assertEqual(v.line, null, 'line')
  assertEqual(v.repoDigest, v.deployedDigest, 'digests')
  assertEqual(exitCodeFor([v]), EXIT.ok, 'exit code')
})

test('the real storage.rules matches itself through the API shape', () => {
  const v = compareRules(REPO_RULES, deployed(ruleset(REPO_RULES)))
  assertEqual(v.status, 'match', 'status')
  assert(REPO_RULES.length > 1000, 'the real rules file should be substantial')
  assert(effectiveSource(REPO_RULES).length > 0, 'effective source should be non-empty')
})

test('a renamed deployed file is not drift -- a filename is not a rule', () => {
  const v = compareRules(RULES, deployed(ruleset(RULES, 'rules.txt')))
  assertEqual(v.status, 'match', 'status')
})

test('CRLF, trailing spaces and trailing blank lines are not drift', () => {
  const mangled = RULES.split('\n').map((line) => line + '   ').join('\r\n') + '\r\n\r\n\r\n'
  assertEqual(compareRules(RULES, mangled).status, 'match', 'status')
  assertEqual(canonicalSource('a  \r\nb\n\n\n'), 'a\nb', 'canonical form')
})

test('multiple files in one ruleset join in name order, not array order', () => {
  const forward = readRulesetSource({
    source: {files: [{name: 'a.rules', content: 'A'}, {name: 'b.rules', content: 'B'}]},
  })
  const reversed = readRulesetSource({
    source: {files: [{name: 'b.rules', content: 'B'}, {name: 'a.rules', content: 'A'}]},
  })
  assertEqual(forward.source, reversed.source, 'array order should not matter')
})

// -- It fails when production disagrees ----------------------------------

test('a changed allow expression is drift', () => {
  const tampered = RULES.replace('allow read: if isVerified() && callerActive();', 'allow read: if false;')
  const v = compareRules(RULES, deployed(ruleset(tampered)))
  assertEqual(v.status, 'mismatch', 'status')
  assertEqual(v.line, 7, 'first differing line')
  assert(v.repoDigest !== v.deployedDigest, 'digests should differ')
  assertEqual(exitCodeFor([v]), EXIT.drift, 'exit code')
})

test('a removed match block is drift', () => {
  const tampered = RULES.replace('      allow write: if ownsPath(ownerUid);\n', '')
  assertEqual(compareRules(RULES, tampered).status, 'mismatch', 'status')
})

test('an added allow is drift, not a cosmetic difference', () => {
  const tampered = RULES.replace('allow write: if ownsPath(ownerUid);', 'allow write: if true;')
  assertEqual(compareRules(RULES, tampered).status, 'mismatch', 'status')
})

// -- Cosmetic differences are reported, not fatal ------------------------

test('a comment-only edit is cosmetic, not drift', () => {
  const recommented = RULES.replace('// This is the rule #2276 was denied under.', '// Reworded by hand.')
  const v = compareRules(RULES, recommented)
  assertEqual(v.status, 'cosmetic', 'status')
  assertEqual(v.repoDigest, v.deployedDigest, 'effective digests should match')
  assertEqual(v.line, 5, 'first differing line')
  assertEqual(exitCodeFor([v]), EXIT.ok, 'cosmetic must not fail the job')
})

test('a doubled indent is cosmetic', () => {
  const reindented = RULES.replace(/^ {2}/gm, '    ')
  assertEqual(compareRules(RULES, reindented).status, 'cosmetic', 'status')
})

test('// inside a string literal is rule text, not a comment', () => {
  const withPath = "allow read: if request.resource.name == 'a" + "//b'; // a real comment"
  const eff = effectiveSource(withPath)
  assert(!eff.includes('a real comment'), 'the trailing comment should be stripped')
  assert(eff.includes("'a" + "//b'"), 'the string literal must survive intact')
})

test('a block comment is stripped without joining the tokens around it', () => {
  assertEqual(effectiveSource('allow /* why */ read'), 'allow read', 'effective source')
})

// -- "We could not check" is not "they differ" ---------------------------

test('a malformed API response is unreadable, not drift', () => {
  const shapes = [null, {}, {source: {}}, {source: {files: []}}, {source: {files: [{name: 'x'}]}}]
  for (const shape of shapes) {
    const read = readRulesetSource(shape)
    assertEqual(read.ok, false, `shape ${JSON.stringify(shape)} should not be readable`)
    assert(typeof read.reason === 'string' && read.reason.length > 0, 'a reason is required')
    const v = unreadable(read.reason)
    assertEqual(exitCodeFor([v]), EXIT.unknown, 'exit code')
    assert(exitCodeFor([v]) !== EXIT.drift, 'unreadable must never be reported as drift')
  }
})

test('a ruleset that could not be retrieved is unavailable, not drift', () => {
  const v = unavailable('HTTP 503 from the Rules API')
  assertEqual(v.status, 'unavailable', 'status')
  assertEqual(exitCodeFor([v]), EXIT.unknown, 'exit code')
  assert(EXIT.unknown !== EXIT.drift, 'unknown and drift must be different exit codes')
  assert(EXIT.unknown !== EXIT.ok, 'unknown must not look like a clean run')
})

test('no storage release at all is unknown, not clean', () => {
  const found = selectStorageReleases({releases: [release('cloud.firestore', null, 'fs1')]})
  assertSame(found, [], 'firestore is not a storage release')
  assertEqual(exitCodeFor([]), EXIT.unknown, 'nothing checked is not a pass')
})

test('drift outranks unknown when both are present', () => {
  const mixed = [unavailable('timeout'), compareRules(RULES, 'service firebase.storage {}')]
  assertEqual(exitCodeFor(mixed), EXIT.drift, 'a proven mismatch is the more actionable finding')
})

// -- Every bucket, and only the storage ones -----------------------------

test('every storage bucket is checked, in a stable order', () => {
  const found = selectStorageReleases({
    releases: [
      release('firebase.storage', 'zed-uploads', 'r2'),
      release('cloud.firestore', null, 'fs1'),
      release('firebase.storage', 'examsprepzambia.appspot.com', 'r1'),
    ],
  })
  assertSame(
    found.map((r) => r.bucket),
    ['examsprepzambia.appspot.com', 'zed-uploads'],
    'buckets',
  )
  assertEqual(found[0].rulesetName, 'projects/examsprepzambia/rulesets/r1', 'ruleset for bucket 1')
  assertEqual(found.length, 2, 'a second bucket must not be silently dropped')
})

test('a release with no rulesetName is skipped rather than guessed at', () => {
  const found = selectStorageReleases({
    releases: [{name: 'projects/p/releases/firebase.storage/half-written'}],
  })
  assertSame(found, [], 'an incomplete release is not something to compare against')
})

test('a non-list releases payload yields nothing rather than throwing', () => {
  assertSame(selectStorageReleases(undefined), [], 'undefined')
  assertSame(selectStorageReleases({releases: 'nope'}), [], 'wrong type')
})

// -- Nothing printable carries production rules or credentials -----------

test('a verdict description carries digests and line numbers, never rule text', () => {
  const tampered = RULES.replace('allow read: if isVerified() && callerActive();', 'allow read: if false;')
  const msg = describeVerdict('examsprepzambia.appspot.com', compareRules(RULES, tampered))
  assert(msg.includes('DIFFER'), 'a mismatch should be unmistakable')
  assert(msg.includes('line 7'), 'the line number is the actionable part')
  assert(!msg.includes('allow'), 'no rule text')
  assert(!msg.includes('isVerified'), 'no rule text')
  assert(!msg.includes('Bearer'), 'no credential material')
})

test('a digest reveals nothing but equality', () => {
  const d = sourceDigest(REPO_RULES)
  assertEqual(d.length, 12, 'digest length')
  assert(/^[0-9a-f]+$/.test(d), 'digest should be hex')
  assert(!REPO_RULES.includes(d), 'a digest is not a slice of the source')
})

test('firstDifferingLine reports a number, not the differing text', () => {
  assertEqual(firstDifferingLine('a\nb\nc', 'a\nX\nc'), 2, 'middle line')
  assertEqual(firstDifferingLine('a\n', 'a\nb\n'), 2, 'appended line')
  assertEqual(firstDifferingLine('same', 'same'), null, 'no difference')
})

// -- Report ---------------------------------------------------------------
console.log('')
console.log(`--- ${pass + fail} tests - ${pass} passed - ${fail} failed ---`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  x ${f.name}\n    ${f.message}`))
  process.exit(1)
}
