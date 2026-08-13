/**
 * src/utils/passwordResetFallback.js — the rules deciding whether a failed
 * password-reset send gets a second attempt down an independent path, and
 * what the user is told.
 *
 * The property worth pinning hardest is the one that is invisible when it
 * breaks: the fallback must not answer questions the primary path refuses
 * to answer. A regression there leaks account existence and nothing about
 * the UI looks any different.
 */
import assert from 'node:assert/strict'
import {
  isBadEmailError,
  shouldTryFallback,
  isContinueUrlError,
  fallbackOutcome,
  resetContinueUrl,
  uniformResetReply,
} from '../src/utils/passwordResetFallback.js'

const err = (code) => Object.assign(new Error(code || 'boom'), code ? { code } : {})

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

test('bad input is named, and is the only thing that is', () => {
  assert.equal(isBadEmailError(err('functions/invalid-argument')), true)
  assert.equal(isBadEmailError(err('auth/invalid-email')), true)
  assert.equal(isBadEmailError(err('auth/missing-email')), true)
  // A delivery failure is not the user's typing.
  assert.equal(isBadEmailError(err('functions/internal')), false)
  assert.equal(isBadEmailError(err('auth/network-request-failed')), false)
})

test('bad input is never retried — no second path can fix a typo', () => {
  assert.equal(shouldTryFallback(err('functions/invalid-argument')), false)
  assert.equal(shouldTryFallback(err('auth/invalid-email')), false)
})

test('every OTHER failure falls through, including ones nobody predicted', () => {
  for (const code of [
    'functions/internal',
    'functions/unavailable',
    'functions/deadline-exceeded',
    'functions/resource-exhausted',
    'auth/network-request-failed',
    'some/code-that-does-not-exist-yet',
  ]) {
    assert.equal(shouldTryFallback(err(code)), true, code)
  }
  // A thrown value with no `code` at all — a raw network error — still falls
  // through. Deciding by allow-list would strand exactly this case.
  assert.equal(shouldTryFallback(new Error('Failed to fetch')), true)
})

test('nothing to retry when nothing failed', () => {
  assert.equal(shouldTryFallback(null), false)
  assert.equal(shouldTryFallback(undefined), false)
})

test('the fallback never reveals whether an account exists', () => {
  // The whole point of the uniform reply. If any of these ever returns
  // anything but 'ok', /login becomes an account-enumeration oracle.
  assert.equal(fallbackOutcome(err('auth/user-not-found')), 'ok')
  assert.equal(fallbackOutcome(err('auth/too-many-requests')), 'ok')
  assert.equal(fallbackOutcome(err('auth/quota-exceeded')), 'ok')
})

test('a genuine double outage is reported as a failure, not as success', () => {
  // The dangerous inversion: telling a locked-out user their mail is on its
  // way when both senders are down. They would wait instead of asking for
  // help.
  assert.equal(fallbackOutcome(err('functions/internal')), 'failed')
  assert.equal(fallbackOutcome(err('auth/internal-error')), 'failed')
  assert.equal(fallbackOutcome(new Error('Failed to fetch')), 'failed')
})

test('bad input surfaced by the fallback still gets named', () => {
  assert.equal(fallbackOutcome(err('auth/invalid-email')), 'bad-email')
})

test('a rejected continue URL is retried bare, other errors are not', () => {
  assert.equal(isContinueUrlError(err('auth/unauthorized-continue-uri')), true)
  assert.equal(isContinueUrlError(err('auth/invalid-continue-uri')), true)
  assert.equal(isContinueUrlError(err('auth/missing-continue-uri')), true)
  assert.equal(isContinueUrlError(err('auth/user-not-found')), false)
  assert.equal(isContinueUrlError(err('functions/internal')), false)
})

test('both paths land the user on the same page', () => {
  // Mirrors resolvePasswordResetContinueUrl in functions/index.js.
  assert.equal(resetContinueUrl('https://zedexams.com'), 'https://zedexams.com/login?reset=complete')
  assert.equal(resetContinueUrl('http://localhost:5173'), 'http://localhost:5173/login?reset=complete')
  // A trailing slash must not produce a double slash in the path.
  assert.equal(resetContinueUrl('https://zedexams.com/'), 'https://zedexams.com/login?reset=complete')
  // No origin (SSR / native shell) still yields a usable absolute URL.
  assert.equal(resetContinueUrl(''), 'https://zedexams.com/login?reset=complete')
  assert.equal(resetContinueUrl(undefined), 'https://zedexams.com/login?reset=complete')
})

test('the fallback reply is shaped like the callable reply', () => {
  // Login.jsx only branches on resolve-vs-reject, but any future caller
  // reading `.data.success` must not have to know which path answered.
  const reply = uniformResetReply('firebase-auth')
  assert.equal(reply.data.success, true)
  assert.equal(reply.data.via, 'firebase-auth')
  assert.match(reply.data.message, /If an account exists/)
})

test('the success message says nothing about the account', () => {
  for (const via of ['firebase-auth', 'suppressed']) {
    const { message } = uniformResetReply(via).data
    assert.ok(!/not found|no account|does not exist/i.test(message), via)
  }
})

console.log(`\npassword-reset fallback: ${passed} passed`)
