/**
 * Handler-level tests for the /api/track/visit beacon (functions/visitorTracking.js).
 *
 * The endpoint's contract is: it MUST never surface a 5xx/error to the visitor
 * (analytics is not worth breaking navigation), it MUST categorise every
 * failure for the monitor, and it MUST stamp a request id. These tests drive
 * the extracted `handleVisit(req, res, deps)` with fake req/res and injected
 * Firestore + rate-limiter so no firebase-functions runtime is required.
 *
 * Run: node functions/visitorTrackingHandler.test.js
 */

const assert = require("node:assert");

// visitorTracking.js requires `firebase-functions/v2/https` (the onRequest
// wrapper) at load. That is a functions/ dependency, but the CI node runners
// (`test:all` and the functions-coverage run) install ONLY root deps — the
// convention is that every plain-node test is root-install-safe. So when
// firebase-functions isn't resolvable, skip cleanly (exit 0) rather than
// aborting the whole suite: this test still runs locally and anywhere the
// functions deps are installed.
try {
  require.resolve("firebase-functions/v2/https");
} catch (_e) {
  console.log("visitorTracking handler: skipped — firebase-functions not installed (root-deps run).");
  process.exit(0);
}
const {handleVisit, RATE_LIMIT_BUDGET_MS} = require("./visitorTracking");
const {VISIT_RETENTION_DAYS} = require("./visitorTrackingCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("visitorTracking handler");

// ── Fakes ────────────────────────────────────────────────────────────────
function makeReq({method = "POST", body = {path: "/pricing"}, headers = {}} = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    method,
    body,
    headers: lower,
    ip: "203.0.113.9",
    get(name) {
      return lower[String(name).toLowerCase()];
    },
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    headers: {},
    headersSent: false,
    set(k, v) {
      this.headers[String(k).toLowerCase()] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

// A configurable fake Firestore whose add()/runTransaction() resolve, reject,
// or hang forever — enough to exercise the write-success / write-failed /
// write-timeout branches without a real backend. The transaction callback is
// never executed (the handler only cares whether the write settles).
function makeDb({add = "resolve", tx = "resolve"} = {}) {
  const behave = (mode) => {
    if (mode === "reject") return Promise.reject(new Error("firestore unavailable"));
    if (mode === "hang") return new Promise(() => {});
    return Promise.resolve({id: "fake"});
  };
  const docRef = {collection: () => ({doc: () => ({})})};
  // The visit documents this fake was handed. Previously discarded, which left
  // the SHAPE of the write untested — and the shape is where the TTL stamp
  // lives. check-ttl-policies.mjs is a static scan, so it can see that
  // `expiresAt:` is written somewhere in the file but not that it reaches the
  // document the handler actually adds.
  const added = [];
  const db = {
    collection: () => ({
      add: (doc) => {
        added.push(doc);
        return behave(add);
      },
      doc: () => docRef,
    }),
    runTransaction: () => behave(tx),
  };
  db.added = added;
  return db;
}

const noopCors = () => {};
function captureLog() {
  const events = [];
  return {log: (level, event, fields) => events.push({level, event, ...fields}), events};
}
const allow = async () => ({allowed: true});
const block = async () => ({allowed: false});

async function run() {
  // 1. Happy path → 204, request id echoed, no failure category logged.
  {
    const res = makeRes();
    const {log, events} = captureLog();
    const db = makeDb();
    await handleVisit(makeReq(), res, {
      db, enforceRateLimit: allow, applyCors: noopCors, log,
    });
    ok("happy path returns 204", res.statusCode === 204);
    ok("happy path sets x-request-id header", typeof res.headers["x-request-id"] === "string" && res.headers["x-request-id"].length > 0);
    ok("happy path logs no failure category", !events.some((e) => e.category));

    // ── the TTL stamp ────────────────────────────────────────────────────
    // `visits` had no expiry of any kind until 2026-08-16 — no TTL policy and
    // no reaper — so it grew one document per pageview forever. These pin the
    // half of the fix that lives in code; the GCP policy itself is outside
    // anything this repo can check (see check-ttl-policies.mjs).
    const visit = db.added[0];
    ok("a visit document was written", visit !== undefined);
    ok("the visit carries an expiresAt", visit.expiresAt !== undefined);
    // A Firestore TTL policy acts ONLY on a timestamp field. A number is
    // accepted, the policy still reports as enabled, and nothing is ever
    // reaped — the silent failure processedEvents shipped with until
    // 2026-08-14. toDate() is what distinguishes a real Timestamp here.
    ok("expiresAt is a Timestamp, not a number",
        typeof visit.expiresAt?.toDate === "function");
    const daysOut = (visit.expiresAt.toDate().getTime() - Date.now()) / 86400000;
    ok(`expiresAt is ~${VISIT_RETENTION_DAYS} days out (got ${daysOut.toFixed(1)})`,
        Math.abs(daysOut - VISIT_RETENTION_DAYS) < 1);
    // The rollup docs are the durable history and must NOT inherit the visit's
    // expiry — expiring them would silently delete the traffic record the
    // /admin/visitors trend chart and its 7d/30d tiles are built from.
    ok("the visit still records its Lusaka day for the rollups",
        typeof visit.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(visit.day));
  }

  // 2. Non-POST → 405 + method_not_allowed category (a caller bug, must be visible).
  {
    const res = makeRes();
    const {log, events} = captureLog();
    await handleVisit(makeReq({method: "GET"}), res, {
      db: makeDb(), enforceRateLimit: allow, applyCors: noopCors, log,
    });
    ok("GET returns 405", res.statusCode === 405);
    ok("GET categorised method_not_allowed", events.some((e) => e.category === "method_not_allowed"));
  }

  // 3. Malformed body → 204 + validation category (drop, never 5xx). A raw
  // non-object body is exactly the sendBeacon text/plain case the server can't
  // parse into a beacon.
  {
    const res = makeRes();
    const {log, events} = captureLog();
    await handleVisit(makeReq({body: "not-a-json-object"}), res, {
      db: makeDb(), enforceRateLimit: allow, applyCors: noopCors, log,
    });
    ok("malformed body returns 204", res.statusCode === 204);
    ok("malformed body categorised validation", events.some((e) => e.category === "validation"));
  }

  // 4. Rate-limited → 204 + rate_limited category, and NO write attempted.
  {
    const res = makeRes();
    const {log, events} = captureLog();
    let added = false;
    const db = makeDb();
    db.collection = () => ({add: () => { added = true; return Promise.resolve(); }, doc: () => ({collection: () => ({doc: () => ({})})})});
    await handleVisit(makeReq(), res, {
      db, enforceRateLimit: block, applyCors: noopCors, log,
    });
    ok("rate-limited returns 204", res.statusCode === 204);
    ok("rate-limited categorised rate_limited", events.some((e) => e.category === "rate_limited"));
    ok("rate-limited skips the Firestore write", added === false);
  }

  // 5. Firestore write rejects → STILL 204 + write_failed category (never 5xx).
  {
    const res = makeRes();
    const {log, events} = captureLog();
    await handleVisit(makeReq(), res, {
      db: makeDb({add: "reject"}), enforceRateLimit: allow, applyCors: noopCors, log,
    });
    ok("write failure still returns 204", res.statusCode === 204);
    ok("write failure categorised write_failed", events.some((e) => e.event === "write_failed" && e.category === "server"));
  }

  // 6. Limiter throws → fail-open: 204, write proceeds, ratelimit_error logged.
  {
    const res = makeRes();
    const {log, events} = captureLog();
    const throwingLimiter = async () => { throw new Error("limiter txn failed"); };
    await handleVisit(makeReq(), res, {
      db: makeDb(), enforceRateLimit: throwingLimiter, applyCors: noopCors, log,
    });
    ok("limiter error fails open to 204", res.statusCode === 204);
    ok("limiter error categorised rate_limit", events.some((e) => e.event === "ratelimit_error" && e.category === "rate_limit"));
  }

  // 7. Handler never throws even when applyCors blows up (whole-body guard).
  {
    const res = makeRes();
    const {log} = captureLog();
    let threw = false;
    try {
      await handleVisit(makeReq(), res, {
        db: makeDb(), enforceRateLimit: allow, log,
        applyCors: () => { throw new Error("cors exploded"); },
      });
    } catch (_e) { threw = true; }
    ok("handler swallows a cors throw (never rejects)", threw === false);
    ok("handler still answered 204 after cors throw", res.statusCode === 204);
  }

  // 8. Sanity: rate-limit budget is under the write budget so the limiter can't
  // stretch the request toward the function timeout.
  ok("rate-limit budget is small (<= 3s)", RATE_LIMIT_BUDGET_MS <= 3000);

  console.log(`\n${passed} assertions passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
