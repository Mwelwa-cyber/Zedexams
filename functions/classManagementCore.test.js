/**
 * Node test for functions/classManagementCore.js — the pure decision logic
 * behind the teacher-classroom callables (invite codes, roster shaping,
 * join/approve/leave eligibility, assignment payload validation). No
 * firebase-admin / firebase-functions dependency, so this runs under plain
 * `node` with no stubbing required (repo convention, same as
 * aiOperationsCore.test.js).
 *
 * Run: node functions/classManagementCore.test.js
 */

const assert = require("node:assert");
const {
  INVITE_CODE_LENGTH,
  MAX_LEARNERS_PER_CLASS,
  INVITE_TTL_DAYS,
  CODE_ALPHABET,
  randomCode,
  inviteExpiryMs,
  parseInviteCode,
  isInviteExpired,
  classOwnershipError,
  shapeRoster,
  decideJoinRequest,
  decideApproval,
  membershipError,
  parseClassLearnerArgs,
  ALLOWED_ASSIGNMENT_MODES,
  parseAssignmentRequest,
  resolveAssignmentResource,
  isScheduledAssignment,
  buildAssignmentDoc,
  assignmentNotificationRecipients,
  assignmentOwnershipError,
} = require("./classManagementCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const OWNER = "teacher_owner";
const OTHER = "teacher_other";
const LEARNER = "learner_1";
const NOW = 1700000000000;

// ── constants ───────────────────────────────────────────────────────────────
ok("invite code length is 8", INVITE_CODE_LENGTH === 8);
ok("class cap is 200", MAX_LEARNERS_PER_CLASS === 200);
ok("invite TTL is 30 days", INVITE_TTL_DAYS === 30);
ok("alphabet has no 0/O/1/I/L ambiguity", !/[0O1IL]/.test(CODE_ALPHABET));
ok("assignment modes are automatic|manual",
    JSON.stringify(ALLOWED_ASSIGNMENT_MODES) === JSON.stringify(["automatic", "manual"]));

// ── randomCode ──────────────────────────────────────────────────────────────
{
  const code = randomCode();
  ok("default rng yields an 8-char code", code.length === INVITE_CODE_LENGTH);
  ok("default rng stays within the alphabet",
      [...code].every((c) => CODE_ALPHABET.includes(c)));
}
{
  const fixedRng = (n) => Buffer.from(Array.from({length: n}, (_, i) => i));
  const a = randomCode(fixedRng);
  const b = randomCode(fixedRng);
  ok("injected rng makes codes deterministic", a === b);
  ok("bytes map through the alphabet by modulo",
      a === [0, 1, 2, 3, 4, 5, 6, 7].map((i) => CODE_ALPHABET[i % CODE_ALPHABET.length]).join(""));
  const wrapRng = (n) => Buffer.from(Array.from({length: n}, () => CODE_ALPHABET.length));
  ok("byte equal to alphabet length wraps to first char",
      randomCode(wrapRng) === CODE_ALPHABET[0].repeat(INVITE_CODE_LENGTH));
}

// ── inviteExpiryMs ──────────────────────────────────────────────────────────
ok("expiry is now + 30 days in millis",
    inviteExpiryMs(NOW) === NOW + 30 * 24 * 60 * 60 * 1000);

// ── parseInviteCode ─────────────────────────────────────────────────────────
{
  const p = parseInviteCode("  abcd23 ");
  ok("code is trimmed + uppercased", p.code === "ABCD23");
  ok("valid code has no error", !p.error);
}
ok("empty code rejected", parseInviteCode("").error?.code === "invalid-argument");
ok("undefined code rejected", parseInviteCode(undefined).error?.code === "invalid-argument");
ok("5-char code rejected (min 6)", !!parseInviteCode("ABCDE").error);
ok("6-char code accepted", parseInviteCode("ABCDEF").code === "ABCDEF");
ok("16-char code accepted", parseInviteCode("A".repeat(16)).code === "A".repeat(16));
ok("17-char code rejected (max 16)", !!parseInviteCode("A".repeat(17)).error);
ok("invite-code error message is learner-facing",
    parseInviteCode("").error.message === "Enter a valid invite code.");

// ── isInviteExpired ─────────────────────────────────────────────────────────
ok("past expiry is expired", isInviteExpired(NOW - 1, NOW) === true);
ok("future expiry is not expired", isInviteExpired(NOW + 1, NOW) === false);
ok("exactly-now is not expired (strict <)", isInviteExpired(NOW, NOW) === false);
ok("missing expiry never expires", isInviteExpired(null, NOW) === false);

// ── classOwnershipError ─────────────────────────────────────────────────────
ok("owner passes", classOwnershipError({teacherUid: OWNER}, OWNER) === null);
ok("non-owner refused",
    classOwnershipError({teacherUid: OWNER}, OTHER)?.code === "permission-denied");
ok("no requireOwnerUid skips the check",
    classOwnershipError({teacherUid: OWNER}, undefined) === null);

// ── shapeRoster ─────────────────────────────────────────────────────────────
{
  const r = shapeRoster({learners: ["a"], pendingLearners: ["b"]});
  ok("arrays pass through", r.learners[0] === "a" && r.pendingLearners[0] === "b");
}
{
  const r = shapeRoster({learners: "corrupt", pendingLearners: undefined});
  ok("non-array roster fields become empty arrays",
      Array.isArray(r.learners) && r.learners.length === 0 &&
      Array.isArray(r.pendingLearners) && r.pendingLearners.length === 0);
}

// ── decideJoinRequest ───────────────────────────────────────────────────────
ok("inactive class refuses joins",
    decideJoinRequest({classData: {active: false}, uid: LEARNER}).error?.code === "failed-precondition");
ok("active:undefined is treated as active (only === false blocks)",
    decideJoinRequest({classData: {}, uid: LEARNER}).outcome === "join");
ok("existing learner reports already-approved",
    decideJoinRequest({classData: {learners: [LEARNER]}, uid: LEARNER}).outcome === "already-approved");
ok("pending learner reports already-pending",
    decideJoinRequest({classData: {pendingLearners: [LEARNER]}, uid: LEARNER}).outcome === "already-pending");
{
  const learners = Array.from({length: 150}, (_, i) => `l${i}`);
  const pendingLearners = Array.from({length: 50}, (_, i) => `p${i}`);
  const d = decideJoinRequest({classData: {learners, pendingLearners}, uid: LEARNER});
  ok("cap counts learners + pending combined", d.error?.code === "resource-exhausted");
}
{
  const learners = Array.from({length: 150}, (_, i) => `l${i}`);
  const pendingLearners = Array.from({length: 49}, (_, i) => `p${i}`);
  const d = decideJoinRequest({classData: {learners, pendingLearners}, uid: LEARNER});
  ok("one under the cap still joins", d.outcome === "join");
}
{
  const learners = Array.from({length: 200}, (_, i) => `l${i}`);
  const d = decideJoinRequest({classData: {learners: learners.concat(), pendingLearners: []}, uid: learners[5]});
  ok("member of a full class still resolves already-approved (membership beats cap)",
      d.outcome === "already-approved");
}

// ── decideApproval ──────────────────────────────────────────────────────────
ok("learner not pending refuses approval",
    decideApproval({classData: {pendingLearners: []}, learnerUid: LEARNER}).error?.code === "failed-precondition");
ok("pending learner approved when room",
    decideApproval({classData: {pendingLearners: [LEARNER], learners: []}, learnerUid: LEARNER}).ok === true);
{
  const learners = Array.from({length: 200}, (_, i) => `l${i}`);
  const d = decideApproval({classData: {pendingLearners: [LEARNER], learners}, learnerUid: LEARNER});
  ok("full learners roster blocks approval", d.error?.code === "resource-exhausted");
}
{
  const learners = Array.from({length: 199}, (_, i) => `l${i}`);
  const d = decideApproval({classData: {pendingLearners: [LEARNER], learners}, learnerUid: LEARNER});
  ok("199 learners still has room for one approval", d.ok === true);
}

// ── membershipError (leaveClass) ────────────────────────────────────────────
ok("approved member may leave", membershipError({learners: [LEARNER]}, LEARNER) === null);
ok("pending member may leave", membershipError({pendingLearners: [LEARNER]}, LEARNER) === null);
ok("non-member refused",
    membershipError({learners: ["x"], pendingLearners: ["y"]}, LEARNER)?.code === "failed-precondition");
ok("corrupt rosters treated as empty (non-member)",
    membershipError({learners: null, pendingLearners: 42}, LEARNER)?.code === "failed-precondition");

// ── parseClassLearnerArgs ───────────────────────────────────────────────────
{
  const a = parseClassLearnerArgs({classId: " c1 ", learnerUid: " u1 "});
  ok("classId/learnerUid trimmed", a.classId === "c1" && a.learnerUid === "u1");
}
ok("missing learnerUid rejected",
    parseClassLearnerArgs({classId: "c1"}).error?.code === "invalid-argument");
ok("missing classId rejected",
    parseClassLearnerArgs({learnerUid: "u1"}).error?.code === "invalid-argument");
ok("null data rejected", !!parseClassLearnerArgs(null).error);

// ── parseAssignmentRequest: validation branches ─────────────────────────────
const BASE_ASSIGN = {classId: "c1", resourceType: "quiz", resourceId: "q1"};
ok("missing classId rejected",
    parseAssignmentRequest({...BASE_ASSIGN, classId: ""}, NOW).error?.message === "classId is required.");
ok("bad resourceType rejected",
    parseAssignmentRequest({...BASE_ASSIGN, resourceType: "lesson"}, NOW).error?.message ===
      "resourceType must be 'quiz' or 'exam'.");
ok("exam resourceType accepted",
    !parseAssignmentRequest({...BASE_ASSIGN, resourceType: "exam"}, NOW).error);
ok("missing resourceId rejected",
    parseAssignmentRequest({...BASE_ASSIGN, resourceId: ""}, NOW).error?.message === "resourceId is required.");
ok("dueAt more than 60s in the past rejected",
    parseAssignmentRequest({...BASE_ASSIGN, dueAtMs: NOW - 61000}, NOW).error?.message ===
      "Due date must be in the future.");
ok("dueAt within the 60s grace window accepted",
    !parseAssignmentRequest({...BASE_ASSIGN, dueAtMs: NOW - 59000}, NOW).error);
ok("openAt after dueAt rejected",
    parseAssignmentRequest({...BASE_ASSIGN, dueAtMs: NOW + 1000, openAtMs: NOW + 2000}, NOW).error?.message ===
      "Open date must be before the due date.");
ok("openAt before dueAt accepted",
    !parseAssignmentRequest({...BASE_ASSIGN, dueAtMs: NOW + 2000, openAtMs: NOW + 1000}, NOW).error);
ok("openAt without dueAt accepted (no ordering to violate)",
    !parseAssignmentRequest({...BASE_ASSIGN, openAtMs: NOW + 2000}, NOW).error);

// ── parseAssignmentRequest: defaults + shaping ──────────────────────────────
{
  const p = parseAssignmentRequest(BASE_ASSIGN, NOW);
  ok("assignmentMode defaults to manual", p.assignmentMode === "manual");
  ok("notifyLearners defaults to true", p.notifyLearners === true);
  ok("booleans default off",
      p.timed === false && p.allowRetakes === false && p.shuffleQuestions === false &&
      p.lockAfterSubmission === false && p.addToDailyChallenge === false);
  ok("template defaults to null", p.template === null);
  ok("learnerUids defaults to null", p.learnerUids === null);
  ok("dueAtMs/openAtMs default to null", p.dueAtMs === null && p.openAtMs === null);
}
{
  const p = parseAssignmentRequest({...BASE_ASSIGN, assignmentMode: "automatic"}, NOW);
  ok("automatic mode accepted", p.assignmentMode === "automatic");
}
{
  const p = parseAssignmentRequest({...BASE_ASSIGN, assignmentMode: "chaotic"}, NOW);
  ok("unknown mode falls back to manual", p.assignmentMode === "manual");
}
{
  const p = parseAssignmentRequest({...BASE_ASSIGN, notifyLearners: false}, NOW);
  ok("notifyLearners:false honoured", p.notifyLearners === false);
}
{
  const p = parseAssignmentRequest({...BASE_ASSIGN, template: "x".repeat(60)}, NOW);
  ok("template capped at 40 chars", p.template === "x".repeat(40));
}
{
  const p = parseAssignmentRequest({...BASE_ASSIGN, template: 42}, NOW);
  ok("non-string template becomes null", p.template === null);
}
{
  const raw = [" u1 ", "", 42, "u2", "x".repeat(201)];
  const p = parseAssignmentRequest({...BASE_ASSIGN, learnerUids: raw}, NOW);
  ok("learnerUids trimmed + non-strings/empties/oversize dropped",
      JSON.stringify(p.learnerUids) === JSON.stringify(["u1", "u2"]));
}
{
  const raw = Array.from({length: 250}, (_, i) => `u${i}`);
  const p = parseAssignmentRequest({...BASE_ASSIGN, learnerUids: raw}, NOW);
  ok("learnerUids capped at 200", p.learnerUids.length === 200);
}
{
  const p = parseAssignmentRequest({...BASE_ASSIGN, learnerUids: "not-an-array"}, NOW);
  ok("non-array learnerUids becomes null", p.learnerUids === null);
}
{
  const p = parseAssignmentRequest({...BASE_ASSIGN, dueAtMs: "oops"}, NOW);
  ok("non-numeric dueAtMs coerces to null", p.dueAtMs === null);
}

// ── resolveAssignmentResource: quiz gate ────────────────────────────────────
const CLASS_DATA = {subject: "science", grade: "7"};
{
  const r = resolveAssignmentResource({
    resourceType: "quiz",
    resource: {isPublished: true, title: "Cells", subject: "biology", grade: 8},
    uid: OTHER, callerIsAdmin: false, classData: CLASS_DATA,
  });
  ok("published quiz assignable by anyone", !r.error);
  ok("quiz title/subject win over class defaults",
      r.resourceTitle === "Cells" && r.resourceSubject === "biology");
  ok("quiz grade stringified", r.resourceGrade === "8");
}
{
  const r = resolveAssignmentResource({
    resourceType: "quiz",
    resource: {isPublished: false, createdBy: OWNER},
    uid: OWNER, callerIsAdmin: false, classData: CLASS_DATA,
  });
  ok("author may assign own draft", !r.error);
  ok("untitled quiz falls back to 'Assigned work'", r.resourceTitle === "Assigned work");
  ok("missing quiz subject/grade fall back to the class",
      r.resourceSubject === "science" && r.resourceGrade === "7");
}
{
  const r = resolveAssignmentResource({
    resourceType: "quiz",
    resource: {isPublished: false, createdBy: OWNER},
    uid: OTHER, callerIsAdmin: true, classData: CLASS_DATA,
  });
  ok("admin may assign someone else's draft", !r.error);
}
{
  const r = resolveAssignmentResource({
    resourceType: "quiz",
    resource: {isPublished: false, createdBy: OWNER},
    uid: OTHER, callerIsAdmin: false, classData: CLASS_DATA,
  });
  ok("stranger's draft refused", r.error?.code === "permission-denied");
  ok("draft refusal message preserved",
      r.error.message === "You can only assign published quizzes or your own drafts.");
}

// ── resolveAssignmentResource: exam gate ────────────────────────────────────
{
  const r = resolveAssignmentResource({
    resourceType: "exam",
    resource: {quizType: "daily_exam", title: "Friday exam"},
    uid: OTHER, callerIsAdmin: false, classData: CLASS_DATA,
  });
  ok("daily exam assignable", !r.error && r.resourceTitle === "Friday exam");
}
{
  const r = resolveAssignmentResource({
    resourceType: "exam",
    resource: {quizType: "quiz"},
    uid: OWNER, callerIsAdmin: true, classData: CLASS_DATA,
  });
  ok("non-daily-exam doc refused even for admin", r.error?.code === "invalid-argument");
  ok("exam refusal message preserved", r.error.message === "That is not a daily exam.");
}
{
  const r = resolveAssignmentResource({
    resourceType: "exam",
    resource: {quizType: "daily_exam"},
    uid: OWNER, callerIsAdmin: false, classData: {},
  });
  ok("class without subject/grade denormalises nulls",
      r.resourceSubject === null && r.resourceGrade === null);
}

// ── isScheduledAssignment ───────────────────────────────────────────────────
ok("openAt >60s ahead is scheduled", isScheduledAssignment(NOW + 61000, NOW) === true);
ok("openAt within 60s is not scheduled", isScheduledAssignment(NOW + 59000, NOW) === false);
ok("no openAt is not scheduled", isScheduledAssignment(null, NOW) === false);

// ── buildAssignmentDoc ──────────────────────────────────────────────────────
{
  const parsed = parseAssignmentRequest({
    ...BASE_ASSIGN,
    timed: true,
    allowRetakes: true,
    learnerUids: ["u1", "u2"],
    template: "weekly",
    assignmentMode: "automatic",
  }, NOW);
  const dueAt = {kind: "dueAt"};
  const openAt = {kind: "openAt"};
  const assignedAt = {kind: "serverTimestamp"};
  const doc = buildAssignmentDoc({
    parsed,
    resolved: {resourceTitle: "Cells", resourceSubject: "biology", resourceGrade: "8"},
    uid: OWNER, dueAt, openAt, isScheduled: true, assignedAt,
  });
  ok("doc carries class/teacher/resource identity",
      doc.classId === "c1" && doc.teacherUid === OWNER &&
      doc.resourceType === "quiz" && doc.resourceId === "q1");
  ok("scheduled openAt yields status 'scheduled'", doc.status === "scheduled" && doc.active === true);
  ok("timestamps pass through untouched",
      doc.dueAt === dueAt && doc.openAt === openAt && doc.assignedAt === assignedAt);
  ok("settings mirror the parsed flags",
      doc.settings.timed === true && doc.settings.allowRetakes === true &&
      doc.settings.shuffleQuestions === false && doc.settings.notifyLearners === true);
  ok("explicit learnerUids kept", JSON.stringify(doc.learnerUids) === JSON.stringify(["u1", "u2"]));
  ok("mode + template stored", doc.assignmentMode === "automatic" && doc.template === "weekly");
  ok("denormalised subject/grade stored", doc.subject === "biology" && doc.grade === "8");
}
{
  const parsed = parseAssignmentRequest(BASE_ASSIGN, NOW);
  const doc = buildAssignmentDoc({
    parsed,
    resolved: {resourceTitle: "T".repeat(250), resourceSubject: null, resourceGrade: null},
    uid: OWNER, dueAt: null, openAt: null, isScheduled: false, assignedAt: null,
  });
  ok("unscheduled doc is 'active'", doc.status === "active");
  ok("title capped at 200 chars", doc.resourceTitle === "T".repeat(200));
  ok("empty learnerUids stored as null", doc.learnerUids === null);
}

// ── assignmentNotificationRecipients ────────────────────────────────────────
ok("explicit learnerUids win over the roster",
    JSON.stringify(assignmentNotificationRecipients({learnerUids: ["u1"], classData: {learners: ["a", "b"]}})) ===
      JSON.stringify(["u1"]));
ok("empty learnerUids falls back to the roster",
    JSON.stringify(assignmentNotificationRecipients({learnerUids: [], classData: {learners: ["a", "b"]}})) ===
      JSON.stringify(["a", "b"]));
ok("null learnerUids + corrupt roster yields no recipients",
    assignmentNotificationRecipients({learnerUids: null, classData: {learners: "corrupt"}}).length === 0);
{
  const roster = Array.from({length: 250}, (_, i) => `l${i}`);
  ok("recipients capped at 200",
      assignmentNotificationRecipients({learnerUids: null, classData: {learners: roster}}).length === 200);
}

// ── assignmentOwnershipError ────────────────────────────────────────────────
ok("assigning teacher may remove", assignmentOwnershipError({teacherUid: OWNER}, OWNER) === null);
ok("other teacher refused",
    assignmentOwnershipError({teacherUid: OWNER}, OTHER)?.code === "permission-denied");

console.log(`\nclassManagementCore: ${passed} assertions passed`);
