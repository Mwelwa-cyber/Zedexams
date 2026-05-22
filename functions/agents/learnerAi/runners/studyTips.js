/**
 * Study Tips Generator Agent — v2 (live LLM body).
 *
 * Reads the learner's weakness profile + (optional) explicit
 * weak-areas parameter and produces personalised, actionable study
 * tips grounded in the curriculum context. Refuses to produce
 * generic tips — the user's hard rule "Tips must be connected to
 * learner performance data" is enforced by the
 * `gatherWeakSignals` helper: if neither
 * learnerWeaknessProfiles/{learnerId} nor task.parameters.weakAreas
 * yields a signal, runLive throws `missing_weakness_data` and the
 * dispatcher marks the task as error.
 *
 * Pipeline chain (set by the supervisor planner):
 *   curriculumReader → studyTips → standardsCheck → qualityCheck
 *
 * Publishing rules:
 *   - Auto-publish only if settings/global.learnerAi.autoPublishStudyTips
 *     === true AND task.parameters.weakLearnerId is set AND Quality
 *     Check passed. The dispatcher gate enforces this; the
 *     parameter check guards "tips must be based on real weakness
 *     data" at the publish boundary as well.
 *
 * Output shape pinned by `studyTipsContentSchema` in
 * src/schemas/learnerAi.js. Includes:
 *   - feedback (encouraging-but-honest opener)
 *   - tips[]               — actionable, weak-signal-grounded
 *   - recommendedNotes[]
 *   - recommendedQuizzes[]
 *   - revisionPlan[]       — day-by-day
 *   - weakSignalsUsed[]    — audit trail of which performance data
 *                            shaped the tips
 */

const admin = require("firebase-admin");
const {makeRunner} = require("./_stubFactory");
const {writeAgentLog} = require("../logger");
const {COLLECTIONS, SEVERITY} = require("../v2Collections");
const promptModule = require("../prompts/studyTips");
const toolSchema = require("../schemas/studyTips");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.LEARNER_AI_STUDY_TIPS_MODEL ||
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const AGENT_ID = "studyTips";

// Imperative-verb regex matching Quality Check v3's `tips_actionable`
// axis. Used by both the stub builder + the post-LLM filter.
const VERB_HEAD = /^(write|practice|draw|read|review|underline|count|solve|measure|memorise|memorize|repeat|try|use|spell|copy|circle|tick|check|list|name|describe|identify|complete|fill|colour|color|trace|study|revise)\b/i;

const DEFAULT_PARAMETERS = Object.freeze({
  maxTips: 6,
  includeRevisionPlan: true,
  planDurationDays: 7,
});

// ── Parameter normalisation ─────────────────────────────────────────

function normaliseParameters(task) {
  const raw = (task && task.parameters) || {};
  const weakLearnerId = typeof raw.weakLearnerId === "string" && raw.weakLearnerId.length ?
    raw.weakLearnerId.slice(0, 120) : null;
  const maxTips = Number.isInteger(raw.maxTips) ?
    Math.max(3, Math.min(15, raw.maxTips)) : DEFAULT_PARAMETERS.maxTips;
  const includeRevisionPlan = raw.includeRevisionPlan !== false;
  const planDurationDays = Number.isInteger(raw.planDurationDays) ?
    Math.max(3, Math.min(14, raw.planDurationDays)) :
    DEFAULT_PARAMETERS.planDurationDays;
  const weakAreas = Array.isArray(raw.weakAreas) ?
    raw.weakAreas.slice(0, 20) : [];
  return {weakLearnerId, maxTips, includeRevisionPlan, planDurationDays, weakAreas};
}

// ── Weakness profile lookup ─────────────────────────────────────────

/**
 * Try doc-by-ID first (the cheapest path — Weakness Detection Agent
 * uses learnerId as the doc ID by convention). Fall back to a query
 * for installations that put profileId ≠ learnerId.
 */
async function loadWeaknessProfile(learnerId) {
  if (!learnerId) return null;
  const db = admin.firestore();
  try {
    const direct = await db.collection(COLLECTIONS.WEAKNESS_PROFILES)
        .doc(learnerId).get();
    if (direct.exists) return {id: direct.id, ...(direct.data() || {})};
  } catch (err) {
    console.warn("[studyTips] doc-by-id lookup failed", err && err.message);
  }
  try {
    const snap = await db.collection(COLLECTIONS.WEAKNESS_PROFILES)
        .where("learnerId", "==", learnerId).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return {id: doc.id, ...(doc.data() || {})};
  } catch (err) {
    console.warn("[studyTips] query lookup failed", err && err.message);
    return null;
  }
}

/**
 * Collect weakness signals from every available source. Order:
 *   1. learnerWeaknessProfiles → weakTopics + weakSubtopics +
 *      repeatedMistakes
 *   2. task.parameters.weakAreas → explicit one-off signals
 *
 * Returns an array of { source, topic, subtopic, mistakeNote }
 * suitable for the prompt + the persisted audit trail. Returns []
 * when no real data is available — the caller refuses.
 */
function gatherWeakSignals({profile, weakAreas}) {
  const out = [];

  if (profile) {
    const weakTopics = Array.isArray(profile.weakTopics) ? profile.weakTopics : [];
    const weakSubtopics = Array.isArray(profile.weakSubtopics) ? profile.weakSubtopics : [];
    const mistakes = Array.isArray(profile.repeatedMistakes) ? profile.repeatedMistakes : [];

    // Match each weakSubtopic to its parent topic when possible by
    // string-membership. If we can't tell, attach to the first
    // weak topic so the signal still ties back to a real topic.
    const seen = new Set();
    for (const subtopic of weakSubtopics) {
      if (!subtopic || typeof subtopic !== "string") continue;
      const parent = weakTopics.find((t) =>
        typeof t === "string" &&
        (subtopic.toLowerCase().includes(t.toLowerCase()) ||
          t.toLowerCase().includes(subtopic.toLowerCase()))) ||
        weakTopics[0] || subtopic;
      const matchedMistake = mistakes.find((m) =>
        m && typeof m === "object" &&
        (String(m.subtopic || "").toLowerCase() === subtopic.toLowerCase() ||
          String(m.topic || "").toLowerCase() === subtopic.toLowerCase()));
      const key = `${parent}|${subtopic}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        source: "profile",
        topic: String(parent),
        subtopic: String(subtopic),
        mistakeNote: matchedMistake ? String(matchedMistake.mistake || matchedMistake.note || "").slice(0, 400) : null,
      });
    }
    // Any topics without subtopic coverage become topic-level signals.
    for (const topic of weakTopics) {
      if (!topic || typeof topic !== "string") continue;
      const covered = out.some((s) => s.topic.toLowerCase() === topic.toLowerCase());
      if (covered) continue;
      const matchedMistake = mistakes.find((m) =>
        m && typeof m === "object" &&
        String(m.topic || "").toLowerCase() === topic.toLowerCase());
      out.push({
        source: "profile", topic: String(topic), subtopic: null,
        mistakeNote: matchedMistake ?
          String(matchedMistake.mistake || matchedMistake.note || "").slice(0, 400) : null,
      });
    }
  }

  for (const wa of weakAreas || []) {
    if (!wa || typeof wa !== "object") continue;
    const topic = String(wa.topic || "").trim();
    if (!topic) continue;
    const key = `param|${topic}|${wa.subtopic || ""}`.toLowerCase();
    if (out.some((s) => `param|${s.topic}|${s.subtopic || ""}`.toLowerCase() === key)) continue;
    out.push({
      source: "parameter", topic,
      subtopic: wa.subtopic ? String(wa.subtopic) : null,
      mistakeNote: wa.mistakeNote ? String(wa.mistakeNote).slice(0, 400) : null,
    });
  }

  return out.slice(0, 40);
}

// ── Stamping + filtering ────────────────────────────────────────────

function trimString(s, max) {
  return String(s || "").trim().slice(0, max);
}

function looksGeneric(tip) {
  // The catch-all generic patterns Quality Check v3 also flags.
  const s = String(tip || "").toLowerCase();
  return /\bstudy hard\b/.test(s) ||
    /\bpractice more\b/.test(s) ||
    /\bdo your best\b/.test(s) ||
    /\bwork hard\b/.test(s) ||
    /\bbelieve in yourself\b/.test(s) ||
    /\bnever give up\b/.test(s) ||
    /\bjust focus\b/.test(s);
}

function stampTip(rawTip, fallbackTopic) {
  const tipText = trimString(rawTip.tip, 300);
  if (!tipText) return null;
  if (!VERB_HEAD.test(tipText)) return null; // QC v3 tips_actionable
  if (looksGeneric(tipText)) return null;    // QC v3 tips_useful
  return {
    tip: tipText,
    reason: trimString(rawTip.reason, 400) || `Addresses a weak area in ${fallbackTopic}.`,
    topic: trimString(rawTip.topic, 200) || fallbackTopic,
    subtopic: rawTip.subtopic ? trimString(rawTip.subtopic, 200) : null,
    priority: ["high", "medium", "low"].includes(rawTip.priority) ?
      rawTip.priority : "medium",
    estimatedMinutes: Number.isInteger(rawTip.estimatedMinutes) ?
      Math.max(2, Math.min(60, rawTip.estimatedMinutes)) : 10,
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
      Math.max(3, Math.min(20, raw.numQuestions)) : 5,
    difficulty: ["easy", "medium", "hard", "mixed"].includes(raw.difficulty) ?
      raw.difficulty : "easy",
  };
}

function stampRevisionDay(raw) {
  const day = Number.isInteger(raw.day) ?
    Math.max(1, Math.min(14, raw.day)) : 1;
  const focus = trimString(raw.focus, 200);
  const activity = trimString(raw.activity, 400);
  if (!focus || !activity) return null;
  return {
    day, focus, activity,
    estimatedMinutes: Number.isInteger(raw.estimatedMinutes) ?
      Math.max(5, Math.min(120, raw.estimatedMinutes)) : 20,
  };
}

// ── Structured stub (CI / no-LLM fallback) ──────────────────────────

function buildStructuredStub({curriculumReader, weakSignals, parameters}) {
  if (!weakSignals.length) return null;

  const topic = curriculumReader.topic || weakSignals[0].topic;
  const learnerLevel = `Grade ${curriculumReader.grade || "?"}`;

  // Feedback — name the gap, then say what is fixable.
  const headline = weakSignals.length === 1 ?
    `${weakSignals[0].topic}${weakSignals[0].subtopic ? ` — ${weakSignals[0].subtopic}` : ""}` :
    `${weakSignals.length} weak areas in ${topic}`;
  const feedback =
    `You have been losing marks on ${headline}. That is honest — and it is also a small, ` +
    `fixable problem. The plan below targets exactly the areas your practice shows you are ` +
    `still building. Stick with it for ${parameters.planDurationDays} days and check back.`;

  // Tips — one per signal up to maxTips.
  const tips = [];
  const tipTemplates = [
    (s) => `Practice five ${s.subtopic || s.topic} questions at the start of each session.`,
    (s) => `Review the key vocabulary for ${s.subtopic || s.topic} before bed tonight.`,
    (s) => `Solve two worked examples of ${s.subtopic || s.topic} in your notebook.`,
    (s) => `Draw a labelled diagram showing ${s.subtopic || s.topic}.`,
    (s) => `Write out the definition of ${s.subtopic || s.topic} from memory tomorrow.`,
    (s) => `List three real Zambian examples of ${s.subtopic || s.topic}.`,
  ];
  for (let i = 0; i < weakSignals.length && tips.length < parameters.maxTips; i++) {
    const s = weakSignals[i];
    const template = tipTemplates[i % tipTemplates.length];
    const tip = template(s);
    const reason = s.mistakeNote ?
      `Your last attempt showed: ${s.mistakeNote}` :
      `${s.source === "profile" ? "Your weakness profile" : "The instructor"} ` +
      `flagged ${s.subtopic || s.topic} as a weak area.`;
    tips.push({
      tip, reason,
      topic: s.topic, subtopic: s.subtopic,
      priority: i < 2 ? "high" : "medium",
      estimatedMinutes: 10,
    });
  }

  const recommendedNotes = weakSignals.slice(0, 3).map((s) =>
    `${s.subtopic || s.topic} — re-read notes`);

  const recommendedQuizzes = weakSignals.slice(0, 2).map((s) => ({
    topic: s.topic,
    subtopic: s.subtopic,
    focus: `Same-difficulty questions on ${s.subtopic || s.topic} first`,
    numQuestions: 5,
    difficulty: "easy",
  }));

  const revisionPlan = parameters.includeRevisionPlan ?
    buildDefaultRevisionPlan(weakSignals, parameters.planDurationDays, topic) : [];

  return {
    title: `Your ${curriculumReader.subject || "study"} plan — ${topic}`,
    feedback,
    tips,
    recommendedNotes,
    recommendedQuizzes,
    revisionPlan,
  };
}

function buildDefaultRevisionPlan(weakSignals, days, topic) {
  const plan = [];
  for (let d = 1; d <= days; d++) {
    const signalIndex = (d - 1) % weakSignals.length;
    const signal = weakSignals[signalIndex];
    const focusName = signal.subtopic || signal.topic;
    let activity;
    let mins;
    if (d <= 2) {
      activity = `Read the notes for ${focusName} and copy the vocabulary into your book.`;
      mins = 20;
    } else if (d <= 4) {
      activity = `Solve five practice questions on ${focusName} from your textbook.`;
      mins = 30;
    } else if (d <= days - 2) {
      activity = `Run an AI practice quiz on ${focusName} and review the explanations.`;
      mins = 25;
    } else {
      activity = `Mixed revision: ${focusName} + ${topic}. Note any remaining gaps.`;
      mins = 30;
    }
    plan.push({
      day: d,
      focus: focusName,
      activity,
      estimatedMinutes: mins,
    });
  }
  return plan;
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
      temperature: 0.45,
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
  if (!parameters.weakLearnerId) {
    throw new Error("missing_weakLearnerId");
  }

  // Real-weakness-data rule: gather signals from profile + explicit
  // weakAreas; refuse if nothing.
  const profile = await loadWeaknessProfile(parameters.weakLearnerId);
  const weakSignals = gatherWeakSignals({
    profile, weakAreas: parameters.weakAreas,
  });
  if (!weakSignals.length) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "study_tips",
      message: `Refused: no weakness data for learner ${parameters.weakLearnerId}`,
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.WARNING,
    });
    throw new Error("missing_weakness_data");
  }

  const systemPrompt = promptModule.SYSTEM;
  const userMessage = promptModule.buildUserMessage({
    curriculumReader, weakSignals, parameters,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let raw = null;
  let modelUsed;
  if (apiKey) {
    try {
      const maxTokens = Math.min(4000,
          1200 + parameters.maxTips * 150 +
          (parameters.includeRevisionPlan ? parameters.planDurationDays * 80 : 0));
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
    raw = buildStructuredStub({curriculumReader, weakSignals, parameters});
    modelUsed = "stub";
  }
  if (!raw) {
    throw new Error("no_tips_after_stub");
  }

  // Stamp + filter every piece.
  const fallbackTopic = curriculumReader.topic;
  const tips = (Array.isArray(raw.tips) ? raw.tips : [])
      .map((t) => stampTip(t, fallbackTopic))
      .filter((t) => t !== null)
      .slice(0, parameters.maxTips);

  // If filtering wiped out the LLM output, fall back to the stub so
  // we never end up with zero tips after running real-weakness-data
  // gates upstream.
  let usedTips = tips;
  if (!usedTips.length) {
    const fallback = buildStructuredStub({curriculumReader, weakSignals, parameters});
    if (fallback) {
      usedTips = (fallback.tips || [])
          .map((t) => stampTip(t, fallbackTopic))
          .filter((t) => t !== null)
          .slice(0, parameters.maxTips);
      modelUsed = "stub_after_filter";
    }
  }
  if (!usedTips.length) {
    throw new Error("no_valid_tips_after_filter");
  }

  const recommendedNotes = (Array.isArray(raw.recommendedNotes) ?
    raw.recommendedNotes : [])
      .map((s) => trimString(s, 300))
      .filter(Boolean)
      .slice(0, 10);

  const recommendedQuizzes = (Array.isArray(raw.recommendedQuizzes) ?
    raw.recommendedQuizzes : [])
      .map((q) => stampRecommendedQuiz(q, fallbackTopic))
      .filter((q) => q !== null)
      .slice(0, 6);

  let revisionPlan = parameters.includeRevisionPlan ?
    (Array.isArray(raw.revisionPlan) ? raw.revisionPlan : [])
        .map(stampRevisionDay)
        .filter((d) => d !== null)
        .sort((a, b) => a.day - b.day)
        .slice(0, parameters.planDurationDays) : [];
  if (parameters.includeRevisionPlan && !revisionPlan.length) {
    revisionPlan = buildDefaultRevisionPlan(
        weakSignals, parameters.planDurationDays, curriculumReader.topic);
  }

  const content = {
    title: trimString(raw.title, 200) ||
      `Your ${curriculumReader.subject || "study"} plan — ${curriculumReader.topic}`,
    feedback: trimString(raw.feedback, 800) ||
      `Your practice shows ${weakSignals.length} area${weakSignals.length === 1 ? "" : "s"} to ` +
      `strengthen. Follow the tips below and you will see progress.`,
    tips: usedTips,
    recommendedNotes,
    recommendedQuizzes,
    revisionPlan,
    weakSignalsUsed: weakSignals,
    grade: String(curriculumReader.grade || ""),
    subject: String(curriculumReader.subject || ""),
    term: curriculumReader.term ?? null,
    topic: String(curriculumReader.topic || ""),
    subtopic: curriculumReader.subtopic ?? null,
    learnerId: parameters.weakLearnerId,
    modelUsed: String(modelUsed || "unknown").slice(0, 80),
    parametersUsed: parameters,
  };

  return {content, modelUsed};
}

const runStudyTips = makeRunner({
  agentId: AGENT_ID,
  artifactType: "study_tips",
  runLive,
});

module.exports = {
  runStudyTips,
  // Pure helpers exported for unit tests.
  normaliseParameters,
  gatherWeakSignals,
  stampTip,
  stampRecommendedQuiz,
  stampRevisionDay,
  looksGeneric,
  buildStructuredStub,
  buildDefaultRevisionPlan,
  loadWeaknessProfile,
  DEFAULT_PARAMETERS,
  AGENT_ID,
  VERB_HEAD,
};
