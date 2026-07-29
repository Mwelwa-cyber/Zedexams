"use strict";

// PostHog profile deletion on account purge (Privacy Policy §7).
//
// This step runs after the account is already irreversibly gone, which fixes
// what the tests have to prove: it must never throw, it must never hang, it
// must delete the EVENTS as well as the person, and — the one that would be
// invisible in production — it must not report "nothing to do" when what
// actually happened is "we failed".
//
// Plain `node` script (repo convention). Run: node functions/analyticsPurge.test.js

const assert = require("node:assert");
const {deleteAnalyticsProfile} = require("./analyticsPurge");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ENV = {
  POSTHOG_PERSONAL_API_KEY: "phx_test",
  POSTHOG_PROJECT_ID: "416847",
};

function fetchStub(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({url: String(url), method: init.method || "GET"});
    for (const [pattern, response] of routes) {
      if (String(url).includes(pattern) && (init.method || "GET") === response.method) {
        if (response.throw) throw new Error(response.throw);
        return {
          ok: response.status < 400,
          status: response.status,
          json: async () => response.body,
        };
      }
    }
    throw new Error(`unstubbed ${init.method || "GET"} ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const FOUND_ONE = [
  ["/persons/?distinct_id=", {method: "GET", status: 200, body: {results: [{id: "p-1"}]}}],
  ["/persons/p-1/", {method: "DELETE", status: 204, body: {}}],
];

(async () => {
  console.log("analyticsPurge");

  await test("deletes the person AND their events", async () => {
    const fetchImpl = fetchStub(FOUND_ONE);
    const r = await deleteAnalyticsProfile("uid-1", {env: ENV, fetchImpl});
    assert.deepStrictEqual({ok: r.ok, deleted: r.deleted}, {ok: true, deleted: 1});
    const del = fetchImpl.calls.find((c) => c.method === "DELETE");
    // Without delete_events the event history survives, still keyed to the
    // uid — the profile would be gone and the data would not.
    assert.ok(del.url.includes("delete_events=true"), "must request event deletion");
  });

  await test("looks the person up by Firebase uid", async () => {
    const fetchImpl = fetchStub(FOUND_ONE);
    await deleteAnalyticsProfile("uid-abc", {env: ENV, fetchImpl});
    assert.ok(fetchImpl.calls[0].url.includes("distinct_id=uid-abc"));
  });

  await test("a learner with no profile is a normal outcome, not a failure", async () => {
    // Learner accounts are never identified to PostHog, so there is
    // legitimately nothing to delete. This must not read as an error.
    const fetchImpl = fetchStub([
      ["/persons/?distinct_id=", {method: "GET", status: 200, body: {results: []}}],
    ]);
    const r = await deleteAnalyticsProfile("uid-learner", {env: ENV, fetchImpl});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.skipped, "no-person");
  });

  await test("unconfigured is distinguishable from failed", async () => {
    // The two need opposite responses from whoever reads the log: one is
    // "switched off", the other is "the promise in §7 is not being kept".
    const off = await deleteAnalyticsProfile("uid-1", {env: {}, fetchImpl: fetchStub([])});
    assert.strictEqual(off.skipped, "not-configured");
    assert.strictEqual(off.ok, true);

    const failed = await deleteAnalyticsProfile("uid-1", {
      env: ENV,
      fetchImpl: fetchStub([
        ["/persons/?distinct_id=", {method: "GET", status: 500, body: {}}],
      ]),
    });
    assert.strictEqual(failed.ok, false);
    assert.ok(failed.error, "a failure must carry an error");
    assert.notStrictEqual(failed.skipped, "not-configured");
  });

  await test("never throws when PostHog is unreachable", async () => {
    const r = await deleteAnalyticsProfile("uid-1", {
      env: ENV,
      fetchImpl: fetchStub([
        ["/persons/?distinct_id=", {method: "GET", status: 200, throw: "ECONNREFUSED"}],
      ]),
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /ECONNREFUSED/);
  });

  await test("does not hang when PostHog never answers", async () => {
    // The user's account is already deleted; they must not wait on a vendor.
    const started = Date.now();
    const r = await deleteAnalyticsProfile("uid-1", {
      env: ENV,
      timeoutMs: 50,
      fetchImpl: (url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    assert.strictEqual(r.ok, false);
    assert.ok(Date.now() - started < 2000, "must abort well inside the callable timeout");
  });

  await test("a partial delete is reported as not-ok", async () => {
    const fetchImpl = fetchStub([
      ["/persons/?distinct_id=", {
        method: "GET", status: 200, body: {results: [{id: "p-1"}, {id: "p-2"}]},
      }],
      ["/persons/p-1/", {method: "DELETE", status: 204, body: {}}],
      ["/persons/p-2/", {method: "DELETE", status: 500, body: {}}],
    ]);
    const r = await deleteAnalyticsProfile("uid-1", {env: ENV, fetchImpl});
    assert.strictEqual(r.deleted, 1);
    assert.strictEqual(r.ok, false, "one of two deleted is not a success");
  });

  await test("an already-gone person counts as deleted", async () => {
    // 404 on the DELETE means the desired end state holds. Reporting that as
    // a failure would make a retried purge look permanently broken.
    const fetchImpl = fetchStub([
      ["/persons/?distinct_id=", {method: "GET", status: 200, body: {results: [{id: "p-1"}]}}],
      ["/persons/p-1/", {method: "DELETE", status: 404, body: {}}],
    ]);
    const r = await deleteAnalyticsProfile("uid-1", {env: ENV, fetchImpl});
    assert.strictEqual(r.ok, true);
  });

  await test("a missing uid is refused rather than deleting something else", async () => {
    const r = await deleteAnalyticsProfile("", {env: ENV, fetchImpl: fetchStub([])});
    assert.strictEqual(r.skipped, "no-uid");
    assert.strictEqual(r.deleted, 0);
  });

  console.log(`\nanalyticsPurge: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
