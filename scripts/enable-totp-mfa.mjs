#!/usr/bin/env node
/**
 * scripts/enable-totp-mfa.mjs
 *
 * One-time trusted operator script that turns on authenticator-app (TOTP)
 * multi-factor authentication for the ZedExams Firebase project through the
 * Firebase Admin SDK / Identity Platform project-config API.
 *
 * TOTP is compatible with Google Authenticator, Microsoft Authenticator,
 * Authy, 1Password and any other RFC 6238 authenticator. SMS is deliberately
 * NOT enabled as a factor here — administrators enrol an authenticator app.
 *
 * ── Prerequisite (must be done once in the Firebase console, cannot be
 *    scripted) ────────────────────────────────────────────────────────────
 *   Firebase Authentication with **Identity Platform** must be enabled for
 *   the project. TOTP MFA is an Identity Platform feature; without the
 *   upgrade this script's updateProjectConfig call fails with a clear
 *   CONFIGURATION_NOT_FOUND / admin-restricted-operation error. Enable it at:
 *     Firebase console → Authentication → Sign-in method →
 *       Advanced → Multi-factor authentication → Upgrade to Identity Platform
 *
 * ── Credentials (never committed) ─────────────────────────────────────────
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   The service-account JSON stays OUT of the repo (.gitignore already blocks
 *   *serviceAccount*.json / *.serviceaccount.json). This script reads the path
 *   from the environment — it never embeds a key.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   # dry-run (default): prints the config it WOULD write, changes nothing
 *   node scripts/enable-totp-mfa.mjs
 *
 *   # actually enable TOTP MFA
 *   node scripts/enable-totp-mfa.mjs --live
 *
 *   # tune the clock-drift allowance (adjacent 30s windows, default 5)
 *   node scripts/enable-totp-mfa.mjs --live --intervals 5
 *
 * This script is intentionally NOT part of any deploy workflow — enabling a
 * project-wide auth policy is a deliberate operator action, not something any
 * `firebase deploy` should trigger. See docs/security/ADMIN_MFA_RUNBOOK.md.
 */

function parseArgs(argv) {
  const args = { live: false, intervals: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--intervals") args.intervals = Number(argv[++i]);
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      "Usage: node scripts/enable-totp-mfa.mjs [--live] [--intervals <1-10>]\n" +
      "  --live         Actually write the project config (default: dry-run).\n" +
      "  --intervals N  Adjacent 30s windows accepted for clock drift (1-10, default 5).",
    );
    process.exit(0);
  }

  // adjacentIntervals is the authenticator clock-drift allowance: each unit is
  // one 30-second TOTP window on either side of "now". 5 ≈ ±2.5 min, a sane
  // tolerance for phones with mild clock skew without meaningfully widening the
  // brute-force surface. Identity Platform accepts 1-10.
  if (!Number.isInteger(args.intervals) || args.intervals < 1 || args.intervals > 10) {
    console.error(`ERROR: --intervals must be an integer 1-10 (got '${args.intervals}').`);
    process.exit(1);
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.\n" +
      "  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json",
    );
    process.exit(1);
  }

  let admin;
  try {
    admin = (await import("firebase-admin")).default;
  } catch {
    console.error("ERROR: install firebase-admin first: `npm install --save-dev firebase-admin`");
    process.exit(1);
  }

  admin.initializeApp();
  const auth = admin.auth();

  const multiFactorConfig = {
    // Optional across the whole project — enforcement for administrators is
    // handled by the app (route guard + requireAdminMfa Cloud Function guard),
    // so ordinary teachers/learners are never forced to enrol.
    state: "ENABLED",
    providerConfigs: [
      {
        state: "ENABLED",
        totpProviderConfig: {
          adjacentIntervals: args.intervals,
        },
      },
    ],
  };

  console.log("# planned project MFA config:");
  console.log(JSON.stringify(multiFactorConfig, null, 2));

  if (!args.live) {
    console.log("— Dry run. Pass --live to write this config to the project. —");
    return;
  }

  const manager = auth.projectConfigManager?.();
  if (!manager || typeof manager.updateProjectConfig !== "function") {
    console.error(
      "ERROR: this firebase-admin version has no projectConfigManager().\n" +
      "  Upgrade firebase-admin (>= 11.9) which exposes updateProjectConfig().",
    );
    process.exit(1);
  }

  try {
    await manager.updateProjectConfig({ multiFactorConfig });
  } catch (err) {
    const code = err?.errorInfo?.code || err?.code || "";
    const msg = err?.errorInfo?.message || err?.message || String(err);
    console.error(`ERROR: failed to enable TOTP MFA (${code || "unknown"}): ${msg}`);
    if (/identity[- ]platform|CONFIGURATION_NOT_FOUND|admin-restricted-operation|BILLING/i.test(`${code} ${msg}`)) {
      console.error(
        "\nThis usually means Firebase Authentication with Identity Platform is\n" +
        "not enabled for this project yet. Enable it in the Firebase console\n" +
        "(Authentication → Sign-in method → Multi-factor authentication →\n" +
        "Upgrade to Identity Platform), then re-run this script.",
      );
    }
    process.exit(1);
  }

  // Read the config back to confirm the change actually landed.
  try {
    const after = await manager.getProjectConfig();
    const providers = after?.multiFactorConfig?.providerConfigs || [];
    const totp = providers.find((p) => p.totpProviderConfig);
    console.log("✓ TOTP MFA enabled for the project.");
    console.log(`  state:             ${after?.multiFactorConfig?.state}`);
    console.log(`  totp provider:     ${totp ? totp.state : "(missing!)"}`);
    console.log(`  adjacentIntervals: ${totp?.totpProviderConfig?.adjacentIntervals ?? "(unset)"}`);
    if (!totp || totp.state !== "ENABLED") {
      console.error("WARNING: TOTP provider is not ENABLED in the read-back config. Verify in the console.");
      process.exit(1);
    }
  } catch (err) {
    console.warn(`WARNING: config written but read-back failed: ${err?.message || err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
