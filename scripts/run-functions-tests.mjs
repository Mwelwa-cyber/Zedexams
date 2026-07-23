/**
 * Runs the backend (`functions/`) plain-`node` test suite in one place so a
 * coverage tool can wrap it.
 *
 * Why this exists: the whole node suite (`npm run test:all`) mixes the
 * frontend `src/` tests and the backend `functions/` tests in one run, and it
 * is not instrumented for coverage. Vitest measures `src/` coverage but is
 * configured to exclude `functions/` (see `vitest.config.js`). That left the
 * Cloud Functions layer with NO coverage number at all — the single biggest
 * blind spot in the suite. This runner executes exactly the backend tests the
 * curated npm suite runs and reports a real `functions/` number:
 *
 *   c8 node scripts/run-functions-tests.mjs
 *
 * aggregates V8 coverage across all of them (c8 exports `NODE_V8_COVERAGE`,
 * which child processes inherit).
 *
 * Test list source of truth: the `test:*` npm scripts in package.json whose
 * command is a `node` invocation of a `functions/...test.js` file — the same
 * curated set `npm run test:all` runs (via scripts/run-all-tests.mjs). We
 * deliberately do NOT glob the filesystem: orphaned `*.test.js` files that are
 * wired into no npm script are excluded here just as they are from `test:all`.
 *
 * The backend tests are written to be root-install-safe (they exercise pure
 * helpers / dependency-injected logic and never `require` firebase-admin at
 * load time), so this runs under a plain `npm ci` with no functions/ install
 * and no emulator — same as the existing `Tests` CI job.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Extract the backend test files run by the curated npm suite. Scans every
 * `test:*` script command for `node functions/….test.js` tokens.
 * @param {Record<string,string>} scripts package.json "scripts" map
 * @returns {string[]} unique repo-relative test paths, in definition order
 */
export function discoverFunctionTests(scripts = {}) {
  const seen = new Set();
  const files = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!name.startsWith('test:') || name === 'test:all') continue;
    // Only plain `node …` commands belong to this coverage suite. An
    // emulator-wrapped script (e.g. `npx firebase-tools emulators:exec …
    // "node functions/x.test.js"`) also mentions a functions test path, but it
    // MUST NOT be run under plain `node` here — it needs the emulator/JVM and
    // guard-exits without it. Same `node`-prefix filter run-all-tests.mjs uses
    // to keep the emulator suites out of test:all.
    if (!/^node\b/.test(String(cmd).trim())) continue;
    const matches = String(cmd).match(/functions\/[^\s&|'"]+\.test\.js/g) || [];
    for (const m of matches) {
      if (seen.has(m)) continue;
      seen.add(m);
      files.push(m);
    }
  }
  return files;
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const tests = discoverFunctionTests(pkg.scripts);
  console.log(`Running ${tests.length} functions/ node test files...\n`);

  let passed = 0;
  for (const rel of tests) {
    process.stdout.write(`▶ ${rel} ... `);
    const res = spawnSync('node', [join(ROOT, rel)], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (res.status === 0) {
      console.log('ok');
      passed += 1;
      continue;
    }
    console.log('FAILED');
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    console.error(`\n✖ ${rel} failed (exit ${res.status}). Stopping.`);
    process.exit(res.status || 1);
  }

  console.log(`\n✓ All ${passed} functions/ node test files passed.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
