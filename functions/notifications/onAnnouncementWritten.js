/**
 * Announcement fan-out.
 *
 * When an admin publishes an announcement (announcements/{annId} with
 * active: true), this Firestore trigger fans it out into each targeted user's
 * notification feed asynchronously — so the admin's single doc write stays fast
 * and the N per-user writes happen here in the background.
 *
 * Idempotency: the announcement doc is stamped notificationsFannedOut: true the
 * moment fan-out starts; the self-triggered onWritten (and any retry) sees the
 * flag and bails. This also lets an admin create an announcement inactive and
 * flip it active later — the activation edit fans it out then.
 *
 * Pinned to africa-south1 (shares the Firestore region). Users are paginated by
 * document id and role-filtered in memory so no extra composite index is needed.
 */

const admin = require("firebase-admin");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {createNotification} = require("./createNotification");

const COMMON_OPTS = {
  region: "africa-south1",
  timeoutSeconds: 300,
  memory: "512MiB",
};

const PAGE = 400;
const MAX_USERS = 50000; // safety ceiling

// Map an announcement audience to the matching role set, or null for everyone.
function audienceRoles(audience) {
  switch (audience) {
    case "learners":
      return ["learner"];
    case "teachers":
      return ["teacher"];
    case "admins":
      return ["admin", "superAdmin"];
    case "all":
    default:
      return null;
  }
}

function audienceMatchesRole(audience, role) {
  const roles = audienceRoles(audience);
  if (roles === null) return true;
  return roles.includes(role);
}

const onAnnouncementWritten = onDocumentWritten(
    {document: "announcements/{annId}", ...COMMON_OPTS},
    async (event) => {
      const annId = event.params.annId;
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;
      if (!after) return; // deleted
      if (after.active !== true) return; // only fan out live announcements
      if (after.notificationsFannedOut === true) return; // already done

      const db = admin.firestore();

      // Claim the announcement first so the self-triggered onWritten and any
      // retry can't double-deliver. If we can't claim it, bail.
      try {
        await event.data.after.ref.update({
          notificationsFannedOut: true,
          notificationsFannedOutAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn(`[notifications] announcement ${annId} claim failed`, err);
        return;
      }

      const title = String(after.title || "Announcement").slice(0, 200);
      const body = String(after.body || "").slice(0, 1000);
      const priority =
        after.severity === "critical" || after.severity === "warning" ?
          "high" :
          "medium";

      let last = null;
      let delivered = 0;
      let scanned = 0;
      try {
        // Paginate all users by id; role-filter in memory (index-free).
        while (true) {
          let q = db.collection("users").orderBy("__name__").limit(PAGE);
          if (last) q = q.startAfter(last);
          const snap = await q.get();
          if (snap.empty) break;
          for (const docSnap of snap.docs) {
            scanned += 1;
            const data = docSnap.data() || {};
            const role = typeof data.role === "string" ? data.role : "learner";
            if (!audienceMatchesRole(after.audience, role)) continue;
            const res = await createNotification({
              uid: docSnap.id,
              category: "announcements",
              type: "announcement",
              title,
              body,
              priority,
              icon: "megaphone",
              source: `announcement:${annId}`,
              // The notificationsFannedOut flag is the idempotency guard, so we
              // skip the per-user dedupe query, and reuse the user doc we just
              // read to skip a second read.
              userData: data,
            });
            if (res.written) delivered += 1;
          }
          last = snap.docs[snap.docs.length - 1];
          if (snap.size < PAGE || scanned >= MAX_USERS) break;
        }
        if (scanned >= MAX_USERS) {
          console.warn(
              `[notifications] announcement ${annId} hit the ${MAX_USERS} user ceiling — some users not notified`,
          );
        }
        console.log(
            `[notifications] announcement ${annId} fanned out to ${delivered}/${scanned}`,
        );
      } catch (err) {
        console.error(`[notifications] announcement ${annId} fan-out failed`, err);
      }
    },
);

module.exports = {onAnnouncementWritten, audienceRoles, audienceMatchesRole};
