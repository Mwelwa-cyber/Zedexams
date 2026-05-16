/**
 * functions/momoSettlement.js
 *
 * Pure, dependency-free MoMo settlement verification. Kept standalone (no
 * firebase-functions / firebase-admin imports) so it is unit-tested by the
 * repo-root `npm run test:all` without installing functions/ deps — same
 * rationale as functions/aiPromptPolicy.js.
 *
 * Why this exists: markPaymentSuccessful used to grant the full plan the
 * moment MTN reported SUCCESSFUL, sized purely from the stored planId,
 * without ever checking the amount/currency MTN actually settled. The MTN
 * requesttopay status body echoes the processed `amount` + `currency`
 * (preserved on statusResult.raw) — so an under-payment, a currency
 * mismatch (sandbox EUR vs live ZMW confusion), a partial/altered
 * settlement, or any future code path that lets the charged amount drift
 * from the plan price would still have activated a paid subscription.
 *
 * Fail-closed: anything we cannot positively confirm equals the plan
 * price in the expected currency returns ok:false, so the caller holds
 * the payment for manual reconciliation instead of granting on trust.
 *
 * @param {{amountZMW:number}} plan         getPlanConfig(paymentData.planId)
 * @param {string} expectedCurrency         paymentData.currency (set at
 *                                          create from config.currency)
 * @param {object} rawStatusResponse        statusResult.raw (MTN body)
 * @returns {{ok:boolean, reason:(string|null)}}
 */
function verifySettledAmount(plan, expectedCurrency, rawStatusResponse) {
  if (!plan || typeof plan.amountZMW !== "number" ||
      !Number.isFinite(plan.amountZMW)) {
    return {ok: false, reason: "plan_invalid"};
  }
  if (!rawStatusResponse || typeof rawStatusResponse !== "object") {
    return {ok: false, reason: "provider_response_missing"};
  }

  const rawAmount = rawStatusResponse.amount;
  if (rawAmount === undefined || rawAmount === null ||
      String(rawAmount).trim() === "") {
    return {ok: false, reason: "provider_amount_missing"};
  }
  const settled = Number(String(rawAmount).trim());
  if (!Number.isFinite(settled)) {
    return {ok: false, reason: "provider_amount_unparseable"};
  }
  if (settled !== Number(plan.amountZMW)) {
    return {ok: false, reason: "amount_mismatch"};
  }

  if (expectedCurrency) {
    const got = String(rawStatusResponse.currency || "").trim().toUpperCase();
    if (!got || got !== String(expectedCurrency).trim().toUpperCase()) {
      return {ok: false, reason: "currency_mismatch"};
    }
  }

  return {ok: true, reason: null};
}

module.exports = {verifySettledAmount};
