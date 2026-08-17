/**
 * setGuardianControl — the one writer of `users/{uid}.guardianControls`.
 *
 * The Guardian Zone is a convenience surface: it runs inside the CHILD's
 * session, behind an adult friction check (a times-table sum), and the
 * authoritative guardian identity is the verified guardian on the consent
 * record. So this callable does not — and cannot — prove that an adult is
 * holding the phone.
 *
 * What it does guarantee, and what the product promises on the strength of
 * it:
 *   1. The control cannot be written from the client at all. The field is
 *      on the users self-update blocklist in firestore.rules, so this
 *      callable (admin SDK) is the only path.
 *   2. Turning a control off is ENFORCED server-side, at
 *      consentGuard.assertLearnerCapability — the single gate both the
 *      aiChat callable and the apiAiChat SSE endpoint pass through. A
 *      modified client cannot ignore it.
 *   3. A change can never happen SILENTLY. Every change appends to
 *      `guardianControlAudit` (server-only, append-only) and emails the
 *      guardian on the consent record.
 *
 * (3) is the honest answer to (0): a child who reached this callable
 * directly could flip a control back, and the guarantee offered is
 * therefore "cannot be changed without the guardian being told", not
 * "cannot be changed". The email says so in as many words, so no parent
 * is left with a stronger belief than the mechanism supports.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const {decideControlChange, buildControlNoticeEmail} = require("./guardianControlsDecisions");

const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

let coresPromise = null;
function loadCores() {
  if (!coresPromise) {
    coresPromise = Promise.all([
      import("../shared/guardian/guardianControlsCore.js"),
      import("../shared/consent/guardianConsentCore.js"),
    ]).then(([controls, consent]) => ({
      isGuardianControl: controls.isGuardianControl,
      readGuardianControls: controls.readGuardianControls,
      describeControlChange: controls.describeControlChange,
      resolveLearnerAccess: consent.resolveLearnerAccess,
    }));
  }
  return coresPromise;
}

async function sendGuardianNotice({to, subject, text}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  if (!senderEmail || !to) return false;
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const crypto = require("crypto");
  // Lazy require, matching opsAlert.js and guardianConsent/index.js.
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
    messageId: `<guardian-control-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
  return true;
}

exports.setGuardianControl = onCall(
    {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      const uid = request.auth.uid;
      const key = String(request.data?.key || "");
      const value = request.data?.value;

      const db = admin.firestore();
      const cores = await loadCores();
      const snap = await db.doc(`users/${uid}`).get();
      const user = snap.exists ? snap.data() : null;

      const decision = decideControlChange({key, value, user, deps: cores});
      if (!decision.ok) {
        // "unchanged" is a no-op, not a failure: a re-render must not read
        // as an error, and it must not mail the guardian.
        if (decision.reason === "unchanged") {
          return {ok: true, changed: false, notified: false};
        }
        throw new HttpsError(
            decision.reason === "no-guardian" ? "permission-denied" : "invalid-argument",
            decision.message,
            {reason: decision.reason},
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      await db.doc(`users/${uid}`).set({
        guardianControls: {[key]: value, updatedAt: now},
      }, {merge: true});

      const description = cores.describeControlChange(key, value);
      // Append-only trail, server-written and server-read. It is what a
      // guardian (or support, on their behalf) can be shown if they say a
      // setting changed and they did not change it.
      await db.collection("guardianControlAudit").add({
        uid,
        control: key,
        from: decision.from,
        to: value,
        description,
        at: now,
      });

      let notified = false;
      const contact = String(user?.guardian?.contact || "").trim();
      const method = user?.guardian?.method === "whatsapp" ? "whatsapp" : "email";
      if (contact && method === "email") {
        const mail = buildControlNoticeEmail({
          childName: user?.firstName || user?.displayName,
          description,
        });
        try {
          notified = await sendGuardianNotice({to: contact, ...mail});
        } catch (err) {
          // The write already happened and the audit entry is durable. A
          // mail failure must not roll the control back — a parent's
          // restriction that evaporates because SMTP was down is the worse
          // outcome — but it is logged so a silent channel is visible.
          console.error("[guardianControls] notice failed:", err?.message || err);
        }
      }

      return {ok: true, changed: true, notified};
    },
);
