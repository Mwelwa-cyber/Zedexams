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
ok("dailyRate pro_monthly = price/30", Math.abs(dailyRate(getPlan("pro_monthly")) - (getPlan("pro_monthly").priceZMW / 30)) < 1e-9);
ok("dailyRate guards zero duration", dailyRate({priceZMW: 10, durationDays: 0}) === 0);

// ── isUpgradePath ──────────────────────────────────────────────────────────
ok("pro → max (same period) is an upgrade", isUpgradePath("pro_monthly", "max_monthly"));
ok("pro_yearly → max_yearly (same period) is an upgrade", isUpgradePath("pro_yearly", "max_yearly"));
ok("max → max is NOT an upgrade", !isUpgradePath("max_monthly", "max_yearly"));
ok("max → pro is NOT an upgrade (downgrade)", !isUpgradePath("max_monthly", "pro_monthly"));
ok("pro → pro is NOT an upgrade (renewal)", !isUpgradePath("pro_monthly", "pro_yearly"));
ok("learner pack is NOT an upgrade", !isUpgradePath("grade7_monthly", "max_monthly"));
// Cross-cadence Pro→Max is NOT a prorated upgrade: keeping the monthly renewal
// date while charging a yearly plan's (lower) daily rate is nonsense, so these
// fall through to full-price checkout that starts a fresh term.
ok("pro_monthly → max_yearly is NOT a prorated upgrade (cross-period)", !isUpgradePath("pro_monthly", "max_yearly"));
ok("pro_yearly → max_monthly is NOT a prorated upgrade (cross-period)", !isUpgradePath("pro_yearly", "max_monthly"));

// ── computeUpgradeQuote maths ──────────────────────────────────────────────
{
  // pro_monthly → max_monthly: a full 30 days left → pay exactly the
  // monthly price difference (Max − Pro).
  const q = computeUpgradeQuote({
    fromPlan: getPlan("pro_monthly"), toPlan: getPlan("max_monthly"), expiry: inDays(30), now: NOW,
  });
  const fullMonthDiff = getPlan("max_monthly").priceZMW - getPlan("pro_monthly").priceZMW;
  ok("monthly→monthly, 30 days: prorated = full monthly diff", q.amountZMW === fullMonthDiff && q.isUpgrade);
  ok("quote reports daysRemaining", q.daysRemaining === 30);
}
{
  // The screenshot case: ~114 days left on Pro · Yearly upgrading to Max.
  // Daily rates derived from the catalogue: max_monthly/30 minus pro_yearly/365.
  const q = computeUpgradeQuote({
    fromPlan: getPlan("pro_yearly"), toPlan: getPlan("max_monthly"), expiry: inDays(114), now: NOW,
  });
  const expected = Math.round(((getPlan("max_monthly").priceZMW / 30) - (getPlan("pro_yearly").priceZMW / 365)) * 114);
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
  ok("active Pro teacher upgrading to Max → isUpgrade",
      q.isUpgrade && q.amountZMW === (getPlan("max_monthly").priceZMW - getPlan("pro_monthly").priceZMW));
  ok("quote records the source plan", q.fromPlanId === "pro_monthly");
}
ok("Max teacher 'upgrading' to Max is not an upgrade",
    quoteUpgradeForUser({subscriptionPlan: "max_monthly", teacherPlanExpiresAt: inDays(30)}, "max_yearly", NOW).isUpgrade === false);
{
  // The reported bug: a Pro · Monthly teacher choosing Max · Yearly must NOT be
  // quoted a prorated fee (which came out below the monthly upgrade and granted
  // no days). It's a full-price plan change.
  const q = quoteUpgradeForUser({subscriptionPlan: "pro_monthly", teacherPlanExpiresAt: inDays(29)}, "max_yearly", NOW);
  ok("pro_monthly → max_yearly is not a prorated upgrade → full price", q.isUpgrade === false);
}
ok("free teacher (no expiry) → not an upgrade, full price applies",
    quoteUpgradeForUser({}, "max_monthly", NOW).isUpgrade === false);
{
  // teacherPlanExpiresAt takes precedence; falls back to subscriptionExpiry.
  const q = quoteUpgradeForUser({subscriptionPlan: "pro_monthly", subscriptionExpiry: inDays(15)}, "max_monthly", NOW);
  ok("falls back to subscriptionExpiry for the days-left calc", q.isUpgrade && q.daysRemaining === 15);
}

// ── projectRenewalDate (checkout's promised date must match activation) ───
{
  const {projectRenewalDate} = require("./subscriptionUpgrade");
  // Prorated upgrade keeps the current renewal date — no days added.
  const upgradeDate = projectRenewalDate(
      {subscriptionPlan: "pro_monthly", teacherPlanExpiresAt: inDays(19)}, "max_monthly", NOW);
  ok("upgrade keeps the current renewal date", upgradeDate.getTime() === inDays(19).getTime());
  // Fresh purchase with no active sub → now + durationDays.
  const fresh = projectRenewalDate({}, "pro_monthly", NOW);
  ok("fresh purchase renews durationDays from now", fresh.getTime() === inDays(30).getTime());
  // Early renewal stacks onto the still-active expiry (mirror of activation).
  const stacked = projectRenewalDate(
      {subscriptionPlan: "pro_monthly", teacherPlanExpiresAt: inDays(10)}, "pro_monthly", NOW);
  ok("early renewal stacks onto the active expiry", stacked.getTime() === inDays(40).getTime());
  // Lapsed sub → a fresh period from now, not from the old expiry.
  const lapsed = projectRenewalDate(
      {subscriptionPlan: "pro_monthly", teacherPlanExpiresAt: inDays(-5)}, "pro_monthly", NOW);
  ok("lapsed sub starts a fresh period from now", lapsed.getTime() === inDays(30).getTime());
  // Top-up has no duration → no renewal date.
  ok("top-up has no renewal date", projectRenewalDate({}, "topup_generation", NOW) === null);
}

console.log(`\n${passed} passed`);
