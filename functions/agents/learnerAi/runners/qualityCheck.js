/**
 * Quality Check Agent — v3.
 *
 * The "is this content safe to show a learner" gate. Runs AFTER the
 * Zambian Curriculum & Exam Standards Check Agent (which verifies
 * alignment) and is the LAST agent in the chain before admin review.
 * Reads the latest aiGeneratedContent doc for the task and runs a
 * comprehensive multi-axis quality check, writing a structured
 * verdict onto aiGeneratedContent.qualityCheck.
 *
 * Verdict shape pinned by `qualityCheckVerdictSchema` in
 * src/schemas/learnerAi.js. Status, confidence, issues[],
 * fixedSuggestions[], requiresHumanReview.
 *
 * Three layers of checking:
 *   1. Deterministic grounding pass — NON-NEGOTIABLE. Every claim
 *      must reference a citedExcerpts index that exists. This is the
 *      original Quality Check from PR #532; this rewrite expands the
 *      surface but never relaxes the grounding rule.
 *   2. Per-artifact-type structural checks — quiz options, exam paper
 *      sections, notes simplicity, study-tips usefulness, etc.
 *      Documented per axis in the helper JSDoc below.
 *   3. LLM nuance pass (Haiku 4.5) — out of scope for this PR; the
 *      runner is architected to consult it for the `spelling_grammar`
 *      + `ambiguity` axes once the prompt is reviewed. Deterministic
 *      blockers always win.
 *
 * Hard rules baked in:
 *   - exam_quiz artifacts ALWAYS set requiresHumanReview:true.
 *   - status 'failed' (critical issue OR confidence < 0.5) blocks
 *     auto-publish — the dispatcher's auto-publish gate checks
 *     task.status which is independently pinned to PASSED_QUALITY_CHECK
 *     before that path opens. This agent's status is the source of
 *     truth for that.
 *   - Reports back to the AI Supervisor via aiSupervisorLogs.
 *
 * Pure helpers are exported for unit tests + future agents that need
 * to reproduce the same check logic locally.
 */

const admin = require("firebase-admin");
const {
  writeAgentLog, writeSupervisorLog, updateLiveAgentState, writeTaskStep,
} = require("../logger");
const {COLLECTIONS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");

const AGENT_ID = "Quality Check Agent";

// Quiz artifact types — drive which structural checks fire.
const QUIZ_ARTIFACT_TYPES = new Set([
  "practice_quiz", "exam_quiz",
]);

// Generic-tip phrases — flagged in study-tips checks. Real LLM nuance
// pass will replace this; for now this catches the worst LLM cliches.
const GENERIC_TIP_PATTERNS = [
  /\bstudy hard\b/i, /\bpractice more\b/i, /\bdo your best\b/i,
  /\bwork hard\b/i, /\btry your best\b/i, /\bbelieve in yourself\b/i,
  /\bjust focus\b/i, /\bnever give up\b/i,
];

// Ambiguity markers — flag questions whose stem hedges without
// precision (e.g. "usually", "sometimes", "maybe"). Heuristic only.
const AMBIGUITY_PATTERNS = [
  /\busually\b/i, /\bsometimes\b/i, /\bmaybe\b/i, /\bpossibly\b/i,
  /\bgenerally\b/i, /\boften\b/i,
];

// ── Universal helpers ───────────────────────────────────────────────

function collectGroundingIndices(content) {
  const out = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === "groundingIndex" && Number.isInteger(v)) out.add(v);
      if (k === "groundingIndices" && Array.isArray(v)) {
        v.forEach((i) => Number.isInteger(i) && out.add(i));
      }
      if (typeof v === "object") visit(v);
    }
  };
  visit(content);
  return [...out];
}

function gatherQuestions(content) {
  if (!content) return [];
  if (Array.isArray(content.questions)) return content.questions;
  if (Array.isArray(content.sections)) {
    return content.sections.flatMap((sec) =>
      Array.isArray(sec.questions) ? sec.questions : []);
  }
  return [];
}

function asString(v) {
  return typeof v === "string" ? v : "";
}

// ── Per-axis checks (return {axis, issue?} — caller assembles list) ──

/**
 * Deterministic grounding pass. Every cited groundingIndex must point
 * to a valid excerpt. Failure = critical issue.
 *
 * Scoped to artifact types that stamp groundingIndex on every
 * generated item — practice_quiz, exam_quiz. Notes / study_tips /
 * learner_feedback don't yet carry per-paragraph groundingIndex
 * pointers (their generators emit prose), so the grounding axis
 * yields `pass` for them. The topic_match + standardsCheck agent
 * verdicts cover the alignment leg for those artifact types.
 */
function deterministicGroundingCheck({content, curriculumReference, artifactType}) {
  const excerpts = (curriculumReference &&
    curriculumReference.inMemory &&
    curriculumReference.inMemory.citedExcerpts) || [];
  if (content && content.stub === true) {
    return {ok: true, issue: null};
  }
  if (artifactType && !QUIZ_ARTIFACT_TYPES.has(artifactType)) {
    return {ok: true, issue: null};
  }
  const indices = collectGroundingIndices(content);
  if (!indices.length) {
    return {
      ok: false,
      issue: {
        axis: "grounding", severity: "critical",
        message: "No groundingIndex pointers found — content is not grounded in cited excerpts.",
      },
    };
  }
  const oor = indices.filter((i) => i < 0 || i >= excerpts.length);
  if (oor.length) {
    return {
      ok: false,
      issue: {
        axis: "grounding", severity: "critical",
        message: `${oor.length} groundingIndex pointer(s) reference excerpts that do not exist (out-of-range: ${oor.slice(0, 5).join(",")}).`,
      },
    };
  }
  return {ok: true, issue: null};
}

/** Required-fields existence check per artifact type. */
function checkRequiredFields({content, artifactType}) {
  if (!content || typeof content !== "object") {
    return {issue: {axis: "required_fields", severity: "critical",
      message: "Artifact content is missing or not an object."}};
  }
  if (artifactType === "practice_quiz" || artifactType === "exam_quiz") {
    const qs = gatherQuestions(content);
    if (!qs.length) {
      return {issue: {axis: "required_fields", severity: "critical",
        message: "Quiz artifact has zero questions."}};
    }
  }
  if (artifactType === "notes" && !asString(content.body) && !asString(content.notes) && !Array.isArray(content.sections)) {
    return {issue: {axis: "required_fields", severity: "critical",
      message: "Notes artifact has no body / notes / sections field."}};
  }
  if (artifactType === "study_tips" && !Array.isArray(content.tips)) {
    return {issue: {axis: "required_fields", severity: "critical",
      message: "Study-tips artifact must carry a tips[] array."}};
  }
  if (artifactType === "learner_feedback" && !asString(content.message) && !asString(content.feedback)) {
    return {issue: {axis: "required_fields", severity: "minor",
      message: "Feedback artifact has no message / feedback field."}};
  }
  return {issue: null};
}

/**
 * Completeness — flags content that ends mid-sentence (no terminal
 * punctuation on the last visible string field). Heuristic.
 */
function checkCompleteness({content, artifactType}) {
  const visible = [];
  if (artifactType === "notes") {
    visible.push(asString(content && content.body));
    visible.push(asString(content && content.notes));
  } else if (artifactType === "study_tips") {
    visible.push(...((content && content.tips) || []).map(asString));
  } else if (artifactType === "learner_feedback") {
    visible.push(asString(content && content.message));
    visible.push(asString(content && content.feedback));
  }
  for (const s of visible) {
    if (!s) continue;
    const trimmed = s.trim();
    if (trimmed.length < 20) continue;
    const last = trimmed.slice(-1);
    if (!/[.!?]/.test(last)) {
      return {issue: {axis: "completeness", severity: "minor",
        message: "Content appears truncated mid-sentence (no terminal punctuation)."}};
    }
  }
  return {issue: null};
}

/**
 * Spelling + grammar — heuristic deterministic checks only. Catches
 * repeated-character spam ("aaaa"), all-caps shouting, and obvious
 * doubled words ("the the"). Real spelling check requires the LLM
 * nuance pass.
 */
function checkSpellingGrammar({content}) {
  const sources = [];
  for (const q of gatherQuestions(content)) {
    sources.push(asString(q.prompt));
    sources.push(asString(q.questionText));
    sources.push(asString(q.explanation));
  }
  sources.push(asString(content && content.body));
  sources.push(asString(content && content.notes));
  for (const tip of (content && content.tips) || []) sources.push(asString(tip));

  const repeatedChar = /([a-z])\1{4,}/i;     // 5+ repeated chars
  const doubledWord = /\b(\w+)\s+\1\b/i;
  const screamingCaps = /\b[A-Z]{8,}\b/;

  for (const s of sources) {
    if (!s) continue;
    if (repeatedChar.test(s)) {
      return {issue: {axis: "spelling_grammar", severity: "minor",
        message: "Content contains repeated-character spam (e.g. 'aaaaa')."}};
    }
    if (doubledWord.test(s)) {
      return {issue: {axis: "spelling_grammar", severity: "minor",
        message: "Content contains a doubled word (e.g. 'the the')."}};
    }
    if (screamingCaps.test(s)) {
      return {issue: {axis: "spelling_grammar", severity: "minor",
        message: "Content uses all-caps shouting."}};
    }
  }
  return {issue: null};
}

function checkTopicMatch({content, curriculumReader}) {
  if (!curriculumReader || !curriculumReader.topic) {
    return {issue: null};
  }
  const topic = curriculumReader.topic.toLowerCase();
  const sources = [];
  for (const q of gatherQuestions(content)) sources.push(asString(q.prompt) + " " + asString(q.questionText) + " " + asString(q.explanation));
  sources.push(asString(content && content.body));
  sources.push(asString(content && content.notes));
  for (const tip of (content && content.tips) || []) sources.push(asString(tip));
  const haystack = sources.join(" ").toLowerCase();
  if (!haystack || haystack.includes(topic) ||
      // also accept any of the keyConcepts as evidence the artifact
      // genuinely covers the topic
      ((curriculumReader.keyConcepts || []).some((c) =>
        c && haystack.includes(c.toLowerCase())))) {
    return {issue: null};
  }
  return {issue: {axis: "topic_match", severity: "minor",
    message: `Artifact does not visibly reference topic "${curriculumReader.topic}" or its key concepts.`}};
}

function checkGradeSuitability({content, curriculumReader}) {
  const grade = parseInt(String(curriculumReader && curriculumReader.grade || "")
      .replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(grade) || grade > 4) return {issue: null};
  // Lower-primary: flag ≥3 words over 14 characters.
  let longCount = 0;
  for (const q of gatherQuestions(content)) {
    const text = asString(q.prompt) + " " + asString(q.questionText) + " " + asString(q.explanation);
    longCount += text.split(/\s+/).filter((w) =>
      w.replace(/[^A-Za-z]/g, "").length > 14).length;
  }
  if (longCount >= 3) {
    return {issue: {axis: "grade_suitability", severity: "minor",
      message: `${longCount} words exceed 14 letters — vocabulary likely too advanced for Grade ${grade}.`}};
  }
  return {issue: null};
}

function checkDifficultyConsistency({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  const qs = gatherQuestions(content);
  if (!qs.length) return {issue: null};
  // Heuristic: an "easy" MCQ should be answerable from a single
  // excerpt; a "hard" question typically references multiple concepts.
  // We catch the inverse: a question declared "easy" with marks > 3
  // or a question declared "hard" with marks <= 1.
  for (const q of qs) {
    if (!q.marks || !q.difficulty) continue;
    if (q.difficulty === "easy" && q.marks > 3) {
      return {issue: {axis: "difficulty_consistency", severity: "minor",
        message: `Question marked "easy" carries ${q.marks} marks (>3) — difficulty/marks mismatch.`}};
    }
    if (q.difficulty === "hard" && q.marks < 2) {
      return {issue: {axis: "difficulty_consistency", severity: "minor",
        message: `Question marked "hard" carries only ${q.marks} mark — difficulty/marks mismatch.`}};
    }
  }
  return {issue: null};
}

function checkDiagramRequired({content, artifactType}) {
  if (artifactType === "study_tips" || artifactType === "learner_feedback") {
    return {issue: null};
  }
  const sources = [];
  for (const q of gatherQuestions(content)) sources.push(asString(q.prompt) + " " + asString(q.questionText));
  sources.push(asString(content && content.body));
  sources.push(asString(content && content.notes));
  const text = sources.join(" ");
  if (/\b(figure|diagram|chart|graph|map)\s+(below|above|shown|on the right|on the left)\b/i.test(text) ||
      /\bsee (figure|diagram|chart|graph|map)\b/i.test(text)) {
    return {issue: {axis: "diagram_required", severity: "minor",
      message: "Content references a figure/diagram but no image is attached. Either supply the diagram or rewrite to be self-contained."}};
  }
  return {issue: null};
}

function checkAmbiguity({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  let flagged = 0;
  for (const q of gatherQuestions(content)) {
    const text = asString(q.prompt) || asString(q.questionText);
    if (AMBIGUITY_PATTERNS.some((re) => re.test(text))) flagged += 1;
  }
  if (flagged >= 2) {
    return {issue: {axis: "ambiguity", severity: "minor",
      message: `${flagged} question(s) use hedging language (usually/sometimes/maybe) without precision.`}};
  }
  return {issue: null};
}

// ── Quiz-specific checks (MCQ-focused) ──────────────────────────────

function checkCorrectAnswerExists({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  const qs = gatherQuestions(content);
  let missing = 0;
  for (const q of qs) {
    if (q.questionType === "matching") continue; // matchingPairs encodes answer
    if (q.questionType === "structured") continue; // structuredParts encode answer
    if (!asString(q.correctAnswer).trim()) missing += 1;
  }
  if (missing > 0) {
    return {issue: {axis: "correct_answer_exists", severity: "critical",
      message: `${missing} question(s) have no correctAnswer string.`}};
  }
  return {issue: null};
}

function checkCorrectAnswerInOptions({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  let mismatched = 0;
  for (const q of gatherQuestions(content)) {
    if (q.questionType !== "mcq") continue;
    const opts = Array.isArray(q.options) ?
      q.options.map((o) => asString(o).trim().toLowerCase()) : [];
    const ans = asString(q.correctAnswer).trim().toLowerCase();
    if (opts.length && ans && !opts.includes(ans)) mismatched += 1;
  }
  if (mismatched > 0) {
    return {issue: {axis: "correct_answer_in_options", severity: "critical",
      message: `${mismatched} MCQ(s) have a correctAnswer that does not match any option.`}};
  }
  return {issue: null};
}

function checkDuplicateOptions({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  let dup = 0;
  for (const q of gatherQuestions(content)) {
    if (q.questionType !== "mcq") continue;
    const opts = (q.options || []).map((o) => asString(o).trim().toLowerCase());
    if (new Set(opts).size !== opts.length) dup += 1;
  }
  if (dup > 0) {
    return {issue: {axis: "duplicate_options", severity: "critical",
      message: `${dup} MCQ(s) carry duplicate option text.`}};
  }
  return {issue: null};
}

function checkOptionsTooSimilar({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  let flagged = 0;
  for (const q of gatherQuestions(content)) {
    if (q.questionType !== "mcq") continue;
    const opts = (q.options || []).map((o) => asString(o).trim().toLowerCase());
    if (opts.length < 2) continue;
    // Heuristic: any two options share their first 6 characters AND
    // the same length range (within 2 chars) → flag.
    for (let i = 0; i < opts.length; i++) {
      for (let j = i + 1; j < opts.length; j++) {
        const a = opts[i]; const b = opts[j];
        if (a.length < 4 || b.length < 4) continue;
        if (a.slice(0, 6) === b.slice(0, 6) &&
            Math.abs(a.length - b.length) <= 2) {
          flagged += 1;
          break;
        }
      }
      if (flagged) break;
    }
  }
  if (flagged > 0) {
    return {issue: {axis: "options_too_similar", severity: "minor",
      message: `${flagged} MCQ(s) have option pairs that are confusingly similar.`}};
  }
  return {issue: null};
}

function checkSingleCorrectAnswer({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  let multi = 0;
  for (const q of gatherQuestions(content)) {
    if (q.questionType !== "mcq") continue;
    const opts = (q.options || []).map((o) => asString(o).trim().toLowerCase());
    const ans = asString(q.correctAnswer).trim().toLowerCase();
    if (!ans) continue;
    const matches = opts.filter((o) => o === ans).length;
    if (matches > 1) multi += 1;
  }
  if (multi > 0) {
    return {issue: {axis: "single_correct_answer", severity: "critical",
      message: `${multi} MCQ(s) have the correct answer matching multiple options.`}};
  }
  return {issue: null};
}

function checkExplanationMatchesAnswer({content, artifactType}) {
  if (!QUIZ_ARTIFACT_TYPES.has(artifactType)) return {issue: null};
  let mismatched = 0;
  for (const q of gatherQuestions(content)) {
    if (q.questionType !== "mcq") continue;
    const ans = asString(q.correctAnswer).trim().toLowerCase();
    const exp = asString(q.explanation).toLowerCase();
    if (!exp || !ans || ans.length < 2) continue;
    // For short answers (<= 30 chars) require literal substring; for
    // longer the explanation may paraphrase — skip the check.
    if (ans.length <= 30 && !exp.includes(ans)) mismatched += 1;
  }
  if (mismatched > 0) {
    return {issue: {axis: "explanation_matches_answer", severity: "minor",
      message: `${mismatched} explanation(s) do not reference the correct answer text.`}};
  }
  return {issue: null};
}

// ── Exam-specific checks ────────────────────────────────────────────

function checkMarksAllocation({content, artifactType}) {
  if (artifactType !== "exam_quiz") return {issue: null};
  const sections = (content && content.sections) || [];
  for (const sec of sections) {
    const qs = Array.isArray(sec.questions) ? sec.questions : [];
    const sumQ = qs.reduce((acc, q) => acc + (Number.isInteger(q.marks) ? q.marks : 0), 0);
    if (Number.isInteger(sec.marks) && sumQ > 0 && sec.marks !== sumQ) {
      return {issue: {axis: "marks_allocation", severity: "minor",
        message: `Section ${sec.id} declares ${sec.marks} marks but questions sum to ${sumQ}.`}};
    }
  }
  return {issue: null};
}

function checkSectionsPresent({content, artifactType}) {
  if (artifactType !== "exam_quiz") return {issue: null};
  const sections = (content && content.sections) || [];
  const ids = new Set(sections.map((s) => s.id));
  if (ids.has("A") && ids.has("B")) return {issue: null};
  return {issue: {axis: "sections_present", severity: "critical",
    message: `Exam papers must include Sections A and B at minimum. Found: [${[...ids].join(",")}].`}};
}

function checkAnswerKeyComplete({content, artifactType}) {
  if (artifactType !== "exam_quiz") return {issue: null};
  const sections = (content && content.sections) || [];
  const key = (content && content.answerKey) || [];
  const totalQ = sections.reduce((acc, s) =>
    acc + (Array.isArray(s.questions) ? s.questions.length : 0), 0);
  if (totalQ === 0) return {issue: null};
  if (key.length < totalQ) {
    return {issue: {axis: "answer_key_complete", severity: "critical",
      message: `Answer key has ${key.length} entries but paper has ${totalQ} questions.`}};
  }
  return {issue: null};
}

function checkMarkingGuidePresent({content, artifactType}) {
  if (artifactType !== "exam_quiz") return {issue: null};
  const guide = asString(content && content.markingGuide).trim();
  if (!guide || guide.length < 40) {
    return {issue: {axis: "marking_guide_present", severity: "minor",
      message: "Exam paper is missing a marking guide (or guide is too short)."}};
  }
  return {issue: null};
}

// ── Notes-specific checks ───────────────────────────────────────────

function checkNotesSimple({content, artifactType}) {
  if (artifactType !== "notes") return {issue: null};
  const body = asString(content && content.body) ||
    asString(content && content.notes);
  if (!body) return {issue: null};
  // Heuristic: average sentence length > 30 words → "not simple".
  const sentences = body.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) return {issue: null};
  const totalWords = sentences.reduce((acc, s) => acc + s.split(/\s+/).length, 0);
  const avg = totalWords / sentences.length;
  if (avg > 30) {
    return {issue: {axis: "notes_simple", severity: "minor",
      message: `Notes have average sentence length ${avg.toFixed(1)} words — too long for learners. Aim for ≤ 20 words.`}};
  }
  return {issue: null};
}

function checkNotesLength({content, artifactType, curriculumReader}) {
  if (artifactType !== "notes") return {issue: null};
  const grade = parseInt(String(curriculumReader && curriculumReader.grade || "")
      .replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(grade)) return {issue: null};
  const body = asString(content && content.body) ||
    asString(content && content.notes);
  const words = body ? body.split(/\s+/).length : 0;
  // Lower-primary: ≤ 300 words. Upper-primary: ≤ 600. Secondary: ≤ 1200.
  const cap = grade <= 4 ? 300 : grade <= 7 ? 600 : 1200;
  if (words > cap) {
    return {issue: {axis: "notes_length", severity: "minor",
      message: `Notes are ${words} words — exceeds ${cap}-word cap for Grade ${grade}.`}};
  }
  return {issue: null};
}

function checkNotesMatchTopic({content, artifactType, curriculumReader}) {
  if (artifactType !== "notes") return {issue: null};
  if (!curriculumReader || !curriculumReader.topic) return {issue: null};
  const body = (asString(content && content.body) ||
    asString(content && content.notes)).toLowerCase();
  if (!body) return {issue: null};
  if (body.includes(curriculumReader.topic.toLowerCase())) return {issue: null};
  const matchesConcept = (curriculumReader.keyConcepts || [])
      .some((c) => c && body.includes(c.toLowerCase()));
  if (matchesConcept) return {issue: null};
  return {issue: {axis: "notes_match_topic", severity: "critical",
    message: `Notes do not mention the topic "${curriculumReader.topic}" or any key concept.`}};
}

// ── Study-tips-specific checks ──────────────────────────────────────

function checkTipsUseful({content, artifactType}) {
  if (artifactType !== "study_tips") return {issue: null};
  const tips = Array.isArray(content && content.tips) ? content.tips : [];
  if (!tips.length) return {issue: null};
  const generic = tips.filter((t) => {
    const s = asString(t);
    return s && GENERIC_TIP_PATTERNS.some((re) => re.test(s));
  });
  if (generic.length >= Math.max(1, Math.floor(tips.length * 0.3))) {
    return {issue: {axis: "tips_useful", severity: "minor",
      message: `${generic.length}/${tips.length} tips are generic ("study hard", "practice more", etc.). Make tips specific to the topic.`}};
  }
  return {issue: null};
}

function checkTipsActionable({content, artifactType}) {
  if (artifactType !== "study_tips") return {issue: null};
  const tips = Array.isArray(content && content.tips) ? content.tips : [];
  if (!tips.length) return {issue: null};
  // Heuristic: actionable tips usually start with an imperative verb.
  // Flag tips that read like declarative statements without a verb.
  const VERB_HEAD = /^(write|practice|draw|read|review|underline|count|solve|measure|memorise|memorize|repeat|try|use|spell|copy|circle|tick|check|list|name|describe|identify|complete|fill|colour|color|trace)\b/i;
  const nonActionable = tips.filter((t) => {
    const s = asString(t).trim();
    return s && !VERB_HEAD.test(s);
  });
  if (nonActionable.length >= Math.max(1, Math.floor(tips.length * 0.5))) {
    return {issue: {axis: "tips_actionable", severity: "minor",
      message: `${nonActionable.length}/${tips.length} tips do not start with an actionable verb. Prefer "Practice…", "Draw…", "Write…".`}};
  }
  return {issue: null};
}

// ── Verdict assembly ────────────────────────────────────────────────

const RECOMMENDATIONS_BY_AXIS = Object.freeze({
  required_fields: "Ensure the artifact carries the required fields for its type before publishing.",
  completeness: "Continue the truncated sentence so the content reads as a complete thought.",
  spelling_grammar: "Run the artifact through a spell/grammar checker; remove all-caps, doubled words, and repeated-character spam.",
  topic_match: "Mention the curriculum topic (or one of its key concepts) explicitly in the content.",
  grade_suitability: "Shorten long words to ≤14 letters for lower-primary learners.",
  difficulty_consistency: "Align declared difficulty with marks: easy ≤3 marks, hard ≥2 marks.",
  diagram_required: "Either attach the referenced diagram/figure or rewrite the prompt to stand alone.",
  grounding: "Every claim must cite a valid index into curriculumReader.citedExcerpts.",
  ambiguity: "Replace hedging language (usually/sometimes/maybe) with precise quantities or rephrase to be unambiguous.",
  correct_answer_exists: "Set the correctAnswer field on every quiz question.",
  correct_answer_in_options: "Ensure each MCQ's correctAnswer string matches one of its options verbatim.",
  duplicate_options: "Remove duplicate option text; MCQs need 4 distinct options.",
  options_too_similar: "Rewrite confusingly similar options so distractors are clearly distinct.",
  single_correct_answer: "Make exactly one MCQ option match the correctAnswer.",
  explanation_matches_answer: "Reference the correctAnswer text inside the explanation so learners can self-verify.",
  marks_allocation: "Make section.marks equal the sum of its questions' marks.",
  sections_present: "Add Sections A (MCQ) and B (Short Answer) to every exam paper.",
  answer_key_complete: "Add an answerKey entry for every question in the paper.",
  marking_guide_present: "Write a marking guide narrative (≥40 chars) covering partial-credit and rubric policy.",
  notes_simple: "Split long sentences; target ≤20 words per sentence for learners.",
  notes_length: "Trim notes to the per-grade cap (300/600/1200 words for lower-primary/upper-primary/secondary).",
  notes_match_topic: "Mention the curriculum topic or at least one keyConcept inside the notes body.",
  tips_useful: "Replace generic tips ('study hard', 'practice more') with topic-specific actionable advice.",
  tips_actionable: "Start each tip with an imperative verb (Practice…, Draw…, Write…, Solve…).",
})

function computeConfidence(issues) {
  let score = 1.0;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 0.15;
    else if (issue.severity === "minor") score -= 0.05;
  }
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return Math.round(score * 10000) / 10000;
}

function decideStatus({issues, confidence}) {
  const hasCritical = issues.some((i) => i.severity === "critical");
  if (hasCritical || confidence < 0.5) return "failed";
  if (confidence < 0.8 || issues.length > 0) return "needs_review";
  return "passed";
}

function decideHumanReview({artifactType, status, confidence}) {
  // Rule: exam quizzes ALWAYS require admin review.
  if (artifactType === "exam_quiz") return true;
  if (status !== "passed") return true;
  if (confidence < 0.8) return true;
  return false;
}

/**
 * Pure verdict builder — exposed for unit tests. Runs every per-axis
 * check, decides status + confidence + requires-human-review, and
 * returns the verdict partial (minus contentId + checkedAt which the
 * runner stamps last).
 *
 * @param {object} args
 * @param {string} args.artifactType
 * @param {object} args.content
 * @param {object|null} [args.curriculumReader]
 * @param {object|null} [args.curriculumReference]  slim {persist, inMemory}
 * @returns {object}                                 partial QualityCheckVerdict
 */
function buildVerdict({artifactType, content, curriculumReader, curriculumReference}) {
  const det = deterministicGroundingCheck({content, curriculumReference, artifactType});

  const checks = [
    det,
    checkRequiredFields({content, artifactType}),
    checkCompleteness({content, artifactType}),
    checkSpellingGrammar({content}),
    checkTopicMatch({content, curriculumReader}),
    checkGradeSuitability({content, curriculumReader}),
    checkDifficultyConsistency({content, artifactType}),
    checkDiagramRequired({content, artifactType}),
    checkAmbiguity({content, artifactType}),
    checkCorrectAnswerExists({content, artifactType}),
    checkCorrectAnswerInOptions({content, artifactType}),
    checkDuplicateOptions({content, artifactType}),
    checkOptionsTooSimilar({content, artifactType}),
    checkSingleCorrectAnswer({content, artifactType}),
    checkExplanationMatchesAnswer({content, artifactType}),
    checkMarksAllocation({content, artifactType}),
    checkSectionsPresent({content, artifactType}),
    checkAnswerKeyComplete({content, artifactType}),
    checkMarkingGuidePresent({content, artifactType}),
    checkNotesSimple({content, artifactType}),
    checkNotesLength({content, artifactType, curriculumReader}),
    checkNotesMatchTopic({content, artifactType, curriculumReader}),
    checkTipsUseful({content, artifactType}),
    checkTipsActionable({content, artifactType}),
  ];

  const issues = [];
  for (const r of checks) {
    if (r && r.issue) issues.push(r.issue);
  }

  const confidence = computeConfidence(issues);
  const status = decideStatus({issues, confidence});
  const requiresHumanReview = decideHumanReview({artifactType, status, confidence});

  const fixedSuggestions = [];
  for (const issue of issues) {
    const r = RECOMMENDATIONS_BY_AXIS[issue.axis];
    if (r && !fixedSuggestions.includes(r)) fixedSuggestions.push(r);
    if (fixedSuggestions.length >= 60) break;
  }

  const verifierVerdict = content && content.stub === true ?
    "stub_no_llm_yet" : (status === "passed" ? "pass" : "fail");

  return {
    status,
    confidenceScore: confidence,
    issues: issues.slice(0, 60),
    fixedSuggestions,
    requiresHumanReview,
    modelUsed: "deterministic",
    artifactType,
    verifierVerdict,
    deterministicGroundingPass: det.ok,
  };
}

// ── Firestore resolution + runner ───────────────────────────────────

async function findLatestContent({task}) {
  const db = admin.firestore();
  if (task && task.resultContentId) {
    try {
      const snap = await db.collection(COLLECTIONS.CONTENT)
          .doc(task.resultContentId).get();
      if (snap.exists) return {ref: snap.ref, data: snap.data() || {}};
    } catch (err) {
      console.warn("[qualityCheck] doc-by-id lookup failed", err && err.message);
    }
  }
  try {
    const snap = await db.collection(COLLECTIONS.CONTENT)
        .where("grade", "==", String(task.grade || ""))
        .where("subject", "==", String(task.subject || ""))
        .where("topic", "==", String(task.topic || ""))
        .get();
    if (snap.empty) return null;
    const docs = [...snap.docs];
    docs.sort((a, b) => {
      const at = a.data().createdAt && a.data().createdAt.toMillis ?
        a.data().createdAt.toMillis() : 0;
      const bt = b.data().createdAt && b.data().createdAt.toMillis ?
        b.data().createdAt.toMillis() : 0;
      return bt - at;
    });
    return {ref: docs[0].ref, data: docs[0].data() || {}};
  } catch (err) {
    console.warn("[qualityCheck] broad lookup failed", err && err.message);
    return null;
  }
}

async function runQualityCheck({task, chainContext = {}, stepNumber = 5}) {
  const curriculumReference = chainContext.curriculumReference;
  if (!curriculumReference) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "quality_check",
      message: "Refused: missing curriculumReference",
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.WARNING,
    });
    return {ok: false, reason: "missing_curriculum_ref"};
  }

  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID, status: "checking", currentTaskId: task.id,
    currentTask: "Quality check", progress: 25,
    grade: task.grade, subject: task.subject, term: task.term,
    topic: task.topic, subtopic: task.subtopic,
    lastMessage: "Running deterministic + structural checks",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Quality check",
    message: "Multi-axis quality + safety verification",
    status: TASK_STEP_STATUS.RUNNING, progress: 50,
  });

  const target = await findLatestContent({task});
  if (!target) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "quality_check",
      message: "No aiGeneratedContent found for this task",
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.ERROR,
    });
    return {ok: false, reason: "no_artifact_found"};
  }

  const verdictBase = buildVerdict({
    artifactType: target.data.type || task.taskType,
    content: target.data.content || {},
    curriculumReader: chainContext.curriculumReader || null,
    curriculumReference,
  });

  const verdict = {
    ...verdictBase,
    contentId: target.ref.id,
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Write the verdict onto the artifact. Existing
  // zambianStandardsCheck block (set by the Standards Check agent) is
  // preserved via merge:true.
  await target.ref.set({
    qualityCheck: verdict,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  // Report to the AI Supervisor.
  const supervisorAction = verdict.status === "failed" ? "regenerate_required" :
    "sent_for_review";
  await writeSupervisorLog({
    taskId: task.id, agentName: "Quality Check Agent",
    contentType: verdict.artifactType,
    grade: task.grade || "", subject: task.subject || "", term: task.term || "",
    topic: task.topic || "", subtopic: task.subtopic || "",
    actionTaken: supervisorAction,
    reason: verdict.issues.length ?
      `${verdict.status}: ${verdict.issues.length} issue(s) [` +
      `${verdict.issues.slice(0, 3).map((i) => i.axis).join(",")}]` :
      `${verdict.status}: all checks passed`,
    confidenceScore: verdict.confidenceScore,
  });

  await writeAgentLog({
    taskId: task.id, agentName: AGENT_ID, action: "quality_check",
    message: `${verdict.status} (confidence=${verdict.confidenceScore.toFixed(2)}, ` +
      `issues=${verdict.issues.length}, ` +
      `requiresHumanReview=${verdict.requiresHumanReview})`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: verdict.status === "failed" ? SEVERITY.WARNING : SEVERITY.INFO,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Quality check",
    message: `${verdict.status}; ${verdict.issues.length} issue(s)`,
    status: verdict.status === "failed" ?
      TASK_STEP_STATUS.FAILED : TASK_STEP_STATUS.COMPLETED,
    progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: verdict.status === "failed" ? "failed" : "completed",
    currentTaskId: null, progress: 100,
    lastMessage: `${verdict.status} (${verdict.issues.length} issues)`,
  });

  // The dispatcher reads `verdict` to set
  // task.status = passed_quality_check | failed_quality_check
  // (per the existing TASK_STATUS branches). Maintain backward-compat
  // by returning the same shape v2 did.
  return {
    ok: verdict.status !== "failed",
    verdict: verdict.status === "passed" ? "pass" : "fail",
    contentId: target.ref.id,
    qualityCheckVerdict: {...verdictBase, contentId: target.ref.id},
  };
}

module.exports = {
  runQualityCheck,
  buildVerdict,
  computeConfidence,
  decideStatus,
  decideHumanReview,
  deterministicGroundingCheck,
  collectGroundingIndices,
  // Per-axis helpers
  checkRequiredFields, checkCompleteness, checkSpellingGrammar,
  checkTopicMatch, checkGradeSuitability, checkDifficultyConsistency,
  checkDiagramRequired, checkAmbiguity,
  checkCorrectAnswerExists, checkCorrectAnswerInOptions,
  checkDuplicateOptions, checkOptionsTooSimilar,
  checkSingleCorrectAnswer, checkExplanationMatchesAnswer,
  checkMarksAllocation, checkSectionsPresent, checkAnswerKeyComplete,
  checkMarkingGuidePresent,
  checkNotesSimple, checkNotesLength, checkNotesMatchTopic,
  checkTipsUseful, checkTipsActionable,
  AGENT_ID,
};
