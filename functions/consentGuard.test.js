"use strict";

/**
 * consentGuard — the SERVER half of limited mode.
 *
 * The compliance test in the spec is explicit: "test with direct API call, not
 * just UI". So these tests are about the guard refusing, not about a banner
 * rendering. The cases that matter are the ones where a gate quietly stops
 * being a gate: a Firestore blip, a flag nobody flipped, a capability string
 * renamed on one side of the CommonJS/ESM boundary.
 *
 * Plain `node` script. Run: node functions/consentGuard.test.js
 */

const assert = require("node:assert");

let guard = null;
try {
  require.resolve("firebase-functions/v2/https");
  guard = require("./consentGuard");
} catch (_e) { /* skipped below on a root-deps run */ }

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A Firestore stand-in: users/{uid} plus settings/global.
function fakeDb({user, flag = false, throwOn = null} = {}) {
  return {
    doc: (path) => ({
      get: async () => {
        if (throwOn && path.startsWith(throwOn)) throw new Error("firestore down");
        if (path === "settings/global") {
          return {exists: true, data: () => ({featureFlags: {enforceGuardianConsentMigration: flag}})};
        }
        return {exists: !!user, data: () => user};
      },
    }),
  };
}

const learner = (guardian, extra = {}) => ({role: "learner", guardian, ...extra});

async function refused(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

(async () => {
  console.log("consentGuard");

  if (!guard) {
    console.log("  skipped — firebase-functions not installed (root-deps run).");
    return;
  }
  const {assertLearnerCapability, resolveEnforceMigration, messageFor, MESSAGES, __resetFlagCache} = guard;

  // ── The capability strings must match the shared core ──────────────────
  await test("the CommonJS capability strings match the shared ESM core", async () => {
    // functions/index.js cannot import the ESM package at module scope, so it
    // carries the capability names as plain strings. That duplication is only
    // safe while something fails when they drift — this is that something.
    const {CAPABILITY} = await import("./shared/consent/guardianConsentCore.js");
    const indexSrc = require("node:fs").readFileSync(require.resolve("./index.js"), "utf8");
    assert.match(indexSrc, /const CAPABILITY_AI_CHAT = "aiChat";/,
        "index.js must pin the aiChat capability string");
    assert.strictEqual(CAPABILITY.AI_CHAT, "aiChat");
    assert.strictEqual(CAPABILITY.SOCIAL, "social");
    // No callable consumes SOCIAL any more — its only caller was the
    // learner/teacher class-join flow, removed with that feature. The
    // capability stays in the consent taxonomy so a stored consent record
    // keeps its meaning; assert the string so a future consumer inherits it.
  });

  // ── Refusals ───────────────────────────────────────────────────────────
  await test("a pending learner is refused the AI assistant", async () => {
    __resetFlagCache();
    const err = await refused(() => assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner({consentStatus: "pending"})})}));
    assert.ok(err, "expected a refusal");
    assert.strictEqual(err.code, "permission-denied");
    assert.strictEqual(err.details.reason, "consent-pending");
  });

  await test("a pending learner is refused the social capability", async () => {
    __resetFlagCache();
    const err = await refused(() => assertLearnerCapability(
        "u1", "social", {db: fakeDb({user: learner({consentStatus: "pending"})})}));
    assert.strictEqual(err.code, "permission-denied");
  });

  await test("a denied learner is refused everything, including browsing", async () => {
    __resetFlagCache();
    for (const cap of ["aiChat", "social", "browse"]) {
      const err = await refused(() => assertLearnerCapability(
          "u1", cap, {db: fakeDb({user: learner({consentStatus: "denied"})})}));
      assert.ok(err, `${cap} should be refused for a denied account`);
      assert.strictEqual(err.details.reason, "guardian-denied");
    }
  });

  await test("an approved learner passes", async () => {
    __resetFlagCache();
    const access = await assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner({consentStatus: "granted"})})});
    assert.strictEqual(access.limited, false);
  });

  // ── Guardian controls (the Guardian Zone's switches) ───────────────────
  //
  // These live HERE, on the shared gate, rather than at each call site: the
  // SPA reaches Zed through the apiAiChat SSE endpoint, so a check that only
  // covered the callable would leave the real door open — the same lesson
  // apiAiChat's own comment records about the consent gate.
  await test("a guardian who turned Ask Zed off refuses an APPROVED learner", async () => {
    __resetFlagCache();
    const err = await refused(() => assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner(
            {consentStatus: "granted"}, {guardianControls: {askZed: false}})})}));
    assert.ok(err, "expected a refusal");
    assert.strictEqual(err.code, "permission-denied");
    assert.strictEqual(err.details.reason, "guardian-control-off");
    assert.strictEqual(err.details.control, "askZed");
    // The child is told who decided and what still works — a refusal that
    // does not say what to do next is how a nine-year-old concludes the app
    // is broken.
    assert.match(err.message, /parent or guardian/i);
    assert.match(err.message, /still works/i);
  });

  await test("the control gates ONLY its capability", async () => {
    __resetFlagCache();
    // Turning Ask Zed off must not stop a child reading a past paper.
    const access = await assertLearnerCapability(
        "u1", "browse", {db: fakeDb({user: learner(
            {consentStatus: "granted"}, {guardianControls: {askZed: false}})})});
    assert.strictEqual(access.limited, false);
  });

  await test("an absent or non-boolean control is not a restriction", async () => {
    // No guardian has expressed a view. Treating that as OFF would lock a
    // feature nobody chose to lock.
    for (const controls of [undefined, {}, {askZed: null}, {askZed: "false"}, {askZed: 0}]) {
      __resetFlagCache();
      const access = await assertLearnerCapability(
          "u1", "aiChat", {db: fakeDb({user: learner(
              {consentStatus: "granted"}, {guardianControls: controls})})});
      assert.strictEqual(access.limited, false,
          `guardianControls ${JSON.stringify(controls)} should not restrict`);
    }
  });

  await test("a guardian's ON is simply not a restriction", async () => {
    __resetFlagCache();
    const access = await assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner(
            {consentStatus: "granted"}, {guardianControls: {askZed: true}})})});
    assert.strictEqual(access.limited, false);
  });

  await test("teachers are not caught by the learner gate", async () => {
    __resetFlagCache();
    const access = await assertLearnerCapability("t1", "aiChat", {db: fakeDb({user: {role: "teacher"}})});
    assert.strictEqual(access.reason, "not-a-learner");
  });

  await test("an unauthenticated call is refused before any read", async () => {
    const err = await refused(() => assertLearnerCapability("", "aiChat", {db: fakeDb({})}));
    assert.strictEqual(err.code, "unauthenticated");
  });

  // ── Fail-closed on error ───────────────────────────────────────────────
  await test("a Firestore failure REFUSES rather than waving the call through", async () => {
    // Deliberately the opposite of authGuard's assertActiveAccount, which
    // fails open. Behind this gate is a child reaching an AI without a
    // parent's approval; behind that one is a moderation check whose failure
    // would take the platform down. The asymmetry runs the other way.
    __resetFlagCache();
    const err = await refused(() => assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner(null), throwOn: "users/"})}));
    assert.ok(err, "a lookup failure must not pass");
    assert.strictEqual(err.code, "unavailable");
    assert.strictEqual(err.details.reason, "lookup-failed");
  });

  await test("a missing profile is refused, not treated as an adult", async () => {
    __resetFlagCache();
    const err = await refused(() => assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: null, flag: true})}));
    assert.strictEqual(err.code, "permission-denied");
  });

  // ── The migration flag ─────────────────────────────────────────────────
  await test("an account predating the flow passes while migration is unenforced", async () => {
    // The default. Restricting these on day one would take Ask Zed away from
    // the entire existing learner base in a single deploy.
    __resetFlagCache();
    const access = await assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner(null), flag: false})});
    assert.strictEqual(access.reason, "migration-grace");
  });

  await test("flipping the flag really does restrict them", async () => {
    __resetFlagCache();
    const err = await refused(() => assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner(null), flag: true})}));
    assert.strictEqual(err.details.reason, "migration-required");
  });

  await test("the flag does not rescue a pending account", async () => {
    __resetFlagCache();
    const err = await refused(() => assertLearnerCapability(
        "u1", "aiChat", {db: fakeDb({user: learner({consentStatus: "pending"}), flag: false})}));
    assert.ok(err, "pending must be refused whether or not migration is enforced");
  });

  await test("an unreadable flag stays PERMISSIVE, unlike everything else here", async () => {
    // Opposite posture on purpose: the flag only ever governs accounts nobody
    // has asked yet, so a Firestore blip must not spontaneously lock out the
    // existing user base.
    __resetFlagCache();
    const value = await resolveEnforceMigration({
      doc: () => ({get: async () => { throw new Error("down"); }}),
    });
    assert.strictEqual(value, false);
  });

  // ── What the learner is told ───────────────────────────────────────────
  await test("every refusal names a way out", async () => {
    // A refusal with no next step is how a nine-year-old concludes the app is
    // broken.
    for (const [reason, text] of Object.entries(MESSAGES)) {
      assert.ok(text.length > 20, `${reason} message is too terse to act on`);
      assert.ok(
          /parent or guardian|Resend|support@zedexams\.com|try again/i.test(text),
          `${reason} message gives no next step: ${text}`,
      );
    }
  });

  await test("an unmapped reason still produces a usable message", () => {
    assert.strictEqual(messageFor("something-new"), MESSAGES["consent-pending"]);
  });

  console.log(`\nconsentGuard: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
