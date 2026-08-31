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
const {resolveExpiryReminderTarget} = require("./subscriptionExpiryReminderCore");

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

      // Range on a single field, ordered by it so we can paginate past the page
      // limit (more than one page of users may expire in the window at scale).
      // premium is filtered in memory.
      let last = null;
      const PAGE = 500;
      for (let round = 0; round < 40; round++) {
        let q = db
            .collection("users")
            .where("subscriptionExpiry", ">", admin.firestore.Timestamp.fromDate(now))
            .where("subscriptionExpiry", "<=", admin.firestore.Timestamp.fromDate(cutoff))
            .orderBy("subscriptionExpiry")
            .limit(PAGE);
        if (last) q = q.startAfter(last);
        const snap = await q.get().catch((err) => {
          console.error("[subscriptionExpiryReminders] query failed", err);
          return null;
        });
        if (!snap || snap.empty) break;

        for (const docSnap of snap.docs) {
          const data = docSnap.data() || {};
          if (!(data.premium === true || data.isPremium === true)) continue;
          const lastSent = data.notifyExpiryReminderAt &&
            typeof data.notifyExpiryReminderAt.toMillis === "function" ?
            data.notifyExpiryReminderAt.toMillis() : 0;
          if (lastSent && now.getTime() - lastSent < COOLDOWN_MS) continue;
          summary.candidates += 1;

          const expiry = data.subscriptionExpiry &&
            typeof data.subscriptionExpiry.toDate === "function" ?
            data.subscriptionExpiry.toDate() : null;
          const days = expiry ?
            Math.max(1, Math.ceil((expiry.getTime() - now.getTime()) / 86400000)) :
            3;

          // A guardian-funded child (PAY-001, Limit 2): redirect the
          // reminder to whoever actually pays, rather than nudging the
          // child to "Renew now" with no way to. See
          // subscriptionExpiryReminderCore.js for the full rationale.
          const target = resolveExpiryReminderTarget({uid: docSnap.id, data, days, dateKey: dateKey(0)});

          try {
            const res = await createNotification({
              uid: target.recipientUid,
              category: target.category,
              type: target.type,
              title: target.title,
              body: target.body,
              priority: "high",
              icon: "credit-card",
              action: target.action,
              dedupeKey: target.dedupeKey,
              source: "subscription-expiry-reminder",
              // Only the child's own reminder can reuse the already-fetched
              // doc as its notification-prefs/fcmTokens source. A guardian-
              // routed reminder must read the GUARDIAN's own prefs and
              // tokens, not the child's — passing `data` here would push the
              // notification to the child's device under the guardian's
              // stated preferences.
              ...(target.guardianRouted ? {} : {userData: data}),
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
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE) break;
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

// ── Weekly revision (in-app, recently-active learners) ─────────────────────
const WEEKLY_PAGE = 500;
function isLearnerRole(role) {
  return !role || role === "learner";
}

const weeklyRevisionReminder = onSchedule(
    {...BASE_OPTS, schedule: "every sunday 17:00", timeoutSeconds: 540},
    async () => {
      const db = admin.firestore();
      const weekKey = dateKey(0);
      // Only learners active in the last 6 days. The cohorts are disjoint by
      // design: 0–6 days quiet → this weekly revision nudge, 7–13 days →
      // inactiveLearnerReminder, 14–45 days → Anchor's win-back drafts. Without
      // this bound a learner 8 days quiet would get BOTH the Sunday revision
      // nudge and the win-back on the same day (different dedupeKeys, so the
      // 24h dedupe can't save them). lastAttemptDate is a YYYY-MM-DD string,
      // so a lexical range on it is correct and index-free.
      const activeSince = dateKey(-6);
      let last = null;
      let written = 0;
      for (let round = 0; round < 40; round++) {
        let q = db
            .collection("users")
            .where("lastAttemptDate", ">=", activeSince)
            .orderBy("lastAttemptDate")
            .limit(WEEKLY_PAGE);
        if (last) q = q.startAfter(last);
        const snap = await q.get().catch((err) => {
          console.error("[weeklyRevisionReminder] query failed", err);
          return null;
        });
        if (!snap || snap.empty) break;
        for (const docSnap of snap.docs) {
          const data = docSnap.data() || {};
          if (!isLearnerRole(data.role)) continue;
          try {
            const res = await createNotification({
              uid: docSnap.id,
              category: "learning",
              type: "weekly_revision",
              title: "Time for your weekly revision",
              body: "A short revision session keeps what you learned this week fresh. Pick a quiz to start.",
              priority: "low",
              icon: "academic-cap",
              action: {label: "Start revising", url: "/quizzes"},
              dedupeKey: `weekly-revision-${weekKey}`,
              source: "weekly-revision-reminder",
              userData: data,
            });
            if (res.written) written += 1;
          } catch (err) {
            console.warn(
                `[weeklyRevisionReminder] ${docSnap.id} failed`,
                (err && err.message) || err,
            );
          }
        }
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < WEEKLY_PAGE) break;
      }
      console.log(`[weeklyRevisionReminder] ${written} written`);
    },
);

// ── Inactive-learner win-back (in-app) ─────────────────────────────────────
// Learners who last practised 7–13 days ago. dailyStreakReminders owns
// "missed today"; Anchor drafts win-backs for the 14–45 day cohort. A per-user
// cooldown stamp keeps us from nagging every day inside the window.
const WINBACK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const inactiveLearnerReminder = onSchedule(
    {...BASE_OPTS, schedule: "every day 10:00", timeoutSeconds: 540},
    async () => {
      const db = admin.firestore();
      const now = Date.now();
      const from = dateKey(-13);
      const to = dateKey(-7);
      let last = null;
      let written = 0;
      for (let round = 0; round < 40; round++) {
        let q = db
            .collection("users")
            .where("lastAttemptDate", ">=", from)
            .where("lastAttemptDate", "<=", to)
            .orderBy("lastAttemptDate")
            .limit(WEEKLY_PAGE);
        if (last) q = q.startAfter(last);
        const snap = await q.get().catch((err) => {
          console.error("[inactiveLearnerReminder] query failed", err);
          return null;
        });
        if (!snap || snap.empty) break;
        for (const docSnap of snap.docs) {
          const data = docSnap.data() || {};
          if (!isLearnerRole(data.role)) continue;
          const lastSent = data.notifyWinbackAt &&
            typeof data.notifyWinbackAt.toMillis === "function" ?
            data.notifyWinbackAt.toMillis() : 0;
          if (lastSent && now - lastSent < WINBACK_COOLDOWN_MS) continue;
          try {
            const res = await createNotification({
              uid: docSnap.id,
              category: "learning",
              type: "winback",
              title: "We miss you! 👋",
              body: "It's been a few days. Jump back in with a quick quiz — your progress is waiting.",
              priority: "low",
              icon: "academic-cap",
              action: {label: "Resume learning", url: "/dashboard"},
              dedupeKey: `winback-${dateKey(0)}`,
              source: "inactive-learner-reminder",
              userData: data,
            });
            if (res.written) {
              written += 1;
              await docSnap.ref
                  .update({
                    notifyWinbackAt: admin.firestore.FieldValue.serverTimestamp(),
                  })
                  .catch(() => {});
            }
          } catch (err) {
            console.warn(
                `[inactiveLearnerReminder] ${docSnap.id} failed`,
                (err && err.message) || err,
            );
          }
        }
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < WEEKLY_PAGE) break;
      }
      console.log(`[inactiveLearnerReminder] ${written} written`);
    },
);

module.exports = {
  dailyPracticeReminders,
  weeklyRevisionReminder,
  inactiveLearnerReminder,
  subscriptionExpiryReminders,
  archiveOldNotifications,
};
