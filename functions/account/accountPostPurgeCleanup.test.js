"use strict";

/**
 * Post-purge cleanup: the shared routine, and the guard that keeps it shared.
 *
 * Two kinds of test here, and the second is the point of the change.
 *
 *   1. Behaviour — the routine picks the identifier its caller actually has,
 *      never throws, and reports a step that could not run distinctly from a
 *      step that found nothing.
 *
 *   2. Parity — a SOURCE scan asserting that neither caller performs cleanup
 *      inline. A behaviour test cannot catch the regression this change is
 *      about: someone adding a third cleanup target to the callable, where the
 *      first two lived, is a diff that reads correctly and passes every test
 *      that exercises the handler. The only way it announces itself is a rule
 *      about where cleanup is allowed to be written. Same reasoning as
 *      test:shim-guard.
 *
 * Run: node functions/account/accountPostPurgeCleanup.test.js
 */

const assert = require("node:assert");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");

const {runPostPurgeCleanup} = require("./accountPostPurgeCleanup");
const {hashEmail} = require("./accountPurgeJobs");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const noopDeps = () => ({
  closeRequests: async () => 0,
  closeRequestsByHash: async () => 0,
  deleteAnalytics: async () => ({ok: true, deleted: 1}),
});

// ── 1. Behaviour ────────────────────────────────────────────────────

test("a caller with an address closes requests by address", async () => {
  const calls = [];
  const summary = await runPostPurgeCleanup({
    uid: "u1",
    db: {},
    email: "Person@Example.com",
    ...noopDeps(),
    closeRequests: async (_db, email) => {
      calls.push(email);
      return 2;
    },
  });
  assert.deepStrictEqual(calls, ["Person@Example.com"]);
  assert.strictEqual(summary.deletionRequestsClosed, 2);
  assert.strictEqual(summary.deletionRequestsMatchedBy, "email");
});

test("a caller with only a hash closes requests by hash", async () => {
  // This is the sweeper. The Auth user is gone, so there is no address to
  // look up and the tombstone deliberately never stored one.
  const calls = [];
  const summary = await runPostPurgeCleanup({
    uid: "u1",
    db: {},
    emailHash: hashEmail("person@example.com"),
    ...noopDeps(),
    closeRequestsByHash: async (_db, hash) => {
      calls.push(hash);
      return 1;
    },
  });
  assert.deepStrictEqual(calls, [hashEmail("person@example.com")]);
  assert.strictEqual(summary.deletionRequestsClosed, 1);
  assert.strictEqual(summary.deletionRequestsMatchedBy, "emailHash");
});

test("an address wins over a hash when both are given", async () => {
  // The address is exact and indexed; the hash is a scan that legacy rows
  // cannot match. Given both, use the better one.
  let byEmail = 0;
  let byHash = 0;
  await runPostPurgeCleanup({
    uid: "u1",
    db: {},
    email: "person@example.com",
    emailHash: hashEmail("person@example.com"),
    ...noopDeps(),
    closeRequests: async () => { byEmail += 1; return 1; },
    closeRequestsByHash: async () => { byHash += 1; return 1; },
  });
  assert.strictEqual(byEmail, 1);
  assert.strictEqual(byHash, 0);
});

test("no identifier is reported as such, not as a clean queue", async () => {
  // A tombstone written for an account with no address on the token has no
  // hash either. "0 rows closed" and "we never looked" must not read the
  // same in the summary — one is a drained queue, the other is a gap.
  const summary = await runPostPurgeCleanup({uid: "u1", db: {}, ...noopDeps()});
  assert.strictEqual(summary.deletionRequestsClosed, "no-identifier");
  assert.strictEqual(summary.deletionRequestsMatchedBy, "none");
});

test("analytics runs for every caller, identifier or not", async () => {
  // The uid is the analytics key, and both paths always have it. This is the
  // step the sweeper was missing entirely, and it has no caveat.
  const seen = [];
  await runPostPurgeCleanup({
    uid: "u-analytics",
    db: {},
    ...noopDeps(),
    deleteAnalytics: async (uid) => {
      seen.push(uid);
      return {ok: true, deleted: 1};
    },
  });
  assert.deepStrictEqual(seen, ["u-analytics"]);
});

test("a throwing request close does not stop the analytics purge", async () => {
  // Order matters here: deletionRequests runs first. If its failure escaped,
  // the step that keeps the Privacy Policy §7 promise would never run — and
  // on the sweeper's path there is no third actor to notice.
  const summary = await runPostPurgeCleanup({
    uid: "u1",
    db: {},
    email: "person@example.com",
    ...noopDeps(),
    closeRequests: async () => { throw new Error("firestore down"); },
  });
  assert.strictEqual(summary.deletionRequestsClosed, "failed");
  assert.strictEqual(summary.analytics.ok, true);
});

test("a throwing analytics purge is reported, never rethrown", async () => {
  // Called after the account is irreversibly gone. Throwing would turn a
  // completed deletion into an error the user is invited to retry, and would
  // reopen a swept job that is genuinely finished.
  const summary = await runPostPurgeCleanup({
    uid: "u1",
    db: {},
    email: "person@example.com",
    ...noopDeps(),
    deleteAnalytics: async () => { throw new Error("posthog down"); },
  });
  assert.strictEqual(summary.analytics.ok, false);
  assert.strictEqual(summary.analytics.error, "threw");
});

// ── 2. Parity — the guard ───────────────────────────────────────────

/**
 * The cleanup steps, by the symbol each one is reached through. A caller that
 * names one of these is doing cleanup inline, which is exactly the shape that
 * left the sweeper behind in the first place.
 */
const CLEANUP_SYMBOLS = [
  "closeDeletionRequests",
  "deleteAnalyticsProfile",
  "analyticsPurge",
];

const CALLERS = [
  "accountCallableHandlers.js",
  "accountPurgeSweeper.js",
  "accountDeletionFlow.js",
];

test("no caller performs post-purge cleanup inline", () => {
  for (const file of CALLERS) {
    const source = readFileSync(join(__dirname, file), "utf8");
    // Comments are where the reasoning lives, and it legitimately names these
    // symbols. The rule is about code.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const symbol of CLEANUP_SYMBOLS) {
      assert.ok(
        !code.includes(symbol),
        `${file} references ${symbol}. Post-purge cleanup belongs in ` +
        "accountPostPurgeCleanup.js so BOTH the callable and the sweeper run " +
        "it. Adding a step to one caller is how the analytics purge came to " +
        "run on the handler path and not the recovery path.",
      );
    }
  }
});

test("both callers actually reach the shared routine", () => {
  // The other half of the rule above. Without this, deleting the call
  // entirely would satisfy "no inline cleanup" — the guard would pass on a
  // path that does no cleanup at all, which is the bug, not the fix.
  for (const file of ["accountCallableHandlers.js", "accountPurgeSweeper.js"]) {
    const source = readFileSync(join(__dirname, file), "utf8");
    assert.ok(
      source.includes("runPostPurgeCleanup"),
      `${file} must call runPostPurgeCleanup — the deletion it finishes is ` +
      "otherwise less complete than the one the other path finishes.",
    );
  }
});

// ── run ─────────────────────────────────────────────────────────────

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok  ${name}`);
    } catch (error) {
      console.error(`  FAIL  ${name}\n        ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} post-purge cleanup tests passed`);
})();
