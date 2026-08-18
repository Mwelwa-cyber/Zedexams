#!/usr/bin/env node
/**
 * CodeQL scans what we think it scans.
 *
 * A scanner reports "no new alerts" whether it examined the whole application
 * or none of it, so the ways this breaks are all silent:
 *
 *   1. A source root lands in `paths-ignore` — someone excludes `src` to quiet
 *      a noisy alert and the scan now covers nothing that ships.
 *   2. The workflow grows a `paths:` trigger filter, so it never starts on the
 *      PRs that change code.
 *   3. `config-file` points at a path that no longer exists.
 *   4. The workflow is HALF restored from dormancy — `pull_request` back but
 *      not `schedule`, or the reverse — so either PRs are scanned against a
 *      baseline nothing refreshes, or the baseline refreshes and no PR is ever
 *      scanned. Both look like a working scanner from the outside.
 *
 * Same shape as the Ledger no-op (test:release-notes) and the opt-in security
 * trigger (test:security-review-trigger): the failure is indistinguishable
 * from a clean result.
 *
 * DORMANCY. The workflow has automatic triggers OFF while the repository is
 * private without Code Security — see the header of codeql.yml for why. This
 * script accepts that state and SAYS SO on every run, because a guard that
 * quietly passes over disabled work reads exactly like one that found nothing
 * wrong. Everything that describes WHAT would be scanned — languages, build
 * mode, config file, paths-ignore — is asserted in both states, so the scan
 * cannot rot while it is switched off. The moment either trigger comes back,
 * the full unfiltered-trigger assertions apply again with no edit here.
 */

import assert from "node:assert";
import {existsSync, readFileSync} from "node:fs";
import yaml from "js-yaml";

const WORKFLOW_PATH = ".github/workflows/codeql.yml";
const wf = yaml.load(readFileSync(WORKFLOW_PATH, "utf8"));

// js-yaml resolves the `on:` key to boolean true under YAML 1.1.
const triggers = wf.on || wf[true];
const job = wf.jobs.analyze;
const steps = job.steps || [];
const init = steps.find((s) => String(s.uses || "").includes("codeql-action/init"));

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

ok("analyses JavaScript/TypeScript", () => {
  assert.ok(init, "no codeql-action/init step");
  assert.match(
    String(init.with.languages),
    /javascript/,
    "this repo is JS/JSX end to end; any other language list scans nothing",
  );
});

// Dormant = neither automatic trigger present. Asserted as both-or-neither
// below, so "dormant" can never mean "half restored".
const dormant = !triggers.pull_request && !triggers.schedule;

if (dormant) {
  console.log(
    "  ⚠  DORMANT: automatic triggers are off — CodeQL is not scanning any PR.\n" +
    "      Expected while the repository is private without Code Security.\n" +
    "      Restore both triggers per the header of .github/workflows/codeql.yml.",
  );
}

ok("automatic triggers are on together or off together", () => {
  assert.strictEqual(
    Boolean(triggers.pull_request),
    Boolean(triggers.schedule),
    "one automatic trigger is present and the other is not. Scanning PRs " +
    "without a scheduled run leaves the baseline stale forever; a scheduled " +
    "run with no PR trigger never looks at a change before it merges. " +
    "Restore both or neither",
  );
});

ok(
  dormant
    ? "dormant: reachable by workflow_dispatch so it can still be run by hand"
    : "runs on pull requests to main, unfiltered",
  () => {
    if (dormant) {
      assert.ok(
        triggers.workflow_dispatch !== undefined,
        "with no automatic trigger, workflow_dispatch is the only way to run " +
        "this at all — without it the workflow is dead code, not dormant",
      );
      return;
    }
    for (const filter of ["paths", "paths-ignore"]) {
      assert.ok(
        !(filter in triggers.pull_request),
        `a ${filter} filter on the trigger silently skips the PRs it excludes; ` +
        "scope belongs in the CodeQL config, where it is at least visible",
      );
    }
  },
);

ok(dormant
  ? "dormant: no scheduled run, so nothing is baselining `main`"
  : "keeps a scheduled run to refresh the baseline", () => {
  if (dormant) return;
  assert.ok(
    triggers.schedule,
    "there is no push:[main] trigger by design (runner contention with " +
    "deploys — see the workflow header), so the schedule is the ONLY thing " +
    "that baselines the default branch",
  );
});

ok("never gets a build step it does not need", () => {
  assert.strictEqual(
    init.with["build-mode"],
    "none",
    "JS/TS needs no compilation; any other build mode risks a silent " +
    "partial index if the build fails",
  );
});

// --- the config file, and what it excludes ---------------------------------

const configPath = String(init.with["config-file"] || "").replace(/^\.\//, "");

ok("the referenced config file exists", () => {
  assert.ok(configPath, "no config-file set");
  assert.ok(existsSync(configPath), `config-file points at a missing ${configPath}`);
});

const config = yaml.load(readFileSync(configPath, "utf8"));
const ignored = (config["paths-ignore"] || []).map((p) => String(p).replace(/^\.\//, ""));

ok("does not exclude anything that ships", () => {
  // The application, the backend, and the CI scripts that run with repo
  // credentials. Excluding any of these is how the scan goes quiet.
  for (const root of ["src", "functions", "scripts", "public"]) {
    assert.ok(
      !ignored.some((p) => p === root || p.startsWith(`${root}/`) || p === `${root}/**`),
      `paths-ignore excludes "${root}" — the scan would no longer cover the ` +
      "code this exists to check",
    );
  }
});

ok("does not exclude the whole tree", () => {
  for (const p of ignored) {
    assert.ok(
      !["/", ".", "*", "**", "./"].includes(p),
      `paths-ignore entry "${p}" excludes everything`,
    );
  }
});

ok("excludes only generated output or the design-pack references", () => {
  // `docs/learner` is the one non-generated exception: the owner's prototype
  // HTML mockups. Their inline demo JS is a reference artefact — never served,
  // never bundled (hosting ships dist/, built from src/ + public/) — and
  // scanning it files permanent alerts against a document. Pinned to exactly
  // that directory so the exception cannot quietly widen to docs/ at large.
  const allowed = /^(android|dist|coverage|docs\/learner$)/;
  for (const p of ignored) {
    assert.match(
      p,
      allowed,
      `"${p}" is not obviously build output — if it is genuinely generated ` +
      "(or a non-shipping reference document like docs/learner), add it to " +
      "the allowed prefixes here so the exclusion is a decision rather than " +
      "a drift",
    );
  }
});

console.log(`\n${passed} CodeQL scope checks passed.`);
