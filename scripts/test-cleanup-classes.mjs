/**
 * Tests for scripts/cleanup-classes.mjs — the one-off purge of the removed
 * learner↔teacher class bridge.
 *
 * The script's decisions are small but each of them is a way to delete the
 * wrong thing quietly, so each is pinned here:
 *
 *   • the collection list is exactly the bridge, and classRegisters is NOT in
 *     it (the near-identically-named teacher-only Class Register);
 *   • deletion order puts the pointer collections before the class they point
 *     at, so an interrupted run cannot leave a live invite code behind;
 *   • --collection= refuses a name outside the bridge instead of falling back
 *     to "scan everything", which is the dangerous default;
 *   • a backup id cannot collide across collections.
 */

import assert from 'node:assert/strict'

const { BRIDGE_COLLECTIONS, backupDocId, resolveCollections } =
  await import('./cleanup-classes.mjs')

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('cleanup-classes')

test('the collection list is exactly the three bridge collections', () => {
  assert.deepEqual([...BRIDGE_COLLECTIONS].sort(), ['assignments', 'classInvites', 'classes'])
})

test('classRegisters is not in the list', () => {
  // The teacher-only Class Register survives the removal. It is one letter
  // away from `classes` in the same file, and deleting it would destroy
  // rosters, marks and attendance that have nothing to do with the bridge.
  assert.ok(!BRIDGE_COLLECTIONS.includes('classRegisters'))
  assert.ok(!BRIDGE_COLLECTIONS.some((c) => c.startsWith('classRegisters')))
})

test('pointers are deleted before the class they point at', () => {
  const order = BRIDGE_COLLECTIONS
  assert.ok(
    order.indexOf('classInvites') < order.indexOf('classes'),
    'an interrupted run must not leave a live invite code pointing at a deleted class',
  )
  assert.ok(
    order.indexOf('assignments') < order.indexOf('classes'),
    'an interrupted run must not leave assignments pointing at a deleted class',
  )
})

test('no --collection means every bridge collection', () => {
  assert.deepEqual(resolveCollections(null), BRIDGE_COLLECTIONS)
  assert.deepEqual(resolveCollections(undefined), BRIDGE_COLLECTIONS)
  assert.deepEqual(resolveCollections(''), BRIDGE_COLLECTIONS)
})

test('--collection narrows to exactly that one', () => {
  assert.deepEqual(resolveCollections('classes'), ['classes'])
  assert.deepEqual(resolveCollections('classInvites'), ['classInvites'])
  assert.deepEqual(resolveCollections('assignments'), ['assignments'])
})

test('--collection with a name outside the bridge resolves to nothing', () => {
  // Empty is what makes the caller print an error and exit non-zero. Falling
  // back to "all collections" for an unrecognised name would turn a typo into
  // a full purge.
  assert.deepEqual(resolveCollections('classRegisters'), [])
  assert.deepEqual(resolveCollections('users'), [])
  assert.deepEqual(resolveCollections('CLASSES'), [])
})

test('a backup id cannot collide across collections', () => {
  // Doc ids are unique within a collection, not across them: a class and an
  // assignment can both be `abc`. A flat backup collection needs the
  // collection name in the key or the second write silently overwrites the
  // first — losing the document being deleted.
  assert.notEqual(backupDocId('classes', 'abc'), backupDocId('assignments', 'abc'))
  assert.equal(backupDocId('classes', 'abc'), 'classes__abc')
})

console.log(`\ncleanup-classes: ${passed} passed`)
