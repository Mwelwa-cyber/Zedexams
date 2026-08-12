#!/usr/bin/env node
/**
 * Security Review is opt-in, and opt-in triggers fail silently.
 *
 * Two failure modes this guards, both of which look exactly like "no findings":
 *
 *   1. COST REGRESSION — someone restores `synchronize` (or `opened`) and every
 *      push to every PR starts an agentic scan again. That is the exact spend
 *      that drained a $5 balance in a day.
 *   2. DEAD TRIGGER — the label named in the workflow's `if:` drifts from the
 *      label named in the docs (or the docs' label is never created), so the
 *      workflow can never fire. A security scanner that never runs reports
 *      nothing, which reads identically to a clean repo.
 *
 * Text-level checks over the workflow + docs, in the style of test:rules-text.
 */

import assert from "node:assert";
import {readFileSync} from "node:fs";
import yaml from "js-yaml";

const WORKFLOW_PATH = ".github/workflows/security-review.yml";
const raw = readFileSync(WORKFLOW_PATH, "utf8");
const wf = yaml.load(raw);

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// `on` is parsed by js-yaml 3/4 as the boolean true (YAML 1.1 keyword), so
// reach for whichever key actually landed rather than assuming.
const triggers = wf.on || wf[true];

ok("triggers on pull_request labeled only", () => {
  const types = triggers.pull_request.types;
  assert.deepStrictEqual(
    types,
    ["labeled"],
    "an automatic trigger here bills an agentic scan per PR (or per push)",
  );
});

ok("never re-adds synchronize or opened", () => {
  const types = triggers.pull_request.types;
  for (const banned of ["synchronize", "opened", "reopened", "ready_for_review"]) {
    assert.ok(
      !types.includes(banned),
      `${banned} makes the scan automatic again — see the cost note in the workflow`,
    );
  }
});

ok("keeps workflow_dispatch as the manual escape hatch", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch"),
    "without dispatch there is no way to re-run a scan without touching labels",
  );
});

// The label the job actually gates on.
const gate = String(wf.jobs.security.if || "");
const labelMatch = gate.match(/github\.event\.label\.name\s*==\s*'([^']+)'/);

ok("the job gates on a specific label name", () => {
  assert.ok(
    labelMatch,
    "a `labeled` run fires for EVERY label; without a name check any unrelated " +
    "label would start an agentic scan",
  );
});

const LABEL = labelMatch[1];

ok("workflow_dispatch still satisfies the gate", () => {
  assert.ok(
    /github\.event_name\s*==\s*'workflow_dispatch'/.test(gate),
    "a dispatch run carries no label payload, so it needs its own branch or " +
    "the manual escape hatch silently never runs",
  );
});

ok(`the label (\`${LABEL}\`) is documented where a human will look`, () => {
  const claude = readFileSync("CLAUDE.md", "utf8");
  assert.ok(
    claude.includes(LABEL),
    `CLAUDE.md does not mention \`${LABEL}\`. The trigger and the instructions ` +
    "have to name the same label — a mismatch is a scanner that never runs.",
  );
});

ok("the workflow explains that opt-in means it usually will not run", () => {
  // Not decoration: the whole risk of this design is someone later reading a
  // quiet security channel as a clean one.
  assert.ok(
    /opt-in/i.test(raw) && /required CI/i.test(raw),
    "the trade has to be written down next to the trigger that makes it",
  );
});

console.log(`\n${passed} security-review trigger checks passed.`);
