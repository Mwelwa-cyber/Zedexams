"use strict";

/**
 * userAgeBootstrapCore — the server's correction of a freshly created user.
 *
 * These pin the two things that make the guardian gate real rather than
 * decorative: the client's `isMinor` is never the account's `isMinor`, and a
 * minor is never created without a guardian record (whose absence reads as
 * the permissive migration state).
 *
 * Run: node functions/guardianConsent/userAgeBootstrap.test.js
 */

const assert = require("assert");
const {resolveAgeBootstrap} = require("./userAgeBootstrapCore");

// The real rule, restated locally so this file stays a plain-node script: a
// date under 18 years before `now` needs consent, and anything unreadable
// counts as a child. The production wiring passes the shared consent core's
// own function, so the two can only ever disagree about the input.
const NOW = new Date("2026-08-01T00:00:00Z");
function requiresGuardianConsent(dob, asOf = NOW) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || "").trim());
  if (!m) return true;
  const birth = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const eighteenth = new Date(birth);
  eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + 18);
  return asOf.getTime() < eighteenth.getTime();
}
const deps = {requiresGuardianConsent, now: NOW};

let pass = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; } catch (err) { failures.push({name, message: err.message}); }
}

// ── The client's answer is not the account's answer ───────────────

test("a claimed adult with a child's birthday is corrected", () => {
  // The attack the whole module exists for: setDoc({dob: '2016-…',
  // isMinor: false}). Rules cannot catch it without date arithmetic on a
  // string; this does.
  const patch = resolveAgeBootstrap(
      {role: "learner", dob: "2016-03-04", isMinor: false}, deps,
  );
  assert.strictEqual(patch.isMinor, true);
  assert.strictEqual(patch.guardian.consentStatus, "pending");
});

test("a claimed child with an adult's birthday is corrected too", () => {
  // The opposite direction matters as well — it is how an adult teacher who
  // signed up as a learner would be stuck in limited mode forever.
  const patch = resolveAgeBootstrap(
      {role: "learner", dob: "1990-01-01", isMinor: true}, deps,
  );
  assert.strictEqual(patch.isMinor, false);
});

test("an honest document needs no patch at all", () => {
  assert.strictEqual(
      resolveAgeBootstrap({role: "learner", dob: "1990-01-01", isMinor: false}, deps),
      null,
  );
  assert.strictEqual(
      resolveAgeBootstrap({
        role: "learner", dob: "2016-03-04", isMinor: true,
        guardian: {contact: "", method: "email", consentStatus: "pending"},
      }, deps),
      null,
  );
});

// ── The missing guardian record ───────────────────────────────────

test("a minor with no guardian record gets a pending one", () => {
  // Without it the consent status resolves to `unknown` — the migration
  // state, which grants FULL capabilities. A brand-new account inheriting
  // that grace is the quiet way limited mode stops existing.
  const patch = resolveAgeBootstrap({role: "learner", dob: "2016-03-04", isMinor: true}, deps);
  assert.deepStrictEqual(patch, {
    guardian: {contact: "", method: "email", consentStatus: "pending"},
  });
});

test("an existing GRANTED consent is never overwritten", () => {
  // This trigger runs on create, but a re-run, a replay, or someone calling
  // the core from a backfill must not revoke a guardian's real decision.
  const patch = resolveAgeBootstrap({
    role: "learner", dob: "2016-03-04", isMinor: true,
    guardian: {contact: "p@e.com", method: "email", consentStatus: "granted"},
  }, deps);
  assert.strictEqual(patch, null);
});

test("a DENIED account is not quietly reopened", () => {
  const patch = resolveAgeBootstrap({
    role: "learner", dob: "2016-03-04", isMinor: true,
    guardian: {contact: "p@e.com", method: "email", consentStatus: "denied"},
  }, deps);
  assert.strictEqual(patch, null);
});

test("a guardian record with a nonsense status is repaired to pending", () => {
  const patch = resolveAgeBootstrap({
    role: "learner", dob: "2016-03-04", isMinor: true,
    guardian: {contact: "p@e.com", method: "whatsapp", consentStatus: "approved-ish"},
  }, deps);
  assert.strictEqual(patch.guardian.consentStatus, "pending");
  // The contact and channel the learner gave us survive the repair.
  assert.strictEqual(patch.guardian.contact, "p@e.com");
  assert.strictEqual(patch.guardian.method, "whatsapp");
});

test("an adult learner is not given a guardian record", () => {
  const patch = resolveAgeBootstrap({role: "learner", dob: "1990-01-01", isMinor: true}, deps);
  assert.strictEqual(patch.isMinor, false);
  assert.ok(!("guardian" in patch), "an adult must not acquire a guardian record");
});

// ── Existing and recovered accounts ───────────────────────────────

test("a learner with NO date of birth is left completely alone", () => {
  // Two things create one: an account predating the age screen, and
  // bootstrapUserProfile repairing a profile for someone who has been using
  // the app for months. Deriving "no date, therefore a child" here would drop
  // every recovered profile into limited mode. firestore.rules is what stops
  // a CLIENT reaching this shape.
  assert.strictEqual(resolveAgeBootstrap({role: "learner"}, deps), null);
  assert.strictEqual(resolveAgeBootstrap({role: "learner", dob: ""}, deps), null);
  assert.strictEqual(resolveAgeBootstrap({role: "learner", dob: null}, deps), null);
});

test("an unreadable date IS present, so it is resolved as a child", () => {
  // Different from absent on purpose: a date was declared and we cannot read
  // it, which is a broken or tampered client, not a legacy account.
  const patch = resolveAgeBootstrap({role: "learner", dob: "31-02-2015", isMinor: false}, deps);
  assert.strictEqual(patch.isMinor, true);
  assert.strictEqual(patch.guardian.consentStatus, "pending");
});

// ── Teachers and parents carry no date ────────────────────────────

test("a date of birth sent by a stale teacher client is stripped", () => {
  // The field's absence is a promise made in the Privacy Policy and the Play
  // Data safety form. A cached bundle or an old Android build is exactly how
  // such a promise stops being true without anyone noticing.
  for (const role of ["teacher", "parent"]) {
    const patch = resolveAgeBootstrap({role, dob: "1988-05-05", isMinor: false}, deps);
    assert.deepStrictEqual(patch, {dob: null, isMinor: null}, `${role} must carry neither`);
  }
});

test("a clean teacher or parent document needs no patch", () => {
  for (const role of ["teacher", "parent"]) {
    assert.strictEqual(
        resolveAgeBootstrap({role, ageConfirmed18Plus: true}, deps), null,
    );
  }
});

test("an admin document is not treated as a learner", () => {
  assert.strictEqual(resolveAgeBootstrap({role: "admin"}, deps), null);
  assert.strictEqual(resolveAgeBootstrap({role: "superAdmin"}, deps), null);
});

// ── Defensive ─────────────────────────────────────────────────────

test("junk input returns null rather than throwing into a signup", () => {
  for (const doc of [null, undefined, "user", 42, []]) {
    assert.strictEqual(resolveAgeBootstrap(doc, deps), null);
  }
});

test("a document with no role is not treated as a learner", () => {
  // Inventing a learner's guardian record for a document whose role we cannot
  // read would restrict an account nobody has classified. It is handled by the
  // non-learner branch: strip the date, change nothing else.
  assert.deepStrictEqual(resolveAgeBootstrap({dob: "2016-03-04"}, deps), {dob: null});
  assert.strictEqual(resolveAgeBootstrap({}, deps), null);
});

test("the derivation function is required", () => {
  assert.throws(() => resolveAgeBootstrap({role: "learner", dob: "2016-01-01"}, {}), TypeError);
});

// ── The 18th-birthday boundary ────────────────────────────────────

test("someone one day short of 18 is a minor", () => {
  const patch = resolveAgeBootstrap({role: "learner", dob: "2008-08-02", isMinor: false}, deps);
  assert.strictEqual(patch.isMinor, true, "2008-08-02 is 17 on 2026-08-01");
});

test("someone exactly 18 today is not", () => {
  assert.strictEqual(
      resolveAgeBootstrap({role: "learner", dob: "2008-08-01", isMinor: false}, deps),
      null,
      "2008-08-01 turns 18 on 2026-08-01 and needs no correction",
  );
});

console.log("");
console.log(`─── ${pass + failures.length} tests · ${pass} passed · ${failures.length} failed ───`);
if (failures.length) {
  console.log("\nfailures:");
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
  process.exit(1);
}
