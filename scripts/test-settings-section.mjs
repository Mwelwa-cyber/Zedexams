#!/usr/bin/env node
// scripts/test-settings-section.mjs
//
// Which settings section a /settings URL opens.
//
// The regression: `/settings?section=notifications` opened Profile. The
// page read `?tab=` and nothing else, so the parameter every other part
// of the product writes was ignored — silently, which is the part that
// made it expensive. The parent app's "Email and push alerts" row linked
// there and a guardian landed on a profile form.

import assert from 'node:assert/strict'
import {
  SECTION_PARAM,
  LEGACY_TAB_PARAM,
  SECTION_TO_TAB,
  applySettingsTabToParams,
  resolveSettingsTab,
} from '../src/features/accountSettings/lib/settingsSection.js'

// The three role tab lists, copied from zedexams-settings.jsx. Copied on
// purpose: this test asserts the RESOLVER, and importing the page would
// pull in React, Firebase and the DOM to check a string lookup.
const TABS = {
  admin: ['security', 'notifications', 'accessibility', 'appearance', 'account'],
  teacher: ['school', 'notifications', 'accessibility', 'appearance', 'account'],
  learner: ['profile', 'security', 'notifications', 'learning', 'accessibility', 'parent', 'account'],
}
const asTabs = (ids) => ids.map((id) => ({ id }))

// ── The bug ──────────────────────────────────────────────────────────
for (const role of Object.keys(TABS)) {
  assert.equal(
    resolveSettingsTab({ section: 'notifications', tabs: asTabs(TABS[role]) }),
    'notifications',
    `?section=notifications must open Notifications for ${role}`,
  )
}

// ── The legacy spelling still works ──────────────────────────────────
assert.equal(resolveSettingsTab({ tab: 'school', tabs: asTabs(TABS.teacher) }), 'school')
// …and outranks a section that arrived with it, because `?tab=` is the
// one already sitting in links out in the world.
assert.equal(
  resolveSettingsTab({ tab: 'school', section: 'notifications', tabs: asTabs(TABS.teacher) }),
  'school',
)
// A `?tab=` this role does not have is not honoured just for being first.
assert.equal(
  resolveSettingsTab({ tab: 'school', section: 'notifications', tabs: asTabs(TABS.learner) }),
  'notifications',
)

// ── The alias, and the raw fallback behind it ────────────────────────
// "My Account" means personal details, which this page calls Profile.
assert.equal(resolveSettingsTab({ section: 'account', tabs: asTabs(TABS.learner) }), 'profile')
// An admin has no Profile tab, so the raw id resolves against their own
// Account tab rather than the request failing.
assert.equal(resolveSettingsTab({ section: 'account', tabs: asTabs(TABS.admin) }), 'account')

// ── Nothing asked for, or nothing this role has ──────────────────────
for (const section of ['progress', 'ai', 'premium', 'help', 'nonsense', '', '   ', null, undefined]) {
  assert.equal(
    resolveSettingsTab({ section, tabs: asTabs(TABS.learner) }),
    null,
    `section ${String(section)} should resolve to nothing, not to a guess`,
  )
}
assert.equal(resolveSettingsTab({ tabs: [] }), null)
assert.equal(resolveSettingsTab(), null)

// Sections with no tab are recorded as null rather than being absent, so
// "we decided this has no tab" reads differently from "nobody checked".
for (const id of ['progress', 'ai', 'premium', 'help']) {
  assert.ok(id in SECTION_TO_TAB, `${id} should be recorded in SECTION_TO_TAB`)
  assert.equal(SECTION_TO_TAB[id], null)
}

// ── Writing the URL back ─────────────────────────────────────────────
// Switching tabs writes the canonical parameter and drops the legacy one,
// so the two cannot disagree on the next render — which would otherwise
// pin the page to the tab a stale `?tab=` names.
{
  const params = new URLSearchParams('tab=school&other=keep')
  applySettingsTabToParams(params, 'notifications')
  assert.equal(params.get(SECTION_PARAM), 'notifications')
  assert.equal(params.get(LEGACY_TAB_PARAM), null)
  assert.equal(params.get('other'), 'keep', 'unrelated params must survive')
}
{
  const params = new URLSearchParams('section=notifications')
  applySettingsTabToParams(params, null)
  assert.equal(params.get(SECTION_PARAM), null)
}

// A written URL round-trips: what the page writes, the page reads back.
{
  const params = new URLSearchParams()
  applySettingsTabToParams(params, 'learning')
  assert.equal(
    resolveSettingsTab({
      tab: params.get(LEGACY_TAB_PARAM),
      section: params.get(SECTION_PARAM),
      tabs: asTabs(TABS.learner),
    }),
    'learning',
  )
}

console.log('✓ settings section: ?section= deep links resolve, ?tab= still honoured, URL round-trips')
