/**
 * guardianContactCore — the ways a guardian contact goes wrong in the field.
 *
 * Written against the failures, not the happy path:
 *
 *   • a Zambian number typed six different ways by six different children
 *   • a child entering their own address and approving themselves
 *   • one mistyped digit, noticed thirty seconds later, with Resend the only
 *     way out
 *   • a resend button used as a way to bury somebody's inbox
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 * Run: node functions/shared/consent/guardianContactCore.test.js
 */

import assert from 'node:assert/strict'
import {
  CONTACT_CHANNEL,
  CONTACT_REJECTION,
  DEFAULT_CONTACT_CHANNEL,
  BURST_WINDOW_MS,
  MAX_SENDS_PER_CONTACT,
  MAX_SENDS_TOTAL,
  RESEND_LADDER_MS,
  SEND_REFUSAL,
  contactMatchesLearner,
  describeWait,
  displayContact,
  normalizeGuardianContact,
  resolveSendDecision,
  toE164,
} from './guardianContactCore.js'

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

console.log('guardianContactCore — channel default')

test('WhatsApp is the default channel', () => {
  // Not a preference. Email-only was the funnel's worst drop-off point
  // because plenty of Zambian guardians have no inbox they check.
  assert.equal(DEFAULT_CONTACT_CHANNEL, CONTACT_CHANNEL.WHATSAPP)
})

test('an unknown channel falls back to the deliverable one, not to nothing', () => {
  const r = normalizeGuardianContact({ contact: '0977123456', channel: 'carrier-pigeon' })
  assert.equal(r.ok, true)
  assert.equal(r.channel, CONTACT_CHANNEL.WHATSAPP)
})

console.log('guardianContactCore — phone numbers as people type them')

test('every shape of one Zambian number normalises to the same E.164', () => {
  const shapes = [
    '0977123456', '0977 123 456', '0977-123-456', '(0977) 123456',
    '+260977123456', '+260 97 7123456', '260977123456', '00260977123456',
    '977123456', ' 0977123456 ',
  ]
  for (const shape of shapes) {
    assert.equal(toE164(shape), '+260977123456', `${shape} should be one number`)
  }
})

test('all three networks and the 07 range are accepted', () => {
  for (const n of ['0955123456', '0966123456', '0977123456', '0761234567', '0751234567']) {
    assert.notEqual(toE164(n), '', `${n} is a real Zambian mobile`)
  }
})

test('a number that cannot be Zambian is refused rather than padded', () => {
  // Every one of these used to reach the old /^\+?\d{9,15}$/ check, which
  // accepted anything with enough digits and sent a message into the void.
  for (const bad of ['12345', '0812345678', '0977 12345', '09771234567', 'mum', '', null, undefined]) {
    assert.equal(toE164(bad), '', `${JSON.stringify(bad)} must be refused`)
  }
})

test('a guardian in the diaspora is not locked out', () => {
  // We cannot validate the UK numbering plan; we can check it is plausible.
  assert.equal(toE164('+44 7700 900123'), '+447700900123')
  assert.equal(toE164('+1 (202) 555-0143'), '+12025550143')
})

test('the number is shown back grouped, so a wrong digit is visible', () => {
  assert.equal(displayContact({ channel: CONTACT_CHANNEL.WHATSAPP, value: '+260977123456' }),
    '+260 977 123 456')
  // An unfamiliar country code is left exactly as normalised rather than
  // being grouped wrongly and reading as a typo.
  assert.equal(displayContact({ channel: CONTACT_CHANNEL.WHATSAPP, value: '+447700900123' }),
    '+447700900123')
})

console.log('guardianContactCore — email')

test('an email is lower-cased so it compares as one address', () => {
  const r = normalizeGuardianContact({ contact: '  Mum@Example.COM ', channel: 'email' })
  assert.equal(r.ok, true)
  assert.equal(r.value, 'mum@example.com')
  assert.equal(r.key, 'mum@example.com')
})

test('a refusal names a reason AND says what to do', () => {
  const r = normalizeGuardianContact({ contact: 'mum', channel: 'email' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, CONTACT_REJECTION.BAD_EMAIL)
  assert.match(r.message, /name@example\.com/)
  const empty = normalizeGuardianContact({ contact: '   ', channel: 'email' })
  assert.equal(empty.reason, CONTACT_REJECTION.EMPTY)
})

console.log('guardianContactCore — the learner\'s own contact')

test('a child cannot name themselves as their own grown-up', () => {
  const learner = { email: 'Lydia@example.com', phone: '0977123456' }
  const email = normalizeGuardianContact({ contact: 'lydia@EXAMPLE.com', channel: 'email' })
  assert.equal(contactMatchesLearner(email, learner), true)
  const phone = normalizeGuardianContact({ contact: '+260 977 123 456', channel: 'whatsapp' })
  assert.equal(contactMatchesLearner(phone, learner), true)
})

test('a real guardian contact is not mistaken for the child\'s', () => {
  const learner = { email: 'lydia@example.com', phone: '0977123456' }
  const email = normalizeGuardianContact({ contact: 'mum@example.com', channel: 'email' })
  assert.equal(contactMatchesLearner(email, learner), false)
  const phone = normalizeGuardianContact({ contact: '0966000111', channel: 'whatsapp' })
  assert.equal(contactMatchesLearner(phone, learner), false)
})

test('what the learner record does not carry cannot match', () => {
  // Learner docs carry an email and usually no phone. The check says what it
  // knows rather than guessing — a false match would refuse a real guardian.
  const phone = normalizeGuardianContact({ contact: '0977123456', channel: 'whatsapp' })
  assert.equal(contactMatchesLearner(phone, {}), false)
  assert.equal(contactMatchesLearner({}, { email: 'a@b.co' }), false)
})

console.log('guardianContactCore — how often a message may go')

test('the first message goes immediately', () => {
  const d = resolveSendDecision({ sendCount: 0, sendTotal: 0, lastSentAt: null, now: 1_000 })
  assert.equal(d.allowed, true)
  assert.equal(d.nextSendCount, 1)
})

test('a mistyped digit is recoverable in minutes, not tomorrow', () => {
  // The whole reason the flat 24-hour cooldown was wrong: the case Resend
  // exists for is a wrong number noticed straight away.
  const tooSoon = resolveSendDecision({ sendCount: 1, sendTotal: 1, lastSentAt: 0, now: 10 * 60_000 })
  assert.equal(tooSoon.allowed, false)
  assert.equal(tooSoon.reason, SEND_REFUSAL.TOO_SOON)
  assert.ok(tooSoon.waitMs > 0 && tooSoon.waitMs <= RESEND_LADDER_MS[1])

  const later = resolveSendDecision({ sendCount: 1, sendTotal: 1, lastSentAt: 0, now: RESEND_LADDER_MS[1] })
  assert.equal(later.allowed, true)
})

test('the wait grows with each message, and every rung is reachable', () => {
  let previous = -1
  for (const wait of RESEND_LADDER_MS) {
    assert.ok(wait >= previous, 'the ladder must never get shorter')
    previous = wait
  }
  // A last rung EQUAL to the burst window would hide the per-contact ceiling
  // behind the reset — the limit would exist and never bind.
  assert.ok(previous < BURST_WINDOW_MS, 'the last rung must sit inside the burst window')
})

test('a child cannot bury one inbox by holding the button', () => {
  const spent = resolveSendDecision({
    sendCount: MAX_SENDS_PER_CONTACT, sendTotal: MAX_SENDS_PER_CONTACT, lastSentAt: 0, now: 60_000,
  })
  assert.equal(spent.allowed, false)
  assert.equal(spent.reason, SEND_REFUSAL.CONTACT_EXHAUSTED)
})

test('changing the number is not an unlimited send button with a tap in front', () => {
  const fresh = resolveSendDecision({
    sendCount: 0, sendTotal: MAX_SENDS_TOTAL, lastSentAt: 0, contactChanged: true, now: 60_000,
  })
  assert.equal(fresh.allowed, false)
  assert.equal(fresh.reason, SEND_REFUSAL.TOTAL_EXHAUSTED)
  assert.ok(MAX_SENDS_TOTAL > MAX_SENDS_PER_CONTACT, 'a corrected number must still be reachable')
})

test('a corrected number goes out immediately', () => {
  const d = resolveSendDecision({ sendCount: 4, sendTotal: 4, lastSentAt: 1, contactChanged: true, now: 2 })
  assert.equal(d.allowed, true, "the wait the wrong number earned is not the right one's to serve")
  assert.equal(d.nextSendCount, 1, 'and the ladder starts again for the new contact')
  assert.equal(d.nextSendTotal, 5, 'while the total carries on counting')
})

test('the caps bound a burst, never a lifetime', () => {
  // A child six weeks later whose guardian never answered must still be able
  // to ask. A lifetime total leaves them permanently unable to, on a screen
  // whose entire purpose is asking.
  const spent = { sendCount: MAX_SENDS_PER_CONTACT, sendTotal: MAX_SENDS_TOTAL, lastSentAt: 0 }
  assert.equal(resolveSendDecision({ ...spent, now: BURST_WINDOW_MS - 1 }).allowed, false)
  const afterQuiet = resolveSendDecision({ ...spent, now: BURST_WINDOW_MS })
  assert.equal(afterQuiet.allowed, true)
  // And the counters START AGAIN — a caller incrementing the stale ones would
  // re-impose the wait this decision just expired.
  assert.equal(afterQuiet.nextSendCount, 1)
  assert.equal(afterQuiet.nextSendTotal, 1)
})

test('a refusal always says how long, so the screen can name it', () => {
  for (const args of [
    { sendCount: 1, sendTotal: 1, lastSentAt: 0, now: 1 },
    { sendCount: MAX_SENDS_PER_CONTACT, sendTotal: MAX_SENDS_PER_CONTACT, lastSentAt: 0, now: 1 },
    { sendCount: 0, sendTotal: MAX_SENDS_TOTAL, lastSentAt: 0, contactChanged: true, now: 1 },
  ]) {
    const d = resolveSendDecision(args)
    assert.equal(d.allowed, false)
    assert.ok(d.waitMs > 0, `${d.reason} must say when`)
  }
})

test('missing or nonsense counters fail on the side of letting a child ask', () => {
  assert.equal(resolveSendDecision({}).allowed, true)
  const d = resolveSendDecision({ sendCount: Number.NaN, sendTotal: -4, lastSentAt: 'soon', now: 0 })
  assert.equal(d.allowed, true, 'an unreadable counter must not lock a child out of asking at all')
})

test('the wait is described to a child, and never invites a refused retry', () => {
  assert.equal(describeWait(0), 'now')
  assert.equal(describeWait(60 * 1000), '1 minute')
  assert.equal(describeWait(14.2 * 60 * 1000), '15 minutes')  // rounds UP
  assert.equal(describeWait(90 * 60 * 1000), '2 hours')
  assert.equal(describeWait(24 * 60 * 60 * 1000), 'a day')
})

console.log(`\n${passed} passed`)
if (process.exitCode) console.error('guardianContactCore: FAILED')
