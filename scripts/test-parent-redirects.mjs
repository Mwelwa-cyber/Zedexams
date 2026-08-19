#!/usr/bin/env node
// scripts/test-parent-redirects.mjs
//
// A parent session never renders a learner screen.
//
// The bug: /family/account → "Email and push alerts" navigated to
// /settings?section=notifications. That route renders ZedExamsSettings,
// which coerces any role outside ['admin','teacher','learner'] to
// `learner` — so a guardian got the learner top nav, a character-avatar
// picker built for children, and the heading "Signed in as Learner."
//
// The link is fixed, but a link is not the hole. A notification action, an
// old email, a bookmark or the next link somebody writes lands a parent on
// the same route. These assertions are about the ROUTE.

import assert from 'node:assert/strict'
import {
  PARENT_ROUTE_REDIRECTS,
  resolveParentRedirect,
} from '../src/app/guards/parentRedirects.js'

// ── The reported route, and its nested and query forms ───────────────
assert.equal(resolveParentRedirect('/settings'), '/family/account/alerts')
assert.equal(resolveParentRedirect('/settings?section=notifications'), '/family/account/alerts')
assert.equal(resolveParentRedirect('/settings/profile'), '/family/account/alerts')

// ── The others in the map ────────────────────────────────────────────
assert.equal(resolveParentRedirect('/my-subscription'), '/family/account/billing')
assert.equal(resolveParentRedirect('/subscription'), '/family/account/billing')
assert.equal(resolveParentRedirect('/profile'), '/family/account')
assert.equal(resolveParentRedirect('/dashboard'), '/family')
assert.equal(resolveParentRedirect('/notifications'), '/family/notifications')
assert.equal(resolveParentRedirect('/ask-zed'), '/family')
assert.equal(resolveParentRedirect('/ask-a-grown-up'), '/family/plan')

// ── Everything else renders as-is ────────────────────────────────────
// A guard that redirected what it did not recognise would trap a parent
// on /family for every public page — including the child-safety standards
// document their own account screen links to.
for (const path of [
  '/', '/family', '/family/children', '/family/account', '/child-safety',
  '/pricing', '/privacy', '/terms', '/login', '/papers', '/settingsomething',
]) {
  assert.equal(resolveParentRedirect(path), null, `${path} should render as-is`)
}

// A prefix must not match a different word that merely starts the same way.
assert.equal(resolveParentRedirect('/profiles'), null)
assert.equal(resolveParentRedirect('/dashboards'), null)

// ── Malformed input ──────────────────────────────────────────────────
for (const bad of ['', null, undefined, 42, {}]) {
  assert.equal(resolveParentRedirect(bad), null, `${String(bad)} should not redirect`)
}

// ── No redirect can bounce ───────────────────────────────────────────
// Every destination must itself resolve to null, or the guard would send a
// parent back and forth forever. This is the property that made the guard
// safe to mount above the whole route table rather than per route.
for (const [, to] of PARENT_ROUTE_REDIRECTS) {
  assert.equal(
    resolveParentRedirect(to), null,
    `${to} is a redirect destination and must not itself redirect`,
  )
}

// And every destination is under /family/, which is the whole point: the
// guardian lands on the screen that answers what they were asking, inside
// the shell that knows who they are.
for (const [, to] of PARENT_ROUTE_REDIRECTS) {
  assert.ok(to.startsWith('/family'), `${to} must be a family route`)
}

console.log('✓ parent redirects: learner routes resolve to family screens, and nothing bounces')
