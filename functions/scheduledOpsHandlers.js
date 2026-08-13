/**
 * Scheduled maintenance bodies. Both are one-line delegations; they are here so the batch leaves no member behind, not because the bodies are large.
 *
 * Phase 5 batch 2 (docs/phase5-plan.md): the BODIES live here; the builders
 * and their frozen options — region, timeout, memory, secrets, App Check —
 * stay in functions/index.js, where the frozen-surface guard reads them.
 * Moving an option here would move it out of the guard's sight, which is the
 * one thing this phase must not do.
 *
 * Bodies are moved VERBATIM. An extraction PR carries no behaviour change, so
 * that a failure can be attributed to relocation or to behaviour and never
 * both; audit burn-down items are separate PRs even on these same functions.
 *
 * Everything the bodies close over is INJECTED rather than re-required. The
 * secret params (`defineSecret` handles) must be the same instances the
 * builders bind — re-declaring them here would create different objects
 * bound to nothing.
 */
exports.buildScheduledOpsHandlers = (deps) => {
  const {
    runFunctionErrorWatch,
  } = deps;

  return {
    accountPurgeSweep: async () => {
      await require("./account/accountPurgeSweeper").runAccountPurgeSweep();
    },

    functionErrorWatch: async () => {
    await runFunctionErrorWatch();
  },
  };
};
