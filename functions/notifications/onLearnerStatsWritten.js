/**
 * Streak-milestone notifications.
 *
 * Watches learnerStats/{uid} (where gamificationService writes currentStreak)
 * and fires a celebratory notification when a learner's streak crosses 7, 30 or
 * 100 days. Server-authored via a Firestore trigger so the milestone can't be
 * forged by a tampered client (which can write its own learnerStats but cannot
 * write into notifications/{uid}/feed — create is server-only).
 *
 * Pinned to africa-south1 to share a region with the (default) Firestore
 * database, matching the other onDocument* triggers.
 */

const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {createNotification} = require("./createNotification");

const COMMON_OPTS = {
  region: "africa-south1",
  timeoutSeconds: 60,
  memory: "256MiB",
};

const MILESTONES = [7, 30, 100];

const onLearnerStatsWritten = onDocumentWritten(
    {document: "learnerStats/{uid}", ...COMMON_OPTS},
    async (event) => {
      const uid = event.params.uid;
      const before = event.data && event.data.before && event.data.before.exists ?
        event.data.before.data() : null;
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;
      if (!after) return;

      const prevStreak = Number((before && before.currentStreak) || 0);
      const curStreak = Number(after.currentStreak || 0);
      // Only react to an increase, and only when it crosses a milestone.
      if (curStreak <= prevStreak) return;
      const milestone = MILESTONES.find((m) => curStreak >= m && prevStreak < m);
      if (!milestone) return;

      try {
        await createNotification({
          uid,
          category: "learning",
          type: "streak_milestone",
          title: `${milestone}-day streak! 🔥`,
          body: `You've practised ${milestone} days in a row. Amazing work — keep it going!`,
          priority: "medium",
          icon: "academic-cap",
          action: {label: "View your streak", url: "/dashboard"},
          // One notification per milestone per day window — guards retries.
          dedupeKey: `streak-${milestone}`,
          source: "streak-milestone",
        });
      } catch (err) {
        console.warn(
            `[notifications] streak milestone for ${uid} failed`,
            (err && err.message) || err,
        );
      }
    },
);

module.exports = {onLearnerStatsWritten, MILESTONES};
