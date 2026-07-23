/**
 * Guards the test discovery in scripts/run-functions-tests.mjs — the runner
 * behind `npm run functions:coverage` (the backend coverage report).
 * Run: npm run test:run-functions-tests  (also auto-discovered by test:all)
 *
 * Pure-Node, no network. Imports only the discovery helper (never runs the
 * backend suite), so it is cheap and safe to include in `test:all`.
 */
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverFunctionTests } from './run-functions-tests.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const found = discoverFunctionTests(scripts);

// Discovery is non-empty and every entry is a backend test file that exists.
assert.ok(found.length > 0, 'expected to discover at least one functions/ test');
for (const rel of found) {
  assert.match(rel, /^functions\/.+\.test\.js$/, `${rel} should be a functions/ test path`);
  assert.ok(existsSync(join(ROOT, rel)), `${rel} should exist on disk`);
}

// Representative backend tests are included.
for (const rel of [
  'functions/cors.test.js',
  'functions/subscriptionActivation.test.js',
  'functions/agents/runners/vex.test.js',
]) {
  assert.ok(found.includes(rel), `expected ${rel} to be discovered`);
}

// Only the CURATED suite is run: an orphaned *.test.js wired into no npm
// script must NOT be picked up (mirrors how test:all ignores it). This one
// exists on disk but is intentionally not in any test:* script.
const orphan = 'functions/teacherTools/assessmentPromptV3.test.js';
if (existsSync(join(ROOT, orphan))) {
  assert.ok(
    !found.includes(orphan),
    `${orphan} is wired into no npm script and must not be discovered`,
  );
}

// No frontend (src/) test leaks in — this runner is backend-only.
for (const rel of found) {
  assert.ok(!rel.startsWith('src/'), `${rel} should not be a src/ test`);
}

// An emulator-wrapped test:* script mentions a functions/…test.js path but is
// NOT a plain `node` command, so it can't run under this coverage runner (it
// needs the emulator/JVM and guard-exits without it). It must be excluded from
// discovery, mirroring how test:all skips the emulator suites.
const emulatorWrapped = Object.entries(scripts).find(([name, cmd]) =>
  name.startsWith('test:') &&
  !/^node\b/.test(String(cmd).trim()) &&
  /functions\/[^\s&|'"]+\.test\.js/.test(String(cmd)));
if (emulatorWrapped) {
  const [, cmd] = emulatorWrapped;
  const ref = String(cmd).match(/functions\/[^\s&|'"]+\.test\.js/)[0];
  assert.ok(
    !found.includes(ref),
    `${ref} is emulator-wrapped and must not be discovered by the coverage runner`,
  );
}

// Discovery == every functions/…test.js referenced by a curated plain-`node`
// test:* script (emulator-wrapped commands excluded, as above).
const expected = new Set();
for (const [name, cmd] of Object.entries(scripts)) {
  if (!name.startsWith('test:') || name === 'test:all') continue;
  if (!/^node\b/.test(String(cmd).trim())) continue;
  for (const m of String(cmd).match(/functions\/[^\s&|'"]+\.test\.js/g) || []) {
    expected.add(m);
  }
}
assert.deepStrictEqual(
  new Set(found),
  expected,
  'discovery should cover every functions test referenced by a curated script',
);

console.log(`test:run-functions-tests OK — ${found.length} backend test files discovered`);
