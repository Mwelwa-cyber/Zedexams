#!/usr/bin/env node
// scripts/test-ask-zed-core.mjs
//
// Pure decisions of the Ask Zed surface (learner redesign step 9):
// where the floating pill hides, and how the greeting + suggestion
// chips are built from name / grade / note-topic context.

import assert from 'node:assert/strict'
import {
  shouldHideFab, shouldHideFabForRole, buildAskZedIntro, firstNameOf,
} from '../src/features/zedChat/lib/askZedCore.js'

// ── shouldHideFab ────────────────────────────────────────────────────
// Visible on the four learner tabs + the surfaces the mockup keeps it on.
for (const p of ['/dashboard', '/papers', '/notes', '/notes/abc123', '/notes/reader-preview', '/games', '/timetable', '/search']) {
  assert.equal(shouldHideFab(p), false, `fab should SHOW on ${p}`)
}
// Hidden on focused/immersive surfaces (the mockup's fabHidden list).
for (const p of [
  '/', '/ask-zed', '/exam/x1', '/quiz/q1', '/results/r1',
  '/papers/p1', '/papers/p1/practice', '/papers/p1/quiz',
  '/lessons/l1', '/games/play/g1', '/games/duel', '/games/leaderboard',
  '/daily', '/daily/leaderboard', '/timetable/pdf',
  '/profile', '/settings', '/settings/profile', '/notifications',
  '/admin', '/admin/users', '/teacher', '/login', '/register', '/pricing',
  // The parent app. Hidden by route as well as by role, so an admin
  // viewing a family screen for support sees what the parent sees.
  '/family', '/family/children', '/family/account', '/family/plan',
]) {
  assert.equal(shouldHideFab(p), true, `fab should HIDE on ${p}`)
}

// ── shouldHideFabForRole ─────────────────────────────────────────────
// A parent never gets the pill, on any route: Ask Zed is metered against
// a LEARNER's allowance and prompted for a child.
assert.equal(shouldHideFabForRole('parent'), true)
// Everyone else keeps whatever the route rule says. An absent or unknown
// role must NOT hide it — a learner whose profile has not loaded yet
// would otherwise lose Ask Zed for the first frames of every session.
for (const role of ['learner', 'teacher', 'admin', 'superAdmin', '', null, undefined, 'Parent']) {
  assert.equal(shouldHideFabForRole(role), false, `role ${String(role)} should not hide the fab`)
}
// The hub/viewer split: /papers shows, /papers/<id> hides.
assert.equal(shouldHideFab('/papers'), false)
assert.equal(shouldHideFab('/papers/'), true)

// ── firstNameOf ──────────────────────────────────────────────────────
assert.equal(firstNameOf('Milton Banda'), 'Milton')
assert.equal(firstNameOf('  Chanda  '), 'Chanda')
assert.equal(firstNameOf(''), '')
assert.equal(firstNameOf(null), '')

// ── buildAskZedIntro ─────────────────────────────────────────────────
// Default: personalised with name + grade.
{
  const r = buildAskZedIntro({ firstName: 'Milton', grade: 7 })
  assert.ok(r.intro.startsWith('Hi Milton! 👋'), r.intro)
  assert.ok(r.intro.includes('Grade 7'), 'grade folded into the greeting')
  assert.equal(r.topic, null)
  assert.equal(r.chips.length, 3)
}
// No name, no grade: still warm, never "Grade NaN" / "Grade 0".
{
  const r = buildAskZedIntro({})
  assert.ok(r.intro.startsWith('Hi! 👋'), r.intro)
  assert.ok(!r.intro.includes('NaN'))
  assert.ok(r.intro.includes('school topics'), r.intro)
  const r0 = buildAskZedIntro({ grade: 0 })
  assert.ok(r0.intro.includes('school topics'), 'grade 0 falls back to school')
}
// Note context (the reader's "Stuck? Ask Zed about this" pill).
{
  const r = buildAskZedIntro({ firstName: 'Chanda', grade: 6, topic: 'Conjunctions — Joining Words' })
  assert.ok(r.intro.includes("You're learning Conjunctions — Joining Words"), r.intro)
  assert.equal(r.topic, 'Conjunctions — Joining Words')
  assert.equal(r.chips[0], 'Explain Conjunctions — Joining Words simply')
  assert.ok(r.chips.includes('Give me an example'))
  assert.ok(r.chips.includes('Why does it matter in the exam?'))
}
// Whitespace-only topic is no topic.
{
  const r = buildAskZedIntro({ topic: '   ' })
  assert.equal(r.topic, null)
}

console.log('✓ ask-zed core: fab visibility + intro/chips all pass')
