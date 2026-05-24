#!/usr/bin/env node
/**
 * CBC knowledge base — seed validation.
 *
 * Walks the in-code seed (`functions/teacherTools/cbcTopics.js`) and asserts
 * the invariants Cala's matcher relies on:
 *
 *   - every entry has `id`, `grade`, `subject`, `topic`
 *   - every entry has a non-empty `specificOutcomes` array of strings
 *   - every id is globally unique
 *   - every id is well-formed (alphanumeric + hyphen, no whitespace)
 *   - every entry carries a `reviewStatus` of "needs_check" or "approved"
 *
 * Reports counts by reviewStatus, by grade, and by subject so the curriculum
 * lead can track review progress. Exits non-zero on any failure so CI
 * (npm run test:all) catches drift.
 *
 * Run: npm run cbc:validate  (from functions/), or
 *      node functions/scripts/validate-cbc-kb.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "..", "teacherTools", "cbcTopics.js");

const { TOPICS } = require(SEED_PATH);

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_STATUS = new Set(["needs_check", "approved"]);

const failures = [];
const idCounts = new Map();
const byStatus = new Map();
const byGrade = new Map();
const bySubject = new Map();

function fail(entry, msg) {
  failures.push(`[${entry?.id || "<no id>"}] ${msg}`);
}

for (const t of TOPICS) {
  if (!t || typeof t !== "object") {
    failures.push(`<non-object entry>: ${JSON.stringify(t)}`);
    continue;
  }
  if (typeof t.id !== "string" || !t.id.trim()) fail(t, "missing id");
  else if (!ID_RE.test(t.id)) fail(t, `id "${t.id}" not in slug form`);
  if (typeof t.grade !== "string" || !t.grade.trim()) fail(t, "missing grade");
  if (typeof t.subject !== "string" || !t.subject.trim()) {
    fail(t, "missing subject");
  }
  if (typeof t.topic !== "string" || !t.topic.trim()) fail(t, "missing topic");

  const outcomes = Array.isArray(t.specificOutcomes) ? t.specificOutcomes : [];
  const cleanOutcomes = outcomes.filter(
    (o) => typeof o === "string" && o.trim().length > 0
  );
  if (cleanOutcomes.length === 0) {
    fail(t, "specificOutcomes is empty — Cala has nothing to cite");
  }
  if (cleanOutcomes.length !== outcomes.length) {
    fail(t, "specificOutcomes contains non-string or empty entries");
  }

  if (!t.reviewStatus || !ALLOWED_STATUS.has(t.reviewStatus)) {
    fail(
      t,
      `reviewStatus must be one of ${[...ALLOWED_STATUS].join(", ")}; ` +
        `got ${JSON.stringify(t.reviewStatus)}`
    );
  }

  idCounts.set(t.id, (idCounts.get(t.id) || 0) + 1);
  byStatus.set(t.reviewStatus, (byStatus.get(t.reviewStatus) || 0) + 1);
  byGrade.set(t.grade, (byGrade.get(t.grade) || 0) + 1);
  bySubject.set(t.subject, (bySubject.get(t.subject) || 0) + 1);
}

for (const [id, n] of idCounts.entries()) {
  if (n > 1) failures.push(`duplicate id "${id}" appears ${n} times`);
}

const sortedEntries = (m) =>
  [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

console.log(`CBC seed: ${TOPICS.length} topics`);
console.log("By reviewStatus:");
for (const [k, v] of sortedEntries(byStatus)) {
  console.log(`  ${k.padEnd(14)} ${v}`);
}
console.log("By grade:");
for (const [k, v] of sortedEntries(byGrade)) {
  console.log(`  ${k.padEnd(14)} ${v}`);
}
console.log("By subject:");
for (const [k, v] of sortedEntries(bySubject)) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} issue(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nOK: CBC seed passes validation.");
