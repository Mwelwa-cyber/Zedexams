/**
 * Node test for the idempotency primitives.
 * Run: node functions/idempotency.test.js
 */

const assert = require("node:assert");
const {
  isValidIdempotencyKey,
  deriveIdempotentId,
  sanitizeEventId,
  processedEventId,
  claimEventOnce,
} = require("./idempotency");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("idempotency");

// ── isValidIdempotencyKey ────────────────────────────────────────────────
ok("accepts a UUID", isValidIdempotencyKey("3f1a9c2e-1b7d-4a2e-9c3a-8e2f1b6d7a90"));
ok("accepts a Firestore push id", isValidIdempotencyKey("aBcD1234_-xyz"));
ok("rejects too-short keys", isValidIdempotencyKey("abc") === false);
ok("rejects slashes (doc-id escape)", isValidIdempotencyKey("aaaa/bbbb/cccc") === false);
ok("rejects spaces", isValidIdempotencyKey("has a space here") === false);
ok("rejects non-strings", isValidIdempotencyKey(null) === false && isValidIdempotencyKey(12345678) === false);
ok("rejects over-long keys", isValidIdempotencyKey("a".repeat(129)) === false);

// ── deriveIdempotentId ───────────────────────────────────────────────────
const KEY = "assign-key-0001-abcd";
const id1 = deriveIdempotentId("assignment:userA", KEY, "a_");
const id2 = deriveIdempotentId("assignment:userA", KEY, "a_");
ok("is deterministic for same (namespace,key)", id1 === id2);
ok("carries the prefix", id1.startsWith("a_"));
ok("is a bounded hex id", /^a_[0-9a-f]{64}$/.test(id1));
ok("namespaces by actor — same key, different user → different id",
  deriveIdempotentId("assignment:userB", KEY, "a_") !== id1);
ok("different key → different id",
  deriveIdempotentId("assignment:userA", "assign-key-0002-abcd", "a_") !== id1);
ok("returns null for a malformed key (fall back, never trust raw input)",
  deriveIdempotentId("assignment:userA", "no/slashes", "a_") === null);
ok("returns null for an empty namespace",
  deriveIdempotentId("", KEY, "a_") === null);

// ── sanitizeEventId / processedEventId ───────────────────────────────────
ok("sanitizes path-unsafe chars", sanitizeEventId("evt/../../x").indexOf("/") === -1);
ok("empty event id → null", sanitizeEventId("") === null);
ok("processedEventId joins scope + event",
  processedEventId("agentJobsOnApproved", "evt-123") === "agentJobsOnApproved_evt-123");
ok("processedEventId null when event id unusable",
  processedEventId("scope", "") === null);

// ── claimEventOnce: a tiny in-memory create-if-absent store ───────────────
function makeFakeDb() {
  const store = new Map();
  return {
    _store: store,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async create(data) {
              if (store.has(key)) {
                const err = new Error("already exists");
                err.code = 6; // gRPC ALREADY_EXISTS
                throw err;
              }
              store.set(key, data);
            },
          };
        },
      };
    },
  };
}

(async () => {
  const db = makeFakeDb();
  const first = await claimEventOnce(db, {scope: "pubo", eventId: "evt-abc", now: 1000});
  ok("first delivery claims the event", first.claimed === true && !first.duplicate);

  const second = await claimEventOnce(db, {scope: "pubo", eventId: "evt-abc", now: 1001});
  ok("duplicate delivery is refused", second.claimed === false && second.duplicate === true);

  const other = await claimEventOnce(db, {scope: "pubo", eventId: "evt-xyz", now: 1002});
  ok("a different event still claims", other.claimed === true);

  // Different scope, same event id → independent claim.
  const scoped = await claimEventOnce(db, {scope: "otherTrigger", eventId: "evt-abc", now: 1003});
  ok("scope isolates the claim namespace", scoped.claimed === true);

  // Fail-open: an unusable event id must not block a real run.
  const degraded = await claimEventOnce(db, {scope: "pubo", eventId: "", now: 1004});
  ok("unusable event id fails open (claimed:true, degraded)", degraded.claimed === true && degraded.degraded === true);

  // Fail-open on a store error other than ALREADY_EXISTS.
  const brokenDb = {
    collection() {
      return {doc() {
        return {async create() {
          const e = new Error("unavailable"); e.code = 14; throw e;
        }};
      }};
    },
  };
  const onError = await claimEventOnce(brokenDb, {scope: "pubo", eventId: "evt-1"});
  ok("store error fails open", onError.claimed === true && onError.degraded === true);

  console.log(`\nidempotency: ${passed} assertions passed`);
})();
