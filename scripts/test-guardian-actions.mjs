#!/usr/bin/env node
// scripts/test-guardian-actions.mjs
//
// The guardian screens (/for-guardians, /for-guardians/request/:id) and the links that
// point at them.
//
// Two halves:
//   1. The pure copy/decision module — what a guardian is told before and after
//      approving a deletion or withdrawing consent.
//   2. A text-level guard that every URL the SERVER puts in front of a guardian
//      (notification action, email body) resolves to a declared route. The
//      deletion email used to say "Review the request" and link to
//      /family/requests/:id — a page that stopped existing when the parent app
//      closed — and nothing noticed, because a URL inside an email body is not
//      an import, a route, or a test.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROOT, appRoutePaths } from './lib/declaredRoutes.mjs'
import {
  canWithdraw, daysPhrase, linkState, linkStateLabel, requestView, statRows, withdrawalMessage,
} from '../src/features/parentPortal/lib/guardianActionsView.js'

// ── linkState: consent outranks status ────────────────────────────────
assert.equal(linkState({ status: 'active', consent: { state: 'withdrawn' } }), 'withdrawn')
assert.equal(linkState({ status: 'active', consent: { state: 'approved' } }), 'approved')
assert.equal(linkState({ status: 'active' }), 'approved', 'legacy link: active with no consent object')
assert.equal(linkState({ status: 'pending' }), 'pending')
assert.equal(linkState({ status: 'declined' }), 'declined')
assert.equal(linkState({}), 'unknown')
assert.equal(linkState(null), 'unknown')
for (const s of ['approved', 'withdrawn', 'pending', 'declined', 'unknown']) {
  assert.ok(linkStateLabel(s).length > 0)
}
assert.equal(canWithdraw('approved'), true)
for (const s of ['withdrawn', 'pending', 'declined', 'unknown']) assert.equal(canWithdraw(s), false)

// ── withdrawal copy is honest about a second guardian ─────────────────
assert.match(withdrawalMessage({ childName: 'Mwila', childStillApproved: true }), /still covered by another guardian/)
assert.match(withdrawalMessage({ childName: 'Mwila', childStillApproved: false }), /paused until a guardian approves again/)
assert.match(withdrawalMessage({ childName: '', childStillApproved: false }), /^Done\. Your child /)

// ── a missing tile is omitted, never shown as zero ────────────────────
assert.deepEqual(statRows({ streakDays: null, examReadiness: null, daysToExam: null }), [])
assert.deepEqual(statRows(undefined), [])
assert.equal(statRows({ streakDays: 4, examReadiness: 71, daysToExam: 12 }).length, 3)
assert.equal(statRows({ streakDays: 0 })[0].value, '0 days', 'a real zero the server chose to send is shown')

assert.equal(daysPhrase(0), 'today')
assert.equal(daysPhrase(1), 'in 1 day')
assert.equal(daysPhrase(5), 'in 5 days')
assert.equal(daysPhrase(-3), 'today', 'never a negative countdown')
assert.equal(daysPhrase(null), null)

// ── requestView: a stranger and a child both read "not found" ─────────
const base = (state, viewerIs = 'guardian') => ({ request: { state, viewerIs } })
assert.equal(requestView(null), 'not_found')
assert.equal(requestView({ request: null }), 'not_found')
assert.equal(requestView(base('pending_guardian', 'learner')), 'not_found')
assert.equal(requestView(base('pending_guardian')), 'decide')
assert.equal(requestView(base('scheduled')), 'scheduled')
assert.equal(requestView(base('declined')), 'declined')
assert.equal(requestView(base('cancelled')), 'cancelled')
assert.equal(requestView(base('escalated_support')), 'escalated')
assert.equal(requestView(base('completed')), 'completed')
assert.equal(requestView(base('mystery')), 'not_found')

// ── every URL the server shows a guardian resolves to a route ─────────
const routes = appRoutePaths()
const matches = (url) => routes.some((p) => {
  if (p === url) return true
  const re = new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*')}$`)
  return re.test(url)
})
const SERVER_FILES = [
  'functions/deletionFlow/index.js',
  'functions/guardianLink/guardianLinkDecisions.js',
]
for (const rel of SERVER_FILES) {
  const src = readFileSync(`${ROOT}/${rel}`, 'utf8')
  const urls = [
    ...[...src.matchAll(/url:\s*`([^`]+)`/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, 'x')),
    ...[...src.matchAll(/https:\/\/zedexams\.com(\/[^\s"`'<>)]*)/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, 'x')),
  ]
  assert.ok(urls.length > 0, `${rel}: no guardian-facing URL found — the scan has stopped seeing them`)
  for (const url of urls) {
    assert.ok(!url.startsWith('/family/') && url !== '/family',
      `${rel}: ${url} points at the closed parent app`)
    assert.ok(matches(url), `${rel}: ${url} matches no <Route> in App.jsx`)
  }
}

// Both guardian routes sit behind ProtectedRoute, and neither is learner-only.
const app = readFileSync(`${ROOT}/src/app/App.jsx`, 'utf8')
for (const path of ['/for-guardians', '/for-guardians/request/:requestId']) {
  const line = app.split('\n').find((l) => l.includes(`path="${path}"`))
  assert.ok(line, `${path} is not routed`)
  assert.match(line, /<ProtectedRoute>/, `${path} must require sign-in`)
  assert.doesNotMatch(line, /LearnerOnlyRoute/, `${path} is addressed to an account, not the learner portal`)
}

console.log('guardian actions: view logic, server links and routes all agree')
