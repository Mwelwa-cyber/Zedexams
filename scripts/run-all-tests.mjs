/**
 * Runs the plain-`node` test suite — every `*.test.js` / `test-*.mjs` script.
 *
 * Auto-discovers every `test:*` npm script whose command is a `node`
 * invocation and runs them sequentially, aborting on the first failure (the
 * same fail-fast semantics as the old `&&`-chained `test:all`).
 *
 * Why auto-discovery: `test:all` used to be a single ~8 KB line that every
 * test-adding PR appended to, so any two such PRs collided on that one line in
 * package.json and one always had to be re-merged. Now a PR just adds its
 * `test:<name>` script; it's picked up here automatically and never touches a
 * shared line — so two PRs adding different tests no longer conflict.
 *
 * The Vitest scripts (`test:unit*`, `test:coverage`) and the Firebase-emulator
 * suites (`test:*-emulator`) are intentionally excluded: they are not `node`
 * commands, so the `node`-prefix filter skips them with no hand-maintained
 * denylist to drift out of date.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pick the `test:*` scripts that belong to the plain-node suite: anything whose
 * command starts with `node` (excluding the `test:all` aggregate itself).
 * @param {Record<string,string>} scripts package.json "scripts" map
 * @returns {string[]} script names in definition order
 */
export function discoverTests(scripts = {}) {
  return Object.entries(scripts)
    .filter(([name, cmd]) =>
      name.startsWith('test:') &&
      name !== 'test:all' &&
      /^node\b/.test(String(cmd).trim()))
    .map(([name]) => name);
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const tests = discoverTests(pkg.scripts);
  console.log(`Running ${tests.length} node test scripts...\n`);

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

  console.log(`\n✓ All ${passed} node test scripts passed.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
