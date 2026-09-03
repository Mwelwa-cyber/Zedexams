"use strict";

/**
 * teacherTrialOnUserCreatedHandler — grants the free teacher trial once, on
 * the creation of users/{uid}.
 *
 * Only the HANDLER BODY lives here; the trigger is built in
 * functions/index.js (`onDocumentCreated({document: "users/{uid}", region:
 * "africa-south1", ...}, ...)`) so its region/timeout stay inside the
 * Phase 5 manifest guard (test:functions-manifest) — see the comment there
 * for why. Same document path as guardianConsent/onUserCreated.js; Cloud
 * Functions runs both triggers independently, so this needed no changes to
 * the age-bootstrap trigger and vice versa.
 *
 * Written with the admin SDK from a trigger, never from the client: the
 * users create rule (firestore.rules) pins teacherPlan / teacherTrialEndsAt /
 * teacherTrialStartedAt to null on the signup setDoc, exactly like it already
 * pins teacherPlan / teacherPlanExpiresAt for a paid grant — a client cannot
 * mint its own trial (or backdate/extend one) by crafting the create payload.
 *
 * Failure posture: a throw here means a teacher account with no trial
 * granted — resolveTeacherPlan already treats that as Free, which is exactly
 * where the account would have started without this trigger. A missed grant
 * degrades to "no trial", never to an unintended one.
 */

const admin = require("firebase-admin");

const {resolveTeacherTrialGrant} = require("./teacherTrialCore");

async function teacherTrialOnUserCreatedHandler(event) {
  const snap = event.data;
  if (!snap) return;
  const user = snap.data();
  if (!user) return;

  try {
    const grant = resolveTeacherTrialGrant(user);
    if (!grant) return;

    await snap.ref.set({
      teacherPlan: grant.teacherPlan,
      teacherTrialEndsAt: admin.firestore.Timestamp.fromMillis(grant.teacherTrialEndsAtMs),
      teacherTrialStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.error("[teacherTrialOnUserCreated] failed:", err);
  }
}

module.exports = {teacherTrialOnUserCreatedHandler};
