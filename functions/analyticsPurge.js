"use strict";

/**
 * functions/analyticsPurge.js
 *
 * Deletes a user's PostHog person (and their events) when their ZedExams
 * account is purged.
 *
 * Why this exists: the Privacy Policy §7 promises that deleting an account
 * also deletes the analytics profile. Firestore and Auth are ours to clear
 * directly; PostHog is a separate system that would otherwise keep the
 * profile and its event history indefinitely, which would make that sentence
 * false for exactly the users who cared enough to read it.
 *
 * ── Why no defineSecret() ────────────────────────────────────────────────
 *
 * The API key is read from `process.env`, NOT bound with `defineSecret`. This
 * is deliberate and is the one thing to preserve when editing this file.
 * A `defineSecret()` bound to a function whose secret has no value in Secret
 * Manager makes `firebase deploy` HARD-FAIL ("no value for the secret: X") and
 * blocks EVERY functions deploy — the trap documented for RECRAFT_API_KEY in
 * index.js and worked around for the inbound WhatsApp secrets. Binding a key
 * here would therefore wedge deploys for the whole repo until someone stored
 * a PostHog personal API key, to make a best-effort cleanup step work.
 *
 * So: configure `POSTHOG_PERSONAL_API_KEY` (and `POSTHOG_PROJECT_ID`) in
 * `functions/.env.<project>` and this runs; leave them unset and it is a
 * silent no-op. The account is still fully deleted either way — this is the
 * last, least-critical step of the purge, and it reports what it did rather
 * than throwing.
 */

const POSTHOG_HOST = "https://us.posthog.com";

// Long enough for two sequential PostHog calls, short enough that an
// unreachable vendor cannot hold the deletion callable open. The account is
// already gone by the time we get here; the user must not wait on PostHog.
const TIMEOUT_MS = 8000;

function config(env = process.env) {
  return {
    key: String(env.POSTHOG_PERSONAL_API_KEY || "").trim(),
    projectId: String(env.POSTHOG_PROJECT_ID || "").trim(),
    host: String(env.POSTHOG_HOST || POSTHOG_HOST).trim().replace(/\/+$/, ""),
  };
}

/**
 * Delete the PostHog person whose distinct_id is this Firebase uid, along
 * with their events.
 *
 * Note the identifier: analytics only ever identifies a user by uid (see
 * src/utils/analytics.js), and learner accounts are never identified at all,
 * so a learner legitimately has no person to delete — `{skipped: 'no-person'}`
 * is a normal, correct outcome, not a failure.
 *
 * Never throws. Returns a small verdict object so the caller can log what
 * happened without having to distinguish "nothing to do" from "we failed".
 *
 * @param {string} uid
 * @param {object} [deps]  {fetchImpl, env, timeoutMs} for tests.
 * @return {Promise<{ok: boolean, deleted: number, skipped?: string, error?: string}>}
 */
async function deleteAnalyticsProfile(uid, deps = {}) {
  const {key, projectId, host} = config(deps.env || process.env);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;

  if (!uid) return {ok: false, deleted: 0, skipped: "no-uid"};
  // Unconfigured is the expected state until someone stores a personal API
  // key. Report it distinctly so a log reader can tell "switched off" from
  // "tried and failed" — the two need very different responses.
  if (!key || !projectId) return {ok: true, deleted: 0, skipped: "not-configured"};
  if (typeof fetchImpl !== "function") {
    return {ok: false, deleted: 0, skipped: "no-fetch"};
  }

  const base = `${host}/api/projects/${encodeURIComponent(projectId)}`;
  const headers = {Authorization: `Bearer ${key}`};

  const call = async (url, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {...init, headers, signal: ctrl.signal});
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const lookup = await call(
        `${base}/persons/?distinct_id=${encodeURIComponent(uid)}`,
        {method: "GET"},
    );
    if (!lookup || !lookup.ok) {
      return {ok: false, deleted: 0, error: `lookup ${lookup?.status || "failed"}`};
    }
    const found = await lookup.json();
    const people = Array.isArray(found?.results) ? found.results : [];
    if (people.length === 0) return {ok: true, deleted: 0, skipped: "no-person"};

    let deleted = 0;
    for (const person of people) {
      if (!person?.id) continue;
      // delete_events=true is the whole point — deleting the person alone
      // would leave their event history behind, still keyed to the uid.
      const res = await call(
          `${base}/persons/${encodeURIComponent(person.id)}/?delete_events=true`,
          {method: "DELETE"},
      );
      if (res && (res.ok || res.status === 404)) deleted += 1;
    }
    return {ok: deleted === people.length, deleted};
  } catch (err) {
    // Includes the abort on timeout. The account deletion has already
    // succeeded; this step reports and moves on.
    return {ok: false, deleted: 0, error: String(err?.message || err).slice(0, 200)};
  }
}

module.exports = {deleteAnalyticsProfile, config, TIMEOUT_MS};
