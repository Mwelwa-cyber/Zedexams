"use strict";

/**
 * functions/guardianConsent — the guardian approval flow.
 *
 * Three surfaces:
 *   sendGuardianConsent      callable  — learner asks us to message their guardian
 *   apiGuardianConsent       onRequest — the link in that message (GET renders,
 *                                        POST decides); Hosting rewrite /consent
 *   recordAgeGateAttempt     callable  — cooldown behind the neutral age screen
 *
 * Design notes that are easy to get wrong and expensive to get wrong:
 *
 *   • The consent token is stored HASHED (consentTokens.js). The raw value
 *     lives only in the guardian's message and URL bar, so a leak of the
 *     Firestore collection does not hand over the ability to approve — or
 *     delete — arbitrary children's accounts.
 *
 *   • Approving and declining are POSTs. A GET that acts would be triggered
 *     by every mail scanner and link prefetcher that touches the message.
 *
 *   • The decision is applied in a TRANSACTION that re-reads `used`. Two
 *     clicks arriving together (a guardian double-tapping on a slow
 *     connection, or approve and decline from two devices) must produce one
 *     outcome, not a race whose winner depends on Firestore latency.
 *
 *   • `recordAgeGateAttempt` is UNAUTHENTICATED by necessity — it runs before
 *     an account exists. It therefore stores nothing but a hash and a
 *     timestamp, and is rate-limited by IP.
 */

const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
// nodemailer is required lazily at its use site — see invoiceGenerator.js.

const {applyCors} = require("../cors");
const {enforceRateLimit, standardBuckets, resolveClientIp} = require("../rateLimit");
const {
  mintToken,
  tokenDocId,
  isWellFormedToken,
  expiryFrom,
  buildConsentLinks,
  TOKEN_TTL_DAYS,
} = require("./consentTokens");
const {buildConsentEmail, buildConsentWhatsAppText, safeName} = require("./consentMessages");
const {
  WITHDRAWN_DELETION_DAYS,
  grantedRecord,
  deniedRecord,
} = require("./consentRecord");
const {
  renderDecisionPage,
  renderApprovedPage,
  renderDeclinedPage,
  renderOutcomePage,
} = require("./consentPages");

// Already stored in Secret Manager and bound to sendPasswordResetEmail, so
// binding them here cannot cause the "no value for the secret" deploy
// hard-fail documented in index.js.
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

const CONSENT_URL = "https://zedexams.com/consent";
const REQUESTS = "consentRequests";
const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ── sendGuardianConsent ───────────────────────────────────────────────────

const GUARDIAN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUARDIAN_PHONE_RE = /^\+?\d{9,15}$/;

/**
 * Validate a guardian contact supplied by the client.
 *
 * Returns null when nothing was supplied (the ordinary resend path, where the
 * contact is already on file), and throws on a supplied-but-unusable value —
 * silently ignoring a bad contact would show the learner "sent" for a message
 * that went nowhere.
 */
function validateGuardianContact(data) {
  const raw = String(data?.contact || "").trim();
  if (!raw) return null;
  const method = data?.method === "whatsapp" ? "whatsapp" : "email";
  const ok = method === "email" ?
    GUARDIAN_EMAIL_RE.test(raw) :
    GUARDIAN_PHONE_RE.test(raw.replace(/[\s-]/g, ""));
  if (!ok) {
    throw new HttpsError(
        "invalid-argument",
        method === "email" ?
          "That doesn't look like an email address." :
          "That doesn't look like a WhatsApp number.",
    );
  }
  return {contact: raw.slice(0, 254), method};
}

async function sendEmailMessage({to, subject, text}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  // Lazy require, matching opsAlert.js — see the note in invoiceGenerator.js.
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
    messageId: `<guardian-consent-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
}

exports.sendGuardianConsent = onCall(
    {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      const uid = request.auth.uid;
      const db = admin.firestore();

      const snap = await db.doc(`users/${uid}`).get();
      const user = snap.data();
      if (!user || user.role !== "learner") {
        throw new HttpsError("failed-precondition", "This account does not need guardian approval.");
      }
      if (user.guardian?.consentStatus === "granted") {
        return {ok: true, alreadyGranted: true};
      }

      // The guardian contact is written HERE, not by the client.
      // firestore.rules blocks the client from touching `guardian` at all,
      // because a client that could edit it could also edit consentStatus.
      // So the migration banner — the path for accounts that predate this
      // flow and have no guardian on file — supplies the contact as a
      // parameter and the server validates and stores it.
      //
      // Honest limitation: a determined learner can enter their OWN address
      // and approve themselves. No email-based consent flow prevents that,
      // which is why Play treats this as a good-faith mechanism rather than
      // an identity check. What the flow does guarantee is that whoever is
      // named is told what we hold about the child and is given a one-click
      // way to delete the account. Changing an address once approval is
      // pending is allowed for the same reason it is not a security boundary:
      // refusing would only strand the honest case of a mistyped address.
      const supplied = validateGuardianContact(request.data);
      let contact = String(user.guardian?.contact || "").trim();
      let method = user.guardian?.method === "whatsapp" ? "whatsapp" : "email";

      if (supplied) {
        contact = supplied.contact;
        method = supplied.method;
        await db.doc(`users/${uid}`).set({
          guardian: {
            contact,
            method,
            consentStatus: "pending",
            requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, {merge: true});
      }

      if (!contact) {
        throw new HttpsError(
            "failed-precondition",
            "Please add a parent or guardian's email address or WhatsApp number.",
        );
      }

      // One message a day. The recipient did not ask for any of this, and a
      // resend button a child can tap is a way to make a parent's inbox
      // unusable — accidentally or otherwise.
      const lastSent = user.guardian?.lastSentAt?.toDate?.();
      if (lastSent && Date.now() - lastSent.getTime() < RESEND_COOLDOWN_MS) {
        throw new HttpsError(
            "resource-exhausted",
            "We already sent a link today. Please check with your parent or guardian, and try again tomorrow.",
        );
      }

      const rawToken = mintToken();
      const childName = safeName(user.firstName || user.displayName || user.name);

      await db.collection(REQUESTS).doc(tokenDocId(rawToken)).set({
        uid,
        method,
        // The contact is stored so support can answer "who did you message?"
        // and so the purge can find it. The raw token is NOT stored.
        contact,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: expiryFrom(),
        used: false,
      });
      await db.doc(`users/${uid}`).set(
          {guardian: {lastSentAt: admin.firestore.FieldValue.serverTimestamp()}},
          {merge: true},
      );

      const {approveUrl, declineUrl} = buildConsentLinks(CONSENT_URL, rawToken);

      if (method === "email") {
        const {subject, text} = buildConsentEmail({
          childName, approveUrl, declineUrl, expiryDays: TOKEN_TTL_DAYS,
        });
        await sendEmailMessage({to: contact, subject, text});
        return {ok: true, sent: "email"};
      }

      // WhatsApp: we return a wa.me deep link for the CLIENT to open. We do
      // not send it ourselves, because the outbound WhatsApp channel
      // (metaWhatsApp.js) can only message a number inside a 24-hour customer
      // service window, which a guardian who has never contacted us is not in.
      // Opening the composer on the child's device puts the message in front
      // of the parent immediately, which is the point.
      const waText = encodeURIComponent(
          buildConsentWhatsAppText({childName, approveUrl, declineUrl}),
      );
      return {
        ok: true,
        sent: "whatsapp_link",
        waLink: `https://wa.me/${contact.replace(/\D/g, "")}?text=${waText}`,
      };
    },
);

// ── apiGuardianConsent ────────────────────────────────────────────────────

/**
 * Apply a guardian's decision exactly once.
 *
 * The transaction re-reads `used` inside itself, so a double-tap on a slow
 * connection — or approve on a phone and decline on a laptop — resolves to
 * one outcome instead of a race. `already` tells the caller which page to
 * render without a second read.
 */
async function applyDecision(db, docRef, decision) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return {outcome: "invalid"};
    const record = snap.data();
    if (record.used === true) return {outcome: "used"};
    const expiresAt = record.expiresAt?.toDate?.() || record.expiresAt;
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      return {outcome: "invalid"};
    }
    if (expiresAt.getTime() <= Date.now()) return {outcome: "expired"};

    const userRef = db.doc(`users/${record.uid}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return {outcome: "invalid"};

    const now = admin.firestore.FieldValue.serverTimestamp();
    // The record's SHAPE lives in consentRecord.js, shared with the
    // family-code and parent-app routes to the same decision — three
    // places writing "approved" three ways is how one of them ends up
    // without the evidence a regulator asks for.
    const evidence = {
      via: "link",
      ip: record.clickIp || "",
      userAgent: record.clickUserAgent || "",
      tokenId: docRef.id,
    };

    if (decision === "decline") {
      // Suspended immediately. The guardian was told the account is
      // deactivated, so it has to actually be.
      tx.set(userRef, deniedRecord({
        now,
        evidence,
        reason: "guardian_declined",
        deletionAt: new Date(Date.now() + WITHDRAWN_DELETION_DAYS * 24 * 60 * 60 * 1000),
      }), {merge: true});
      tx.update(docRef, {used: true, outcome: "denied", decidedAt: now});
      return {outcome: "declined", childName: userSnap.data()?.firstName};
    }

    tx.set(userRef, grantedRecord({now, evidence}), {merge: true});
    tx.update(docRef, {used: true, outcome: "granted", decidedAt: now});
    return {outcome: "approved", childName: userSnap.data()?.firstName};
  });
}

async function handleConsent(req, res, deps = {}) {
  const db = deps.db || admin.firestore();
  const cors = deps.applyCors || applyCors;
  const rateLimitFn = deps.enforceRateLimit || enforceRateLimit;
  const send = (status, html) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    // The page carries a bearer token in its form. Keep it out of caches and
    // out of the referrer of any link the guardian follows next.
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Referrer-Policy", "no-referrer");
    res.status(status).send(html);
  };

  try {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const token = String(
        (req.method === "POST" ? req.body?.token : req.query?.token) || "",
    ).trim();
    if (!isWellFormedToken(token)) {
      // Rejected on shape alone — no database read, so probing costs nothing.
      return send(400, renderOutcomePage("invalid"));
    }

    const ip = resolveClientIp(req);
    const rl = await rateLimitFn(db, standardBuckets({
      action: "guardian-consent", ip, ipPerMin: 30,
    })).catch(() => ({allowed: true}));
    if (!rl.allowed) return send(429, renderOutcomePage("error"));

    const docRef = db.collection(REQUESTS).doc(tokenDocId(token));

    if (req.method === "GET") {
      const snap = await docRef.get();
      if (!snap.exists) return send(404, renderOutcomePage("invalid"));
      const record = snap.data();
      if (record.used === true) return send(200, renderOutcomePage("used"));
      const expiresAt = record.expiresAt?.toDate?.() || record.expiresAt;
      if (!(expiresAt instanceof Date) || expiresAt.getTime() <= Date.now()) {
        return send(410, renderOutcomePage("expired"));
      }
      // Record the viewing client so the decision can carry it as evidence.
      // Best-effort: failing to note it must not block the guardian.
      await docRef.update({
        clickIp: ip || "",
        clickUserAgent: String(req.get("user-agent") || "").slice(0, 300),
        viewedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      const userSnap = await db.doc(`users/${record.uid}`).get();
      return send(200, renderDecisionPage({
        childName: safeName(userSnap.data()?.firstName || userSnap.data()?.displayName),
        token,
        actionUrl: CONSENT_URL,
      }));
    }

    if (req.method !== "POST") {
      return send(405, renderOutcomePage("error"));
    }

    const decision = String(req.body?.decision || "").trim();
    if (decision !== "approve" && decision !== "decline") {
      return send(400, renderOutcomePage("invalid"));
    }

    const result = await applyDecision(db, docRef, decision);
    if (result.outcome === "approved") return send(200, renderApprovedPage({childName: safeName(result.childName)}));
    if (result.outcome === "declined") return send(200, renderDeclinedPage());
    return send(result.outcome === "used" ? 200 : 410, renderOutcomePage(result.outcome));
  } catch (err) {
    console.error("[guardianConsent] failed:", err);
    try {
      if (!res.headersSent) send(500, renderOutcomePage("error"));
    } catch (_e) { /* response already closed */ }
  }
}

exports.apiGuardianConsent = onRequest(
    {region: "us-central1", timeoutSeconds: 30, memory: "256MiB"},
    (req, res) => handleConsent(req, res),
);

// ── recordAgeGateAttempt ──────────────────────────────────────────────────

/**
 * The neutral-age-screen cooldown.
 *
 * Play's neutrality requirement is not only about wording: a screen a user can
 * immediately retry with a different birthday is not a gate, it is a quiz with
 * the answer written on the back. This records one attempt per device and
 * refuses a second within 24 hours.
 *
 * UNAUTHENTICATED by necessity — it runs before the account exists. So it
 * stores nothing but a hash of the client-supplied device id and a timestamp.
 * The device id never reaches Firestore in a form that can be linked back to a
 * person, and there is nothing in the document to identify anyone if it leaks.
 *
 * It is a speed bump, not a wall: someone determined to lie about their age
 * can clear storage or reinstall. That is true of every age screen ever built,
 * including the ones Play ships itself, and the requirement is a good-faith
 * mechanism rather than an unbreakable one.
 */
exports.recordAgeGateAttempt = onCall(
    {region: "us-central1", timeoutSeconds: 15},
    async (request) => {
      const raw = String(request.data?.deviceId || "").trim();
      if (raw.length < 8 || raw.length > 200) {
        throw new HttpsError("invalid-argument", "A device identifier is required.");
      }
      const db = admin.firestore();
      const ip = resolveClientIp(request.rawRequest || {});

      // Unauthenticated write endpoint — cap it per IP.
      const rl = await enforceRateLimit(db, standardBuckets({
        action: "age-gate-attempt", ip, ipPerMin: 20,
      })).catch(() => ({allowed: true}));
      if (!rl.allowed) {
        throw new HttpsError("resource-exhausted", "Too many attempts. Please try again shortly.");
      }

      const id = crypto.createHash("sha256").update(raw).digest("hex");
      const ref = db.collection("ageGateAttempts").doc(id);
      const snap = await ref.get();
      const now = Date.now();
      const at = snap.exists ? snap.data()?.at?.toDate?.() : null;

      if (at && now - at.getTime() < RESEND_COOLDOWN_MS) {
        return {blocked: true, retryAfterMs: RESEND_COOLDOWN_MS - (now - at.getTime())};
      }
      await ref.set({
        at: admin.firestore.FieldValue.serverTimestamp(),
        // TTL field so these expire on their own — nothing here is worth
        // keeping once the cooldown has elapsed.
        expiresAt: new Date(now + RESEND_COOLDOWN_MS),
      });
      return {blocked: false};
    },
);

// Exported for unit tests. The deployed surfaces are the three above.
exports.handleConsent = handleConsent;
exports.applyDecision = applyDecision;
exports.CONSENT_URL = CONSENT_URL;
exports.REQUESTS = REQUESTS;
exports.RESEND_COOLDOWN_MS = RESEND_COOLDOWN_MS;
