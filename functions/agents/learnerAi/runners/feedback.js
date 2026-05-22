/**
 * Learner Feedback Generator Agent — v2 (live LLM body).
 *
 * One artifact per completed quiz attempt. Reads:
 *   - The attempt itself (results/{attemptId}) — score + topicScores
 *   - learnerWeaknessProfiles/{learnerId} — strengths + persistent
 *     weak areas (already computed by the Weakness Detection agent)
 *   - The latest study_tips artifact for this learner (optional —
 *     reuse a tip rather than invent a new one)
 *
 * Privacy invariants (NON-NEGOTIABLE):
 *   - Refuses unless both `learnerId` AND `attemptId` are supplied.
 *   - The attempt is double-checked: results/{attemptId}.userId MUST
 *     match `learnerId`. Any mismatch → refusal with
 *     attempt_belongs_to_other_learner. Belt-and-braces against an
 *     admin or upstream typo passing the wrong attemptId.
 *   - Reads only this learner's weakness profile.
 *   - Writes only to aiGeneratedContent (per-artifact). Auto-publish
 *     to the learner's dashboard is gated by
 *     settings.autoPublishLearnerFeedback AND the attemptId+learnerId
 *     precondition on the dispatcher allow-list.
 *
 * Pipeline chain:
 *   curriculumReader → feedback → standardsCheck → qualityCheck
 *
 * Quality bars enforced server-side regardless of the LLM:
 *   - tone matches the score band exactly (celebratory / positive /
 *     balanced / supportive / gentle)
 *   - strengths sentence omitted when strengths[] is empty (no
 *     fake praise rule)
 *   - studyTip verb-led + non-generic (matches Quality Check v3's
 *     tips_actionable + tips_useful patterns)
 *
 * LLM gating: Anthropic Sonnet 4.5 with the tool-use schema in
 * ../schemas/feedback.js. Structured-stub fallback when key absent.
 */

const admin = require("firebase-admin");
const {makeRunner} = require("./_stubFactory");
const {writeAgentLog} = require("../logger");
const {COLLECTIONS, SEVERITY} = require("../v2Collections");
const promptModule = require("../prompts/feedback");
const toolSchema = require("../schemas/feedback");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.LEARNER_AI_FEEDBACK_MODEL ||
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const AGENT_ID = "feedback";

const DEFAULT_PARAMETERS = Object.freeze({
  maxCorrectiveExplanations: 4,
});

const STRENGTH_THRESHOLD = 70;
const WEAK_THRESHOLD = 70;

// Imperative-verb regex (same shape as Study Tips). Quality Check v3
// flags tips that don't start with one of these.
const VERB_HEAD = /^(write|practice|draw|read|review|underline|count|solve|measure|memorise|memorize|repeat|try|use|spell|copy|circle|tick|check|list|name|describe|identify|complete|fill|colour|color|trace|study|revise)\b/i;

const GENERIC_TIP_PATTERNS = [
  /\bstudy hard\b/i, /\bpractice more\b/i, /\bdo your best\b/i,
  /\bwork hard\b/i, /\btry your best\b/i, /\bbelieve in yourself\b/i,
  /\bjust focus\b/i, /\bnever give up\b/i,
];

// ── Parameter normalisation ─────────────────────────────────────────

function normaliseParameters(task) {
  const raw = (task && task.parameters) || {};
  const learnerId = typeof raw.learnerId === "string" && raw.learnerId.length ?
    raw.learnerId.slice(0, 120) : null;
  const attemptId = typeof raw.attemptId === "string" && raw.attemptId.length ?
    raw.attemptId.slice(0, 120) :
    (typeof raw.resultId === "string" && raw.resultId.length ?
      raw.resultId.slice(0, 120) : null);
  const maxCorrectiveExplanations = Number.isInteger(raw.maxCorrectiveExplanations) ?
    Math.max(1, Math.min(8, raw.maxCorrectiveExplanations)) :
    DEFAULT_PARAMETERS.maxCorrectiveExplanations;
  return {learnerId, attemptId, maxCorrectiveExplanations};
}

// ── Firestore reads (privacy-scoped) ────────────────────────────────

async function loadAttempt(attemptId) {
  if (!attemptId) return null;
  try {
    const snap = await admin.firestore().collection("results")
        .doc(attemptId).get();
    if (snap.exists) return {id: snap.id, ...(snap.data() || {})};
  } catch (err) {
    console.warn("[feedback] results lookup failed", err && err.message);
  }
  // Fall back to exam_attempts for older quiz formats.
  try {
    const snap = await admin.firestore().collection("exam_attempts")
        .doc(attemptId).get();
    if (snap.exists) return {id: snap.id, ...(snap.data() || {})};
  } catch (err) {
    console.warn("[feedback] exam_attempts lookup failed", err && err.message);
  }
  return null;
}

async function loadWeaknessProfile(learnerId) {
  if (!learnerId) return null;
  try {
    const snap = await admin.firestore()
        .collection(COLLECTIONS.WEAKNESS_PROFILES).doc(learnerId).get();
    if (snap.exists) return {id: snap.id, ...(snap.data() || {})};
  } catch (err) {
    console.warn("[feedback] weakness profile lookup failed", err && err.message);
  }
  return null;
}

async function loadLatestStudyTip(learnerId) {
  if (!learnerId) return null;
  try {
    const snap = await admin.firestore()
        .collection(COLLECTIONS.CONTENT)
        .where("type", "==", "study_tips")
        .get();
    if (snap.empty) return null;
    // Filter for this learner + pick newest. Doing the learner-filter
    // post-query because aiGeneratedContent doesn't index by learnerId
    // (we'd need a composite index to query in Firestore).
    const matching = snap.docs
        .map((d) => ({id: d.id, ...(d.data() || {})}))
        .filter((d) => d && d.content && d.content.learnerId === learnerId)
        .sort((a, b) => {
          const at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return bt - at;
        });
    if (!matching.length) return null;
    const tips = matching[0].content.tips;
    if (!Array.isArray(tips) || !tips.length) return null;
    return tips[0].tip || null;
  } catch (err) {
    console.warn("[feedback] study tips lookup failed", err && err.message);
    return null;
  }
}

// ── Pure analysis ───────────────────────────────────────────────────

/**
 * Derive strengths + weak areas from the attempt + the optional
 * persistent weakness profile.
 *   - Strengths: topics on THIS attempt with topicScore ≥ 70.
 *   - Weak areas: topics on THIS attempt with topicScore < 70,
 *     enriched with the profile's weakTopics (so a profile entry
 *     gets surfaced even on a quiz that didn't cover that topic).
 */
function deriveStrengthsAndWeakAreas({attempt, profile}) {
  const strengths = [];
  const weakAreas = [];
  const topicScores = attempt && attempt.topicScores && typeof attempt.topicScores === "object" ?
    attempt.topicScores : {};
  for (const [topic, score] of Object.entries(topicScores)) {
    if (typeof topic !== "string" || !topic.trim()) continue;
    const n = Number(score);
    if (!Number.isFinite(n)) continue;
    if (n >= STRENGTH_THRESHOLD) strengths.push(topic);
    else if (n < WEAK_THRESHOLD) weakAreas.push(topic);
  }
  if (profile && Array.isArray(profile.weakTopics)) {
    for (const t of profile.weakTopics) {
      if (typeof t !== "string" || !t.trim()) continue;
      if (!weakAreas.some((w) => w.toLowerCase() === t.toLowerCase())) {
        weakAreas.push(t);
      }
    }
  }
  return {strengths: strengths.slice(0, 10), weakAreas: weakAreas.slice(0, 10)};
}

function pickTone(percentage) {
  return promptModule.pickTone(percentage);
}

function buildScoreBlock(attempt) {
  const score = Number(attempt && attempt.score);
  const outOf = Number(attempt && (attempt.totalMarks || attempt.outOf));
  const pctRaw = Number(attempt && attempt.percentage);
  const percentage = Number.isFinite(pctRaw) ? pctRaw :
    (Number.isFinite(score) && Number.isFinite(outOf) && outOf > 0 ?
      Math.round((score / outOf) * 100) : 0);
  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(1000, score)) : 0,
    outOf: Number.isFinite(outOf) && outOf > 0 ?
      Math.max(1, Math.min(1000, outOf)) : 1,
    percentage: Math.max(0, Math.min(100, percentage)),
  };
}

// ── Stamping + filtering ────────────────────────────────────────────

function trimString(s, max) {
  return String(s || "").trim().slice(0, max);
}

function looksGeneric(tip) {
  const s = String(tip || "").toLowerCase();
  return GENERIC_TIP_PATTERNS.some((re) => re.test(s));
}

function validStudyTip(s) {
  const t = trimString(s, 300);
  if (!t) return null;
  if (!VERB_HEAD.test(t)) return null;
  if (looksGeneric(t)) return null;
  return t;
}

function stampCorrective(raw, fallbackTopic) {
  const topic = trimString(raw.topic, 200) || fallbackTopic;
  const what = trimString(raw.whatToCorrect, 400);
  const exp = trimString(raw.briefExplanation, 600);
  if (!what || !exp) return null;
  return {
    topic,
    subtopic: raw.subtopic ? trimString(raw.subtopic, 200) : null,
    whatToCorrect: what,
    briefExplanation: exp,
  };
}

function stampRecommendedQuiz(raw, fallbackTopic) {
  const topic = trimString(raw.topic, 200) || fallbackTopic;
  const focus = trimString(raw.focus, 400);
  if (!focus) return null;
  return {
    topic,
    subtopic: raw.subtopic ? trimString(raw.subtopic, 200) : null,
    focus,
    numQuestions: Number.isInteger(raw.numQuestions) ?
      Math.max(3, Math.min(15, raw.numQuestions)) : 5,
    difficulty: ["easy", "medium", "hard", "mixed"].includes(raw.difficulty) ?
      raw.difficulty : "easy",
  };
}

// ── Structured stub (CI / no-LLM fallback) ──────────────────────────

const TONE_OPENERS = Object.freeze({
  celebratory: "Excellent work!",
  positive:    "Good work.",
  balanced:    "A fair start.",
  supportive:  "Not the score we wanted, but it is fixable.",
  gentle:      "This one was tough — let us fix it together.",
});

function buildStructuredStub({curriculumReader, attempt, strengths, weakAreas, studyTip, parameters}) {
  const score = buildScoreBlock(attempt);
  const tone = pickTone(score.percentage);

  const opener = TONE_OPENERS[tone] || TONE_OPENERS.balanced;
  const scoreLine = `You scored ${score.score} out of ${score.outOf} (${score.percentage}%).`;
  const strengthsLine = strengths.length ?
    ` You did well on ${strengths.slice(0, 3).join(", ")}.` : "";
  const weakLine = weakAreas.length ?
    ` Now spend some time on ${weakAreas.slice(0, 3).join(", ")} before your next attempt.` :
    " Keep practicing to stay sharp.";
  const encouragingMessage = `${opener} ${scoreLine}${strengthsLine}${weakLine}`;

  // Corrective explanations — one per weak area, up to maxCorrective.
  const correctives = [];
  const excerpts = (curriculumReader && curriculumReader.citedExcerpts) || [];
  for (const area of weakAreas.slice(0, parameters.maxCorrectiveExplanations)) {
    const excerpt = excerpts[correctives.length % Math.max(1, excerpts.length)];
    correctives.push({
      topic: area,
      subtopic: null,
      whatToCorrect: `You missed questions on ${area}.`,
      briefExplanation: excerpt ?
        `From the syllabus: ${String(excerpt.text || "").slice(0, 240)}` :
        `Re-read your notes on ${area} and try a few practice questions.`,
    });
  }

  const recommendedNotes = weakAreas.slice(0, 3).map((a) => `${a} — re-read notes`);
  const recommendedQuizzes = weakAreas.slice(0, 2).map((a) => ({
    topic: a, subtopic: null,
    focus: `Easier questions on ${a} to rebuild confidence`,
    numQuestions: 5, difficulty: "easy",
  }));

  // Study tip — prefer reused tip; otherwise generate a verb-led one.
  let stubTip = studyTip ? validStudyTip(studyTip) : null;
  if (!stubTip) {
    if (weakAreas.length) {
      stubTip = `Practice three short ${weakAreas[0]} questions tomorrow morning.`;
    } else if (strengths.length) {
      stubTip = `Review your notes on ${strengths[0]} once a week to keep it fresh.`;
    } else {
      stubTip = null;
    }
  }

  return {
    title: `Your ${curriculumReader.subject || "quiz"} feedback — ${curriculumReader.topic || ""}`.trim(),
    score, tone, encouragingMessage,
    strengths, weakAreas, correctiveExplanations: correctives,
    recommendedNotes, recommendedQuizzes,
    studyTip: stubTip,
  };
}

// ── LLM call ────────────────────────────────────────────────────────

async function callLLM({systemPrompt, userMessage, apiKey, maxTokens}) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature: 0.4,
      system: [{type: "text", text: systemPrompt, cache_control: {type: "ephemeral"}}],
      messages: [{role: "user", content: userMessage}],
      tools: [toolSchema],
      tool_choice: {type: "tool", name: toolSchema.name},
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`anthropic_${res.status}:${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  const toolUse = blocks.find((b) => b && b.type === "tool_use" && b.name === toolSchema.name);
  if (!toolUse || !toolUse.input) {
    throw new Error("anthropic_no_tool_use_block");
  }
  return {raw: toolUse.input, modelUsed: data.model || ANTHROPIC_MODEL};
}

// ── runLive ─────────────────────────────────────────────────────────

async function runLive({task, curriculumReader}) {
  if (!curriculumReader || !curriculumReader.topic) {
    throw new Error("missing_curriculum_reader_output");
  }
  const parameters = normaliseParameters(task);
  if (!parameters.learnerId) throw new Error("missing_learnerId");
  if (!parameters.attemptId) throw new Error("missing_attemptId");

  const attempt = await loadAttempt(parameters.attemptId);
  if (!attempt) throw new Error("attempt_not_found");
  if (attempt.userId && attempt.userId !== parameters.learnerId) {
    // Privacy hard-stop.
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "feedback",
      message: `Refused: attempt ${parameters.attemptId} belongs to a different learner`,
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.ERROR,
    });
    throw new Error("attempt_belongs_to_other_learner");
  }

  const profile = await loadWeaknessProfile(parameters.learnerId);
  const studyTip = await loadLatestStudyTip(parameters.learnerId);

  const {strengths, weakAreas} = deriveStrengthsAndWeakAreas({attempt, profile});

  const scoreBlock = buildScoreBlock(attempt);

  const systemPrompt = promptModule.SYSTEM;
  const userMessage = promptModule.buildUserMessage({
    curriculumReader, attempt: scoreBlock,
    strengths, weakAreas, studyTip, parameters,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let raw = null;
  let modelUsed;
  if (apiKey) {
    try {
      const maxTokens = Math.min(3000, 1200 + parameters.maxCorrectiveExplanations * 200);
      const result = await callLLM({systemPrompt, userMessage, apiKey, maxTokens});
      raw = result.raw;
      modelUsed = result.modelUsed;
    } catch (err) {
      await writeAgentLog({
        taskId: task.id, agentName: AGENT_ID,
        action: "llm_call_failed",
        message: `LLM call failed (${String(err && err.message || err).slice(0, 240)}); falling back to structured stub`,
        taskType: task.taskType,
        grade: task.grade, subject: task.subject, topic: task.topic,
        severity: SEVERITY.WARNING,
      });
      raw = null;
    }
  }

  if (!raw) {
    raw = buildStructuredStub({
      curriculumReader, attempt: scoreBlock,
      strengths, weakAreas, studyTip, parameters,
    });
    modelUsed = "stub";
  }

  // Stamp + enforce server-side rules.
  const tone = pickTone(scoreBlock.percentage);  // pin to actual score band

  // No-fake-praise enforcement: if strengths[] is empty, drop any
  // strengths the LLM tried to emit.
  const finalStrengths = strengths.length ?
    (Array.isArray(raw.strengths) ?
      raw.strengths.map((s) => trimString(s, 200)).filter(Boolean) :
      strengths).slice(0, 10) :
    [];

  // Weak areas — same rule.
  const finalWeakAreas = weakAreas.length ?
    (Array.isArray(raw.weakAreas) ?
      raw.weakAreas.map((s) => trimString(s, 200)).filter(Boolean) :
      weakAreas).slice(0, 10) :
    [];

  const correctives = (Array.isArray(raw.correctiveExplanations) ?
    raw.correctiveExplanations : [])
      .map((c) => stampCorrective(c, curriculumReader.topic))
      .filter((c) => c !== null)
      .slice(0, parameters.maxCorrectiveExplanations);

  const recommendedNotes = (Array.isArray(raw.recommendedNotes) ?
    raw.recommendedNotes : [])
      .map((s) => trimString(s, 300))
      .filter(Boolean)
      .slice(0, 6);

  const recommendedQuizzes = (Array.isArray(raw.recommendedQuizzes) ?
    raw.recommendedQuizzes : [])
      .map((q) => stampRecommendedQuiz(q, curriculumReader.topic))
      .filter((q) => q !== null)
      .slice(0, 4);

  const studyTipOut = validStudyTip(raw.studyTip) || null;

  const content = {
    title: trimString(raw.title, 200) ||
      `Your ${curriculumReader.subject || "quiz"} feedback`,
    score: scoreBlock,
    tone,
    encouragingMessage: trimString(raw.encouragingMessage, 600) ||
      `${TONE_OPENERS[tone]} You scored ${scoreBlock.score} out of ${scoreBlock.outOf}.`,
    strengths: finalStrengths,
    weakAreas: finalWeakAreas,
    correctiveExplanations: correctives,
    recommendedNotes,
    recommendedQuizzes,
    studyTip: studyTipOut,
    grade: String(curriculumReader.grade || ""),
    subject: String(curriculumReader.subject || ""),
    term: curriculumReader.term ?? null,
    topic: String(curriculumReader.topic || ""),
    subtopic: curriculumReader.subtopic ?? null,
    learnerId: parameters.learnerId,
    attemptId: parameters.attemptId,
    quizId: trimString(attempt.quizId, 120) || "",
    modelUsed: String(modelUsed || "unknown").slice(0, 80),
    parametersUsed: parameters,
  };

  return {content, modelUsed};
}

const runFeedback = makeRunner({
  agentId: AGENT_ID,
  artifactType: "learner_feedback",
  runLive,
});

module.exports = {
  runFeedback,
  // Pure helpers exported for unit tests.
  normaliseParameters,
  deriveStrengthsAndWeakAreas,
  pickTone,
  buildScoreBlock,
  validStudyTip,
  looksGeneric,
  stampCorrective,
  stampRecommendedQuiz,
  buildStructuredStub,
  loadAttempt, loadWeaknessProfile, loadLatestStudyTip,
  DEFAULT_PARAMETERS,
  AGENT_ID,
  TONE_OPENERS,
  VERB_HEAD,
};
