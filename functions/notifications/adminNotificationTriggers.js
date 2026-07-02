/**
 * Admin-facing notification triggers.
 *
 * Firestore triggers (africa-south1, colocated with the database) that drop an
 * operational notification into every admin's in-app centre — the in-app
 * complement to the existing email ops alerts. Best-effort: a notification
 * failure never affects the underlying write.
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { notifyAdmins } = require("./notifyAudience");

const COMMON_OPTS = {
  region: "africa-south1",
  timeoutSeconds: 60,
  memory: "256MiB",
};

// New user registered → tell the admins (new_teacher / new_learner).
const onUserCreatedNotifyAdmins = onDocumentCreated(
    { document: "users/{uid}", ...COMMON_OPTS },
    async (event) => {
      const data = event.data && event.data.exists ? event.data.data() : null;
      if (!data) return;
      const role = typeof data.role === "string" ? data.role : "learner";
      if (role !== "teacher" && role !== "learner") return; // ignore admin seeds
      try {
        await notifyAdmins(role === "teacher" ? "new_teacher" : "new_learner", {
          uid: event.params.uid,
          name: data.displayName || "",
          email: data.email || "",
          grade: data.grade || null,
        });
      } catch (err) {
        console.warn("[adminNotify] new-user notify failed", (err && err.message) || err);
      }
    },
);

// New feedback / bug report submitted → tell the admins.
const onFeedbackCreatedNotifyAdmins = onDocumentCreated(
    { document: "feedback/{feedbackId}", ...COMMON_OPTS },
    async (event) => {
      const data = event.data && event.data.exists ? event.data.data() : null;
      if (!data) return;
      try {
        await notifyAdmins("new_feedback", {
          feedbackId: event.params.feedbackId,
          feedbackType: data.type || "feedback",
          role: data.role || "user",
          message: data.message || "",
        });
      } catch (err) {
        console.warn("[adminNotify] feedback notify failed", (err && err.message) || err);
      }
    },
);

module.exports = { onUserCreatedNotifyAdmins, onFeedbackCreatedNotifyAdmins };
