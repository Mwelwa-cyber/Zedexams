/**
 * Plain-node tests for the sidebar collapse state rules.
 * Run: npm run test:sidebar-collapse
 */
import assert from 'node:assert/strict'
import {
  SIDEBAR_COLLAPSE_KEY,
  STORED_COLLAPSED,
  STORED_EXPANDED,
  parseStoredCollapsed,
  readStoredCollapsed,
  resolveInitialCollapsed,
  serializeCollapsed,
  writeStoredCollapsed,
} from './sidebarCollapseCore.js'

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  }
}

function throwingStorage() {
  return {
    getItem() { throw new Error('SecurityError: localStorage is disabled') },
    setItem() { throw new Error('QuotaExceededError') },
  }
}

/* ── parse: "never chosen" is its own answer ─────────────────────────── */

assert.equal(parseStoredCollapsed(STORED_COLLAPSED), true)
assert.equal(parseStoredCollapsed(STORED_EXPANDED), false)
// null, not false — the caller has to be able to tell "expanded" from
// "nothing stored", because the two resolve differently on a tablet.
assert.equal(parseStoredCollapsed(null), null)
assert.equal(parseStoredCollapsed(undefined), null)
assert.equal(parseStoredCollapsed(''), null)
assert.equal(parseStoredCollapsed('true'), null)
assert.equal(parseStoredCollapsed('{"collapsed":true}'), null)

assert.equal(serializeCollapsed(true), STORED_COLLAPSED)
assert.equal(serializeCollapsed(false), STORED_EXPANDED)
// Round-trips, so a value written can always be read back as itself.
assert.equal(parseStoredCollapsed(serializeCollapsed(true)), true)
assert.equal(parseStoredCollapsed(serializeCollapsed(false)), false)

/* ── resolve: stored choice outranks the viewport default ────────────── */

// Nothing stored: the width decides. Tablet starts as the rail, desktop as
// the full panel — which is exactly what each rendered before the toggle
// existed, so a teacher who never touches it sees no change.
assert.equal(resolveInitialCollapsed({ stored: null, railDefault: true }), true)
assert.equal(resolveInitialCollapsed({ stored: null, railDefault: false }), false)
assert.equal(resolveInitialCollapsed({}), false)
assert.equal(resolveInitialCollapsed(), false)

// A choice wins at every width, in BOTH directions: a tablet teacher who
// expanded the panel keeps it expanded, and a desktop teacher who collapsed
// it keeps the rail.
assert.equal(resolveInitialCollapsed({ stored: STORED_EXPANDED, railDefault: true }), false)
assert.equal(resolveInitialCollapsed({ stored: STORED_COLLAPSED, railDefault: false }), true)

// An unrecognised stored value is not a choice — fall back to the default
// rather than reading a stale/garbage entry as "expanded".
assert.equal(resolveInitialCollapsed({ stored: 'yes', railDefault: true }), true)

/* ── storage helpers survive a hostile localStorage ──────────────────── */

const store = fakeStorage()
assert.equal(readStoredCollapsed(store), null)
assert.equal(writeStoredCollapsed(store, true), true)
assert.equal(store.dump()[SIDEBAR_COLLAPSE_KEY], STORED_COLLAPSED)
assert.equal(readStoredCollapsed(store), STORED_COLLAPSED)
assert.equal(resolveInitialCollapsed({ stored: readStoredCollapsed(store), railDefault: false }), true)

writeStoredCollapsed(store, false)
assert.equal(readStoredCollapsed(store), STORED_EXPANDED)

// Private mode / disabled storage throws on access. Forgetting the preference
// is acceptable; taking the sidebar down with it is not.
const hostile = throwingStorage()
assert.equal(readStoredCollapsed(hostile), null)
assert.equal(writeStoredCollapsed(hostile, true), false)
assert.equal(readStoredCollapsed(null), null)
assert.equal(writeStoredCollapsed(null, true), false)
assert.equal(readStoredCollapsed(undefined), null)

console.log('✓ sidebarCollapseCore: all assertions passed')
