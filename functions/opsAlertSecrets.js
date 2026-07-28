/**
 * Binds the ops-alert WEBHOOK secret — the Slack (or Discord / Mattermost)
 * incoming webhook `opsAlert.js` posts its `{text}` payload to. `sendOpsAlert`
 * reads the URL from `process.env.OPS_ALERT_WEBHOOK_URL`, and Cloud Functions
 * only puts it there for a secret BOUND to the function, which is what this
 * module does for every function that raises an alert.
 *
 * THE BINDING CANNOT BE GATED ON A FLAG IN functions/.env.<project>, and the
 * first version of this file tried: `firebase deploy` decides which secrets to
 * bind by ANALYSING the source in a subprocess that receives only
 * FIREBASE_CONFIG, GCLOUD_PROJECT and GOOGLE_CLOUD_QUOTA_PROJECT
 * (firebase-tools `deploy/functions/prepare.js` → `discoverBuild`, envs from
 * `functions/env.js` `loadFirebaseEnvs`). The `.env.<project>` file is loaded on
 * a different path (`loadUserEnvs`) purely to populate the DEPLOYED runtime's
 * environment. So any `process.env` read at module load is undefined during
 * analysis: the flag read as off, nothing bound the secret, and — because an
 * unreferenced secret is never validated — the deploy passed while every alert
 * quietly went out by email only. Keep this module free of `process.env`
 * entirely; its test fails if one reappears.
 *
 * The consequence to know: **`OPS_ALERT_WEBHOOK_URL` must exist in Secret
 * Manager, or EVERY functions deploy hard-fails** with "no value for the secret"
 * — the trap documented for RECRAFT_API_KEY in index.js. It exists (stored
 * 2026-07-27, a Slack webhook for #zedexams-ops). To retire the chat channel,
 * delete the `list.push(...)` below and redeploy BEFORE destroying the secret;
 * email delivery is unaffected either way, since the two channels in
 * opsAlert.js are independent.
 */

const OPS_ALERT_WEBHOOK_SECRET = "OPS_ALERT_WEBHOOK_URL";

/**
 * Append the webhook secret to a function's `secrets: [...]` list. Returns a NEW
 * array — callers pass their own secret params and must not have them mutated.
 *
 * Declaring the same secret name from several modules is fine and already the
 * pattern here (EMAIL_SMTP_USER is declared separately in firestoreBackup.js,
 * storageBackup.js, rateLimitHealth.js and opsHeartbeat.js — see the note at
 * firestoreBackup.js:57), so this needs no cross-module registry.
 *
 * @param {Array} [base] the function's existing secret params
 * @param {Object} [opts]
 * @param {Function} [opts.defineSecret] injected defineSecret (tests)
 * @returns {Array}
 */
function opsAlertSecrets(base = [], {defineSecret} = {}) {
  const list = Array.isArray(base) ? [...base] : [];
  const define = defineSecret || require("firebase-functions/params").defineSecret;
  list.push(define(OPS_ALERT_WEBHOOK_SECRET));
  return list;
}

module.exports = {
  OPS_ALERT_WEBHOOK_SECRET,
  opsAlertSecrets,
};
