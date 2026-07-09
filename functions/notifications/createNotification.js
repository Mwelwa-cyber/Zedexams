/**
 * createNotification — the single server-side entry point for delivering a
 * notification to a ZedExams user.
 *
 * Every trigger / cron / callable that wants to notify a user calls this. It:
 *   1. reads the user's notificationPrefs + fcmTokens once,
 *   2. decides (pure gating in notificationPrefsCore) whether to write in-app
 *      and whether to push,
 *   3. dedupes against a recent identical notification (dedupeKey + 24h window),
 *   4. writes the in-app doc to notifications/{uid}/items,
 *   5. best-effort sends an FCM push via the shared sender.
 *
 * It is a PLAIN async function (not a Cloud Function), so it inherits the
 * caller's deployment region — Firestore-trigger callers must be africa-south1,
 * cron/callable callers us-central1. It never throws on the push path: a failed
 * push must not roll back a written notification.
 *
 * firebase-admin is required lazily (stubbed in tests via Module._load).
 */

const {
  normalizeServerPrefs,
  shouldWriteInApp,
  shouldSendPush,
  buildFcmPayload,
  defaultIconFor,
  isCategory,
} = require("./notificationPrefsCore");
const { sendPushToUser } = require("./sendPushToUser");

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 90;

function clampString(value, max) {
  if (value == null) return "";
  return String(value).slice(0, max);
}

function sanitizeAction(action) {
  if (!action || typeof action !== "object") return null;
  const label = clampString(action.label, 60);
  const url = clampString(action.url, 500);
  if (!label || !url) return null;
  return { label, url };
}

/**
 * @param {object} opts
 * @param {string} opts.uid              recipient
 * @param {string} opts.category         one of notificationPrefsCore.CATEGORIES
 * @param {string} opts.type             fine-grained type, e.g. 'payment_failed'
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.icon]           heroicon key; defaults per-category
 * @param {'low'|'medium'|'high'} [opts.priority]
 * @param {{label:string,url:string}} [opts.action]
 * @param {string} [opts.dedupeKey]      suppress identical notif within 24h
 * @param {boolean} [opts.sendPush=true]
 * @param {string} [opts.source='system']
 * @param {number} [opts.expiresInDays=90]
 * @param {object} [opts.db]             firestore() (defaults to admin.firestore())
 * @param {object} [opts.messaging]      messaging() (defaults to admin.messaging())
 * @param {object} [opts.userData]       pre-fetched users/{uid} data — pass it
 *                                        to skip the read (e.g. fan-out loops
 *                                        that already hold the user doc).
 * @param {Date}   [opts.now]            injectable clock for tests
 * @returns {Promise<{written:boolean, id?:string, pushed:boolean, deduped:boolean, reason?:string}>}
 */
async function createNotification(opts = {}) {
  const admin = require("firebase-admin");
  const {
    uid,
    category,
    type,
    title,
    body,
    icon,
    priority = "medium",
    action,
    dedupeKey = null,
    sendPush = true,
    source = "system",
    expiresInDays = DEFAULT_EXPIRY_DAYS,
    db = admin.firestore(),
    messaging = admin.messaging(),
    userData: prefetchedUserData = null,
    now = new Date(),
  } = opts;

  if (!uid || typeof uid !== "string") {
    return { written: false, pushed: false, deduped: false, reason: "no_uid" };
  }
  if (!isCategory(category)) {
    return { written: false, pushed: false, deduped: false, reason: "bad_category" };
  }

  // Read prefs + tokens once (unless the caller already holds the user doc).
  let userData = prefetchedUserData && typeof prefetchedUserData === "object"
    ? prefetchedUserData
    : null;
  if (!userData) {
    try {
      const userSnap = await db.collection("users").doc(uid).get();
      userData = (userSnap.exists ? userSnap.data() : {}) || {};
    } catch (err) {
      console.warn(`[createNotification] user read failed for ${uid}`, err);
      userData = {};
    }
  }
  const prefs = normalizeServerPrefs(userData.notificationPrefs);

  // Respect opt-out for the in-app write (critical categories always pass).
  if (!shouldWriteInApp(prefs, category)) {
    return { written: false, pushed: false, deduped: false, reason: "inapp_suppressed" };
  }

  const itemsRef = db
    .collection("notifications")
    .doc(uid)
    .collection("feed");

  // Dedupe: skip if an identical-key notification landed in the last 24h.
  if (dedupeKey) {
    try {
      const cutoff = admin.firestore.Timestamp.fromMillis(
          now.getTime() - DEDUPE_WINDOW_MS,
      );
      const dup = await itemsRef
          .where("dedupeKey", "==", dedupeKey)
          .where("createdAt", ">=", cutoff)
          .limit(1)
          .get();
      if (!dup.empty) {
        return { written: false, pushed: false, deduped: true };
      }
    } catch (err) {
      // A dedupe-query failure must not block the notification.
      console.warn("[createNotification] dedupe query failed", err);
    }
  }

  const safePriority = ["low", "medium", "high"].includes(priority)
    ? priority
    : "medium";
  const safeAction = sanitizeAction(action);

  const docData = {
    category,
    type: clampString(type, 80) || "generic",
    title: clampString(title, 200),
    body: clampString(body, 1000),
    icon: clampString(icon, 60) || defaultIconFor(category),
    priority: safePriority,
    action: safeAction,
    read: false,
    readAt: null,
    dedupeKey: dedupeKey ? clampString(dedupeKey, 200) : null,
    source: clampString(source, 60) || "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(
        now.getTime() + expiresInDays * 24 * 60 * 60 * 1000,
    ),
  };

  let id;
  try {
    const ref = await itemsRef.add(docData);
    id = ref.id;
  } catch (err) {
    console.error(`[createNotification] write failed for ${uid}`, err);
    return { written: false, pushed: false, deduped: false, reason: "write_failed" };
  }

  // Best-effort push — never throws back to the caller.
  let pushed = false;
  if (sendPush && shouldSendPush(prefs, category, now)) {
    const tokens = Array.isArray(userData.fcmTokens) ? userData.fcmTokens : [];
    if (tokens.length > 0) {
      try {
        const payload = buildFcmPayload({
          title,
          body,
          action: safeAction,
          category,
          type,
        });
        const res = await sendPushToUser({ messaging, db, uid, tokens, payload });
        pushed = res.sent > 0;
      } catch (err) {
        console.warn(`[createNotification] push failed for ${uid}`, err);
      }
    }
  }

  return { written: true, id, pushed, deduped: false };
}

module.exports = { createNotification, DEDUPE_WINDOW_MS, DEFAULT_EXPIRY_DAYS };
