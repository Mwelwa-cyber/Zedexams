// Learner Settings prefs — plain `node` assertion tests (no Firebase, no React).
// Run: node src/features/learnerSettings/lib/learnerPrefs.test.js
// Wired into test:all via the `test:learner-prefs` npm script.

import assert from 'node:assert/strict'
import {
  computeProfileCompletion,
  computeSecurityStrength,
  normalizeSecurityPrefs,
  normalizeLearningPrefs,
  normalizePersonalisation,
  normalizePrivacyPrefs,
  normalizeReminderPrefs,
  normalizeParentContact,
  normalizeLearnerSettings,
  REMINDER_GROUPS,
} from './learnerPrefs.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}`)
    throw err
  }
}

/* ── profile completion ── */
test('completion is 0% for an empty profile', () => {
  const { percent, missing } = computeProfileCompletion({})
  assert.equal(percent, 0)
  assert.ok(missing.includes('name'))
})

test('completion counts filled fields and reads nested recovery email', () => {
  const profile = {
    displayName: 'Chanda',
    school: 'Lusaka Academy',
    grade: 6,
    className: '6B',
    preferredLanguage: 'en',
    country: 'ZM',
    avatarCharacter: 'ruby',
    learnerSettings: { security: { recoveryEmail: 'p@x.com' } },
  }
  const { percent, missing } = computeProfileCompletion(profile)
  assert.equal(percent, 100)
  assert.deepEqual(missing, [])
})

test('completion ignores optional fields (dob/gender/preferredName)', () => {
  const base = {
    displayName: 'A', school: 'B', grade: 4, className: 'C',
    preferredLanguage: 'en', country: 'ZM', avatarPhotoUrl: 'data:...',
    learnerSettings: { security: { recoveryPhone: '0977' } },
  }
  assert.equal(computeProfileCompletion(base).percent, 100)
})

/* ── security strength ── */
test('security strength is weak with nothing set', () => {
  const s = computeSecurityStrength({ security: {}, emailVerified: false, hasPassword: false })
  assert.equal(s.level, 'weak')
  assert.equal(s.score, 0)
})

test('security strength is excellent with password + recovery + verified', () => {
  const s = computeSecurityStrength({
    security: { recoveryEmail: 'r@x.com' },
    emailVerified: true,
    hasPassword: true,
  })
  assert.equal(s.level, 'excellent')
  assert.equal(s.score, 3)
})

test('security strength is good with password + recovery only', () => {
  const s = computeSecurityStrength({
    security: { recoveryPhone: '0977' },
    emailVerified: false,
    hasPassword: true,
  })
  assert.equal(s.level, 'good')
})

/* ── normalizers default + coerce ── */
test('normalizeSecurityPrefs fills defaults', () => {
  const s = normalizeSecurityPrefs(undefined)
  assert.deepEqual(s, { recoveryEmail: '', recoveryPhone: '', twoFactorEnabled: false })
})

test('normalizeLearningPrefs keeps legacy keys and adds extended ones', () => {
  const lp = normalizeLearningPrefs({ soundEffects: false, quizDifficulty: 'hard' })
  assert.equal(lp.soundEffects, false)
  assert.equal(lp.showHints, true)
  assert.equal(lp.quizDifficulty, 'hard')
  assert.equal(lp.defaultQuizMode, 'practice')
})

test('normalizeLearningPrefs rejects an invalid enum value', () => {
  const lp = normalizeLearningPrefs({ quizDifficulty: 'nope', audioSpeed: '9' })
  assert.equal(lp.quizDifficulty, 'medium')
  assert.equal(lp.audioSpeed, '1')
})

test('normalizeLearningPrefs coerces + validates the daily goal', () => {
  assert.equal(normalizeLearningPrefs({}).dailyGoal, 20)
  assert.equal(normalizeLearningPrefs({ dailyGoal: 45 }).dailyGoal, 45)
  assert.equal(normalizeLearningPrefs({ dailyGoal: '30' }).dailyGoal, 30)
  assert.equal(normalizeLearningPrefs({ dailyGoal: 999 }).dailyGoal, 20)
})

test('normalizePersonalisation defaults are theme-neutral', () => {
  const p = normalizePersonalisation(null)
  assert.equal(p.accent, 'default')
  assert.equal(p.cardStyle, 'rounded')
  assert.equal(p.navStyle, 'sidebar')
})

test('normalizePrivacyPrefs defaults + visibility enum', () => {
  const pv = normalizePrivacyPrefs({ profileVisibility: 'invalid' })
  assert.equal(pv.profileVisibility, 'class')
  assert.equal(pv.analyticsParticipation, true)
})

test('normalizeReminderPrefs covers every group item key', () => {
  const r = normalizeReminderPrefs(undefined)
  const keys = REMINDER_GROUPS.flatMap((g) => g.items.map((i) => i.key))
  for (const k of keys) assert.equal(r.items[k], true)
  assert.deepEqual(r.channels, { push: true, email: true, sms: false })
})

test('normalizeReminderPrefs honours a stored false item', () => {
  const r = normalizeReminderPrefs({ items: { homework: false }, channels: { sms: true } })
  assert.equal(r.items.homework, false)
  assert.equal(r.items.dailyPractice, true)
  assert.equal(r.channels.sms, true)
})

test('normalizeParentContact defaults relationship to parent', () => {
  const pc = normalizeParentContact({ name: 'Mum' })
  assert.equal(pc.name, 'Mum')
  assert.equal(pc.relationship, 'parent')
})

test('normalizeLearnerSettings composes every sub-group', () => {
  const all = normalizeLearnerSettings({})
  assert.ok(all.security && all.personalisation && all.privacy)
})

console.log(`learnerPrefs.test.js — ${passed} passed`)
