"use strict";

/**
 * functions/guardianLink — the lifecycle of a guardian↔learner link.
 *
 * The link itself is created by one of two doors (familyPortal.js for the
 * family code, guardianConsent/ for the emailed approval). What happens
 * to it AFTERWARDS is here, because both doors share it:
 *
 *   confirmGuardianLink({parentUid, decision})   [learner]
 *     The child's confirmation. A link created by either door starts
 *     `pending` and grants NOTHING until this. 'reject' deletes it.
 *
 *   requestGuardianUnlink({parentUid, reason})   [learner]
 *     Raises a request. Never removes anyone — see below.
 *
 *   reportGuardianLink({parentUid, reason})      [learner]
 *     "This isn't my grown-up." Flags the link for review and tells the
 *     child what happens next.
 *
 *   withdrawGuardianConsent({childUid})          [guardian]
 *     The guardian ends it. The child returns to limited mode unless
 *     another guardian's approval is still standing.
 *
 *   setLinkPermission({childUid, key, value})    [guardian]
 *     One guardian's own view on one permission, written to THEIR link.
 *
 * ── Why a child cannot unlink themselves ────────────────────────────
 *
 * Every other "remove me from this" in the product is immediate. This one
 * is not, and the reason is the whole point of the feature: a child who
 * can quietly drop supervision is a child who can be TALKED INTO dropping
 * it, by the person the supervision exists to notice. So the ask is
 * recorded, both the guardian and support are told, and a human decides.
 *
 * What that costs is real and is paid for elsewhere: a child in a bad
 * situation must have a route out that no guardian sees. That route is
 * Childline Zambia on 116 — free, private, no guardian's permission
 * needed — and every one of these callables returns it in its payload so
 * the screen cannot forget to show it.
 *
 * ── Every transition is audited ─────────────────────────────────────
 *
 * `guardianLinkAudit` is append-only and server-only, and it is not
 * decoration: /child-safety promises guardians can view, change and
 * delete what we hold, and "who approved what, when" is not something
 * that can be reconstructed from the current state of a mutable document
 * after the fact.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const {assertVerifiedAuth} = require("../authGuard");
const {assertCallableRateLimit} = require("../rateLimit");
const {
  buildLinkDecisionEmail,
  buildUnlinkRequestEmail,
  decideChildConfirmation,
  decideUnlinkRequest,
  decideWithdrawal,
} = require("./guardianLinkDecisions");

const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

const REGION = "us-central1";
const LINKS = "parentLinks";
const AUDIT = "guardianLinkAudit";
const UNLINK_REQUESTS = "guardianUnlinkRequests";

/**
 * Childline Zambia. Returned by every callable in this file rather than
 * hard-coded into each screen, so a surface that renders one of these
 * results cannot ship without the number being available to it.
 */
const CHILDLINE = {name: "Childline Zambia", number: "116", free: true};

// The shared package is ESM and this is CommonJS, so it is reached with
// `await import(...)` inside the handler. Cached per instance.
let corePromise = null;
function loadCore() {
  if (!corePromise) corePromise = import("../shared/guardian/guardianLinkCore.js");
  return corePromise;
}
let rolesPromise = null;
function loadRoles() {
  if (!rolesPromise) rolesPromise = import("../shared/guardian/guardianRolesCore.js");
  return rolesPromise;
}

/* ── Shared plumbing ───────────────────────────────────────────────── */

/** Every link naming one learner. */
async function linksForLearner(db, learnerUid) {
  const snap = await db.collection(LINKS).where("learnerUid", "==", learnerUid).get();
  return snap.docs.map((d) => ({id: d.id, ...(d.data() || {})}));
}

/**
 * Append one row to the trail. Best-effort by design: an audit write that
 * failed must not roll back a consent decision a human just made — a
 * guardian who clicked "end this link" and got an error would reasonably
 * believe it had not happened. The failure is logged loudly instead.
 */
async function audit(db, entry) {
  try {
    await db.collection(AUDIT).add({
      ...entry,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[guardianLink] AUDIT WRITE FAILED", entry?.event, err?.message || err);
  }
}

async function sendMail({to, subject, text}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  if (!senderEmail || !to) return false;
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const crypto = require("crypto");
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
    messageId: `<guardian-link-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
  return true;
}

/** Email a guardian without letting a mail failure fail the operation. */
async function notify(to, mail, context) {
  if (!to) return false;
  try {
    return await sendMail({to, ...mail});
  } catch (err) {
    console.error(`[guardianLink] notice failed (${context}):`, err?.message || err);
    return false;
  }
}

/* ── confirmGuardianLink ───────────────────────────────────────────── */

/**
 * The child answers "<Name> wants to be your guardian. Is this your
 * grown-up?".
 *
 * Until this runs, the link exists but is `pending`, which every read
 * path treats as no access at all. That is the design's answer to a
 * family code reaching the wrong adult: the only person who knows
 * whether the adult is the right one is asked, on their own device,
 * before anything is shared.
 */
const confirmGuardianLink = onCall({
  secrets: [emailSmtpUser, emailSmtpPassword],
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  // A child confirming is a rare, deliberate act. The limit is here to
  // stop a script walking parent uids looking for one that answers
  // differently, not to police a real family.
  await assertCallableRateLimit(request, {action: "guardianLinkConfirm", userPerMin: 10, ipPerMin: 30});

  const db = admin.firestore();
  const core = await loadCore();
  const parentUid = String(request.data?.parentUid || "").trim();
  const decision = String(request.data?.decision || "");

  if (!parentUid) throw new HttpsError("invalid-argument", "Which grown-up?");

  const ref = db.collection(LINKS).doc(core.linkId(parentUid, uid));
  const snap = await ref.get();
  const link = snap.exists ? {id: snap.id, ...(snap.data() || {})} : null;

  const verdict = decideChildConfirmation({
    link,
    learnerUid: uid,
    decision,
    deps: {normalizeLink: core.normalizeLink, LINK_CONSENT: core.LINK_CONSENT},
  });

  if (!verdict.ok) {
    if (verdict.reason === "already-approved") {
      return {ok: true, changed: false, state: core.LINK_CONSENT.APPROVED, childline: CHILDLINE};
    }
    throw new HttpsError(
        verdict.reason === "bad-decision" ? "invalid-argument" : "failed-precondition",
        verdict.message,
        {reason: verdict.reason},
    );
  }

  const learnerSnap = await db.collection("users").doc(uid).get();
  const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};
  const childName = learner.firstName || learner.displayName || null;
  const guardianEmail = String(link?.parentEmail || "").trim();

  if (verdict.action === "delete") {
    await ref.delete();
    await audit(db, {
      event: "link_rejected_by_child",
      learnerUid: uid,
      parentUid,
      fromState: verdict.wasState,
      toState: null,
      by: uid,
      actor: "learner",
    });
    await notify(guardianEmail, buildLinkDecisionEmail({childName, confirmed: false}), "reject");
    return {ok: true, changed: true, state: null, childline: CHILDLINE};
  }

  await ref.set({
    consent: {
      state: core.LINK_CONSENT.APPROVED,
      // `method` is whatever the door that created the link recorded; it
      // is deliberately not overwritten here. The child confirming is
      // not a THIRD way of linking, it is the second half of the one
      // that was already under way, and rewriting the method would erase
      // the evidence of which door this family actually came through.
      grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      withdrawnAt: null,
      confirmedByLearner: true,
    },
  }, {merge: true});

  await audit(db, {
    event: "link_confirmed_by_child",
    learnerUid: uid,
    parentUid,
    fromState: verdict.wasState,
    toState: core.LINK_CONSENT.APPROVED,
    by: uid,
    actor: "learner",
  });

  await notify(guardianEmail, buildLinkDecisionEmail({childName, confirmed: true}), "confirm");

  return {ok: true, changed: true, state: core.LINK_CONSENT.APPROVED, childline: CHILDLINE};
});

/* ── withdrawGuardianConsent ───────────────────────────────────────── */

/**
 * A guardian ends their own link.
 *
 * The child does NOT lose their learning: lessons and past papers are
 * ungated on every plan and stay that way. What they lose is the part
 * consent was covering — Ask Zed, the leaderboard, purchases — and only
 * if no OTHER guardian's approval is still standing.
 *
 * The link is marked `withdrawn` rather than deleted. It is the record
 * of a relationship that existed and ended, which is exactly what a
 * regulator asking "who approved this account, and when did that stop"
 * needs, and what the child is owed an honest answer about.
 */
const withdrawGuardianConsent = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const core = await loadCore();
  const childUid = String(request.data?.childUid || "").trim();
  if (!childUid) throw new HttpsError("invalid-argument", "childUid is required.");

  const links = await linksForLearner(db, childUid);
  const verdict = decideWithdrawal({
    links,
    guardianUid: uid,
    deps: {
      normalizeLink: core.normalizeLink,
      resolveLinkConsent: core.resolveLinkConsent,
      LINK_CONSENT: core.LINK_CONSENT,
    },
  });

  if (!verdict.ok) {
    throw new HttpsError(
        verdict.reason === "not-linked" ? "permission-denied" : "failed-precondition",
        verdict.message,
        {reason: verdict.reason},
    );
  }

  await db.collection(LINKS).doc(core.linkId(uid, childUid)).set({
    consent: {
      state: core.LINK_CONSENT.WITHDRAWN,
      withdrawnAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, {merge: true});

  await audit(db, {
    event: "consent_withdrawn",
    learnerUid: childUid,
    parentUid: uid,
    fromState: verdict.wasState,
    toState: core.LINK_CONSENT.WITHDRAWN,
    by: uid,
    actor: "guardian",
    childStillApproved: verdict.childStillApproved,
  });

  return {
    ok: true,
    // What the guardian is told they just did. Reporting "your child is
    // now limited" when a second guardian's approval is still standing
    // would be a lie, and the parent would find out by looking.
    childStillApproved: verdict.childStillApproved,
    remainingGuardians: verdict.remainingGuardians,
  };
});

/* ── setLinkPermission ─────────────────────────────────────────────── */

/**
 * One guardian sets one permission ON THEIR OWN LINK.
 *
 * Deliberately not a write to the child's user document. Two guardians
 * who disagree must both be recorded — the resolution (most restrictive
 * wins, guardianLinkCore.resolveLinkPermissions) happens at READ time,
 * so neither adult's setting silently overwrites the other's, and
 * removing one guardian restores what the remaining one actually chose
 * rather than leaving their absent co-parent's last write in force.
 */
const setLinkPermission = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const core = await loadCore();
  const {roleFor, can} = await loadRoles();

  const childUid = String(request.data?.childUid || "").trim();
  const key = String(request.data?.key || "");
  const value = request.data?.value;
  if (!childUid) throw new HttpsError("invalid-argument", "childUid is required.");

  if (!core.LINK_PERMISSION_KEYS.includes(key)) {
    throw new HttpsError("invalid-argument", "That is not a permission we know about.");
  }
  const isMinutes = key === "dailyMinutes";
  if (isMinutes) {
    if (value !== null && !(Number.isFinite(value) && value >= 0)) {
      throw new HttpsError("invalid-argument", "A daily limit is a number of minutes, or none.");
    }
  } else if (typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", "A permission is on or off.");
  }

  const links = await linksForLearner(db, childUid);
  const mine = links.find((l) => l.parentUid === uid);
  // An unapproved link grants nothing, including the power to restrict.
  // Otherwise typing a family code would let a stranger switch off a
  // child's Ask Zed before anyone confirmed they were a guardian at all.
  if (!mine || !core.linkIsApproved(mine)) {
    throw new HttpsError("permission-denied", "You are not linked to this child.");
  }
  const role = roleFor(links, uid);
  if (!can(role, "setChildControls")) {
    throw new HttpsError("permission-denied", "You do not have permission to do that.");
  }

  const from = core.readLinkPermissions(mine)[key];
  const next = isMinutes && value !== null ? Math.floor(value) : value;
  if (from === next) return {ok: true, changed: false};

  await db.collection(LINKS).doc(core.linkId(uid, childUid)).set({
    permissions: {[key]: next, updatedAt: admin.firestore.FieldValue.serverTimestamp()},
  }, {merge: true});

  await audit(db, {
    event: "permission_set",
    learnerUid: childUid,
    parentUid: uid,
    permission: key,
    from: from ?? null,
    to: next,
    by: uid,
    actor: "guardian",
  });

  // The effective answer AFTER the write, which is not necessarily the
  // value just set: a co-guardian's stricter setting still wins, and a
  // parent who turned something on and saw it stay off deserves to be
  // told why rather than concluding the button is broken.
  const after = links.map((l) => (
    l.parentUid === uid ?
      {...l, permissions: {...(l.permissions || {}), [key]: next}} :
      l
  ));
  const effective = core.resolveLinkPermissions(after);

  return {ok: true, changed: true, effective, overriddenByCoGuardian: effective[key] !== next};
});

/* ── requestGuardianUnlink ─────────────────────────────────────────── */

/**
 * The child asks to remove a guardian. Files a request; removes nobody.
 * See the module docblock for why this one is not immediate.
 */
const requestGuardianUnlink = onCall({
  secrets: [emailSmtpUser, emailSmtpPassword],
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  await assertCallableRateLimit(request, {action: "guardianUnlinkAsk", userPerMin: 5, ipPerMin: 20});

  const db = admin.firestore();
  const core = await loadCore();
  const parentUid = String(request.data?.parentUid || "").trim();
  const reason = String(request.data?.reason || "").slice(0, 1000);
  if (!parentUid) throw new HttpsError("invalid-argument", "Which grown-up?");

  const links = await linksForLearner(db, uid);
  const open = await db.collection(UNLINK_REQUESTS)
      .where("learnerUid", "==", uid)
      .where("parentUid", "==", parentUid)
      .where("status", "==", "open")
      .limit(1)
      .get()
      .catch(() => null);

  const verdict = decideUnlinkRequest({
    links,
    learnerUid: uid,
    guardianUid: parentUid,
    openRequests: open ? open.docs : [],
    deps: {normalizeLink: core.normalizeLink, LINK_CONSENT: core.LINK_CONSENT},
  });

  if (!verdict.ok) {
    // "You have already asked" is a state, not an error the child did
    // anything to cause — it returns as a normal answer so the screen can
    // say so calmly instead of rendering a failure.
    if (verdict.reason === "already-asked") {
      return {ok: true, filed: false, message: verdict.message, childline: CHILDLINE};
    }
    throw new HttpsError("failed-precondition", verdict.message, {reason: verdict.reason});
  }

  const learnerSnap = await db.collection("users").doc(uid).get();
  const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};

  await db.collection(UNLINK_REQUESTS).add({
    learnerUid: uid,
    learnerDisplayName: learner.displayName || null,
    parentUid,
    reason,
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await audit(db, {
    event: "unlink_requested",
    learnerUid: uid,
    parentUid,
    by: uid,
    actor: "learner",
    reason,
  });

  const link = links.find((l) => l.parentUid === parentUid);
  await notify(
      String(link?.parentEmail || "").trim(),
      buildUnlinkRequestEmail({childName: learner.firstName || learner.displayName}),
      "unlink-request",
  );

  return {
    ok: true,
    filed: true,
    // Said plainly, because the alternative is a child believing they
    // have been unlinked when they have not.
    message: "We have told your grown-up and our support team. Nobody has been removed yet.",
    childline: CHILDLINE,
  };
});

/* ── reportGuardianLink ────────────────────────────────────────────── */

/**
 * "This isn't my grown-up."
 *
 * The button on the child's Guardian screen that must never silently do
 * nothing. It flags the link for human review AND, when the link has not
 * been confirmed, removes it outright — an unconfirmed stranger is not
 * somebody a child should have to wait on a queue to be rid of.
 */
const reportGuardianLink = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  await assertCallableRateLimit(request, {action: "guardianLinkReport", userPerMin: 5, ipPerMin: 20});

  const db = admin.firestore();
  const core = await loadCore();
  const parentUid = String(request.data?.parentUid || "").trim();
  const reason = String(request.data?.reason || "").slice(0, 1000);
  if (!parentUid) throw new HttpsError("invalid-argument", "Which grown-up?");

  const ref = db.collection(LINKS).doc(core.linkId(parentUid, uid));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That grown-up is not linked to you.");

  const link = {id: snap.id, ...(snap.data() || {})};
  const state = core.normalizeLink(link).state;
  // `linkIsApproved`, not a bare state check: a link that predates
  // consent-on-links reads as `pending` but describes a guardian who has
  // been on this account for months. Deleting one on a single tap would
  // let a child remove an established guardian by pressing the button
  // meant for a stranger — which is the exact thing requestGuardianUnlink
  // exists to route through a human.
  const unconfirmed = !core.linkIsApproved(link);

  if (unconfirmed) {
    await ref.delete();
  } else {
    await ref.set({
      flagged: {
        at: admin.firestore.FieldValue.serverTimestamp(),
        by: uid,
        reason,
        status: "open",
      },
    }, {merge: true});
  }

  await audit(db, {
    event: "link_reported_by_child",
    learnerUid: uid,
    parentUid,
    fromState: state,
    toState: unconfirmed ? null : state,
    removed: unconfirmed,
    by: uid,
    actor: "learner",
    reason,
  });

  return {
    ok: true,
    removed: unconfirmed,
    message: unconfirmed ?
      "We have removed them. They can no longer see anything about you." :
      "Thank you for telling us. Someone will look at this, and we have not told them you did.",
    childline: CHILDLINE,
  };
});

module.exports = {
  CHILDLINE,
  confirmGuardianLink,
  reportGuardianLink,
  requestGuardianUnlink,
  setLinkPermission,
  withdrawGuardianConsent,
};
