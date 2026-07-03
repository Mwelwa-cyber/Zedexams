/**
 * Tests for syncQueueCore — idempotency, dedup enqueue, backoff, attempt
 * bookkeeping, due-selection, and LWW conflict resolution.
 * Run: node src/offline/syncQueueCore.test.js
 */

import {
  MAX_ATTEMPTS,
  actionId,
  newAction,
  enqueue,
  backoffDelay,
  markAttempt,
  dueActions,
  pendingCount,
  pruneDone,
  resolveConflict,
} from './syncQueueCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

const NOW = 1_700_000_000_000

console.log('actionId + newAction')
{
  assert(actionId('quiz-result', 'q1:u1:2') === 'quiz-result:q1:u1:2', 'stable idempotency key')
  const a = newAction({ kind: 'quiz-result', payload: { score: 5 }, version: 1, now: NOW })
  assert(a.status === 'pending' && a.attempts === 0 && a.nextAttemptAt === NOW, 'starts pending, due now')
}

console.log('\nenqueue — dedup + prevent double-submit')
{
  const a = newAction({ id: 'quiz-result:q1', kind: 'quiz-result', payload: { v: 1 }, version: 1, now: NOW })
  let q = enqueue([], a)
  assert(q.length === 1, 'first enqueue adds')
  // Same id, newer payload while offline → replaces, does not duplicate.
  q = enqueue(q, { ...a, payload: { v: 2 }, version: 2, updatedAt: NOW + 100 })
  assert(q.length === 1 && q[0].payload.v === 2 && q[0].version === 2, 'same id updated in place (no dupe)')
  // A completed action is never resurrected by a replay.
  const done = enqueue([{ ...a, status: 'done' }], a)
  assert(done[0].status === 'done', 'done action not re-queued')
}

console.log('\nbackoffDelay — exponential, capped')
{
  assert(backoffDelay(0) === 2000, 'first retry 2s')
  assert(backoffDelay(1) === 4000 && backoffDelay(2) === 8000, 'doubles each attempt')
  assert(backoffDelay(100) === 5 * 60 * 1000, 'capped at 5 min')
}

console.log('\nmarkAttempt — success, retry, exhaustion')
{
  const a = newAction({ id: 'x', kind: 'progress', payload: {}, now: NOW })
  assert(markAttempt(a, { ok: true, now: NOW }).status === 'done', 'success → done')

  const failed1 = markAttempt(a, { ok: false, error: 'net', now: NOW })
  assert(failed1.status === 'pending' && failed1.attempts === 1, 'failure re-queues pending')
  assert(failed1.nextAttemptAt === NOW + 2000, 'backoff scheduled')
  assert(failed1.lastError === 'net', 'error recorded')

  let poison = { ...a, attempts: MAX_ATTEMPTS - 1 }
  poison = markAttempt(poison, { ok: false, error: 'still bad', now: NOW })
  assert(poison.status === 'failed', 'exhausted attempts → failed (no infinite spin)')
}

console.log('\ndueActions + pendingCount + pruneDone')
{
  const ready = { ...newAction({ id: 'r', kind: 'k', payload: {}, now: NOW - 5000 }), nextAttemptAt: NOW - 1 }
  const later = { ...newAction({ id: 'l', kind: 'k', payload: {}, now: NOW }), nextAttemptAt: NOW + 10000 }
  const done = { ...newAction({ id: 'd', kind: 'k', payload: {}, now: NOW }), status: 'done' }
  const q = [later, ready, done]
  assert(dueActions(q, true, NOW).map((a) => a.id).join() === 'r', 'only ready+pending, FIFO')
  assert(dueActions(q, false, NOW).length === 0, 'offline → nothing due')
  assert(pendingCount(q) === 2, 'pending + inflight counted, done excluded')
  assert(pruneDone(q).length === 2, 'done pruned')
}

console.log('\nresolveConflict — LWW by version then time, remote wins ties')
{
  assert(resolveConflict({ version: 3 }, { version: 2 }) === 'local', 'higher version wins')
  assert(resolveConflict({ version: 1 }, { version: 5 }) === 'remote', 'lower version loses')
  assert(resolveConflict({ version: 2, updatedAt: 200 }, { version: 2, updatedAt: 100 }) === 'local', 'equal version → newer time wins')
  assert(resolveConflict({ version: 2, updatedAt: 100 }, { version: 2, updatedAt: 100 }) === 'remote', 'dead tie → remote (never clobber server)')
  assert(resolveConflict({ version: 1 }, null) === 'local', 'no remote → local')
  assert(resolveConflict(null, { version: 1 }) === 'remote', 'no local → remote')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll syncQueueCore tests passed.')
