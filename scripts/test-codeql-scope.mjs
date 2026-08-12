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
 *
 * Same shape as the Ledger no-op (test:release-notes) and the opt-in security
 * trigger (test:security-review-trigger): the failure is indistinguishable
 * from a clean result.
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

ok("runs on pull requests to main, unfiltered", () => {
  assert.ok(triggers.pull_request, "no pull_request trigger");
  for (const filter of ["paths", "paths-ignore"]) {
    assert.ok(
      !(filter in triggers.pull_request),
      `a ${filter} filter on the trigger silently skips the PRs it excludes; ` +
      "scope belongs in the CodeQL config, where it is at least visible",
    );
  }
});

ok("keeps a scheduled run to refresh the baseline", () => {
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

ok("excludes only generated output", () => {
  const generated = /^(android|dist|coverage)/;
  for (const p of ignored) {
    assert.match(
      p,
      generated,
      `"${p}" is not obviously build output — if it is genuinely generated, ` +
      "add it to the allowed prefixes here so the exclusion is a decision " +
      "rather than a drift",
    );
  }
});

console.log(`\n${passed} CodeQL scope checks passed.`);
