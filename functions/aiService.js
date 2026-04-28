const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {anthropicFetch} = require("./anthropicFetch");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

const LIMITS = {
  message: 1600,
  context: 900,
  historyItems: 6,
  historyMessage: 600,
  question: 1200,
  answer: 700,
  subject: 80,
  grade: 20,
  topic: 120,
  quizCount: 10,
  importFileName: 180,
  importDocumentText: 26000,
  importLocalDraft: 12000,
};

function cleanString(value, maxLength = 600) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function cleanContext(context = {}) {
  const allowed = [
    "area",
    "path",
    "pageTitle",
    "subject",
    "grade",
    "topic",
    "lessonTitle",
    "quizTitle",
    "paperTitle",
    "role",
    "selectedText",
  ];
  const lengths = {
    selectedText: 500,
    pageTitle: 160,
    path: 160,
  };
  const cleaned = {};
  allowed.forEach((key) => {
    const value = cleanString(context[key], lengths[key] || 120);
    if (value) cleaned[key] = value;
  });
  return cleaned;
}

function getApiKey(openAiApiKey) {
  const apiKey = openAiApiKey.value() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "AI is not configured yet.",
    );
  }
  return apiKey;
}

function getAnthropicApiKey(anthropicApiKey) {
  const apiKey = anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "AI is not configured yet.",
    );
  }
  return apiKey;
}

async function getUserRole(uid) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  return snap.exists ? cleanString(snap.data()?.role, 30) : "learner";
}

function isStaffRole(role) {
  return role === "teacher" || role === "admin";
}

function cleanChatHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history.slice(-LIMITS.historyItems).map((item) => {
    const role = item?.role === "assistant" || item?.from === "assistant"
      ? "assistant"
      : "user";
    const content = cleanString(
      item?.content || item?.text || "",
      LIMITS.historyMessage,
    );
    return content ? {role, content} : null;
  }).filter(Boolean);
}

async function assertDailyLimit(uid, role, action) {
  const day = new Date().toISOString().slice(0, 10);
  const limit = isStaffRole(role) ? 150 : 60;
  const ref = admin.firestore().doc(`aiUsage/${uid}_${day}`);

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const total = Number(data.total || 0);
    if (total >= limit) {
      throw new HttpsError(
        "resource-exhausted",
        "Daily AI limit reached. Please try again tomorrow.",
      );
    }
    const actions = data.actions || {};
    tx.set(ref, {
      uid,
      day,
      total: total + 1,
      actions: {
        ...actions,
        [action]: Number(actions[action] || 0) + 1,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

async function callOpenAI(apiKey, {
  messages,
  maxTokens = 500,
  temperature = 0.3,
  json = false,
}) {
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(json && {response_format: {type: "json_object"}}),
      }),
    });
  } catch {
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("OpenAI assistant error", {
      status: res.status,
      message: body?.error?.message,
    });
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }

  const data = await res.json();
  return cleanString(data?.choices?.[0]?.message?.content, 4000);
}

// Strip markdown code fences (```json ... ```) that Claude sometimes emits
// around JSON responses. Leaves plain JSON untouched.
function stripJsonFences(raw) {
  if (!raw) return "";
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fence ? fence[1] : raw).trim();
}

async function callAnthropic(apiKey, {
  systemPrompt,
  messages,
  maxTokens = 800,
  temperature = 0.35,
  json = false,
}) {
  let res;
  try {
    res = await anthropicFetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        // System prompt as a cacheable block. Anthropic silently ignores
        // cache_control on blocks under the 1024-token minimum, so this is
        // always safe; large prompts (QUIZ_SYSTEM_PROMPT, etc.) get cached
        // for 5 min, cutting repeat-call latency and input token cost.
        ...(systemPrompt ? {
          system: [{
            type: "text",
            text: systemPrompt,
            cache_control: {type: "ephemeral"},
          }],
        } : {}),
        messages,
      }),
    }, {label: "aiService"});
  } catch {
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("Anthropic assistant error", {
      status: res.status,
      message: body?.error?.message,
      type: body?.error?.type,
    });
    if (res.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        "AI is busy right now. Please wait a moment and try again.",
      );
    }
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }

  const data = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((block) => block?.type === "text" && block?.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
  const cleaned = json ? stripJsonFences(text) : text;
  // Anthropic has no native JSON mode — if the model still wrapped output
  // in prose, try to extract the first JSON object as a last resort.
  if (json && cleaned && !cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) return cleanString(objMatch[0], 10000);
  }
  return cleanString(cleaned, 10000);
}

// Convert OpenAI-shaped messages ([{role:"system",...}, {role:"user",...}, ...])
// to Anthropic shape ({systemPrompt, messages}). Multiple system messages get
// joined. Messages array must start with a user turn.
function toAnthropicShape(openAiMessages = []) {
  const systemParts = [];
  const rest = [];
  for (const m of openAiMessages) {
    if (!m) continue;
    if (m.role === "system") {
      if (m.content) systemParts.push(String(m.content));
    } else if (m.role === "user" || m.role === "assistant") {
      rest.push({role: m.role, content: String(m.content || "")});
    }
  }
  // Drop any leading assistant messages (Anthropic requires user first).
  while (rest.length && rest[0].role !== "user") rest.shift();
  return {
    systemPrompt: systemParts.join("\n\n"),
    messages: rest,
  };
}

function educationSystemPrompt(role, context = {}) {
  const page = context.area ? ` Current page: ${context.area}.` : "";
  const staff = isStaffRole(role)
    ? [
        "For teachers and admins, give practical classroom ideas,",
        "quiz questions, lesson activities, marking support, and clear",
        "teaching steps when useful.",
      ].join(" ")
    : [
        "For learners, use simple English. Start with a short answer,",
        "then give an example. When solving, show steps and do not jump",
        "straight to the final answer.",
      ].join(" ");
  return [
    "You are Zed, the friendly, intelligent study assistant for ZedExams.",
    "Help with broad education-related questions for school learners and",
    "teachers. Supported areas include Mathematics, English, Science,",
    "Social Studies, Literacy, CTS, Religious Education, study skills,",
    "revision, quizzes, past papers, classroom activities, and general",
    "school topics such as democracy, verbs, fractions, and the respiratory",
    "system.",
    "Only refuse unsafe, harmful, or inappropriate requests. If a request",
    "is unrelated to education, gently redirect with:",
    "\"I can help with school subjects, lessons, quizzes, revision, and",
    "teaching support. Ask me any education-related question.\"",
    "When explaining a topic, use this structure when it fits: Definition,",
    "Brief explanation, Example. When solving a question, use numbered",
    "steps. When generating quizzes, include clear wording, answer choices,",
    "and correct answers.",
    "Use the page context, selected text, and recent chat history when they",
    "help. If the learner says 'this question' but no question text is",
    "available, ask them to paste or select the question. Do not invent facts;",
    "say when you are unsure.",
    page,
    staff,
  ].join(" ");
}

function buildChatMessages({message, context, role, history = []}) {
  const cleanedContext = cleanContext(context);
  const cleanedHistory = cleanChatHistory(history);
  return [
    {role: "system", content: educationSystemPrompt(role, cleanedContext)},
    ...cleanedHistory,
    {
      role: "user",
      content: [
        `Page context: ${JSON.stringify(cleanedContext)}`,
        `Student or staff message: ${message}`,
      ].join("\n"),
    },
  ];
}

// Anthropic expects `system` as a top-level param (not in messages[]),
// and the messages array must alternate user/assistant starting with user.
function buildAnthropicChat({
  message,
  context,
  role,
  history = [],
  customSystemPrompt,
}) {
  const cleanedContext = cleanContext(context);
  const cleanedHistory = cleanChatHistory(history);
  const systemPrompt = cleanString(
    customSystemPrompt,
    4000,
  ) || educationSystemPrompt(role, cleanedContext);

  // Anthropic requires messages to alternate user/assistant and start with
  // user. Our client history can violate this (two user turns in a row after
  // a failed retry, duplicate sends, etc.) — so coalesce consecutive same-
  // role messages into one combined turn, then drop any leading assistants.
  const coalesced = [];
  for (const m of cleanedHistory) {
    const last = coalesced[coalesced.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      coalesced.push({role: m.role, content: m.content});
    }
  }
  let trimmedHistory = coalesced;
  while (trimmedHistory.length && trimmedHistory[0].role !== "user") {
    trimmedHistory = trimmedHistory.slice(1);
  }

  const userContent = customSystemPrompt
    ? message
    : [
        `Page context: ${JSON.stringify(cleanedContext)}`,
        `Student or staff message: ${message}`,
      ].join("\n");

  // If the trimmed history ends with a user message, merge the new user
  // message into it rather than creating two consecutive user turns.
  const messages = [...trimmedHistory];
  const tail = messages[messages.length - 1];
  if (tail && tail.role === "user") {
    tail.content = `${tail.content}\n\n${userContent}`;
  } else {
    messages.push({role: "user", content: userContent});
  }
  return {systemPrompt, messages};
}

function buildExplainMessages(payload) {
  const subject = cleanString(payload.subject, LIMITS.subject);
  const grade = cleanString(payload.grade, LIMITS.grade);
  const topic = cleanString(payload.topic, LIMITS.topic);
  const context = [grade && `Grade ${grade}`, subject, topic]
    .filter(Boolean)
    .join(", ");
  return [
    {
      role: "system",
      content: [
        "You explain quiz answers for Zambian Grade 4 to 6 learners.",
        "Use kind, simple language. Keep it under 90 words.",
        "Explain the idea, why the correct answer works, and one memory tip.",
        "Do not shame the learner.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        context ? `Context: ${context}` : "",
        `Question: ${cleanString(payload.question, LIMITS.question)}`,
        `Learner answer: ${cleanString(payload.learnerAnswer, LIMITS.answer)}`,
        `Correct answer: ${cleanString(payload.correctAnswer, LIMITS.answer)}`,
      ].filter(Boolean).join("\n"),
    },
  ];
}

// Quiz generator — Zambian CBC-grounded prompt.
//
// Calls resolveCbcContext() upstream (in index.js) to get an authoritative
// <cbc_context> block for the {grade, subject, topic} triple. That block
// contains the official sub-topics, Specific Outcomes, Key Competencies and
// Values from the CDC syllabus. We inject it into the user prompt so Claude
// writes questions that are actually on-syllabus — no more off-topic trivia.
const QUIZ_SYSTEM_PROMPT = [
  "You are an expert Zambian teacher and CDC (Curriculum Development Centre)",
  "assessment writer. You write multiple-choice quiz questions that match the",
  "Zambian Competence-Based Curriculum (CBC) exactly as a Zambian School",
  "Inspector or head teacher would expect to see them.",
  "",
  "Your questions MUST:",
  "- Be GROUNDED in the <cbc_context> block you are given. Every question",
  "  must test a concept, sub-topic, Specific Outcome, or Key Competency",
  "  that is explicitly listed or directly implied by that context.",
  "- Be AGE-APPROPRIATE for the stated grade. A Grade 3 Mathematics question",
  "  must use Grade 3 vocabulary and operations; a Grade 9 Biology question",
  "  must use Grade 9 vocabulary and reasoning. Mis-grade-level material",
  "  (too hard OR too easy) is unacceptable.",
  "- Be culturally grounded in Zambia when examples are needed (Kwacha,",
  "  nshima, Lusaka/Kitwe/Ndola/Livingstone, local produce, SI units, etc.)",
  "  — never force it, but prefer Zambian context to foreign examples.",
  "- Each question must have EXACTLY FOUR options, ALL plausible to a learner",
  "  at that grade, and EXACTLY ONE correct answer. Distractors must be",
  "  believable wrong answers (common misconceptions, near-miss facts,",
  "  off-by-one values) — NEVER obvious fillers like 'none of these' or",
  "  'random'.",
  "- The correct answer must be UNAMBIGUOUSLY correct per the Zambian",
  "  syllabus. If the topic admits multiple legitimate interpretations,",
  "  choose one and write the question to exclude the others.",
  "- Use Zambian English spelling ('colour', 'practise' as verb, 'metre').",
  "- Every question MUST include an explanation that a teacher could read",
  "  aloud — say WHY the correct answer is correct, ideally naming the",
  "  Specific Outcome or sub-topic it maps to. Do not simply restate the",
  "  question.",
  "",
  "You MUST NOT:",
  "- Invent sub-topics, outcomes, or competencies that are not in the",
  "  <cbc_context> block (or clearly consistent with CDC syllabi for this",
  "  grade+subject).",
  "- Write questions on off-syllabus topics (e.g. high-school chemistry for",
  "  a Grade 4 Environmental Science quiz).",
  "- Write adult-themed, politically partisan, violent, or religiously",
  "  divisive content.",
  "- Write questions requiring cultural knowledge a Zambian primary learner",
  "  wouldn't have (e.g. American sports, European history specifics).",
  "- Duplicate questions within a set. Each of the N questions must test a",
  "  distinct sub-topic, outcome, or cognitive skill.",
  "",
  "Output format: a single valid JSON object with a 'questions' array.",
  "No prose, no markdown fences, no commentary outside the JSON.",
].join("\n");

function buildQuizMessages(payload) {
  const subject = cleanString(payload.subject, LIMITS.subject);
  const grade = cleanString(payload.grade, LIMITS.grade);
  const topic = cleanString(payload.topic, LIMITS.topic);
  const subtopic = cleanString(payload.subtopic, LIMITS.topic);
  const instructions = cleanString(payload.instructions, 400);
  const cbcContextBlock = cleanString(payload.cbcContextBlock, 4000) ||
    [
      "<cbc_context>",
      `Grade: ${grade}`,
      `Subject: ${subject}`,
      `Topic: ${topic}`,
      "",
      "NOTE: This topic is not in the verified CBC knowledge base.",
      "Use your expert knowledge of the Zambian CBC (2013 CDC framework)",
      "for this grade+subject. Stay on-syllabus and grade-appropriate.",
      "</cbc_context>",
    ].join("\n");

  const count = Math.min(
    Math.max(Number(payload.count) || 5, 1),
    LIMITS.quizCount,
  );

  const userPrompt = [
    cbcContextBlock,
    "",
    `Write ${count} multiple-choice quiz questions for the following lesson:`,
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Coverage plan (follow this, do not deviate):",
    `- Across the ${count} questions, cover DIFFERENT sub-topics or Specific`,
    "  Outcomes from the <cbc_context> above. Do not repeat the same concept.",
    "- Mix cognitive levels: recall (what / which / name), comprehension",
    "  (why / how), and simple application (if/then, a short worked example).",
    "  Do NOT write all-recall questions.",
    "- At least one question should test a common misconception at this",
    "  grade level (the correct answer corrects the misconception).",
    "",
    "Return a JSON object in EXACTLY this shape:",
    "{",
    '  "questions": [',
    "    {",
    '      "text": "The full question, as the learner reads it. Include units where relevant.",',
    '      "options": ["First option", "Second option", "Third option", "Fourth option"],',
    '      "correctAnswer": 0,                // 0-based index into options',
    '      "explanation": "1-2 sentences explaining WHY the correct option is correct. Name the sub-topic or Specific Outcome where possible.",',
    '      "topic": "The sub-topic or Specific Outcome this question tests",',
    '      "marks": 1,',
    '      "type": "mcq"',
    "    }",
    "  ]",
    "}",
    "",
    "Hard rules (violations cause the question to be rejected):",
    "- Exactly 4 options per question, all non-empty, all distinct.",
    "- correctAnswer is an INTEGER 0-3.",
    "- The correct option must be factually correct per the Zambian syllabus.",
    "- Distractors must be plausible but clearly wrong on reflection.",
    "- Question text must be at least 25 characters, complete sentence,",
    "  ending with a question mark OR a fill-in-the-blank cue.",
    "- Explanation must be at least 15 characters and must NOT simply repeat",
    "  the question verbatim.",
    "- No two options may be paraphrases of each other.",
    "- No 'all of the above', 'none of the above', or 'both A and B'.",
    "- No references to things outside the <cbc_context> block.",
    "",
    "Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");

  return {
    count,
    messages: [
      {role: "system", content: QUIZ_SYSTEM_PROMPT},
      {role: "user", content: userPrompt},
    ],
  };
}

function buildImportStructureMessages(payload) {
  const fileName = cleanString(payload.fileName, LIMITS.importFileName);
  const documentText = cleanString(
    payload.documentText,
    LIMITS.importDocumentText,
  );
  const localDraft = cleanString(
    payload.localDraft,
    LIMITS.importLocalDraft,
  );

  return [
    {
      role: "system",
      content: [
        "You are the smart quiz import formatter for ZedExams.",
        "Convert messy school exam text into structured quiz sections.",
        "Preserve order. Distinguish instructions from passage text.",
        "When a story, passage, advert, notice, table, or shared text applies",
        "to multiple questions, return one passage section and place the",
        "related questions inside it.",
        "Never swallow Story 2 or Story 3 into the explanation of the",
        "previous question.",
        "For paragraph-order, matching, and punctuation items, rebuild the",
        "full question text and all options cleanly.",
        "For paragraph-order sections with one shared instruction and",
        "number-only items, keep them as standalone multiple-choice",
        "questions rather than passage sections.",
        "Use sourceQuestionNumber for every numbered question.",
        "Only set correctAnswer when it is explicitly available from the text",
        "or answer key. Otherwise return an empty string.",
        "Return only valid JSON.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        fileName ? `File name: ${fileName}` : "",
        "Raw extracted document text:",
        documentText,
        localDraft ? "Approximate local draft (use only as a hint when helpful):" : "",
        localDraft || "",
        "Return JSON in this shape:",
        "{\"sections\":[",
        "{\"kind\":\"passage\",\"title\":\"\",\"instructions\":\"\",",
        "\"passageText\":\"\",\"questions\":[",
        "{\"sourceQuestionNumber\":46,\"text\":\"\",\"options\":[\"\",\"\",\"\",\"\"],",
        "\"correctAnswer\":\"A\",\"explanation\":\"\",\"type\":\"mcq\"}",
        "]}",
        ",{\"kind\":\"standalone\",\"question\":",
        "{\"sourceQuestionNumber\":39,\"text\":\"\",\"options\":[\"\",\"\",\"\",\"\"],",
        "\"correctAnswer\":\"C\",\"explanation\":\"\",\"type\":\"mcq\"}}",
        "],\"warnings\":[\"optional note\"]}",
        "Rules:",
        "- Passage questions must stay grouped under the correct passage.",
        "- Shared instructions like 'choose the paragraph with the sentences",
        "in the best order' should stay as instructions for standalone",
        "multiple-choice questions, not as passage text.",
        "- Put shared instructions in instructions, not inside passageText.",
        "- passageText should contain only the reading text or source text.",
        "- Keep options as plain text without A/B/C/D labels when possible.",
        "- Do not invent new questions or answers.",
      ].filter(Boolean).join("\n"),
    },
  ];
}

function normalizeCorrectAnswer(value, options) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < options.length) {
    return numeric;
  }

  const letterIndex = ["A", "B", "C", "D"].indexOf(
    cleanString(value, 10).toUpperCase(),
  );
  if (letterIndex >= 0 && letterIndex < options.length) return letterIndex;

  const valueText = cleanString(value, 160).toLowerCase();
  const optionIndex = options.findIndex((option) =>
    option.toLowerCase() === valueText,
  );
  return optionIndex >= 0 ? optionIndex : 0;
}

// Quality filter — drops quiz questions that are technically parseable but
// aren't good enough to put in front of a teacher. Each check corresponds to
// a failure mode we've actually seen from Claude:
//
//   - duplicate/near-duplicate options (hedged distractors)
//   - tautological explanations that restate the question
//   - banned option phrases ('all of the above', 'none of the above')
//   - too-short question text or explanation
//   - correct option being empty or equal to a distractor
//   - topic drift — the question doesn't reference the topic AT ALL and
//     doesn't reuse vocabulary from topic/subject (off-syllabus)
//
// If you ever need to see what was dropped and why, flip LOG_QUALITY_DROPS
// to true temporarily and tail the Cloud Functions logs.
const LOG_QUALITY_DROPS = false;

const BANNED_OPTION_PHRASES = [
  /^(all|any|both)\s+of\s+(the\s+)?above\b/i,
  /^none\s+of\s+(the\s+)?above\b/i,
  /^both\s+[a-d]\s+and\s+[a-d]\b/i,
  /^(random|unrelated|nothing|no\s*idea|i\s+don'?t\s+know)$/i,
];

function normaliseForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenise(text) {
  const STOP = new Set([
    "the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are",
    "was", "were", "be", "been", "being", "for", "with", "at", "by", "this",
    "that", "these", "those", "it", "its", "as", "which", "what", "who",
    "how", "why", "when", "where", "from", "into", "about", "one", "two",
    "all", "any", "some", "each", "every",
  ]);
  return normaliseForCompare(text)
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && t.length > 2);
}

function validateQuizQuestion(q, {topic, subject, subtopic}) {
  const reasons = [];
  const text = cleanString(q.text, LIMITS.question);
  const options = q.options || [];
  const correctIdx = q.correctAnswer;
  const explanation = cleanString(q.explanation, 500);

  if (text.length < 25) reasons.push("question_too_short");
  if (!/[?…:]$|_{3,}/.test(text)) reasons.push("no_question_cue");

  if (options.length !== 4) reasons.push("wrong_option_count");

  const normOptions = options.map(normaliseForCompare);
  const uniqueNormOptions = new Set(normOptions);
  if (uniqueNormOptions.size !== options.length) {
    reasons.push("duplicate_options");
  }

  for (const opt of options) {
    if (!opt || opt.length < 1) {
      reasons.push("empty_option");
      break;
    }
    if (BANNED_OPTION_PHRASES.some((re) => re.test(opt))) {
      reasons.push("banned_phrase_option");
      break;
    }
  }

  // Near-duplicate distractor check: if any two options have Jaccard token
  // similarity >= 0.8, they're essentially the same distractor twice.
  const optTokens = options.map((o) => new Set(tokenise(o)));
  for (let i = 0; i < optTokens.length; i++) {
    for (let j = i + 1; j < optTokens.length; j++) {
      const a = optTokens[i];
      const b = optTokens[j];
      if (a.size === 0 || b.size === 0) continue;
      const inter = [...a].filter((t) => b.has(t)).length;
      const union = new Set([...a, ...b]).size;
      if (union > 0 && inter / union >= 0.8) {
        reasons.push("near_duplicate_options");
        break;
      }
    }
  }

  if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx > 3) {
    reasons.push("bad_correct_index");
  }

  if (explanation.length < 15) reasons.push("explanation_too_short");
  if (normaliseForCompare(explanation) === normaliseForCompare(text)) {
    reasons.push("explanation_restates_question");
  }

  // Topic drift check: at least one non-stopword token from topic/subject/
  // subtopic must appear somewhere in the question text, correct option, or
  // explanation. If NONE match, the question is probably off-syllabus.
  const anchorTokens = [
    ...tokenise(topic),
    ...tokenise(subtopic),
    ...tokenise(subject),
  ];
  if (anchorTokens.length > 0) {
    const haystack = normaliseForCompare(
      `${text} ${options[correctIdx] || ""} ${explanation}`,
    );
    const anyMatch = anchorTokens.some((tok) => haystack.includes(tok));
    if (!anyMatch) reasons.push("topic_drift");
  }

  return {valid: reasons.length === 0, reasons};
}

function dedupeQuestionSet(questions) {
  const seen = new Set();
  return questions.filter((q) => {
    const key = normaliseForCompare(q.text).slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseGeneratedQuiz(raw, fallbackTopic, validationContext = {}) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new HttpsError(
      "internal",
      "The generated quiz could not be read. Please try again.",
    );
  }

  const source = Array.isArray(parsed.questions) ? parsed.questions : [];
  const shaped = source.map((q) => {
    const options = Array.isArray(q.options) ?
      q.options.map((o) => cleanString(o, 160)).filter(Boolean).slice(0, 4) :
      [];
    return {
      text: cleanString(q.text, LIMITS.question),
      options,
      correctAnswer: normalizeCorrectAnswer(q.correctAnswer, options),
      explanation: cleanString(q.explanation, 500),
      topic: cleanString(q.topic || fallbackTopic, LIMITS.topic),
      marks: Math.min(Math.max(Number(q.marks) || 1, 1), 10),
      type: "mcq",
    };
  }).filter((q) => q.text && q.options.length === 4);

  const {topic, subject, grade, subtopic} =
    validationContext || {};
  const anchor = {
    topic: topic || fallbackTopic,
    subject: subject || "",
    grade: grade || "",
    subtopic: subtopic || "",
  };

  const filtered = [];
  for (const q of shaped) {
    const {valid, reasons} = validateQuizQuestion(q, anchor);
    if (valid) {
      filtered.push(q);
    } else if (LOG_QUALITY_DROPS) {
      console.warn("generateQuiz: dropped question", {
        text: q.text.slice(0, 80),
        reasons,
      });
    }
  }

  const deduped = dedupeQuestionSet(filtered);

  if (!deduped.length) {
    throw new HttpsError(
      "internal",
      "No usable quiz questions were generated. Please try again.",
    );
  }
  return deduped;
}

function normalizeImportedQuestion(question = {}) {
  const options = Array.isArray(question.options) ?
    question.options
      .map((option) => cleanString(option, 220))
      .filter(Boolean)
      .slice(0, 4) :
    [];
  const numericSource = Number.parseInt(
    cleanString(question.sourceQuestionNumber, 8),
    10,
  );
  const type = cleanString(question.type, 20).toLowerCase();

  return {
    sourceQuestionNumber: Number.isFinite(numericSource) ? numericSource : null,
    text: cleanString(question.text || question.question, LIMITS.question),
    options,
    correctAnswer: Number.isInteger(question.correctAnswer) ?
      question.correctAnswer :
      cleanString(question.correctAnswer, 40),
    explanation: cleanString(question.explanation, 500),
    type: ["mcq", "truefalse", "short_answer", "diagram"].includes(type) ?
      type :
      (options.length >= 2 ? "mcq" : "short_answer"),
  };
}

function parseStructuredImport(raw) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new HttpsError(
      "internal",
      "The smart import response could not be read. Please try again.",
    );
  }

  const warnings = Array.isArray(parsed.warnings) ?
    parsed.warnings
      .map((item) => cleanString(item, 180))
      .filter(Boolean)
      .slice(0, 8) :
    [];

  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map((section) => {
      const kind = cleanString(section?.kind, 20).toLowerCase();
      if (kind === "passage") {
        const questions = (Array.isArray(section.questions) ?
          section.questions :
          [])
          .map((question) => normalizeImportedQuestion(question))
          .filter((question) => question.text || question.options.length);

        const title = cleanString(section.title, 160);
        const instructions = cleanString(section.instructions, 1200);
        const passageText = cleanString(section.passageText, 6000);

        if (!questions.length || (!title && !instructions && !passageText)) {
          return null;
        }

        return {
          kind: "passage",
          title,
          instructions,
          passageText,
          questions,
        };
      }

      const question = normalizeImportedQuestion(section.question || section);
      if (!question.text && !question.options.length) return null;

      return {
        kind: "standalone",
        question,
      };
    })
    .filter(Boolean);

  if (!sections.length) {
    throw new HttpsError(
      "internal",
      "No usable quiz sections were returned from smart import.",
    );
  }

  return {sections, warnings};
}

/**
 * Streams a Claude response token-by-token. Calls onToken(text) for each
 * text_delta event, then returns the full concatenated text.
 *
 * Prompt caching is included: the system prompt is sent as a structured
 * cacheable block. Use this for all streaming chat paths.
 */
async function callAnthropicStream(apiKey, {
  systemPrompt,
  messages,
  maxTokens = 1000,
  temperature = 0.35,
}, onToken) {
  let res;
  try {
    res = await anthropicFetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        ...(systemPrompt ? {
          system: [{
            type: "text",
            text: systemPrompt,
            cache_control: {type: "ephemeral"},
          }],
        } : {}),
        messages,
      }),
    }, {label: "aiService:stream"});
  } catch (err) {
    console.error("callAnthropicStream fetch failed", err);
    throw new HttpsError("unavailable", "AI is temporarily unavailable. Please try again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("callAnthropicStream API error", {
      status: res.status,
      type: body?.error?.type,
      message: body?.error?.message,
    });
    if (res.status === 429) {
      throw new HttpsError("resource-exhausted", "AI is busy. Please wait a moment and try again.");
    }
    throw new HttpsError("unavailable", "AI is temporarily unavailable. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      try {
        const parsed = JSON.parse(raw);
        if (
          parsed.type === "content_block_delta" &&
          parsed.delta?.type === "text_delta" &&
          typeof parsed.delta.text === "string"
        ) {
          const token = parsed.delta.text;
          fullText += token;
          onToken(token);
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  return fullText;
}

module.exports = {
  LIMITS,
  assertDailyLimit,
  buildAnthropicChat,
  buildChatMessages,
  buildExplainMessages,
  buildImportStructureMessages,
  buildQuizMessages,
  callAnthropic,
  callAnthropicStream,
  callOpenAI,
  cleanContext,
  cleanChatHistory,
  cleanString,
  getAnthropicApiKey,
  getApiKey,
  getUserRole,
  isStaffRole,
  parseStructuredImport,
  parseGeneratedQuiz,
  stripJsonFences,
  toAnthropicShape,
};
