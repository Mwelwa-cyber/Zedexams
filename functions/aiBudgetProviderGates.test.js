"use strict";

/**
 * Node test for the reservation-based budget gate across the non-Anthropic
 * model clients (issue #1755). PR #1753 wired the hard ceiling into the
 * Anthropic teacher-tools client only; every other provider kept the soft
 * isOverBudget() pre-check that concurrent callers can all pass on the same
 * stale month-to-date read. These assertions pin the migration:
 *   - beginAiImageCall sizes the hold off the FLAT per-image price (token
 *     rates would route gpt-image-1 through the "gpt" catch-all row) and
 *     falls back to a conservative default for unknown image models
 *   - settleAiImageCall reconciles the bucket to the flat actual
 *   - an exhausted budget rejects beginAiCall / beginAiImageCall
 *   - client wiring, per provider:
 *       aiService.callOpenAI      — blocked / settled / released, "openai"
 *       geminiClient.callGemini   — blocked / settled to actual, "gemini"
 *       openaiClient.callOpenAIImage — flat settle / release on API error
 *       openaiEmbeddings.embedText   — degrades to null when blocked, settles
 *
 * Run: node functions/aiBudgetProviderGates.test.js
 */

const assert = require("node:assert");
const admin = require("firebase-admin");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── In-memory Firestore stub (serialised transactions) ────────────────────
// Same shape as aiBudgetReservation.test.js's makeDb, plus the FieldValue
// statics the rollup writers use, installed over admin.firestore via
// defineProperty (it's a non-writable namespace getter).
function makeDb() {
  const store = new Map(); // "a/b/c" -> data object
  const pathOf = (segs) => segs.join("/");

  function docRef(segs) {
    return {
      collection(name) { return colRef([...segs, name]); },
      async get() {
        const d = store.get(pathOf(segs));
        return {exists: d !== undefined, id: segs[segs.length - 1], data: () => (d ? {...d} : undefined)};
      },
      async set(data, opts) {
        const p = pathOf(segs);
        const cur = store.get(p) || {};
        store.set(p, opts && opts.merge ? {...cur, ...data} : {...data});
      },
    };
  }
  function colRef(segs) {
    const filters = [];
    let lim = Infinity;
    const ref = {
      doc(id) { return docRef([...segs, id]); },
      where(field, op, val) { filters.push({field, op, val}); return ref; },
      limit(n) { lim = n; return ref; },
      async get() {
        const prefix = pathOf(segs) + "/";
        const docs = [];
        for (const [p, d] of store.entries()) {
          if (!p.startsWith(prefix)) continue;
          if (p.slice(prefix.length).includes("/")) continue; // direct children only
          if (!filters.every((f) => applyOp(d[f.field], f.op, f.val))) continue;
          docs.push({id: p.slice(prefix.length), data: () => ({...d})});
        }
        const limited = docs.slice(0, lim);
        return {docs: limited, size: limited.length, forEach: (cb) => limited.forEach(cb)};
      },
    };
    return ref;
  }
  function applyOp(a, op, b) {
    if (op === "==") return a === b;
    if (op === "<=") return a <= b;
    if (op === ">=") return a >= b;
    return false;
  }

  let chain = Promise.resolve();
  return {
    _store: store,
    collection(name) { return colRef([name]); },
    runTransaction(fn) {
      const run = () => fn({
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
        update: (ref, data) => ref.set(data, {merge: true}),
      });
      const p = chain.then(run, run); // serialise, survive prior errors
      chain = p.catch(() => {});
      return p;
    },
  };
}

function installDb() {
  const db = makeDb();
  const fs = () => db;
  fs.FieldValue = {
    increment: (n) => ({__inc: n}),
    serverTimestamp: () => ({__ts: true}),
  };
  Object.defineProperty(admin, "firestore", {configurable: true, value: fs});
  return db;
}

function totalReserved(db, month, buckets = 8) {
  let t = 0;
  for (let i = 0; i < buckets; i += 1) {
    const d = db._store.get(`aiBudgetBuckets/${month}/buckets/${i}`);
    t += d ? Number(d.reservedUsd || 0) : 0;
  }
  return t;
}

// Fire-and-forget settles/releases aren't awaited by the clients; drain the
// microtask + timer queue so the stub's serialised transactions complete.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

// Stub global fetch with a queue of canned responses; records calls.
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  global.fetch = async (url, init) => {
    calls.push({url, init});
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}
const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

console.log("aiBudgetProviderGates");

const ORIG_ENV = {
  budget: process.env.AI_MONTHLY_BUDGET_USD,
  mode: process.env.AI_BUDGET_MODE,
  buckets: process.env.AI_BUDGET_BUCKETS,
};
const ORIG_FETCH = global.fetch;

(async () => {
  delete process.env.AI_BUDGET_MODE;
  delete process.env.AI_BUDGET_BUCKETS;
  process.env.AI_MONTHLY_BUDGET_USD = "10";

  const tracking = require("./aiCostTracking");
  const R = require("./aiBudgetReservation");
  const month = tracking.monthKeyUtc();

  // ── beginAiImageCall: flat-price hold ────────────────────────────────────
  {
    tracking._resetBudgetCache();
    const db = installDb();
    const gate = await tracking.beginAiImageCall({
      model: "gpt-image-1", quality: "medium", size: "1536x1024", provider: "openai",
    });
    ok("image begin → allowed with an open reservation",
      gate.allowed && gate.reservation && gate.reservation.status === "open");
    ok("image hold equals the flat per-image price (0.063, not token rates)",
      approx(totalReserved(db, month), 0.063));
    ok("image reservation carries provider 'openai'",
      gate.reservation.provider === "openai");

    await tracking.settleAiImageCall({
      reservation: gate.reservation, uid: "t1", tool: "diagram",
      model: "gpt-image-1", quality: "medium", size: "1536x1024",
    });
    ok("image settle keeps the flat actual in the bucket",
      approx(totalReserved(db, month), 0.063));
    ok("image settle lands on the monthly analytics rollup",
      [...db._store.keys()].some((p) => /^aiUsageMonthly\/[\d-]+\/shards\/\d+$/.test(p)));
  }

  // ── beginAiImageCall: unknown model → conservative default hold ─────────
  {
    tracking._resetBudgetCache();
    const db = installDb();
    const gate = await tracking.beginAiImageCall({model: "mystery-image-9", provider: "gemini"});
    ok("unknown image model holds the conservative default (not $0)",
      gate.allowed && approx(totalReserved(db, month), tracking.DEFAULT_IMAGE_EST_USD));
  }

  // ── Exhausted budget rejects both begin variants ─────────────────────────
  {
    tracking._resetBudgetCache();
    const db = installDb();
    // Fill all 8 default buckets to the cap (10/8 = 1.25 each).
    for (let i = 0; i < 8; i += 1) {
      const r = await R.reserveBudget(db, {
        month, generationId: `fill${i}`, estCostUsd: 1.25,
        monthlyBudgetUsd: 10, bucketCount: 8, ttlMs: 600000,
      });
      assert.ok(r.allowed, `pre-fill reservation ${i}`);
    }
    const text = await tracking.beginAiCall({model: "gpt-4o-mini", maxTokens: 100, provider: "openai"});
    ok("exhausted budget rejects beginAiCall",
      text.allowed === false && text.reason === "budget_exhausted");
    const img = await tracking.beginAiImageCall({
      model: "gpt-image-1", quality: "medium", size: "1536x1024", provider: "openai",
    });
    ok("exhausted budget rejects beginAiImageCall",
      img.allowed === false && img.reason === "budget_exhausted");
  }

  // ── aiService.callOpenAI wiring ──────────────────────────────────────────
  const {callOpenAI} = require("./aiService");
  {
    tracking._resetBudgetCache();
    const db = installDb();
    for (let i = 0; i < 8; i += 1) {
      await R.reserveBudget(db, {
        month, generationId: `of${i}`, estCostUsd: 1.25,
        monthlyBudgetUsd: 10, bucketCount: 8, ttlMs: 600000,
      });
    }
    const calls = stubFetch([jsonRes({})]);
    let code = null;
    try {
      await callOpenAI("k", {messages: [{role: "user", content: "hi"}]});
    } catch (err) {
      code = err.code;
    }
    ok("callOpenAI blocked with resource-exhausted when budget is gone",
      code === "resource-exhausted");
    ok("callOpenAI never reached the provider when blocked", calls.length === 0);
  }
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({
      model: "gpt-4o-mini",
      usage: {prompt_tokens: 1_000_000, completion_tokens: 1_000_000},
      choices: [{message: {content: "hello"}}],
    })]);
    const out = await callOpenAI("k", {
      messages: [{role: "user", content: "hi"}],
      track: {uid: "u1", tool: "aiChat"},
    });
    await flush();
    ok("callOpenAI returns the completion", out === "hello");
    // gpt-4o-mini: 1M in ($0.15) + 1M out ($0.60) = $0.75 settled.
    ok("callOpenAI settles the reservation to the actual OpenAI cost",
      approx(totalReserved(db, month), 0.75));
    const resPath = [...db._store.keys()].find((p) => p.includes("/reservations/"));
    const resDoc = resPath ? db._store.get(resPath) : null;
    ok("callOpenAI reservation is settled with provider 'openai'",
      resDoc && resDoc.status === "settled" && resDoc.provider === "openai");
  }
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({error: {message: "boom"}}, 500)]);
    let threw = false;
    try {
      await callOpenAI("k", {messages: [{role: "user", content: "hi"}]});
    } catch {
      threw = true;
    }
    await flush();
    ok("callOpenAI provider error throws", threw);
    ok("callOpenAI provider error releases the full hold",
      approx(totalReserved(db, month), 0));
  }

  // ── geminiClient.callGemini wiring ───────────────────────────────────────
  const {callGemini} = require("./geminiClient");
  {
    tracking._resetBudgetCache();
    const db = installDb();
    for (let i = 0; i < 8; i += 1) {
      await R.reserveBudget(db, {
        month, generationId: `gf${i}`, estCostUsd: 1.25,
        monthlyBudgetUsd: 10, bucketCount: 8, ttlMs: 600000,
      });
    }
    const calls = stubFetch([jsonRes({})]);
    let code = null;
    try {
      await callGemini("k", {userPrompt: "hi"});
    } catch (err) {
      code = err.code;
    }
    ok("callGemini blocked with resource-exhausted when budget is gone",
      code === "resource-exhausted");
    ok("callGemini never reached the provider when blocked", calls.length === 0);
  }
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({
      candidates: [{content: {parts: [{text: "structured output"}]}}],
      usageMetadata: {promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000},
    })]);
    const text = await callGemini("k", {userPrompt: "hi", track: {uid: "u1", tool: "documentImport"}});
    await flush();
    ok("callGemini returns the text", text === "structured output");
    // gemini-2.5-flash: 1M in ($0.30) + 1M out ($2.50) = $2.80 settled.
    ok("callGemini settles the reservation to the actual Gemini cost",
      approx(totalReserved(db, month), 2.80));
  }
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({error: "nope"}, 503)]);
    let threw = false;
    try {
      await callGemini("k", {userPrompt: "hi"});
    } catch {
      threw = true;
    }
    await flush();
    ok("callGemini provider error throws", threw);
    ok("callGemini provider error releases the full hold",
      approx(totalReserved(db, month), 0));
  }

  // ── openaiClient.callOpenAIImage wiring ──────────────────────────────────
  const {callOpenAIImage} = require("./openaiClient");
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({data: [{b64_json: "aW1n"}]})]);
    const out = await callOpenAIImage("k", {prompt: "a cell diagram"});
    await flush();
    ok("callOpenAIImage returns the image", out.b64 === "aW1n");
    ok("callOpenAIImage settles to the flat per-image actual (0.063)",
      approx(totalReserved(db, month), 0.063));
  }
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({error: {message: "rate limited"}}, 429)]);
    let code = null;
    try {
      await callOpenAIImage("k", {prompt: "a cell diagram"});
    } catch (err) {
      code = err.code;
    }
    await flush();
    ok("callOpenAIImage provider error throws", code === "resource-exhausted");
    ok("callOpenAIImage provider error releases the full hold",
      approx(totalReserved(db, month), 0));
  }

  // ── openaiEmbeddings.embedText wiring (null-never-throw contract) ────────
  const {embedText} = require("./openaiEmbeddings");
  {
    tracking._resetBudgetCache();
    const db = installDb();
    for (let i = 0; i < 8; i += 1) {
      await R.reserveBudget(db, {
        month, generationId: `ef${i}`, estCostUsd: 1.25,
        monthlyBudgetUsd: 10, bucketCount: 8, ttlMs: 600000,
      });
    }
    const calls = stubFetch([jsonRes({})]);
    const vec = await embedText("k", "duplicate question stem?");
    ok("embedText degrades to null when the budget is gone", vec === null);
    ok("embedText never reached the provider when blocked", calls.length === 0);
  }
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({
      model: "text-embedding-3-small",
      usage: {prompt_tokens: 1_000_000},
      data: [{embedding: [0.1, 0.2]}],
    })]);
    const vec = await embedText("k", "duplicate question stem?");
    await flush();
    ok("embedText returns the vector", Array.isArray(vec) && vec.length === 2);
    // text-embedding-3-small: 1M input tokens at $0.02/MTok.
    ok("embedText settles the reservation to the actual embed cost",
      approx(totalReserved(db, month), 0.02));
  }
  {
    tracking._resetBudgetCache();
    const db = installDb();
    stubFetch([jsonRes({error: "nope"}, 500)]);
    const vec = await embedText("k", "duplicate question stem?");
    await flush();
    ok("embedText provider error still returns null", vec === null);
    ok("embedText provider error releases the full hold",
      approx(totalReserved(db, month), 0));
  }

  // ── Reclaim cron helper ──────────────────────────────────────────────────
  const {previousMonthKeyUtc} = require("./aiBudgetReclaim");
  ok("previousMonthKeyUtc steps back one month",
    previousMonthKeyUtc(new Date(Date.UTC(2030, 0, 15))) === "2029-12");
  ok("previousMonthKeyUtc handles mid-year months",
    previousMonthKeyUtc(new Date(Date.UTC(2030, 6, 1))) === "2030-06");

  console.log(`\n─── ${passed} assertions · all passed ───`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  if (ORIG_ENV.budget === undefined) delete process.env.AI_MONTHLY_BUDGET_USD;
  else process.env.AI_MONTHLY_BUDGET_USD = ORIG_ENV.budget;
  if (ORIG_ENV.mode !== undefined) process.env.AI_BUDGET_MODE = ORIG_ENV.mode;
  if (ORIG_ENV.buckets !== undefined) process.env.AI_BUDGET_BUCKETS = ORIG_ENV.buckets;
  global.fetch = ORIG_FETCH;
});
