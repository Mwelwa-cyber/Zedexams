const functions = require("firebase-functions/v1");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const {
  LIMITS,
  assertDailyLimit,
  buildChatMessages,
  buildExplainMessages,
  buildQuizMessages,
  callOpenAI,
  cleanString: cleanAiString,
  getApiKey,
  getUserRole,
  isStaffRole,
  parseGeneratedQuiz,
} = require("./aiService");

const openAiApiKey = defineSecret("OPENAI_API_KEY");
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_LEN = {
  question: 1200,
  correctAnswer: 600,
  studentAnswer: 600,
  subject: 80,
  grade: 20,
};
const MARKING_EQUIVALENCES =
  "Accept common school terms and scientific terms as equivalent when they " +
  "refer to the same concept. Examples: alveoli = air sacs; oesophagus = " +
  "food pipe; trachea = windpipe; larynx = voice box; stomata = leaf pores; " +
  "photosynthesis = making food using sunlight. A more precise term should " +
  "not be marked wrong because the expected answer uses a simpler term. " +
  "Do not say alveoli are different from air sacs; in primary science, air " +
  "sacs in the lungs are alveoli. For breathing terms: respiration can be " +
  "another name for breathing; inhaling/inhalation means breathing in only; " +
  "exhaling/exhalation means breathing out only. Mark false only when the student's answer " +
  "contradicts the concept or answers a different question. ";
const TEACHER_MARKING_SCHEME =
  "When an expected answer is provided, treat it as the teacher's marking " +
  "scheme. If the student's answer matches that expected answer or a clear " +
  "equivalent, mark it correct even when another wording might be more " +
  "scientifically complete. ";

function cleanString(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
}

function parseMarkerResponse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      correct: Boolean(parsed.correct),
      feedback: cleanString(parsed.feedback, 160) ||
        "Answer checked. Review the expected answer.",
    };
  } catch {
    throw new HttpsError(
      "internal",
      "The marker could not read the AI response. Please try again.",
    );
  }
}

exports.setUserRole = functions.auth.user().onCreate(async (user) => {
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const email = (user.email || "").toLowerCase();
  const role = adminEmails.includes(email) ? "admin" : "learner";

  await admin.auth().setCustomUserClaims(user.uid, {role});

  return null;
});

exports.aiChat = onCall(
  {secrets: [openAiApiKey], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const message = cleanAiString(request.data?.message, LIMITS.message);
    if (!message) {
      throw new HttpsError(
        "invalid-argument",
        "Please enter a question for Zed.",
      );
    }

    const role = await getUserRole(request.auth.uid);
    await assertDailyLimit(request.auth.uid, role, "chat");

    const reply = await callOpenAI(getApiKey(openAiApiKey), {
      messages: buildChatMessages({
        message,
        context: request.data?.context || {},
        history: request.data?.history || [],
        role,
      }),
      maxTokens: 650,
      temperature: 0.35,
    });

    return {reply};
  },
);

function httpStatusForError(error) {
  const map = {
    "unauthenticated": 401,
    "permission-denied": 403,
    "invalid-argument": 400,
    "resource-exhausted": 429,
    "failed-precondition": 503,
    "unavailable": 503,
  };
  return map[error?.code] || 500;
}

exports.apiAiChat = onRequest(
  {secrets: [openAiApiKey], region: "us-central1", timeoutSeconds: 30},
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({error: "Use POST for Zed chat."});
      return;
    }

    try {
      const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }

      const decoded = await admin.auth().verifyIdToken(token);
      const message = cleanAiString(req.body?.message, LIMITS.message);
      if (!message) {
        throw new HttpsError(
          "invalid-argument",
          "Please enter a question for Zed.",
        );
      }

      const role = await getUserRole(decoded.uid);
      await assertDailyLimit(decoded.uid, role, "chat");
      const reply = await callOpenAI(getApiKey(openAiApiKey), {
        messages: buildChatMessages({
          message,
          context: req.body?.context || {},
          history: req.body?.history || [],
          role,
        }),
        maxTokens: 650,
        temperature: 0.35,
      });

      res.status(200).json({reply});
    } catch (error) {
      console.error("apiAiChat error", {
        code: error?.code,
        message: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: error?.message || "Zed is unavailable right now.",
      });
    }
  },
);

exports.explainAnswer = onCall(
  {secrets: [openAiApiKey], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const question = cleanAiString(request.data?.question, LIMITS.question);
    const correctAnswer = cleanAiString(
      request.data?.correctAnswer,
      LIMITS.answer,
    );
    if (!question || !correctAnswer) {
      throw new HttpsError(
        "invalid-argument",
        "Question and correct answer are required.",
      );
    }

    const role = await getUserRole(request.auth.uid);
    await assertDailyLimit(request.auth.uid, role, "explain");

    const explanation = await callOpenAI(getApiKey(openAiApiKey), {
      messages: buildExplainMessages({
        ...request.data,
        question,
        correctAnswer,
      }),
      maxTokens: 220,
      temperature: 0.25,
    });

    return {explanation};
  },
);

exports.generateQuizQuestions = onCall(
  {secrets: [openAiApiKey], region: "us-central1", timeoutSeconds: 45},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can generate quiz questions.",
      );
    }

    const subject = cleanAiString(request.data?.subject, LIMITS.subject);
    const grade = cleanAiString(request.data?.grade, LIMITS.grade);
    const topic = cleanAiString(request.data?.topic, LIMITS.topic);
    if (!subject || !grade || !topic) {
      throw new HttpsError(
        "invalid-argument",
        "Subject, grade, and topic are required.",
      );
    }

    await assertDailyLimit(request.auth.uid, role, "generateQuiz");
    const {messages} = buildQuizMessages({
      ...request.data,
      subject,
      grade,
      topic,
    });
    const raw = await callOpenAI(getApiKey(openAiApiKey), {
      messages,
      maxTokens: 1400,
      temperature: 0.45,
      json: true,
    });

    return {
      questions: parseGeneratedQuiz(raw, topic),
    };
  },
);

exports.checkShortAnswer = onCall(
  {secrets: [openAiApiKey], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const question = cleanString(request.data?.question, MAX_LEN.question);
    const correctAnswer = cleanString(
      request.data?.correctAnswer,
      MAX_LEN.correctAnswer,
    );
    const studentAnswer = cleanString(
      request.data?.studentAnswer,
      MAX_LEN.studentAnswer,
    );
    const subject = cleanString(request.data?.subject, MAX_LEN.subject);
    const grade = cleanString(request.data?.grade, MAX_LEN.grade);

    if (!question || !studentAnswer) {
      throw new HttpsError(
        "invalid-argument",
        "Question and student answer are required.",
      );
    }

    const apiKey = openAiApiKey.value() || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "AI marking is not configured yet.",
      );
    }

    const context = [grade ? `Grade ${grade}` : "", subject]
      .filter(Boolean)
      .join(", ");
    const systemPrompt =
      "You are a helpful exam marker for Zambian primary school students" +
      `${context ? ` (${context})` : ""}. ` +
      (correctAnswer
        ? "Mark answers as correct if they match the expected answer, including " +
          "minor spelling mistakes, synonyms, equivalent phrasing, or valid " +
          "abbreviations. " +
          TEACHER_MARKING_SCHEME
        : "No expected answer was provided. Use the question, grade, subject, " +
          "and standard primary-school knowledge to judge whether the student's " +
          "answer is factually correct. If the question is ambiguous, mark it " +
          "incorrect and tell the learner to review the question. ") +
      MARKING_EQUIVALENCES +
      "Always respond with only valid JSON.";

    const userPrompt = `Question: "${question}"
Expected answer: "${correctAnswer || "Not provided"}"
Student's answer: "${studentAnswer}"

Respond in this exact JSON format:
{"correct": true, "feedback": "Short encouraging message (max 15 words)"}
or
{"correct": false, "feedback": "Short explanation of correct answer (max 15 words)"}`;

    let res;
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {role: "system", content: systemPrompt},
            {role: "user", content: userPrompt},
          ],
          temperature: 0.1,
          max_tokens: 120,
          response_format: {type: "json_object"},
        }),
      });
    } catch {
      throw new HttpsError(
        "unavailable",
        "AI marking is temporarily unavailable. Please try again.",
      );
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("OpenAI marker error", {
        status: res.status,
        message: body?.error?.message,
      });
      throw new HttpsError(
        "unavailable",
        "AI marking is temporarily unavailable. Please try again.",
      );
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    return parseMarkerResponse(raw);
  },
);
