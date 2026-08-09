/**
 * Route-derived sidebar active state.
 *
 * Run with plain `node` (npm run test:teacher-nav-active) — pure logic, no
 * DOM. The rendering side of it (aria-current on the right link, in both the
 * sidebar and the drawer) is covered by the component specs.
 */
import assert from 'node:assert/strict'
import {
  resolveActiveNavTarget,
  flattenNavItems,
  buildActiveMatcher,
} from './teacherNavActive.js'
import { TEACHER_NAV_GROUPS } from './dashboardV2Config.js'

const items = flattenNavItems(TEACHER_NAV_GROUPS)
const activeAt = (pathname) => resolveActiveNavTarget(pathname, items)

/* ── The deep links the whole thing exists for ─────────────────────── */

// The dashboard, and only the dashboard.
assert.equal(activeAt('/teacher'), '/teacher')
assert.equal(activeAt('/teacher/dashboard-preview'), '/teacher')

// A hard load of the studio's create route lights Lesson Plans, and so does
// editing a saved plan — the nav item points at /new but owns the family.
assert.equal(activeAt('/teacher/lesson-plans/new'), '/teacher/lesson-plans/new')
assert.equal(activeAt('/teacher/lesson-plans/abc123/edit'), '/teacher/lesson-plans/new')

// Schemes of Work stays lit while editing a scheme.
assert.equal(activeAt('/teacher/generate/scheme-of-work'), '/teacher/generate/scheme-of-work')
assert.equal(activeAt('/teacher/generate/scheme-of-work/s1/edit'), '/teacher/generate/scheme-of-work')

// Library and its detail pages.
assert.equal(activeAt('/teacher/library'), '/teacher/library')
assert.equal(activeAt('/teacher/library/doc-1'), '/teacher/library')

// Assessments, from the list and from a paper.
assert.equal(activeAt('/teacher/assessment-papers'), '/teacher/assessment-papers')
assert.equal(activeAt('/teacher/assessment-papers/p1/edit'), '/teacher/assessment-papers')

// Subscription now resolves inside the teacher area.
assert.equal(activeAt('/teacher/subscription'), '/teacher/subscription')

/* ── Longest match wins ────────────────────────────────────────────── */

// Two entries whose destinations are prefixes of one another: the more
// specific one has to win regardless of which is listed first. Plain
// first-match prefix testing gets this wrong half the time, and which half
// depends on array order — a bug that hides until someone reorders the menu.
const overlapping = [
  { label: 'Class List', to: '/teacher/register' },
  { label: 'Term Reports', to: '/teacher/register/reports' },
]
assert.equal(resolveActiveNavTarget('/teacher/register/reports', overlapping), '/teacher/register/reports')
assert.equal(
  resolveActiveNavTarget('/teacher/register/reports', [...overlapping].reverse()),
  '/teacher/register/reports',
)
assert.equal(resolveActiveNavTarget('/teacher/register/c1', overlapping), '/teacher/register')

// An activePrefix scores on the prefix that matched, not on the destination,
// so it cannot out-rank a genuinely deeper match.
const withPrefix = [
  { label: 'Lesson Plans', to: '/teacher/lesson-plans/new', activePrefix: '/teacher/lesson-plans' },
  { label: 'Plan Templates', to: '/teacher/lesson-plans/templates' },
]
assert.equal(
  resolveActiveNavTarget('/teacher/lesson-plans/templates', withPrefix),
  '/teacher/lesson-plans/templates',
)

/* ── Exactness rules ───────────────────────────────────────────────── */

// Settings is exact, so Profile (/settings/profile) doesn't light both.
assert.equal(activeAt('/settings'), '/settings')
assert.equal(activeAt('/settings/profile'), '/settings/profile')
// A /settings panel with no nav entry of its own lights nothing rather than
// falling back to Settings.
assert.equal(activeAt('/settings/teaching-profile'), null)

// A near-miss must not match on string prefix alone: /teacher/register-preview
// is not inside /teacher/register.
assert.notEqual(activeAt('/teacher/register-preview'), '/teacher/register')

/* ── Nothing matches ───────────────────────────────────────────────── */

assert.equal(activeAt('/teacher/visual-studio'), null, 'a page with no nav entry lights nothing')
assert.equal(activeAt('/dashboard'), null, 'a learner route lights nothing')
assert.equal(resolveActiveNavTarget('/teacher', []), null, 'an empty menu has no active item')

/* ── Exactly one item is ever active ───────────────────────────────── */

const PATHS = [
  '/teacher', '/teacher/dashboard-preview', '/teacher/library', '/teacher/library/x',
  '/teacher/lesson-plans/new', '/teacher/lesson-plans/x/edit', '/teacher/assessment-papers',
  '/teacher/assessment-papers/x/edit',
  '/teacher/register', '/teacher/register/x/edit', '/teacher/attendance', '/teacher/syllabi',
  '/teacher/curriculum', '/teacher/curriculum/2013/primary', '/teacher/calendar',
  '/teacher/subscription', '/teacher/help', '/settings', '/settings/profile',
  '/teacher/generate/scheme-of-work', '/teacher/generate/weekly-forecast',
  '/teacher/generate/record-of-work',
]
for (const pathname of PATHS) {
  const isActive = buildActiveMatcher(pathname, TEACHER_NAV_GROUPS)
  const lit = items.filter((i) => isActive(i.to))
  assert.ok(lit.length <= 1, `${pathname} lit ${lit.length} nav items: ${lit.map((i) => i.label)}`)
}

// And no item is ever "stuck" lit: every path above that has an owner resolves
// to that owner and nothing else.
for (const pathname of PATHS) {
  const target = activeAt(pathname)
  if (!target) continue
  const isActive = buildActiveMatcher(pathname, TEACHER_NAV_GROUPS)
  assert.ok(isActive(target), `${pathname} should light ${target}`)
}

console.log('teacherNavActive: all assertions passed')
