"use strict";

/**
 * linkPayment — pay from the guardian pay link with no login.
 *
 * Three UNAUTHENTICATED callables, each a thin wrapper that proves the caller
 * holds a valid one-time token and then hands the real work to the existing
 * payment handlers (`initiateLencoPayment`, `getLencoPaymentStatus`,
 * `submitLencoOtp`) as the CHILD the token names. There is deliberately no
 * second implementation of "start a Lenco charge": a copy of that body is a
 * fork where the two halves keep working on different rules until a family
 * disputes a charge. See linkPaymentCore.js for the trust model.
 *
 * ── Why a synthetic request is acceptable here ─────────────────────────
 *
 * `syntheticChildRequest` fabricates an `auth` object. It is built in exactly
 * one place, only AFTER the token has been matched to a stored, outstanding
 * request, and it carries no email and no claims — so the delegated handler's
 * suspension / deletion check still runs and nothing else is granted. What the
 * token authorises is narrow: this child, this request's plan, at the plan's
 * server-side price. The client chooses a phone number and a network, nothing
 * more.
 *
 * ── Abuse ──────────────────────────────────────────────────────────────
 *
 * Starting a charge sends a prompt to a phone number the caller typed, so
 * `start` is limited per TOKEN and per source IP and FAILS CLOSED if the
 * limiter itself is unwell (the other limiters in this codebase fail open,
 * because they protect reads; this one protects a message to a stranger's
 * phone). Following a payment moves no money and is limited generously.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore} = require("firebase-admin/firestore");
const {checkRateLimit, standardBuckets, resolveClientIp} = require("../rateLimit");
const {
  decideLinkUse,
  hashToken,
  paymentBelongsToRequest,
  publicPaymentResult,
  syntheticChildRequest,
} = require("./linkPaymentCore");

const REQUESTS = "guardianRequests";

/** The stored quote as a positive number, or nothing — `Number(null)` is 0, which would refuse every payment. */
function quotedAmount(record) {
  const raw = record && record.priceZMW;
  if (raw === null || raw === undefined || raw === "") return {};
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? {expectedAmountZMW: n} : {};
}

/**
 * The production limiter, minus its fail-open.
 *
 * `rateLimit.enforceRateLimit` swallows a Firestore failure inside
 * `checkRateLimit` and reports `{allowed: true}` — by design for the AI/TTS
 * surfaces it was written for, and it throws away the `degraded` flag on the
 * way out. For an endpoint that sends a payment prompt to a phone number a
 * stranger typed, "the limiter is broken" must mean "no", so this walks the
 * buckets itself and surfaces `degraded`.
 */
async function strictLimit(db, buckets) {
  let degraded = false;
  for (const b of buckets) {
    if (!b) continue;
    const r = await checkRateLimit(db, b.scope, {limit: b.limit, windowMs: b.windowMs});
    if (!r.allowed) return r;
    if (r.degraded) degraded = true;
  }
  return {allowed: true, degraded};
}

function clientIp(request) {
  try {
    return request.rawRequest ? resolveClientIp(request.rawRequest) : "unknown";
  } catch (_err) {
    return "unknown";
  }
}

/**
 * @param {object} deps
 * @param {object} deps.paymentHandlers  the built payment handlers
 * @param {Function} [deps.getDb]
 * @param {Function} [deps.limit]  (db, buckets) => {allowed} — injectable for tests
 */
function buildLinkPaymentHandlers({
  paymentHandlers,
  getDb = getFirestore,
  limit = strictLimit,
} = {}) {
  async function loadRequest(request, purpose) {
    const requestId = hashToken(request.data?.token);
    if (!requestId) throw new HttpsError("invalid-argument", "This link is incomplete.", {reason: "missing"});
    const snap = await getDb().collection(REQUESTS).doc(requestId).get();
    const record = snap.exists ? (snap.data() || {}) : null;
    const verdict = decideLinkUse({record, purpose});
    if (!verdict.ok) throw new HttpsError(verdict.code, verdict.message, {reason: verdict.reason});
    return {requestId, record, childUid: record.uid};
  }

  async function throttle(request, requestId, {action, tokenPerMin, ipPerMin, failClosed}) {
    let result;
    try {
      result = await limit(getDb(), standardBuckets({
        action, uid: requestId.slice(0, 40), ip: clientIp(request), userPerMin: tokenPerMin, ipPerMin,
      }));
    } catch (err) {
      console.warn(`[linkPayment] ${action} limiter failed`, err?.message || err);
      if (failClosed) {
        throw new HttpsError("unavailable", "We are busy right now. Please try again in a minute.");
      }
      return;
    }
    if (failClosed && result?.degraded) {
      console.warn(`[linkPayment] ${action} limiter degraded — refusing`);
      throw new HttpsError("unavailable", "We are busy right now. Please try again in a minute.");
    }
    if (!result?.allowed) {
      throw new HttpsError("resource-exhausted", "Too many tries. Please wait a minute and try again.", {reason: "rate-limited"});
    }
  }

  async function ownedPayment(requestId, childUid, paymentId) {
    const id = typeof paymentId === "string" ? paymentId.trim().slice(0, 60) : "";
    if (!id) throw new HttpsError("invalid-argument", "Payment reference is required.");
    const snap = await getDb().collection("payments").doc(id).get();
    if (!snap.exists || !paymentBelongsToRequest({payment: snap.data(), childUid, requestId})) {
      throw new HttpsError("permission-denied", "This payment does not belong to this link.");
    }
    return id;
  }

  return {
    guardianLinkPay: async (request) => {
      const {requestId, record, childUid} = await loadRequest(request, "start");
      await throttle(request, requestId, {
        action: "guardian-link-pay", tokenPerMin: 3, ipPerMin: 6, failClosed: true,
      });

      const res = await paymentHandlers.initiateLencoPayment(syntheticChildRequest({
        childUid,
        rawRequest: request.rawRequest,
        // Written into the payment document in the SAME transaction that
        // creates it (see initiateLencoPayment), so activation — which settles
        // the request and tells the child — can never see an untagged payment,
        // however fast the webhook lands.
        trustedPaymentFields: {guardianRequestId: requestId},
        data: {
          // The plan is the REQUEST's, not the client's. The amount is then
          // derived from it inside the handler, as for any other payment.
          planId: record.planId,
          method: "mobile_money",
          phone: request.data?.phone,
          operator: request.data?.operator,
          // The price the guardian was QUOTED. The handler refuses to charge a
          // different amount, so a plan repriced inside the link's seven days
          // is a "the amount has changed" answer, not a bigger charge.
          ...quotedAmount(record),
        },
      }));

      // A payment REUSED from an earlier attempt predates this call's tag.
      // Tag it now, but only if it is the child's and carries no request yet.
      if (res?.paymentId && res.reused) {
        try {
          const ref = getDb().collection("payments").doc(res.paymentId);
          const snap = await ref.get();
          const pay = snap.exists ? (snap.data() || {}) : null;
          if (pay && pay.userId === childUid && !pay.guardianRequestId) {
            await ref.update({guardianRequestId: requestId, startedVia: "guardian_link"});
          }
        } catch (err) {
          console.error("[linkPayment] could not tag a reused payment", err?.message || err);
        }
      }

      return publicPaymentResult(res);
    },

    guardianLinkPayStatus: async (request) => {
      const {requestId, childUid} = await loadRequest(request, "follow");
      await throttle(request, requestId, {
        action: "guardian-link-status", tokenPerMin: 40, ipPerMin: 80, failClosed: false,
      });
      const paymentId = await ownedPayment(requestId, childUid, request.data?.paymentId);

      const res = await paymentHandlers.getLencoPaymentStatus(syntheticChildRequest({
        childUid, rawRequest: request.rawRequest, data: {paymentId},
      }));
      // Settlement is NOT done here: `subscriptionActivation` marks the request
      // paid and tells the child only after it has actually granted access. A
      // provider status of "successful" is not that — activation can withhold
      // access (an amount mismatch) or fail after the provider answered.
      return publicPaymentResult({...res, paymentId});
    },

    guardianLinkPayOtp: async (request) => {
      const {requestId, childUid} = await loadRequest(request, "follow");
      await throttle(request, requestId, {
        action: "guardian-link-otp", tokenPerMin: 8, ipPerMin: 16, failClosed: true,
      });
      const paymentId = await ownedPayment(requestId, childUid, request.data?.paymentId);

      const res = await paymentHandlers.submitLencoOtp(syntheticChildRequest({
        childUid, rawRequest: request.rawRequest, data: {paymentId, otp: request.data?.otp},
      }));
      return publicPaymentResult({...res, paymentId});
    },
  };
}

module.exports = {buildLinkPaymentHandlers};
