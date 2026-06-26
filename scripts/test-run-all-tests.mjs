/**
 * Guards the auto-discovery in scripts/run-all-tests.mjs — the engine behind
 * `test:all`. Run: npm run test:run-all-tests  (also auto-discovered by test:all)
 *
 * Pure-Node, no network. Imports only the discovery helper (never runs the full
 * suite), so it is safe for the runner to include this script in its own list.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverTests } from './run-all-tests.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const found = discoverTests(scripts);

// Representative node-based tests are included.
for (const name of ['test:sanitize', 'test:schema', 'test:importer']) {
  assert.ok(found.includes(name), `expected ${name} to be discovered`);
}

// The non-node suites (Vitest + emulators) and the aggregate itself are excluded.
for (const name of [
  'test:all',
  'test:unit',
  'test:unit:watch',
  'test:coverage',
  'test:rules-emulator',
  'test:storage-rules-emulator',
]) {
  assert.ok(!found.includes(name), `expected ${name} to be excluded`);
}

// Everything discovered exists and really is a `node` command.
for (const name of found) {
  assert.ok(scripts[name], `${name} should exist in scripts`);
  assert.match(scripts[name].trim(), /^node\b/, `${name} should be a node command`);
}

// No node-based test:* is left behind — discovery == the full node-test set.
const expected = Object.entries(scripts)
  .filter(([n, c]) => n.startsWith('test:') && n !== 'test:all' && /^node\b/.test(c.trim()))
  .map(([n]) => n);
assert.deepStrictEqual(new Set(found), new Set(expected), 'discovery should cover every node test');

// The runner dogfoods itself.
assert.ok(found.includes('test:run-all-tests'), 'the meta-test should be self-discovered');

console.log(`test:run-all-tests OK — ${found.length} node test scripts discovered`);
