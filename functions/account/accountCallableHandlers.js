/**
 * Account, App Check and reCAPTCHA callable HANDLER BODIES, extracted from
 * `functions/index.js` (Phase 5, batch 1b — docs/phase5-plan.md).
 *
 * Same shape as batch 1a: `index.js` keeps every `onCall({...options...},
 * handler)` builder, so region, timeout and App Check enforcement stay
 * declared where the manifest guard reads them, and only the BODY moves here.
 * Each body was byte-identical to the one it replaced at extraction time;
 * `deleteMyAccount` and `bootstrapUserProfile` have since changed on purpose
 * (the deletion-order fix — see accountDeletionFlow.js), and both now delegate
 * their ordering decisions there rather than holding them inline.
 *
 * Dependencies come two ways, deliberately. Anything already living in a
 * module is required directly (rate limiting, reCAPTCHA assessment, account
 * deletion) — the extraction is a chance to stop routing those through
 * index.js, not to deepen it. The two helpers that are genuinely index-local,
 * `cleanString` and `buildBootstrappedUserProfile`, are INJECTED rather than
 * moved: moving them would drag unrelated callers along and make this batch
 * something other than mechanical.
 */
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");

const {createAssessment} = require("../recaptchaEnterprise");
const {
  ANDROID_SITE_KEY,
  resolveProjectId,
  isAssessableToken,
  interpretAssessment,
} = require("../recaptchaAssessmentCore");
const {
  assertCallableRateLimit,
  enforceRateLimit,
  standardBuckets,
  resolveClientIp,
} = require("../rateLimit");
const {purgeUserData, evaluateDeletionAuth} = require("../accountDeletion");
const {
  AccountFlowError,
  runAccountDeletion,
  runProfileBootstrap,
} = require("./accountDeletionFlow");
const {runPostPurgeCleanup} = require("./accountPostPurgeCleanup");

/**
 * Re-throw an `AccountFlowError` as the callable error it describes. The flow
 * module deliberately does not import `firebase-functions` (it is unit-tested
 * under the root install), so the mapping happens here.
 *
 * @param {Error} error
 * @return {never}
 */
function rethrowAsHttpsError(error) {
  if (error instanceof AccountFlowError) {
    throw new HttpsError(error.code, error.message, error.details);
  }
  throw error;
}

/**
 * @param {{cleanString: Function, buildBootstrappedUserProfile: Function}} deps
 */
function buildAccountCallableHandlers({cleanString, buildBootstrappedUserProfile}) {
  return {
    appCheckPing:   async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    return {attested: Boolean(request.app)};
  },

    bootstrapUserProfile:   async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const uid = request.auth.uid;

    // The decisions — including the two refusals that stop a repair
    // resurrecting a deleted account — live in accountDeletionFlow.js.
    try {
      return await runProfileBootstrap({
        uid,
        tokenRole: cleanString(request.auth.token?.role || "", 30),
        db: admin.firestore(),
        auth: admin.auth(),
        buildProfile: buildBootstrappedUserProfile,
      });
    } catch (error) {
      rethrowAsHttpsError(error);
    }
  },

    deleteMyAccount:   async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    const uid = request.auth.uid;

    // Burst guard: deleting is a rare, deliberate action. A low per-user cap
    // stops a scripted/leaked-token loop while never troubling a real user
    // (fail-open — a degraded limiter must not block a legitimate deletion).
    await assertCallableRateLimit(request, {action: "deleteMyAccount", userPerMin: 5});

    // Step-up: require a recent re-authentication. Fails closed on a missing
    // auth_time claim (evaluateDeletionAuth).
    const authCheck = evaluateDeletionAuth(request.auth.token);
    if (!authCheck.ok) {
      throw new HttpsError(
        "failed-precondition",
        "For your security, please confirm your identity, then delete your account.",
        {reason: authCheck.reason},
      );
    }

    // Session first, then data, then proof — see accountDeletionFlow.js for
    // why that order is load-bearing and what the tombstone it writes is for.
    // Throws (never returns a half-success) when the purge cannot be verified.
    let summary;
    try {
      ({summary} = await runAccountDeletion({
        uid,
        email: request.auth.token?.email,
        db: admin.firestore(),
        auth: admin.auth(),
        FieldValue: admin.firestore.FieldValue,
        purge: purgeUserData,
        // A cancellation that cannot be written is the one failure on this path
        // that leaves the guarantee unmade — page someone rather than log it.
        alert: require("../opsAlert").sendOpsAlert,
      }));
    } catch (error) {
      rethrowAsHttpsError(error);
    }

    // ── Post-purge cleanup ────────────────────────────────────────────
    // ONE routine, shared with the sweeper (accountPostPurgeCleanup.js). It
    // used to be two inline try/catch blocks right here, which is why a
    // deletion the sweeper completed never deleted the PostHog profile and
    // never drained the support queue — the steps were unreachable from the
    // recovery path. Add a new cleanup target THERE, not here.
    //
    // request.auth.token.email is the verified address on the session, and the
    // reason the handler closes deletion requests by address while the sweeper
    // can only go by hash.
    Object.assign(summary, await runPostPurgeCleanup({
      uid,
      db: admin.firestore(),
      email: request.auth.token?.email,
    }));

    console.log(
      `deleteMyAccount uid=${uid} summary=${JSON.stringify(summary)}`,
    );
    return {success: true, summary};
  },

    assessRecaptcha:   async (request) => {
    const token = cleanString(request.data?.token, 4000);
    const action = cleanString(request.data?.action, 50);

    if (!isAssessableToken(token)) {
      return {verdict: "skip", reason: "no-token"};
    }

    // This endpoint is public (must run pre-auth) and every assessable token
    // reaches a BILLED reCAPTCHA Enterprise Assessment call. Cap per source IP
    // so it can't be driven to rack up Assessment-API spend. On block we return
    // the same fail-open "skip" verdict rather than throwing — a real user
    // never approaches the cap, and skipping preserves the never-block-sign-in
    // contract while still avoiding the paid call.
    try {
      const ip = request.rawRequest ? resolveClientIp(request.rawRequest) : "unknown";
      const rl = await enforceRateLimit(
        admin.firestore(),
        standardBuckets({action: "recaptcha-assess", ip, ipPerMin: 60}),
      );
      if (!rl.allowed) {
        return {verdict: "skip", reason: "rate-limited"};
      }
    } catch (_rlErr) { /* fail-open: limiter trouble must not block sign-in */ }

    try {
      const assessment = await createAssessment({
        token,
        action: action || undefined,
        siteKey: ANDROID_SITE_KEY,
        projectId: resolveProjectId(),
      });
      const result = interpretAssessment(assessment, {expectedAction: action});
      // Operator breadcrumb — score distribution informs threshold tuning.
      // Never log the token itself.
      console.log(
        `assessRecaptcha action=${action || "(none)"} verdict=${result.verdict} ` +
        `score=${result.score} valid=${result.valid}` +
        (result.invalidReason ? ` invalidReason=${result.invalidReason}` : "") +
        (result.actionMismatch ? " actionMismatch=true" : ""),
      );
      return result;
    } catch (err) {
      // Fail open: a broken/unconfigured assessment must never block sign-in.
      console.error("assessRecaptcha failed:", err?.message || err);
      return {verdict: "skip", reason: "assessment-error"};
    }
  },
  };
}

module.exports = {buildAccountCallableHandlers};
