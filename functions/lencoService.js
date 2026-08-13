/**
 * functions/lencoService.js
 *
 * Lenco (lenco.co / BroadPay) collections API client + pure helpers.
 *
 * Lenco is ZedExams' automated payment provider for Zambia — mobile
 * money (MTN / Airtel / Zamtel) and card collections, charged in ZMW.
 * This module is the thin low-level client; the subscription side
 * effects live in subscriptionActivation.js and the user-facing
 * callables + webhook in index.js.
 *
 * API reference: https://lenco-api.readme.io
 *   Base:  https://api.lenco.co/access/v2   (override via LENCO_API_BASE)
 *   Auth:  Authorization: Bearer <API token>
 *   POST /collections/mobile-money             { operator, bearer, phone, amount, reference, country }
 *   POST /collections/mobile-money/submit-otp  { reference, otp }
 *   POST /collections/card                     { reference, amount, bearer, currency, card{…} }
 *   GET  /collections/status/{reference}
 *
 * Collection status values:
 *   pending | successful | failed | otp-required | pay-offline
 *
 * Webhooks are signed with the `x-lenco-signature` header: an HMAC-SHA512
 * of the raw request body, keyed by webhook_hash_key — which Lenco
 * defines as the SHA256 hash of your API token. See verifyWebhookSignature.
 *
 * Kept dependency-light (only node:crypto + global fetch) so it unit-
 * tests under the repo-root `node` suite without firebase deps — same
 * pattern as functions/cors.js and functions/aiPromptPolicy.js. The
 * network calls accept an injectable `fetchImpl` so tests never hit the
 * wire.
 */

const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://api.lenco.co/access/v2";
const DEFAULT_COUNTRY = "zm";
const DEFAULT_CURRENCY = "ZMW";

// Lenco collection statuses. Non-terminal ones keep the payment doc at
// "pending"; the two terminal ones drive activation / failure.
const STATUS = {
  PENDING: "pending",
  SUCCESSFUL: "successful",
  FAILED: "failed",
  OTP_REQUIRED: "otp-required",
  PAY_OFFLINE: "pay-offline",
};
const TERMINAL_STATUSES = new Set([STATUS.SUCCESSFUL, STATUS.FAILED]);

// Zambian mobile-money operators Lenco supports. The `id` is the value
// sent to Lenco's `operator` field — verify against the live docs and
// adjust here if Lenco expects different codes.
const OPERATORS = [
  {id: "mtn", label: "MTN MoMo", prefixes: ["096", "076"]},
  {id: "airtel", label: "Airtel Money", prefixes: ["097", "077"]},
  {id: "zamtel", label: "Zamtel Kwacha", prefixes: ["095", "075"]},
];

function baseUrl() {
  return (process.env.LENCO_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}

/**
 * Reduce a phone number to its 10-digit national form (0XXXXXXXXX),
 * accepting 09…, +2609…, 2609… and bare 9-digit (9XXXXXXXX). Returns
 * "" when it can't make sense of the input.
 */
function nationalDigits(phone) {
  let d = String(phone || "").replace(/[^\d]/g, "");
  if (d.startsWith("260")) d = d.slice(3);
  // International form drops the trunk 0 → 9 national digits beginning
  // with a mobile prefix (7 or 9 in Zambia). Re-add the 0.
  if (d.length === 9 && /^[79]/.test(d)) d = "0" + d;
  if (d.length === 10 && d.startsWith("0")) return d;
  return "";
}

/**
 * Map a Zambian phone number to a Lenco operator id, or null when the
 * prefix isn't recognised (caller should then ask the user to pick).
 * ZICTA prefixes: MTN 096/076, Airtel 097/077, Zamtel 095/075.
 */
function detectOperator(phone) {
  const national = nationalDigits(phone);
  if (!national) return null;
  const prefix = national.slice(0, 3);
  for (const op of OPERATORS) {
    if (op.prefixes.includes(prefix)) return op.id;
  }
  return null;
}

/**
 * Normalize a Zambian number to the international form Lenco expects:
 * 2609XXXXXXXX (no leading +). Returns "" on invalid input.
 */
function normalizePhone(phone) {
  const national = nationalDigits(phone);
  if (!national) return "";
  return "260" + national.slice(1);
}

/**
 * Low-level Lenco request. Throws on non-2xx with the API's message
 * attached. Lenco wraps payloads as { status, message, data } — callers
 * read the returned `.data`.
 */
async function lencoRequest({apiKey, method = "GET", path, body, fetchImpl}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("global fetch is unavailable; pass fetchImpl");
  }
  if (!apiKey) throw new Error("Lenco API key is not configured.");

  const res = await doFetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "accept": "application/json",
      ...(body ? {"content-type": "application/json"} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = typeof res.text === "function" ? await res.text() : "";
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = null;
  }

  if (!res.ok) {
    const message = json?.message || json?.error || `Lenco API error (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.body = json || text;
    throw error;
  }
  return json;
}

function initiateMobileMoneyCollection({
  apiKey, operator, phone, amount, reference,
  bearer = "merchant", country = DEFAULT_COUNTRY, fetchImpl,
}) {
  return lencoRequest({
    apiKey, fetchImpl, method: "POST",
    path: "/collections/mobile-money",
    body: {operator, bearer, phone, amount, reference, country},
  });
}

function submitMobileMoneyOtp({apiKey, reference, otp, fetchImpl}) {
  return lencoRequest({
    apiKey, fetchImpl, method: "POST",
    path: "/collections/mobile-money/submit-otp",
    body: {reference, otp},
  });
}

/**
 * Card collection. `card` = { number, expiryMonth, expiryYear, cvv, name }.
 *
 * NOTE (PCI): this proxies raw card details through the Cloud Function.
 * That keeps us functional but pulls the function into PCI scope. The
 * preferred long-term path is Lenco's hosted/tokenised checkout (no PAN
 * ever touches our server) — see the PR description. Field names follow
 * the Lenco docs and should be confirmed against the live reference.
 */
function initiateCardCollection({
  apiKey, card = {}, amount, reference,
  bearer = "merchant", currency = DEFAULT_CURRENCY, country = DEFAULT_COUNTRY, fetchImpl,
}) {
  return lencoRequest({
    apiKey, fetchImpl, method: "POST",
    path: "/collections/card",
    body: {
      reference, amount, bearer, currency, country,
      card: {
        "number": String(card.number || "").replace(/\s+/g, ""),
        "cvv": String(card.cvv || ""),
        "expiry-month": String(card.expiryMonth || ""),
        "expiry-year": String(card.expiryYear || ""),
        "name": String(card.name || ""),
      },
    },
  });
}

function getCollectionStatus({apiKey, reference, fetchImpl}) {
  return lencoRequest({
    apiKey, fetchImpl, method: "GET",
    path: `/collections/status/${encodeURIComponent(reference)}`,
  });
}

/**
 * Lenco's webhook_hash_key = SHA256 hex digest of the API token.
 *
 * SECURITY NOTE — this is NOT password hashing. Lenco's webhook protocol
 * *defines* the HMAC key as `SHA256(api token)`: both sides must derive the
 * exact same key, so a salted/slow KDF (scrypt/bcrypt/PBKDF2) cannot be used
 * here — it would never match the key Lenco signs with. The digest is used
 * only as an HMAC-SHA512 key for signature verification (see
 * verifyWebhookSignature) and is never stored or compared as a credential.
 */
function webhookHashKey(apiToken) {
  // codeql[js/insufficient-password-hash] -- provider-mandated HMAC key derivation, not credential storage.
  return crypto.hash("sha256", String(apiToken || ""), "hex");
}

/**
 * HMAC-SHA512 (hex) of the raw body keyed by the webhook hash key.
 */
function computeWebhookSignature(rawBody, hashKey) {
  const data = Buffer.isBuffer(rawBody) ?
    rawBody :
    Buffer.from(String(rawBody == null ? "" : rawBody), "utf8");
  return crypto.createHmac("sha512", hashKey).update(data).digest("hex");
}

/**
 * Candidate HMAC keys to try when verifying a webhook. Lenco's spec
 * ("webhook_hash_key ... a SHA256 hash of your API token") is ambiguous
 * about whether the key is the SHA256 *hex string* or its *raw bytes*, so
 * we accept either derivation (plus an explicit dashboard-provided key).
 * Trying multiple valid derivations can't admit a forgery — an attacker
 * still needs the token to produce any of them.
 */
function candidateHashKeys({apiToken, webhookKey}) {
  const keys = [];
  if (webhookKey) keys.push(webhookKey);
  if (apiToken) {
    // Protocol-mandated derivation — see the SECURITY NOTE on webhookHashKey.
    const hex = webhookHashKey(apiToken);
    keys.push(hex); // SHA256 hex string as the HMAC key (most common)
    keys.push(Buffer.from(hex, "hex")); // SHA256 raw bytes as the HMAC key
  }
  return keys;
}

/**
 * Verify the `x-lenco-signature` header against the raw request body.
 * Accepts a signature matching ANY supported key derivation (see
 * candidateHashKeys) via a timing-safe compare.
 *
 * @param {Object} args
 * @param {Buffer|string} args.rawBody   Exact bytes Lenco signed.
 * @param {string} args.signature        The x-lenco-signature header.
 * @param {string} [args.apiToken]       API token — used to derive the
 *                                        hash key when webhookKey absent.
 * @param {string} [args.webhookKey]     Explicit webhook_hash_key (e.g.
 *                                        from the dashboard).
 * @returns {boolean}
 */
function verifyWebhookSignature({rawBody, signature, apiToken, webhookKey}) {
  if (!signature) return false;
  const sigBuf = Buffer.from(String(signature), "utf8");
  for (const key of candidateHashKeys({apiToken, webhookKey})) {
    const expBuf = Buffer.from(computeWebhookSignature(rawBody, key), "utf8");
    if (expBuf.length !== sigBuf.length) continue;
    try {
      if (crypto.timingSafeEqual(sigBuf, expBuf)) return true;
    } catch (err) {
      // length already guarded; ignore and try the next candidate
    }
  }
  return false;
}

module.exports = {
  STATUS,
  TERMINAL_STATUSES,
  OPERATORS,
  DEFAULT_BASE_URL,
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  baseUrl,
  isTerminalStatus,
  nationalDigits,
  detectOperator,
  normalizePhone,
  lencoRequest,
  initiateMobileMoneyCollection,
  submitMobileMoneyOtp,
  initiateCardCollection,
  getCollectionStatus,
  webhookHashKey,
  computeWebhookSignature,
  verifyWebhookSignature,
};
