"use strict";

/**
 * Pins the two producers the parent portal cleanup depends on being CLOSED.
 *
 * `scripts/cleanup-parent-portal.mjs` deletes `guardianLinkClaims` and reports
 * the date after which `weeklyParentDigest` has nothing left to send. Both
 * statements are only true if nothing keeps making new ones:
 *
 *   • `attachOnApproval` (guardianLink/convergence.js) used to write a claim
 *     whenever an emailed approval had no matching parent account — and with
 *     the parent app gone, nothing can redeem one. A claim is a child's uid
 *     indexed by a guardian's email address.
 *   • `createProgressShare` (parentPortal.js) used to mint a 90-day share for
 *     any verified learner. 4a removed the buttons, not the callable, so an
 *     older client or a direct call could still make a link that outlives the
 *     "latest live expiry" the report prints.
 *
 * Text-level on purpose (the house style for "this path must not exist"): the
 * modules reach the Admin SDK, and a behavioural test would have to fake it
 * to prove an ABSENCE, which proves only the fake.
 */

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (rel) => strip(readFileSync(path.join(__dirname, rel), "utf8"));

console.log("parent portal retired producers");

test("attachOnApproval never writes to guardianLinkClaims", () => {
  const code = read("guardianLink/convergence.js");
  // CLAIMS may still be READ by claimForGuardian (kept, harmless); it must not
  // be written. Any .set/.add/.create/.update on a CLAIMS doc is a producer.
  assert.ok(
      // `[\s\S]{0,120}?` rather than `\([^)]*\)`: the doc id is `claimId(a, b)`,
      // which has parentheses of its own.
      !/collection\(CLAIMS\)\s*\.doc\([\s\S]{0,120}?\)\s*\.(set|create|update)\s*\(/.test(code),
      "convergence.js writes a guardianLinkClaims doc — nothing can redeem it any more",
  );
  assert.ok(!/collection\(CLAIMS\)\s*\.add\s*\(/.test(code), "convergence.js adds a claim");
  assert.ok(!/link_claim_recorded/.test(code), "the claim audit event should go with the claim");
});

test("attachOnApproval still attaches an existing parent account", () => {
  const code = read("guardianLink/convergence.js");
  assert.ok(/writeApprovedLink\(db,/.test(code), "the account-exists path must still create the link");
  assert.ok(/reason: "no-account"/.test(code), "the no-account path must still report why");
});

test("createProgressShare refuses and writes nothing", () => {
  const code = read("parentPortal.js");
  const start = code.indexOf("const createProgressShare");
  const end = code.indexOf("const revokeProgressShare");
  assert.ok(start >= 0 && end > start, "could not find createProgressShare");
  const body = code.slice(start, end);
  assert.ok(/failed-precondition/.test(body), "must refuse with failed-precondition");
  assert.ok(/reason: "retired"/.test(body), "the refusal should say why");
  assert.ok(!/progressShares/.test(body), "a retired callable must not touch progressShares");
  assert.ok(!/\.set\s*\(|\.add\s*\(|\.create\s*\(/.test(body), "a retired callable must not write");
});

test("revoking and viewing existing shares still work", () => {
  const code = read("parentPortal.js");
  assert.ok(/const revokeProgressShare/.test(code), "learners must still be able to revoke a link already issued");
  assert.ok(/const getProgressShare/.test(code), "an issued link must still open until it expires");
});

console.log(`\nparent portal retired producers: ${passed} passed`);
