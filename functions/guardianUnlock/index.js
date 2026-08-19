"use strict";

/**
 * functions/guardianUnlock — "ask your guardian to unlock this".
 *
 * The conversion engine. A learner under 18 is never shown a price; they tap a
 * lock, the sheet offers to ask, and THIS is what the guardian receives: a
 * progress report with an offer at the end of it. The payer has, in most
 * cases, never opened the app — so what reaches them first has to be evidence
 * that their child is working, not an invoice from a stranger.
 *
 * Two surfaces:
 *   requestGuardianUnlock  callable   — the learner asks
 *   settleGuardianRequest  helper     — called from subscriptionActivation
 *                                       when a payment carrying a request id
 *                                       lands, so the request is marked paid
 *                                       and the learner is told
 *
 * ── The rules, and why each one is here ────────────────────────────────
 *
 *   • The caller is the learner, always. `request.auth.uid` — never a uid in
 *     the payload, which would let any signed-in account send a message about
 *     any child to any guardian on file.
 *
 *   • Fail closed on the contact. No guardian record, an empty contact, or a
 *     guardian who already declined → `no_guardian`, and nothing is sent.
 *
 *   • The 72-hour limit is enforced HERE. The client's copy keeps the button
 *     honest; this one is the control, because the other runs on the learner's
 *     device.
 *
 *   • Message order is fixed by `functions/shared/guardian/guardianMessageCore`
 *     and this module cannot reorder it: evidence → the ask → exam countdown →
 *     price. Never price first.
 *
 *   • The pay link is a signed, single-use, expiring URL to a checkout that
 *     does not require the guardian to have an account. Its token is stored
 *     HASHED — a leak of `guardianRequests` must not hand anybody the ability
 *     to pay on, or read about, an arbitrary child.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const {
  MAX_NOTIFIED_PARENTS,
  OUTCOME,
  PAY_LINK_TTL_DAYS,
  REQUESTABLE_GATES,
  buildParentAskNotification,
  buildProgressPayload,
  chooseQuotedPlan,
  decideRateLimit,
  resolveGuardianContact,
} = require("./guardianUnlockCore");

// Already in Secret Manager and bound to sendPasswordResetEmail /
// sendGuardianConsent, so binding them here cannot cause the "no value for the
// secret" deploy hard-fail documented in index.js.
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

const REQUESTS = "guardianRequests";
const CHECKOUT_URL = "https://zedexams.com/guardian-unlock";
const TOKEN_BYTES = 32;

function mintToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

/** Never store the raw token — the doc id is its sha256. */
function tokenDocId(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

async function sendEmailMessage({to, subject, text}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {user: senderEmail, pass: emailSmtpPassword.value()},
    tls: {minVersion: "TLSv1.2", servername: "mail.privateemail.com"},
  });
  await transporter.sendMail({
    from: `ZedExams <${senderEmail}>`,
    sender: senderEmail,
    to,
    replyTo: senderEmail,
    subject,
    text,
    envelope: {from: senderEmail, to: [to]},
    messageId: `<guardian-unlock-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
}

/**
 * The learner's recent evidence. Deliberately small: one results read and the
 * user doc we already hold. A richer report is not worth a fan-out on a path a
 * child can trigger.
 */
async function readEvidence(db, uid) {
  try {
    const snap = await db.collection("results")
        .where("userId", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
    return snap.docs.map((d) => d.data());
  } catch (err) {
    // An unreadable results collection means a message with less evidence, not
    // no message: the ask still stands on the exam countdown and the request
    // itself. It must never be reported to the learner as a failure to send.
    console.warn("[guardianUnlock] evidence read failed", err);
    return [];
  }
}

/**
 * Put the ask in the inbox of every linked parent ACCOUNT.
 *
 * `parentLinks` is the authenticated parent↔child relationship behind the
 * family portal — a different, verified thing from the guardian contact the
 * child typed, which is why both are served: the contact gets the email, and
 * an account that already exists gets it where they are already signed in.
 *
 * Best-effort in every direction. A parent with no account, an unreadable
 * link table, or a failed write must not change what the learner is told
 * about their request — the email is the delivery that matters and it has
 * already gone.
 *
 * @returns {Promise<{notified: number}>}
 */
async function notifyLinkedParents({db, learnerUid, learnerName, clause}) {
  let links = [];
  try {
    const snap = await db.collection("parentLinks")
        .where("learnerUid", "==", learnerUid)
        .limit(MAX_NOTIFIED_PARENTS)
        .get();
    // Active links only. A pending link is somebody who typed a code and
    // has not been confirmed by the child; telling them what the child is
    // asking to unlock would leak the child's activity to exactly the
    // person the confirmation step has not yet vouched for.
    const {activeLinks} = require("../familyPortalCore");
    links = activeLinks(snap.docs.map((d) => d.data() || {}));
  } catch (err) {
    console.warn("[guardianUnlock] parentLinks read failed", err);
    return {notified: 0};
  }
  if (links.length === 0) return {notified: 0};

  const notification = buildParentAskNotification({
    learnerName,
    learnerUid,
    requestClause: clause,
  });
  const {createNotification} = require("../notifications/createNotification");

  let notified = 0;
  // Sequential rather than parallel: this is at most MAX_NOTIFIED_PARENTS
  // writes on a path a child triggers, and one slow parent must not be able
  // to make the callable time out.
  for (const link of links) {
    const parentUid = typeof link.parentUid === "string" ? link.parentUid : "";
    if (!parentUid) continue;
    try {
      const res = await createNotification({...notification, uid: parentUid, db});
      if (res.written) notified += 1;
    } catch (err) {
      console.warn("[guardianUnlock] parent notification failed", err);
    }
  }
  return {notified};
}

exports.requestGuardianUnlock = onCall(
    {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      const uid = request.auth.uid;
      const db = admin.firestore();

      const feature = String(request.data?.feature || "").trim();
      if (!REQUESTABLE_GATES.includes(feature)) {
        throw new HttpsError("invalid-argument", "Unknown feature.");
      }

      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) {
        throw new HttpsError("failed-precondition", "Profile not found.");
      }
      const user = userSnap.data();

      const contact = resolveGuardianContact(user);
      if (!contact.ok) {
        return {outcome: OUTCOME.NO_GUARDIAN};
      }

      // Rate limit BEFORE any read of evidence or any token mint: a refused
      // request must cost us nothing.
      const limit = decideRateLimit(user.guardianUnlock?.lastRequestAt, new Date());
      if (!limit.allowed) {
        return {outcome: OUTCOME.RATE_LIMITED, retryAfterMs: limit.retryAfterMs};
      }

      // The shared package is ESM and this codebase is CommonJS, so it is
      // reached with `await import` INSIDE the handler — never a top-level
      // require. Same rule as functions/shared/assessment and
      // functions/shared/consent.
      const {buildGuardianMessage, requestClause} =
        await import("../shared/guardian/guardianMessageCore.js");
      const {daysToExam} = require("./examCountdown");

      const results = await readEvidence(db, uid);
      const payloadBase = buildProgressPayload({
        recentResults: results,
        progress: user.progress || user,
        clientContext: request.data?.context || {},
      });

      const days = daysToExam(user.grade, new Date());
      const plan = chooseQuotedPlan(days, new Date());

      const rawToken = mintToken();
      const expiresAt = new Date(Date.now() + PAY_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
      const payUrl = `${CHECKOUT_URL}?t=${encodeURIComponent(rawToken)}`;

      const message = buildGuardianMessage({
        ...payloadBase,
        learnerName: user.firstName || user.displayName || user.name || "",
        feature,
        grade: user.grade || null,
        daysToExam: days,
        plan,
        payUrl,
      });

      const requestId = tokenDocId(rawToken);
      await db.collection(REQUESTS).doc(requestId).set({
        uid,
        feature,
        // The contact is stored so support can answer "who did you message?"
        // and so an account purge can find it. The raw token is not stored.
        contact: contact.contact,
        method: contact.method,
        planId: plan.checkoutPlanId,
        priceZMW: plan.price,
        status: "sent",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
        used: false,
      });

      // Stamped BEFORE the send. If the mail transport then fails, the learner
      // has burned their 72 hours — which is the correct direction: the
      // alternative is a retry loop that can put four messages in a parent's
      // inbox because our SMTP was flaky.
      await db.doc(`users/${uid}`).set(
          {guardianUnlock: {lastRequestAt: admin.firestore.FieldValue.serverTimestamp()}},
          {merge: true},
      );

      if (contact.method === "email") {
        await sendEmailMessage({
          to: contact.contact,
          subject: `${user.firstName || "Your child"}'s progress on ZedExams`,
          text: message.text,
        });
      } else {
        // WhatsApp outbound is limited to a 24-hour customer-service window a
        // guardian who has never messaged us is not in (see metaWhatsApp.js).
        // Email is the delivery channel; the WhatsApp contact is recorded so a
        // future template-message path can use it without another migration.
        console.warn("[guardianUnlock] whatsapp contact — no outbound window, not sent", {uid});
        return {outcome: OUTCOME.NO_GUARDIAN};
      }

      // Mirror to the learner's bell so the request survives the sheet closing.
      try {
        const {createNotification} = require("../notifications/createNotification");
        await createNotification({
          uid,
          category: "account",
          type: "guardian_request_sent",
          title: "Request sent to your guardian",
          body: "We sent them a short update on how you are doing and what you asked to unlock.",
          dedupeKey: `guardian-request:${feature}`,
          db,
        });
      } catch (err) {
        console.warn("[guardianUnlock] learner notification failed", err);
      }

      // …and to any linked parent ACCOUNT's inbox. Never throws: the email
      // above is the delivery this callable reports on.
      try {
        await notifyLinkedParents({
          db,
          learnerUid: uid,
          learnerName: user.firstName || user.displayName || user.name || "",
          clause: requestClause({
            feature,
            remaining: payloadBase.remaining,
          }),
        });
      } catch (err) {
        console.warn("[guardianUnlock] linked-parent notification failed", err);
      }

      return {outcome: OUTCOME.SENT};
    },
);

/**
 * Settle a guardian request once its payment lands.
 *
 * Called from `subscriptionActivation` after the plan has been activated, so
 * the learner's access is already live by the time they are told. Best-effort
 * and never throws: a failure here must not undo a subscription somebody paid
 * for.
 *
 * @param {object} opts
 * @param {string} opts.requestId  the hashed token / doc id
 * @param {object} [opts.db]
 */
async function settleGuardianRequest({requestId, db = admin.firestore()} = {}) {
  if (!requestId) return {ok: false, reason: "no-request-id"};
  try {
    const ref = db.collection(REQUESTS).doc(String(requestId));
    const snap = await ref.get();
    if (!snap.exists) return {ok: false, reason: "not-found"};
    const record = snap.data();
    if (record.status === "paid") return {ok: true, already: true};

    await ref.set({
      status: "paid",
      used: true,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    try {
      const {createNotification} = require("../notifications/createNotification");
      await createNotification({
        uid: record.uid,
        category: "account",
        type: "guardian_request_approved",
        title: "Your guardian unlocked it",
        body: "Everything you asked for is open now. Your streak and badges are exactly where you left them.",
        dedupeKey: `guardian-approved:${requestId}`,
        db,
      });
    } catch (err) {
      console.warn("[guardianUnlock] approval notification failed", err);
    }
    return {ok: true};
  } catch (err) {
    console.error("[guardianUnlock] settle failed", err);
    return {ok: false, reason: "error"};
  }
}

exports.settleGuardianRequest = settleGuardianRequest;
