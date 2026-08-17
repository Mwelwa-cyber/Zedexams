/**
 * Parent app — the guardian's own logged-in surface (PROMPT 8g).
 *
 * Distinct from the two parent surfaces that already exist:
 *
 *   - `parentPortal.js`   the anonymous `progressShares` link (no account)
 *   - `familyPortal.js`   linking a parent account to a child by code
 *   - the Guardian Zone   the same data, rendered INSIDE the child's app
 *                         behind a friction gate (GuardianZonePage.jsx)
 *
 * This file is what the parent gets on their OWN device, signed in as
 * themselves: the approval feed, the child detail with its controls and
 * activity timeline, family sharing, and the weekly report.
 *
 * ── Why so much of it is a callable ─────────────────────────────────
 *
 * A parent cannot read `parentLinks` for anyone but themselves — the
 * rules scope reads to `parentUid == me || learnerUid == me`, which is
 * correct and must stay that way. But almost every question this
 * surface asks needs the OTHER links: who else guards this child, which
 * of us is the owner, is this request one I am allowed to approve. So
 * the reads run server-side with the admin SDK behind an explicit
 * authorisation check, rather than by widening a rule until the client
 * can answer them for itself.
 *
 * ── The authorisation shape, once, at the top ───────────────────────
 *
 * Every handler below starts by resolving the caller's role over the
 * child in question (`authorise`), and every one of them fails closed:
 * no link at all is "not your child" (not a weaker guardian), and an
 * unknown role buys nothing. Capabilities come from the shared roles
 * package, so the sentence that greys out a button in the browser is
 * the same sentence that refuses the call here.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {assertVerifiedAuth} = require("../authGuard");
const {aggregateProgress} = require("../parentPortalShared");
const {parentLinkId} = require("../familyPortalCore");
const {
  buildWeeklyReport,
  childStatus,
  groupActivityByDay,
  shapeApprovalFeed,
  toMillis,
} = require("./parentAppCore");
const {
  CO_GUARDIAN_INVITE_TTL_DAYS,
  buildCoGuardianInviteEmail,
  hashInviteToken,
  normalizeEmail,
  randomInviteToken,
} = require("./coGuardianCore");

const REGION = "us-central1";
const LINKS = "parentLinks";
const INVITES = "guardianInvites";
const REQUESTS = "guardianRequests";
const ACTIVITY_WINDOW_DAYS = 7;
const REPORT_WINDOW_DAYS = 7;
const MAX_GUARDIANS_PER_CHILD = 6;

const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

/* ── Shared package (ESM) ──────────────────────────────────────────── */

// Cloud Functions is CommonJS and functions/shared is ESM, so it is
// reached with `await import` INSIDE the handler — never a top-level
// require. Same rule as functions/shared/assessment and shared/consent.
let rolesPromise = null;
function loadRoles() {
  if (!rolesPromise) rolesPromise = import("../shared/guardian/guardianRolesCore.js");
  return rolesPromise;
}
let controlsPromise = null;
function loadControls() {
  if (!controlsPromise) controlsPromise = import("../shared/guardian/guardianControlsCore.js");
  return controlsPromise;
}

/* ── Authorisation ─────────────────────────────────────────────────── */

/**
 * Resolve the caller's role over one child and assert a capability.
 *
 * Reads every link for the learner (not just the caller's) because the
 * role is derived from the set — see guardianRolesCore. Throws rather
 * than returning a verdict, so no handler can forget to check one.
 *
 * @returns {{role: string, links: Array<object>, child: object}}
 */
async function authorise(db, parentUid, childUid, capability) {
  if (!childUid || typeof childUid !== "string") {
    throw new HttpsError("invalid-argument", "childUid is required.");
  }

  const linkSnap = await db.collection(LINKS).where("learnerUid", "==", childUid).get();
  const links = linkSnap.docs.map((d) => ({id: d.id, ...d.data()}));

  const {roleFor, can} = await loadRoles();
  const role = roleFor(links, parentUid);

  // No link is "not your child" — deliberately the same error as a
  // missing child, so this surface cannot be used to test whether a
  // given uid exists.
  if (!role) throw new HttpsError("permission-denied", "You are not linked to this child.");
  if (!can(role, capability)) {
    throw new HttpsError(
        "permission-denied",
        capability === "manageBilling" || capability === "deleteChild" ?
          "Only the account owner can do that." :
          "You do not have permission to do that.",
        {reason: "role", role},
    );
  }

  const childSnap = await db.collection("users").doc(childUid).get();
  const child = childSnap.exists ? (childSnap.data() || {}) : {};
  return {role, links, child};
}

/* ── Reading a child's activity ────────────────────────────────────── */

/**
 * Collect a child's recent activity from the two collections that
 * actually record it: completed `results` and `noteProgress`. There is
 * no dedicated event log, and inventing one for this screen would mean
 * the timeline only worked for events recorded after today — so it
 * reads the same sources the learner's own dashboard does.
 */
async function readActivity(db, childUid, {days = ACTIVITY_WINDOW_DAYS} = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const items = [];

  const resultsSnap = await db.collection("results")
      .where("userId", "==", childUid)
      .orderBy("completedAt", "desc")
      .limit(120)
      .get()
      .catch(() => null);

  for (const doc of resultsSnap ? resultsSnap.docs : []) {
    const r = doc.data() || {};
    const at = toMillis(r.completedAt || r.createdAt);
    if (at == null || at < since.getTime()) continue;
    const score = Number.isFinite(Number(r.percentage)) ? Math.round(Number(r.percentage)) : null;
    items.push({
      type: r.quizType === "daily_exam" ? "daily_exam" : "quiz",
      title: r.quizTitle || (r.quizType === "daily_exam" ? "Daily quiz" : "Quiz"),
      subjectLabel: typeof r.subject === "string" ? r.subject : null,
      score,
      icon: r.quizType === "daily_exam" ? "🧠" : "📝",
      // A full-marks run is the row a parent enjoys seeing, so it is
      // marked for the highlight treatment the prototype gives wins.
      highlight: score === 100,
      at,
    });
  }

  const notesSnap = await db.collection("noteProgress")
      .where("userId", "==", childUid)
      .limit(120)
      .get()
      .catch(() => null);

  for (const doc of notesSnap ? notesSnap.docs : []) {
    const np = doc.data() || {};
    const at = toMillis(np.completedAt || np.lastOpenedAt || np.updatedAt);
    if (at == null || at < since.getTime()) continue;
    const done = np.status === "completed";
    const isLesson = np.resourceType === "lesson";
    items.push({
      type: done ? "note_completed" : "note_opened",
      title: `${done ? "Read" : "Opened"}: ${np.title || (isLesson ? "a lesson" : "a topic")}`,
      subjectLabel: typeof np.subject === "string" ? np.subject : null,
      score: null,
      icon: "📖",
      at,
    });
  }

  return items;
}

/** The moment a child was last doing anything, for the status pill. */
function lastActiveFrom(items) {
  let latest = null;
  for (const i of items) {
    if (i.at != null && (latest == null || i.at > latest)) latest = i.at;
  }
  return latest;
}

/* ── listGuardianChildren ──────────────────────────────────────────── */

/**
 * Every child linked to the caller, with the caller's role over each and
 * enough progress to render the overview cards.
 */
const listGuardianChildren = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const {roleFor, capabilitiesOf} = await loadRoles();

  const mine = await db.collection(LINKS).where("parentUid", "==", uid).get();
  const childUids = mine.docs.map((d) => (d.data() || {}).learnerUid).filter(Boolean);
  if (childUids.length === 0) return {children: []};

  const children = await Promise.all(childUids.map(async (childUid) => {
    const [allLinksSnap, childSnap, activity] = await Promise.all([
      db.collection(LINKS).where("learnerUid", "==", childUid).get(),
      db.collection("users").doc(childUid).get(),
      readActivity(db, childUid, {days: 30}),
    ]);
    const links = allLinksSnap.docs.map((d) => ({id: d.id, ...d.data()}));
    const role = roleFor(links, uid);
    const child = childSnap.exists ? (childSnap.data() || {}) : {};
    const lastActiveAt = lastActiveFrom(activity);

    return {
      childUid,
      displayName: child.displayName || "your child",
      firstName: child.firstName || (child.displayName || "").split(" ")[0] || null,
      grade: child.grade ?? null,
      role,
      capabilities: capabilitiesOf(role),
      guardianCount: links.length,
      status: childStatus({lastActiveAt, now: Date.now()}),
      lastActiveAt,
      // Deliberately NOT sent: a time-on-task figure and an
      // "exam readiness" percentage. See parentAppCore's header.
    };
  }));

  return {children};
});

/* ── getGuardianChildDetail ────────────────────────────────────────── */

const getGuardianChildDetail = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const childUid = String(request.data?.childUid || "").trim();

  const {role, links, child} = await authorise(db, uid, childUid, "viewProgress");
  const {capabilitiesOf, resolveGuardianRoles} = await loadRoles();
  const {readGuardianControls} = await loadControls();

  const [progress, activity, statsSnap] = await Promise.all([
    aggregateProgress(db, childUid, {windowDays: 30}),
    readActivity(db, childUid, {days: ACTIVITY_WINDOW_DAYS}),
    db.collection("learnerStats").doc(childUid).get().catch(() => null),
  ]);

  const stats = statsSnap && statsSnap.exists ? (statsSnap.data() || {}) : {};
  const roles = resolveGuardianRoles(links);

  return {
    childUid,
    displayName: child.displayName || "your child",
    grade: child.grade ?? null,
    role,
    capabilities: capabilitiesOf(role),
    streak: Number(stats.currentStreak) || 0,
    xp: Number(stats.xp) || 0,
    controls: readGuardianControls(child),
    summary: progress.summary,
    subjectBreakdown: progress.subjectBreakdown,
    recentResults: progress.recentResults,
    activity: groupActivityByDay(activity, {now: Date.now(), days: ACTIVITY_WINDOW_DAYS}),
    guardians: links.map((l) => ({
      parentUid: l.parentUid,
      role: roles.get(l.parentUid) || null,
      isYou: l.parentUid === uid,
      // The other guardian's email is NOT returned. A co-guardian being
      // able to enumerate the family's addresses is not something any
      // screen here needs, and it is the kind of thing that only becomes
      // a problem after a separation.
      displayName: l.parentDisplayName || null,
      createdAt: toMillis(l.createdAt),
    })),
  };
});

/* ── getGuardianChildActivity ──────────────────────────────────────── */

const getGuardianChildActivity = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const childUid = String(request.data?.childUid || "").trim();
  const days = Math.min(Math.max(Number(request.data?.days) || ACTIVITY_WINDOW_DAYS, 1), 30);

  const {child} = await authorise(db, uid, childUid, "viewProgress");
  const items = await readActivity(db, childUid, {days});

  return {
    childUid,
    displayName: child.displayName || "your child",
    days,
    activity: groupActivityByDay(items, {now: Date.now(), days}),
  };
});

/* ── setChildGuardianControl ───────────────────────────────────────── */

/**
 * A guardian turns one of their child's permissions on or off FROM THEIR
 * OWN ACCOUNT.
 *
 * The existing `setGuardianControl` cannot serve this: it writes
 * `users/{request.auth.uid}`, because it is called from inside the
 * child's session. This one is called by a different person about a
 * different account, so it carries a real authorisation check — and it
 * is the stronger of the two, since the caller here is a verified adult
 * with an account rather than whoever passed a times-table sum on the
 * child's phone.
 */
const setChildGuardianControl = onCall({
  secrets: [emailSmtpUser, emailSmtpPassword],
  region: REGION,
  timeoutSeconds: 30,
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const childUid = String(request.data?.childUid || "").trim();
  const key = String(request.data?.key || "");
  const value = request.data?.value;

  const {child} = await authorise(db, uid, childUid, "setChildControls");
  const {isGuardianControl, readGuardianControls, describeControlChange} = await loadControls();

  if (!isGuardianControl(key)) {
    throw new HttpsError("invalid-argument", "That is not a permission we know about.");
  }
  if (typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", "A permission is on or off.");
  }

  const from = readGuardianControls(child)[key];
  if (from === value) return {ok: true, changed: false};

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.doc(`users/${childUid}`).set({
    guardianControls: {[key]: value, updatedAt: now},
  }, {merge: true});

  // Same append-only trail the in-child zone writes to, plus who did it.
  // `by` is what makes the two paths distinguishable after the fact: a
  // change made from a parent's own account is a different kind of
  // event from one made on the child's phone, and support needs to be
  // able to tell a family which it was.
  await db.collection("guardianControlAudit").add({
    uid: childUid,
    control: key,
    from: from ?? null,
    to: value,
    description: describeControlChange(key, value),
    by: uid,
    via: "parent_app",
    at: now,
  });

  return {ok: true, changed: true};
});

/* ── The approval feed ─────────────────────────────────────────────── */

const listGuardianApprovals = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();

  const mine = await db.collection(LINKS).where("parentUid", "==", uid).get();
  const childUids = mine.docs.map((d) => (d.data() || {}).learnerUid).filter(Boolean);
  if (childUids.length === 0) return {approvals: []};

  const childDocs = await db.getAll(...childUids.map((c) => db.collection("users").doc(c)));
  const children = new Map(childDocs.map((snap, i) => [
    childUids[i],
    {displayName: (snap.data() || {}).displayName || "your child"},
  ]));

  // `in` takes at most 30 values; MAX_CHILDREN_PER_PARENT is 20, so one
  // query covers every real family. The slice is a guard, not a design.
  const reqSnap = await db.collection(REQUESTS)
      .where("uid", "in", childUids.slice(0, 30))
      .where("status", "==", "sent")
      .limit(50)
      .get()
      .catch(() => null);

  const requests = reqSnap ? reqSnap.docs.map((d) => ({id: d.id, ...d.data()})) : [];
  return {approvals: shapeApprovalFeed(requests, children, Date.now())};
});

/**
 * Decline a pending request. (There is deliberately no "approve" here —
 * approving a premium unlock means PAYING for it, and the only thing
 * that may flip a request to paid is `settleGuardianRequest`, called
 * after Lenco confirms the money. A button that marked it approved
 * without payment would unlock nothing and tell the child otherwise.)
 */
const declineGuardianApproval = onCall({
  region: REGION,
  timeoutSeconds: 30,
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const requestId = String(request.data?.requestId || "").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId is required.");

  const ref = db.collection(REQUESTS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That request no longer exists.");
  const record = snap.data() || {};

  await authorise(db, uid, record.uid, "approveRequests");

  if (record.status === "paid") return {ok: true, already: true};
  await ref.set({
    status: "declined",
    declinedAt: admin.firestore.FieldValue.serverTimestamp(),
    declinedBy: uid,
  }, {merge: true});

  // The child is told, gently and without a reason. "Not right now" is
  // the whole message: a decline that arrives with an explanation the
  // parent did not write is the app putting words in their mouth.
  try {
    const {createNotification} = require("../notifications/createNotification");
    await createNotification({
      uid: record.uid,
      category: "account",
      type: "guardian_request_declined",
      title: "Not right now",
      body: "Your guardian has seen your request. Everything you already have stays exactly as it is.",
      dedupeKey: `guardian-declined:${requestId}`,
      db,
    });
  } catch (err) {
    console.warn("[parentApp] decline notification failed", err);
  }

  return {ok: true};
});

/* ── The weekly report ─────────────────────────────────────────────── */

const getGuardianWeeklyReport = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const childUid = String(request.data?.childUid || "").trim();

  const {child} = await authorise(db, uid, childUid, "viewProgress");
  const [activity, statsSnap, progress] = await Promise.all([
    readActivity(db, childUid, {days: REPORT_WINDOW_DAYS}),
    db.collection("learnerStats").doc(childUid).get().catch(() => null),
    aggregateProgress(db, childUid, {windowDays: REPORT_WINDOW_DAYS}),
  ]);

  const stats = statsSnap && statsSnap.exists ? (statsSnap.data() || {}) : {};
  const quizzes = activity.filter((a) => a.type === "quiz" || a.type === "daily_exam").length;
  const notes = activity.filter((a) => a.type === "note_completed").length;
  const scored = activity.filter((a) => Number.isFinite(a.score));
  const averageScore = scored.length > 0 ?
    scored.reduce((sum, a) => sum + a.score, 0) / scored.length : null;

  const strongest = (progress.subjectBreakdown || [])
      .filter((s) => Number.isFinite(Number(s.percent ?? s.averageScore)))
      .map((s) => ({label: s.label || s.subject, percent: Number(s.percent ?? s.averageScore)}))
      .sort((a, b) => b.percent - a.percent);

  const report = buildWeeklyReport({
    childName: child.firstName || (child.displayName || "").split(" ")[0] || child.displayName,
    quizzes,
    notes,
    streak: Number(stats.currentStreak) || 0,
    averageScore,
    strongest,
    weakTopics: progress.weakTopics || [],
    daysToExam: null,
  });

  return {childUid, displayName: child.displayName || "your child", report, quizzes, notes};
});

/* ── Family sharing ────────────────────────────────────────────────── */

async function sendMail({to, subject, text}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  if (!senderEmail || !to) return false;
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const crypto = require("crypto");
  const nodemailer = require("nodemailer"); // lazy, matching opsAlert.js
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
    messageId: `<guardian-invite-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
  return true;
}

/**
 * Invite a second guardian to a child.
 *
 * Owner-only, because a co-guardian who could invite further
 * co-guardians would make the owner's control over who sees their
 * child's data nominal.
 */
const inviteCoGuardian = onCall({
  secrets: [emailSmtpUser, emailSmtpPassword],
  region: REGION,
  timeoutSeconds: 30,
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const childUid = String(request.data?.childUid || "").trim();
  const email = normalizeEmail(request.data?.email);

  if (!email) throw new HttpsError("invalid-argument", "A valid email address is required.");

  const {links, child} = await authorise(db, uid, childUid, "manageGuardians");
  if (links.length >= MAX_GUARDIANS_PER_CHILD) {
    throw new HttpsError("resource-exhausted", "This child already has the maximum number of guardians.");
  }

  const inviterSnap = await db.collection("users").doc(uid).get();
  const inviter = inviterSnap.exists ? (inviterSnap.data() || {}) : {};
  if (normalizeEmail(inviter.email) === email) {
    throw new HttpsError("failed-precondition", "That is your own address — you are already a guardian here.");
  }

  // The raw token goes in the email and is never stored; the doc id is
  // its hash, so a leaked database row cannot be redeemed. Same design
  // as the consent tokens in guardianConsent/consentTokens.js.
  const rawToken = randomInviteToken(require("node:crypto").randomBytes);
  const inviteId = hashInviteToken(rawToken);
  const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + CO_GUARDIAN_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.collection(INVITES).doc(inviteId).set({
    learnerUid: childUid,
    invitedBy: uid,
    email,
    role: "co_guardian",
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  const mail = buildCoGuardianInviteEmail({
    inviterName: inviter.displayName || inviter.firstName || null,
    childName: child.firstName || (child.displayName || "").split(" ")[0] || child.displayName,
    acceptUrl: `https://zedexams.com/family/accept?t=${encodeURIComponent(rawToken)}`,
    expiresInDays: CO_GUARDIAN_INVITE_TTL_DAYS,
  });

  let sent = false;
  try {
    sent = await sendMail({to: email, ...mail});
  } catch (err) {
    console.error("[parentApp] co-guardian invite mail failed:", err?.message || err);
  }

  return {ok: true, inviteId, sent, email};
});

/**
 * Accept a co-guardian invite. The caller must be signed in as a parent
 * account, and the invite's email must be theirs — an invite is to a
 * PERSON, and letting a forwarded link be redeemed by whoever opened it
 * would make the address on the invite decorative.
 */
const acceptCoGuardianInvite = onCall({
  region: REGION,
  timeoutSeconds: 30,
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const rawToken = String(request.data?.token || "").trim();
  if (!rawToken) throw new HttpsError("invalid-argument", "This invite link is incomplete.");

  const inviteId = hashInviteToken(rawToken);
  const ref = db.collection(INVITES).doc(inviteId);

  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.exists ? (userSnap.data() || {}) : {};
  if (user.role !== "parent") {
    throw new HttpsError(
        "failed-precondition",
        "Only a parent account can accept this invite. Create or switch to a parent account first.",
    );
  }

  const {roleForNewLink} = await loadRoles();

  // Single-use: the status flip and the link creation happen in one
  // transaction, so two taps on a slow connection cannot make two links
  // or leave an accepted invite with nothing behind it.
  const learnerUid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "This invite is not valid.");
    const invite = snap.data() || {};

    if (invite.status !== "pending") {
      throw new HttpsError("failed-precondition", "This invite has already been used.");
    }
    const expiresAt = toMillis(invite.expiresAt);
    if (expiresAt != null && expiresAt <= Date.now()) {
      throw new HttpsError("failed-precondition", "This invite has expired. Ask for a new one.");
    }
    if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
      throw new HttpsError("permission-denied", "This invite was sent to a different email address.");
    }

    const linkRef = db.collection(LINKS).doc(parentLinkId(uid, invite.learnerUid));
    const existing = await tx.get(linkRef);

    tx.set(ref, {
      status: "accepted",
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      acceptedBy: uid,
    }, {merge: true});

    if (!existing.exists) {
      tx.set(linkRef, {
        parentUid: uid,
        learnerUid: invite.learnerUid,
        parentDisplayName: user.displayName || null,
        // An invited guardian is never the owner, whatever the link set
        // looks like — roleForNewLink is consulted only so a repair that
        // wipes the links cannot silently promote an invitee.
        role: roleForNewLink([{parentUid: invite.invitedBy}]),
        createdVia: "invite",
        invitedBy: invite.invitedBy,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return invite.learnerUid;
  });

  const childSnap = await db.collection("users").doc(learnerUid).get();
  const child = childSnap.exists ? (childSnap.data() || {}) : {};
  return {ok: true, childUid: learnerUid, displayName: child.displayName || "your child"};
});

/** Owner removes a co-guardian (or revokes an invite that is still pending). */
const removeCoGuardian = onCall({
  region: REGION,
  timeoutSeconds: 30,
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const childUid = String(request.data?.childUid || "").trim();
  const parentUid = String(request.data?.parentUid || "").trim();
  const inviteId = String(request.data?.inviteId || "").trim();

  await authorise(db, uid, childUid, "manageGuardians");

  if (inviteId) {
    const ref = db.collection(INVITES).doc(inviteId);
    const snap = await ref.get();
    if (snap.exists && (snap.data() || {}).learnerUid === childUid) {
      await ref.set({status: "revoked", revokedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    }
    return {ok: true};
  }

  if (!parentUid) throw new HttpsError("invalid-argument", "parentUid or inviteId is required.");
  if (parentUid === uid) {
    throw new HttpsError("failed-precondition", "You cannot remove yourself. Transfer ownership first.");
  }

  const {roleFor} = await loadRoles();
  const linkSnap = await db.collection(LINKS).where("learnerUid", "==", childUid).get();
  const links = linkSnap.docs.map((d) => ({id: d.id, ...d.data()}));
  if (roleFor(links, parentUid) === "owner") {
    throw new HttpsError("failed-precondition", "The account owner cannot be removed.");
  }

  await db.collection(LINKS).doc(parentLinkId(parentUid, childUid)).delete();
  return {ok: true};
});

module.exports = {
  acceptCoGuardianInvite,
  declineGuardianApproval,
  getGuardianChildActivity,
  getGuardianChildDetail,
  getGuardianWeeklyReport,
  inviteCoGuardian,
  listGuardianApprovals,
  listGuardianChildren,
  removeCoGuardian,
  setChildGuardianControl,
};
