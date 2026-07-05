"use strict";

/**
 * Resolves WHICH App Check verification failures hard-block a request, from env.
 *
 * App Check enforcement is deliberately staged (see functions/index.js): a
 * single global flip would 401 every AI endpoint at once, locking out any
 * legitimate client whose attestation isn't propagating yet (Safari, stale
 * cached bundles, in-app WebViews, the Android Play Integrity path). This
 * resolver lets enforcement be turned on ONE endpoint at a time so it can be
 * canaried against the appCheckHealth/{date} telemetry before widening:
 *
 *   APPCHECK_ENFORCE=1
 *       Global switch — enforce on EVERY endpoint (backward-compatible).
 *   APPCHECK_ENFORCE_LABELS="generateQuizQuestions,ocrNotePages"
 *       Canary — enforce ONLY the listed endpoint labels (comma / space /
 *       newline separated). The label is the same string passed to
 *       recordAppCheckCallable() / softVerifyAppCheckHttp().
 *   (neither set)
 *       Observe-only — record health counters, never block (today's default).
 *
 * APPCHECK_ENFORCE=1 wins over the label list. Pure + dependency-free so it
 * unit-tests under plain `node` (the *Core.js / no-firebase-dep convention).
 */

function parseLabels(raw) {
  if (!raw || typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * @param {Record<string, string|undefined>} [env] typically process.env
 * @returns {{ global: boolean, labels: Set<string>, enforces: (label: string) => boolean }}
 */
function resolveAppCheckEnforcement(env) {
  const e = env || {};
  const global = e.APPCHECK_ENFORCE === "1";
  const labels = parseLabels(e.APPCHECK_ENFORCE_LABELS);
  return {
    global,
    labels,
    enforces(label) {
      return global || labels.has(label);
    },
  };
}

module.exports = { resolveAppCheckEnforcement, parseLabels };
