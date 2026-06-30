/**
 * Per-agent circuit breaker — the auto-pause that dispatcher.js and CLAUDE.md
 * have long *documented* ("three failures in one hour pauses the agent
 * automatically") but nothing actually implemented. Without it a persistently
 * broken agent re-bills a model call on every queued job, with no automatic
 * stop and no page.
 *
 * `evaluateBreaker` is pure (no I/O) so the trip logic unit-tests under plain
 * `node`. `recordAgentFailure` does the Firestore read/modify/write against
 * agentControl/{agentId} and fires an alert callback on the newly-tripped
 * transition.
 */

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_THRESHOLD = 3; // failures within the window
const MAX_RETAINED = 20; // cap the stored timestamp array

/**
 * Decide whether the breaker should trip, given the prior failure timestamps
 * (epoch ms) plus the new failure at `now`. Prunes anything older than the
 * window. Pure.
 *
 * @param {number[]} priorFailures  epoch-ms timestamps of earlier failures
 * @param {number} now              epoch ms of the failure being recorded
 * @param {Object} [opts]
 * @param {number} [opts.windowMs]
 * @param {number} [opts.threshold]
 * @returns {{failuresInWindow: number, tripped: boolean, retained: number[]}}
 */
function evaluateBreaker(priorFailures, now, opts = {}) {
  const windowMs = opts.windowMs || DEFAULT_WINDOW_MS;
  const threshold = opts.threshold || DEFAULT_THRESHOLD;
  const cutoff = now - windowMs;

  const withinWindow = (Array.isArray(priorFailures) ? priorFailures : [])
    .map((t) => Number(t))
    .filter((t) => Number.isFinite(t) && t > cutoff);

  withinWindow.push(now);
  withinWindow.sort((a, b) => a - b);

  const retained = withinWindow.slice(-MAX_RETAINED);
  return {
    failuresInWindow: withinWindow.length,
    tripped: withinWindow.length >= threshold,
    retained,
  };
}

/**
 * Record an agent failure against agentControl/{agentId} and, when the breaker
 * trips (≥threshold failures within the window) AND the agent isn't already
 * paused, set paused=true and invoke `alert` once for the transition.
 *
 * Best-effort: any Firestore/alert error is swallowed and logged so the
 * caller's own failure-handling (status='failed') is never disrupted.
 *
 * @param {Object} args
 * @param {Object} args.db          firestore instance (admin.firestore())
 * @param {string} args.agentId
 * @param {string} [args.errorMessage]
 * @param {number} [args.now]       epoch ms (defaults to Date.now())
 * @param {Function} [args.alert]   async ({agentId, failuresInWindow, errorMessage}) => void
 * @param {Object} [args.opts]      {windowMs, threshold}
 * @param {Object} [args.fieldValue] admin.firestore.FieldValue (for serverTimestamp); optional
 * @returns {Promise<{tripped: boolean, failuresInWindow: number, alreadyPaused: boolean}>}
 */
async function recordAgentFailure({
  db,
  agentId,
  errorMessage = "",
  now = Date.now(),
  alert,
  opts = {},
  fieldValue,
}) {
  const result = {tripped: false, failuresInWindow: 0, alreadyPaused: false};
  if (!db || !agentId) return result;

  try {
    const ref = db.collection("agentControl").doc(agentId);
    const snap = await ref.get();
    const data = (snap.exists && snap.data()) || {};
    const alreadyPaused = data.paused === true;
    result.alreadyPaused = alreadyPaused;

    const {failuresInWindow, tripped, retained} = evaluateBreaker(
      data.recentFailures, now, opts,
    );
    result.failuresInWindow = failuresInWindow;
    result.tripped = tripped;

    const update = {
      recentFailures: retained,
      lastFailureAt: now,
      lastFailureError: String(errorMessage || "").slice(0, 500),
    };
    if (fieldValue && typeof fieldValue.serverTimestamp === "function") {
      update.updatedAt = fieldValue.serverTimestamp();
    }

    // Trip: pause the agent (unless an admin already paused it) so the bleed
    // stops, and stamp the auto-pause provenance.
    if (tripped && !alreadyPaused) {
      update.paused = true;
      update.pausedReason = `auto: ${failuresInWindow} failures within the breaker window`;
      update.pausedBy = "circuit-breaker";
      update.pausedAt = now;
    }

    await ref.set(update, {merge: true});

    if (tripped && !alreadyPaused && typeof alert === "function") {
      try {
        await alert({agentId, failuresInWindow, errorMessage});
      } catch (alertErr) {
        console.error("[circuitBreaker] alert callback failed", alertErr && alertErr.message);
      }
    }
  } catch (err) {
    console.error("[circuitBreaker] recordAgentFailure failed", err && err.message);
  }

  return result;
}

module.exports = {
  evaluateBreaker,
  recordAgentFailure,
  DEFAULT_WINDOW_MS,
  DEFAULT_THRESHOLD,
  MAX_RETAINED,
};
