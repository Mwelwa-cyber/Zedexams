"use strict";

/**
 * §5 — the server rules that make exam mode honest.
 *
 *   startAttempt(paperId, mode)   → questions, stripped for exam; the clock
 *   patchAttempt(attemptId, …)    → answers persist AS THEY ARE GIVEN (§1)
 *   submitAttempt(attemptId, …)   → the server marks; the client never does
 *   abandonAttempt(attemptId)     → the ONE thing that ends an exam early
 *
 * ── What the client is trusted with, exactly ─────────────────────────────
 *
 * The chosen option index, a flag list, and which paper. Nothing else is read
 * from any payload: not the score, not the correctness, not the elapsed time,
 * not the status, not `unverifiedTiming` beyond the one bit §5.5 defines. The
 * uid comes from `request.auth`, the grade and the entitlement are re-read
 * server-side, the clock is the server's. `paperQuizFns.test.js` pins that as
 * a list of fields the handlers must never grow, because "we ignore it" is a
 * claim about absence and absence is what a later refactor quietly reverses.
 *
 * ── The residual, stated rather than implied ─────────────────────────────
 *
 * A published past-paper quiz's questions are PUBLICLY READABLE by
 * `firestore.rules` (the `publicAccess && isPublished` arm), because the
 * anonymous free preview and the SEO archive depend on it. So stripping the
 * key here stops the APP showing an answer early; it does not stop a
 * determined learner reading the collection directly. That is the same threat
 * model the rules already accept for every practice quiz ("practice quizzes
 * still grade client-side by design"), and it is worth being exact about what
 * the strip does buy: the CLOCK, the RECORD and the SCORE are the server's,
 * and those are what a result has to be trustworthy about. Closing the gap
 * properly means closing the public read arm, which costs the anonymous
 * preview — a product decision, not a patch.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const {assertVerifiedAuth} = require("../authGuard");
const core = require("./paperQuizCore");

const ATTEMPTS = "paperQuizAttempts";
const PROGRESS = "practiceProgress";
const TOPIC_STATS = "learnerTopicStats";

/** The shared rules. ESM, so imported inside the async handler (never top-level). */
async function shared() {
  const [marking, gate, spec] = await Promise.all([
    import("../shared/paperQuiz/marking.js"),
    import("../shared/paperQuiz/explanationGate.js"),
    import("../shared/paperQuiz/examSpec.js"),
  ]);
  return {marking, gate, spec};
}

function db() {
  return admin.firestore();
}

/** The paper, or a refusal a learner can read. */
async function loadPaper(paperId) {
  if (!paperId || typeof paperId !== "string") {
    throw new HttpsError("invalid-argument", "Which paper?");
  }
  const snap = await db().collection("pastPapers").doc(paperId).get();
  if (!snap.exists) throw new HttpsError("not-found", "We could not find that paper.");
  const paper = {id: snap.id, ...snap.data()};
  if (paper.status !== "published") {
    throw new HttpsError("failed-precondition", "That paper is not available yet.");
  }
  return paper;
}

/** The paper's linked quiz and its questions, in paper order. */
async function loadQuestions(paper) {
  const quizId = paper.quizId;
  if (!quizId) {
    throw new HttpsError("failed-precondition", "This paper's quiz is still being prepared.");
  }
  const snap = await db()
      .collection("quizzes").doc(quizId)
      .collection("questions").orderBy("order", "asc").get();
  const questions = snap.docs.map((d) => ({id: d.id, ...d.data()}));
  if (questions.length === 0) {
    throw new HttpsError("failed-precondition", "This paper's quiz has no questions yet.");
  }
  return {quizId, questions};
}

/**
 * May this learner sit the paper as an exam?
 *
 * Re-derived here from the learner's own profile — never read from the
 * payload. The client's copy of this rule (`quiz/lib/examAccess.js`) keeps the
 * cover's Exam card honest; this one is the control, because the other runs on
 * the learner's device.
 */
async function assertMayStart(uid, paper, mode, questionCount) {
  if (mode !== "exam") return;
  const profileSnap = await db().collection("users").doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() : {};
  if (hasEntitlement(profile)) return;
  // A paper whose free set covers all of it is sittable by everybody — the
  // case that keeps a short or demo paper from being gated by a rule aimed at
  // long ones.
  //
  // Read off the paper directly rather than through the browser's
  // `services/entitlements/freeSet.js`: `firebase deploy` uploads only the
  // `functions/` directory, so anything this file reaches for in `src/` exists
  // on a developer's machine and is ABSENT at runtime — an import that throws
  // on the first real call and passes every local check. A paper declaring no
  // free set falls through to the refusal below, which is the safe direction:
  // it offers practice rather than opening an exam.
  const declared = Number(paper?.freeSet?.toQuestion);
  if (Number.isFinite(declared) && declared >= questionCount) return;
  throw new HttpsError(
      "permission-denied",
      "Exam mode covers the whole paper. Practise the free section for now — your marks and answers are free either way.",
  );
}

/**
 * The entitlement read, kept deliberately small and local.
 *
 * It mirrors `hasPremiumAccess` in the payment engine, which is a browser
 * module this runtime cannot import. The shapes are checked in the order the
 * activation path writes them; an unreadable or absent field is NOT premium,
 * which fails closed toward practice — and practice is a real, complete,
 * useful thing to be failed closed into.
 */
function hasEntitlement(profile) {
  if (!profile) return false;
  if (profile.role === "admin" || profile.role === "super_admin") return true;
  const until = profile.subscriptionExpiresAt || profile.premiumUntil || profile.planExpiresAt;
  const ms = until && typeof until.toMillis === "function" ? until.toMillis() : Number(until);
  if (Number.isFinite(ms) && ms > Date.now()) return true;
  return profile.subscriptionStatus === "active" || profile.plan === "premium";
}

// ── startAttempt ─────────────────────────────────────────────────────────

/**
 * Begin — or, far more often than anyone expects, RESUME — an attempt.
 *
 * §1: "A refresh, a reload, a crash, a battery death, a phone call, a rotate,
 * a low-memory webview restart, an accidental pull-to-refresh — none of these
 * end an attempt." Every one of them reaches the server as this call, and
 * `core.decideStart` is what turns them all into a resume.
 */
exports.startAttemptHandler = async (request) => {
  const uid = await assertVerifiedAuth(request);
  const {marking, gate, spec} = await shared();
  const paperId = String(request.data?.paperId || "");
  const mode = request.data?.mode === "practice" ? "practice" : "exam";
  const strictForward = request.data?.strictForward === true;
  const clientVersion = String(request.data?.clientVersion || "").slice(0, 40);

  const paper = await loadPaper(paperId);
  const {quizId, questions} = await loadQuestions(paper);
  await assertMayStart(uid, paper, mode, questions.length);

  // The paper's own length — the SAME resolution the cover ran in the browser
  // (functions/shared/paperQuiz/examSpec.js), so the clock this call stamps is
  // the number the learner was shown before they tapped Start.
  const examSpec = spec.resolveExamSpec({paper, questions});

  const nowMs = Date.now();
  const store = db();

  // The live attempt for this learner + paper, if there is one. Ordered by
  // start so a learner with a history gets the LATEST, which is the only one
  // that can still be running.
  const liveSnap = await store.collection(ATTEMPTS)
      .where("learnerId", "==", uid)
      .where("paperId", "==", paperId)
      .where("status", "==", core.ATTEMPT_STATUS.IN_PROGRESS)
      .orderBy("startedAtMs", "desc")
      .limit(1)
      .get();
  const existing = liveSnap.empty
    ? null
    : {attemptId: liveSnap.docs[0].id, ...liveSnap.docs[0].data()};

  const decision = core.decideStart({existing, nowMs, mode});

  // An attempt whose window passed with no submission is finalised on what it
  // holds. Never deleted (that loses real answers) and never left running
  // (that blocks the paper for good).
  if (decision.action === "expire" || decision.action === "finalize_other") {
    await finalizeStale(decision.finalize, nowMs, decision.action);
  }

  let attempt;
  let attemptId;
  if (decision.action === "resume") {
    attempt = decision.attempt;
    attemptId = attempt.attemptId;
  } else {
    attemptId = core.attemptDocId({uid, paperId, startedAtMs: nowMs});
    attempt = core.buildAttempt({
      uid,
      paperId,
      quizId,
      mode,
      nowMs,
      durationMinutes: examSpec.durationMinutes,
      questionCount: questions.length,
      strictForward,
      // §5.5 — the client tells us it started offline; nothing else about the
      // clock is taken from it, and a flagged attempt never reaches a
      // leaderboard.
      unverifiedTiming: request.data?.unverifiedTiming === true,
      clientVersion,
    });
    await store.collection(ATTEMPTS).doc(attemptId).set({
      ...attempt,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // §5.1 / §5.4. The exam gets the key stripped; practice gets the whole
  // question because it reveals on tap and works offline. BOTH pass the
  // explanation gate, so an unapproved draft never travels either way.
  const payload = mode === "exam"
    ? questions.map((q) => gate.applyExplanationGate(marking.stripForExam(q)))
    : questions.map((q) => marking.forPractice(q));

  return {
    attempt: core.attemptSummary({...attempt, attemptId}, {serverNowMs: nowMs}),
    resumed: decision.action === "resume",
    paper: {
      id: paper.id,
      title: paper.title || "",
      subject: paper.subject || "",
      grade: paper.grade ?? null,
      year: paper.year ?? null,
      source: paper.source || "",
      durationMinutes: examSpec.durationMinutes,
      // How that number was arrived at, so a resumed runner can say "About"
      // exactly where the cover did rather than promising an estimate is fact.
      durationSource: examSpec.durationSource,
      durationExact: examSpec.exact,
      sections: Array.isArray(paper.sections) ? paper.sections : [],
    },
    questions: payload,
  };
};

/** Finalise an attempt the learner never came back to. */
async function finalizeStale(attempt, nowMs, action) {
  if (!attempt?.attemptId) return;
  const status = action === "expire"
    ? core.ATTEMPT_STATUS.EXPIRED
    : core.ATTEMPT_STATUS.ABANDONED;
  try {
    await db().collection(ATTEMPTS).doc(attempt.attemptId).update({
      status,
      submittedAtMs: nowMs,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      timeUsedSec: core.timeUsedSeconds(attempt, nowMs),
    });
  } catch (err) {
    // A failure here must not stop the learner starting. The stale attempt
    // stays `in_progress` and the next start finalises it again.
    console.warn("[paperQuiz] could not finalise stale attempt", attempt.attemptId, err?.message || err);
  }
}

// ── patchAttempt ─────────────────────────────────────────────────────────

/**
 * Persist answers and flags as they are given (§1).
 *
 * "Never batched in memory until submit, because memory is exactly what a
 * reload destroys." Debounced on the client; idempotent here.
 *
 * A patch that arrives after the paper closed is ACCEPTED into the document
 * but changes no status — the learner may genuinely have tapped an option a
 * second before the clock ran out on a slow connection, and refusing it loses
 * a mark they earned. What it cannot do is reopen a submitted attempt.
 */
exports.patchAttemptHandler = async (request) => {
  const uid = await assertVerifiedAuth(request);
  const attemptId = String(request.data?.attemptId || "");
  if (!attemptId) throw new HttpsError("invalid-argument", "Which attempt?");

  const ref = db().collection(ATTEMPTS).doc(attemptId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That attempt is not there.");
  const attempt = snap.data();
  if (attempt.learnerId !== uid) throw new HttpsError("permission-denied", "Not your attempt.");
  if (attempt.status !== core.ATTEMPT_STATUS.IN_PROGRESS) {
    // Already finished. Reported as a success with `accepted: false` rather
    // than an error: a debounced patch racing the submit button is ordinary,
    // and an error toast for it would fire on a perfectly normal submission.
    return {accepted: false, status: attempt.status};
  }

  const {questions} = await loadQuestions(await loadPaper(attempt.paperId));
  const questionIds = questions.map((q) => q.id);

  const answers = core.sanitizeAnswerPatch(request.data?.answers, {questionIds});
  const update = {updatedAt: admin.firestore.FieldValue.serverTimestamp()};
  Object.keys(answers).forEach((qid) => {
    // Dot-path writes, so two patches for different questions cannot clobber
    // each other — which is what a whole-map write would do the moment the
    // debounce fires twice from two components.
    update[`answers.${qid}`] = answers[qid] === null
      ? admin.firestore.FieldValue.delete()
      : answers[qid];
  });
  if (Array.isArray(request.data?.flags)) {
    update.flags = core.sanitizeFlags(request.data.flags, {questionIds});
  }
  await ref.update(update);
  return {accepted: true, status: attempt.status};
};

// ── submitAttempt ────────────────────────────────────────────────────────

/**
 * Mark the paper. The client never does (§5.2).
 *
 * Returns the FULL marked paper with explanations — which is the moment the
 * answers stop being secret, because the learner has finished. Everything
 * still passes the explanation gate: finishing an exam does not approve a
 * draft.
 */
exports.submitAttemptHandler = async (request) => {
  const uid = await assertVerifiedAuth(request);
  const {marking, gate} = await shared();
  const attemptId = String(request.data?.attemptId || "");
  if (!attemptId) throw new HttpsError("invalid-argument", "Which attempt?");

  const store = db();
  const ref = store.collection(ATTEMPTS).doc(attemptId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That attempt is not there.");
  const attempt = snap.data();
  if (attempt.learnerId !== uid) throw new HttpsError("permission-denied", "Not your attempt.");

  const paper = await loadPaper(attempt.paperId);
  const {questions} = await loadQuestions(paper);

  // Already submitted: return the recorded result rather than re-marking. A
  // learner who double-taps submit, or whose phone retried the call on a flaky
  // connection, must not get a second — possibly different — verdict.
  if (attempt.status !== core.ATTEMPT_STATUS.IN_PROGRESS) {
    return buildResult({attempt, questions, gate, marking, attemptId});
  }

  const nowMs = Date.now();
  // The stored answers are the authority; a `answers` payload is merged over
  // them so a final tap that never made it through `patchAttempt` still
  // counts. Both are pruned to this paper's questions.
  const merged = {
    ...(attempt.answers || {}),
    ...core.sanitizeAnswerPatch(request.data?.answers, {questionIds: questions.map((q) => q.id)}),
  };
  const answers = marking.pruneAnswers(merged, questions);
  const marked = marking.markSubmission({questions, answers});
  const status = marking.submissionStatus({
    expiresAtMs: attempt.expiresAtMs,
    receivedAtMs: nowMs,
  });

  const update = {
    status: attempt.mode === "exam" ? status : core.ATTEMPT_STATUS.SUBMITTED,
    answers,
    submittedAtMs: nowMs,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    timeUsedSec: core.timeUsedSeconds(attempt, nowMs),
    score: {right: marked.right, total: marked.total, percent: marked.percent},
    bySection: marked.bySection,
    weakTopics: marked.weakTopics,
  };
  await ref.update(update);

  // §4.3 — topic mastery, incremented by BOTH modes. This is what makes the
  // app intelligent across papers rather than clever inside one.
  await applyTopicStats(uid, marked.rows, {
    subject: paper.subject || "",
    grade: paper.grade ?? null,
    marking,
  });

  return buildResult({
    attempt: {...attempt, ...update},
    questions,
    gate,
    marking,
    attemptId,
  });
};

/** The marked paper a client renders, with the gate applied to every question. */
function buildResult({attempt, questions, gate, marking, attemptId}) {
  const answers = attempt.answers || {};
  const marked = marking.markSubmission({questions, answers});
  return {
    attemptId,
    mode: attempt.mode,
    status: attempt.status,
    startedAtMs: attempt.startedAtMs ?? null,
    submittedAtMs: attempt.submittedAtMs ?? null,
    timeUsedSec: attempt.timeUsedSec ?? 0,
    unverifiedTiming: attempt.unverifiedTiming === true,
    score: attempt.score || {right: marked.right, total: marked.total, percent: marked.percent},
    bySection: attempt.bySection || marked.bySection,
    weakTopics: attempt.weakTopics || marked.weakTopics,
    rows: marked.rows,
    // The answers are no longer secret — the paper is finished. The
    // explanation gate still is: finishing does not approve a draft.
    questions: questions.map((q) => gate.applyExplanationGate(q)),
  };
}

/**
 * Fold this attempt's rows into `learnerTopicStats/{uid}_{topicId}` (§4.3).
 *
 * `FieldValue.increment`, so two devices submitting near-simultaneously add up
 * instead of overwriting. A failure is logged and swallowed: mastery is
 * derived data that the next attempt repairs, and a learner must never lose a
 * submitted paper because a rollup write failed.
 */
async function applyTopicStats(uid, rows, {subject, grade, marking}) {
  const updates = marking.topicStatUpdates(rows, {subject, grade});
  if (updates.length === 0) return;
  try {
    const batch = db().batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    updates.slice(0, 400).forEach((u) => {
      const ref = db().collection(TOPIC_STATS).doc(core.topicStatId(uid, u.topicId));
      batch.set(ref, {
        learnerId: uid,
        topicId: u.topicId,
        topic: u.topic,
        section: u.section,
        subject: u.subject,
        grade: u.grade,
        seen: admin.firestore.FieldValue.increment(u.seen),
        wrong: admin.firestore.FieldValue.increment(u.wrong),
        lastSeenAt: now,
        ...(u.wrong > 0 ? {lastWrongAt: now} : {}),
      }, {merge: true});
    });
    await batch.commit();
  } catch (err) {
    console.warn("[paperQuiz] topic stats write failed", err?.message || err);
  }
}

// ── abandonAttempt ───────────────────────────────────────────────────────

/**
 * The ONE thing that ends an exam early (§1).
 *
 * Reached only from the exit sheet's "Leave — don't count this". The record is
 * written but carries NO SCORE and is excluded from history, averages and
 * weak-topic maths — it exists so we can see how often children walk out and
 * why (§4.2). It deliberately does not mark: marking it and filtering it out
 * downstream is one forgotten filter away from a voided paper appearing in a
 * child's results.
 */
exports.abandonAttemptHandler = async (request) => {
  const uid = await assertVerifiedAuth(request);
  const attemptId = String(request.data?.attemptId || "");
  if (!attemptId) throw new HttpsError("invalid-argument", "Which attempt?");

  const ref = db().collection(ATTEMPTS).doc(attemptId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That attempt is not there.");
  const attempt = snap.data();
  if (attempt.learnerId !== uid) throw new HttpsError("permission-denied", "Not your attempt.");
  if (attempt.status !== core.ATTEMPT_STATUS.IN_PROGRESS) {
    return {status: attempt.status};
  }
  const nowMs = Date.now();
  await ref.update({
    ...core.buildAbandon(attempt, nowMs),
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {status: core.ATTEMPT_STATUS.ABANDONED};
};

// ── practice progress ────────────────────────────────────────────────────

/**
 * Practice's resume cursor (§4.2). A cursor and which questions were answered
 * — never whether they were right, because §1 says practice is not recorded
 * and the way that promise breaks is a resume document that accumulates enough
 * to be reported on later.
 */
exports.savePracticeProgressHandler = async (request) => {
  const uid = await assertVerifiedAuth(request);
  const paperId = String(request.data?.paperId || "");
  if (!paperId) throw new HttpsError("invalid-argument", "Which paper?");
  const {questions} = await loadQuestions(await loadPaper(paperId));
  const answered = core.sanitizeAnswerPatch(request.data?.answered, {
    questionIds: questions.map((q) => q.id),
  });
  const n = Number(request.data?.lastQuestionN);
  await db().collection(PROGRESS).doc(core.practiceProgressId(uid, paperId)).set({
    learnerId: uid,
    paperId,
    lastQuestionN: Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), questions.length) : 0,
    answered,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {saved: true};
};

module.exports.ATTEMPTS = ATTEMPTS;
module.exports.PROGRESS = PROGRESS;
module.exports.TOPIC_STATS = TOPIC_STATS;
module.exports.hasEntitlement = hasEntitlement;
