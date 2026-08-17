"use strict";

/**
 * functions/consentGuard.js — the server half of limited mode.
 *
 * The banner a learner sees is a courtesy. THIS is the enforcement. A Families
 * reviewer will not tap through the UI to check whether Ask Zed is hidden —
 * the test in the spec is explicit: "test with direct API call, not just UI".
 * So every gated capability calls `assertLearnerCapability` and a learner
 * whose guardian has not approved gets a refusal from the function itself.
 *
 * The decision comes from functions/shared/consent/guardianConsentCore, the
 * same module the React app imports, so the two cannot drift.
 *
 * ── Fail-open vs fail-closed, decided per failure ───────────────────────
 *
 * `assertActiveAccount` in authGuard.js fails OPEN on a Firestore read error,
 * for a good reason: a moderation check that fails closed turns a database
 * blip into a platform-wide outage.
 *
 * This guard fails CLOSED, and the difference is deliberate. What is on the
 * other side is a child talking to an AI without a parent's approval. The cost
 * of failing closed is that during a Firestore incident some learners see
 * "check back in a moment" on Ask Zed; the cost of failing open is the exact
 * scenario the whole flow exists to prevent, at precisely the moment nobody is
 * watching the logs. The asymmetry runs the other way from suspension, so the
 * decision does too.
 *
 * Reads of the enforcement flag fail SAFE in the permissive direction, which
 * is the opposite — see resolveEnforceMigration.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// The shared package is ESM and Cloud Functions is CommonJS, so it is reached
// with `await import(...)` INSIDE the async handler — never a top-level
// require. Cached after the first load so the dynamic import is paid once per
// instance rather than once per call.
let corePromise = null;
function loadCore() {
  if (!corePromise) corePromise = import("./shared/consent/guardianConsentCore.js");
  return corePromise;
}

let controlsPromise = null;
function loadControls() {
  if (!controlsPromise) controlsPromise = import("./shared/guardian/guardianControlsCore.js");
  return controlsPromise;
}

/**
 * Which guardian control governs which capability. A capability with no
 * entry is not controllable by a guardian, and the check below skips it —
 * so adding a control is one line here plus one in the shared core, and a
 * capability can never be silently governed by a control nobody declared.
 */
const CAPABILITY_CONTROL = Object.freeze({
  aiChat: "askZed",
});

// Cache the enforcement flag briefly. It is read on every gated call, it
// changes about once in the product's lifetime, and a per-call read of
// settings/global would add a Firestore round trip to every Ask Zed message.
let flagCache = {value: false, at: 0};
const FLAG_TTL_MS = 60 * 1000;

/**
 * Whether accounts predating the consent flow (`guardian` absent) are
 * restricted. Default FALSE — see guardianConsentCore's migration exception:
 * flipping this on before the fleet has migrated locks out every existing
 * learner at once.
 *
 * A failed read resolves to FALSE, i.e. permissive. That is the opposite of
 * this module's usual posture and it is the right way round here: the flag
 * only ever governs accounts nobody has asked yet, so a Firestore blip must
 * not spontaneously lock out the existing user base. Accounts that HAVE been
 * asked are `pending`, and pending is refused regardless of this flag.
 */
async function resolveEnforceMigration(db = admin.firestore()) {
  const now = Date.now();
  if (now - flagCache.at < FLAG_TTL_MS) return flagCache.value;
  try {
    const snap = await db.doc("settings/global").get();
    const value = snap.exists ?
      snap.data()?.featureFlags?.enforceGuardianConsentMigration === true :
      false;
    flagCache = {value, at: now};
    return value;
  } catch (err) {
    console.warn("[consentGuard] flag read failed, staying permissive:", err?.message || err);
    return false;
  }
}

/**
 * Resolve a caller's capabilities from their uid.
 *
 * @return {Promise<{access: object, user: object|null}>}
 */
async function resolveCallerAccess(uid, db = admin.firestore()) {
  const {resolveLearnerAccess} = await loadCore();
  const snap = await db.doc(`users/${uid}`).get();
  const user = snap.exists ? snap.data() : null;
  const enforceMigration = await resolveEnforceMigration(db);
  return {access: resolveLearnerAccess(user, {enforceMigration}), user};
}

// What a learner is told, per reason. Written for a child to read, and each
// one names the way OUT — a refusal that does not say what to do next is how
// a nine-year-old concludes the app is broken.
const MESSAGES = {
  "consent-pending":
    "Ask your parent or guardian to check their messages and approve your account. " +
    "You can keep reading lessons and past papers in the meantime.",
  "consent-expired":
    "The approval link we sent has expired. Tap Resend on the banner at the top of " +
    "your screen and we will send your parent or guardian a new one.",
  "migration-required":
    "We need a parent or guardian to approve your account. Tap the banner at the top " +
    "of your screen to add their details.",
  "guardian-denied":
    "This account has been deactivated at a parent or guardian's request. " +
    "Please contact support@zedexams.com if you think this is a mistake.",
  "no-profile":
    "We could not load your account just now. Please try again in a moment.",
  "unknown-role":
    "We could not load your account just now. Please try again in a moment.",
  // A guardian turned this feature off from the Guardian Zone. It names
  // who decided and what still works, because a child who is told only
  // "not allowed" concludes the app is broken — and the child should ask
  // the person who actually made the decision, not support.
  "guardian-control-off":
    "Your parent or guardian has turned this off for now. Everything else — " +
    "notes, past papers, quizzes and games — still works.",
};

function messageFor(reason) {
  return MESSAGES[reason] || MESSAGES["consent-pending"];
}

/**
 * Refuse the call unless the caller holds `capability`.
 *
 * @param {string} uid
 * @param {string} capability  A CAPABILITY value from guardianConsentCore.
 * @param {object} [deps]      {db} for tests.
 * @return {Promise<object>}   The resolved access record, for logging.
 * @throws {HttpsError}        permission-denied, with details.reason so the
 *                             client can render the right banner.
 */
async function assertLearnerCapability(uid, capability, deps = {}) {
  const db = deps.db || admin.firestore();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  let resolved;
  try {
    resolved = await resolveCallerAccess(uid, db);
  } catch (err) {
    // FAIL CLOSED. See the header: what is behind this gate is a child
    // reaching an AI without a guardian's approval, so an unreadable profile
    // is a refusal, not a pass.
    console.error("[consentGuard] access lookup failed:", err?.message || err);
    throw new HttpsError(
        "unavailable",
        "We could not check your account just now. Please try again in a moment.",
        {reason: "lookup-failed"},
    );
  }

  const {access, user} = resolved;
  if (!access.capabilities.includes(capability)) {
    throw new HttpsError(
        "permission-denied",
        messageFor(access.reason),
        {reason: access.reason, capability, consentStatus: access.status},
    );
  }

  // A guardian's own restriction, set from the Guardian Zone. It is checked
  // HERE rather than at each call site for the reason apiAiChat's comment
  // already records about the consent gate: the SPA uses the SSE endpoint,
  // so gating only the callable would leave the real door open. The user
  // document was read above, so this costs no extra Firestore work.
  const controlKey = CAPABILITY_CONTROL[capability];
  if (controlKey) {
    const {readGuardianControls} = await loadControls();
    if (readGuardianControls(user)[controlKey] === false) {
      throw new HttpsError(
          "permission-denied",
          messageFor("guardian-control-off"),
          {reason: "guardian-control-off", capability, control: controlKey},
      );
    }
  }
  return access;
}

// Test seam: the flag is cached per instance, so a test that flips it needs a
// way to drop the cache. Not exported for production use.
function __resetFlagCache() {
  flagCache = {value: false, at: 0};
}

module.exports = {
  assertLearnerCapability,
  resolveCallerAccess,
  resolveEnforceMigration,
  messageFor,
  MESSAGES,
  __resetFlagCache,
};
