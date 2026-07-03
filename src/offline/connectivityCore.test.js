/**
 * Tests for connectivityCore — the status priority machine, labels, tone, and
 * the "unobtrusive" show/hide rule.
 * Run: node src/offline/connectivityCore.test.js
 */

import {
  STATUS,
  deriveStatus,
  statusLabel,
  shouldShowIndicator,
  statusTone,
} from './connectivityCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('deriveStatus — priority order')
{
  assert(deriveStatus({ online: true }) === STATUS.ONLINE, 'calm default')
  assert(deriveStatus({ online: false }) === STATUS.OFFLINE, 'no connectivity')
  assert(deriveStatus({ online: true, syncing: true, pending: 3 }) === STATUS.SYNCING, 'syncing outranks waiting')
  assert(deriveStatus({ online: true, updating: true }) === STATUS.UPDATING, 'background refresh')
  assert(deriveStatus({ online: true, pending: 2 }) === STATUS.WAITING, 'online with backlog')
  assert(deriveStatus({ online: false, savedOfflineRecently: true }) === STATUS.SAVED_OFFLINE, 'saved-offline while offline')
  assert(deriveStatus({ online: false, syncing: true }) === STATUS.OFFLINE, 'cannot sync while offline')
  assert(deriveStatus({ online: true, updating: true, syncing: true }) === STATUS.SYNCING, 'active sync beats updating')
}

console.log('\nstatusLabel')
{
  assert(statusLabel(STATUS.OFFLINE) === 'Offline', 'offline label')
  assert(statusLabel(STATUS.SYNCING) === 'Syncing…', 'syncing label')
  assert(statusLabel(STATUS.WAITING, 1) === 'Waiting to sync', 'single waiting')
  assert(statusLabel(STATUS.WAITING, 4) === 'Waiting to sync (4)', 'plural waiting shows count')
  assert(statusLabel(STATUS.SAVED_OFFLINE) === 'Saved offline', 'saved label')
}

console.log('\nshouldShowIndicator — unobtrusive')
{
  assert(shouldShowIndicator(STATUS.ONLINE) === false, 'online hidden')
  assert(shouldShowIndicator(STATUS.OFFLINE) === true, 'offline shown')
  assert(shouldShowIndicator(STATUS.SYNCING) === true, 'syncing shown')
}

console.log('\nstatusTone')
{
  assert(statusTone(STATUS.OFFLINE) === 'warn', 'offline warns')
  assert(statusTone(STATUS.SYNCING) === 'info', 'syncing informs')
  assert(statusTone(STATUS.SAVED_OFFLINE) === 'good', 'saved is positive')
  assert(statusTone(STATUS.ONLINE) === 'neutral', 'online neutral')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll connectivityCore tests passed.')
