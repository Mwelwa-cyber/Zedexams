/**
 * Node test for the shared AI-handler guards in functions/aiService.js.
 *
 * aiService is imported by nearly every AI Cloud Function, but its guard
 * surface had no direct test. This covers the security/cost-relevant, mostly
 * pure helpers that sit in front of the model calls:
 *   • isStaffRole      — who bypasses learner caps / unlocks teacher tools
 *   • cleanString      — NUL stripping + length capping of untrusted input
 *   • cleanContext     — key whitelist + per-key length caps on page context
 *   • cleanChatHistory — history trimming + role normalisation
 *   • assertDailyLimit — the per-user daily call ceiling (60 learner / 150 staff)
 *
 * Plain `node` script (repo convention). firebase-admin, the HttpsError class,
 * and the notifications helper are stubbed via Module._load before the module
 * under test loads; ./aiPromptPolicy + ./anthropicFetch load for real (pure).
 *
 * Run: node functions/aiService.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── In-memory Firestore stub (assertDailyLimit only) ─────────────────────────
const SERVER_TS = Symbol("serverTimestamp");
let store = {}; // full doc path -> data object (undefined = does not exist)

const snapFor = (path) => {
  const data = store[path];
  return {exists: data !== undefined, data: () => data};
};

const makeRef = (path) => ({__path: path});

function applyWrite(path, data) {
  // assertDailyLimit always uses {merge:true} + a full overwrite of `total`.
  const base = JSON.parse(JSON.stringify(store[path] || {}));
  for (const [field, val] of Object.entries(data)) {
    base[field] = val === SERVER_TS ? "<ts>" : val;
  }
  store[path] = base;
}

const db = {
  doc: (path) => makeRef(path),
  runTransaction: async (fn) => {
    const tx = {
      get: async (ref) => snapFor(ref.__path),
      set: (ref, data) => applyWrite(ref.__path, data),
    };
    return fn(tx);
  },
};

const firestoreFn = () => db;
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS};
const adminStub = {firestore: firestoreFn};

// Minimal HttpsError stub matching firebase-functions/v2/https shape.
class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  if (request === "firebase-functions/v2/https") return {HttpsError};
  // Never actually fired in these tests (learner totals stay under 80%), but
  // stubbed so the threshold-notification branch can't reach real Firestore.
  if (request === "./notifications/createNotification") {
    return {createNotification: async () => {}};
  }
  return origLoad.call(this, request, ...rest);
};

const {
  isAdminRole,
  isStaffRole,
  cleanString,
  cleanContext,
  cleanChatHistory,
  assertDailyLimit,
  LIMITS,
} = require("./aiService");

function reset() { store = {}; }
async function caught(promise) {
  try { await promise; return null; } catch (err) { return err; }
}

(async () => {
  console.log("aiService guards");

  // ── isStaffRole ──────────────────────────────────────────────────────────
  ok("isStaffRole: teacher is staff", isStaffRole("teacher") === true);
  ok("isStaffRole: admin is staff", isStaffRole("admin") === true);
  ok("isStaffRole: superAdmin is staff", isStaffRole("superAdmin") === true);
  ok("isStaffRole: learner is NOT staff", isStaffRole("learner") === false);
  ok("isStaffRole: parent is NOT staff", isStaffRole("parent") === false);
  ok("isStaffRole: undefined is NOT staff", isStaffRole(undefined) === false);
  ok("isStaffRole: is case-sensitive", isStaffRole("Teacher") === false);

  // ── isAdminRole ──────────────────────────────────────────────────────────
  // superAdmin must pass every admin gate — a strict role === "admin" check
  // locks the project owner out of admin-only callables (the /admin/agents
  // Platform health panel bug).
  ok("isAdminRole: admin is admin", isAdminRole("admin") === true);
  ok("isAdminRole: superAdmin is admin", isAdminRole("superAdmin") === true);
  ok("isAdminRole: teacher is NOT admin", isAdminRole("teacher") === false);
  ok("isAdminRole: learner is NOT admin", isAdminRole("learner") === false);
  ok("isAdminRole: undefined is NOT admin", isAdminRole(undefined) === false);
  ok("isAdminRole: is case-sensitive", isAdminRole("Admin") === false);

  // ── cleanString ──────────────────────────────────────────────────────────
  ok("cleanString: null -> empty string", cleanString(null) === "");
  ok("cleanString: undefined -> empty string", cleanString(undefined) === "");
  ok("cleanString: strips NUL bytes", cleanString("a\u0000b") === "ab");
  ok("cleanString: trims outer whitespace", cleanString("  hi  ") === "hi");
  ok(
    "cleanString: caps to maxLength",
    cleanString("abcdef", 3) === "abc",
  );
  ok(
    "cleanString: coerces non-strings",
    cleanString(42) === "42",
  );
  ok(
    "cleanString: strips trailing space before newline",
    cleanString("a  \nb") === "a\nb",
  );

  // ── cleanContext ─────────────────────────────────────────────────────────
  const ctx = cleanContext({
    subject: "Mathematics",
    grade: "7",
    evil: "should be dropped",
    __proto__: "nope",
    selectedText: "x".repeat(999),
  });
  ok("cleanContext: keeps whitelisted keys", ctx.subject === "Mathematics");
  ok("cleanContext: drops non-whitelisted keys", !("evil" in ctx));
  ok(
    "cleanContext: caps selectedText at 500 chars",
    ctx.selectedText.length === 500,
  );
  ok(
    "cleanContext: omits empty values",
    !("topic" in cleanContext({topic: "   "})),
  );
  ok(
    "cleanContext: empty input -> empty object",
    Object.keys(cleanContext()).length === 0,
  );

  // ── cleanChatHistory ─────────────────────────────────────────────────────
  ok(
    "cleanChatHistory: non-array -> empty array",
    Array.isArray(cleanChatHistory("nope")) && cleanChatHistory("nope").length === 0,
  );
  const hist = cleanChatHistory([
    {role: "user", content: "hello"},
    {from: "assistant", text: "hi there"},
    {role: "user", content: "   "}, // empty after clean -> dropped
  ]);
  ok("cleanChatHistory: drops empty messages", hist.length === 2);
  ok(
    "cleanChatHistory: normalises assistant role from `from`",
    hist[1].role === "assistant" && hist[1].content === "hi there",
  );
  ok(
    "cleanChatHistory: unknown role falls back to user",
    cleanChatHistory([{role: "system", content: "x"}])[0].role === "user",
  );
  const many = cleanChatHistory(
    Array.from({length: 20}, (_, i) => ({role: "user", content: `m${i}`})),
  );
  ok(
    `cleanChatHistory: keeps only the last ${LIMITS.historyItems} items`,
    many.length === LIMITS.historyItems && many[0].content === "m14",
  );

  // ── assertDailyLimit ─────────────────────────────────────────────────────
  const day = new Date().toISOString().slice(0, 10);

  // Learner under quota: increments the counter and records the action.
  reset();
  await assertDailyLimit("u1", "learner", "chat");
  const rec = store[`aiDailyLimits/u1_${day}`];
  ok("assertDailyLimit: creates the daily counter doc", !!rec);
  ok("assertDailyLimit: increments total to 1", rec.total === 1);
  ok("assertDailyLimit: records the per-action tally", rec.actions.chat === 1);
  ok("assertDailyLimit: stamps uid + day", rec.uid === "u1" && rec.day === day);

  // Second call same day: total climbs.
  await assertDailyLimit("u1", "learner", "quiz");
  const rec2 = store[`aiDailyLimits/u1_${day}`];
  ok("assertDailyLimit: second call increments to 2", rec2.total === 2);
  ok("assertDailyLimit: tracks a distinct action", rec2.actions.quiz === 1);

  // Learner at the 60 ceiling: the next call is refused with resource-exhausted.
  reset();
  store[`aiDailyLimits/u2_${day}`] = {uid: "u2", day, total: 60, actions: {}};
  const err = await caught(assertDailyLimit("u2", "learner", "chat"));
  ok("assertDailyLimit: blocks a learner at 60", err && err.code === "resource-exhausted");
  ok(
    "assertDailyLimit: does not increment past the cap",
    store[`aiDailyLimits/u2_${day}`].total === 60,
  );

  // Staff get the higher 150 ceiling — 60 is fine for them.
  reset();
  store[`aiDailyLimits/t1_${day}`] = {uid: "t1", day, total: 60, actions: {}};
  const staffErr = await caught(assertDailyLimit("t1", "teacher", "assessment"));
  ok("assertDailyLimit: teacher is NOT blocked at 60", staffErr === null);
  ok(
    "assertDailyLimit: teacher counter climbs to 61",
    store[`aiDailyLimits/t1_${day}`].total === 61,
  );

  // Staff ARE blocked once they hit 150.
  reset();
  store[`aiDailyLimits/t2_${day}`] = {uid: "t2", day, total: 150, actions: {}};
  const staffBlocked = await caught(assertDailyLimit("t2", "admin", "chat"));
  ok("assertDailyLimit: blocks staff at 150", staffBlocked && staffBlocked.code === "resource-exhausted");

  console.log(`\naiService guards: ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
