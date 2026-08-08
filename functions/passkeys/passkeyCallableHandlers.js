/**
 * The seven passkey callable HANDLER BODIES, extracted from
 * `functions/index.js` (Phase 5, batch 1a — docs/phase5-plan.md).
 *
 * Extraction shape: `index.js` keeps every `onCall({...options...}, handler)`
 * builder — so the frozen surface (region, timeout, memory, App Check
 * enforcement) stays declared where the manifest guard reads it — and only
 * the body moves here. `recordAppCheckCallable` is injected rather than
 * imported because it lives in `index.js` beside the enforcement rollout
 * state it shares with ~40 other callables; moving THAT is shared-
 * infrastructure surgery, not a mechanical batch.
 *
 * Behaviour-identical by construction: each handler is the exact statement
 * pair it replaces — observe App Check, then delegate to the passkey service
 * runner. The regional `…Africa` twins are factory-built elsewhere and are
 * not part of this move.
 */
const {
  runGeneratePasskeyRegistrationOptions,
  runVerifyPasskeyRegistration,
  runGeneratePasskeyAuthenticationOptions,
  runVerifyPasskeyAuthentication,
  runListUserPasskeys,
  runRenameUserPasskey,
  runRemoveUserPasskey,
} = require("./passkeyService");

/**
 * @param {{recordAppCheckCallable: (request: object, label: string) => Promise<void>}} deps
 */
function buildPasskeyCallableHandlers({recordAppCheckCallable}) {
  return {
    generatePasskeyRegistrationOptions: async (request) => {
      await recordAppCheckCallable(request, "generatePasskeyRegistrationOptions");
      return runGeneratePasskeyRegistrationOptions(request);
    },
    verifyPasskeyRegistration: async (request) => {
      await recordAppCheckCallable(request, "verifyPasskeyRegistration");
      return runVerifyPasskeyRegistration(request);
    },
    generatePasskeyAuthenticationOptions: async (request) => {
      await recordAppCheckCallable(request, "generatePasskeyAuthenticationOptions");
      return runGeneratePasskeyAuthenticationOptions(request, {region: "us-central1"});
    },
    verifyPasskeyAuthentication: async (request) => {
      await recordAppCheckCallable(request, "verifyPasskeyAuthentication");
      return runVerifyPasskeyAuthentication(request, {region: "us-central1"});
    },
    listUserPasskeys: async (request) => {
      await recordAppCheckCallable(request, "listUserPasskeys");
      return runListUserPasskeys(request);
    },
    renameUserPasskey: async (request) => {
      await recordAppCheckCallable(request, "renameUserPasskey");
      return runRenameUserPasskey(request);
    },
    removeUserPasskey: async (request) => {
      await recordAppCheckCallable(request, "removeUserPasskey");
      return runRemoveUserPasskey(request);
    },
  };
}

module.exports = {buildPasskeyCallableHandlers};
