/**
 * Node test for the audit-ledger writer (OBS-002).
 * Run: node functions/auditLog.test.js
 *
 * Pins that a sensitive-action entry is shaped + written, and — the OBS-002
 * fix — that a FAILED ledger write is no longer silent: it raises an ops alert
 * and reports {written:false} while the underlying action still succeeds.
 */

const assert = require("node:assert");
const Module = require("node:module");

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") {
    return {
      firestore: Object.assign(
        () => { throw new Error("no default firestore in tests — inject db"); },
        {FieldValue: {serverTimestamp: () => "__ts__"}},
      ),
    };
  }
  if (request === "./opsAlert") {
    return {sendOpsAlert: async () => ({sent: false})};
  }
  return origLoad.call(this, request, ...rest);
};
const {writeAuditLog, buildAuditEntry} = require("./auditLog");
Module._load = origLoad;

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

// A fake db whose add() succeeds or throws depending on the flag.
function fakeDb({fail = false} = {}) {
  const added = [];
  return {
    added,
    collection: (name) => ({
      add: async (doc) => {
        if (fail) throw new Error("firestore unavailable");
        added.push({collection: name, doc});
        return {id: "audit-1"};
      },
    }),
  };
}

(async () => {
  console.log("auditLog");

  // ── buildAuditEntry (pure) ───────────────────────────────────────────────
  ok("buildAuditEntry requires actorUid + action", (() => {
    try { buildAuditEntry({actorUid: "", action: "x"}); return false; } catch { /* expected */ }
    try { buildAuditEntry({actorUid: "u"}); return false; } catch { return true; }
  })());
  {
    const e = buildAuditEntry({actorUid: "u1", action: "role_change", targetId: "t1", after: {role: "admin"}});
    ok("entry carries the fields + null defaults",
      e.actorUid === "u1" && e.action === "role_change" && e.targetId === "t1" &&
      e.after.role === "admin" && e.before === null && e.metadata === null);
  }

  // ── successful write ─────────────────────────────────────────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const res = await writeAuditLog(
      {actorUid: "admin1", action: "payment_confirm", targetId: "pay1"},
      {db, alert: async (a) => alerts.push(a)},
    );
    ok("success → {written:true, id}", res.written === true && res.id === "audit-1");
    ok("wrote to adminAuditLogs with a server timestamp",
      db.added.length === 1 && db.added[0].collection === "adminAuditLogs" && db.added[0].doc.createdAt === "__ts__");
    ok("no alert on success", alerts.length === 0);
  }

  // ── FAILED write → loud (alert) but action not broken ────────────────────
  {
    const db = fakeDb({fail: true});
    const alerts = [];
    const res = await writeAuditLog(
      {actorUid: "admin1", actorEmail: "a@x.com", action: "premium_grant", targetType: "user", targetId: "u9"},
      {db, alert: async (a) => alerts.push(a)},
    );
    ok("failed write → {written:false} (never throws)", res.written === false && /firestore unavailable/.test(res.error));
    ok("a failed ledger write raises an ERROR ops alert (no longer silent)",
      alerts.length === 1 && alerts[0].severity === "error" && /Audit ledger write FAILED/.test(alerts[0].title));
    ok("alert names the action + actor + target for reconciliation",
      alerts[0].lines.join("\n").includes("premium_grant") &&
      alerts[0].lines.join("\n").includes("admin1") &&
      alerts[0].lines.join("\n").includes("u9"));
  }

  // ── a broken alerter still doesn't throw ─────────────────────────────────
  {
    const db = fakeDb({fail: true});
    const res = await writeAuditLog(
      {actorUid: "a", action: "x"},
      {db, alert: async () => { throw new Error("smtp down"); }},
    );
    ok("a throwing alerter is swallowed — writeAuditLog never breaks the action", res.written === false);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})().catch((err) => { console.error(err); process.exit(1); });
