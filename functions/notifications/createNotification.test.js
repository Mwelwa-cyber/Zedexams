/**
 * Node tests for createNotification.js — the single server-side notification
 * write entry point. firebase-admin is stubbed via Module._load with an
 * in-memory Firestore + messaging double (repo convention, see
 * functions/teacherTools/usageMeter.test.js).
 *
 * Run: node functions/notifications/createNotification.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── Controllable clock + Timestamp ───────────────────────────────────────
let STUB_NOW = new Date(Date.UTC(2026, 5, 30, 10, 0, 0)); // 12:00 Lusaka
const SERVER_TS = Symbol("serverTimestamp");
function makeTimestamp(ms) {
  return { _ms: ms, toMillis: () => ms, toDate: () => new Date(ms) };
}

// ── In-memory Firestore ──────────────────────────────────────────────────
// collections: Map<collectionPath, Map<docId, data>>
let collections;
let idCounter;

function getColl(path) {
  if (!collections.has(path)) collections.set(path, new Map());
  return collections.get(path);
}

function resolveWrites(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === SERVER_TS) out[k] = makeTimestamp(STUB_NOW.getTime());
    else if (v && typeof v === "object" && v.__arrayRemove) {
      out[k] = { __arrayRemove: v.__arrayRemove };
    } else out[k] = v;
  }
  return out;
}

function applyUpdate(existing, data) {
  const base = { ...(existing || {}) };
  for (const [k, v] of Object.entries(resolveWrites(data))) {
    if (v && typeof v === "object" && v.__arrayRemove) {
      const cur = Array.isArray(base[k]) ? base[k] : [];
      base[k] = cur.filter((x) => !v.__arrayRemove.includes(x));
    } else base[k] = v;
  }
  return base;
}

function compare(a, op, b) {
  const av = a && typeof a.toMillis === "function" ? a.toMillis() : a;
  const bv = b && typeof b.toMillis === "function" ? b.toMillis() : b;
  if (op === "==") return av === bv;
  if (op === ">=") return av >= bv;
  if (op === "<=") return av <= bv;
  if (op === ">") return av > bv;
  if (op === "<") return av < bv;
  return false;
}

function makeQuery(collPath, filters = [], limitN = Infinity) {
  return {
    where: (field, op, val) =>
      makeQuery(collPath, [...filters, { field, op, val }], limitN),
    limit: (n) => makeQuery(collPath, filters, n),
    get: async () => {
      const coll = getColl(collPath);
      const docs = [];
      for (const [id, data] of coll.entries()) {
        if (filters.every((f) => compare(data[f.field], f.op, f.val))) {
          docs.push({ id, data: () => data });
        }
        if (docs.length >= limitN) break;
      }
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  };
}

function makeCollectionRef(collPath) {
  const q = makeQuery(collPath);
  return {
    doc: (id) => makeDocRef(`${collPath}/${id}`),
    add: async (data) => {
      const id = `auto${idCounter++}`;
      getColl(collPath).set(id, resolveWrites(data));
      return { id };
    },
    where: q.where,
    limit: q.limit,
    get: q.get,
  };
}

function makeDocRef(docPath) {
  const lastSlash = docPath.lastIndexOf("/");
  const collPath = docPath.slice(0, lastSlash);
  const id = docPath.slice(lastSlash + 1);
  return {
    __path: docPath,
    id,
    get: async () => {
      const data = getColl(collPath).get(id);
      return { exists: data !== undefined, data: () => data };
    },
    set: async (data) => getColl(collPath).set(id, resolveWrites(data)),
    update: async (data) => {
      const cur = getColl(collPath).get(id);
      getColl(collPath).set(id, applyUpdate(cur, data));
    },
    collection: (name) => makeCollectionRef(`${docPath}/${name}`),
  };
}

const db = { collection: (name) => makeCollectionRef(name) };

// ── messaging double ─────────────────────────────────────────────────────
let multicastImpl;
const messaging = {
  sendEachForMulticast: async (msg) => multicastImpl(msg),
};
function defaultMulticast(msg) {
  const n = msg.tokens.length;
  return {
    successCount: n,
    failureCount: 0,
    responses: msg.tokens.map(() => ({ success: true })),
  };
}

// ── admin stub ───────────────────────────────────────────────────────────
const firestoreFn = () => db;
firestoreFn.FieldValue = {
  serverTimestamp: () => SERVER_TS,
  arrayRemove: (...vals) => ({ __arrayRemove: vals }),
};
firestoreFn.Timestamp = { fromMillis: (ms) => makeTimestamp(ms) };
const adminStub = { firestore: firestoreFn, messaging: () => messaging };

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  return origLoad.call(this, request, ...rest);
};

const { createNotification } = require("./createNotification");

// Thread the controllable clock into every call so expiresAt + dedupe windows
// are deterministic (read at call time, so post-advance calls see the new now).
const notify = (opts) => createNotification({ now: STUB_NOW, ...opts });

function reset() {
  collections = new Map();
  idCounter = 1;
  multicastImpl = defaultMulticast;
  STUB_NOW = new Date(Date.UTC(2026, 5, 30, 10, 0, 0)); // 12:00 Lusaka
}

function seedUser(uid, data) {
  getColl("users").set(uid, data);
}
function itemsOf(uid) {
  return [...getColl(`notifications/${uid}/feed`).values()];
}

(async () => {
  console.log("createNotification — write + gating");

  // Happy path: default prefs, has a token → writes in-app + pushes.
  reset();
  seedUser("u1", { fcmTokens: ["t1"] });
  const r1 = await notify({
    uid: "u1",
    category: "learning",
    type: "quiz_assigned",
    title: "New quiz",
    body: "Maths quiz assigned",
    action: { label: "Open Quiz", url: "/quiz/123" },
  });
  ok("writes in-app", r1.written === true && typeof r1.id === "string");
  ok("pushes when tokens present", r1.pushed === true);
  const items1 = itemsOf("u1");
  ok("exactly one item stored", items1.length === 1);
  ok("item carries category/type/title", items1[0].category === "learning" && items1[0].type === "quiz_assigned");
  ok("item read=false", items1[0].read === false);
  ok("item has expiresAt ~90d out",
      items1[0].expiresAt.toMillis() === STUB_NOW.getTime() + 90 * 86400000);
  ok("item icon defaulted", items1[0].icon === "academic-cap");

  // Opt-out: learning category off → nothing written.
  reset();
  seedUser("u2", { notificationPrefs: { categories: { learning: false } } });
  const r2 = await notify({ uid: "u2", category: "learning", type: "x", title: "t", body: "b" });
  ok("opt-out suppresses in-app write", r2.written === false && r2.reason === "inapp_suppressed");
  ok("no item stored on opt-out", itemsOf("u2").length === 0);

  // Critical category written even with master off.
  reset();
  seedUser("u3", { notificationPrefs: { master: false } });
  const r3 = await notify({ uid: "u3", category: "payments", type: "payment_failed", title: "Failed", body: "..." });
  ok("payments written despite master off", r3.written === true);

  // Push suppressed in quiet hours but in-app still written.
  reset();
  STUB_NOW = new Date(Date.UTC(2026, 5, 30, 21, 0, 0)); // 23:00 Lusaka
  seedUser("u4", {
    fcmTokens: ["t1"],
    notificationPrefs: { quietHours: { enabled: true, start: "22:00", end: "06:00" } },
  });
  const r4 = await notify({ uid: "u4", category: "learning", type: "x", title: "t", body: "b" });
  ok("quiet hours: written but not pushed", r4.written === true && r4.pushed === false);

  // No tokens → written, not pushed.
  reset();
  seedUser("u5", {});
  const r5 = await notify({ uid: "u5", category: "system", type: "x", title: "t", body: "b" });
  ok("no tokens: written, not pushed", r5.written === true && r5.pushed === false);

  console.log("\ncreateNotification — dedupe");

  // Same dedupeKey within 24h → second is deduped, only one doc.
  reset();
  seedUser("u6", {});
  const a = await notify({ uid: "u6", category: "learning", type: "streak", title: "t", body: "b", dedupeKey: "streak-7" });
  const b = await notify({ uid: "u6", category: "learning", type: "streak", title: "t", body: "b", dedupeKey: "streak-7" });
  ok("first write ok", a.written === true);
  ok("second deduped", b.deduped === true && b.written === false);
  ok("only one item stored", itemsOf("u6").length === 1);

  // Outside the 24h window → writes again.
  STUB_NOW = new Date(STUB_NOW.getTime() + 25 * 3600 * 1000);
  const c = await notify({ uid: "u6", category: "learning", type: "streak", title: "t", body: "b", dedupeKey: "streak-7" });
  ok("re-writes after dedupe window", c.written === true && itemsOf("u6").length === 2);

  console.log("\ncreateNotification — validation & sanitize");

  reset();
  const bad1 = await notify({ category: "learning", type: "x", title: "t", body: "b" });
  ok("missing uid rejected", bad1.written === false && bad1.reason === "no_uid");
  const bad2 = await notify({ uid: "u7", category: "nope", type: "x", title: "t", body: "b" });
  ok("bad category rejected", bad2.written === false && bad2.reason === "bad_category");

  reset();
  seedUser("u8", {});
  await notify({ uid: "u8", category: "learning", type: "x", title: "t", body: "b", action: { label: "Go" } });
  ok("action without url dropped to null", itemsOf("u8")[0].action === null);

  // sendPush:false honoured even with tokens.
  reset();
  seedUser("u9", { fcmTokens: ["t1"] });
  const r9 = await notify({ uid: "u9", category: "learning", type: "x", title: "t", body: "b", sendPush: false });
  ok("sendPush:false → not pushed", r9.written === true && r9.pushed === false);

  Module._load = origLoad;
  console.log(`\n${passed} passed`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
