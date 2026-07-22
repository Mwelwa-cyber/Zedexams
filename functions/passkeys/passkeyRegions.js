// Passkey Cloud Function region registry — single source of truth for the
// staged us-central1 → africa-south1 migration (Firestore colocation; the
// (default) database lives in africa-south1, so every sequential Firestore
// operation on the sign-in path currently pays a cross-region round trip).
//
// Migration model (docs/PASSKEYS.md → "Regional deployment"):
//   - The four FLOW callables (registration + authentication, i.e. everything
//     a sign-in or enrolment actually waits on) get an africa-south1 twin
//     exported under `<baseName>Africa`, deployed ALONGSIDE — never replacing —
//     the us-central1 originals. Both twins call the exact same handler in
//     passkeyService.js with the exact same runtime options and the same
//     App Check enforcement key (the base name), so request/response schemas,
//     security checks and error codes are identical by construction.
//   - The three MANAGEMENT callables (list/rename/remove) stay us-central1
//     only: they are not on the sign-in path, their latency is invisible
//     (settings screen), and keeping them out of the migration shrinks the
//     surface that has to be verified and rolled back.
//   - Client routing + rollback is a Firestore feature flag
//     (settings/global.featureFlags.passkeyFunctionsRegion) resolved in
//     src/services/passkeyRegionCore.js — which MIRRORS the constants below
//     (guarded by scripts/test-passkey-region-routing.mjs). Keep them in sync.
//   - Deleting the us-central1 twins is a separate, explicitly-approved step
//     after the observation window closes — never part of this deployment.

const PASSKEY_PRIMARY_REGION = "us-central1";
const PASSKEY_REGIONAL_REGION = "africa-south1";
const PASSKEY_REGIONAL_SUFFIX = "Africa";

// Runtime options shared by every passkey callable in BOTH regions — the
// twins must never drift from the originals (guarded by passkeyRegions.test.js).
const PASSKEY_CALLABLE_RUNTIME = Object.freeze({
  timeoutSeconds: 30,
  memory: "256MiB",
});

// The four flow callables that get an africa-south1 twin. Order mirrors the
// export order in functions/index.js.
const PASSKEY_REGIONAL_CALLABLES = Object.freeze([
  "generatePasskeyRegistrationOptions",
  "verifyPasskeyRegistration",
  "generatePasskeyAuthenticationOptions",
  "verifyPasskeyAuthentication",
]);

// Intentionally left in us-central1 only (not on the sign-in path).
const PASSKEY_PRIMARY_ONLY_CALLABLES = Object.freeze([
  "listUserPasskeys",
  "renameUserPasskey",
  "removeUserPasskey",
]);

/** Temporary migration export name for a flow callable's regional twin. */
function regionalExportName(baseName) {
  return `${baseName}${PASSKEY_REGIONAL_SUFFIX}`;
}

module.exports = {
  PASSKEY_PRIMARY_REGION,
  PASSKEY_REGIONAL_REGION,
  PASSKEY_REGIONAL_SUFFIX,
  PASSKEY_CALLABLE_RUNTIME,
  PASSKEY_REGIONAL_CALLABLES,
  PASSKEY_PRIMARY_ONLY_CALLABLES,
  regionalExportName,
};
