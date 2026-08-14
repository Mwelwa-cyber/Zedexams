"use strict";

// Public account-deletion request endpoint — validation core + handler.
//
// The properties under test are the ones that follow from this endpoint being
// UNAUTHENTICATED and public: it must not leak whether an account exists, it
// must not delete anything, it must not let one submitter flood support, and
// it must never leave a person with no route to deletion when a dependency is
// having a bad day.
//
// Plain `node` script (repo convention). Run: node functions/accountDeletionRequests.test.js

const assert = require("node:assert");
const {
  normalizeDeletionRequest,
  acknowledgement,
  clean,
  LIMITS,
} = require("./accountDeletionRequestCore");

// accountDeletionRequests.js requires `firebase-functions/v2/https` (the
// onRequest wrapper) at load. That is a functions/ dependency, and the CI node
// runners install ONLY root deps — the convention is that every plain-node
// test is root-install-safe (see visitorTrackingHandler.test.js). So the
// HANDLER half is skipped when firebase-functions isn't resolvable, while the
// pure-core half — which is where the validation and enumeration rules live —
// always runs.
let handler = null;
try {
  require.resolve("firebase-functions/v2/https");
  handler = require("./accountDeletionRequests");
} catch (_e) { /* handler tests skipped below */ }

let passed = 0;
function test(name, fn) {
  const r = fn();
  const done = () => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  };
  return r && typeof r.then === "function" ? r.then(done) : (done(), Promise.resolve());
}

// ── Fakes ────────────────────────────────────────────────────────────────
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    headersSent: false,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; },
    send(b) { this.body = b; this.headersSent = true; return this; },
  };
}

function fakeReq(body, {method = "POST", headers = {}} = {}) {
  return {
    method,
    body,
    ip: "203.0.113.9",
    // Default to what the real client sends (DeleteAccountRequest.jsx posts
    // application/json). The endpoint vets the declared Content-Type per
    // SECURITY_ENDPOINT_AUDIT §4.5, so a fixture with no headers would be
    // testing a request no browser makes — see the 415 case below, which
    // overrides this on purpose.
    get: (h) => {
      const key = String(h).toLowerCase();
      if (key in headers) return headers[key];
      if (key === "content-type") return "application/json";
      return "";
    },
  };
}

// Minimal Firestore stand-in: records adds, replays a scripted query result.
function fakeDb({openDocs = []} = {}) {
  const added = [];
  const queries = [];
  const collection = (name) => {
    const q = {
      __filters: [],
      where(field, op, value) { this.__filters.push({field, op, value}); return this; },
      limit() { return this; },
      get: async () => {
        queries.push({collection: name, filters: q.__filters});
        return {empty: openDocs.length === 0, docs: openDocs};
      },
      add: async (doc) => { added.push({collection: name, doc}); return {id: "req1"}; },
      doc: () => ({set: async () => {}, update: async () => {}, delete: async () => {}}),
    };
    return q;
  };
  return {collection, added, queries};
}

const baseDeps = (over = {}) => ({
  applyCors: () => {},
  enforceRateLimit: async () => ({allowed: true}),
  sendOpsAlert: async () => ({sent: true}),
  serverTimestamp: () => "TS",
  log: () => {},
  ...over,
});

const goodBody = {
  email: "Parent@Example.COM",
  name: "A Parent",
  role: "parent_guardian",
  details: "Deleting my child's account",
  confirmed: true,
  source: "web_delete_account_page",
};

(async () => {
  console.log("accountDeletionRequestCore");

  // ── Validation ─────────────────────────────────────────────────────────
  await test("normalises a good submission and lower-cases the email", () => {
    const r = normalizeDeletionRequest(goodBody);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.email, "parent@example.com");
    assert.strictEqual(r.value.role, "parent_guardian");
    assert.strictEqual(r.value.status, "pending");
  });

  await test("records the email as UNVERIFIED", () => {
    // The whole flow depends on nothing downstream treating a self-asserted
    // address as proof. If this flips to true, an anonymous form submission
    // becomes an assertion of identity.
    assert.strictEqual(normalizeDeletionRequest(goodBody).value.emailVerified, false);
  });

  await test("rejects a missing or malformed email", () => {
    for (const email of ["", "   ", "not-an-email", "a@b", undefined]) {
      const r = normalizeDeletionRequest({...goodBody, email});
      assert.strictEqual(r.ok, false, `should reject ${JSON.stringify(email)}`);
      assert.strictEqual(r.field, "email");
    }
  });

  await test("requires the permanence confirmation server-side", () => {
    // The checkbox is enforced here, not only in the form: the endpoint is
    // public, so a request without it did not come from someone who read it.
    for (const confirmed of [undefined, false, "true", 1]) {
      const r = normalizeDeletionRequest({...goodBody, confirmed});
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.field, "confirmed");
    }
  });

  await test("normalises an unrecognised role instead of rejecting it", () => {
    // A stale cached page must not 400 someone out of their deletion route.
    assert.strictEqual(normalizeDeletionRequest({...goodBody, role: "wizard"}).value.role, "other");
    assert.strictEqual(normalizeDeletionRequest({...goodBody, role: ""}).value.role, "other");
  });

  await test("caps free text and strips control characters", () => {
    // Control characters are built from escapes here, never embedded: a CR
    // in a name field would let a submission forge extra header lines in the
    // ops alert email, and a NUL would corrupt this very file.
    const nasty = "line1\r\nBcc: victim@example.com \u001B[31m\u0000";
    const out = clean(nasty, 100);
    assert.ok(!/[\u0000-\u001F\u007F-\u009F]/.test(out), "control chars must not survive");
    assert.ok(!out.includes("\r"), "CR must not survive into an alert email");
    const long = normalizeDeletionRequest({...goodBody, details: "x".repeat(5000)});
    assert.strictEqual(long.value.details.length, LIMITS.details);
  });

  await test("ignores a non-object body without throwing", () => {
    for (const body of [null, undefined, "string", 42, []]) {
      const r = normalizeDeletionRequest(body);
      assert.strictEqual(r.ok, false);
    }
  });

  // The enumeration property starts in the core: the acknowledgement text is
  // the thing that would leak, and it is checked with no runtime needed.
  await test("acknowledgement never states whether an account exists", () => {
    const msg = acknowledgement().message.toLowerCase();
    assert.ok(msg.includes("if an account exists"), "must be conditional");
    for (const leak of ["not found", "no account with", "we found"]) {
      assert.ok(!msg.includes(leak), `must not say "${leak}"`);
    }
  });

  if (!handler) {
    console.log(
        "\naccountDeletionRequests handler: skipped — firebase-functions not " +
      "installed (root-deps run).",
    );
    console.log(`\naccountDeletionRequests: ${passed} passed`);
    return;
  }
  const {handleDeletionRequest, OPEN_STATUSES} = handler;

  console.log("\naccountDeletionRequests handler");

  await test("responds identically for a known and an unknown address", async () => {
    // Same handler, same deps, two different addresses: byte-identical bodies.
    const runFor = async (email) => {
      const res = fakeRes();
      await handleDeletionRequest(fakeReq({...goodBody, email}), res, baseDeps({db: fakeDb()}));
      return {status: res.statusCode, body: JSON.stringify(res.body)};
    };
    const a = await runFor("real-user@example.com");
    const b = await runFor("nobody-at-all@example.com");
    assert.deepStrictEqual(a, b);
  });

  await test("never looks the address up in the users collection", async () => {
    // Reading `users` is how the enumeration oracle gets built by accident.
    const db = fakeDb();
    await handleDeletionRequest(fakeReq(goodBody), fakeRes(), baseDeps({db}));
    const touched = db.queries.map((q) => q.collection).concat(db.added.map((a) => a.collection));
    assert.ok(!touched.includes("users"), `must not touch users, touched: ${touched}`);
  });

  // ── It must not delete ─────────────────────────────────────────────────
  await test("records a request and deletes nothing", async () => {
    const db = fakeDb();
    const res = fakeRes();
    await handleDeletionRequest(fakeReq(goodBody), res, baseDeps({db}));
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(db.added.length, 1);
    assert.strictEqual(db.added[0].collection, "deletionRequests");
    assert.strictEqual(db.added[0].doc.status, "pending");
    assert.strictEqual(db.added[0].doc.email, "parent@example.com");
  });

  // ── Duplicates ─────────────────────────────────────────────────────────
  await test("an open request short-circuits without a duplicate row", async () => {
    const db = fakeDb({openDocs: [{id: "existing"}]});
    const res = fakeRes();
    await handleDeletionRequest(fakeReq(goodBody), res, baseDeps({db}));
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(db.added.length, 0, "must not queue a second row");
    assert.deepStrictEqual(res.body, acknowledgement(), "same reply as a fresh request");
  });

  await test("both open statuses count as already-handled", () => {
    assert.deepStrictEqual(OPEN_STATUSES, ["pending", "verified"]);
  });

  // ── Abuse + resilience ─────────────────────────────────────────────────
  await test("a rate-limited submission is refused without writing", async () => {
    const db = fakeDb();
    const res = fakeRes();
    await handleDeletionRequest(fakeReq(goodBody), res, baseDeps({
      db, enforceRateLimit: async () => ({allowed: false}),
    }));
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(db.added.length, 0);
  });

  await test("the per-email bucket key is hashed, not the address", async () => {
    let buckets = null;
    await handleDeletionRequest(fakeReq(goodBody), fakeRes(), baseDeps({
      db: fakeDb(),
      enforceRateLimit: async (_db, b) => { buckets = b; return {allowed: true}; },
    }));
    const scopes = JSON.stringify(buckets);
    assert.ok(!scopes.includes("parent@example.com"), "email must not reach rateLimits");
    assert.ok(buckets.length >= 2, "expected both an email and an IP bucket");
  });

  await test("a degraded rate limiter does not block a real deletion request", async () => {
    // Fail-open: being unable to check the limiter must not deny someone the
    // route Play requires.
    const db = fakeDb();
    const res = fakeRes();
    await handleDeletionRequest(fakeReq(goodBody), res, baseDeps({
      db, enforceRateLimit: async () => { throw new Error("firestore down"); },
    }));
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(db.added.length, 1);
  });

  await test("a failed ops alert still queues the request", async () => {
    // The row is what serves the requester; the alert is how staff notice.
    const db = fakeDb();
    const res = fakeRes();
    await handleDeletionRequest(fakeReq(goodBody), res, baseDeps({
      db, sendOpsAlert: async () => { throw new Error("smtp down"); },
    }));
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(db.added.length, 1);
  });

  await test("a Firestore failure names the fallback channels", async () => {
    // If this endpoint is the only route someone knows about, its error page
    // has to hand them another one.
    const res = fakeRes();
    await handleDeletionRequest(fakeReq(goodBody), res, baseDeps({
      db: {collection: () => { throw new Error("firestore down"); }},
    }));
    assert.strictEqual(res.statusCode, 500);
    assert.match(res.body.error, /support@zedexams\.com/);
    assert.match(res.body.error, /260 977 740 465/);
  });

  await test("CORS preflight and wrong methods are handled", async () => {
    const pre = fakeRes();
    await handleDeletionRequest(fakeReq(null, {method: "OPTIONS"}), pre, baseDeps({db: fakeDb()}));
    assert.strictEqual(pre.statusCode, 204);

    const get = fakeRes();
    await handleDeletionRequest(fakeReq(null, {method: "GET"}), get, baseDeps({db: fakeDb()}));
    assert.strictEqual(get.statusCode, 405);
  });

  await test("a non-JSON body is refused before anything is written", async () => {
    // SECURITY_ENDPOINT_AUDIT §4.5. This is a public, unauthenticated endpoint,
    // so the cheap checks run first — and nothing may reach Firestore from a
    // request we are refusing.
    const db = fakeDb();
    const res = fakeRes();
    await handleDeletionRequest(
        fakeReq({email: "a@b.com"}, {headers: {"content-type": "text/plain"}}),
        res,
        baseDeps({db}),
    );
    assert.strictEqual(res.statusCode, 415);
    assert.strictEqual(db.added.length, 0);
  });

  console.log(`\naccountDeletionRequests: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
