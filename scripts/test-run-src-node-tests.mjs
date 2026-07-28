/**
 * Guards the test discovery in scripts/run-src-node-tests.mjs — the runner
 * behind `npm run src:coverage` (the node-suite src/ coverage report).
 * Run: npm run test:run-src-node-tests  (also auto-discovered by test:all)
 *
 * Pure-Node, no network. Imports only the discovery helper (never runs the
 * suite), so it is cheap and safe to include in `test:all`.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverSrcTests } from './run-src-node-tests.mjs';
import { discoverTests } from './run-all-tests.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const found = discoverSrcTests(scripts);
const allNode = discoverTests(scripts);

// Discovery is non-empty and a strict subset of the full node suite: every
// src-suite script is one test:all would run (same `node`-prefix filter), so
// the coverage runner can never execute something the curated suite doesn't.
assert.ok(found.length > 0, 'expected to discover at least one src-suite test script');
const allSet = new Set(allNode);
for (const name of found) {
  assert.ok(allSet.has(name), `${name} should also be discovered by test:all`);
}

// Representative src-logic tests are included — the exporters and schema
// suites are exactly the coverage this runner exists to measure.
for (const name of ['test:paper-golden', 'test:schema', 'test:sanitize']) {
  assert.ok(found.includes(name), `expected ${name} to be discovered`);
}

// Backend-only scripts are excluded: a command whose every test-file path is
// under functions/ belongs to `npm run functions:coverage`, not here. No
// functions/*.test.js imports from src/, so exclusion loses no src coverage.
for (const [name, cmd] of Object.entries(scripts)) {
  if (!found.includes(name)) continue;
  const files = String(cmd).match(/[\w./-]+\.(?:test\.js|mjs|js)\b/g) || [];
  const testFiles = files.filter((f) => f !== 'scripts/run-all-tests.mjs');
  if (testFiles.length > 0) {
    assert.ok(
      !testFiles.every((f) => f.startsWith('functions/')),
      `${name} references only functions/ files and must not be in the src suite`,
    );
  }
}
const backendOnly = Object.entries(scripts).find(([name, cmd]) => {
  if (!name.startsWith('test:') || !/^node\b/.test(String(cmd).trim())) return false;
  const files = String(cmd).match(/[\w./-]+\.(?:test\.js|mjs|js)\b/g) || [];
  return files.length > 0 && files.every((f) => f.startsWith('functions/'));
});
assert.ok(backendOnly, 'expected at least one backend-only script to exist as a fixture');
assert.ok(
  !found.includes(backendOnly[0]),
  `${backendOnly[0]} is backend-only and must be excluded from the src suite`,
);
// A mixed command (functions + src files, like test:scanned-import) must be
// KEPT — its src halves are exactly the coverage this runner measures.
const mixed = Object.entries(scripts).find(([name, cmd]) => {
  if (!name.startsWith('test:') || !/^node\b/.test(String(cmd).trim())) return false;
  const files = String(cmd).match(/[\w./-]+\.(?:test\.js|mjs|js)\b/g) || [];
  return files.some((f) => f.startsWith('functions/')) && files.some((f) => f.startsWith('src/'));
});
if (mixed) {
  assert.ok(found.includes(mixed[0]), `${mixed[0]} mixes src + functions files and must be kept`);
}

// Emulator/Vitest scripts are excluded by the `node`-prefix filter, exactly
// as test:all excludes them.
for (const name of found) {
  assert.ok(
    /^node\b/.test(String(scripts[name]).trim()),
    `${name} must be a plain node command`,
  );
}

console.log(`ok — ${found.length} src-suite scripts discovered (of ${allNode.length} node scripts)`);
