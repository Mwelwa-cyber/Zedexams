/**
 * Node test for MoMo settlement verification.
 * Run: node functions/momoSettlement.test.js
 */

const assert = require("node:assert");
const {verifySettledAmount} = require("./momoSettlement");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("momoSettlement");

const monthly = {id: "monthly", amountZMW: 50};
const yearly = {id: "yearly", amountZMW: 400};

// ── Happy paths ──────────────────────────────────────────────────────────
ok("exact match (live ZMW) → ok",
  verifySettledAmount(monthly, "ZMW", {amount: "50", currency: "ZMW"}).ok === true);
ok("exact match yearly → ok",
  verifySettledAmount(yearly, "ZMW", {amount: "400", currency: "ZMW"}).ok === true);
ok("sandbox EUR match → ok (non-breaking for sandbox)",
  verifySettledAmount(monthly, "EUR", {amount: "50", currency: "EUR"}).ok === true);
ok("decimal string '50.00' equals 50 → ok",
  verifySettledAmount(monthly, "ZMW", {amount: "50.00", currency: "ZMW"}).ok === true);
ok("numeric amount (not string) → ok",
  verifySettledAmount(monthly, "ZMW", {amount: 50, currency: "ZMW"}).ok === true);
ok("currency case-insensitive → ok",
  verifySettledAmount(monthly, "zmw", {amount: "50", currency: "ZMW"}).ok === true);

// ── The core exploit: under-payment / wrong plan price ───────────────────
const under = verifySettledAmount(yearly, "ZMW", {amount: "50", currency: "ZMW"});
ok("pay K50 but plan is K400 → blocked", under.ok === false);
ok("under-payment reason = amount_mismatch", under.reason === "amount_mismatch");
ok("over-payment also blocked (mismatch)",
  verifySettledAmount(monthly, "ZMW", {amount: "60", currency: "ZMW"}).ok === false);

// ── Currency confusion (sandbox EUR settling a live ZMW order) ───────────
const cur = verifySettledAmount(monthly, "ZMW", {amount: "50", currency: "EUR"});
ok("currency mismatch → blocked", cur.ok === false);
ok("currency mismatch reason", cur.reason === "currency_mismatch");

// ── Fail-closed on missing / unusable provider data ──────────────────────
ok("no raw response → blocked",
  verifySettledAmount(monthly, "ZMW", null).reason === "provider_response_missing");
ok("missing amount → blocked",
  verifySettledAmount(monthly, "ZMW", {currency: "ZMW"}).reason === "provider_amount_missing");
ok("empty amount string → blocked",
  verifySettledAmount(monthly, "ZMW", {amount: "  ", currency: "ZMW"}).reason === "provider_amount_missing");
ok("unparseable amount → blocked",
  verifySettledAmount(monthly, "ZMW", {amount: "free", currency: "ZMW"}).reason === "provider_amount_unparseable");
ok("missing currency when expected → blocked",
  verifySettledAmount(monthly, "ZMW", {amount: "50"}).reason === "currency_mismatch");
ok("invalid plan → blocked",
  verifySettledAmount(null, "ZMW", {amount: "50", currency: "ZMW"}).reason === "plan_invalid");

// ── No expected currency configured → amount-only check ──────────────────
ok("no expectedCurrency → amount-only, matches",
  verifySettledAmount(monthly, "", {amount: "50", currency: "ZMW"}).ok === true);

console.log(`\n─── ${passed} assertions · all passed ───`);
