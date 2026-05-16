const {HttpsError} = require("firebase-functions/v2/https");
const {verifySettledAmount} = require("./momoSettlement");

const PLAN_CATALOG = {
  monthly: {
    id: "monthly",
    name: "Monthly",
    amountZMW: 50,
    durationDays: 30,
  },
  termly: {
    id: "termly",
    name: "Termly",
    amountZMW: 120,
    durationDays: 91,
  },
  yearly: {
    id: "yearly",
    name: "Yearly",
    amountZMW: 400,
    durationDays: 365,
  },

  // ── Pro / Max tiers (matches /pricing marketing page + client PLANS) ──
  // Kept alongside the legacy monthly/termly/yearly so in-flight
  // subscriptions keep working; new checkout flows use these IDs.
  pro_monthly: {
    id: "pro_monthly",
    name: "Pro · Monthly",
    amountZMW: 79,
    durationDays: 30,
  },
  pro_yearly: {
    id: "pro_yearly",
    name: "Pro · Yearly",
    amountZMW: 790,
    durationDays: 365,
  },
  max_monthly: {
    id: "max_monthly",
    name: "Max · Monthly",
    amountZMW: 199,
    durationDays: 30,
  },
  max_yearly: {
    id: "max_yearly",
    name: "Max · Yearly",
    amountZMW: 1990,
    durationDays: 365,
  },
};

const PENDING_STATUSES = new Set(["", "PENDING", "CREATED", "ONGOING"]);
const SUCCESS_STATUSES = new Set(["SUCCESSFUL"]);
const FAILED_STATUSES = new Set(["FAILED", "REJECTED", "TIMEOUT"]);
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const DEFAULT_CURRENCY = "ZMW";
const SANDBOX_CURRENCY = "EUR";
const POLL_DELAYS_MS = [15000, 30000, 45000, 60000, 120000];
const TARGET_ENVIRONMENT_CURRENCIES = {
  sandbox: SANDBOX_CURRENCY,
  mtnzambia: "ZMW",
  mtnghana: "GHS",
  mtnuganda: "UGX",
  mtnivorycoast: "XOF",
  mtncameroon: "XAF",
  mtnbenin: "XOF",
  mtncongo: "XAF",
  mtnswaziland: "SZL",
  mtnguineaconakry: "GNF",
  mtnsouthafrica: "ZAR",
  mtnliberia: "USD",
};

let accessTokenCache = {
  token: "",
  expiresAt: 0,
  baseUrl: "",
  targetEnvironment: "",
};

function getPlanConfig(planId) {
  const plan = PLAN_CATALOG[String(planId || "").trim()];
  if (!plan) {
    throw new HttpsError(
      "invalid-argument",
      "Please choose a valid subscription plan.",
    );
  }
  return plan;
}

function cleanMessage(value, maxLength = 80) {
  return String(value || "")
    .replace(/['"`]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeTargetEnvironment(value) {
  const raw = String(value || "sandbox").trim().toLowerCase();
  return raw || "sandbox";
}

function resolveBaseUrl(targetEnvironment) {
  if (targetEnvironment === "sandbox") {
    return "https://sandbox.momodeveloper.mtn.com";
  }

  // Inference: MTN live integrations are commonly routed through
  // proxy.momoapi.mtn.com. If your live tenant uses a different host,
  // update this helper to match the endpoint from your MTN onboarding docs.
  return "https://proxy.momoapi.mtn.com";
}

function resolveCurrency(targetEnvironment) {
  return TARGET_ENVIRONMENT_CURRENCIES[targetEnvironment] || DEFAULT_CURRENCY;
}

function normalizePhoneNumber(phoneNumber, targetEnvironment) {
  const digits = String(phoneNumber || "").replace(/[^\d]/g, "");
  if (!digits) {
    throw new HttpsError(
      "invalid-argument",
      "Enter the phone number that should receive the MTN prompt.",
    );
  }

  if (targetEnvironment === "sandbox" && /^(467|567)\d{8}$/.test(digits)) {
    return digits;
  }

  if (digits.startsWith("260") && digits.length >= 11 && digits.length <= 12) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `260${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `260${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }

  throw new HttpsError(
    "invalid-argument",
    "Enter a valid MTN number in local format like 096xxxxxxx or with 260.",
  );
}

function nextPollingDelayMs(currentAttempts) {
  const index = Math.min(
    Math.max(Number(currentAttempts) || 0, 0),
    POLL_DELAYS_MS.length - 1,
  );
  return POLL_DELAYS_MS[index];
}

function mapMtnStatus(status, reason = "") {
  const normalizedStatus = String(status || "").trim().toUpperCase();
  const normalizedReason = cleanMessage(reason, 160) || null;

  if (SUCCESS_STATUSES.has(normalizedStatus)) {
    return {
      status: "successful",
      isFinal: true,
      isSuccessful: true,
      mtnStatus: normalizedStatus || "SUCCESSFUL",
      reason: normalizedReason,
    };
  }

  if (FAILED_STATUSES.has(normalizedStatus)) {
    return {
      status: normalizedStatus === "TIMEOUT" ? "timeout" : "failed",
      isFinal: true,
      isSuccessful: false,
      mtnStatus: normalizedStatus,
      reason: normalizedReason,
    };
  }

  if (PENDING_STATUSES.has(normalizedStatus)) {
    return {
      status: "pending",
      isFinal: false,
      isSuccessful: false,
      mtnStatus: normalizedStatus || "PENDING",
      reason: normalizedReason,
    };
  }

  return {
    status: "pending",
    isFinal: false,
    isSuccessful: false,
    mtnStatus: normalizedStatus || "UNKNOWN",
    reason: normalizedReason,
  };
}

function buildMtnConfig({
  apiUser,
  apiKey,
  subscriptionKey,
  environment,
}) {
  const targetEnvironment = normalizeTargetEnvironment(environment);
  return {
    apiUser: String(apiUser || "").trim(),
    apiKey: String(apiKey || "").trim(),
    subscriptionKey: String(subscriptionKey || "").trim(),
    targetEnvironment,
    baseUrl: resolveBaseUrl(targetEnvironment),
    currency: resolveCurrency(targetEnvironment),
  };
}

function assertConfig(config) {
  if (!config.apiUser || !config.apiKey || !config.subscriptionKey) {
    throw new HttpsError(
      "failed-precondition",
      "MTN payment secrets are missing in Firebase Functions.",
    );
  }
}

async function fetchMtn(url, options, operationName) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    console.error(`${operationName} network error`, error);
    throw new HttpsError(
      "unavailable",
      "Could not reach MTN Mobile Money. Please try again.",
    );
  }

  const rawBody = await response.text();
  let parsedBody = {};
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = {raw: rawBody};
    }
  }

  return {response, rawBody, parsedBody};
}

function errorMessageFromMtn(response, parsedBody, fallbackMessage) {
  const detail = parsedBody?.message ||
    parsedBody?.error ||
    parsedBody?.reason ||
    parsedBody?.details ||
    parsedBody?.raw ||
    "";
  return cleanMessage(
    detail || `${fallbackMessage} (MTN ${response.status})`,
    180,
  );
}

async function getAccessToken(config) {
  assertConfig(config);

  if (
    accessTokenCache.token &&
    accessTokenCache.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS &&
    accessTokenCache.baseUrl === config.baseUrl &&
    accessTokenCache.targetEnvironment === config.targetEnvironment
  ) {
    return accessTokenCache.token;
  }

  const {response, parsedBody} = await fetchMtn(
    `${config.baseUrl}/collection/token/`,
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(
          `${config.apiUser}:${config.apiKey}`,
        ).toString("base64")}`,
        "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      },
    },
    "mtn getAccessToken",
  );

  if (!response.ok || !parsedBody?.access_token) {
    console.error("mtn getAccessToken failed", {
      status: response.status,
      parsedBody,
    });
    throw new HttpsError(
      response.status === 401 || response.status === 403 ?
        "failed-precondition" :
        "unavailable",
      errorMessageFromMtn(
        response,
        parsedBody,
        "Could not authenticate with MTN Mobile Money.",
      ),
    );
  }

  accessTokenCache = {
    token: parsedBody.access_token,
    expiresAt: Date.now() + (Number(parsedBody.expires_in) || 3600) * 1000,
    baseUrl: config.baseUrl,
    targetEnvironment: config.targetEnvironment,
  };

  return accessTokenCache.token;
}

async function requestToPay(config, {
  requestId,
  externalId,
  phoneNumber,
  plan,
  payerMessage,
  payeeNote,
}) {
  const accessToken = await getAccessToken(config);
  const body = {
    amount: String(plan.amountZMW),
    currency: config.currency,
    externalId,
    payer: {
      partyIdType: "MSISDN",
      partyId: phoneNumber,
    },
    payerMessage: cleanMessage(payerMessage, 120) || "Premium subscription",
    payeeNote: cleanMessage(payeeNote, 120) || "ZedExams premium subscription",
  };

  const {response, parsedBody} = await fetchMtn(
    `${config.baseUrl}/collection/v1_0/requesttopay`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "X-Reference-Id": requestId,
        "X-Target-Environment": config.targetEnvironment,
        "Ocp-Apim-Subscription-Key": config.subscriptionKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "mtn requestToPay",
  );

  if (response.status !== 202) {
    console.error("mtn requestToPay failed", {
      status: response.status,
      parsedBody,
      requestId,
    });
    throw new HttpsError(
      response.status === 400 ? "invalid-argument" : "unavailable",
      errorMessageFromMtn(
        response,
        parsedBody,
        "MTN rejected the payment request.",
      ),
    );
  }

  return {
    accepted: true,
    requestId,
    requestBody: body,
    rawResponse: parsedBody,
  };
}

async function getRequestToPayStatus(config, requestId) {
  const accessToken = await getAccessToken(config);
  const {response, parsedBody} = await fetchMtn(
    `${config.baseUrl}/collection/v1_0/requesttopay/${requestId}`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "X-Target-Environment": config.targetEnvironment,
        "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      },
    },
    "mtn getRequestToPayStatus",
  );

  if (!response.ok) {
    console.error("mtn getRequestToPayStatus failed", {
      status: response.status,
      parsedBody,
      requestId,
    });
    throw new HttpsError(
      response.status === 404 ? "not-found" : "unavailable",
      errorMessageFromMtn(
        response,
        parsedBody,
        "Could not read the payment status from MTN.",
      ),
    );
  }

  const mapped = mapMtnStatus(parsedBody?.status, parsedBody?.reason);
  return {
    ...mapped,
    raw: parsedBody,
  };
}

module.exports = {
  PLAN_CATALOG,
  buildMtnConfig,
  cleanMessage,
  DEFAULT_CURRENCY,
  getPlanConfig,
  getRequestToPayStatus,
  mapMtnStatus,
  nextPollingDelayMs,
  normalizePhoneNumber,
  requestToPay,
  resolveCurrency,
  verifySettledAmount,
};
