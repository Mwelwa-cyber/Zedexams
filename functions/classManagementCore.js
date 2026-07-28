/**
 * functions/classManagementCore.js
 *
 * Pure decision logic behind the teacher-classroom callables in
 * classManagement.js — invite-code minting/validation, roster shaping,
 * join/approve/leave eligibility, and assignment payload validation.
 * No firebase-admin / firebase-functions imports, so it runs under plain
 * `node functions/classManagementCore.test.js` (same *Core.js split as
 * googlePlayBillingCore.js / aiOperationsCore.js). All Firestore/auth I/O
 * stays in classManagement.js, which maps each returned
 * `{code, message}` error onto an HttpsError with the same code/message
 * as before the split.
 *
 * Time is injected as epoch millis and randomness as an injectable
 * `randomBytes` (defaulting to node:crypto) so every decision here is
 * deterministic under test.
 */

const nodeCrypto = require("node:crypto");

const INVITE_CODE_LENGTH = 8;
const MAX_LEARNERS_PER_CLASS = 200;
const INVITE_TTL_DAYS = 30;

// Avoid 0/O and 1/I/L ambiguity — codes get spoken aloud / written
// on whiteboards during onboarding sessions.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(randomBytes = nodeCrypto.randomBytes) {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

// Epoch millis at which a code minted "now" expires.
function inviteExpiryMs(nowMs) {
  return nowMs + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

// Normalise + validate a learner-typed invite code.
// Returns {code} or {error:{code,message}}.
function parseInviteCode(raw) {
  const code = String(raw || "").trim().toUpperCase();
  if (!code || code.length < 6 || code.length > 16) {
    return {error: {code: "invalid-argument", message: "Enter a valid invite code."}};
  }
  return {code};
}

function isInviteExpired(expiresAtMs, nowMs) {
  return Boolean(expiresAtMs && expiresAtMs < nowMs);
}

// Pure half of loadClassOrThrow's owner gate.
function classOwnershipError(classData, requireOwnerUid) {
  if (requireOwnerUid && classData.teacherUid !== requireOwnerUid) {
    return {code: "permission-denied", message: "Only the class owner can do that."};
  }
  return null;
}

// Firestore array fields can arrive as anything a legacy client wrote.
function shapeRoster(classData) {
  return {
    learners: Array.isArray(classData.learners) ? classData.learners : [],
    pendingLearners: Array.isArray(classData.pendingLearners) ? classData.pendingLearners : [],
  };
}

/**
 * joinClassByCode eligibility. Returns one of:
 *   {error:{code,message}}            — inactive class / class full
 *   {outcome:"already-approved"}      — uid already in learners
 *   {outcome:"already-pending"}       — uid already awaiting approval
 *   {outcome:"join"}                  — write uid into pendingLearners
 */
function decideJoinRequest({classData, uid}) {
  if (classData.active === false) {
    return {error: {code: "failed-precondition", message: "This class is no longer active."}};
  }
  const {learners, pendingLearners} = shapeRoster(classData);
  if (learners.includes(uid)) {
    return {outcome: "already-approved"};
  }
  if (pendingLearners.includes(uid)) {
    return {outcome: "already-pending"};
  }
  if (learners.length + pendingLearners.length >= MAX_LEARNERS_PER_CLASS) {
    return {error: {code: "resource-exhausted", message: "This class is full. Ask your teacher for help."}};
  }
  return {outcome: "join"};
}

// approveLearner eligibility: pending → learners move allowed?
function decideApproval({classData, learnerUid}) {
  const {learners, pendingLearners} = shapeRoster(classData);
  if (!pendingLearners.includes(learnerUid)) {
    return {error: {code: "failed-precondition", message: "That learner is not awaiting approval."}};
  }
  if (learners.length >= MAX_LEARNERS_PER_CLASS) {
    return {error: {code: "resource-exhausted", message: "This class is full. Remove an inactive learner before approving another."}};
  }
  return {ok: true};
}

// leaveClass: the caller must actually be a member (either roster) —
// otherwise the call is a no-op-but-counted abuse vector.
function membershipError(classData, uid) {
  const {learners, pendingLearners} = shapeRoster(classData);
  if (!learners.includes(uid) && !pendingLearners.includes(uid)) {
    return {code: "failed-precondition", message: "You are not a member of this class."};
  }
  return null;
}

// Shared arg parsing for approveLearner / declineLearner /
// removeLearnerFromClass. Returns {classId, learnerUid} or {error}.
function parseClassLearnerArgs(data) {
  const classId = String(data?.classId || "").trim();
  const learnerUid = String(data?.learnerUid || "").trim();
  if (!classId || !learnerUid) {
    return {error: {code: "invalid-argument", message: "classId and learnerUid are required."}};
  }
  return {classId, learnerUid};
}

const ALLOWED_ASSIGNMENT_MODES = ["automatic", "manual"];

/**
 * createClassAssignment payload parsing + validation. Unknown values
 * fall back to safe defaults. Returns the parsed fields or
 * {error:{code,message}}.
 */
function parseAssignmentRequest(data, nowMs) {
  const classId = String(data?.classId || "").trim();
  const resourceType = String(data?.resourceType || "").trim();
  const resourceId = String(data?.resourceId || "").trim();
  const dueAtMs = Number(data?.dueAtMs || 0) || null;
  const openAtMs = Number(data?.openAtMs || 0) || null;

  const assignmentMode = ALLOWED_ASSIGNMENT_MODES.includes(data?.assignmentMode)
    ? data.assignmentMode
    : "manual";
  const timed = Boolean(data?.timed);
  const allowRetakes = Boolean(data?.allowRetakes);
  const shuffleQuestions = Boolean(data?.shuffleQuestions);
  const lockAfterSubmission = Boolean(data?.lockAfterSubmission);
  const notifyLearners = data?.notifyLearners === false ? false : true;
  const addToDailyChallenge = Boolean(data?.addToDailyChallenge);
  const template = typeof data?.template === "string"
    ? data.template.slice(0, 40)
    : null;
  const learnerUidsRaw = Array.isArray(data?.learnerUids)
    ? data.learnerUids
    : null;
  const learnerUids = learnerUidsRaw
    ? learnerUidsRaw
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter((u) => u && u.length <= 200)
        .slice(0, 200)
    : null;

  if (!classId) {
    return {error: {code: "invalid-argument", message: "classId is required."}};
  }
  if (!["quiz", "exam"].includes(resourceType)) {
    return {error: {code: "invalid-argument", message: "resourceType must be 'quiz' or 'exam'."}};
  }
  if (!resourceId) {
    return {error: {code: "invalid-argument", message: "resourceId is required."}};
  }
  if (dueAtMs && dueAtMs < nowMs - 60000) {
    return {error: {code: "invalid-argument", message: "Due date must be in the future."}};
  }
  if (openAtMs && dueAtMs && openAtMs > dueAtMs) {
    return {error: {code: "invalid-argument", message: "Open date must be before the due date."}};
  }

  return {
    classId,
    resourceType,
    resourceId,
    dueAtMs,
    openAtMs,
    assignmentMode,
    timed,
    allowRetakes,
    shuffleQuestions,
    lockAfterSubmission,
    notifyLearners,
    addToDailyChallenge,
    template,
    learnerUids,
  };
}

/**
 * Permission gate + denormalised title/subject/grade for the resource
 * being assigned. `resource` is the already-fetched quiz/exam doc data;
 * the not-found checks stay with the reads in classManagement.js.
 * Returns {resourceTitle, resourceSubject, resourceGrade} or {error}.
 */
function resolveAssignmentResource({resourceType, resource, uid, callerIsAdmin, classData}) {
  let resourceTitle = "Assigned work";
  let resourceSubject = classData.subject || null;
  let resourceGrade = classData.grade || null;
  if (resourceType === "quiz") {
    const quiz = resource;
    const callerIsCreator = quiz.createdBy === uid;
    if (!quiz.isPublished && !callerIsCreator && !callerIsAdmin) {
      return {error: {code: "permission-denied", message: "You can only assign published quizzes or your own drafts."}};
    }
    resourceTitle = quiz.title || resourceTitle;
    if (quiz.subject) resourceSubject = quiz.subject;
    if (quiz.grade) resourceGrade = String(quiz.grade);
  } else {
    // 'exam' — daily exam quiz docs share the quizzes collection but
    // are flagged with quizType == 'daily_exam'. Treat the same.
    const exam = resource;
    if (exam.quizType !== "daily_exam") {
      return {error: {code: "invalid-argument", message: "That is not a daily exam."}};
    }
    resourceTitle = exam.title || resourceTitle;
    if (exam.subject) resourceSubject = exam.subject;
    if (exam.grade) resourceGrade = String(exam.grade);
  }
  return {resourceTitle, resourceSubject, resourceGrade};
}

// Treat a future openAt as a "scheduled" assignment for status badges;
// learner-side rendering hides locked assignments until openAt passes.
function isScheduledAssignment(openAtMs, nowMs) {
  return Boolean(openAtMs && openAtMs > nowMs + 60000);
}

/**
 * The assignment doc shape, minus I/O concerns: `dueAt` / `openAt` /
 * `assignedAt` are passed through as opaque values (Timestamps and a
 * serverTimestamp sentinel at runtime).
 */
function buildAssignmentDoc({parsed, resolved, uid, dueAt, openAt, isScheduled, assignedAt}) {
  return {
    classId: parsed.classId,
    teacherUid: uid,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    resourceTitle: String(resolved.resourceTitle).slice(0, 200),
    subject: resolved.resourceSubject,
    grade: resolved.resourceGrade,
    dueAt,
    openAt,
    active: true,
    status: isScheduled ? "scheduled" : "active",
    assignmentMode: parsed.assignmentMode,
    template: parsed.template,
    settings: {
      timed: parsed.timed,
      allowRetakes: parsed.allowRetakes,
      shuffleQuestions: parsed.shuffleQuestions,
      lockAfterSubmission: parsed.lockAfterSubmission,
      notifyLearners: parsed.notifyLearners,
      addToDailyChallenge: parsed.addToDailyChallenge,
    },
    learnerUids: parsed.learnerUids && parsed.learnerUids.length > 0 ? parsed.learnerUids : null,
    assignedAt,
  };
}

// Who gets the "new work" notification: the explicit target list when
// present, otherwise the whole approved roster — capped at 200.
function assignmentNotificationRecipients({learnerUids, classData}) {
  const recipients = (learnerUids && learnerUids.length > 0)
    ? learnerUids
    : (Array.isArray(classData.learners) ? classData.learners : []);
  return recipients.slice(0, 200);
}

// removeClassAssignment: only the assigning teacher may deactivate it.
function assignmentOwnershipError(assignment, uid) {
  if (assignment.teacherUid !== uid) {
    return {code: "permission-denied", message: "Only the assigning teacher can remove it."};
  }
  return null;
}

module.exports = {
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
};
