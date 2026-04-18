const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

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
    res = await fetch(ANTHROPIC_URL, {
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
        ...(systemPrompt ? {system: systemPrompt} : {}),
        messages,
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
    console.error("Anthropic assistant error", {
      status: res.status,
      message: body?.error?.message,
      type: body?.error?.type,
    });
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

function buildQuizMessages(payload) {
  const subject = cleanString(payload.subject, LIMITS.subject);
  const grade = cleanString(payload.grade, LIMITS.grade);
  const topic = cleanString(payload.topic, LIMITS.topic);
  const count = Math.min(
    Math.max(Number(payload.count) || 5, 1),
    LIMITS.quizCount,
  );
  return {
    count,
    messages: [
      {
        role: "system",
        content: [
          "You create safe, curriculum-friendly quiz questions for",
          "ZedExams teachers. Target Grades 4 to 6. Return only valid JSON.",
          "Questions must be age-appropriate, school-focused, and clear.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Create ${count} multiple-choice questions.`,
          `Subject: ${subject}`,
          `Grade: ${grade}`,
          `Topic: ${topic}`,
          "Return JSON in this shape:",
          "{\"questions\":[{\"text\":\"...\",\"options\":[\"A\",\"B\",\"C\",\"D\"],",
          "\"correctAnswer\":0,\"explanation\":\"...\",\"topic\":\"...\",",
          "\"marks\":1,\"type\":\"mcq\"}]}",
        ].join("\n"),
      },
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

function parseGeneratedQuiz(raw, fallbackTopic) {
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
  const questions = source.map((q) => {
    const options = Array.isArray(q.options)
      ? q.options.map((o) => cleanString(o, 160)).filter(Boolean).slice(0, 4)
      : [];
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

  if (!questions.length) {
    throw new HttpsError(
      "internal",
      "No usable quiz questions were generated. Please try again.",
    );
  }
  return questions;
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

module.exports = {
  LIMITS,
  assertDailyLimit,
  buildAnthropicChat,
  buildChatMessages,
  buildExplainMessages,
  buildImportStructureMessages,
  buildQuizMessages,
  callAnthropic,
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
