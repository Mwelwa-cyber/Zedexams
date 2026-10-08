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
const {enforceRateLimit, standardBuckets, resolveClientIp} = require("../rateLimit");
const {
  decideLinkUse,
  hashToken,
  paymentBelongsToRequest,
  publicPaymentResult,
  syntheticChildRequest,
} = require("./linkPaymentCore");

const REQUESTS = "guardianRequests";

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
 * @param {Function} [deps.settleGuardianRequest]
 * @param {Function} [deps.getDb]
 * @param {Function} [deps.limit]  (db, buckets) => {allowed} — injectable for tests
 */
function buildLinkPaymentHandlers({
  paymentHandlers,
  settleGuardianRequest = (args) => require("./index").settleGuardianRequest(args),
  getDb = getFirestore,
  limit = enforceRateLimit,
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
        data: {
          // The plan is the REQUEST's, not the client's. The amount is then
          // derived from it inside the handler, as for any other payment.
          planId: record.planId,
          method: "mobile_money",
          phone: request.data?.phone,
          operator: request.data?.operator,
        },
      }));

      // Tie the payment to this request so activation settles it (marks the
      // link paid and tells the child) even if the webhook lands before any
      // poll does. Written before the client ever sees the payment id, so the
      // follow-up calls below can prove ownership.
      if (res?.paymentId) {
        try {
          await getDb().collection("payments").doc(res.paymentId).update({
            guardianRequestId: requestId, startedVia: "guardian_link",
          });
        } catch (err) {
          console.error("[linkPayment] could not tag payment with its request", err?.message || err);
        }
      }
      if (res?.alreadyPaid) await settleGuardianRequest({requestId});

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
      if (res?.status === "successful") await settleGuardianRequest({requestId});
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
      if (res?.status === "successful") await settleGuardianRequest({requestId});
      return publicPaymentResult({...res, paymentId});
    },
  };
}

module.exports = {buildLinkPaymentHandlers};
