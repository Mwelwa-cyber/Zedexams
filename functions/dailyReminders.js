/**
 * Daily streak-reminder push (Audit A5.2).
 *
 * Cron at 16:00 Africa/Lusaka. Targets learners whose streaks are on the
 * line — i.e. they practised yesterday but haven't yet today — and sends
 * a friendly nudge via FCM. Tokens are collected client-side by A5.1's
 * registerToken helper into users/{uid}.fcmTokens.
 *
 * 16:00 is intentional: late enough that most learners who would have
 * practised already have, early enough that a nudge still leaves time to
 * sit down with the device before bedtime. We can A/B-tune later.
 *
 * NotRegistered tokens (the OS revoked the subscription, or the user
 * uninstalled the PWA) are pruned in-place — keeps fcmTokens tidy without
 * a separate sweep.
 *
 * Observability: writes a summary to agentJobs (department: "growth")
 * matching the existing Quill / Cala pattern, so the /admin/agents
 * dashboard surfaces this cron's stats alongside the others.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");

const REMINDER_OPTS = {
  schedule: "every day 16:00",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 540, // up to 9 min — generous so a slow batch doesn't truncate
  memory: "512MiB",
};

// users.lastAttemptDate is written client-side via
// `new Date().toISOString().slice(0,10)` — i.e. a UTC YYYY-MM-DD. This
// cron fires at 16:00 Africa/Lusaka (UTC+2, no DST) which is 14:00 UTC,
// so the UTC date and the Lusaka date are always the same calendar day
// at fire time. Sticking to UTC avoids drift relative to the field
// already in Firestore.
function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const dailyStreakReminders = onSchedule(REMINDER_OPTS, async () => {
  const db = admin.firestore();
  const messaging = admin.messaging();
  const start = Date.now();

  const today = dateKey(0);
  const yesterday = dateKey(-1);

  // Target users who practised yesterday but not today. Single equality
  // query is index-free; we filter in memory for the rest. At 1k learners
  // this is cheap; if the user base hits 100k we'll switch to a
  // collectionGroup index on lastAttemptDate.
  const snap = await db
    .collection("users")
    .where("lastAttemptDate", "==", yesterday)
    .get()
    .catch((err) => {
      console.error("[dailyStreakReminders] query failed", err);
      return null;
    });

  const summary = {
    dateKey: today,
    candidates: 0,
    sent: 0,
    failed: 0,
    pruned: 0,
    errors: [],
  };

  if (!snap || snap.empty) {
    await db.collection("agentJobs").add({
      agentId: "daily-reminder",
      department: "growth",
      status: "done",
      input: {runType: "daily-streak-reminder", dateKey: today},
      output: {reminder: summary},
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  // Collect (uid, token) pairs across all candidates so we can batch.
  // sendEachForMulticast accepts up to 500 tokens per call.
  const pairs = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    if (data.lastAttemptDate === today) continue; // raced — already practised
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
    if (tokens.length === 0) continue;
    summary.candidates += 1;
    for (const token of tokens) {
      pairs.push({uid: docSnap.id, token});
    }
  }

  // Per-token bookkeeping — group bad tokens back to their user so we can
  // remove them in a single arrayRemove update.
  const tokensToRemoveByUid = new Map();

  const BATCH = 500;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const slice = pairs.slice(i, i + BATCH);
    const message = {
      tokens: slice.map((p) => p.token),
      notification: {
        title: "Pako misses you 👋",
        body: "Take today's quiz to keep your streak alive!",
      },
      webpush: {
        fcmOptions: {
          // Open the dashboard when the learner taps the notification.
          link: "https://zedexams.com/dashboard",
        },
        notification: {
          icon: "/zedexams-logo.png?v=4",
          badge: "/zedexams-logo.png?v=4",
        },
      },
    };

    let response;
    try {
      response = await messaging.sendEachForMulticast(message);
    } catch (err) {
      console.error("[dailyStreakReminders] sendEachForMulticast failed", err);
      summary.errors.push(String(err && err.message || err).slice(0, 200));
      summary.failed += slice.length;
      continue;
    }

    summary.sent += response.successCount;
    summary.failed += response.failureCount;

    response.responses.forEach((res, idx) => {
      if (res.success) return;
      const code = res.error && res.error.code;
      // The "user uninstalled / revoked" codes — safe to prune.
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        const {uid, token} = slice[idx];
        if (!tokensToRemoveByUid.has(uid)) tokensToRemoveByUid.set(uid, []);
        tokensToRemoveByUid.get(uid).push(token);
      } else if (res.error) {
        summary.errors.push(
            String(res.error.message || res.error.code || "unknown").slice(0, 200),
        );
      }
    });
  }

  // Prune dead tokens — best-effort; one updateDoc per user. arrayRemove
  // is idempotent so a race with a fresh registerToken on the client
  // can't corrupt anything.
  for (const [uid, deadTokens] of tokensToRemoveByUid.entries()) {
    try {
      await db.collection("users").doc(uid).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...deadTokens),
      });
      summary.pruned += deadTokens.length;
    } catch (err) {
      console.warn(`[dailyStreakReminders] prune for ${uid} failed`, err);
    }
  }

  // Truncate the errors array so the agentJobs doc stays small.
  summary.errors = summary.errors.slice(0, 20);

  await db.collection("agentJobs").add({
    agentId: "daily-reminder",
    department: "growth",
    status: summary.failed > 0 ? "awaiting_approval" : "done",
    input: {runType: "daily-streak-reminder", dateKey: today},
    output: {reminder: summary},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

module.exports = {dailyStreakReminders};
