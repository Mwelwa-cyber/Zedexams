/**
 * The Assessment Engine's rollout switches (docs/phase3-plan.md §4).
 *
 * This module answers exactly one question — *does this visitor get the engine
 * for this runner* — and it is the only module allowed to answer it
 * (`npm run test:engine-flag-single-reader` fails the build if a second one
 * appears). The reason is §4's rule 3: a flag read in four components becomes
 * four subtly different conditions, and the day one of them is wrong is the
 * day the rollback toggle stops meaning what the person pressing it thinks.
 * `passkeyRegionCore.js` is the precedent.
 *
 * Pure: no React, no Firebase, no DOM. The effectful half — reading
 * `settings/global`, the signed-in uid and the device's visitor id — is
 * `src/hooks/useAssessmentEngineFlag.js`, the one binding.
 *
 * ## The five rules this implements
 *
 * 1. **Per-runner, never one master switch.** Three independent booleans. A
 *    cutover that cannot be reverted on its own is not three cutovers.
 * 2. **Fail closed.** Anything that is not exactly `true` is off, so an
 *    unreadable `settings/global`, a typo'd key, a `"true"` string or a
 *    half-written document all serve the OLD runner. This inverts the usual
 *    availability default deliberately: the old runner is the known-good path.
 * 3. **Resolved here, once.**
 * 4. **The flag chooses a runner; it never branches inside one.** Nothing in
 *    this module knows what a question is.
 * 5. **No flag on a server write.**
 *
 * ## Two properties the ramp depends on
 *
 * **Stable.** A visitor's bucket is a hash of their id, so it is the same on
 * every page view. Randomising per view would flap a learner between two
 * runners mid-session, which is worse than either runner.
 *
 * **Monotonic.** The test is `bucket < percent` against a fixed hash, so
 * raising the percentage only ever ADDS visitors — nobody is swapped out of
 * the engine by a ramp-up, and everyone in at 10 is still in at 25. A
 * ramp that reshuffled would make "did the engine cause this" unanswerable,
 * because the population it was measured on would have changed underneath.
 *
 * ## Why the bucket is NOT salted per runner
 *
 * All three runners share one bucketing, so `rolloutPercent: 10` means *ten
 * percent of visitors are on the engine* — full stop, and the same ten
 * percent everywhere. Salting per runner would spread exposure, but at 10/10/10
 * it would put up to 27% of visitors on some engine surface while every
 * dashboard still read "10", and the un-exposed population would stop being a
 * clean control. A number that does not mean what it says is worse during a
 * canary than a slightly concentrated one.
 */

/**
 * The three runners with a flag, and the whole set of them.
 *
 * No `dailyQuiz`: `/exam/:examId` is out of Phase 3 (§6), and a flag nothing
 * reads is a promise the code does not keep. A name that is not in this list
 * resolves to OFF rather than throwing — a typo must not crash a learner's
 * page — and reports itself as `unknown-runner`, which is visible in the one
 * place already being watched (§7.2's `assessment_engine_path` carries
 * `flagSource`).
 */
export const ENGINE_RUNNERS = Object.freeze(['pastPaperQuiz', 'quiz', 'game'])

/** The key under `settings/global.featureFlags`. Exported so no consumer, test
 *  or fixture has to spell it — the wire format has exactly one spelling. */
export const ENGINE_FLAG_KEY = 'assessmentEngine'

/** Buckets are 0–99, so a percentage is a bucket count. A percent below 1
 *  cannot be expressed and floors to nobody, which is the fail-closed way to
 *  round. */
export const ROLLOUT_BUCKETS = 100

/**
 * Every reason a decision can have. Declared as a set because it becomes a
 * telemetry dimension (§7.2) — an undeclared value would appear in PostHog as
 * a new category nobody can interpret, and a declared one that the resolver
 * cannot produce is a category that never appears and is never noticed.
 * `flags.test.js` asserts both directions.
 */
export const FLAG_SOURCES = Object.freeze([
  'unknown-runner',   // the caller named a runner the engine does not have
  'runner-off',       // the per-runner switch is not exactly true
  'rollout-uid',      // this uid is on the allow-list
  'rollout-zero',     // the runner is on, the ramp has not started
  'rollout-all',      // 100% — everyone, no bucketing needed
  'rollout-bucket',   // inside the ramp
  'not-in-rollout',   // outside the ramp
  'no-visitor-id',    // a partial ramp with nothing stable to bucket on
])

/**
 * A visitor's bucket, 0–99, or `null` when there is nothing to bucket.
 *
 * FNV-1a: small, dependency-free, and well enough distributed for a hundred
 * buckets. It is not a cryptographic hash and must never be used as one — a
 * visitor can compute their own bucket, which is fine, because the worst thing
 * on the other side of it is a different renderer.
 */
export function rolloutBucket(visitorId) {
  if (typeof visitorId !== 'string') return null
  const id = visitorId.trim()
  if (!id) return null
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % ROLLOUT_BUCKETS
}

/**
 * The ramp percentage, normalised. Absent → 0 (§4.2's default): turning a
 * runner on and choosing an exposure are two deliberate acts, and the
 * fail-closed direction for a forgotten one is nobody.
 *
 * A numeric string is accepted because the admin number input round-trips
 * through strings. A boolean is NOT: `Number(true)` is 1, so a `rolloutPercent:
 * true` typed by someone thinking it was a switch would quietly ship the engine
 * to one percent of visitors.
 */
export function normaliseRolloutPercent(value) {
  const raw = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (raw >= 100) return 100
  return Math.floor(raw)
}

/**
 * The uid allow-list, normalised.
 *
 * Two shapes, because two things write it. The admin control is a textarea, so
 * it stores TEXT — one uid per line, or comma-separated, however the operator
 * pasted them. A value written by hand through the Firebase console is an
 * ARRAY. Accepting only one of those would make the allow-list work depending
 * on which door it came through, and the failure is silent: the pilot account
 * simply does not get the engine and nothing says why.
 *
 * Anything else is an empty list — fail closed, never a partial read.
 */
export function normaliseRolloutUids(value) {
  const entries = typeof value === 'string'
    // Whitespace and commas both separate. A uid contains neither, so this
    // cannot split one in half.
    ? value.split(/[\s,]+/)
    : (Array.isArray(value) ? value : [])
  return entries
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Sources decided WITHOUT consulting `uid` or `visitorId`. A decision from one
 * of these cannot change when a late-arriving uid replaces the provisional
 * anonymous identity — which is what lets the flag binding serve it during the
 * auth watchdog window instead of holding the visit on the old runner
 * (Codex P2 on #2152, r3733390985). The identity-consulting sources
 * (`rollout-uid`, `rollout-bucket`, `not-in-rollout`, `no-visitor-id`) are
 * exactly the ones a settled uid can overturn, so they stay held.
 */
export const IDENTITY_FREE_SOURCES = Object.freeze([
  'unknown-runner', 'runner-off', 'rollout-zero', 'rollout-all',
])

function decision(runner, engine, source) {
  return Object.freeze({ runner, engine, source, stable: IDENTITY_FREE_SOURCES.includes(source) })
}

/**
 * Does this visitor get the engine for this runner?
 *
 * @param {object}  input
 * @param {object}  [input.featureFlags] `settings/global.featureFlags`, as read
 *                  by `PlatformSettingsContext`. Missing/unreadable → off.
 * @param {string}  input.runner   one of `ENGINE_RUNNERS`
 * @param {?string} [input.uid]    the signed-in uid, or null
 * @param {?string} [input.visitorId] the stable per-visitor id
 *                  (`src/utils/visitorId.js`) — the same id the free-preview
 *                  counter keys on
 * @returns {{runner: string, engine: boolean, source: string}} frozen; `source`
 *          is the telemetry dimension and the answer to "why am I not on it".
 *
 * The order is load-bearing in one place: the per-runner switch is checked
 * BEFORE the allow-list, so flipping a runner off reverts everyone —
 * allow-listed uids included. A rollback that spares the people most likely to
 * be staff is a rollback that leaves the failure running for exactly the group
 * that would otherwise notice it stopped.
 */
export function resolveEngineDecision({ featureFlags, runner, uid = null, visitorId = null } = {}) {
  if (!ENGINE_RUNNERS.includes(runner)) return decision(runner, false, 'unknown-runner')

  const config = featureFlags?.[ENGINE_FLAG_KEY]
  const configured = Boolean(config) && typeof config === 'object' && !Array.isArray(config)
  if (!configured || config[runner] !== true) return decision(runner, false, 'runner-off')

  if (typeof uid === 'string' && uid && normaliseRolloutUids(config.rolloutUids).includes(uid)) {
    return decision(runner, true, 'rollout-uid')
  }

  const percent = normaliseRolloutPercent(config.rolloutPercent)
  if (percent <= 0) return decision(runner, false, 'rollout-zero')
  if (percent >= ROLLOUT_BUCKETS) return decision(runner, true, 'rollout-all')

  const bucket = rolloutBucket(visitorId)
  if (bucket === null) return decision(runner, false, 'no-visitor-id')
  return bucket < percent
    ? decision(runner, true, 'rollout-bucket')
    : decision(runner, false, 'not-in-rollout')
}
