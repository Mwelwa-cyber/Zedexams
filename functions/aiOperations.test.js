/**
 * Node test for functions/aiOperations.js — the Firestore-transaction shim
 * around aiOperationsCore's pure decision logic. Same in-memory Firestore
 * stub convention as subscriptionActivation.test.js (CI runs `npm ci` at the
 * repo root only, so functions/node_modules — and firebase-admin — does not
 * exist; firebase-admin/firebase-functions are stubbed via Module._load
 * before the module under test loads).
 *
 * The stub's `runTransaction` additionally serialises concurrent calls (a
 * FIFO queue) so the "two simultaneous requests, same key" test can assert
 * the SECOND transaction only ever sees the FIRST one's already-committed
 * write — the same guarantee real Firestore gives via optimistic-concurrency
 * retries, without needing the emulator.
 *
 * Run: node functions/aiOperations.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
async function rejects(name, fn, match) {
  try {
    await fn();
    assert.fail(`expected ${name} to throw`);
  } catch (err) {
    if (match) assert.ok(match(err), `${name}: error did not match — ${err && err.message}`);
    passed += 1;
    console.log(`  ok  ${name}`);
  }
}

// ── In-memory Firestore stub with tx.create() + serialised transactions ────
const SERVER_TS = Symbol("serverTimestamp");
let store = {};
let queue = Promise.resolve();

const k = (col, id) => `${col}/${id}`;
const snapFor = (col, id) => {
  const data = store[k(col, id)];
  return {exists: data !== undefined, id, data: () => data};
};
const makeRef = (col, id) => ({
  __col: col, __id: id, id,
  get: async () => snapFor(col, id),
  update: async (data) => applyUpdate(col, id, data),
});

function applyUpdate(col, id, data) {
  const key = k(col, id);
  const base = {...(store[key] || {})};
  for (const [field, val] of Object.entries(data)) {
    if (val && typeof val === "object" && "__inc" in val) {
      base[field] = Number(base[field] || 0) + val.__inc;
    } else {
      base[field] = val;
    }
  }
  store[key] = base;
}

class AlreadyExistsError extends Error {
  constructor(path) {
    super(`ALREADY_EXISTS: ${path}`);
    this.code = 6; // gRPC ALREADY_EXISTS, matches real admin SDK behaviour
  }
}

const db = {
  collection: (col) => ({doc: (id) => makeRef(col, id)}),
  // Runs each transaction body to completion before the next starts —
  // mirrors Firestore's actual guarantee (no two transactions interleave
  // their commits on the same doc) well enough for this state machine,
  // without needing the real optimistic-retry machinery.
  runTransaction: (fn) => {
    const run = () => {
      const writes = [];
      const tx = {
        get: async (ref) => snapFor(ref.__col, ref.__id),
        create: (ref, data) => {
          const key = k(ref.__col, ref.__id);
          if (store[key] !== undefined) throw new AlreadyExistsError(key);
          writes.push(() => {
            if (store[key] !== undefined) throw new AlreadyExistsError(key);
            store[key] = {...data};
          });
        },
        update: (ref, data) => {
          writes.push(() => applyUpdate(ref.__col, ref.__id, data));
        },
      };
      return Promise.resolve(fn(tx)).then((result) => {
        writes.forEach((w) => w());
        return result;
      });
    };
    const result = queue.then(run, run);
    queue = result.then(() => {}, () => {});
    return result;
  },
};

const firestoreFn = () => db;
firestoreFn.FieldValue = {
  serverTimestamp: () => SERVER_TS,
  increment: (n) => ({__inc: n}),
};

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  if (request === "firebase-functions/v2/https") return {HttpsError};
  return origLoad.call(this, request, ...rest);
};

const {
  reserveAiOperation, requireAndReserveAiOperation, completeAiOperation,
  failAiOperation, cancelAiOperation, getAiOperation,
} = require("./aiOperations");

Module._load = origLoad;

const UID = "teacher_1";
const OTHER_UID = "teacher_2";
const VALID_KEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

async function main() {
  // ── Reservation basics ────────────────────────────────────────────────
  store = {};
  {
    const r = await reserveAiOperation({
      uid: UID, idempotencyKey: VALID_KEY, operationType: "generate_assessment",
      fingerprintInput: {grade: "G7", topic: "Cells"},
    });
    ok("first reservation creates the operation", r.status === "created");
    ok("created operation is scoped to the caller", r.operation.userId === UID);
    ok("created operation starts in processing", r.operation.status === "processing");
  }

  await rejects("a non-UUID idempotencyKey is rejected", () => reserveAiOperation({
    uid: UID, idempotencyKey: "not-a-uuid", operationType: "generate_assessment", fingerprintInput: {},
  }), (e) => e.code === "invalid-argument");

  await rejects("no uid throws unauthenticated", () => reserveAiOperation({
    uid: null, idempotencyKey: VALID_KEY, operationType: "generate_assessment", fingerprintInput: {},
  }), (e) => e.code === "unauthenticated");

  // ── Duplicate resume behaviour (§7) ─────────────────────────────────────
  {
    const r = await reserveAiOperation({
      uid: UID, idempotencyKey: VALID_KEY, operationType: "generate_assessment",
      fingerprintInput: {grade: "G7", topic: "Cells"},
    });
    ok("same key + same input while processing → processing, not re-created", r.status === "processing");
  }

  await completeAiOperation({idempotencyKey: VALID_KEY, resultDocumentId: "gen_1", usageCharged: 1});
  {
    const r = await reserveAiOperation({
      uid: UID, idempotencyKey: VALID_KEY, operationType: "generate_assessment",
      fingerprintInput: {grade: "G7", topic: "Cells"},
    });
    ok("completed operation resumes with the existing result", r.status === "completed" && r.operation.resultDocumentId === "gen_1");
  }

  // ── Cross-user + fingerprint-mismatch rejection (§6/§8) ─────────────────
  await rejects("a key belonging to another user is rejected", () => reserveAiOperation({
    uid: OTHER_UID, idempotencyKey: VALID_KEY, operationType: "generate_assessment",
    fingerprintInput: {grade: "G7", topic: "Cells"},
  }), (e) => e.code === "permission-denied");

  await rejects("same key reused with different input is rejected", () => reserveAiOperation({
    uid: UID, idempotencyKey: VALID_KEY, operationType: "generate_assessment",
    fingerprintInput: {grade: "G7", topic: "A completely different topic"},
  }), (e) => /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT/.test(e.message));

  // ── Two concurrent requests, same key: provider called exactly once ────
  store = {};
  {
    const KEY2 = "3fa85f64-5717-4562-b3fc-2c963f66afa7";
    const [a, b] = await Promise.all([
      reserveAiOperation({
        uid: UID, idempotencyKey: KEY2, operationType: "generate_assessment",
        fingerprintInput: {grade: "G8"},
      }),
      reserveAiOperation({
        uid: UID, idempotencyKey: KEY2, operationType: "generate_assessment",
        fingerprintInput: {grade: "G8"},
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    ok("exactly one of two concurrent reservations creates, the other sees processing",
        statuses[0] === "created" && statuses[1] === "processing");
  }

  // ── Failure + retry policy (§7) ─────────────────────────────────────────
  store = {};
  const KEY3 = "3fa85f64-5717-4562-b3fc-2c963f66afa8";
  await reserveAiOperation({
    uid: UID, idempotencyKey: KEY3, operationType: "generate_worksheet", fingerprintInput: {grade: "G9"},
  });
  await failAiOperation({idempotencyKey: KEY3, err: new HttpsError("invalid-argument", "bad topic")});
  {
    const r = await reserveAiOperation({
      uid: UID, idempotencyKey: KEY3, operationType: "generate_worksheet", fingerprintInput: {grade: "G9"},
    });
    ok("non-retryable failure returns the failure, does not retry", r.status === "failed" && r.operation.retryable === false);
  }

  store = {};
  const KEY4 = "3fa85f64-5717-4562-b3fc-2c963f66afa9";
  await reserveAiOperation({
    uid: UID, idempotencyKey: KEY4, operationType: "generate_worksheet", fingerprintInput: {grade: "G9"},
  });
  await failAiOperation({idempotencyKey: KEY4, err: new HttpsError("deadline-exceeded", "timeout")});
  {
    const r = await reserveAiOperation({
      uid: UID, idempotencyKey: KEY4, operationType: "generate_worksheet", fingerprintInput: {grade: "G9"},
    });
    // Backoff hasn't elapsed yet (test runs in milliseconds) → treated as still-processing, not re-tried immediately.
    ok("retryable failure inside the backoff window is not retried immediately", r.status === "processing");
  }

  // ── Different keys are independent operations ───────────────────────────
  store = {};
  const KEY5A = "3fa85f64-5717-4562-b3fc-2c963f66afaa";
  const KEY5B = "3fa85f64-5717-4562-b3fc-2c963f66afab";
  const r5a = await reserveAiOperation({
    uid: UID, idempotencyKey: KEY5A, operationType: "generate_flashcards", fingerprintInput: {grade: "G10"},
  });
  const r5b = await reserveAiOperation({
    uid: UID, idempotencyKey: KEY5B, operationType: "generate_flashcards", fingerprintInput: {grade: "G10"},
  });
  ok("different idempotency keys create independent operations",
      r5a.status === "created" && r5b.status === "created" && r5a.operation !== r5b.operation);

  // ── getAiOperation is user-scoped ────────────────────────────────────────
  store = {};
  const KEY6 = "3fa85f64-5717-4562-b3fc-2c963f66afac";
  await reserveAiOperation({
    uid: UID, idempotencyKey: KEY6, operationType: "generate_notes", fingerprintInput: {},
  });
  ok("owner can read their operation", (await getAiOperation({uid: UID, idempotencyKey: KEY6})) !== null);
  ok("a different user cannot read someone else's operation",
      (await getAiOperation({uid: OTHER_UID, idempotencyKey: KEY6})) === null);
  ok("an unknown key returns null, not an error", (await getAiOperation({uid: UID, idempotencyKey: VALID_KEY.replace("a6", "b6")})) === null);

  // ── Cancellation semantics (§15) ─────────────────────────────────────────
  store = {};
  const KEY7 = "3fa85f64-5717-4562-b3fc-2c963f66afad";
  await reserveAiOperation({
    uid: UID, idempotencyKey: KEY7, operationType: "generate_homework", fingerprintInput: {},
  });
  {
    const c = await cancelAiOperation({uid: UID, idempotencyKey: KEY7});
    // Reservation goes straight to 'processing' (provider call starts immediately
    // for our synchronous callables) — cancellation of an in-flight call only
    // records intent, it must never falsely claim the call was stopped.
    ok("cancelling a processing operation records intent without claiming it stopped",
        c.status === "processing" && c.operation.cancelRequested === true);
  }
  await rejects("cancelling another user's operation is rejected", () => cancelAiOperation({
    uid: OTHER_UID, idempotencyKey: KEY7,
  }), (e) => e.code === "permission-denied");

  // ── requireAndReserveAiOperation — the canonical Phase 6 entry point ─────
  //
  // The five generators wired in #1861 each wrote this sequence by hand and
  // each guarded it behind `isValidIdempotencyKey`, so a keyless request took
  // the old unprotected path. There is now one way in, and no keyless branch to
  // write. These assertions are the REAL helper — the generator tests stub a
  // mirror of it, and a mirror proves routing, not behaviour.

  console.log("\n— requireAndReserveAiOperation —");

  for (const badKey of [undefined, null, "", "   ", "not-a-uuid", 12345, {},
    "550e8400-e29b-41d4-a716", "550e8400e29b41d4a716446655440000"]) {
    const label = JSON.stringify(badKey) || String(badKey);
    await rejects(`a missing/malformed key is refused: ${label}`, () =>
      requireAndReserveAiOperation({
        idempotencyKey: badKey, userId: UID, operationType: "generate_worksheet",
        inputFingerprint: {a: 1},
      }), (e) => e.code === "invalid-argument" &&
           e.details && e.details.code === "IDEMPOTENCY_KEY_REQUIRED");
  }

  {
    // Refusal must happen BEFORE anything is written. If a refused request left
    // an operation document behind, the retry that supplied a proper key would
    // collide with a record of the attempt that never ran.
    const before = Object.keys(store).length;
    try {
      await requireAndReserveAiOperation({
        idempotencyKey: "nope", userId: UID, operationType: "generate_worksheet",
      });
    } catch { /* expected */ }
    ok("a refused request writes no operation document",
        Object.keys(store).length === before);
  }

  const HK1 = "aaaaaaaa-0000-4000-8000-000000000001";
  {
    const first = await requireAndReserveAiOperation({
      idempotencyKey: HK1, userId: UID, operationType: "generate_worksheet",
      inputFingerprint: {grade: "G5", topic: "Fractions"},
    });
    ok("a valid key reserves", first.status === "created");

    const second = await requireAndReserveAiOperation({
      idempotencyKey: HK1, userId: UID, operationType: "generate_worksheet",
      inputFingerprint: {grade: "G5", topic: "Fractions"},
    });
    ok("the same key with the same input does not reserve twice",
        second.status === "processing");

    await rejects("the same key with DIFFERENT input is rejected", () =>
      requireAndReserveAiOperation({
        idempotencyKey: HK1, userId: UID, operationType: "generate_worksheet",
        inputFingerprint: {grade: "G6", topic: "Fractions"},
      }), (e) => /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT/.test(e.message));

    await rejects("another user cannot reuse the key", () =>
      requireAndReserveAiOperation({
        idempotencyKey: HK1, userId: OTHER_UID, operationType: "generate_worksheet",
        inputFingerprint: {grade: "G5", topic: "Fractions"},
      }), (e) => e.code === "permission-denied");
  }

  {
    // The two terminal outcomes every caller handled identically now throw here
    // instead of five times over. A caller that stopped handling them is not
    // ignoring them — they cannot reach it.
    const HK2 = "aaaaaaaa-0000-4000-8000-000000000002";
    await requireAndReserveAiOperation({
      idempotencyKey: HK2, userId: UID, operationType: "generate_worksheet",
      inputFingerprint: {x: 1},
    });
    await failAiOperation({
      idempotencyKey: HK2, err: Object.assign(new Error("bad input"),
          {code: "invalid-argument"}), usageCharged: 0,
    });
    await rejects("a terminally-failed key throws rather than returning a status", () =>
      requireAndReserveAiOperation({
        idempotencyKey: HK2, userId: UID, operationType: "generate_worksheet",
        inputFingerprint: {x: 1},
      }), (e) => e.code === "failed-precondition" && e.details.retryable === false);

    const HK3 = "aaaaaaaa-0000-4000-8000-000000000003";
    await requireAndReserveAiOperation({
      idempotencyKey: HK3, userId: UID, operationType: "generate_worksheet",
      inputFingerprint: {x: 2},
    });
    await completeAiOperation({
      idempotencyKey: HK3, resultDocumentId: HK3, usageCharged: 1,
    });
    const resumed = await requireAndReserveAiOperation({
      idempotencyKey: HK3, userId: UID, operationType: "generate_worksheet",
      inputFingerprint: {x: 2},
    });
    ok("a completed key comes back as completed for the caller to resume",
        resumed.status === "completed" && resumed.operation.resultDocumentId === HK3);
  }

  console.log(`\n✓ ${passed} aiOperations assertions passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
