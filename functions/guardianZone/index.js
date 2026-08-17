"use strict";

/**
 * functions/guardianZone — the write half of the in-app Guardian Zone.
 *
 * Three callables:
 *   requestGuardianPinSetup  — email the verified guardian a one-time code
 *   setGuardianPin           — exchange that code (or the current PIN) for a new PIN
 *   setGuardianControls      — change what the child may do, behind the PIN
 *
 * ── Why any of this needs a server ───────────────────────────────────────
 *
 * The zone opens behind "what is 7 × 8". That gate is friction — a twelve
 * year old can multiply — so it protects the READ side only. Every write goes
 * through here, because the whole point of a guardian control is that the
 * child cannot change it, and a control the child's own client could write is
 * a preference with a padlock drawn on it.
 *
 * The asymmetry we actually have is the guardian's inbox. The consent flow
 * already verified an address by making a link sent to it the only way an
 * account leaves limited mode; this reuses that address, and nothing else, to
 * authorise the first PIN. A child who can read their guardian's email can
 * defeat this — and can also just approve their own account, which
 * guardianConsent's own comments say plainly. No email-based flow does better.
 *
 * ── What is NOT here ─────────────────────────────────────────────────────
 *
 * There is no read callable. The dashboard shows the child's own progress,
 * weak topics and recent activity, and the child's client can already read all
 * of it under the ordinary owner rules — it is their data. Adding a
 * privileged read path would widen the server's surface to re-serve documents
 * the caller can already fetch.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const {assertCallableRateLimit} = require("../rateLimit");
const {
  mintSalt,
  hashPin,
  verifyPin,
  mintSetupCode,
  hashSetupCode,
  verifySetupCode,
  buildPinSetupEmail,
} = require("./guardianZoneCore");

// Already in Secret Manager and bound to sendGuardianConsent, so binding them
// here cannot cause the "no value for the secret" deploy hard-fail documented
// in index.js.
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

// Server-only collections (denied to every client in firestore.rules).
const ZONE = "guardianZone";
const SETUP = "guardianZoneSetup";

// One setup email per learner per 15 minutes. The recipient did not ask for
// it, and a "send me a code" button a child can tap is a way to make a
// parent's inbox unusable — the same reasoning as the consent resend cooldown,
// with a shorter window because the code itself expires in 15 minutes.
const SETUP_RESEND_MS = 15 * 60 * 1000;

// The shared package is ESM and Cloud Functions is CommonJS, so it is reached
// with `await import(...)` INSIDE the async handler — never a top-level
// require. Cached so the dynamic import is paid once per instance.
let corePromise = null;
function loadCore() {
  if (!corePromise) {
    corePromise = import("../shared/consent/guardianControlsCore.js");
  }
  return corePromise;
}

async function sendEmailMessage({to, subject, text}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  // Lazy require, matching guardianConsent/index.js — see invoiceGenerator.js.
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
    messageId: `<guardian-zone-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
}

/**
 * The learner whose zone this is, plus the guardian we are allowed to email.
 *
 * Fails closed on every branch: no account, not a learner, no guardian record,
 * a guardian who has not approved, or a guardian we hold no EMAIL for (a
 * WhatsApp-only guardian cannot be sent a code this way — see the message).
 */
async function resolveZoneOwner(uid, db) {
  const snap = await db.doc(`users/${uid}`).get();
  const user = snap.exists ? snap.data() : null;
  if (!user || user.role !== "learner") {
    throw new HttpsError("failed-precondition", "The Guardian Zone is part of a learner account.");
  }
  const guardian = user.guardian && typeof user.guardian === "object" ? user.guardian : null;
  if (!guardian || guardian.consentStatus !== "granted") {
    throw new HttpsError(
        "failed-precondition",
        "A parent or guardian needs to approve this account first.",
    );
  }
  const email = guardian.method === "whatsapp" ? "" : String(guardian.contact || "").trim();
  return {user, guardian, email};
}

// ── requestGuardianPinSetup ───────────────────────────────────────────────

exports.requestGuardianPinSetup = onCall(
    {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      await assertCallableRateLimit(request, {action: "guardianPinSetup", userPerMin: 3});

      const uid = request.auth.uid;
      const db = admin.firestore();
      const {user, email} = await resolveZoneOwner(uid, db);

      if (!email) {
        throw new HttpsError(
            "failed-precondition",
            "We do not have an email address for your parent or guardian. Ask them to " +
            "approve the account by email first.",
        );
      }

      const setupRef = db.doc(`${SETUP}/${uid}`);
      const existing = await setupRef.get();
      const sentAt = existing.exists ? existing.data()?.sentAt?.toDate?.() : null;
      if (sentAt && Date.now() - sentAt.getTime() < SETUP_RESEND_MS) {
        throw new HttpsError(
            "resource-exhausted",
            "We already sent a code. Please check the inbox, and try again in a few minutes.",
        );
      }

      const {SETUP_CODE_TTL_MS} = await loadCore();
      const code = mintSetupCode();
      const salt = mintSalt();

      // The raw code is never stored — same rule as the consent token. It
      // exists in the guardian's inbox and in whatever they type back.
      await setupRef.set({
        uid,
        codeHash: hashSetupCode(code, salt),
        salt,
        expiresAt: Date.now() + SETUP_CODE_TTL_MS,
        used: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const {subject, text} = buildPinSetupEmail({
        childName: user.firstName || user.displayName || user.name,
        code,
        ttlMinutes: Math.round(SETUP_CODE_TTL_MS / 60000),
      });
      await sendEmailMessage({to: email, subject, text});

      // The address is returned MASKED. The child is holding the screen, and
      // "we sent it to m•••@gmail.com" is enough for a parent to recognise
      // their own inbox without printing it for the child to read.
      return {ok: true, sentTo: maskEmail(email)};
    },
);

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "your guardian's email";
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
}

// ── setGuardianPin ────────────────────────────────────────────────────────

/**
 * Set or change the Guardian PIN.
 *
 * Two authorised routes, and no third:
 *   • `code`        — the six digits we emailed the verified guardian. This is
 *                     the only route when no PIN exists yet, and it is also
 *                     the "I forgot the PIN" route.
 *   • `currentPin`  — the PIN already in force.
 *
 * There is deliberately no route that lets a signed-in learner set a first PIN
 * without the code. That would let the child pick the PIN that is supposed to
 * keep them out.
 */
exports.setGuardianPin = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      await assertCallableRateLimit(request, {action: "guardianSetPin", userPerMin: 6});

      const uid = request.auth.uid;
      const db = admin.firestore();
      await resolveZoneOwner(uid, db);

      const {
        isWellFormedGuardianPin,
        isWellFormedSetupCode,
        setupCodeState,
        guardianPinAttemptState,
        guardianPinFailure,
        guardianPinSuccess,
      } = await loadCore();

      const newPin = String(request.data?.pin || "").trim();
      if (!isWellFormedGuardianPin(newPin)) {
        throw new HttpsError(
            "invalid-argument",
            "Choose a PIN of 4 to 6 digits that isn't 1234 or all the same digit.",
        );
      }

      const zoneRef = db.doc(`${ZONE}/${uid}`);
      const zoneSnap = await zoneRef.get();
      const zone = zoneSnap.exists ? zoneSnap.data() : null;
      const hasPin = Boolean(zone?.pinHash);

      const code = String(request.data?.code || "").trim();
      const currentPin = String(request.data?.currentPin || "").trim();

      if (code) {
        if (!isWellFormedSetupCode(code)) {
          throw new HttpsError("invalid-argument", "That code doesn't look right — it's 6 digits.");
        }
        const setupRef = db.doc(`${SETUP}/${uid}`);
        const setupSnap = await setupRef.get();
        const setup = setupSnap.exists ? setupSnap.data() : null;
        const state = setupCodeState(setup, Date.now());
        if (!state.ok || !verifySetupCode(code, setup?.salt, setup?.codeHash)) {
          throw new HttpsError(
              "permission-denied",
              state.reason === "expired" ?
                "That code has expired. Ask for a new one." :
                "That code is not right.",
          );
        }
        // Single use, burned before the PIN is written: a code that survived a
        // failed write could be replayed.
        await setupRef.set({used: true, usedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
      } else if (hasPin) {
        const attempt = guardianPinAttemptState(zone, Date.now());
        if (!attempt.allowed) {
          throw new HttpsError(
              "resource-exhausted",
              `Too many wrong PINs. Try again in ${Math.ceil(attempt.retryInMs / 60000)} minutes.`,
          );
        }
        if (!verifyPin(currentPin, zone.pinSalt, zone.pinHash)) {
          await zoneRef.set(guardianPinFailure(zone, Date.now()), {merge: true});
          throw new HttpsError("permission-denied", "That PIN is not right.");
        }
      } else {
        throw new HttpsError(
            "failed-precondition",
            "Ask us to email your guardian a code first.",
        );
      }

      const salt = mintSalt();
      await zoneRef.set({
        uid,
        pinHash: hashPin(newPin, salt),
        pinSalt: salt,
        pinSetAt: admin.firestore.FieldValue.serverTimestamp(),
        ...guardianPinSuccess(),
      }, {merge: true});

      return {ok: true};
    },
);

// ── setGuardianControls ───────────────────────────────────────────────────

exports.setGuardianControls = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      await assertCallableRateLimit(request, {action: "guardianControls", userPerMin: 20});

      const uid = request.auth.uid;
      const db = admin.firestore();
      await resolveZoneOwner(uid, db);

      const {
        normalizeGuardianControls,
        guardianPinAttemptState,
        guardianPinFailure,
        guardianPinSuccess,
      } = await loadCore();

      const zoneRef = db.doc(`${ZONE}/${uid}`);
      const zoneSnap = await zoneRef.get();
      const zone = zoneSnap.exists ? zoneSnap.data() : null;
      if (!zone?.pinHash) {
        throw new HttpsError(
            "failed-precondition",
            "Set a Guardian PIN before changing what this account can do.",
        );
      }

      const attempt = guardianPinAttemptState(zone, Date.now());
      if (!attempt.allowed) {
        throw new HttpsError(
            "resource-exhausted",
            `Too many wrong PINs. Try again in ${Math.ceil(attempt.retryInMs / 60000)} minutes.`,
        );
      }
      if (!verifyPin(String(request.data?.pin || "").trim(), zone.pinSalt, zone.pinHash)) {
        await zoneRef.set(guardianPinFailure(zone, Date.now()), {merge: true});
        throw new HttpsError("permission-denied", "That PIN is not right.");
      }

      // Normalised on the SERVER, from the shared module the client reads.
      // Whatever arrives, what lands in Firestore is the exact three-field
      // shape resolveLearnerAccess narrows against — a client cannot smuggle a
      // fourth field into the document and have it mean something later.
      const controls = normalizeGuardianControls(request.data?.controls);

      await db.doc(`users/${uid}`).set({
        guardianControls: {
          ...controls,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, {merge: true});
      await zoneRef.set(guardianPinSuccess(), {merge: true});

      // The audit trail a guardian would ask for, and a regulator might. Kept
      // in the server-only zone document rather than on users/{uid}, where the
      // child can read it — the child does not need the history of what their
      // parent considered.
      await zoneRef.collection("changes").add({
        controls,
        at: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {ok: true, controls};
    },
);

// ── guardianZoneStatus ────────────────────────────────────────────────────

/**
 * Does this account have a Guardian PIN yet, and is it locked out?
 *
 * The zone needs this to choose between "enter your PIN" and "let's set one
 * up", and it must be answerable WITHOUT a PIN attempt. Probing
 * verifyGuardianPin with an empty string would work, and would also burn one
 * of the five attempts on every page load — five refreshes and the parent is
 * locked out of their own controls by the UI asking a question.
 *
 * Returns nothing secret: whether a PIN exists is visible from the screen the
 * caller is already looking at.
 */
exports.guardianZoneStatus = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      await assertCallableRateLimit(request, {action: "guardianZoneStatus", userPerMin: 30});

      const uid = request.auth.uid;
      const db = admin.firestore();
      const {guardian, email} = await resolveZoneOwner(uid, db);
      const {guardianPinAttemptState} = await loadCore();

      const zoneSnap = await db.doc(`${ZONE}/${uid}`).get();
      const zone = zoneSnap.exists ? zoneSnap.data() : null;
      const attempt = guardianPinAttemptState(zone, Date.now());

      return {
        hasPin: Boolean(zone?.pinHash),
        canEmailCode: Boolean(email),
        guardianContact: email ? maskEmail(email) : "",
        method: guardian.method === "whatsapp" ? "whatsapp" : "email",
        lockedForMs: attempt.allowed ? 0 : attempt.retryInMs,
      };
    },
);

// ── verifyGuardianPin ─────────────────────────────────────────────────────

/**
 * Unlock the controls UI without changing anything.
 *
 * Separate from setGuardianControls so the zone can show the switches in a
 * usable state before the guardian touches one, rather than making the first
 * change a blind guess at whether the PIN will be accepted.
 */
exports.verifyGuardianPin = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      await assertCallableRateLimit(request, {action: "guardianVerifyPin", userPerMin: 10});

      const uid = request.auth.uid;
      const db = admin.firestore();
      await resolveZoneOwner(uid, db);

      const {
        guardianPinAttemptState,
        guardianPinFailure,
        guardianPinSuccess,
      } = await loadCore();

      const zoneRef = db.doc(`${ZONE}/${uid}`);
      const zoneSnap = await zoneRef.get();
      const zone = zoneSnap.exists ? zoneSnap.data() : null;
      if (!zone?.pinHash) {
        return {ok: false, needsSetup: true};
      }

      const attempt = guardianPinAttemptState(zone, Date.now());
      if (!attempt.allowed) {
        throw new HttpsError(
            "resource-exhausted",
            `Too many wrong PINs. Try again in ${Math.ceil(attempt.retryInMs / 60000)} minutes.`,
        );
      }
      if (!verifyPin(String(request.data?.pin || "").trim(), zone.pinSalt, zone.pinHash)) {
        await zoneRef.set(guardianPinFailure(zone, Date.now()), {merge: true});
        throw new HttpsError("permission-denied", "That PIN is not right.");
      }
      await zoneRef.set(guardianPinSuccess(), {merge: true});
      return {ok: true};
    },
);

exports.SETUP_RESEND_MS = SETUP_RESEND_MS;
exports.maskEmail = maskEmail;
