/**
 * The processed-webhook-event ledger (SECURITY_ENDPOINT_AUDIT.md §4.1).
 *
 * The cases that matter are the ones where a dedupe can be WORSE than no
 * dedupe, so those are tested first and hardest:
 *
 *  • A Lenco payment's lifecycle (pending → successful) must NOT be collapsed.
 *    Both events carry the same collection id and the same reference; keyed on
 *    those alone the ledger would discard the `successful` event and the buyer
 *    would pay and never be granted access. This is the single most expensive
 *    way to get this feature wrong, and it is the first test below.
 *  • A ledger that is DOWN must not block a real event. It is a second layer
 *    over already-idempotent activation, so unavailable means process-and-log,
 *    never refuse.
 *  • An unidentifiable payload must not be given an invented key, because two
 *    different real events could then collide on it.
 */
"use strict";

const assert = require("node:assert");
const {
  PROVIDERS,
  buildEventKey,
  lencoEventParts,
  whatsappEventParts,
  classifyClaim,
} = require("./webhookEventLedgerCore");

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  console.log("  ok  " + label);
  passed++;
}

// ── Identity ─────────────────────────────────────────────────────────
console.log("webhookEventLedgerCore — event identity");

{
  // THE case. One payment, two real deliveries.
  const pending = {event: "collection.pending", data: {id: "col_1", reference: "pay_1", status: "pending"}};
  const success = {event: "collection.successful", data: {id: "col_1", reference: "pay_1", status: "successful"}};
  const kPending = buildEventKey({provider: PROVIDERS.LENCO, parts: lencoEventParts(pending)});
  const kSuccess = buildEventKey({provider: PROVIDERS.LENCO, parts: lencoEventParts(success)});
  ok("a payment's pending and successful events are DIFFERENT keys", kPending !== kSuccess);

  // ...and a redelivery of one of them is the same key.
  const successAgain = {event: "collection.successful", data: {id: "col_1", reference: "pay_1", status: "successful"}};
  ok("a redelivery of the same event is the SAME key",
      buildEventKey({provider: PROVIDERS.LENCO, parts: lencoEventParts(successAgain)}) === kSuccess);
}

{
  // Two different payments must never collide, even with identical type+status.
  const a = {event: "collection.successful", data: {id: "col_1", reference: "pay_1", status: "successful"}};
  const b = {event: "collection.successful", data: {id: "col_2", reference: "pay_2", status: "successful"}};
  ok("different payments do not collide",
      buildEventKey({provider: PROVIDERS.LENCO, parts: lencoEventParts(a)}) !==
      buildEventKey({provider: PROVIDERS.LENCO, parts: lencoEventParts(b)}));
}

{
  // Providers are namespaced: a Lenco reference and a Meta message id that
  // happen to be the same string are still different events.
  const lenco = buildEventKey({provider: PROVIDERS.LENCO, parts: ["X"]});
  const wa = buildEventKey({provider: PROVIDERS.WHATSAPP, parts: ["X"]});
  ok("providers are namespaced", lenco !== wa);
  ok("the key names its provider, for grepping", lenco.startsWith("lenco_") && wa.startsWith("whatsapp_"));
}

{
  // Separator injection: ["a","b"] must not equal ["a|b"].
  ok("component boundaries cannot be forged with a separator",
      buildEventKey({provider: "p", parts: ["a", "b"]}) !== buildEventKey({provider: "p", parts: ["a|b"]}));
}

{
  // Firestore document-id legality, on provider-controlled text.
  const nasty = buildEventKey({provider: PROVIDERS.LENCO, parts: ["../../etc/passwd", "x".repeat(5000)]});
  ok("a hostile reference still yields a legal Firestore doc id",
      !nasty.includes("/") && nasty.length < 1500 && !/^__.*__$/.test(nasty) && nasty !== "." && nasty !== "..");
}

{
  ok("an unidentifiable Lenco payload has no parts", lencoEventParts({data: {}}) === null);
  ok("an unidentifiable Lenco payload has no parts (empty body)", lencoEventParts({}) === null);
  ok("a WhatsApp message with no id has no parts", whatsappEventParts({from: "260..."}) === null);
  ok("a WhatsApp message id is its identity",
      JSON.stringify(whatsappEventParts({messageId: "wamid.X"})) === JSON.stringify(["wamid.X"]));
  // Lenco with no reference but a collection id is still identifiable.
  ok("a Lenco event with only a collection id is identifiable",
      Array.isArray(lencoEventParts({data: {id: "col_9", status: "successful"}})));
}

// ── Claim classification ─────────────────────────────────────────────
console.log("\nwebhookEventLedgerCore — claim outcomes");

ok("a clean create is a claim, and processes",
    JSON.stringify(classifyClaim({createError: null})) ===
    JSON.stringify({outcome: "claimed", shouldProcess: true}));

for (const err of [
  Object.assign(new Error("x"), {code: 6}),
  Object.assign(new Error("x"), {code: "already-exists"}),
  new Error("Document already exists: projects/p/databases/(default)/documents/x"),
]) {
  const r = classifyClaim({createError: err});
  ok(`ALREADY_EXISTS (${err.code ?? "message"}) is a replay and does NOT process`,
      r.outcome === "replay" && r.shouldProcess === false);
}

for (const err of [
  Object.assign(new Error("deadline"), {code: 4}),
  Object.assign(new Error("unavailable"), {code: 14}),
  new Error("connection reset"),
]) {
  const r = classifyClaim({createError: err});
  ok(`a ledger failure (${err.code ?? "no code"}) FAILS OPEN and still processes`,
      r.outcome === "degraded" && r.shouldProcess === true);
}

// ── The Firestore wrapper ────────────────────────────────────────────
console.log("\nwebhookEventLedger — claim against a fake Firestore");

(async () => {
  const Module = require("node:module");
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "firebase-admin") {
      return {firestore: Object.assign(() => ({}), {Timestamp: {fromMillis: (ms) => ({__ms: ms})}})};
    }
    return origLoad.call(this, request, ...rest);
  };
  delete require.cache[require.resolve("./webhookEventLedger")];
  const {claimWebhookEvent, COLLECTION} = require("./webhookEventLedger");

  // A fake Firestore whose create() throws ALREADY_EXISTS the second time,
  // exactly as the real one does.
  function fakeDb() {
    const seen = new Set();
    const written = [];
    return {
      written,
      collection: (name) => ({
        doc: (id) => ({__collection: name, __id: id}),
      }),
      runTransaction: async (fn) => fn({
        create: (ref, data) => {
          if (seen.has(ref.__id)) {
            throw Object.assign(new Error("already exists"), {code: 6});
          }
          seen.add(ref.__id);
          written.push({ref, data});
        },
      }),
    };
  }

  {
    const db = fakeDb();
    const parts = ["pay_1", "collection.successful", "successful"];
    const first = await claimWebhookEvent({db, provider: PROVIDERS.LENCO, parts, meta: {reference: "pay_1"}, now: 1000});
    const second = await claimWebhookEvent({db, provider: PROVIDERS.LENCO, parts, meta: {reference: "pay_1"}, now: 2000});
    ok("first delivery is claimed and processes", first.outcome === "claimed" && first.shouldProcess);
    ok("second delivery is a replay and does not process", second.outcome === "replay" && !second.shouldProcess);
    ok("only ONE row was written", db.written.length === 1);
    ok("the row lands in processedWebhookEvents", db.written[0].ref.__collection === COLLECTION);
    ok("the row carries readable ops fields", db.written[0].data.reference === "pay_1" && db.written[0].data.provider === "lenco");
    ok("the row carries a TTL field ahead of receivedAt",
        db.written[0].data.expiresAt.__ms > db.written[0].data.receivedAt.__ms);
  }

  {
    // The lifecycle case again, this time end-to-end through the claim.
    const db = fakeDb();
    const pending = lencoEventParts({event: "collection.pending", data: {id: "c", reference: "p", status: "pending"}});
    const success = lencoEventParts({event: "collection.successful", data: {id: "c", reference: "p", status: "successful"}});
    const a = await claimWebhookEvent({db, provider: PROVIDERS.LENCO, parts: pending});
    const b = await claimWebhookEvent({db, provider: PROVIDERS.LENCO, parts: success});
    ok("pending then successful BOTH process — a paid buyer is never stranded",
        a.shouldProcess && b.shouldProcess);
  }

  {
    // Ledger down.
    const db = {
      collection: () => ({doc: () => ({})}),
      runTransaction: async () => { throw Object.assign(new Error("unavailable"), {code: 14}); },
    };
    const r = await claimWebhookEvent({db, provider: PROVIDERS.LENCO, parts: ["p", "t", "s"]});
    ok("a ledger outage does not block the event", r.outcome === "degraded" && r.shouldProcess === true);
  }

  {
    // Unidentifiable payload: process, write nothing.
    const db = fakeDb();
    const r = await claimWebhookEvent({db, provider: PROVIDERS.LENCO, parts: null});
    ok("an unidentifiable event processes and writes nothing",
        r.outcome === "unidentified" && r.shouldProcess === true && r.key === null && db.written.length === 0);
  }

  Module._load = origLoad;
  console.log("\n" + passed + " passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
