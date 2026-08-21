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
const {HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {claimForGuardian} = require("../guardianLink/convergence");
const {aggregateProgress} = require("../parentPortalShared");
const {activeLinks, parentLinkId} = require("../familyPortalCore");
const {
  enforceRateLimit,
  standardBuckets,
  resolveClientIp,
} = require("../rateLimit");
const {
  buildWeeklyReport,
  childPlanState,
  childStatus,
  groupActivityByDay,
  shapeApprovalFeed,
  toMillis,
} = require("./parentAppCore");
const {
  WITHDRAWN_DELETION_DAYS,
  deniedRecord,
  grantedRecord,
  isGuardianSuspension,
  restoredRecord,
} = require("../guardianConsent/consentRecord");
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

// The mail transport reads the secrets from the process environment rather
// than holding `defineSecret` params of its own. The BUILDERS live in
// functions/index.js (test:functions-manifest requires it: an export whose
// onCall wrapper moves out of index.js takes its region, secrets and runtime
// options out of that guard's sight), and they are what bind these two.
const SMTP_USER_ENV = "EMAIL_SMTP_USER";
const SMTP_PASSWORD_ENV = "EMAIL_SMTP_PASSWORD";

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
let linkCorePromise = null;
function loadLinkCore() {
  if (!linkCorePromise) linkCorePromise = import("../shared/guardian/guardianLinkCore.js");
  return linkCorePromise;
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
  // ACTIVE links only. A pending link (redeemed but not yet confirmed by
  // the child) and a declined one authorise nothing, and filtering here
  // rather than at each call site is what makes that true for every
  // handler below — `authorise` is the one gate they all pass through.
  // It also keeps the OWNER computation honest: a pending link must not
  // count as a guardian when deciding who owns the account.
  const links = activeLinks(linkSnap.docs.map((d) => ({id: d.id, ...d.data()})));

  const {roleFor, can} = await loadRoles();
  const core = await loadLinkCore();
  const role = roleFor(links, parentUid);

  // No link is "not your child" — deliberately the same error as a
  // missing child, so this surface cannot be used to test whether a
  // given uid exists.
  if (!role) throw new HttpsError("permission-denied", "You are not linked to this child.");

  // AN UNCONFIRMED LINK GRANTS NOTHING. This is the server half of the
  // child's confirmation step, and it is the only reason that step is
  // worth anything: a family code that reached the wrong adult creates a
  // `pending` link, and every read of a child's data — progress,
  // activity, the weekly report — passes through here.
  //
  // Same message as "not linked", again on purpose. Telling a stranger
  // "this child exists but has not confirmed you" is telling them to
  // wait and try again; telling them nothing is telling them nothing.
  // The pending state is surfaced to the parent through
  // listGuardianChildren, which is reached from their OWN link and so
  // needs no such protection.
  const mineRaw = links.find((l) => l.parentUid === parentUid) || {};
  if (!core.linkIsApproved(mineRaw)) {
    const state = core.normalizeLink(mineRaw).state;
    throw new HttpsError(
        "permission-denied",
        "You are not linked to this child.",
        {reason: state === core.LINK_CONSENT.WITHDRAWN ? "withdrawn" : "unconfirmed"},
    );
  }
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
async function listGuardianChildren(request) {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const {roleFor, capabilitiesOf} = await loadRoles();
  const core = await loadLinkCore();

  // CONVERGENCE, on every visit rather than only at signup.
  //
  // A guardian who approved by email before they had an account has a
  // CLAIM against their address, not a link. Sweeping here — the parent
  // app's first read — is what makes "the child named mum@example.com in
  // March and mum signed up in June" resolve to one guardian holding one
  // link. Doing it at signup alone would miss the common case: parents
  // verify their address after registering, and a claim can only be
  // redeemed once the address is verified.
  //
  // Never throws (see convergence.js) — a sweep failure must degrade to
  // "no new children this visit", not to an unopenable dashboard.
  await claimForGuardian(db, uid).catch((err) => {
    console.warn("[parentApp] claim sweep failed", err?.message || err);
  });

  // Same rule as `authorise`: only confirmed links. A parent whose child
  // has not answered yet sees no child here — the request is shown to
  // THEM as pending by listPendingFamilyLinks, not as a half-linked row
  // whose cards would all be empty.
  const mine = await db.collection(LINKS).where("parentUid", "==", uid).get();
  const childUids = activeLinks(mine.docs.map((d) => ({id: d.id, ...d.data()})))
      .map((link) => link.learnerUid)
      .filter(Boolean);
  if (childUids.length === 0) return {children: []};

  const children = await Promise.all(childUids.map(async (childUid) => {
    const [allLinksSnap, childSnap, activity] = await Promise.all([
      db.collection(LINKS).where("learnerUid", "==", childUid).get(),
      db.collection("users").doc(childUid).get(),
      readActivity(db, childUid, {days: 30}),
    ]);
    const links = activeLinks(allLinksSnap.docs.map((d) => ({id: d.id, ...d.data()})));
    const role = roleFor(links, uid);
    const child = childSnap.exists ? (childSnap.data() || {}) : {};
    const lastActiveAt = lastActiveFrom(activity);
    const planState = childPlanState(child, Date.now());

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
      // Whether this child is already covered, and with what. The parent
      // app's plan banner and every Unlock row read `premium`, because an
      // offer made to a guardian who paid last week is worse than no offer
      // at all — and the dashboard reads `plan` so a guardian who HAS paid
      // finds a screen that says so. Both come from one call: the boolean
      // is kept beside the object rather than derived from it at every
      // reader, because the two are read by different code (the chrome
      // asks "is anyone unpaid", the card asks "what is this child on")
      // and a screen resolving the question its own way is how the two
      // drift.
      premium: planState.premium,
      plan: {
        premium: planState.premium,
        planId: planState.planId,
        planLabel: planState.planLabel,
        expiresAt: planState.expiresAt,
        source: planState.source,
      },
      // The consent record, so /family/account/consent can show what
      // this guardian has approved without a second round trip — and so
      // the promise on /child-safety ("you can see, change and withdraw
      // it") has something behind it in the product.
      consent: consentSummary(child),
      // ── The LINK's own state, which is a different question ─────────
      //
      // `consent` above is the account-level record: what this guardian
      // has approved about the child. These four are about the LINK: is
      // this particular guardian confirmed, is the child approved by
      // anyone, and what has each adult switched off.
      //
      // `linkState` folds `status` (the confirmation flag, owned by the
      // family-code flow) together with `consent.state` (withdrawal,
      // which `status` has no way to express). A parent whose link is
      // still pending sees a card saying what it is waiting for, rather
      // than an empty dashboard they would reasonably read as broken.
      linkState: core.readLinkState(links.find((l) => l.parentUid === uid) || {}),
      childApproved: core.resolveLinkConsent(links, {
        accountStatus: child?.guardian?.consentStatus,
      }).approved,
      permissions: core.readLinkPermissions(links.find((l) => l.parentUid === uid) || {}),
      effectivePermissions: core.resolveLinkPermissions(links)
      // Deliberately NOT sent: a time-on-task figure and an
      // "exam readiness" percentage. See parentAppCore's header.
    };
  }));

  return {children};
}

/* ── getGuardianChildDetail ────────────────────────────────────────── */

async function getGuardianChildDetail(request) {
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
  const planState = childPlanState(child, Date.now());
  const roles = resolveGuardianRoles(links);

  return {
    childUid,
    displayName: child.displayName || "your child",
    grade: child.grade ?? null,
    role,
    capabilities: capabilitiesOf(role),
    streak: Number(stats.currentStreak) || 0,
    xp: Number(stats.xp) || 0,
    // The same plan facts the overview card shows, so a guardian who
    // taps through from a "Free plan" pill lands on a screen that agrees
    // with it. Resolved here rather than passed down from the list,
    // because this callable is also reached directly by a bookmark.
    plan: {
      premium: planState.premium,
      planId: planState.planId,
      planLabel: planState.planLabel,
      expiresAt: planState.expiresAt,
      source: planState.source,
    },
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
}

/* ── getGuardianChildActivity ──────────────────────────────────────── */

async function getGuardianChildActivity(request) {
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
}

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
async function setChildGuardianControl(request) {
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
}

/* ── The approval feed ─────────────────────────────────────────────── */

async function listGuardianApprovals(request) {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();

  // Active links only — a guardian whose link the child has not confirmed
  // must not be handed that child's unlock requests to approve.
  const mine = await db.collection(LINKS).where("parentUid", "==", uid).get();
  const childUids = activeLinks(mine.docs.map((d) => ({id: d.id, ...d.data()})))
      .map((link) => link.learnerUid)
      .filter(Boolean);
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

  // Deletion requests addressed to THIS guardian. A separate query and a
  // separate key rather than folded into the unlock feed, because they are not
  // the same kind of thing: an unlock request asks for money and waits
  // indefinitely, a deletion request is time-boxed and irreversible. Merging
  // them would mean one shape permissive enough for both, and one styling
  // decision covering an amber nudge and a red alert.
  const delSnap = await db.collection("accountDeletionRequests")
      .where("guardianUid", "==", uid)
      .where("state", "==", "pending_guardian")
      .limit(20)
      .get()
      .catch(() => null);

  const deletionRequests = delSnap ? delSnap.docs.map((d) => {
    const data = d.data() || {};
    const child = children.get(data.learnerId) || {};
    return {
      id: d.id,
      learnerId: data.learnerId,
      childName: data.learnerDisplayName || child.displayName || "Your child",
      requestedAt: toMillis(data.requestedAt),
      parkedAt: toMillis(data.parkedAt) || null,
    };
  }) : [];

  const requests = reqSnap ? reqSnap.docs.map((d) => ({id: d.id, ...d.data()})) : [];
  return {
    approvals: shapeApprovalFeed(requests, children, Date.now()),
    deletionRequests,
  };
}

/**
 * Decline a pending request. (There is deliberately no "approve" here —
 * approving a premium unlock means PAYING for it, and the only thing
 * that may flip a request to paid is `settleGuardianRequest`, called
 * after Lenco confirms the money. A button that marked it approved
 * without payment would unlock nothing and tell the child otherwise.)
 */
async function declineGuardianApproval(request) {
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
}

/* ── The weekly report ─────────────────────────────────────────────── */

async function getGuardianWeeklyReport(request) {
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
}

/* ── The guardian pay link ─────────────────────────────────────────── */

/**
 * Resolve the token in a guardian's pay link.
 *
 * `requestGuardianUnlock` mails every guardian a link to
 * /guardian-unlock?t=<raw token>, and the raw token is never stored —
 * `guardianRequests`' doc id is its sha256. So the landing page cannot
 * look anything up without asking the server to hash it.
 *
 * UNAUTHENTICATED on purpose: the guardian who receives that email may
 * have no ZedExams account at all, and a link that demands a sign-in
 * before it will say what it is about is a link people close. What it
 * returns is bounded to what the email they are holding already told
 * them — the child's first name and the plan quoted — and it requires a
 * 32-byte secret to return anything. It grants nothing; paying still
 * goes through the authorised checkout.
 */
async function resolveGuardianPayLink(request) {
  const rawToken = String(request.data?.token || "").trim();
  if (!rawToken) return {valid: false, reason: "missing"};

  const db = admin.firestore();

  // Unauthenticated by design (see the header) — and every call with a
  // token-shaped string reaches two Firestore reads before it can reject.
  // The 32-byte secret makes guessing infeasible, but that is a DISCLOSURE
  // argument and says nothing about cost; the sibling unauthenticated
  // callable, assessRecaptcha, caps itself per source IP for exactly this
  // reason and this one did not.
  //
  // The cap answers with the same shape a bad token gets, rather than
  // throwing: a guardian who has just opened a link from their email should
  // never see an error page because somebody else hammered the endpoint, and
  // "we could not resolve this link" is already a state the landing page
  // renders. A limiter that is itself unwell must not block a real guardian,
  // so it fails open.
  try {
    const ip = request.rawRequest ? resolveClientIp(request.rawRequest) : "unknown";
    const rl = await enforceRateLimit(
        db,
        standardBuckets({action: "guardian-pay-link", ip, ipPerMin: 30}),
    );
    if (!rl.allowed) return {valid: false, reason: "rate-limited"};
  } catch (_rlErr) { /* fail open — a limiter fault must not close a real link */ }

  const requestId = require("node:crypto")
      .createHash("sha256").update(rawToken).digest("hex");

  const snap = await db.collection(REQUESTS).doc(requestId).get();
  if (!snap.exists) return {valid: false, reason: "unknown"};
  const record = snap.data() || {};

  const expiresAt = toMillis(record.expiresAt);
  if (expiresAt != null && expiresAt <= Date.now()) return {valid: false, reason: "expired"};
  if (record.status === "paid") return {valid: false, reason: "already-paid", requestId};
  if (record.status !== "sent") return {valid: false, reason: "withdrawn"};

  const childSnap = await db.collection("users").doc(record.uid).get();
  const child = childSnap.exists ? (childSnap.data() || {}) : {};

  return {
    valid: true,
    requestId,
    childUid: record.uid,
    // First name only. The email said this much; the surname is not
    // needed to decide and is not offered.
    childFirstName: child.firstName || (child.displayName || "").split(" ")[0] || "your child",
    planId: record.planId || null,
    priceZMW: Number.isFinite(Number(record.priceZMW)) ? Number(record.priceZMW) : null,
    feature: record.feature || null,
  };
}

/* ── Family sharing ────────────────────────────────────────────────── */

async function sendMail({to, subject, text}) {
  const senderEmail = String(process.env[SMTP_USER_ENV] || "").trim();
  if (!senderEmail || !to) return false;
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const crypto = require("crypto");
  const nodemailer = require("nodemailer"); // lazy, matching opsAlert.js
  const transporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {user: senderEmail, pass: process.env[SMTP_PASSWORD_ENV]},
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
async function inviteCoGuardian(request) {
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
}

/**
 * Accept a co-guardian invite. The caller must be signed in as a parent
 * account, and the invite's email must be theirs — an invite is to a
 * PERSON, and letting a forwarded link be redeemed by whoever opened it
 * would make the address on the invite decorative.
 */
async function acceptCoGuardianInvite(request) {
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
}

/** Owner removes a co-guardian (or revokes an invite that is still pending). */
async function removeCoGuardian(request) {
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
}

/* ── Guardian consent ──────────────────────────────────────────────── */

/**
 * The child's consent record, flattened for the parent app.
 *
 * `unknown` is a real answer and is reported as one. Every learner
 * account created before the consent flow existed is in that state (see
 * shared/consent/guardianConsentCore.js), and calling it "not approved"
 * would tell hundreds of guardians their child is unapproved because of a
 * migration rather than because of anything they did.
 */
function consentSummary(child) {
  const guardian = (child && typeof child.guardian === "object" && child.guardian) || {};
  const status = typeof guardian.consentStatus === "string" ? guardian.consentStatus : "unknown";
  return {
    status,
    decidedAt: toMillis(guardian.decidedAt),
    via: (guardian.evidence && guardian.evidence.via) || null,
    // Whether a re-approval here would lift the account's suspension.
    // Reported so the screen can say "this is reversible" only when it is.
    restorable: isGuardianSuspension(child),
  };
}

/**
 * A guardian grants or withdraws consent for a linked child.
 *
 * ── Why withdrawing suspends the account ────────────────────────────
 *
 * Because that is what withdrawing consent MEANS. Under Zambia's Data
 * Protection Act the consent is the lawful basis for processing the
 * child's data; without it we may not carry on. So this writes exactly
 * what the emailed "this wasn't me" writes — denied, suspended, deletion
 * scheduled 30 days out — through the same shared record builder, rather
 * than inventing a softer third state that would leave a child using an
 * account their guardian has withdrawn.
 *
 * ── And why it is reversible ────────────────────────────────────────
 *
 * A control that cannot be undone is a control people are afraid to use,
 * and a guardian who taps withdraw by mistake would otherwise have 30
 * days and a support email. Re-granting restores the account — but only
 * when the suspension is one WE caused (`isGuardianSuspension`). An
 * account an administrator suspended for something else stays suspended:
 * a consent decision must never be a route around moderation.
 *
 * Owner-only (`deleteChild`), because a co-guardian who could withdraw
 * consent could delete the account without being allowed to delete the
 * account.
 */
async function setGuardianConsent(request) {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  const db = admin.firestore();
  const childUid = String(request.data?.childUid || "").trim();
  const decision = String(request.data?.decision || "").trim();

  if (decision !== "granted" && decision !== "withdrawn") {
    throw new HttpsError("invalid-argument", "decision must be 'granted' or 'withdrawn'.");
  }

  const {child} = await authorise(db, uid, childUid, "deleteChild");

  const parentSnap = await db.collection("users").doc(uid).get();
  const parent = parentSnap.exists ? (parentSnap.data() || {}) : {};
  const now = admin.firestore.FieldValue.serverTimestamp();
  const evidence = {
    via: "parent_app",
    guardianUid: uid,
    guardianEmail: parent.email || "",
  };

  if (decision === "withdrawn") {
    await db.collection("users").doc(childUid).set(deniedRecord({
      now,
      evidence,
      reason: "guardian_withdrew",
      deletionAt: new Date(Date.now() + WITHDRAWN_DELETION_DAYS * 24 * 60 * 60 * 1000),
    }), {merge: true});
    return {ok: true, status: "denied", deletionInDays: WITHDRAWN_DELETION_DAYS};
  }

  // Granting. `restoredRecord` ALSO clears the suspension, so it is used
  // only when the suspension is one this flow caused; otherwise the plain
  // consent record goes in on its own and whatever suspended the account
  // keeps it suspended.
  const record = isGuardianSuspension(child) ?
    restoredRecord({now, evidence}) :
    grantedRecord({now, evidence});

  await db.collection("users").doc(childUid).set(record, {merge: true});
  return {ok: true, status: "granted"};
}

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
  resolveGuardianPayLink,
  setChildGuardianControl,
  setGuardianConsent,
};
