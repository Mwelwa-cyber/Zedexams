/* Plain-node tests for delayedFlagCore (npm run test:delayed-flag). */
import assert from 'node:assert/strict'
import {
  resolveDelayedFlag,
  DEFAULT_DELAY_MS,
  DEFAULT_MIN_VISIBLE_MS,
} from './delayedFlagCore.js'

const T0 = 1_700_000_000_000

/* ── Steady states ─────────────────────────────────────────────────────── */

assert.deepEqual(
  resolveDelayedFlag({ active: false, visible: false, now: T0, shownAt: 0 }),
  { action: 'none', waitMs: 0 },
  'idle and hidden is a steady state',
)

assert.deepEqual(
  resolveDelayedFlag({ active: true, visible: true, now: T0, shownAt: T0 }),
  { action: 'none', waitMs: 0 },
  'in flight and already shown is a steady state — never re-arms the show timer',
)

/* ── Rule 1: hold off before showing ───────────────────────────────────── */

assert.deepEqual(
  resolveDelayedFlag({ active: true, visible: false, now: T0, shownAt: 0 }),
  { action: 'show', waitMs: DEFAULT_DELAY_MS },
  'a new operation schedules the loader, it does not show it',
)

assert.equal(
  resolveDelayedFlag({ active: true, visible: false, now: T0, shownAt: 0, delay: 0 }).waitMs,
  0,
  'delay: 0 opts a caller out of the hold-off entirely',
)

assert.equal(
  resolveDelayedFlag({ active: true, visible: false, now: T0, shownAt: 0, delay: -50 }).waitMs,
  0,
  'a negative delay is clamped rather than passed to setTimeout',
)

/* ── Rule 2: minimum visible time ──────────────────────────────────────── */

assert.deepEqual(
  resolveDelayedFlag({ active: false, visible: true, now: T0 + 100, shownAt: T0 }),
  { action: 'hide', waitMs: DEFAULT_MIN_VISIBLE_MS - 100 },
  'a loader shown 100ms ago waits out the remainder of its minimum',
)

assert.deepEqual(
  resolveDelayedFlag({ active: false, visible: true, now: T0 + 5000, shownAt: T0 }),
  { action: 'hide', waitMs: 0 },
  'a loader that has outlived its minimum hides immediately',
)

assert.equal(
  resolveDelayedFlag({
    active: false,
    visible: true,
    now: T0 + 5000,
    shownAt: T0,
    minVisible: 0,
  }).waitMs,
  0,
  'minVisible: 0 opts a caller out of the floor',
)

/* ── Clock robustness ──────────────────────────────────────────────────── */
// A stranded loader is the worst outcome here: it is indistinguishable from a
// hung request, so every degenerate stamp must still resolve to a finite wait.

for (const shownAt of [undefined, null, NaN, Infinity]) {
  const { action, waitMs } = resolveDelayedFlag({
    active: false,
    visible: true,
    now: T0,
    shownAt,
  })
  assert.equal(action, 'hide', `shownAt=${String(shownAt)} still hides`)
  assert.ok(
    Number.isFinite(waitMs) && waitMs >= 0,
    `shownAt=${String(shownAt)} yields a finite, non-negative wait (got ${waitMs})`,
  )
}

assert.equal(
  resolveDelayedFlag({ active: false, visible: true, now: T0 - 1000, shownAt: T0 }).waitMs,
  DEFAULT_MIN_VISIBLE_MS,
  'a clock that jumped backwards falls back to the full minimum, never a longer one',
)

/* ── Truthiness ────────────────────────────────────────────────────────── */
// `visible` arrives from React state and is always a real boolean, but `active`
// is caller-supplied and is routinely a truthy object (an in-flight promise, an
// error, a stage string). Comparing them loosely would make `active: {}` with
// `visible: false` read as a steady state and never show the loader.

assert.equal(
  resolveDelayedFlag({ active: 'loading', visible: false, now: T0, shownAt: 0 }).action,
  'show',
  'a truthy non-boolean active value still schedules the loader',
)

assert.equal(
  resolveDelayedFlag({ active: undefined, visible: true, now: T0, shownAt: T0 }).action,
  'hide',
  'a falsy non-boolean active value still schedules the hide',
)

assert.equal(
  resolveDelayedFlag({ active: 'loading', visible: true, now: T0, shownAt: T0 }).action,
  'none',
  'a truthy non-boolean active value with the loader already up is a steady state',
)

console.log('delayedFlagCore: all assertions passed')
