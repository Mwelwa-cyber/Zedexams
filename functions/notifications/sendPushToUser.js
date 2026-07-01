/**
 * Shared FCM web-push sender + dead-token pruning.
 *
 * Factored out of functions/dailyReminders.js so the per-event notification
 * pipeline (createNotification.js) and the daily streak cron share one tested
 * implementation of "multicast to a user's devices, prune the tokens FCM tells
 * us are dead". Behaviour-preserving for the cron: it still does its own global
 * 500-token batching and reuses isPrunableToken / pruneDeadTokensByUid here.
 *
 * firebase-admin is NOT required at module load — `messaging` and `db` are
 * passed in, so this is region-agnostic and unit-testable with a stub.
 */

// FCM error codes that mean the token is permanently dead (user uninstalled /
// the browser revoked the subscription). Safe to arrayRemove. Anything else
// (transient, server) is left in place to retry next time.
const PRUNABLE_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

function isPrunableToken(code) {
  return PRUNABLE_CODES.has(code);
}

/**
 * arrayRemove the dead tokens, grouped per uid, in one update per user.
 * arrayRemove is idempotent so a race with a fresh client registerToken can't
 * corrupt anything. Returns the count actually pruned.
 *
 * @param {object} db firestore() instance
 * @param {Map<string,string[]>} tokensToRemoveByUid
 */
async function pruneDeadTokensByUid(db, tokensToRemoveByUid) {
  const admin = require("firebase-admin");
  let pruned = 0;
  for (const [uid, deadTokens] of tokensToRemoveByUid.entries()) {
    if (!deadTokens || deadTokens.length === 0) continue;
    try {
      await db
        .collection("users")
        .doc(uid)
        .update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...deadTokens),
        });
      pruned += deadTokens.length;
    } catch (err) {
      console.warn(`[sendPushToUser] prune for ${uid} failed`, err);
    }
  }
  return pruned;
}

/**
 * Send a web-push payload to a single user's tokens and prune any dead ones.
 * Used by createNotification.js — per-user token counts are tiny (a few
 * devices) so a single multicast call is fine.
 *
 * @param {object} args
 * @param {object} args.messaging admin.messaging() instance
 * @param {object} args.db firestore() instance
 * @param {string} args.uid
 * @param {string[]} args.tokens
 * @param {object} args.payload result of buildFcmPayload() (no `tokens` field)
 * @returns {Promise<{sent:number, failed:number, pruned:number, errors:string[]}>}
 */
async function sendPushToUser({ messaging, db, uid, tokens, payload }) {
  const summary = { sent: 0, failed: 0, pruned: 0, errors: [] };
  const list = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
  if (list.length === 0) return summary;

  const toRemove = new Map();
  const BATCH = 500;
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    let response;
    try {
      response = await messaging.sendEachForMulticast({ tokens: slice, ...payload });
    } catch (err) {
      summary.failed += slice.length;
      summary.errors.push(String((err && err.message) || err).slice(0, 200));
      continue;
    }
    summary.sent += response.successCount;
    summary.failed += response.failureCount;
    response.responses.forEach((res, idx) => {
      if (res.success) return;
      const code = res.error && res.error.code;
      if (isPrunableToken(code)) {
        if (!toRemove.has(uid)) toRemove.set(uid, []);
        toRemove.get(uid).push(slice[idx]);
      } else if (res.error) {
        summary.errors.push(
            String(res.error.message || res.error.code || "unknown").slice(0, 200),
        );
      }
    });
  }

  summary.pruned = await pruneDeadTokensByUid(db, toRemove);
  summary.errors = summary.errors.slice(0, 20);
  return summary;
}

module.exports = {
  PRUNABLE_CODES,
  isPrunableToken,
  pruneDeadTokensByUid,
  sendPushToUser,
};
