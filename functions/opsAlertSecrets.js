/**
 * Deploy-time binding for the ops-alert WEBHOOK channel — the Slack (or
 * Discord / Mattermost / generic) incoming webhook that `opsAlert.js` posts its
 * `{text}` payload to. `sendOpsAlert` already reads the URL from
 * `process.env.OPS_ALERT_WEBHOOK_URL`; Cloud Functions only puts it there for a
 * secret that is BOUND to the function, which is what this module decides.
 *
 * Why the binding is opt-in rather than one more entry in every `secrets: [...]`
 * array:
 *   • The URL is a credential — anyone holding it can post into the channel —
 *     so it can't live in the committed `functions/.env.<project>` file.
 *   • A `defineSecret()` bound to a function whose secret has no value in
 *     Secret Manager makes `firebase deploy` HARD-FAIL ("no value for the
 *     secret: X") and blocks EVERY functions deploy. That trap is documented
 *     for RECRAFT_API_KEY in index.js and worked around for the inbound
 *     WhatsApp secrets in metaWhatsApp.js.
 * So the bind is gated on `OPS_ALERT_WEBHOOK_BOUND`, a NON-secret flag that
 * does belong in the committed env file. Turning the channel on:
 *   1. `firebase functions:secrets:set OPS_ALERT_WEBHOOK_URL` (paste the URL)
 *   2. set `OPS_ALERT_WEBHOOK_BOUND=1` in `functions/.env.examsprepzambia`
 *   3. deploy — the secret is bound, mounted as an env var, and picked up by
 *      `sendOpsAlert`'s existing default with no call-site change.
 * Backing out is the same steps in reverse (blank the flag, redeploy). Email
 * keeps delivering throughout: the two channels in `opsAlert.js` are
 * independent, so an unbound webhook only ever costs the chat copy.
 *
 * Pure + dependency-free (firebase-functions is required lazily, only on the
 * bound path) so it tests under plain `node`.
 */

const OPS_ALERT_WEBHOOK_SECRET = "OPS_ALERT_WEBHOOK_URL";
const OPS_ALERT_WEBHOOK_FLAG = "OPS_ALERT_WEBHOOK_BOUND";

// Anything other than an affirmative reads as OFF — an unset, blank, or
// misspelled flag must leave the deploy exactly as it is today.
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Is the webhook secret bound on this deploy? Read at module-load time by the
 * Firebase CLI (which loads `functions/.env.<project>` before discovering the
 * function manifest), so the flag decides the deployed binding, not runtime
 * behaviour.
 * @param {Object} [env] defaults to process.env
 * @returns {boolean}
 */
function isWebhookBindEnabled(env = process.env) {
  return TRUTHY.has(String((env || {})[OPS_ALERT_WEBHOOK_FLAG] || "").trim().toLowerCase());
}

/**
 * Append the webhook secret to a function's `secrets: [...]` list when the
 * flag is on. Returns a NEW array — callers pass their own secret params and
 * must not have them mutated.
 *
 * Defining the same secret name from several modules is fine and already the
 * pattern here (EMAIL_SMTP_USER is declared separately in firestoreBackup.js,
 * storageBackup.js, rateLimitHealth.js and opsHeartbeat.js — see the note at
 * firestoreBackup.js:57), so this needs no cross-module registry.
 *
 * @param {Array} [base] the function's existing secret params
 * @param {Object} [opts]
 * @param {Object} [opts.env] injected env (tests)
 * @param {Function} [opts.defineSecret] injected defineSecret (tests)
 * @returns {Array}
 */
function opsAlertSecrets(base = [], {env, defineSecret} = {}) {
  const list = Array.isArray(base) ? [...base] : [];
  if (!isWebhookBindEnabled(env || process.env)) return list;
  const define = defineSecret || require("firebase-functions/params").defineSecret;
  list.push(define(OPS_ALERT_WEBHOOK_SECRET));
  return list;
}

module.exports = {
  OPS_ALERT_WEBHOOK_SECRET,
  OPS_ALERT_WEBHOOK_FLAG,
  isWebhookBindEnabled,
  opsAlertSecrets,
};
