/**
 * Node test for the prorated tier-upgrade pricing
 * (functions/subscriptionUpgrade.js). This is money logic, so the daily-rate
 * maths, the Pro→Max-only gate, the "no days left" / "already Max" no-ops, and
 * the minimum-charge floor all get pinned.
 *
 * Pure module (require('./plans') only) — plain `node` script, repo convention.
 *
 * Run: node functions/subscriptionUpgrade.test.js
 */

const assert = require("node:assert");
const {
  MIN_UPGRADE_ZMW,
  planTier,
  dailyRate,
  isUpgradePath,
  computeUpgradeQuote,
  resolveCurrentProPlanId,
  quoteUpgradeForUser,
} = require("./subscriptionUpgrade");
const {getPlan} = require("./plans");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-19T00:00:00Z");
const inDays = (n) => new Date(NOW.getTime() + n * DAY);

console.log("subscriptionUpgrade");

// ── tier + daily rate ──────────────────────────────────────────────────────
ok("planTier maps pro/max ids", planTier("pro_monthly") === "pro" && planTier("max_yearly") === "max");
ok("planTier null for learner packs", planTier("grade7_monthly") === null);
ok("dailyRate pro_monthly = 79/30", Math.abs(dailyRate(getPlan("pro_monthly")) - (79 / 30)) < 1e-9);
ok("dailyRate guards zero duration", dailyRate({priceZMW: 10, durationDays: 0}) === 0);

// ── isUpgradePath ──────────────────────────────────────────────────────────
ok("pro → max is an upgrade", isUpgradePath("pro_monthly", "max_monthly"));
ok("pro_yearly → max_yearly is an upgrade", isUpgradePath("pro_yearly", "max_yearly"));
ok("max → max is NOT an upgrade", !isUpgradePath("max_monthly", "max_yearly"));
ok("max → pro is NOT an upgrade (downgrade)", !isUpgradePath("max_monthly", "pro_monthly"));
ok("pro → pro is NOT an upgrade (renewal)", !isUpgradePath("pro_monthly", "pro_yearly"));
ok("learner pack is NOT an upgrade", !isUpgradePath("grade7_monthly", "max_monthly"));

// ── computeUpgradeQuote maths ──────────────────────────────────────────────
{
  // pro_monthly (79/30) → max_monthly (199/30): diff/day = (199-79)/30 = 4.0
  const q = computeUpgradeQuote({
    fromPlan: getPlan("pro_monthly"), toPlan: getPlan("max_monthly"), expiry: inDays(30), now: NOW,
  });
  ok("monthly→monthly, 30 days: prorated = round(4*30)=120", q.amountZMW === 120 && q.isUpgrade);
  ok("quote reports daysRemaining", q.daysRemaining === 30);
}
{
  // The screenshot case: ~114 days left on Pro · Yearly upgrading to Max.
  // pro_yearly daily = 790/365 ≈ 2.164; max_monthly daily = 199/30 ≈ 6.633.
  const q = computeUpgradeQuote({
    fromPlan: getPlan("pro_yearly"), toPlan: getPlan("max_monthly"), expiry: inDays(114), now: NOW,
  });
  const expected = Math.round(((199 / 30) - (790 / 365)) * 114);
  ok("yearly→monthly, 114 days: matches daily-diff maths", q.amountZMW === expected && q.isUpgrade);
  ok("prorated upgrade is far cheaper than full Max price", q.amountZMW < getPlan("max_monthly").priceZMW * 4);
}

// ── no-op cases ────────────────────────────────────────────────────────────
ok("expired (0 days left) is not an upgrade",
    computeUpgradeQuote({fromPlan: getPlan("pro_monthly"), toPlan: getPlan("max_monthly"), expiry: inDays(-3), now: NOW}).isUpgrade === false);
ok("no expiry is not an upgrade",
    computeUpgradeQuote({fromPlan: getPlan("pro_monthly"), toPlan: getPlan("max_monthly"), expiry: null, now: NOW}).isUpgrade === false);

// ── minimum-charge floor ───────────────────────────────────────────────────
{
  // 1 day left: round(4.0*1)=4 → above floor, but assert the floor never
  // produces a zero charge for a genuine upgrade.
  const q = computeUpgradeQuote({
    fromPlan: getPlan("pro_monthly"), toPlan: getPlan("max_monthly"), expiry: inDays(1), now: NOW,
  });
  ok("1 day upgrade still charges at least the floor", q.amountZMW >= MIN_UPGRADE_ZMW && q.isUpgrade);
}

// ── resolveCurrentProPlanId ────────────────────────────────────────────────
ok("resolves concrete pro plan from profile", resolveCurrentProPlanId({subscriptionPlan: "pro_yearly"}) === "pro_yearly");
ok("falls back to pro_monthly for unknown plan", resolveCurrentProPlanId({subscriptionPlan: "legacy"}) === "pro_monthly");
ok("falls back to pro_monthly when missing", resolveCurrentProPlanId({}) === "pro_monthly");

// ── quoteUpgradeForUser (profile → quote) ──────────────────────────────────
{
  const user = {subscriptionPlan: "pro_monthly", teacherPlanExpiresAt: inDays(30)};
  const q = quoteUpgradeForUser(user, "max_monthly", NOW);
  ok("active Pro teacher upgrading to Max → isUpgrade", q.isUpgrade && q.amountZMW === 120);
  ok("quote records the source plan", q.fromPlanId === "pro_monthly");
}
ok("Max teacher 'upgrading' to Max is not an upgrade",
    quoteUpgradeForUser({subscriptionPlan: "max_monthly", teacherPlanExpiresAt: inDays(30)}, "max_yearly", NOW).isUpgrade === false);
ok("free teacher (no expiry) → not an upgrade, full price applies",
    quoteUpgradeForUser({}, "max_monthly", NOW).isUpgrade === false);
{
  // teacherPlanExpiresAt takes precedence; falls back to subscriptionExpiry.
  const q = quoteUpgradeForUser({subscriptionPlan: "pro_monthly", subscriptionExpiry: inDays(15)}, "max_monthly", NOW);
  ok("falls back to subscriptionExpiry for the days-left calc", q.isUpgrade && q.daysRemaining === 15);
}

console.log(`\n${passed} passed`);
