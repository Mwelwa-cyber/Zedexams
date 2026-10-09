/**
 * Tests for scripts/cleanup-parent-portal.mjs — the one-off cleanup after the
 * logged-in parent app was retired.
 *
 * The script deletes production data and reports on production data, so each
 * decision in it is pinned:
 *
 *   • the DELETE list is exactly the two collections only the parent app could
 *     finish — and parentLinks (the consent record), users and
 *     accountDeletionRequests are NOT in it;
 *   • --collection= refuses a name outside the list instead of widening to all;
 *   • the deleting scans depend on no index, and the report's few queries are
 *     the single-field equality kind;
 *   • the report reads the field names the deletion flow actually writes —
 *     `state` and `learnerId`, not the `status`/`uid` it would be natural to
 *     guess (a wrong guess returns zero rows and reads as "nothing waiting");
 *   • link and share summaries classify the way the server does.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  PORTAL_COLLECTIONS, backupDocId, resolveCollections, summariseLinks, summariseShares,
} = await import('./cleanup-parent-portal.mjs')

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('cleanup-parent-portal')

test('the delete list is exactly the two parent-app-only collections', () => {
  assert.deepEqual([...PORTAL_COLLECTIONS].sort(), ['guardianInvites', 'guardianLinkClaims'])
})

test('parentLinks, users and accountDeletionRequests are never deletable', () => {
  // parentLinks is the consent record consentGuard still reads; users and
  // accountDeletionRequests are accounts and legal requests.
  for (const keep of ['parentLinks', 'users', 'accountDeletionRequests', 'progressShares', 'guardianRequests']) {
    assert.ok(!PORTAL_COLLECTIONS.includes(keep), `${keep} must not be in the delete list`)
    assert.deepEqual(resolveCollections(keep), [], `--collection=${keep} must resolve to nothing`)
  }
})

test('no --collection means the whole list; a name outside it means nothing', () => {
  assert.deepEqual(resolveCollections(null), PORTAL_COLLECTIONS)
  assert.deepEqual(resolveCollections(''), PORTAL_COLLECTIONS)
  assert.deepEqual(resolveCollections('guardianInvites'), ['guardianInvites'])
  assert.deepEqual(resolveCollections('GUARDIANINVITES'), [])
})

test('a backup id cannot collide across collections', () => {
  assert.notEqual(backupDocId('guardianInvites', 'abc'), backupDocId('guardianLinkClaims', 'abc'))
  assert.equal(backupDocId('guardianInvites', 'abc'), 'guardianInvites__abc')
})

const code = readFileSync(new URL('./cleanup-parent-portal.mjs', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

test('the deleting scans depend on no index', () => {
  assert.ok(!/\bcollectionGroup\s*\(/.test(code), 'a collectionGroup query needs an index nobody deployed')
  assert.ok(/orderBy\('__name__'\)/.test(code), 'paging must order by __name__')
  // Only the report may filter, and only with single-field equality.
  const wheres = [...code.matchAll(/\.where\s*\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' '))
  assert.deepEqual(wheres.sort(), ["'role', '==', 'parent'", "'state', '==', 'pending_guardian'"].sort())
})

test('the report reads the field names the deletion flow really writes', () => {
  const flow = readFileSync(new URL('../functions/deletionFlow/index.js', import.meta.url), 'utf8')
  const core = readFileSync(new URL('../functions/deletionFlow/deletionRequestCore.js', import.meta.url), 'utf8')
  assert.ok(/state: STATE\.PENDING_GUARDIAN/.test(core), 'requests carry their status in `state`')
  assert.ok(/request\?\.learnerId/.test(flow), 'requests name the learner in `learnerId`')
  assert.ok(/PENDING_GUARDIAN: "pending_guardian"/.test(core), "the pending value is 'pending_guardian'")
  assert.ok(/'accountDeletionRequests'/.test(code) && /d\.data\(\)\?\.learnerId/.test(code))
})

test('summariseLinks separates legacy links from recorded answers', () => {
  const s = summariseLinks([
    { status: 'active', consent: { state: 'approved' } },
    { status: 'active', consent: { state: 'approved' } },
    { status: 'pending', consent: { state: 'pending' } },
    { status: 'active' },
    { status: 'declined', consent: {} },
  ])
  assert.equal(s.total, 5)
  assert.equal(s.byState['active / approved'], 2)
  assert.equal(s.byState['pending / pending'], 1)
  assert.equal(s.byState['active / legacy (no consent record)'], 1)
  assert.equal(s.byState['declined / unknown'], 1)
})

test('summariseShares: revoked first, then expired, else live; reports the latest live expiry', () => {
  const now = Date.parse('2026-12-01T00:00:00Z')
  const day = 86_400_000
  const s = summariseShares([
    { expiresAt: now + 10 * day },
    { expiresAt: now + 40 * day },
    { expiresAt: now - day },
    { expiresAt: now + 90 * day, revokedAt: now - day }, // revoked wins over a future expiry
    { expiresAt: { toMillis: () => now + 5 * day } },
  ], now)
  assert.equal(s.total, 5)
  assert.equal(s.live, 3)
  assert.equal(s.expired, 1)
  assert.equal(s.revoked, 1)
  assert.equal(s.latestLiveExpiryMs, now + 40 * day)
})

test('summariseShares with nothing live has no latest expiry', () => {
  const s = summariseShares([], Date.now())
  assert.deepEqual(s, { total: 0, live: 0, expired: 0, revoked: 0, latestLiveExpiryMs: null })
})

test('importing the module did not try to connect (no credentials needed)', () => {
  assert.ok(typeof resolveCollections === 'function')
})

console.log(`\ncleanup-parent-portal: ${passed} passed`)
