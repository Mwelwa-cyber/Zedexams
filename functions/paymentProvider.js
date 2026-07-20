/**
 * paymentProvider — the single seam that selects the payment provider client.
 *
 * Returns the REAL Lenco client (functions/lencoService.js) in every normal
 * runtime, and the mock adapter (functions/mockPaymentProvider.js) ONLY in an
 * explicitly-isolated test/emulator environment. This gives us a safe way to
 * exercise the full authenticated payment lifecycle end-to-end without moving
 * real money (launch-blocker #7), while making it IMPOSSIBLE to accidentally
 * serve mocked payments in production.
 *
 * Hard production guard: the mock is selectable only when BOTH
 *   (a) PAYMENTS_PROVIDER=mock is set, AND
 *   (b) we are demonstrably NOT in a deployed production function — i.e. the
 *       Functions emulator (FUNCTIONS_EMULATOR=true), a test runner
 *       (NODE_ENV=test), or an explicit ALLOW_MOCK_PAYMENTS=1 opt-in on a
 *       non-production build.
 * A deployed production function has FUNCTIONS_EMULATOR unset and
 * NODE_ENV=production, so `mockAllowed()` returns false there no matter what
 * PAYMENTS_PROVIDER says.
 */

const realLencoClient = require("./lencoService");

function mockAllowed() {
  const wantsMock = String(process.env.PAYMENTS_PROVIDER || "").toLowerCase() === "mock";
  if (!wantsMock) return false;

  const inEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  const inTest = process.env.NODE_ENV === "test";
  const explicitOptIn = process.env.ALLOW_MOCK_PAYMENTS === "1";
  const inProduction = process.env.NODE_ENV === "production" && !inEmulator;

  // Belt AND suspenders: never in production, only in a recognised safe env.
  if (inProduction) return false;
  return inEmulator || inTest || explicitOptIn;
}

let warned = false;
function getPaymentProvider() {
  if (mockAllowed()) {
    if (!warned) {
      warned = true;
      console.warn(
          "[paymentProvider] ⚠️  MOCK payment provider active — NO real money moves. " +
          "This can never happen in a deployed production function.",
      );
    }
    return require("./mockPaymentProvider");
  }
  return realLencoClient;
}

module.exports = {getPaymentProvider, mockAllowed};
