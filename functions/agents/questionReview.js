/**
 * Qix — the Central Question Bank review agent.
 *
 * A Firestore-triggered Cloud Function that reviews every question captured
 * into questionBank/{id}. Runs in the background (the teacher never waits) and
 * writes its verdict back onto the same doc — it does NOT spam the agentJobs
 * collection (per-question volume would drown the /admin/agents feed).
 *
 * Flow:
 *   1. Fire only on a doc whose reviewStatus === 'pending_review' and that has
 *      not been reviewed yet (no aiReview).
 *   2. Circuit breaker: agentControl/qix.paused.
 *   3. Deterministic dedup (questionDedupCore) against sibling questions — an
 *      exact/near hit short-circuits with NO model call (cheap) and links to
 *      the original.
 *   4. Otherwise an Anthropic Haiku review (tool-forced structured output)
 *      scores quality + curriculum fit and recommends approve / needs_admin /
 *      reject. Fail-closed to needs_admin on any error — nothing reaches the
 *      Master Bank without a clean pass.
 *
 * Region: africa-south1 (collocated with Firestore, like the agent dispatcher).
 *
 * This file is the I/O shim: Firestore trigger wiring, the Haiku model call,
 * and the circuit-breaker read. Every pure decision (prompt/payload shaping,
 * verdict payloads, dedup candidate shaping, the fail-closed default) lives in
 * ./questionReviewCore so it tests under plain `node`.
 */

const admin = require("firebase-admin");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {classifyDuplicate, recommendationToStatus} = require("./questionDedupCore");
const {classifyEmbeddingDuplicate} = require("./questionEmbeddingCore");
const {embedText} = require("../openaiEmbeddings");
const {
  MODEL,
  CANDIDATE_LIMIT,
  SYSTEM_PROMPT,
  REVIEW_TOOL,
  clampStr,
  safeParseJson,
  readQuestion,
  buildUserContent,
  buildScores,
  embedTextFor,
  shouldReviewQuestion,
  collectDedupCandidates,
  isReadableReview,
  buildAiReviewUpdate,
  buildDuplicateUpdate,
  buildFailClosedUpdate,
} = require("./questionReviewCore");

const TRIGGER_OPTS = {
  document: "questionBank/{questionId}",
  region: "africa-south1",
  timeoutSeconds: 120,
  memory: "512MiB",
};

/** The Firestore server-timestamp sentinel, as the Core builders expect it. */
function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/* --------------------------- dedup candidate read --------------------------- */

async function fetchDedupCandidates(db, docData, selfId) {
  let q = db.collection("questionBank")
    .where("subject", "==", String(docData.subject || ""))
    .where("grade", "==", String(docData.grade || ""));
  if (docData.topic) q = q.where("topic", "==", String(docData.topic));
  let snap;
  try {
    snap = await q.limit(CANDIDATE_LIMIT).get();
  } catch (err) {
    // A missing composite index shouldn't crash the review — skip dedup.
    console.warn("[qix] dedup candidate query failed", err && err.message);
    return [];
  }
  const rows = [];
  snap.forEach((d) => rows.push({id: d.id, data: d.data()}));
  return collectDedupCandidates(rows, selfId);
}

/* ------------------------------- the runner ------------------------------- */

async function reviewQuestion({db, jobRef, questionId, docData, anthropicApiKeySecret, openaiApiKeySecret, autoApprove}) {
  const question = readQuestion(docData);

  // 1. Deterministic dedup first — cheap, no model call.
  const candidates = await fetchDedupCandidates(db, docData, questionId);
  const dup = classifyDuplicate(
    {fingerprint: docData.fingerprint, simhashTokens: docData.simhashTokens},
    candidates,
  );
  if (dup.isDuplicate) {
    await flagDuplicate(db, jobRef, dup);
    return;
  }

  // 1b. Semantic dedup — only when the free deterministic layers missed.
  // Embed this question and compare (cosine) against candidates that already
  // carry a stored embedding. Any failure (no key, network) returns null and we
  // fall through to the AI review — semantic dedup never breaks a review.
  let questionEmbedding = null;
  const openaiKey = (openaiApiKeySecret && openaiApiKeySecret.value()) ||
    process.env.OPENAI_API_KEY;
  if (openaiKey) {
    questionEmbedding = await embedText(openaiKey, embedTextFor(question), {track: {tool: "qix"}});
    if (questionEmbedding) {
      const semantic = classifyEmbeddingDuplicate(questionEmbedding, candidates);
      if (semantic.isDuplicate) {
        // Store the embedding too, so this row is still a candidate later.
        await flagDuplicate(db, jobRef, semantic, {embedding: questionEmbedding});
        return;
      }
    }
  }

  // 2. AI review.
  const apiKey = (anthropicApiKeySecret && anthropicApiKeySecret.value()) ||
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await failClosed(jobRef, "AI reviewer not configured — sent to admin review.");
    return;
  }

  let cbcContextBlock = "";
  try {
    const {resolveCbcContext} = require("../teacherTools/cbcKnowledge");
    const cbc = await resolveCbcContext({
      grade: docData.grade, subject: docData.subject,
      topic: docData.topic, subtopic: docData.subtopic,
    });
    cbcContextBlock = (cbc && cbc.contextBlock) || "";
  } catch {
    // CBC context is a nice-to-have; the review still runs without it.
  }

  const {callAnthropic} = require("../aiService");
  let raw;
  try {
    raw = await callAnthropic(apiKey, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{role: "user", content: buildUserContent(question, docData, cbcContextBlock)}],
      model: MODEL,
      maxTokens: 1500,
      temperature: 0.1,
      tools: [REVIEW_TOOL],
      toolChoice: {type: "tool", name: "submit_review", disable_parallel_tool_use: true},
      track: {tool: "questionReview"},
    });
  } catch (err) {
    console.error("[qix] Anthropic call failed", err && err.message);
    await failClosed(jobRef, "AI reviewer could not run — sent to admin review.");
    return;
  }

  const parsed = safeParseJson(raw);
  if (!isReadableReview(parsed)) {
    console.warn("[qix] unreadable review response", {questionId, preview: clampStr(raw, 300)});
    await failClosed(jobRef, "AI review unreadable — sent to admin review.");
    return;
  }

  const {reviewStatus, masterEligible} = recommendationToStatus(parsed.recommendation, autoApprove);
  await jobRef.set(
    buildAiReviewUpdate(parsed, {reviewStatus, masterEligible, questionEmbedding, serverTimestamp}),
    {merge: true},
  );
}

/**
 * Write a duplicate verdict and link to the original (bumping its usage count).
 * Shared by the deterministic (exact/near) and semantic dedup paths. `extra`
 * merges additional fields onto the doc (e.g. the computed embedding).
 */
async function flagDuplicate(db, jobRef, dup, extra = {}) {
  await jobRef.set(buildDuplicateUpdate(dup, extra, serverTimestamp), {merge: true});
  try {
    await db.collection("questionBank").doc(dup.duplicateOf).set({
      usageCount: admin.firestore.FieldValue.increment(1),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.warn("[qix] usage bump failed", err && err.message);
  }
}

/** Fail-closed: route to admin review, never to the Master Bank. */
async function failClosed(jobRef, summary) {
  await jobRef.set(buildFailClosedUpdate(summary, serverTimestamp), {merge: true});
}

// Cached snapshot of the agentControl/qix doc (mirrors dispatcher.js). Holds
// both the pause breaker and the opt-in auto-approve flag so we read the doc
// once per minute instead of on every question.
let controlCache = {expiresAt: 0, paused: false, autoApprove: false};
async function qixControl(db) {
  if (Date.now() < controlCache.expiresAt) return controlCache;
  let paused = false;
  let autoApprove = false;
  try {
    const snap = await db.collection("agentControl").doc("qix").get();
    const data = (snap.exists && snap.data()) || {};
    paused = Boolean(data.paused);
    autoApprove = Boolean(data.autoApprove);
  } catch {
    paused = false;
    autoApprove = false;
  }
  controlCache = {expiresAt: Date.now() + 60_000, paused, autoApprove};
  return controlCache;
}

/**
 * Factory for the questionBank review trigger (mirrors createAgentJobsOnCreate).
 */
function createQuestionReviewOnWrite(anthropicApiKeySecret, openaiApiKeySecret) {
  const secrets = [anthropicApiKeySecret];
  if (openaiApiKeySecret) secrets.push(openaiApiKeySecret);
  return onDocumentWritten(
    {...TRIGGER_OPTS, secrets},
    async (event) => {
      const after = event.data && event.data.after && event.data.after.data();
      // Only review questions explicitly queued for review and not yet judged
      // (deletions and already-reviewed docs are skipped).
      if (!shouldReviewQuestion(after)) return;

      const db = admin.firestore();
      const control = await qixControl(db);
      if (control.paused) return; // breaker tripped — leave pending

      const questionId = event.params.questionId;
      const jobRef = db.collection("questionBank").doc(questionId);
      try {
        await reviewQuestion({db, jobRef, questionId, docData: after, anthropicApiKeySecret, openaiApiKeySecret, autoApprove: control.autoApprove});
      } catch (err) {
        console.error("[qix] review failed", err && err.message);
        await failClosed(jobRef, "Review failed — sent to admin review.").catch(() => {});
      }
    },
  );
}

module.exports = {
  createQuestionReviewOnWrite,
  // exported for tests
  buildScores,
  readQuestion,
};
