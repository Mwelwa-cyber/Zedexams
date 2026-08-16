/**
 * functions/security/selfTargetGuardCore.test.js
 *
 * `AdminUserProfile` has always refused to let an admin change their own role
 * or status, and #2403 brought PaymentsPanel into line. Both of those are the
 * browser. The server enforced neither: adminSetUserRole and
 * adminSetUserStatus derived `actor` for the audit log and never compared it
 * to the target uid, so a stale client or a direct callable invocation could
 * still do what both screens refuse — and both callables revoke the target's
 * refresh tokens, so the target being you means signing yourself out of an
 * account you have just taken access away from.
 *
 * Two things are checked here, and they are not the same claim:
 *   1. the RULE — isSelfTargeted's decisions (pure, exhaustive);
 *   2. the WIRING — that both callables actually run it.
 *
 * (2) is a source-level scan rather than a behavioural test, and is honest
 * about being one: onCall handlers need firebase-functions and the emulator,
 * which is out of reach of a plain-node script. It cannot prove the guard
 * refuses a real request. It CAN fail the build the day someone deletes the
 * call — which is the way a guard like this actually dies, since removing it
 * breaks no feature and no other test.
 *
 * Plain-node test (throws on failure). Run: npm run test:self-target-guard
 */

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");

const {isSelfTargeted, SELF_TARGET_MESSAGES} = require("./selfTargetGuardCore");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const UID = "kJ8xQ2mNpR4tVwYz1aBcDeFgHi3J";
const OTHER = "zY9wX8vU7tS6rQ5pO4nM3lK2jI1H";

console.log("isSelfTargeted — the rule");

check("the caller targeting themselves is self", () => {
  assert.equal(isSelfTargeted(UID, UID), true);
});

check("the caller targeting somebody else is not", () => {
  assert.equal(isSelfTargeted(UID, OTHER), false);
});

check("a uid that merely shares a prefix is a different user", () => {
  assert.equal(isSelfTargeted(UID, UID.slice(0, -1)), false);
  assert.equal(isSelfTargeted(UID, `${UID}x`), false);
});

check("comparison is exact — a padded uid addresses a different document, so it is not self", () => {
  // Not an evasion: `users/${uid}` with a trailing space IS another document,
  // so the write never lands on the caller's own account. Trimming here would
  // invent a match between two genuinely different targets.
  assert.equal(isSelfTargeted(UID, ` ${UID}`), false);
  assert.equal(isSelfTargeted(UID, `${UID} `), false);
});

check("case matters — Firebase uids are case-sensitive", () => {
  assert.equal(isSelfTargeted(UID, UID.toLowerCase()), false);
});

check("an absent target is not self (the callables reject it separately)", () => {
  for (const target of [undefined, null, "", 0, false]) {
    assert.equal(isSelfTargeted(UID, target), false);
  }
});

check("a non-string target is not self, and does not throw", () => {
  for (const target of [{}, [], 42, () => {}, Symbol("x")]) {
    assert.equal(isSelfTargeted(UID, target), false);
  }
});

check("a String OBJECT wrapping the caller's uid is refused as not-self, not coerced", () => {
  // typeof is "object", and the callables reject it with invalid-argument
  // before it could reach Firestore. Coercing it here would be the guard
  // quietly accepting a shape the rest of the path does not.
  assert.equal(isSelfTargeted(UID, new String(UID)), false);
});

console.log("isSelfTargeted — fail-closed on a missing actor");

check("a missing actorUid throws rather than answering 'not self'", () => {
  // Answering "not self" would be a guard that silently permits everything
  // the moment the caller's uid stops arriving. That is the only way a guard
  // like this fails, and it fails without a symptom.
  for (const actor of [undefined, null, "", 0, false, {}, 42]) {
    assert.throws(() => isSelfTargeted(actor, UID), TypeError);
  }
});

check("the throw names the cause, so the bug is diagnosable from the log", () => {
  assert.throws(() => isSelfTargeted(undefined, UID), /actorUid is required/);
});

console.log("SELF_TARGET_MESSAGES — the refusal tells the admin what to do");

check("both fields have a message", () => {
  assert.equal(typeof SELF_TARGET_MESSAGES.role, "string");
  assert.equal(typeof SELF_TARGET_MESSAGES.status, "string");
});

check("each names the way forward, not just the refusal", () => {
  // The reader may be the only admin on the project; "denied" alone leaves
  // them unable to tell a rule from an outage.
  for (const message of Object.values(SELF_TARGET_MESSAGES)) {
    assert.match(message, /another admin/i);
  }
});

check("the two messages name their own field, so the wrong one is visible", () => {
  assert.match(SELF_TARGET_MESSAGES.role, /role/i);
  assert.match(SELF_TARGET_MESSAGES.status, /status/i);
  assert.notEqual(SELF_TARGET_MESSAGES.role, SELF_TARGET_MESSAGES.status);
});

console.log("wiring — both callables run the guard (source scan, not behaviour)");

const adminUsersSrc = readFileSync(resolve(__dirname, "..", "adminUsers.js"), "utf8");

check("adminUsers.js imports the guard", () => {
  assert.match(adminUsersSrc, /require\(["']\.\/security\/selfTargetGuardCore["']\)/);
});

check("adminSetUserRole calls it", () => {
  const body = handlerBody("adminSetUserRole");
  assert.match(body, /assertNotSelfTargeted\(actor, uid, "role", request\)/);
});

check("adminSetUserStatus calls it", () => {
  const body = handlerBody("adminSetUserStatus");
  assert.match(body, /assertNotSelfTargeted\(actor, uid, "status", request\)/);
});

check("each guard is awaited — an un-awaited refusal would not stop the write", () => {
  for (const name of ["adminSetUserRole", "adminSetUserStatus"]) {
    assert.match(handlerBody(name), /await assertNotSelfTargeted\(/, name);
  }
});

check("the guard runs BEFORE the document is written", () => {
  // A refusal after userRef.update() would record the change it refused.
  for (const name of ["adminSetUserRole", "adminSetUserStatus"]) {
    const body = handlerBody(name);
    const guardAt = body.indexOf("assertNotSelfTargeted");
    const writeAt = body.search(/userRef\.update\(/);
    assert.ok(guardAt !== -1, `${name}: guard missing`);
    assert.ok(writeAt !== -1, `${name}: expected a userRef.update() to order against`);
    assert.ok(guardAt < writeAt, `${name}: guard must precede the write`);
  }
});

check("the refusal is a permission-denied, not a generic failure", () => {
  assert.match(adminUsersSrc, /new HttpsError\(\s*"permission-denied",\s*SELF_TARGET_MESSAGES\[field\]/);
});

check("the refusal is recorded in the security ledger before it is thrown", () => {
  const helper = adminUsersSrc.slice(
    adminUsersSrc.indexOf("async function assertNotSelfTargeted"),
  );
  const auditAt = helper.indexOf("writeSecurityAudit");
  const throwAt = helper.indexOf("throw new HttpsError");
  assert.ok(auditAt !== -1 && throwAt !== -1);
  assert.ok(auditAt < throwAt, "the ledger write must precede the throw");
  assert.match(helper, /outcome: "denied"/);
});

/**
 * The source of one onCall handler, from its `exports.<name>` to the end of
 * the file — enough to order statements within it, and scoped so a call in
 * one handler can never satisfy an assertion about the other.
 */
function handlerBody(exportName) {
  const start = adminUsersSrc.indexOf(`exports.${exportName} = onCall(`);
  assert.ok(start !== -1, `${exportName} not found in adminUsers.js`);
  const rest = adminUsersSrc.slice(start + 1);
  const nextExport = rest.indexOf("\nexports.");
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

console.log(`\n${passed} checks passed.`);
