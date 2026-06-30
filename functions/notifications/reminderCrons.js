/**
 * Scheduled notification reminders + housekeeping for the Smart Notification
 * System. All crons run in us-central1 (HTTP/scheduled functions stay there;
 * only Firestore-triggered functions move to africa-south1) on Africa/Lusaka
 * civil time.
 *
 *   • dailyPracticeReminders   — in-app "keep your streak alive" nudge for
 *                                learners who practised yesterday but not today.
 *                                Push is intentionally OFF here (the existing
 *                                dailyStreakReminders cron owns the push); this
 *                                adds the persistent in-app record.
 *   • subscriptionExpiryReminders — notify users whose subscription lapses in
 *                                ≤3 days, with a per-user cooldown stamp.
 *   • archiveOldNotifications  — delete notifications past their 90-day
 *                                expiresAt (the in-repo backstop for the
 *                                Firestore TTL policy).
 *
 * Reminders dedupe two ways: a dedupeKey on the notification (createNotification
 * suppresses repeats inside 24h) AND a cooldown stamp written only on success.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {createNotification} = require("./createNotification");

const BASE_OPTS = {
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  memory: "256MiB",
};

function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ── Daily practice (in-app) ────────────────────────────────────────────────
const dailyPracticeReminders = onSchedule(
    {...BASE_OPTS, schedule: "every day 16:30", timeoutSeconds: 540},
    async () => {
      const db = admin.firestore();
      const today = dateKey(0);
      const yesterday = dateKey(-1);
      const summary = {dateKey: today, candidates: 0, written: 0};

      // Learners who kept a streak going yesterday but haven't practised today.
      const snap = await db
          .collection("users")
          .where("lastAttemptDate", "==", yesterday)
          .get()
          .catch((err) => {
            console.error("[dailyPracticeReminders] query failed", err);
            return null;
          });
      if (!snap || snap.empty) return;

      for (const docSnap of snap.docs) {
        const data = docSnap.data() || {};
        if (data.lastAttemptDate === today) continue; // already practised
        if (data.role && data.role !== "learner") continue;
        summary.candidates += 1;
        try {
          const res = await createNotification({
            uid: docSnap.id,
            category: "learning",
            type: "daily_practice",
            title: "Your daily practice is ready",
            body: "Complete today's quiz to keep your learning streak alive.",
            priority: "low",
            icon: "academic-cap",
            action: {label: "Practise now", url: "/dashboard"},
            dedupeKey: `daily-practice-${today}`,
            sendPush: false, // dailyStreakReminders owns the push
            source: "daily-practice-reminder",
            userData: data,
          });
          if (res.written) summary.written += 1;
        } catch (err) {
          console.warn(
              `[dailyPracticeReminders] ${docSnap.id} failed`,
              (err && err.message) || err,
          );
        }
      }
      console.log(
          `[dailyPracticeReminders] ${summary.written}/${summary.candidates} written`,
      );
    },
);

// ── Subscription expiry ────────────────────────────────────────────────────
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const subscriptionExpiryReminders = onSchedule(
    {...BASE_OPTS, schedule: "every day 08:00", timeoutSeconds: 540},
    async () => {
      const db = admin.firestore();
      const now = new Date();
      const cutoff = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const summary = {candidates: 0, written: 0};

      // Range on a single field → no composite index needed. premium filtered
      // in memory.
      const snap = await db
          .collection("users")
          .where("subscriptionExpiry", ">", admin.firestore.Timestamp.fromDate(now))
          .where("subscriptionExpiry", "<=", admin.firestore.Timestamp.fromDate(cutoff))
          .limit(500)
          .get()
          .catch((err) => {
            console.error("[subscriptionExpiryReminders] query failed", err);
            return null;
          });
      if (!snap || snap.empty) return;

      for (const docSnap of snap.docs) {
        const data = docSnap.data() || {};
        if (!(data.premium === true || data.isPremium === true)) continue;
        const last = data.notifyExpiryReminderAt &&
          typeof data.notifyExpiryReminderAt.toMillis === "function" ?
          data.notifyExpiryReminderAt.toMillis() : 0;
        if (last && now.getTime() - last < COOLDOWN_MS) continue; // cooled down
        summary.candidates += 1;

        const expiry = data.subscriptionExpiry &&
          typeof data.subscriptionExpiry.toDate === "function" ?
          data.subscriptionExpiry.toDate() : null;
        const days = expiry ?
          Math.max(1, Math.ceil((expiry.getTime() - now.getTime()) / 86400000)) :
          3;

        try {
          const res = await createNotification({
            uid: docSnap.id,
            category: "payments",
            type: "subscription_expiry",
            title: "Your subscription is expiring soon",
            body: `Your plan ends in ${days} day${days === 1 ? "" : "s"}. Renew to keep full access.`,
            priority: "high",
            icon: "credit-card",
            action: {label: "Renew now", url: "/subscription"},
            dedupeKey: `expiry-${dateKey(0)}`,
            source: "subscription-expiry-reminder",
            userData: data,
          });
          if (res.written) {
            summary.written += 1;
            await docSnap.ref
                .update({
                  notifyExpiryReminderAt: admin.firestore.FieldValue.serverTimestamp(),
                })
                .catch(() => {});
          }
        } catch (err) {
          console.warn(
              `[subscriptionExpiryReminders] ${docSnap.id} failed`,
              (err && err.message) || err,
          );
        }
      }
      console.log(
          `[subscriptionExpiryReminders] ${summary.written}/${summary.candidates} written`,
      );
    },
);

// ── Archival (90-day cleanup backstop for the TTL policy) ───────────────────
const archiveOldNotifications = onSchedule(
    {...BASE_OPTS, schedule: "every day 03:30", timeoutSeconds: 540},
    async () => {
      const db = admin.firestore();
      const now = admin.firestore.Timestamp.now();
      let deleted = 0;
      try {
        // collectionGroup over every user's feed; the single-field expiresAt
        // index is automatic. Delete in batches until none remain (capped).
        for (let round = 0; round < 50; round++) {
          const snap = await db
              .collectionGroup("feed")
              .where("expiresAt", "<=", now)
              .limit(450)
              .get();
          if (snap.empty) break;
          const batch = db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          deleted += snap.size;
          if (snap.size < 450) break;
        }
      } catch (err) {
        console.error("[archiveOldNotifications] failed", err);
      }
      console.log(`[archiveOldNotifications] deleted ${deleted} expired notifications`);
    },
);

module.exports = {
  dailyPracticeReminders,
  subscriptionExpiryReminders,
  archiveOldNotifications,
};
