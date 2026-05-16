/**
 * functions/dailyExamGradingFns.js
 *
 * Server-authoritative Daily Exam endpoints. These exist so the answer key
 * never reaches a learner who is mid-exam, and so the score is computed by
 * a trusted server rather than the browser:
 *
 *   getExamQuestions  — returns the exam's questions. Answer-key fields are
 *                       stripped UNLESS the caller already has a submitted
 *                       attempt (then the corrections/review screen needs
 *                       them). Reads via the admin SDK so the questions
 *                       subcollection can stay closed to clients in rules.
 *   submitDailyExam   — grades the attempt server-side, writes the score +
 *                       submitted state + lock flip. Idempotent: a second
 *                       call on an already-submitted attempt is a no-op.
 *
 * Practice quizzes are deliberately NOT touched — practice mode shows
 * answers live by design and keeps its existing client flow.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {gradeAttempt, stripAnswerKey} = require("./grading/dailyExamGrading");

const REGION = "us-central1";

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }
  return request.auth.uid;
}

function asString(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

// Defensive sanitiser for the learner-submitted answer map. Mirrors the
// bounds in src/schemas/attempt.js (answersMap) so a hostile client can't
// bloat the attempt doc or smuggle weird shapes server-side.
function sanitizeAnswers(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count >= 2000) break;
    if (typeof key !== "string" || key.length < 1 || key.length > 200) continue;
    const v = raw[key];
    if (typeof v === "string") {
      out[key] = v.slice(0, 50_000);
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[key] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      // text answers: { given, correct }; hotspot: { x, y }. Keep a small
      // shallow projection only.
      const o = {};
      if ("correct" in v) o.correct = v.correct === true;
      if ("given" in v && typeof v.given === "string") o.given = v.given.slice(0, 50_000);
      if ("x" in v && Number.isFinite(Number(v.x))) o.x = Number(v.x);
      if ("y" in v && Number.isFinite(Number(v.y))) o.y = Number(v.y);
      out[key] = o;
    }
    count += 1;
  }
  return out;
}

async function loadQuestions(db, examId) {
  const qSnap = await db
    .collection("quizzes").doc(examId)
    .collection("questions").orderBy("order", "asc").get();
  return qSnap.docs.map((d) => ({id: d.id, ...d.data()}));
}

exports.getExamQuestions = onCall(
  {region: REGION, timeoutSeconds: 20},
  async (request) => {
    const uid = requireAuth(request);
    const examId = asString(request.data?.examId, 200);
    const attemptId = asString(request.data?.attemptId, 200);
    if (!examId) {
      throw new HttpsError("invalid-argument", "examId is required.");
    }

    const db = admin.firestore();
    const quizSnap = await db.collection("quizzes").doc(examId).get();
    if (!quizSnap.exists) {
      throw new HttpsError("not-found", "Exam not found.");
    }

    // Full (with answer keys) only when the caller already submitted THIS
    // exam attempt — the corrections screen. Otherwise strip the keys.
    let includeAnswerKey = false;
    if (attemptId) {
      const aSnap = await db.collection("exam_attempts").doc(attemptId).get();
      if (aSnap.exists) {
        const a = aSnap.data();
        if (a.userId === uid && a.examId === examId && a.status === "submitted") {
          includeAnswerKey = true;
        }
      }
    }

    const questions = await loadQuestions(db, examId);
    return {
      questions: includeAnswerKey ? questions : questions.map(stripAnswerKey),
      answerKeyIncluded: includeAnswerKey,
    };
  },
);

exports.submitDailyExam = onCall(
  {region: REGION, timeoutSeconds: 30},
  async (request) => {
    const uid = requireAuth(request);
    const attemptId = asString(request.data?.attemptId, 200);
    if (!attemptId) {
      throw new HttpsError("invalid-argument", "attemptId is required.");
    }
    const answers = sanitizeAnswers(request.data?.answers);

    const db = admin.firestore();
    const attemptRef = db.collection("exam_attempts").doc(attemptId);

    const preSnap = await attemptRef.get();
    if (!preSnap.exists) {
      throw new HttpsError("not-found", "Attempt not found.");
    }
    const pre = preSnap.data();
    if (pre.userId !== uid) {
      throw new HttpsError("permission-denied", "This is not your attempt.");
    }
    if (pre.status === "submitted") {
      return {alreadySubmitted: true, attemptId};
    }

    const questions = await loadQuestions(db, pre.examId);

    const graded = await db.runTransaction(async (tx) => {
      const snap = await tx.get(attemptRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "Attempt not found.");
      }
      const attempt = snap.data();
      if (attempt.userId !== uid) {
        throw new HttpsError("permission-denied", "This is not your attempt.");
      }
      // Lost the race to a concurrent submit (double-tap / timer + tap).
      if (attempt.status === "submitted") return null;

      const startedAtMs = attempt.startedAt?.toMillis?.() ?? null;
      const result = gradeAttempt({
        attempt: {
          totalMarks: attempt.totalMarks || 0,
          totalQuestions: attempt.totalQuestions || 0,
          startedAtMs,
        },
        questions,
        answers,
        nowMs: Date.now(),
      });

      tx.update(attemptRef, {
        status: "submitted",
        answers,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...result,
      });
      return result;
    });

    // Concurrent submit already finished it — treat as idempotent success.
    if (graded === null) {
      return {alreadySubmitted: true, attemptId};
    }

    // Flip the daily lock so the learner can't re-sit today. Best-effort:
    // the score is already saved; a lock write failure must not 500 the
    // submit. Lock id mirrors examService.lockId(userId, subject) on the
    // day the attempt was created.
    try {
      const lockId = `${pre.userId}_${pre.subject}_${pre.attemptDate}`;
      await db.collection("daily_exam_locks").doc(lockId)
        .set({status: "submitted"}, {merge: true});
    } catch (e) {
      console.error("submitDailyExam lock flip failed:", attemptId, e);
    }

    return {alreadySubmitted: false, attemptId, ...graded};
  },
);
