/**
 * Master Bank sourcing — Firestore read layer for Smart Paper Generation.
 *
 * Pulls high-quality approved questions from the Central Question Bank
 * (questionBank where masterEligible === true) that match the paper's
 * grade/subject/topic, maps them into the target schema, and balances the
 * selection. The pure mapping/selection logic lives in masterBankSourcingCore.js.
 *
 * Best-effort by design: every failure path returns an empty selection so the
 * generator degrades gracefully to plain AI generation (and behaves exactly as
 * before when the Master Bank is empty).
 */

const admin = require("firebase-admin");
const {
  normalizeGrade, normalizeSubject, editorQuestionToQuiz, selectBankQuestions,
} = require("./masterBankSourcingCore");

// Bound the scan. We filter grade/subject/topic in memory (the stored values
// drift in format vs the generator's canonical inputs, and an in-memory match
// is robust to that without a new composite index). 400 is plenty for the
// current bank size; revisit with an indexed query as it grows.
const MASTER_SCAN_LIMIT = 400;

function parseQuestion(dataStr) {
  try {
    return JSON.parse(dataStr || "null") || null;
  } catch {
    return null;
  }
}

/**
 * Source up to `count` quiz-shaped questions from the Master Bank.
 *
 * @param {{grade:string, subject:string, topic?:string, count:number}} params
 * @returns {Promise<{questions:object[], fromBank:number, scanned:number}>}
 */
async function sourceQuizFromBank({grade, subject, topic, count} = {}) {
  const empty = {questions: [], fromBank: 0, scanned: 0};
  const target = Math.max(0, Math.floor(Number(count) || 0));
  if (!target) return empty;

  const wantGrade = normalizeGrade(grade);
  const wantSubject = normalizeSubject(subject);
  const wantTopic = String(topic || "").trim().toLowerCase();

  let snap;
  try {
    snap = await admin.firestore()
      .collection("questionBank")
      .where("masterEligible", "==", true)
      .limit(MASTER_SCAN_LIMIT)
      .get();
  } catch (err) {
    console.warn("[masterBankSourcing] query failed", err && err.message);
    return empty;
  }

  const candidates = [];
  snap.forEach((doc) => {
    const row = doc.data() || {};
    // Match grade + subject by normalised value; topic by substring when given.
    if (wantGrade && normalizeGrade(row.grade) !== wantGrade) return;
    if (wantSubject && normalizeSubject(row.subject) !== wantSubject) return;
    if (wantTopic) {
      const rowTopic = String(row.topic || "").toLowerCase();
      if (!rowTopic.includes(wantTopic) && !wantTopic.includes(rowTopic)) return;
    }
    const quiz = editorQuestionToQuiz(parseQuestion(row.data));
    if (!quiz) return;
    candidates.push({
      fingerprint: row.fingerprint || doc.id,
      difficulty: row.difficulty,
      quality: (row.aiReview && row.aiReview.qualityScore) || 0,
      usage: row.usageCount || 0,
      quiz,
    });
  });

  const selected = selectBankQuestions(candidates, {count: target});
  return {
    questions: selected.map((c) => c.quiz),
    fromBank: selected.length,
    scanned: snap.size,
  };
}

module.exports = {sourceQuizFromBank, MASTER_SCAN_LIMIT};
