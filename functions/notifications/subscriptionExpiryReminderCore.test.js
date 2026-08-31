"use strict";

/**
 * npm run test:subscription-expiry-reminder
 *
 * Pure decision tests for subscriptionExpiryReminderCore.js — PAY-001,
 * Limit 2 (BUG_REPORT.md): a guardian-funded subscription's expiry reminder
 * must reach the guardian who pays, not the child who cannot.
 */

const assert = require("node:assert");
const {guardianUidFor, resolveExpiryReminderTarget} = require("./subscriptionExpiryReminderCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// ── guardianUidFor ──────────────────────────────────────────────────────
ok(
    "no field at all — self-funded, no guardian",
    guardianUidFor({}, "u_child") === null,
);
ok(
    "guardian uid present — redirected",
    guardianUidFor({subscriptionGrantedByGuardian: "u_parent"}, "u_child") === "u_parent",
);
ok(
    "guardian uid equal to the account's own uid — refused, not a loop",
    guardianUidFor({subscriptionGrantedByGuardian: "u_child"}, "u_child") === null,
);
ok(
    "non-string value is ignored",
    guardianUidFor({subscriptionGrantedByGuardian: 123}, "u_child") === null,
);
ok(
    "blank string is ignored",
    guardianUidFor({subscriptionGrantedByGuardian: "   "}, "u_child") === null,
);
ok(
    "whitespace is trimmed",
    guardianUidFor({subscriptionGrantedByGuardian: "  u_parent  "}, "u_child") === "u_parent",
);

// ── resolveExpiryReminderTarget: self-funded ────────────────────────────
{
  const t = resolveExpiryReminderTarget({
    uid: "u_self", data: {}, days: 2, dateKey: "2026-08-31",
  });
  ok("self-funded addresses the account itself", t.recipientUid === "u_self");
  ok("self-funded is not guardian-routed", t.guardianRouted === false);
  ok("self-funded body reads 'Your'", /^Your plan ends in 2 days\./.test(t.body));
  ok("self-funded action points at the learner's own subscription page", t.action.url === "/my-subscription");
  ok("self-funded dedupe key carries the account's own uid", t.dedupeKey === "expiry-2026-08-31-u_self");
}

// ── resolveExpiryReminderTarget: guardian-funded ────────────────────────
{
  const t = resolveExpiryReminderTarget({
    uid: "u_child",
    data: {subscriptionGrantedByGuardian: "u_parent", displayName: "Milton Phiri"},
    days: 1,
    dateKey: "2026-08-31",
  });
  ok("guardian-funded addresses the GUARDIAN, not the child", t.recipientUid === "u_parent");
  ok("guardian-funded is flagged as routed", t.guardianRouted === true);
  ok("guardian-funded body names the child", t.body.startsWith("Milton Phiri's plan ends in 1 day."));
  ok("guardian-funded action points at the family plan page", t.action.url === "/family/plan");
  // Keyed on the CHILD's uid so a guardian with two children due the same
  // day gets two distinct notifications rather than a deduped one.
  ok("guardian-funded dedupe key carries the CHILD's uid", t.dedupeKey === "expiry-2026-08-31-u_child");
}

// ── resolveExpiryReminderTarget: guardian-funded, no display name ───────
{
  const t = resolveExpiryReminderTarget({
    uid: "u_child2",
    data: {subscriptionGrantedByGuardian: "u_parent2"},
    days: 3,
    dateKey: "2026-08-31",
  });
  ok("missing child name falls back to a generic subject", t.body.startsWith("The plan ends in 3 days."));
}

// ── A guardian with two children due the same day is not deduped ───────
{
  const a = resolveExpiryReminderTarget({
    uid: "u_child_a", data: {subscriptionGrantedByGuardian: "u_parent3"}, days: 1, dateKey: "2026-08-31",
  });
  const b = resolveExpiryReminderTarget({
    uid: "u_child_b", data: {subscriptionGrantedByGuardian: "u_parent3"}, days: 1, dateKey: "2026-08-31",
  });
  ok("both route to the same guardian", a.recipientUid === b.recipientUid);
  ok("but carry different dedupe keys", a.dedupeKey !== b.dedupeKey);
}

console.log(`${passed} assertions passed (subscriptionExpiryReminderCore).`);
