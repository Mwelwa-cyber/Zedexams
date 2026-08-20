#!/usr/bin/env node
/**
 * The one password policy (src/utils/passwordPolicy.js).
 *
 * The case this file exists for is the third block: a password that ends in a
 * space was accepted at sign-up, and Firebase Auth stores it byte-for-byte, so
 * the account it minted could never be signed into. Nothing on the sign-in
 * screen can diagnose that — the owner types the password they meant and is
 * told it is wrong — so the only place it is fixable is the form that set it.
 *
 * The second thing pinned here is what is deliberately NOT refused: an
 * interior space. A passphrase is the strongest thing a learner will actually
 * remember, and a rule that banned "my dog rex" would be a weaker policy
 * dressed as a stricter one.
 *
 * Pure module → runs under plain `node`.
 * Run: node src/utils/passwordPolicy.test.js  (npm run test:password-policy)
 */
import assert from 'node:assert'
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_ISSUE,
  isAcceptablePassword,
  passwordIssue,
  passwordIssueCode,
} from './passwordPolicy.js'

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}
const code = (v) => passwordIssueCode(v)

// Escapes, never literal characters: a test for invisible characters that
// contained invisible characters could not be reviewed, and an editor that
// stripped one would turn the test green without changing the code.
const NBSP             = '\u00a0'
const ZWSP             = '\u200b'
const ZWNJ             = '\u200c'
const ZWJ              = '\u200d'
const WORD_JOINER      = '\u2060'
const BOM              = '\ufeff'
const IDEOGRAPHIC_SPACE = '\u3000'
const NARROW_NBSP      = '\u202f'
const LINE_SEP         = '\u2028'

console.log('\nan ordinary password passes')

ok('a plain password of the minimum length is accepted', () => {
  assert.strictEqual(code('abcdef'), null)
  assert.strictEqual(passwordIssue('abcdef'), '')
  assert.strictEqual(isAcceptablePassword('abcdef'), true)
})

ok('a strong mixed password is accepted', () => {
  assert.strictEqual(code('Zambia2026!'), null)
})

console.log('\ninterior spaces are ALLOWED — a passphrase is not a defect')

ok('a two-word passphrase is accepted', () => {
  assert.strictEqual(code('my dog rex'), null)
})

ok('several interior spaces are accepted', () => {
  assert.strictEqual(code('correct horse battery staple'), null)
})

ok('a run of interior spaces is still only interior', () => {
  assert.strictEqual(code('lusaka  2026'), null)
})

console.log('\nedge whitespace is REFUSED — this is the reported bug')

ok('a trailing space is refused', () => {
  assert.strictEqual(code('Zambia2026 '), PASSWORD_ISSUE.EDGE_WHITESPACE)
  assert.strictEqual(
    passwordIssue('Zambia2026 '),
    'Your password cannot start or end with a space.',
  )
})

ok('a leading space is refused', () => {
  assert.strictEqual(code(' Zambia2026'), PASSWORD_ISSUE.EDGE_WHITESPACE)
})

ok('a space at both ends is refused', () => {
  assert.strictEqual(code(' Zambia2026 '), PASSWORD_ISSUE.EDGE_WHITESPACE)
})

ok('an otherwise-valid passphrase with a trailing space is refused', () => {
  assert.strictEqual(code('my dog rex '), PASSWORD_ISSUE.EDGE_WHITESPACE)
})

ok('a trailing newline — what a paste from a text file carries — is refused', () => {
  assert.strictEqual(code('Zambia2026\n'), PASSWORD_ISSUE.EDGE_WHITESPACE)
})

console.log('\nwhitespace that cannot be seen is refused ANYWHERE')

ok('a tab in the middle is refused', () => {
  assert.strictEqual(code('abc\tdef'), PASSWORD_ISSUE.HIDDEN_WHITESPACE)
  assert.match(passwordIssue('abc\tdef'), /cannot be seen/)
})

ok('a non-breaking space is refused, though it looks exactly like a space', () => {
  assert.strictEqual(code(`abc${NBSP}def`), PASSWORD_ISSUE.HIDDEN_WHITESPACE)
})

ok('a narrow no-break space is refused', () => {
  assert.strictEqual(code(`abc${NARROW_NBSP}def`), PASSWORD_ISSUE.HIDDEN_WHITESPACE)
})

ok('an ideographic space is refused', () => {
  assert.strictEqual(code(`abc${IDEOGRAPHIC_SPACE}def`), PASSWORD_ISSUE.HIDDEN_WHITESPACE)
})

ok('a line separator is refused', () => {
  assert.strictEqual(code(`abc${LINE_SEP}def`), PASSWORD_ISSUE.HIDDEN_WHITESPACE)
})

ok('every zero-width character is refused, including the ones JS does not call \\s', () => {
  for (const ch of [ZWSP, ZWNJ, ZWJ, WORD_JOINER, BOM]) {
    assert.strictEqual(
      code(`abc${ch}def`),
      PASSWORD_ISSUE.HIDDEN_WHITESPACE,
      `expected U+${ch.codePointAt(0).toString(16).toUpperCase()} to be refused`,
    )
  }
})

console.log('\nempty and too short')

ok('an empty password reports EMPTY, in the same words as the required rule', () => {
  assert.strictEqual(code(''), PASSWORD_ISSUE.EMPTY)
  assert.strictEqual(passwordIssue(''), 'Please enter your password.')
})

ok('a password of nothing but spaces is empty, not "long enough"', () => {
  assert.strictEqual(code('        '), PASSWORD_ISSUE.EMPTY)
})

ok('a short password reports TOO_SHORT and names the minimum', () => {
  assert.strictEqual(code('abc'), PASSWORD_ISSUE.TOO_SHORT)
  assert.strictEqual(
    passwordIssue('abc'),
    `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`,
  )
})

ok('length is not padded to the minimum by spaces', () => {
  // 'ab' plus four spaces is six characters and must never read as six
  // characters of password.
  assert.notStrictEqual(code('ab    '), null)
})

console.log('\norder of report')

ok('whitespace is named before length, because length is the visible half', () => {
  // Both faults hold. Telling the user "too short" sends them counting
  // characters they can see while the fault they cannot see goes unmentioned.
  assert.strictEqual(code('ab '), PASSWORD_ISSUE.EDGE_WHITESPACE)
  assert.strictEqual(code('a\tb'), PASSWORD_ISSUE.HIDDEN_WHITESPACE)
})

console.log('\nnon-strings are refused, not crashed on')

ok('null, undefined, numbers and objects all read as empty', () => {
  for (const v of [null, undefined, 123456, {}, []]) {
    assert.strictEqual(code(v), PASSWORD_ISSUE.EMPTY)
    assert.strictEqual(isAcceptablePassword(v), false)
  }
})

console.log('\nthe minimum is declared, not scattered')

ok('MIN_PASSWORD_LENGTH is Firebase Auth’s floor of 6', () => {
  // Firebase rejects anything shorter server-side with auth/weak-password, so
  // a lower number here would only move the refusal somewhere less helpful.
  assert.strictEqual(MIN_PASSWORD_LENGTH, 6)
})

console.log(`\n${passed} passed`)
