const functions = require("firebase-functions/v1");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");

admin.initializeApp();

const {
  LIMITS,
  assertDailyLimit,
  buildAnthropicChat,
  buildExplainMessages,
  buildImportStructureMessages,
  buildQuizMessages,
  callAnthropic,
  callAnthropicStream,
  cleanString: cleanAiString,
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
  parseGeneratedQuiz,
  parseStructuredImport,
  stripJsonFences,
  toAnthropicShape,
} = require("./aiService");
const {
  buildMtnConfig,
  DEFAULT_CURRENCY,
  getPlanConfig,
  getRequestToPayStatus,
  nextPollingDelayMs,
  normalizePhoneNumber,
  requestToPay,
  resolveCurrency,
} = require("./momoService");

// Teacher Tools — Lesson Plan Generator (Zambian CBC).
const {
  createGenerateLessonPlan,
} = require("./teacherTools/generateLessonPlan");
// Teacher Tools — Worksheet Generator.
const {
  createGenerateWorksheet,
} = require("./teacherTools/generateWorksheet");
// Teacher Tools — Flashcard Generator.
const {
  createGenerateFlashcards,
} = require("./teacherTools/generateFlashcards");
// Teacher Tools — Scheme of Work Generator.
const {
  createGenerateSchemeOfWork,
} = require("./teacherTools/generateSchemeOfWork");
// Teacher Tools — Rubric Generator.
const {
  createGenerateRubric,
} = require("./teacherTools/generateRubric");
// Teacher Tools — Lesson Plan Studio (vanilla JS studio, free-form prompts).
const {
  createStudioGenerateLessonPlan,
} = require("./teacherTools/studioLessonPlan");
// Teacher Tools — import built-in CBC topics into Firestore (admin-only).
const {
  importBuiltInCbcTopics,
} = require("./teacherTools/importBuiltInCbcTopics");
// CBC knowledge base — used to ground AI quiz questions in the Zambian
// syllabus. resolveCbcContext returns a rendered <cbc_context> block plus
// a human-readable warning if the topic wasn't found in the verified KB.
const {
  resolveCbcContext,
} = require("./teacherTools/cbcKnowledge");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const mtnApiUser = defineSecret("MTN_API_USER");
const mtnApiKey = defineSecret("MTN_API_KEY");
const mtnSubscriptionKey = defineSecret("MTN_SUBSCRIPTION_KEY");
const mtnEnv = defineSecret("MTN_ENV");
const MAX_LEN = {
  question: 1200,
  correctAnswer: 600,
  studentAnswer: 600,
  subject: 80,
  grade: 20,
};
const MOMO_PAYMENT_SECRETS = [
  mtnApiUser,
  mtnApiKey,
  mtnSubscriptionKey,
  mtnEnv,
];
const MOMO_MAX_STATUS_CHECKS = 8;
const MOMO_MAX_PENDING_MINUTES = 15;
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
const SUBSCRIPTION_ACTIVATION_PENDING_MESSAGE =
  "Subscription not yet activated. If you have already paid, please " +
  "refresh or contact support.";

function cleanString(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
}

function parseMarkerResponse(raw) {
  try {
    const parsed = JSON.parse(stripJsonFences(raw));
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

function getMtnRuntimeConfig() {
  return buildMtnConfig({
    apiUser: mtnApiUser.value() || process.env.MTN_API_USER,
    apiKey: mtnApiKey.value() || process.env.MTN_API_KEY,
    subscriptionKey:
      mtnSubscriptionKey.value() || process.env.MTN_SUBSCRIPTION_KEY,
    environment: mtnEnv.value() || process.env.MTN_ENV || "sandbox",
  });
}

function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function requireHttpAuth(req) {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }
  return admin.auth().verifyIdToken(token);
}

async function getUserProfileOrThrow(uid) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Your user profile is missing. Please sign in again.",
    );
  }
  return snap.data();
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function resolveInitialUserRole(email) {
  const normalizedEmail = cleanString(email, 254).toLowerCase();
  return getAdminEmails().includes(normalizedEmail) ? "admin" : "learner";
}

function buildBootstrappedUserProfile({
  authUser,
  tokenRole,
}) {
  const email = cleanString(authUser?.email || "", 254);
  const fallbackName =
    email.includes("@") ? email.split("@")[0] : "ZedExams User";
  const displayName = cleanString(
    authUser?.displayName || fallbackName,
    120,
  ) || "ZedExams User";
  const role = tokenRole === "admin" ?
    "admin" :
    resolveInitialUserRole(email);

  return {
    displayName,
    email,
    role,
    grade: null,
    school: "",
    plan: "free",
    premium: false,
    isPremium: false,
    paymentStatus: "inactive",
    subscriptionStatus: "inactive",
    subscriptionPlan: "free",
    subscriptionExpiry: null,
    subscriptionActivatedBy: null,
    subscriptionActivatedAt: null,
    subscriptionProvider: null,
    subscriptionPaymentId: null,
    subscriptionPhoneNumber: null,
    premiumActivatedAt: null,
    dailyAttempts: 0,
    lastAttemptDate: "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    return value.toDate();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

exports.setUserRole = functions.auth.user().onCreate(async (user) => {
  const role = resolveInitialUserRole(user.email || "");

  await admin.auth().setCustomUserClaims(user.uid, {role});

  return null;
});

exports.bootstrapUserProfile = onCall(
  {region: "us-central1", timeoutSeconds: 20},
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const uid = request.auth.uid;
    const userRef = admin.firestore().doc(`users/${uid}`);
    const existingSnap = await userRef.get();
    if (existingSnap.exists) {
      return {created: false, profile: {id: uid, ...existingSnap.data()}};
    }

    try {
      const authUser = await admin.auth().getUser(uid);
      const profile = buildBootstrappedUserProfile({
        authUser,
        tokenRole: cleanString(request.auth.token?.role || "", 30),
      });

      await userRef.set(profile);

      const repairedSnap = await userRef.get();
      return {created: true, profile: {id: uid, ...repairedSnap.data()}};
    } catch (error) {
      console.error("bootstrapUserProfile:", error);
      throw new HttpsError(
        "internal",
        "We could not restore your profile right now. Please try again.",
      );
    }
  },
);

exports.aiChat = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 30},
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

    const {systemPrompt, messages} = buildAnthropicChat({
      message,
      context: request.data?.context || {},
      history: request.data?.history || [],
      role,
      customSystemPrompt: request.data?.systemPrompt,
    });
    const reply = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 1000,
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
    "not-found": 404,
    "resource-exhausted": 429,
    "failed-precondition": 503,
    "unavailable": 503,
  };
  return map[error?.code] || 500;
}

function shouldHidePaymentInfraError(message) {
  return /subscription key|api key|access denied|authenticate with MTN/i
    .test(String(message || ""));
}

function sanitizePaymentReason(reason) {
  const cleaned = cleanString(reason, 220);
  if (!cleaned) return null;
  return shouldHidePaymentInfraError(cleaned) ?
    SUBSCRIPTION_ACTIVATION_PENDING_MESSAGE :
    cleaned;
}

function userFacingPaymentErrorMessage(error, fallbackMessage) {
  return sanitizePaymentReason(error?.message) || fallbackMessage;
}

function buildActiveSubscriptionData({
  plan,
  paymentId = null,
  phoneNumber = null,
  activatedBy,
  provider,
  expiryDate,
}) {
  return {
    plan: "premium",
    premium: true,
    paymentStatus: "active",
    subscriptionStatus: "active",
    premiumActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    isPremium: true,
    subscriptionPlan: plan.id,
    subscriptionProvider: provider,
    subscriptionPhoneNumber: phoneNumber,
    subscriptionPaymentId: paymentId,
    subscriptionActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscriptionActivatedBy: activatedBy,
    subscriptionExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
  };
}

// When a TEACHER buys a learner-portal subscription, write to a separate set
// of fields so it does not collide with their (future) teacher-portal premium.
function buildLearnerPortalAccessData({
  plan,
  paymentId = null,
  phoneNumber = null,
  provider,
  expiryDate,
}) {
  return {
    learnerPortalActive: true,
    learnerPortalPlan: plan.id,
    learnerPortalProvider: provider,
    learnerPortalPhoneNumber: phoneNumber,
    learnerPortalPaymentId: paymentId,
    learnerPortalActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    learnerPortalExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
  };
}

function paymentClientMessage(status) {
  if (status === "successful") {
    return "Payment received. Your subscription is now active.";
  }
  if (status === "failed") {
    return "Payment failed or was declined. Please try again.";
  }
  if (status === "timeout") {
    return "The payment took too long to finish. Please try again.";
  }
  return "Waiting for you to approve the MTN prompt on your phone.";
}

function buildPaymentResponse(paymentId, data) {
  return {
    paymentId,
    status: data.status,
    mtnStatus: data.mtnStatus || null,
    reason: sanitizePaymentReason(data.reason),
    amountZMW: data.amountZMW,
    currency: data.currency || DEFAULT_CURRENCY,
    planId: data.planId,
    nextCheckInMs: data.status === "pending" ?
      nextPollingDelayMs(Number(data.statusChecks) || 0) :
      0,
    message: paymentClientMessage(data.status),
    lastCheckedAt: data.lastCheckedAt?.toDate?.()?.toISOString?.() || null,
  };
}

async function markPaymentSuccessful(paymentRef, paymentData, statusResult) {
  const plan = getPlanConfig(paymentData.planId);
  await admin.firestore().runTransaction(async (tx) => {
    const [paymentSnap, userSnap] = await Promise.all([
      tx.get(paymentRef),
      tx.get(admin.firestore().doc(`users/${paymentData.userId}`)),
    ]);
    if (!paymentSnap.exists) return;

    const latestPayment = paymentSnap.data();
    if (latestPayment.status === "successful") {
      return;
    }

    const userData = userSnap.exists ? userSnap.data() : {};
    const isTeacherLearnerPortal =
      paymentData.portal === "learner" && userData.role === "teacher";
    const currentExpiry = isTeacherLearnerPortal ?
      toDate(userData.learnerPortalExpiry) :
      toDate(userData.subscriptionExpiry);
    const baseDate = currentExpiry && currentExpiry > new Date() ?
      currentExpiry :
      new Date();
    const nextExpiry = new Date(baseDate);
    nextExpiry.setDate(nextExpiry.getDate() + plan.durationDays);

    tx.set(paymentRef, {
      status: "successful",
      mtnStatus: statusResult.mtnStatus,
      reason: sanitizePaymentReason(statusResult.reason),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      statusChecks: Number(latestPayment.statusChecks || 0) + 1,
      financialTransactionId:
        statusResult.raw?.financialTransactionId || null,
      rawStatusResponse: statusResult.raw || null,
    }, {merge: true});

    const userUpdate = isTeacherLearnerPortal ?
      buildLearnerPortalAccessData({
        plan,
        paymentId: paymentRef.id,
        phoneNumber: paymentData.phoneNumber,
        provider: "mtn_momo",
        expiryDate: nextExpiry,
      }) :
      buildActiveSubscriptionData({
        plan,
        paymentId: paymentRef.id,
        phoneNumber: paymentData.phoneNumber,
        activatedBy: "mtn_momo",
        provider: "mtn_momo",
        expiryDate: nextExpiry,
      });

    tx.set(
      admin.firestore().doc(`users/${paymentData.userId}`),
      userUpdate,
      {merge: true},
    );
  });
}

async function markPaymentFinal(
  paymentRef,
  paymentData,
  status,
  reason,
  raw,
  mtnStatus = null,
) {
  await paymentRef.set({
    status,
    mtnStatus: mtnStatus || (status === "timeout" ? "TIMEOUT" : paymentData.mtnStatus || null),
    reason: sanitizePaymentReason(reason),
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    statusChecks: Number(paymentData.statusChecks || 0) + 1,
    rawStatusResponse: raw || null,
  }, {merge: true});
}

async function refreshPaymentStatus(paymentId, {skipIfNotDue = false} = {}) {
  const paymentRef = admin.firestore().doc(`payments/${paymentId}`);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    throw new HttpsError("not-found", "Payment record not found.");
  }

  const paymentData = paymentSnap.data();
  if (paymentData.status !== "pending") {
    return {paymentId, ...paymentData};
  }

  const nextCheckAt = toDate(paymentData.nextCheckAt);
  if (skipIfNotDue && nextCheckAt && nextCheckAt > new Date()) {
    return {paymentId, ...paymentData};
  }

  const createdAt = toDate(paymentData.createdAt) || new Date();
  const ageMinutes = (Date.now() - createdAt.getTime()) / (60 * 1000);
  const checksSoFar = Number(paymentData.statusChecks || 0);
  if (
    checksSoFar >= MOMO_MAX_STATUS_CHECKS ||
    ageMinutes >= MOMO_MAX_PENDING_MINUTES
  ) {
    await markPaymentFinal(
      paymentRef,
      paymentData,
      "timeout",
      "The MTN approval window expired before the payment completed.",
      paymentData.rawStatusResponse || null,
      "TIMEOUT",
    );
    const updated = await paymentRef.get();
    return {paymentId, ...updated.data()};
  }

  const statusResult = await getRequestToPayStatus(getMtnRuntimeConfig(), paymentId);
  console.log("MTN payment status", {
    paymentId,
    status: statusResult.status,
    mtnStatus: statusResult.mtnStatus,
  });

  if (statusResult.status === "successful") {
    await markPaymentSuccessful(paymentRef, paymentData, statusResult);
    const updated = await paymentRef.get();
    return {paymentId, ...updated.data()};
  }

  if (statusResult.isFinal) {
    await markPaymentFinal(
      paymentRef,
      paymentData,
      statusResult.status,
      statusResult.reason || "MTN reported that the payment did not complete.",
      statusResult.raw,
      statusResult.mtnStatus,
    );
    const updated = await paymentRef.get();
    return {paymentId, ...updated.data()};
  }

  const nextDelayMs = nextPollingDelayMs(checksSoFar + 1);
  await paymentRef.set({
    mtnStatus: statusResult.mtnStatus,
    reason: sanitizePaymentReason(statusResult.reason),
    rawStatusResponse: statusResult.raw || null,
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    statusChecks: checksSoFar + 1,
    nextCheckAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + nextDelayMs),
    ),
  }, {merge: true});

  const updated = await paymentRef.get();
  return {paymentId, ...updated.data()};
}

exports.apiAiChat = onRequest(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 60},
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

    // ── Auth + validation (before any headers are sent) ─────────────
    let decoded;
    let systemPrompt;
    let messages;
    let apiKey;
    try {
      const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      decoded = await admin.auth().verifyIdToken(token);

      const message = cleanAiString(req.body?.message, LIMITS.message);
      if (!message) {
        throw new HttpsError("invalid-argument", "Please enter a question for Zed.");
      }

      const role = await getUserRole(decoded.uid);
      await assertDailyLimit(decoded.uid, role, "chat");

      ({systemPrompt, messages} = buildAnthropicChat({
        message,
        context: req.body?.context || {},
        history: req.body?.history || [],
        role,
        customSystemPrompt: req.body?.systemPrompt,
      }));
      apiKey = getAnthropicApiKey(anthropicApiKey);
    } catch (error) {
      console.error("apiAiChat auth/validation error", {
        code: error?.code,
        message: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: error?.message || "Zed is unavailable right now.",
      });
      return;
    }

    // ── Stream SSE to the client ──────────────────────────────────────
    res.set("Content-Type", "text/event-stream; charset=utf-8");
    res.set("Cache-Control", "no-cache");
    res.set("Connection", "keep-alive");
    res.set("X-Accel-Buffering", "no"); // disable Nginx buffering if present
    res.status(200);
    // Flush an initial keep-alive comment so the client knows the connection opened.
    res.write(": connected\n\n");

    try {
      await callAnthropicStream(
        apiKey,
        {systemPrompt, messages, maxTokens: 1000, temperature: 0.35},
        (token) => {
          res.write(`data: ${JSON.stringify({text: token})}\n\n`);
        },
      );
      res.write("data: [DONE]\n\n");
    } catch (error) {
      console.error("apiAiChat stream error", {
        code: error?.code,
        message: error?.message,
      });
      // Best-effort: send error event then close. The client uses [ERROR] to
      // surface a user-facing message and fall back gracefully.
      res.write(`data: [ERROR] ${JSON.stringify({error: error?.message || "Zed is unavailable right now."})}\n\n`);
    } finally {
      res.end();
    }
  },
);

exports.apiCreateMomoPayment = onRequest(
  {region: "us-central1", timeoutSeconds: 60, secrets: MOMO_PAYMENT_SECRETS},
  async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({error: "Use POST to start a payment."});
      return;
    }

    try {
      const decoded = await requireHttpAuth(req);
      const userProfile = await getUserProfileOrThrow(decoded.uid);
      const plan = getPlanConfig(req.body?.planId);
      const config = getMtnRuntimeConfig();
      const currency = config.currency || resolveCurrency(config.targetEnvironment);
      const phoneNumber = normalizePhoneNumber(
        req.body?.phoneNumber,
        config.targetEnvironment,
      );
      // `portal` lets teachers buy a learner-portal subscription independently
      // of any future teacher-portal subscription. Learner-role users always
      // get the legacy premium activation regardless of this field.
      const requestedPortal = cleanString(req.body?.portal || "", 20)
        .toLowerCase();
      const portal = requestedPortal === "learner" ? "learner" : "default";
      const paymentId = crypto.randomUUID();
      const externalId = `${decoded.uid}-${Date.now()}`;

      await requestToPay(config, {
        requestId: paymentId,
        externalId,
        phoneNumber,
        plan,
        payerMessage: `${plan.name} premium subscription`,
        payeeNote: `${userProfile.displayName || decoded.email || decoded.uid}`,
      });

      await admin.firestore().doc(`payments/${paymentId}`).set({
        userId: decoded.uid,
        displayName: userProfile.displayName || "",
        email: userProfile.email || decoded.email || "",
        userRole: userProfile.role || "learner",
        portal,
        planId: plan.id,
        planName: plan.name,
        amountZMW: plan.amountZMW,
        currency,
        provider: "mtn_momo",
        phoneNumber,
        externalId,
        status: "pending",
        mtnStatus: "PENDING",
        reason: null,
        environment: config.targetEnvironment,
        statusChecks: 0,
        nextCheckAt: admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + nextPollingDelayMs(0)),
        ),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastCheckedAt: null,
        completedAt: null,
      });

      res.status(202).json({
        paymentId,
        status: "pending",
        planId: plan.id,
        amountZMW: plan.amountZMW,
        currency,
        phoneNumber,
        nextCheckInMs: nextPollingDelayMs(0),
        message: "Payment request sent. Approve it on your phone.",
      });
    } catch (error) {
      console.error("apiCreateMomoPayment error", {
        code: error?.code,
        message: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: userFacingPaymentErrorMessage(
          error,
          "Could not start the MTN payment.",
        ),
      });
    }
  },
);

exports.apiMomoPaymentStatus = onRequest(
  {region: "us-central1", timeoutSeconds: 60, secrets: MOMO_PAYMENT_SECRETS},
  async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({error: "Use GET to read payment status."});
      return;
    }

    try {
      const decoded = await requireHttpAuth(req);
      const paymentId = String(req.query?.paymentId || "").trim();
      if (!paymentId) {
        throw new HttpsError(
          "invalid-argument",
          "paymentId is required.",
        );
      }

      const paymentSnap = await admin.firestore().doc(`payments/${paymentId}`).get();
      if (!paymentSnap.exists) {
        throw new HttpsError("not-found", "Payment record not found.");
      }

      const paymentData = paymentSnap.data();
      if (paymentData.userId !== decoded.uid) {
        const requester = await getUserProfileOrThrow(decoded.uid);
        if (requester.role !== "admin") {
          throw new HttpsError(
            "permission-denied",
            "You can only view your own payment.",
          );
        }
      }

      const refreshed = await refreshPaymentStatus(paymentId, {skipIfNotDue: true});
      res.status(200).json(buildPaymentResponse(paymentId, refreshed));
    } catch (error) {
      console.error("apiMomoPaymentStatus error", {
        code: error?.code,
        message: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: userFacingPaymentErrorMessage(
          error,
          "Could not read the payment status.",
        ),
      });
    }
  },
);

exports.pollPendingMomoPayments = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "us-central1",
    timeoutSeconds: 540,
    secrets: MOMO_PAYMENT_SECRETS,
  },
  async () => {
    const pendingSnap = await admin.firestore()
      .collection("payments")
      .where("status", "==", "pending")
      .limit(25)
      .get();

    if (pendingSnap.empty) {
      console.log("pollPendingMomoPayments: no pending payments");
      return;
    }

    for (const doc of pendingSnap.docs) {
      try {
        const payment = doc.data();
        const nextCheckAt = toDate(payment.nextCheckAt);
        if (nextCheckAt && nextCheckAt > new Date()) {
          continue;
        }
        await refreshPaymentStatus(doc.id);
      } catch (error) {
        console.error("pollPendingMomoPayments item error", {
          paymentId: doc.id,
          code: error?.code,
          message: error?.message,
        });
      }
    }
  },
);

exports.explainAnswer = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 30},
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

    const {systemPrompt, messages} = toAnthropicShape(buildExplainMessages({
      ...request.data,
      question,
      correctAnswer,
    }));
    const explanation = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 400,
      temperature: 0.25,
    });

    return {explanation};
  },
);

exports.generateQuizQuestions = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 45},
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

    // Resolve the authoritative CBC context for this (grade, subject, topic).
    // Matches the pipeline the other teacher tools use — pulls verified
    // sub-topics, Specific Outcomes, Key Competencies and Values from the
    // Firestore KB and in-code seed. Falls back to a grounded "use your CBC
    // knowledge" note if the topic isn't catalogued yet. kbWarning is a
    // human-readable heads-up (e.g. "Nearest verified topics: X, Y") that
    // the UI can surface to the teacher.
    const subtopic = cleanAiString(request.data?.subtopic, LIMITS.topic);
    const {contextBlock, kbWarning} = await resolveCbcContext({
      grade,
      subject,
      topic,
      subtopic,
    });

    const {messages: rawMessages} = buildQuizMessages({
      ...request.data,
      subject,
      grade,
      topic,
      subtopic,
      cbcContextBlock: contextBlock,
    });
    const {systemPrompt, messages} = toAnthropicShape(rawMessages);
    const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 2000,
      temperature: 0.3,
      json: true,
    });

    return {
      questions: parseGeneratedQuiz(raw, topic, {
        topic,
        subject,
        grade,
        subtopic,
      }),
      warning: kbWarning || null,
    };
  },
);

exports.structureImportedQuiz = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 60},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can use smart quiz import.",
      );
    }

    const fileName = cleanAiString(
      request.data?.fileName,
      LIMITS.importFileName,
    );
    const documentText = cleanAiString(
      request.data?.documentText,
      LIMITS.importDocumentText,
    );
    const localDraft = cleanAiString(
      request.data?.localDraft,
      LIMITS.importLocalDraft,
    );

    if (!documentText || documentText.length < 120) {
      throw new HttpsError(
        "invalid-argument",
        "Not enough document text was available for smart import.",
      );
    }

    await assertDailyLimit(request.auth.uid, role, "smartImport");
    const {systemPrompt, messages} = toAnthropicShape(buildImportStructureMessages({
      fileName,
      documentText,
      localDraft,
    }));
    const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 4000,
      temperature: 0.2,
      json: true,
    });

    return parseStructuredImport(raw);
  },
);

exports.checkShortAnswer = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 30},
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
      "Always respond with only valid JSON. No prose, no code fences, just the JSON object.";

    const userPrompt = `Question: "${question}"
Expected answer: "${correctAnswer || "Not provided"}"
Student's answer: "${studentAnswer}"

Respond in this exact JSON format:
{"correct": true, "feedback": "Short encouraging message (max 15 words)"}
or
{"correct": false, "feedback": "Short explanation of correct answer (max 15 words)"}`;

    const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 200,
      temperature: 0.1,
      json: true,
    });
    return parseMarkerResponse(raw);
  },
);

// Teacher Tools — Zambian CBC Lesson Plan Generator.
exports.generateLessonPlan = createGenerateLessonPlan(anthropicApiKey);

// Teacher Tools — Zambian CBC Worksheet Generator.
exports.generateWorksheet = createGenerateWorksheet(anthropicApiKey);

// Teacher Tools — Zambian CBC Flashcard Generator.
exports.generateFlashcards = createGenerateFlashcards(anthropicApiKey);

// Teacher Tools — Zambian CBC Scheme of Work Generator.
exports.generateSchemeOfWork = createGenerateSchemeOfWork(anthropicApiKey);

// Teacher Tools — Zambian CBC Rubric Generator.
exports.generateRubric = createGenerateRubric(anthropicApiKey);

// Teacher Tools — admin-only: import the built-in G1-9 topics into Firestore.
exports.importBuiltInCbcTopics = importBuiltInCbcTopics;

// Teacher Tools — Lesson Plan Studio (vanilla JS studio endpoint).
exports.studioGenerateLessonPlan = createStudioGenerateLessonPlan(anthropicApiKey);
exports.apiTextToSpeech = require('./tts').apiTextToSpeech;

// Zed assistant — Telegram bot, WhatsApp bot, and admin web voice client.
const zedAssistant = require("./zedAssistant");
exports.telegramWebhook = zedAssistant.telegramWebhook;
exports.zedSetTelegramWebhook = zedAssistant.zedSetTelegramWebhook;
exports.zedTelegramWebhookInfo = zedAssistant.zedTelegramWebhookInfo;
exports.apiZedAssistantChat = zedAssistant.apiZedAssistantChat;
exports.whatsappWebhook = zedAssistant.whatsappWebhook;
exports.zedCoderTaskRunner = zedAssistant.zedCoderTaskRunner;
