/**
 * mockPaymentProvider — a drop-in mock of the Lenco payment client
 * (functions/lencoService.js) so the FULL authenticated payment lifecycle can
 * be exercised end-to-end WITHOUT real money and without a Lenco account.
 *
 * It implements the exact contract the callables + webhook use — the same
 * exported surface, the same `{ data: { status, id, amount, currency, ... } }`
 * response shape, and the same `verifyWebhookSignature` semantics — so
 * getPaymentProvider() (functions/paymentProvider.js) can swap it in for the
 * real client in an isolated test/emulator environment. It is HARD-guarded from
 * ever being selected in production (see paymentProvider.js).
 *
 * Deterministic scenarios, chosen by the LAST TWO DIGITS of the phone's
 * national number, so a test/QA can drive each branch by picking a number:
 *   • ...00 (default) — success: pending, then `successful` on the 2nd status
 *                       poll (models a delayed callback);
 *   • ...05           — immediate success at initiation;
 *   • ...01           — declined (status `failed`);
 *   • ...02           — provider timeout (initiate throws, like a network hang);
 *   • ...03           — OTP required, then success after the correct OTP (123456);
 *   • ...04           — user cancellation (status `failed`, reason cancelled).
 *
 * Webhook signatures verify against a fixed MOCK_WEBHOOK_KEY, so a test can mint
 * a VALID signature with computeWebhookSignature(rawBody, MOCK_WEBHOOK_KEY) and
 * an INVALID one with any other key — exercising the real fail-closed path.
 */

const lenco = require("./lencoService");

const MOCK_WEBHOOK_KEY = "mock-webhook-key-do-not-use-in-prod";
const CORRECT_OTP = "123456";

// Process-local scenario memory keyed by reference. Mock-only; never persisted,
// never shared across real function instances (production uses the real client).
const store = new Map();

function scenarioFor(phone) {
  const digits = String(lenco.nationalDigits(phone) || "");
  const suffix = digits.slice(-2);
  switch (suffix) {
    case "05": return "immediate";
    case "01": return "declined";
    case "02": return "timeout";
    case "03": return "otp";
    case "04": return "cancelled";
    default: return "success";
  }
}

function wrap(data) {
  return {data, message: data.message || null};
}

async function initiateMobileMoneyCollection({phone, amount, reference}) {
  const scenario = scenarioFor(phone);
  if (scenario === "timeout") {
    const err = new Error("mock provider timed out contacting the mobile-money gateway");
    err.code = "ETIMEDOUT";
    throw err;
  }
  store.set(reference, {scenario, amount, polls: 0, otpOk: false});

  if (scenario === "immediate") {
    return wrap({status: "successful", id: `mock_${reference}`, amount, currency: "ZMW"});
  }
  if (scenario === "otp") {
    return wrap({status: "otp-required", id: `mock_${reference}`, amount, currency: "ZMW"});
  }
  // success / declined / cancelled all begin pending; the terminal outcome is
  // revealed by the status poll / webhook (the realistic MoMo flow).
  return wrap({status: "pending", id: `mock_${reference}`, amount, currency: "ZMW"});
}

async function submitMobileMoneyOtp({reference, otp}) {
  const rec = store.get(reference);
  if (!rec) return wrap({status: "failed", message: "unknown reference"});
  if (String(otp) !== CORRECT_OTP) {
    return wrap({status: "failed", reasonForFailure: "invalid-otp"});
  }
  rec.otpOk = true;
  return wrap({status: "pending"});
}

async function getCollectionStatus({reference}) {
  const rec = store.get(reference);
  if (!rec) return wrap({status: "pending"});
  rec.polls += 1;

  if (rec.scenario === "declined") return wrap({status: "failed", reasonForFailure: "declined"});
  if (rec.scenario === "cancelled") return wrap({status: "failed", reasonForFailure: "cancelled-by-user"});
  if (rec.scenario === "otp" && !rec.otpOk) return wrap({status: "pending"});

  // success / immediate / otp-after-submit: pending on the first poll, then
  // successful — a deliberately delayed callback so tests exercise polling.
  if (rec.scenario === "immediate" || rec.polls >= 2) {
    return wrap({status: "successful", amount: rec.amount, currency: "ZMW", id: `mock_${reference}`});
  }
  return wrap({status: "pending"});
}

/**
 * Verify a webhook signature the same way the real client does, but keyed on
 * the fixed MOCK_WEBHOOK_KEY so tests/QA can produce a valid signature without
 * any real secret. Delegates to the real HMAC-SHA512 implementation.
 */
function verifyWebhookSignature({rawBody, signature}) {
  return lenco.verifyWebhookSignature({rawBody, signature, webhookKey: MOCK_WEBHOOK_KEY});
}

/** Helper for tests/QA to mint a valid mock signature for a raw body. */
function signWebhook(rawBody) {
  return lenco.computeWebhookSignature(rawBody, MOCK_WEBHOOK_KEY);
}

/** Reset the process-local scenario memory (tests). */
function __resetMockStore() {
  store.clear();
}

module.exports = {
  // Pure helpers — delegate to the real client so phone/operator handling and
  // status constants are identical to production.
  STATUS: lenco.STATUS,
  OPERATORS: lenco.OPERATORS,
  isTerminalStatus: lenco.isTerminalStatus,
  nationalDigits: lenco.nationalDigits,
  detectOperator: lenco.detectOperator,
  normalizePhone: lenco.normalizePhone,
  webhookHashKey: lenco.webhookHashKey,
  computeWebhookSignature: lenco.computeWebhookSignature,
  // Mocked network + signature surface.
  initiateMobileMoneyCollection,
  submitMobileMoneyOtp,
  getCollectionStatus,
  verifyWebhookSignature,
  // Mock-only test affordances.
  signWebhook,
  MOCK_WEBHOOK_KEY,
  __resetMockStore,
};
