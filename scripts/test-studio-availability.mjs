/**
 * studioAvailability — the gate that decides whether a teacher studio is still
 * offered. Both flag states are asserted, because the whole claim of §2 is
 * that Worksheet Studio comes back intact when the flag is flipped: a test
 * that only proved it was hidden would pass just as happily against a
 * deletion.
 */
import assert from 'node:assert/strict'
import {
  UNAVAILABLE_STUDIOS,
  RETIRED_NOTICE_PARAM,
  filterAvailableEntries,
  gatedToolForRoute,
  isRouteAvailable,
  isToolAvailable,
  noticeForTool,
  redirectTargetForTool,
  retiredLabelForTool,
} from '../src/config/studioAvailability.js'

const ON = { worksheetStudioEnabled: true }
const OFF = { worksheetStudioEnabled: false }

// ── Rubric: retired, with no way back ───────────────────────────────────────
for (const flags of [undefined, {}, OFF, ON, { rubricStudioEnabled: true }]) {
  assert.equal(isToolAvailable('rubric', flags), false,
    'Rubric Studio is retired — no flag state may re-open it')
}
assert.equal(isRouteAvailable('/teacher/generate/rubric', ON), false)
assert.equal(retiredLabelForTool('rubric', ON), 'Rubric (retired tool)')
assert.equal(noticeForTool('rubric'), 'This tool is no longer available.')

// ── Worksheet: withdrawn, and genuinely restorable ──────────────────────────
assert.equal(isToolAvailable('worksheet', undefined), false, 'no settings yet → hidden')
assert.equal(isToolAvailable('worksheet', {}), false, 'flag absent → hidden (default off)')
assert.equal(isToolAvailable('worksheet', OFF), false)
assert.equal(isToolAvailable('worksheet', ON), true, 'flag on → the studio is back')
assert.equal(isRouteAvailable('/teacher/generate/worksheet', ON), true)
assert.equal(isRouteAvailable('/teacher/generate/worksheet', OFF), false)
assert.equal(retiredLabelForTool('worksheet', OFF), 'Worksheet (tool returning soon)')
assert.equal(retiredLabelForTool('worksheet', ON), null,
  'an available tool labels its documents with nothing')

// A truthy-but-not-true flag value must not open the studio: `settings/global`
// is hand-editable JSON in the admin console, and 'true' is a string there.
assert.equal(isToolAvailable('worksheet', { worksheetStudioEnabled: 'true' }), false)
assert.equal(isToolAvailable('worksheet', { worksheetStudioEnabled: 1 }), false)

// ── Everything else is untouched ────────────────────────────────────────────
for (const tool of ['homework', 'lesson_plan', 'notes', 'assessment', 'flashcards']) {
  assert.equal(isToolAvailable(tool, undefined), true, `${tool} is not gated`)
}
assert.equal(isRouteAvailable('/teacher/generate/homework', undefined), true)
assert.equal(isRouteAvailable(undefined, undefined), true, 'no destination → nothing to gate')

// ── Route matching survives the shapes the entry points actually store ──────
assert.equal(gatedToolForRoute('/teacher/generate/worksheet'), 'worksheet')
assert.equal(gatedToolForRoute('/teacher/generate/worksheet?grade=5&subject=maths'), 'worksheet')
assert.equal(gatedToolForRoute('/teacher/generate/worksheet/'), 'worksheet')
assert.equal(gatedToolForRoute('/teacher/generate/homework'), null)
// Not a prefix match: a future /teacher/generate/worksheet-bank would be its
// own tool, and silently hiding it would be a bug nobody could see.
assert.equal(gatedToolForRoute('/teacher/generate/worksheet-bank'), null)

// ── Filtering a navigation list ─────────────────────────────────────────────
const TILES = [
  { id: 'lesson-plan', to: '/teacher/lesson-plans/new' },
  { id: 'worksheet', to: '/teacher/generate/worksheet' },
  { id: 'rubric', to: '/teacher/generate/rubric' },
  { id: 'homework', to: '/teacher/generate/homework' },
]
assert.deepEqual(filterAvailableEntries(TILES, OFF).map((t) => t.id), ['lesson-plan', 'homework'])
assert.deepEqual(filterAvailableEntries(TILES, ON).map((t) => t.id),
  ['lesson-plan', 'worksheet', 'homework'], 'the flag restores the tile, not just the route')

const REGISTRY = [
  { id: 'worksheets', route: '/teacher/generate/worksheet' },
  { id: 'notes', route: '/teacher/generate/notes' },
]
assert.deepEqual(filterAvailableEntries(REGISTRY, OFF, 'route').map((s) => s.id), ['notes'])
assert.deepEqual(filterAvailableEntries(REGISTRY, ON, 'route').map((s) => s.id),
  ['worksheets', 'notes'])
assert.equal(filterAvailableEntries(null, OFF), null, 'a non-list passes through untouched')

// ── The redirect target carries the notice ──────────────────────────────────
assert.equal(redirectTargetForTool('rubric'), `/teacher?${RETIRED_NOTICE_PARAM}=rubric`)
assert.equal(redirectTargetForTool('worksheet'), `/teacher?${RETIRED_NOTICE_PARAM}=worksheet`)

// ── Every declared studio is internally consistent ──────────────────────────
for (const [tool, def] of Object.entries(UNAVAILABLE_STUDIOS)) {
  assert.equal(def.tool, tool, 'keyed by its own tool id')
  assert.ok(def.route.startsWith('/teacher/'), 'gated routes are teacher routes')
  assert.ok(def.notice && def.libraryLabel, 'a hidden tool must explain itself')
  assert.ok(['retired', 'withdrawn'].includes(def.status))
  assert.equal(def.status === 'retired', def.flag === null,
    'a retired studio has no flag; a withdrawn one must have one')
}

console.log('✓ studio availability')
