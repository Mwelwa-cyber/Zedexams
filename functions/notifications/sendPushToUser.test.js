/**
 * Node tests for sendPushToUser.js — batching + dead-token pruning shared by
 * createNotification and the daily streak cron. firebase-admin is stubbed for
 * the arrayRemove FieldValue used during pruning.
 *
 * Run: node functions/notifications/sendPushToUser.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── admin stub (only arrayRemove + the users update path are exercised) ───
let userStore = {};
const firestoreFn = () => ({
  collection: () => ({
    doc: (uid) => ({
      update: async (data) => {
        const cur = userStore[uid] || {};
        const out = { ...cur };
        for (const [k, v] of Object.entries(data)) {
          if (v && v.__arrayRemove) {
            out[k] = (cur[k] || []).filter((x) => !v.__arrayRemove.includes(x));
          } else out[k] = v;
        }
        userStore[uid] = out;
      },
    }),
  }),
});
firestoreFn.FieldValue = { arrayRemove: (...vals) => ({ __arrayRemove: vals }) };
const adminStub = { firestore: firestoreFn };

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  return origLoad.call(this, request, ...rest);
};

const { sendPushToUser, isPrunableToken, pruneDeadTokensByUid } = require("./sendPushToUser");
const db = firestoreFn();

(async () => {
  console.log("sendPushToUser — classification");
  ok("not-registered is prunable", isPrunableToken("messaging/registration-token-not-registered"));
  ok("invalid-token is prunable", isPrunableToken("messaging/invalid-registration-token"));
  ok("server error is NOT prunable", !isPrunableToken("messaging/internal-error"));

  console.log("\nsendPushToUser — send + prune");

  // All succeed → no prune.
  userStore = { u1: { fcmTokens: ["a", "b"] } };
  let calls = 0;
  let messaging = {
    sendEachForMulticast: async (msg) => {
      calls += 1;
      return {
        successCount: msg.tokens.length,
        failureCount: 0,
        responses: msg.tokens.map(() => ({ success: true })),
      };
    },
  };
  const s1 = await sendPushToUser({ messaging, db, uid: "u1", tokens: ["a", "b"], payload: {} });
  ok("all sent", s1.sent === 2 && s1.failed === 0);
  ok("nothing pruned", s1.pruned === 0 && userStore.u1.fcmTokens.length === 2);
  ok("single batch call", calls === 1);

  // One dead token → pruned from the user doc.
  userStore = { u2: { fcmTokens: ["good", "dead"] } };
  messaging = {
    sendEachForMulticast: async (msg) => ({
      successCount: 1,
      failureCount: 1,
      responses: msg.tokens.map((t) =>
        t === "dead"
          ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
          : { success: true },
      ),
    }),
  };
  const s2 = await sendPushToUser({ messaging, db, uid: "u2", tokens: ["good", "dead"], payload: {} });
  ok("one sent one failed", s2.sent === 1 && s2.failed === 1);
  ok("dead token pruned", s2.pruned === 1 && userStore.u2.fcmTokens.join() === "good");

  // Transient failure → counted, NOT pruned.
  userStore = { u3: { fcmTokens: ["x"] } };
  messaging = {
    sendEachForMulticast: async () => ({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: "messaging/internal-error", message: "boom" } }],
    }),
  };
  const s3 = await sendPushToUser({ messaging, db, uid: "u3", tokens: ["x"], payload: {} });
  ok("transient failure counted", s3.failed === 1);
  ok("transient token NOT pruned", s3.pruned === 0 && userStore.u3.fcmTokens.length === 1);
  ok("transient error recorded", s3.errors.length === 1);

  // Batching: 600 tokens → 2 multicast calls.
  userStore = { u4: { fcmTokens: [] } };
  let batchCalls = 0;
  messaging = {
    sendEachForMulticast: async (msg) => {
      batchCalls += 1;
      return {
        successCount: msg.tokens.length,
        failureCount: 0,
        responses: msg.tokens.map(() => ({ success: true })),
      };
    },
  };
  const many = Array.from({ length: 600 }, (_, i) => `t${i}`);
  const s4 = await sendPushToUser({ messaging, db, uid: "u4", tokens: many, payload: {} });
  ok("600 tokens all sent", s4.sent === 600);
  ok("600 tokens → 2 batches", batchCalls === 2);

  // Empty tokens → no-op.
  const s5 = await sendPushToUser({ messaging, db, uid: "u5", tokens: [], payload: {} });
  ok("empty tokens no-op", s5.sent === 0 && s5.failed === 0);

  // pruneDeadTokensByUid directly.
  userStore = { u6: { fcmTokens: ["keep", "drop1", "drop2"] } };
  const pruned = await pruneDeadTokensByUid(db, new Map([["u6", ["drop1", "drop2"]]]));
  ok("pruneDeadTokensByUid removes listed tokens", pruned === 2 && userStore.u6.fcmTokens.join() === "keep");

  Module._load = origLoad;
  console.log(`\n${passed} passed`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
