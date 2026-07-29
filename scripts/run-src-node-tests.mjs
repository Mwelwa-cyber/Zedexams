/**
 * Runs the frontend-logic (`src/`) slice of the plain-`node` test suite in one
 * place so a coverage tool can wrap it — the `src/` twin of
 * scripts/run-functions-tests.mjs.
 *
 * Why this exists: Vitest measures `src/` coverage but only sees the
 * `*.spec.{js,jsx}` suite. The ~500 plain-`node` scripts (`*.test.js`,
 * `scripts/test-*.mjs`) exercise a large share of `src/`'s pure logic —
 * exporters, parsers, layout, schemas — yet ran uninstrumented, so modules
 * like `assessmentToDocx.js` read 0% in the Vitest report while being tested
 * to the rendered-XML level by `test:paper-golden`. This runner executes the
 * node suite minus the backend-only scripts and reports a real node-suite
 * `src/` number:
 *
 *   c8 --config .c8rc.src.json node scripts/run-src-node-tests.mjs
 *
 * (c8 exports `NODE_V8_COVERAGE`, which `npm run` child processes inherit).
 *
 * Test list source of truth: the same auto-discovery `test:all` uses
 * (`test:*` scripts whose command starts with `node`), minus scripts whose
 * referenced test files all live under `functions/` — those are the backend
 * suite, already measured by `npm run functions:coverage`, and no
 * `functions/*.test.js` imports from `src/` (functions/shared is imported BY
 * src, never the reverse), so dropping them cannot lose `src/` coverage.
 * Scripts are run via `npm run` exactly as `test:all` runs them, so command
 * arguments and semantics are identical.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pick the `test:*` scripts that can exercise `src/` code: the plain-node
 * suite (same filter as scripts/run-all-tests.mjs) minus backend-only
 * scripts — commands whose every referenced test-file path sits under
 * `functions/`. A command that references no file paths at all is kept:
 * inclusion errs wide, since running an extra backend script only costs
 * time while wrongly excluding one loses coverage.
 * @param {Record<string,string>} scripts package.json "scripts" map
 * @returns {string[]} script names in definition order
 */
export function discoverSrcTests(scripts = {}) {
  return Object.entries(scripts)
    .filter(([name, cmd]) => {
      if (!name.startsWith('test:') || name === 'test:all') return false;
      const command = String(cmd).trim();
      if (!/^node\b/.test(command)) return false;
      const files = command.match(/[\w./-]+\.(?:test\.js|mjs|js)\b/g) || [];
      const testFiles = files.filter((f) => f !== 'scripts/run-all-tests.mjs');
      if (testFiles.length === 0) return true;
      return !testFiles.every((f) => f.startsWith('functions/'));
    })
    .map(([name]) => name);
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const tests = discoverSrcTests(pkg.scripts);
  console.log(`Running ${tests.length} src-suite node test scripts...\n`);

  let passed = 0;
  for (const name of tests) {
    process.stdout.write(`▶ ${name} ... `);
    const res = spawnSync('npm', ['run', '--silent', name], {
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
    console.error(`\n✖ ${name} failed (exit ${res.status}). Stopping.`);
    process.exit(res.status || 1);
  }

  console.log(`\n✓ All ${passed} src-suite node test scripts passed.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
