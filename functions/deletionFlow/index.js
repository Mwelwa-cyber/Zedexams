"use strict";

/**
 * functions/deletionFlow — deleting a learner's account, as a decided process.
 *
 * The state machine is `deletionRequestCore.js`, pure and node-tested. This
 * file is the Firestore and notification wiring around it: five callables and
 * three scheduled sweeps, none of which decides anything on its own.
 *
 *   requestAccountDeletion     the learner asks
 *   respondToDeletionRequest   the guardian approves / declines / parks
 *   cancelDeletionRequest      the learner withdraws, or the guardian restores
 *   getDeletionRequest         what either side is shown about it
 *   reportWrongGuardian        "not your grown-up? tell us instead"
 *
 *   deletionRequestSweep       the 7-day escalation + the day-25 reminders
 *   deletionExecutionSweep     the 30-day window closing
 *
 * ── The collection, and why it is not `deletionRequests` ───────────────
 *
 * `deletionRequests` already exists and is something else: the PUBLIC,
 * unauthenticated /delete-account portal Google Play requires, keyed by EMAIL
 * and resolved by a human out of band (`accountDeletionRequests.js`). Its
 * documents have a different shape, a different lifecycle and a different
 * security posture — anonymous writes, no uid.
 *
 * Putting two document shapes in one collection means one set of rules has to
 * be permissive enough for both, and every query has to remember which kind it
 * is looking at. So this is `accountDeletionRequests`, and the two never meet.
 *
 * ── Only the server writes `state` ─────────────────────────────────────
 *
 * `firestore.rules` denies every client write to this collection and to the
 * audit trail. That is not belt-and-braces over the checks below; it is the
 * actual control. Everything here runs with the admin SDK, so a rule that
 * allowed the client anything would be a second, weaker way to do the same
 * thing — and the weaker way is the one an attacker uses.
 *
 * ── Nothing here deletes anything ──────────────────────────────────────
 *
 * The purge is `functions/accountDeletion.js`, reached through
 * `accountDeletionFlow.js`, and it runs in ONE place: the 30-day executor. Not
 * in a callable, not on approval. A code path that could delete an account
 * synchronously in response to a request is the thing the whole grace window
 * exists to prevent.
 */

const admin = require("firebase-admin");
const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {assertVerifiedAuth} = require("../authGuard");

const core = require("./deletionRequestCore");
const decisionContext = require("./decisionContextCore");

// Already in Secret Manager and bound to sendPasswordResetEmail /
// requestGuardianUnlock, so binding them here cannot cause the "no value for
// the secret" deploy hard-fail documented in index.js.
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

/** The secrets index.js must bind to every function in this module. */
const DELETION_FLOW_SECRETS = [emailSmtpUser, emailSmtpPassword];

async function sendEmailMessage({to, subject, text}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  if (!senderEmail || !to) return false;
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
    messageId: `<account-deletion-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
  return true;
}

const REQUESTS = "accountDeletionRequests";
const AUDIT = "accountDeletionAudit";
const LINKS = "parentLinks";

/** Cap on how many documents one sweep will touch. */
const SWEEP_LIMIT = 200;

const db = () => admin.firestore();
const nowMs = () => Date.now();

/* ── Reading ─────────────────────────────────────────────────────────── */

/**
 * The learner's open request, if there is one.
 *
 * Ordered newest-first and taking the first non-terminal document rather than
 * filtering `state` in the query: the terminal states are three of six, so an
 * `in` filter would need updating every time a state is added, and the failure
 * mode of forgetting is a child who can open a second request while the first
 * is running.
 */
async function findOpenRequest(learnerId) {
  const snap = await db().collection(REQUESTS)
    .where("learnerId", "==", learnerId)
    .orderBy("requestedAt", "desc")
    .limit(5)
    .get();
  for (const doc of snap.docs) {
    const data = {id: doc.id, ...(doc.data() || {})};
    if (!core.TERMINAL_STATES.includes(data.state)) return data;
  }
  return null;
}

async function readLinks(learnerUid) {
  const snap = await db().collection(LINKS).where("learnerUid", "==", learnerUid).get();
  return snap.docs.map((d) => ({id: d.id, ...(d.data() || {})}));
}

async function readProfile(uid) {
  const snap = await db().collection("users").doc(uid).get();
  return snap.exists ? {id: snap.id, ...(snap.data() || {})} : null;
}

/* ── Writing ─────────────────────────────────────────────────────────── */

/**
 * Apply a patch and append to the audit trail, in one batch.
 *
 * One batch rather than two writes, because a transition that landed with no
 * audit entry is exactly the record `/child-safety` promises we keep. If the
 * trail can be missing an entry, the trail proves nothing.
 */
async function commitTransition({requestId, request, patch, actor, actorUid, reason}) {
  const batch = db().batch();
  batch.set(db().collection(REQUESTS).doc(requestId), {
    ...patch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  // Mirror the state onto the learner's profile.
  //
  // Not a duplicate source of truth — `accountDeletionRequests` remains
  // authoritative and is what every sweep and every decision reads. This is a
  // read optimisation with one job: the learner shell has the profile in
  // memory already, so it can decide whether to render the pending-deletion
  // banner without a callable on every session for the ~100% of learners who
  // have no request open.
  //
  // ── Why the terminal case is NOT part of the batch ──────────────────
  //
  // `set(..., {merge: true})` CREATES a document that does not exist. On the
  // one terminal transition that matters — `completed`, written after the
  // purge has run — the users doc is gone, and a merge-set would RESURRECT it
  // with two fields and no owner. That is the exact resurrection failure
  // `accountDeletionFlow.js` was rewritten to end, arriving through a
  // different door.
  //
  // So: a live state is merged in with the batch (the learner exists — they
  // just asked). A terminal state clears the fields with an `update` after the
  // commit, which fails harmlessly when the document is already gone, and
  // whose failure must not roll back the transition it describes.
  const nextState = patch.state || request?.state;
  const terminal = !!nextState && core.TERMINAL_STATES.includes(nextState);
  if (nextState && request?.learnerId && !terminal) {
    batch.set(db().collection("users").doc(request.learnerId), {
      deletionRequestState: nextState,
      deletionRequestId: requestId,
    }, {merge: true});
  }
  batch.set(db().collection(AUDIT).doc(), {
    ...core.auditEntry({
      requestId,
      learnerId: request?.learnerId,
      from: request?.state,
      to: patch.state || request?.state,
      actor,
      actorUid,
      reason,
      now: nowMs(),
    }),
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  if (terminal && request?.learnerId) {
    try {
      await db().collection("users").doc(request.learnerId).update({
        deletionRequestState: admin.firestore.FieldValue.delete(),
        deletionRequestId: admin.firestore.FieldValue.delete(),
      });
    } catch {
      // The account is gone, which is the whole point of `completed`. Nothing
      // to clear, and nothing to report.
    }
  }
}

/* ── Notifications ───────────────────────────────────────────────────── */

/**
 * Tell the child what happened. Category `account`, which
 * `notificationPrefsCore` writes in-app unconditionally — a deletion decision
 * is not something a preference may swallow.
 *
 * Best-effort by design: a failed notification must never fail the transition,
 * because the transition is the thing with the legal weight. The child can
 * always see the state on `/settings/delete`.
 */
async function notifyLearner(learnerId, kind, extra = {}) {
  const messages = {
    approved: {
      title: "Your grown-up agreed",
      body: `Your account will be deleted in ${core.GRACE_DAYS} days. You can still change your mind — just open Settings.`,
    },
    declined: {
      title: "Your grown-up said not right now",
      body: "Your account is staying. If you still want to leave, our team can help.",
    },
    escalated: {
      title: "We are handling your request",
      body: "Your grown-up did not answer, so our team has taken it. Nothing has been deleted.",
    },
    parked: {
      title: "Your grown-up wants to talk first",
      body: "They have seen your request and would like to chat about it. Nothing has been deleted.",
    },
    restored: {
      title: "Your account is back",
      body: "Your grown-up brought it back. Everything is where you left it.",
    },
    reminder: {
      title: `${extra.daysLeft} days left`,
      body: "Your account is deleted soon. Open Settings if you want to keep it.",
    },
  };
  const msg = messages[kind];
  if (!msg) return;
  try {
    const {createNotification} = require("../notifications/createNotification");
    await createNotification({
      uid: learnerId,
      category: "account",
      type: `account_deletion_${kind}`,
      title: msg.title,
      body: msg.body,
      priority: "high",
      action: {label: "Open Settings", url: "/settings/delete"},
      dedupeKey: `deletion-${kind}-${learnerId}-${extra.stamp || ""}`,
    });
  } catch (err) {
    console.warn("[deletionFlow] learner notification failed", err);
  }
}

/**
 * Tell the guardian a request is waiting — in-app AND by email.
 *
 * Two channels on purpose. Most guardians do not have the app open, and the
 * email is a full decision brief with a button rather than a "log in to see":
 * a notification that requires a separate act of discovery to understand is
 * one that gets ignored for seven days, and then the child is escalated to
 * support over what was really a delivery failure.
 *
 * The email is sent by the caller (it needs the SMTP secrets, which are bound
 * per-function); this writes the in-app half and returns the brief.
 */
async function notifyGuardianOfRequest({guardianUid, requestId, learner}) {
  const childName = learner?.displayName || "Your child";
  try {
    const {createNotification} = require("../notifications/createNotification");
    await createNotification({
      uid: guardianUid,
      category: "account",
      type: "account_deletion_requested",
      title: `${childName} asked to delete their account`,
      body: "Nothing has been deleted. They need you to agree first — tap to review.",
      priority: "high",
      action: {label: "Review the request", url: `/family/requests/${requestId}`},
      dedupeKey: `deletion-request-${requestId}`,
    });
  } catch (err) {
    console.warn("[deletionFlow] guardian notification failed", err);
  }
  return {
    subject: `${childName} would like to delete their ZedExams account`,
    text: [
      `${childName} asked to delete their ZedExams account.`,
      "",
      "Nothing has been deleted, and nothing will be until you decide.",
      `If we do not hear from you within ${core.GUARDIAN_RESPONSE_DAYS} days, our support team will follow up with them directly.`,
      "",
      "If you approve, this is what goes:",
      ...core.DELETED_SUMMARY.map((line) => `  • ${line}`),
      "",
      `They would have ${core.GRACE_DAYS} days to change their mind before it is permanent.`,
      "",
      `Review the request: https://zedexams.com/family/requests/${requestId}`,
      "",
      "You are getting this because you are their guardian on ZedExams.",
    ].join("\n"),
  };
}

/* ── Callables ───────────────────────────────────────────────────────── */

/**
 * The learner asks to delete their account.
 *
 * The caller is `request.auth.uid`, always — never a uid in the payload, which
 * would let any signed-in account open a deletion request against any other.
 */
async function requestAccountDeletion(request) {
  const uid = await assertVerifiedAuth(request, "Sign in first.");

  const existing = await findOpenRequest(uid);
  const gate = core.canOpenRequest({existing});
  if (!gate.ok) {
    // Not an error: the child asked twice, which is what an anxious person
    // does. Hand back the request they already have.
    return {requestId: gate.existingId, state: existing.state, alreadyOpen: true};
  }

  const [profile, links] = await Promise.all([readProfile(uid), readLinks(uid)]);
  const isMinor = core.resolveIsMinor(profile);
  const opened = core.openRequest({isMinor, links, now: nowMs()});

  const ref = db().collection(REQUESTS).doc();
  const doc = {
    learnerId: uid,
    learnerDisplayName: profile?.displayName || null,
    requestedBy: core.REQUESTED_BY.LEARNER,
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    state: opened.state,
    guardianUid: opened.guardianUid,
    escalatedAt: opened.escalatedAt,
    scheduledDeleteAt: opened.scheduledDeleteAt,
    openReason: opened.reason,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(doc);
  // The same mirror, on the way in. Best-effort: a failed mirror costs the
  // banner an extra callable to discover the request, never the request itself.
  try {
    await db().collection("users").doc(uid).set({
      deletionRequestState: opened.state,
      deletionRequestId: ref.id,
    }, {merge: true});
  } catch (err) {
    console.warn("[deletionFlow] profile mirror failed", err);
  }
  await db().collection(AUDIT).doc().set({
    ...core.auditEntry({
      requestId: ref.id, learnerId: uid, from: null, to: opened.state,
      actor: "learner", actorUid: uid, reason: opened.reason, now: nowMs(),
    }),
    at: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (opened.state === core.STATE.PENDING_GUARDIAN) {
    const brief = await notifyGuardianOfRequest({
      guardianUid: opened.guardianUid,
      requestId: ref.id,
      learner: profile,
    });
    // Both channels, and the email is the one that matters: most guardians do
    // not have the app open, and a request that is not READ for seven days
    // escalates a child to support over what was really a delivery failure.
    //
    // Best-effort — a bounced email must not fail the request, or a child with
    // a guardian whose address has a typo in it could never ask at all.
    try {
      const guardianProfile = await readProfile(opened.guardianUid);
      await sendEmailMessage({
        to: guardianProfile?.email || null,
        subject: brief.subject,
        text: brief.text,
      });
    } catch (err) {
      console.warn("[deletionFlow] guardian email failed", err);
    }
  }

  // NOTHING about the guardian's brief is returned. The caller here is the
  // CHILD, and the return value of a callable goes to whoever called it.
  return {
    requestId: ref.id,
    state: opened.state,
    scheduledDeleteAt: opened.scheduledDeleteAt,
    alreadyOpen: false,
  };
}

/** The guardian answers. */
async function respondToDeletionRequest(request) {
  const uid = await assertVerifiedAuth(request, "Sign in first.");
  const requestId = String(request.data?.requestId || "").trim();
  const decision = String(request.data?.decision || "").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId is required.");

  const ref = db().collection(REQUESTS).doc(requestId);
  const snap = await ref.get();
  const stored = snap.exists ? {id: snap.id, ...(snap.data() || {})} : null;

  const out = core.guardianDecision({request: stored, actorUid: uid, decision, now: nowMs()});
  if (!out.ok) throw new HttpsError(refusalCode(out.code), out.message);

  await commitTransition({
    requestId, request: stored, patch: out.patch,
    actor: "guardian", actorUid: uid, reason: decision,
  });

  if (out.notify?.learner) {
    await notifyLearner(stored.learnerId, out.notify.learner, {stamp: requestId});
  }
  return {ok: true, state: out.patch.state || stored.state};
}

/** The learner withdraws, or the guardian restores. */
async function cancelDeletionRequest(request) {
  const uid = await assertVerifiedAuth(request, "Sign in first.");
  const requestId = String(request.data?.requestId || "").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId is required.");

  const ref = db().collection(REQUESTS).doc(requestId);
  const snap = await ref.get();
  const stored = snap.exists ? {id: snap.id, ...(snap.data() || {})} : null;

  const out = core.cancelRequest({request: stored, actorUid: uid, now: nowMs()});
  if (!out.ok) throw new HttpsError(refusalCode(out.code), out.message);

  await commitTransition({
    requestId, request: stored, patch: out.patch,
    actor: out.patch.cancelledBy, actorUid: uid, reason: out.patch.cancelReason,
  });

  if (out.notify?.learner) {
    await notifyLearner(stored.learnerId, out.notify.learner, {stamp: requestId});
  }
  return {ok: true, state: core.STATE.CANCELLED};
}

/**
 * The stats, the note and the plan line for the decision screen.
 *
 * Every read here is best-effort and every absence is an omission rather than
 * a substitution: a guardian who checks one number against the app and finds
 * it invented will not believe the next one. A failed read therefore removes
 * a tile; it never fills one in.
 */
async function buildGuardianContext({guardianUid, learnerId, learner}) {
  const [statsSnap, examSnap, linksSnap, guardianProfile] = await Promise.all([
    db().collection("learnerStats").doc(learnerId).get().catch(() => null),
    // The next exam for this learner's grade, if a timetable is published.
    learner?.grade ?
      db().collection("exams")
        .where("grade", "==", learner.grade)
        .orderBy("date", "asc")
        .limit(1).get().catch(() => null) :
      Promise.resolve(null),
    db().collection(LINKS).where("parentUid", "==", guardianUid).get().catch(() => null),
    readProfile(guardianUid),
  ]);

  const stats = statsSnap && statsSnap.exists ? (statsSnap.data() || {}) : {};
  const nextExamRaw = examSnap && !examSnap.empty ? (examSnap.docs[0].data() || {}).date : null;
  const nextExamAt = core.toMillis(nextExamRaw) || null;

  const linkedChildCount = linksSnap ?
    linksSnap.docs.filter((d) => core.isActiveLink(d.data() || {})).length : 1;

  // `active` gates the whole plan panel, so it is read from the subscription
  // fields the payment system actually writes rather than from a display flag.
  const subscription = guardianProfile?.subscriptionStatus === "active" ||
    guardianProfile?.premium === true ?
    {
      active: true,
      priceLabel: guardianProfile?.subscriptionPriceLabel ||
        guardianProfile?.subscriptionPlanLabel || null,
    } :
    null;

  return decisionContext.buildDecisionContext({
    childName: learner?.displayName || null,
    stats,
    summary: {examReadiness: Number(stats.examReadiness) || Number(stats.averageScore) || null},
    nextExamAt,
    activeDaysLast7: Number(stats.daysPractisedThisWeek),
    lastActiveAt: core.toMillis(stats.lastActiveAt) || null,
    subscription,
    linkedChildCount,
    now: nowMs(),
  });
}

/**
 * What either side is shown.
 *
 * The learner sees their own; the named guardian sees the one addressed to
 * them. Nobody else sees anything — a request names a child and describes
 * their family, so "not found" is the right answer to a stranger rather than
 * "forbidden", which confirms it exists.
 */
async function getDeletionRequest(request) {
  const uid = await assertVerifiedAuth(request, "Sign in first.");
  const requestId = String(request.data?.requestId || "").trim();

  let stored = null;
  if (requestId) {
    const snap = await db().collection(REQUESTS).doc(requestId).get();
    stored = snap.exists ? {id: snap.id, ...(snap.data() || {})} : null;
  } else {
    stored = await findOpenRequest(uid);
  }
  if (!stored) return {request: null};

  const isLearner = stored.learnerId === uid;
  const isGuardian = stored.guardianUid === uid;
  if (!isLearner && !isGuardian) return {request: null};

  const banner = core.pendingBanner({request: stored, now: nowMs()});

  // The guardian's view carries the decision context; the child's does not.
  // Two projections of one document — which is why this is a callable rather
  // than a rule: the child has no business seeing what we tell their guardian
  // about their exam readiness, and the guardian has no business seeing it
  // unless they are the one being asked.
  let context = null;
  let learner = null;
  if (isGuardian) {
    learner = await readProfile(stored.learnerId);
    context = await buildGuardianContext({guardianUid: uid, learnerId: stored.learnerId, learner});
  }

  return {
    context,
    request: {
      id: stored.id,
      state: stored.state,
      learnerId: stored.learnerId,
      learnerDisplayName: stored.learnerDisplayName || learner?.displayName || null,
      requestedAt: core.toMillis(stored.requestedAt) || null,
      scheduledDeleteAt: core.toMillis(stored.scheduledDeleteAt) || null,
      parkedAt: core.toMillis(stored.parkedAt) || null,
      guardianUid: stored.guardianUid || null,
      viewerIs: isLearner ? "learner" : "guardian",
    },
    banner,
    deletedSummary: core.DELETED_SUMMARY,
    graceDays: core.GRACE_DAYS,
    guardianResponseDays: core.GUARDIAN_RESPONSE_DAYS,
  };
}

/**
 * "Not your grown-up? Tell us instead."
 *
 * The load-bearing escape hatch. It reaches SUPPORT and it NEVER notifies the
 * linked guardian — a child who needs out of a link with the wrong adult must
 * not be made to ask that adult for permission, and must not have that adult
 * told they asked.
 *
 * It also flags the link for review rather than severing it, because an
 * automatic unlink on an unverified report is its own abuse vector: a child
 * pressured into pressing it, or a sibling with the phone, could strip a real
 * guardian. A person reads it.
 */
async function reportWrongGuardian(request) {
  const uid = await assertVerifiedAuth(request, "Sign in first.");
  const note = String(request.data?.note || "").slice(0, 1000);

  const [profile, links] = await Promise.all([readProfile(uid), readLinks(uid)]);
  const guardian = core.chooseGuardian(links);

  await db().collection("contactMessages").doc().set({
    source: "learner-wrong-guardian",
    // Flagged for a human, urgently. This is a child-safety report, not
    // feedback, and it must not sit in the same queue as a feature request.
    priority: "urgent",
    category: "child_safety",
    name: profile?.displayName || null,
    email: profile?.email || null,
    learnerId: uid,
    reportedGuardianUid: guardian?.parentUid || null,
    reportedLinkId: guardian?.id || null,
    message: note || "A learner reported that the guardian linked to their account is not their grown-up.",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "new",
  });

  if (guardian?.id) {
    // A flag, not a severance. And explicitly NOT a notification to them.
    await db().collection(LINKS).doc(guardian.id).set({
      flaggedForReview: true,
      flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
      flaggedReason: "learner_reported_wrong_guardian",
    }, {merge: true});
  }

  return {ok: true};
}

/* ── Sweeps ──────────────────────────────────────────────────────────── */

/**
 * The 7-day escalation and the day-25 reminders, in one pass.
 *
 * Both read `state == pending_guardian` / `state == scheduled` and both are
 * cheap; running them as two scheduled functions would double the invocations
 * to do the same two queries.
 */
async function runDeletionRequestSweep(deps = {}) {
  const database = deps.db || db();
  const now = Number.isFinite(deps.now) ? deps.now : nowMs();
  const commit = deps.commitTransition || commitTransition;
  const tell = deps.notifyLearner || notifyLearner;
  const summary = {escalated: 0, reminded: 0, errors: []};

  const pendingSnap = await database.collection(REQUESTS)
    .where("state", "==", core.STATE.PENDING_GUARDIAN)
    .limit(SWEEP_LIMIT).get();

  for (const doc of pendingSnap.docs) {
    const stored = {id: doc.id, ...(doc.data() || {})};
    const out = core.escalateIfStale({request: stored, now});
    if (!out) continue;
    try {
      await commit({
        requestId: doc.id, request: stored, patch: out.patch,
        actor: "system", actorUid: null, reason: "guardian_did_not_respond",
      });
      await tell(stored.learnerId, "escalated", {stamp: doc.id});
      summary.escalated += 1;
    } catch (err) {
      summary.errors.push({id: doc.id, step: "escalate", message: err?.message});
    }
  }

  const scheduledSnap = await database.collection(REQUESTS)
    .where("state", "==", core.STATE.SCHEDULED)
    .limit(SWEEP_LIMIT).get();

  for (const doc of scheduledSnap.docs) {
    const stored = {id: doc.id, ...(doc.data() || {})};
    const due = core.reminderDue({request: stored, now});
    if (!due) continue;
    try {
      await doc.ref.set({
        graceReminderSentAt: deps.serverTimestamp || admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      await tell(stored.learnerId, "reminder", {daysLeft: due.daysLeft, stamp: doc.id});
      summary.reminded += 1;
    } catch (err) {
      summary.errors.push({id: doc.id, step: "remind", message: err?.message});
    }
  }

  return summary;
}

/**
 * The 30-day window closing.
 *
 * The order is the whole safety property: purge FIRST, write `completed`
 * SECOND. A purge that throws leaves the request in `scheduled` and the next
 * sweep retries it — where writing `completed` first would mark an account
 * deleted that still exists, and nothing would ever look at it again.
 *
 * @param {(learnerId: string) => Promise<object>} purge  injected so the sweep
 *   is testable without the real deletion path, and so this module never
 *   carries a second idea of what deletion means.
 */
async function runDeletionExecutionSweep({purge, ...deps} = {}) {
  const database = deps.db || db();
  const now = Number.isFinite(deps.now) ? deps.now : nowMs();
  const commit = deps.commitTransition || commitTransition;
  const summary = {deleted: 0, skipped: 0, errors: []};

  const snap = await database.collection(REQUESTS)
    .where("state", "==", core.STATE.SCHEDULED)
    .limit(SWEEP_LIMIT).get();

  for (const doc of snap.docs) {
    const stored = {id: doc.id, ...(doc.data() || {})};
    const due = core.dueForDeletion({request: stored, now});
    if (!due) { summary.skipped += 1; continue; }
    try {
      await purge(due.learnerId);
      // The purge removes this request document too — it carries the child's
      // display name, and `accountDeletion.js` lists the collection for that
      // reason. What the merge below leaves behind is therefore a deliberate
      // STUB: the state and the timestamp, no learnerId, no name. It records
      // that the window closed without re-creating anything personal, and
      // because it has no learnerId it can never match the purge query again.
      // The full trail is in `accountDeletionAudit`, which is retained.
      await commit({
        requestId: doc.id, request: stored,
        patch: {
          state: core.STATE.COMPLETED,
          completedAt: deps.serverTimestamp || admin.firestore.FieldValue.serverTimestamp(),
        },
        actor: "system", actorUid: null, reason: "grace_window_closed",
      });
      summary.deleted += 1;
    } catch (err) {
      // Left in `scheduled` on purpose. The next sweep retries it.
      summary.errors.push({id: doc.id, learnerId: due.learnerId, message: err?.message});
    }
  }

  return summary;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function refusalCode(code) {
  const map = {
    not_found: "not-found",
    wrong_state: "failed-precondition",
    not_your_request: "permission-denied",
    not_yours: "permission-denied",
    bad_decision: "invalid-argument",
    already_open: "failed-precondition",
  };
  return map[code] || "failed-precondition";
}

/* ── What index.js builds these into ─────────────────────────────────── */

/**
 * The handlers are exported RAW — no `onCall`, no `onSchedule` — and
 * `functions/index.js` wraps them.
 *
 * That is the repo's rule rather than a preference (`test:functions-manifest`
 * holds a ceiling on re-exported builders and refuses new ones): the deploy
 * analyser reads `index.js` to decide which secrets and which regions each
 * function gets, so a builder hidden inside a module is a binding nobody can
 * see at the place the bindings are declared. See the manifest guard's own
 * comments for the history.
 *
 * `DELETION_FLOW_SECRETS` travels with them, so the binding list cannot drift
 * from the module that reads the secrets.
 */

/**
 * The 30-day executor with the REAL purge wired in.
 *
 * The purge is injected rather than imported by the sweep, so this module
 * never carries a second idea of what deletion means — `runAccountDeletion`
 * owns the tombstone, the token revocation and the ordering that #2399
 * settled. This is the one place the two are joined.
 */
async function runScheduledDeletionExecution() {
  const {runAccountDeletion} = require("../account/accountDeletionFlow");
  const {purgeUserData} = require("../accountDeletion");
  return runDeletionExecutionSweep({
    purge: async (learnerId) => {
      const profile = await readProfile(learnerId);
      return runAccountDeletion({
        uid: learnerId,
        email: profile?.email || null,
        db: db(),
        auth: admin.auth(),
        FieldValue: admin.firestore.FieldValue,
        purge: purgeUserData,
      });
    },
  });
}

module.exports = {
  REQUESTS,
  AUDIT,
  DELETION_FLOW_SECRETS,
  requestAccountDeletion,
  respondToDeletionRequest,
  cancelDeletionRequest,
  getDeletionRequest,
  reportWrongGuardian,
  runDeletionRequestSweep,
  runDeletionExecutionSweep,
  runScheduledDeletionExecution,
  findOpenRequest,
  notifyLearner,
  notifyGuardianOfRequest,
};
