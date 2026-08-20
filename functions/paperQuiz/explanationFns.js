"use strict";

/**
 * §6 — the authoring pipeline for past-paper coaching.
 *
 *   draftPaperExplanations(paperId, questionIds?)  → AI drafts, admin only
 *   reviewPaperExplanation(questionId, action)     → approve / edit / reject
 *   bulkApproveExplanations(quizId, questionIds)   → a whole part at once
 *   paperExplanationCoverage(paperId)              → the studio's progress
 *
 * ── What the drafter is NOT allowed to do ────────────────────────────────
 *
 * Publish. A draft lands as `explanationStatus: 'ai_draft'` and the
 * learner-facing gate refuses to show it — the answer alone is what a child
 * sees until a person has read the prose and pressed Approve. That is §4.1's
 * hard rule, and it is the reason this whole pipeline can exist at all: the
 * cost of a bad draft is a reviewer's time, not a child taught something
 * false.
 *
 * The drafter also refuses ITSELF, and that path is load-bearing. The prompt
 * tells the model to set `confident: false` rather than guess when the marking
 * scheme does not support an explanation or when working the question through
 * makes it doubt the key. A refusal is recorded with its reason and the
 * question stays `missing` — which reads to a learner as an unexplained
 * question, which is the correct outcome and not a defect.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");

const {assertVerifiedAuth} = require("../authGuard");
const {getUserRole, isStaffRole, getAnthropicApiKey} = require("../aiService");
const {callClaude} = require("../teacherTools/anthropicClient");
const {resolveCbcContext} = require("../teacherTools/cbcKnowledge");
const {assertGeneratorRateLimit} = require("../teacherTools/generatorRateLimit");
const core = require("./explanationCore");
const {
  PROMPT_VERSION, SYSTEM_PROMPT, EXPLANATION_TOOL_SCHEMA, buildUserPrompt, plain,
} = require("./explanationPrompt");

// Haiku, not Sonnet, and the reason is the shape of the work rather than the
// price: this is short constrained prose from supplied source material, with a
// validator and a human behind it. The expensive model earns its keep where a
// judgement call is being made; here the judgement call is the reviewer's.
const EXPLANATION_MODEL = process.env.PAPER_EXPLANATION_MODEL || "claude-haiku-4-5-20251001";

/** A whole 60-question paper in one call, bounded. */
const MAX_PER_CALL = 60;

function db() {
  return admin.firestore();
}

async function assertStaff(request) {
  const uid = await assertVerifiedAuth(request);
  const role = await getUserRole(uid);
  if (!isStaffRole(role)) {
    throw new HttpsError("permission-denied", "Only staff can author explanations.");
  }
  return uid;
}

/** The paper, its quiz id, and its questions in paper order. */
async function loadPaperQuiz(paperId) {
  const snap = await db().collection("pastPapers").doc(String(paperId || "")).get();
  if (!snap.exists) throw new HttpsError("not-found", "We could not find that paper.");
  const paper = {id: snap.id, ...snap.data()};
  if (!paper.quizId) throw new HttpsError("failed-precondition", "This paper has no quiz attached yet.");
  const qs = await db()
      .collection("quizzes").doc(paper.quizId)
      .collection("questions").orderBy("order", "asc").get();
  return {paper, quizId: paper.quizId, questions: qs.docs.map((d) => ({id: d.id, ...d.data()}))};
}

/**
 * The marking-scheme text for one question, if the paper carries one.
 *
 * Read from the paper's own `markingScheme` map keyed by question number, then
 * from the question's stored `markSchemeText`. Returns '' rather than throwing
 * when there is neither — the prompt handles that case explicitly by refusing
 * more readily, which is better than this layer deciding a paper cannot be
 * drafted at all.
 */
function markingSchemeFor(paper, question) {
  const byNumber = paper?.markingScheme && typeof paper.markingScheme === "object"
    ? paper.markingScheme[String(question.n ?? question.order ?? "")]
    : null;
  return plain(byNumber || question.markSchemeText || question.markingScheme || "");
}

// ── draftPaperExplanations ───────────────────────────────────────────────

exports.draftPaperExplanationsHandler = async (request) => {
  const uid = await assertStaff(request);
  // Rate-limited like every other provider-backed endpoint, staff-only or not.
  // One press of "Draft the missing ones" is up to sixty Anthropic calls, so
  // an impatient double-click is a hundred and twenty — and being staff is a
  // statement about authorisation, not about how fast a person should be able
  // to spend the AI budget. `test:ai-provider-inventory` fails on any
  // provider-backed endpoint that carries no limiter, which is how this was
  // caught rather than discovered on a bill.
  await assertGeneratorRateLimit(request, "paper_explanations");
  const paperId = String(request.data?.paperId || "");
  const only = Array.isArray(request.data?.questionIds)
    ? new Set(request.data.questionIds.map(String))
    : null;
  const redraft = request.data?.redraft === true;

  const {paper, quizId, questions} = await loadPaperQuiz(paperId);

  // Never re-draft over an APPROVED explanation. A human wrote or blessed that
  // prose, and a bulk re-run that silently replaced it with a fresh draft
  // would undo a reviewer's work and reset the question to unapproved — the
  // one thing the pipeline must not do to somebody who already did the job.
  const targets = questions.filter((q) => {
    if (only && !only.has(String(q.id))) return false;
    if (q.explanationStatus === core.EXPLANATION_STATUS.APPROVED) return false;
    if (!redraft && q.explanationStatus === core.EXPLANATION_STATUS.AI_DRAFT) return false;
    return Array.isArray(q.options) && q.options.length >= 2;
  }).slice(0, MAX_PER_CALL);

  if (targets.length === 0) {
    return {drafted: 0, refused: 0, failed: 0, results: [], coverage: coverageOf(questions)};
  }

  const apiKey = getAnthropicApiKey();
  const cbcContext = await resolveCbcContext({
    grade: paper.grade ? `G${paper.grade}` : "",
    subject: paper.subject || "",
    topic: "",
  }).catch(() => "");

  const results = [];
  let drafted = 0;
  let refused = 0;
  let failed = 0;

  // Sequential, not parallel. Sixty concurrent Anthropic calls from one
  // Cloud Function is a rate-limit wall and a bill spike, and the reviewer is
  // going to read them one at a time anyway.
  for (const question of targets) {
    const correctIndex = resolveCorrectIndex(question);
    if (correctIndex == null) {
      failed += 1;
      results.push({questionId: question.id, outcome: "no_key", problems: ["this question has no answer key"]});
      continue;
    }
    try {
      const raw = await callClaude(apiKey, {
        model: EXPLANATION_MODEL,
        systemPrompt: SYSTEM_PROMPT,
        cbcContextBlock: cbcContext || null,
        messages: [{
          role: "user",
          content: buildUserPrompt({
            question: {...question, correctIndex},
            paper,
            markingScheme: markingSchemeFor(paper, question),
          }),
        }],
        // Tool mode forces an object response, so "the model returned prose"
        // is not a failure this has to parse its way out of.
        mode: "tool",
        toolName: "write_explanation",
        toolDescription: "The coaching a learner reads after answering this question.",
        toolInputSchema: EXPLANATION_TOOL_SCHEMA,
        maxTokens: 900,
        // Cost attribution, so this spend lands in the /admin/ai-costs rollups
        // and under the monthly ceiling like every other generator's.
        track: {uid, tool: "paper_explanations"},
      });
      const verdict = core.validateDraft({draft: raw, question: {...question, correctIndex}});
      if (!verdict.ok) {
        if (verdict.refused) refused += 1; else failed += 1;
        results.push({
          questionId: question.id,
          outcome: verdict.refused ? "refused" : "rejected",
          problems: verdict.problems,
        });
        continue;
      }
      await db().collection("quizzes").doc(quizId).collection("questions").doc(question.id).set({
        ...verdict.draft,
        explanationPromptVersion: PROMPT_VERSION,
        explanationDraftedAt: admin.firestore.FieldValue.serverTimestamp(),
        explanationDraftedBy: uid,
      }, {merge: true});
      drafted += 1;
      results.push({questionId: question.id, outcome: "drafted"});
    } catch (err) {
      failed += 1;
      console.warn("[paperQuiz] draft failed", question.id, err?.message || err);
      results.push({questionId: question.id, outcome: "error", problems: [err?.message || "the model call failed"]});
    }
  }

  const after = await reloadQuestions(quizId);
  return {drafted, refused, failed, results, coverage: coverageOf(after)};
};

/** The four stored answer shapes, resolved server-side. */
function resolveCorrectIndex(question) {
  if (Number.isInteger(question.correctAnswerIndex)) return question.correctAnswerIndex;
  if (Number.isInteger(question.correctIndex)) return question.correctIndex;
  if (Number.isInteger(question.correctAnswer)) return question.correctAnswer;
  const options = Array.isArray(question.options) ? question.options : [];
  const flagged = options.findIndex((o) => o && typeof o === "object" && o.isCorrect);
  if (flagged >= 0) return flagged;
  if (typeof question.correctAnswer === "string") {
    const raw = question.correctAnswer.trim();
    const textHit = options.findIndex((o) => plain(o).toLowerCase() === raw.toLowerCase());
    if (textHit >= 0) return textHit;
    if (/^[A-Ha-h]$/.test(raw)) {
      const i = raw.toUpperCase().charCodeAt(0) - 65;
      if (i < options.length) return i;
    }
  }
  return null;
}

async function reloadQuestions(quizId) {
  const qs = await db().collection("quizzes").doc(quizId).collection("questions").get();
  return qs.docs.map((d) => ({id: d.id, ...d.data()}));
}

function coverageOf(questions) {
  let approved = 0;
  let drafted = 0;
  questions.forEach((q) => {
    if (q.explanationStatus === core.EXPLANATION_STATUS.APPROVED) approved += 1;
    else if (q.explanationStatus === core.EXPLANATION_STATUS.AI_DRAFT) drafted += 1;
  });
  return {
    approved,
    drafted,
    missing: questions.length - approved - drafted,
    total: questions.length,
    coverage: questions.length ? approved / questions.length : 0,
  };
}

// ── reviewPaperExplanation ───────────────────────────────────────────────

/**
 * Approve, edit, or reject ONE question's explanation.
 *
 * `approved` is written only here and only by a staff account, which is why
 * `explanationStatus` is on no client write path: the studio calls this, it
 * does not set the field.
 */
exports.reviewPaperExplanationHandler = async (request) => {
  const uid = await assertStaff(request);
  const quizId = String(request.data?.quizId || "");
  const questionId = String(request.data?.questionId || "");
  const action = String(request.data?.action || "");
  if (!quizId || !questionId) throw new HttpsError("invalid-argument", "Which question?");
  if (!Object.values(core.REVIEW_ACTION).includes(action)) {
    throw new HttpsError("invalid-argument", "Unknown review action.");
  }

  const ref = db().collection("quizzes").doc(quizId).collection("questions").doc(questionId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That question is not there.");

  const write = core.buildReviewWrite({
    action,
    edited: request.data?.edited,
    reviewerUid: uid,
    now: admin.firestore.FieldValue.serverTimestamp(),
  });
  await ref.set(write, {merge: true});
  return {questionId, status: write.explanationStatus};
};

// ── bulkApproveExplanations ──────────────────────────────────────────────

/**
 * "Bulk-approve a whole part when the drafts are clean" (§6.2).
 *
 * Only questions the REVIEWER WAS SHOWN are touched, and only ones still in
 * `ai_draft`. A question that arrived between the screen rendering and the
 * button being pressed is not in the list, so it is not approved — the
 * reviewer did not read it, and that distinction is the entire safeguard on
 * an action whose whole purpose is not reading things one at a time.
 */
exports.bulkApproveExplanationsHandler = async (request) => {
  const uid = await assertStaff(request);
  const quizId = String(request.data?.quizId || "");
  const requestedIds = Array.isArray(request.data?.questionIds) ? request.data.questionIds : [];
  if (!quizId || requestedIds.length === 0) {
    throw new HttpsError("invalid-argument", "Which questions?");
  }
  const questions = await reloadQuestions(quizId);
  const approvable = core.selectBulkApprovable({questions, requestedIds});

  if (approvable.length === 0) return {approved: 0, skipped: requestedIds.length};

  const batch = db().batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  approvable.slice(0, 400).forEach((id) => {
    batch.set(
        db().collection("quizzes").doc(quizId).collection("questions").doc(id),
        core.buildReviewWrite({action: core.REVIEW_ACTION.APPROVE, reviewerUid: uid, now}),
        {merge: true},
    );
  });
  await batch.commit();
  return {approved: approvable.length, skipped: requestedIds.length - approvable.length};
};

// ── paperExplanationCoverage ─────────────────────────────────────────────

/**
 * The studio's review queue: one row per question with its stem, key, draft
 * prose and status, plus the paper-level coverage.
 *
 * Coverage is shown to ADMINS only. "Learners never see it; an unexplained
 * question simply shows its answer" — a learner told a paper is 40% explained
 * learns only that they may have drawn the bad 60%.
 */
exports.paperExplanationQueueHandler = async (request) => {
  await assertStaff(request);
  const {paper, quizId, questions} = await loadPaperQuiz(String(request.data?.paperId || ""));
  return {
    paperId: paper.id,
    quizId,
    coverage: coverageOf(questions),
    questions: questions.map((q) => {
      const correctIndex = resolveCorrectIndex(q);
      return {
        id: q.id,
        n: q.n ?? null,
        order: q.order ?? 0,
        section: q.section || "",
        topic: q.topic || "",
        stem: plain(q.text).slice(0, 400),
        options: (Array.isArray(q.options) ? q.options : []).map(plain),
        correctIndex,
        explanationStatus: q.explanationStatus || core.EXPLANATION_STATUS.MISSING,
        why: q.why || "",
        distractors: q.distractors || {},
        example: q.example || "",
        approvedBy: q.approvedBy || "",
      };
    }),
  };
};

module.exports.MAX_PER_CALL = MAX_PER_CALL;
module.exports.resolveCorrectIndex = resolveCorrectIndex;
module.exports.coverageOf = coverageOf;
module.exports.markingSchemeFor = markingSchemeFor;
