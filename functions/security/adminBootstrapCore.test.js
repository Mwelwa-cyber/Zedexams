/**
 * Admin-bootstrap gate — the rule that stops a public ADMIN_EMAILS entry from
 * being claimed by whoever registers the address first.
 *
 * Run: node functions/security/adminBootstrapCore.test.js
 */

const assert = require("node:assert");
const {
  parseAdminBootstrapEmails,
  isAdminBootstrapEligible,
  resolveInitialRole,
  resolveBootstrapProfileRole,
} = require("./adminBootstrapCore");

const ALLOW = parseAdminBootstrapEmails("owner@example.com, Ops@Example.com");

// ── the allowlist parser ───────────────────────────────────────────────────
assert.deepStrictEqual(
  ALLOW, ["owner@example.com", "ops@example.com"],
  "addresses normalize to lowercase and trim",
);
assert.deepStrictEqual(parseAdminBootstrapEmails(""), [], "empty → no entries");
assert.deepStrictEqual(
  parseAdminBootstrapEmails(undefined), [],
  "unset ADMIN_EMAILS → no entries, not a crash",
);
assert.deepStrictEqual(
  parseAdminBootstrapEmails(",, ,"), [],
  "separators alone never produce an empty-string entry that could match ''",
);

// ── THE REGRESSION: an unverified signup on a listed address ───────────────
// This is the whole point of the gate. ADMIN_EMAILS is committed, so the
// address is public; createUserWithEmailAndPassword proves nothing about
// mailbox ownership. Before the gate this returned "admin".
assert.strictEqual(
  resolveInitialRole({
    email: "owner@example.com", emailVerified: false, adminEmails: ALLOW,
  }),
  "learner",
  "an UNVERIFIED signup on an allowlisted address must NOT be born admin",
);

assert.strictEqual(
  resolveInitialRole({
    email: "owner@example.com", emailVerified: true, adminEmails: ALLOW,
  }),
  "admin",
  "a verified allowlisted address (e.g. Google sign-in) still bootstraps admin",
);

assert.strictEqual(
  resolveInitialRole({
    email: "stranger@example.com", emailVerified: true, adminEmails: ALLOW,
  }),
  "learner",
  "verification alone grants nothing — the address must also be allowlisted",
);

// ── fail-closed on anything that is not literally `true` ───────────────────
for (const notProof of [undefined, null, "true", 1, {}, "yes"]) {
  assert.strictEqual(
    resolveInitialRole({
      email: "owner@example.com", emailVerified: notProof, adminEmails: ALLOW,
    }),
    "learner",
    `emailVerified=${JSON.stringify(notProof)} is not proof of ownership`,
  );
}

// A truthy-but-not-true value must not slip through the eligibility predicate
// either — it is the one both callers share.
assert.strictEqual(
  isAdminBootstrapEligible({
    email: "owner@example.com", emailVerified: "true", adminEmails: ALLOW,
  }),
  false,
  "the string 'true' is not a verified flag",
);

// An empty address must never match an allowlist that itself parsed clean.
assert.strictEqual(
  isAdminBootstrapEligible({
    email: "", emailVerified: true, adminEmails: ALLOW,
  }),
  false,
  "an account with no email cannot match the allowlist",
);

// Case/whitespace on the INCOMING address, not just the configured one.
assert.strictEqual(
  resolveInitialRole({
    email: "  OWNER@Example.com  ", emailVerified: true, adminEmails: ALLOW,
  }),
  "admin",
  "the incoming address is normalized the same way the allowlist is",
);

// ── bootstrapUserProfile: the sharper path ─────────────────────────────────
// Admin-SDK write (no create rule) from a callable exempt from
// assertVerifiedAuth. An attacker holding an admin CLAIM but no proven address
// must not be able to convert it into an authoritative users.role.
for (const claim of ["admin", "superAdmin"]) {
  assert.strictEqual(
    resolveBootstrapProfileRole({
      tokenRole: claim,
      email: "owner@example.com",
      emailVerified: false,
      adminEmails: ALLOW,
    }),
    "learner",
    `an unverified caller must not carry a '${claim}' claim into the profile`,
  );

  assert.strictEqual(
    resolveBootstrapProfileRole({
      tokenRole: claim,
      email: "owner@example.com",
      emailVerified: true,
      adminEmails: ALLOW,
    }),
    claim,
    `a verified '${claim}' keeps their role when the profile is repaired`,
  );
}

// The claim is the only source of superAdmin — an allowlist match alone tops
// out at "admin", so bootstrap can never invent the higher role.
assert.strictEqual(
  resolveBootstrapProfileRole({
    tokenRole: "",
    email: "owner@example.com",
    emailVerified: true,
    adminEmails: ALLOW,
  }),
  "admin",
  "no claim + allowlisted + verified → admin, never superAdmin",
);

// An ordinary user repairing their profile is unaffected by any of this.
assert.strictEqual(
  resolveBootstrapProfileRole({
    tokenRole: "learner",
    email: "pupil@example.com",
    emailVerified: true,
    adminEmails: ALLOW,
  }),
  "learner",
  "a normal verified learner still repairs to learner",
);
assert.strictEqual(
  resolveBootstrapProfileRole({
    tokenRole: "learner",
    email: "pupil@example.com",
    emailVerified: false,
    adminEmails: ALLOW,
  }),
  "learner",
  "an unverified learner still repairs to learner — the gate costs them nothing",
);

// A role string that is not recognised as elevated is not passed through.
assert.strictEqual(
  resolveBootstrapProfileRole({
    tokenRole: "ADMIN",
    email: "stranger@example.com",
    emailVerified: true,
    adminEmails: ALLOW,
  }),
  "learner",
  "elevation is matched exactly — 'ADMIN' is not the 'admin' claim",
);

// ── an empty allowlist grants nothing to anyone ────────────────────────────
assert.strictEqual(
  resolveInitialRole({
    email: "owner@example.com", emailVerified: true, adminEmails: [],
  }),
  "learner",
  "ADMIN_EMAILS unset (the shipped default) bootstraps no admins at all",
);

console.log("All adminBootstrapCore tests passed.");
