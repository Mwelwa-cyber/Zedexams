/**
 * Node tests for notifyAudience.js — the admin fan-out helper. Pure builder is
 * tested directly; notifyAdmins is tested with a stubbed firebase-admin +
 * createNotification injected via Module._load (repo convention).
 *
 * Run: node functions/notifications/notifyAudience.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── stub firebase-admin (only the admin-lookup query is exercised) ─────────
let adminDocs = [];
let lastQuery = {};
const firestoreFn = () => ({
  collection: () => ({
    where: (field, op, val) => {
      lastQuery = { field, op, val };
      return {
        limit: () => ({
          get: async () => ({
            docs: adminDocs.map((id) => ({ id })),
          }),
        }),
      };
    },
  }),
});
const adminStub = { firestore: firestoreFn };

// ── stub createNotification (record calls) ─────────────────────────────────
const calls = [];
const createNotificationStub = async (opts) => {
  calls.push(opts);
  return { written: true, id: `n${calls.length}`, pushed: false, deduped: false };
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  if (request === "./createNotification") {
    return { createNotification: createNotificationStub };
  }
  return origLoad.call(this, request, ...rest);
};

const { buildAdminNotification, resolveAdminUids, notifyAdmins, ADMIN_ROLES } = require("./notifyAudience");

(async () => {
  console.log("notifyAudience — buildAdminNotification");

  const teacher = buildAdminNotification("new_teacher", { uid: "t1", name: "Mr Banda" });
  ok("new_teacher title", teacher.title === "New teacher registered");
  ok("new_teacher dedupeKey scoped to uid", teacher.dedupeKey === "admin-new-teacher-t1");
  ok("new_teacher body names the teacher", teacher.body.includes("Mr Banda"));

  const learner = buildAdminNotification("new_learner", { uid: "l1", email: "kid@x.com", grade: 5 });
  ok("new_learner includes grade", learner.body.includes("Grade 5"));
  ok("new_learner dedupeKey", learner.dedupeKey === "admin-new-learner-l1");

  const payOk = buildAdminNotification("payment_received", {
    paymentId: "p1", amount: "120 ZMW", plan: "Pro", phone: "0977000000",
  });
  ok("payment_received medium priority", payOk.priority === "medium");
  ok("payment_received dedupeKey", payOk.dedupeKey === "admin-payment-ok-p1");
  ok("payment_received shows amount", payOk.body.includes("120 ZMW"));
  ok("payment_received shows plan", payOk.body.includes("(Pro)"));
  ok("payment_received shows phone", payOk.body.includes("0977000000"));
  const payBare = buildAdminNotification("payment_received", { paymentId: "p9" });
  ok("payment_received degrades with no amount/plan/phone",
      payBare.body === "subscription payment confirmed.");

  const payFail = buildAdminNotification("payment_failed", { paymentId: "p2", reason: "timeout" });
  ok("payment_failed dedupeKey", payFail.dedupeKey === "admin-payment-fail-p2");
  ok("payment_failed shows reason", payFail.body.includes("timeout"));

  const bug = buildAdminNotification("new_feedback", { feedbackId: "f1", feedbackType: "bug", message: "crash on save", role: "teacher" });
  ok("bug report → high priority", bug.priority === "high");
  ok("bug report title", bug.title === "New bug report");
  ok("bug report dedupeKey", bug.dedupeKey === "admin-feedback-f1");

  const generic = buildAdminNotification("new_feedback", { feedbackId: "f2", feedbackType: "suggestion", message: "nice", role: "learner" });
  ok("non-bug feedback → medium priority + generic title", generic.priority === "medium" && generic.title === "New feedback");

  const incident = buildAdminNotification("incident", { title: "Images down", body: "Kie API 500s", dedupeKey: "img-500" });
  ok("incident → high priority", incident.priority === "high");
  ok("incident passes dedupeKey through", incident.dedupeKey === "img-500");

  const unknown = buildAdminNotification("???", { title: "x" });
  ok("unknown kind falls back", unknown.type === "admin_notice");

  console.log("\nnotifyAudience — resolveAdminUids");
  adminDocs = ["a1", "a2"];
  const uids = await resolveAdminUids(firestoreFn());
  ok("resolves admin uids", uids.length === 2 && uids[0] === "a1");
  ok("queries role in ADMIN_ROLES", lastQuery.field === "role" && lastQuery.op === "in");
  ok("ADMIN_ROLES includes both admin tiers", ADMIN_ROLES.includes("admin") && ADMIN_ROLES.includes("superAdmin"));

  console.log("\nnotifyAudience — notifyAdmins");
  calls.length = 0;
  adminDocs = ["a1", "a2"];
  const res = await notifyAdmins("new_teacher", { uid: "t9", name: "New T" });
  ok("delivers to every admin", res.delivered === 2 && calls.length === 2);
  ok("uses system category (force in-app)", calls.every((c) => c.category === "system"));
  ok("passes the built title", calls[0].title === "New teacher registered");

  calls.length = 0;
  adminDocs = [];
  const none = await notifyAdmins("new_teacher", { uid: "t9" });
  ok("no admins → no calls", none.delivered === 0 && calls.length === 0);

  Module._load = origLoad;
  console.log(`\n${passed} passed`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
