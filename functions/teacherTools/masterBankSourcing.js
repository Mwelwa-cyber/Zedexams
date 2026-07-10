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
  normalizeGrade, normalizeSubject, editorQuestionToQuiz, editorQuestionToAssessment,
  selectBankQuestions,
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
 * Scan the Master Bank and return rows matching grade/subject/topic, each
 * mapped through `mapFn` (editor → target schema). Shared by the quiz +
 * assessment sourcing entry points. Returns `{candidates, scanned}`; candidates
 * carry the dedupe/balance metadata plus the mapped question under `item`.
 */
async function scanMasterBank({grade, subject, topic, mapFn}) {
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
    return {candidates: [], scanned: 0};
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
    const item = mapFn(parseQuestion(row.data));
    if (!item) return;
    candidates.push({
      fingerprint: row.fingerprint || doc.id,
      difficulty: row.difficulty,
      quality: (row.aiReview && row.aiReview.qualityScore) || 0,
      usage: row.usageCount || 0,
      marks: Number(item.marks) || 0,
      item,
    });
  });

  return {candidates, scanned: snap.size};
}

/**
 * Source up to `count` quiz-shaped questions from the Master Bank.
 *
 * @param {{grade:string, subject:string, topic?:string, count:number}} params
 * @returns {Promise<{questions:object[], fromBank:number, scanned:number}>}
 */
async function sourceQuizFromBank({grade, subject, topic, count} = {}) {
  const target = Math.max(0, Math.floor(Number(count) || 0));
  if (!target) return {questions: [], fromBank: 0, scanned: 0};

  const {candidates, scanned} = await scanMasterBank({
    grade, subject, topic, mapFn: editorQuestionToQuiz,
  });
  const selected = selectBankQuestions(candidates, {count: target});
  return {
    questions: selected.map((c) => c.item),
    fromBank: selected.length,
    scanned,
  };
}

/**
 * Source assessment-shaped questions from the Master Bank up to a marks budget,
 * restricted to `allowedTypes` (assessment namespace).
 *
 * @param {{grade:string, subject:string, topic?:string, marksBudget:number, allowedTypes?:string[]}} params
 * @returns {Promise<{questions:object[], fromBank:number, marks:number, scanned:number}>}
 */
async function sourceAssessmentFromBank({grade, subject, topic, marksBudget, allowedTypes} = {}) {
  const budget = Math.max(0, Math.round(Number(marksBudget) || 0));
  if (!budget) return {questions: [], fromBank: 0, marks: 0, scanned: 0};

  const allow = Array.isArray(allowedTypes) && allowedTypes.length ?
    new Set(allowedTypes) : null;

  const {candidates, scanned} = await scanMasterBank({
    grade, subject, topic, mapFn: editorQuestionToAssessment,
  });
  const usable = allow ? candidates.filter((c) => allow.has(c.item.type)) : candidates;
  const selected = selectBankQuestions(usable, {marksBudget: budget});
  return {
    questions: selected.map((c) => c.item),
    fromBank: selected.length,
    marks: selected.reduce((sum, c) => sum + (Number(c.marks) || 0), 0),
    scanned,
  };
}

module.exports = {
  sourceQuizFromBank,
  sourceAssessmentFromBank,
  MASTER_SCAN_LIMIT,
};
