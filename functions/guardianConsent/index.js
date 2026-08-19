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
 *
 *   • A guardian is reached on WHATSAPP or email, and WhatsApp is the
 *     default. Plenty of Zambian guardians have no inbox they check; nearly
 *     all have WhatsApp, which is already how this product reaches them for
 *     MTN and Airtel payments. The channel lives on the user document beside
 *     the contact so a resend goes out the way the first message did.
 *
 *   • `dryRun` validates and returns the real outbound message WITHOUT
 *     sending it, minting a token, or spending a send. The child confirms
 *     what the adult will receive before it goes.
 *
 *   • The `same_device` channel messages nobody: it mints a token and hands
 *     back the consent URL for the grown-up in the room to decide on this
 *     phone. It is the same page, the same confirmation and the same
 *     transaction as the emailed link.
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
const {
  buildConsentEmail,
  buildConsentWhatsAppText,
  buildConsentPreview,
  safeName,
} = require("./consentMessages");
const {attachOnApproval} = require("../guardianLink/convergence");

// The shared ESM link vocabulary, reached the CommonJS way: `await
// import(...)` inside the async handler, cached per instance.
let linkCorePromise = null;
function loadLinkCore() {
  if (!linkCorePromise) linkCorePromise = import("../shared/guardian/guardianLinkCore.js");
  return linkCorePromise;
}
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
// The AGE-GATE cooldown. Guardian message pacing is no longer a flat daily
// cooldown — it is the backoff ladder in
// functions/shared/consent/guardianContactCore.js, because a wrong number
// noticed thirty seconds later must be fixable in minutes.
const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ── sendGuardianConsent ───────────────────────────────────────────────────

// The shared package is ESM and Cloud Functions is CommonJS, so it is reached
// with `await import(...)` INSIDE the handler — never a top-level require.
// Cached so the dynamic import is paid once per instance. Same pattern as
// consentGuard.js.
let contactCorePromise = null;
function loadContactCore() {
  if (!contactCorePromise) {
    contactCorePromise = import("../shared/consent/guardianContactCore.js");
  }
  return contactCorePromise;
}

/**
 * Validate and normalise a guardian contact supplied by the client.
 *
 * Returns null when nothing was supplied (the ordinary resend path, where the
 * contact is already on file), and throws on a supplied-but-unusable value —
 * silently ignoring a bad contact would show the learner "sent" for a message
 * that went nowhere.
 *
 * The shapes it accepts are the shared core's, NOT a regex kept in step by
 * hand: the pair of expressions this replaced accepted `/^\+?\d{9,15}$/` for
 * WhatsApp, which is every string of nine to fifteen digits — a landline, a
 * truncated number, a bank account — and then sent a message nobody received.
 */
function resolveSuppliedContact(core, data) {
  const raw = String(data?.contact || "").trim();
  if (!raw) return null;
  // `channel` is the name this flow uses; `method` is what the live client
  // sends and what the user document has always stored. Both are read so a
  // cached client keeps working through the deploy.
  const channel = data?.channel || data?.method;
  const result = core.normalizeGuardianContact({contact: raw, channel});
  if (!result.ok) {
    throw new HttpsError("invalid-argument", result.message, {reason: result.reason});
  }
  return result;
}

/**
 * Refuse a contact that is the learner's own, or one that already signs in as
 * a learner.
 *
 * A child who names themselves approves their own account, and the consent
 * record then states that a guardian agreed when nobody did — which is worse
 * than having no record, because that record is the evidence we would show a
 * regulator. It cannot be made airtight (a second address is a minute's
 * work); it can be made non-accidental, and it can say out loud what the step
 * is for.
 *
 * The registered-account check runs for email only. Learner documents carry
 * an email and, in this product, no phone number — so a phone query would be
 * a read that can only ever return nothing, and its absence is the honest
 * statement of what we can actually check.
 */
async function assertContactIsNotTheLearner(db, core, {uid, user, contact}) {
  if (core.contactMatchesLearner(contact, user)) {
    throw new HttpsError(
        "invalid-argument",
        core.CONTACT_REJECTION_MESSAGE[core.CONTACT_REJECTION.OWN_CONTACT],
        {reason: core.CONTACT_REJECTION.OWN_CONTACT},
    );
  }
  if (contact.channel !== core.CONTACT_CHANNEL.EMAIL) return;

  const matches = await db.collection("users")
      .where("email", "==", contact.value)
      .limit(5)
      .get()
      .catch(() => null);
  // A failed lookup must not block a real guardian: the check is a courtesy
  // that catches the sibling's account, not a security boundary.
  if (!matches) return;
  const clash = matches.docs.some((d) => d.id !== uid && d.data()?.role === "learner");
  if (clash) {
    throw new HttpsError(
        "invalid-argument",
        core.CONTACT_REJECTION_MESSAGE[core.CONTACT_REJECTION.LEARNER_ACCOUNT],
        {reason: core.CONTACT_REJECTION.LEARNER_ACCOUNT},
    );
  }
}

/**
 * How a refused send is explained to a child.
 *
 * Every branch says when — or who to ask — because "too many requests" to a
 * ten-year-old is indistinguishable from a broken app.
 */
function sendRefusalMessage(core, decision) {
  if (decision.reason === core.SEND_REFUSAL.TOO_SOON) {
    return `We already sent a message. You can send another one in ${core.describeWait(decision.waitMs)}.`;
  }
  if (decision.reason === core.SEND_REFUSAL.CONTACT_EXHAUSTED) {
    return "We've sent this contact several messages already. Ask your grown-up to check " +
      "their phone, or try a different number.";
  }
  return "We've sent as many messages as we can for now. Tap \u201cTell us and we'll help\u201d " +
    "and we'll sort it out with you.";
}

/**
 * The per-destination cap: one phone number or inbox may be messaged five
 * times a day by everyone, together.
 *
 * The per-learner ladder alone bounds one child; this bounds one RECIPIENT,
 * which is the difference between a rate limit and an anti-abuse control —
 * without it, thirty accounts each politely within their own ladder can still
 * be pointed at one stranger's phone.
 *
 * The destination is HASHED into the bucket key: `rateLimits` documents are
 * operational data with ids that end up in logs and exports, and a parent's
 * phone number does not belong in either.
 */
function destinationBucket(core, contact) {
  return {
    scope: `guardian-consent-dest:${crypto.createHash("sha256").update(contact.key).digest("hex").slice(0, 32)}`,
    limit: core.MAX_SENDS_PER_DESTINATION_DAY,
    windowMs: core.DESTINATION_WINDOW_MS,
  };
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

/**
 * Ask us to reach a guardian — or to hand the phone to the one in the room.
 *
 * Four things this call does, and the order matters because each protects the
 * next:
 *
 *   dryRun    validate everything and return the message the guardian will
 *             actually receive, without sending it or consuming a send. The
 *             child confirms it on the next screen. A mistyped digit is
 *             invisible to everyone otherwise — the child waits, the guardian
 *             got nothing, and support cannot see why the account is stuck.
 *
 *   whatsapp  return a wa.me deep link for the CLIENT to open. We do not send
 *             it ourselves: the outbound WhatsApp channel (metaWhatsApp.js)
 *             can only message a number inside a 24-hour customer-service
 *             window, which a guardian who has never contacted us is not in.
 *             Opening the composer on the child's device puts the message in
 *             front of the parent immediately, which is the point.
 *
 *   email     sent by us, as before.
 *
 *   same_device  mint the token and return the consent URL. Nobody is
 *             messaged; the adult standing next to the child decides on this
 *             phone. It lands on the SAME page the emailed link lands on, so
 *             the record it writes carries the same evidence and the same
 *             "I am this child's guardian" confirmation — see consentPages.
 *             Many learners share one phone with the adult who owns it, and
 *             handing it over converts far better than a message that may
 *             never be opened.
 */
exports.sendGuardianConsent = onCall(
    {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      const uid = request.auth.uid;
      const db = admin.firestore();
      const core = await loadContactCore();
      const now = Date.now();

      const snap = await db.doc(`users/${uid}`).get();
      const user = snap.data();
      if (!user || user.role !== "learner") {
        throw new HttpsError("failed-precondition", "This account does not need guardian approval.");
      }
      if (user.guardian?.consentStatus === "granted") {
        return {ok: true, alreadyGranted: true};
      }

      const childName = safeName(user.firstName || user.displayName || user.name);
      const wantsSameDevice =
        (request.data?.channel || request.data?.method) === core.CONTACT_CHANNEL.SAME_DEVICE;

      // ── The grown-up is in the room ─────────────────────────────────────
      if (wantsSameDevice) {
        // Bounded by the ordinary per-user limiter rather than by the message
        // ladder: this path messages nobody, so it cannot bury an inbox, and
        // charging a child's message budget for handing over their own phone
        // would punish the route we most want them to take. What it can do is
        // mint tokens, so the limiter caps the rate at which it does.
        const rl = await enforceRateLimit(db, standardBuckets({
          action: "guardian-consent-here",
          uid,
          ip: resolveClientIp(request.rawRequest || {}),
          userPerMin: 5,
          ipPerMin: 30,
        })).catch(() => ({allowed: true}));
        if (!rl.allowed) {
          throw new HttpsError("resource-exhausted", "Please wait a moment and try again.");
        }

        const rawToken = mintToken();
        await db.collection(REQUESTS).doc(tokenDocId(rawToken)).set({
          uid,
          method: core.CONTACT_CHANNEL.SAME_DEVICE,
          channel: core.CONTACT_CHANNEL.SAME_DEVICE,
          contact: "",
          // Written explicitly rather than left absent, so every request doc
          // has the same shape. It is null and stays null: nobody was
          // messaged, so there is no address for the guardian-account
          // convergence to attach this approval to. The child can still name
          // a contact later, from the dashboard banner.
          contactEmailKey: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: expiryFrom(),
          used: false,
        });
        // The contact already on file (if any) is deliberately left alone: a
        // guardian deciding here does not un-name the one the child gave.
        await db.doc(`users/${uid}`).set({
          guardian: {
            consentStatus: "pending",
            requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, {merge: true});

        const {approveUrl} = buildConsentLinks(CONSENT_URL, rawToken);
        return {ok: true, sent: "same_device", consentUrl: approveUrl};
      }

      // ── A message to somebody ───────────────────────────────────────────
      // The guardian contact is written HERE, not by the client.
      // firestore.rules blocks the client from touching `guardian` at all,
      // because a client that could edit it could also edit consentStatus.
      //
      // Honest limitation: a determined learner can find a second address and
      // approve themselves. No message-based consent flow prevents that,
      // which is why Play treats this as a good-faith mechanism rather than
      // an identity check. What the flow does guarantee is that whoever is
      // named is told what we hold about the child and is given a one-click
      // way to delete the account. Changing an address once approval is
      // pending is allowed for the same reason it is not a security boundary:
      // refusing would only strand the honest case of a mistyped address.
      const supplied = resolveSuppliedContact(core, request.data);
      if (supplied) {
        await assertContactIsNotTheLearner(db, core, {uid, user, contact: supplied});
      }

      const stored = user.guardian || {};
      const contact = supplied || (stored.contact ? core.normalizeGuardianContact({
        contact: stored.contact,
        channel: stored.channel || stored.method,
      }) : null);

      if (!contact?.ok) {
        throw new HttpsError(
            "failed-precondition",
            "Please add a parent or guardian's WhatsApp number or email address.",
        );
      }

      // Pacing. Every reset — a corrected number, a quiet day — is the shared
      // core's to decide, including what the counters BECOME, so the screen
      // can explain exactly what the server will do and this handler cannot
      // re-impose a wait the core just expired.
      const decision = core.resolveSendDecision({
        sendCount: Number(stored.sendCount || 0),
        sendTotal: Number(stored.sendTotal || stored.sendCount || 0),
        lastSentAt: stored.lastSentAt?.toDate?.()?.getTime() ?? null,
        contactChanged: String(stored.contactKey || "") !== contact.key,
        now,
      });

      const preview = buildConsentPreview({channel: contact.channel, childName});

      // ── Confirm before sending ──────────────────────────────────────────
      // Nothing is written, nothing is spent, no token is minted. The child
      // sees the number grouped for reading and the message as it will
      // actually arrive, because the same builders produce both.
      if (request.data?.dryRun === true) {
        return {
          ok: true,
          dryRun: true,
          channel: contact.channel,
          contactDisplay: contact.display,
          preview,
          allowed: decision.allowed,
          ...(decision.allowed ? {} : {
            waitMs: decision.waitMs || 0,
            refusal: sendRefusalMessage(core, decision),
          }),
        };
      }

      if (!decision.allowed) {
        throw new HttpsError("resource-exhausted", sendRefusalMessage(core, decision), {
          reason: decision.reason,
          waitMs: decision.waitMs || 0,
        });
      }

      // One recipient, five messages a day, from everybody together.
      const destRl = await enforceRateLimit(db, [destinationBucket(core, contact)])
          .catch(() => ({allowed: true}));
      if (!destRl.allowed) {
        throw new HttpsError(
            "resource-exhausted",
            "This number has had several messages from ZedExams today. Please try again tomorrow.",
            {reason: core.SEND_REFUSAL.CONTACT_EXHAUSTED},
        );
      }

      const rawToken = mintToken();
      const {guardianEmailKey} = await loadLinkCore();
      const contactEmailKey = contact.channel === core.CONTACT_CHANNEL.EMAIL ?
        (guardianEmailKey(contact.value) || null) :
        null;


      await db.collection(REQUESTS).doc(tokenDocId(rawToken)).set({
        uid,
        method: contact.channel,
        channel: contact.channel,
        // The contact is stored so support can answer "who did you message?"
        // and so the purge can find it. The raw token is NOT stored.
        contact: contact.value,
        // The convergence key, canonicalised at WRITE time. Recomputing
        // it later from `contact` would work today and quietly stop
        // working the day the canonicalisation rule changes. `contact` is
        // now normalised before it is stored, which narrows that gap but
        // does not close it — the two canonicalisations answer different
        // questions and are free to diverge.
        contactEmailKey,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: expiryFrom(),
        used: false,
      });
      await db.doc(`users/${uid}`).set({
        guardian: {
          contact: contact.value,
          // `contactKey` is the comparison identity — two people type one
          // address six ways, and a change detected on the raw string would
          // reset the ladder for a retyped space.
          contactKey: contact.key,
          channel: contact.channel,
          // `method` is what every existing reader of this document looks at.
          method: contact.channel,
          consentStatus: "pending",
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
          sendCount: decision.nextSendCount,
          sendTotal: decision.nextSendTotal,
        },
      }, {merge: true});

      const {approveUrl, declineUrl} = buildConsentLinks(CONSENT_URL, rawToken);

      if (contact.channel === core.CONTACT_CHANNEL.EMAIL) {
        const {subject, text} = buildConsentEmail({
          childName, approveUrl, declineUrl, expiryDays: TOKEN_TTL_DAYS,
        });
        await sendEmailMessage({to: contact.value, subject, text});
        return {ok: true, sent: "email", contactDisplay: contact.display};
      }

      const waText = encodeURIComponent(
          buildConsentWhatsAppText({childName, approveUrl, declineUrl}),
      );
      return {
        ok: true,
        sent: "whatsapp_link",
        contactDisplay: contact.display,
        waLink: `https://wa.me/${contact.key}?text=${waText}`,
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
    // `via` is the ONLY field that differs between the two routes to this
    // decision, and it differs because the record is an audit trail: a
    // guardian who decided on the child's phone did something materially
    // different from one who clicked a link in their own inbox, and a record
    // that could not tell them apart would be less useful, not more
    // trustworthy. Everything else — the tokenId, the client, the transaction
    // that applies it exactly once, the confirmation the person had to give —
    // is the same, because it is literally the same code path.
    const evidence = {
      via: record.channel === "same_device" ? "same_device" : "link",
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
    return {
      outcome: "approved",
      childName: userSnap.data()?.firstName,
      // Handed back so the caller can converge this approval onto a real
      // guardian ACCOUNT (functions/guardianLink/convergence.js). It is
      // done outside the transaction deliberately: attaching involves an
      // Auth lookup and a second collection, and a failure there must
      // not roll back a consent decision the guardian has already been
      // shown a success page for.
      learnerUid: record.uid,
      guardianContact: record.contact || "",
      guardianMethod: record.method || "email",
      evidence: {
        ip: record.clickIp || "",
        userAgent: record.clickUserAgent || "",
        tokenId: docRef.id,
      },
    };
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

    // Approving requires saying who you are, and the check is HERE rather
    // than only in the markup: `required` on the checkbox stops a person
    // skipping it, and a POST does not have to come from our page. This is
    // also what keeps the hand-the-phone-over route honest — it skips the
    // message, not the question, so the record it writes means the same
    // thing as the record an emailed link writes.
    if (decision === "approve" && String(req.body?.confirm || "").trim() !== "yes") {
      return send(400, renderOutcomePage("unconfirmed"));
    }

    const result = await applyDecision(db, docRef, decision);
    if (result.outcome === "approved") {
      // Converge on ONE guardian account. If a parent account already
      // holds this verified address, the link is created now; if not, a
      // claim is left so the account that signs up with it later arrives
      // to a dashboard that already has this child in it. Never throws —
      // see attachOnApproval — because the guardian's decision is
      // already recorded and this page must not report it as failed.
      if (result.guardianMethod === "email") {
        await attachOnApproval(db, {
          learnerUid: result.learnerUid,
          guardianEmail: result.guardianContact,
          evidence: result.evidence,
        });
      }
      return send(200, renderApprovedPage({childName: safeName(result.childName)}));
    }
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
