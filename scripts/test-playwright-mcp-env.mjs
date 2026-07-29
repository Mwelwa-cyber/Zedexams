#!/usr/bin/env node
/**
 * Tests for the Playwright MCP environment resolver.
 *
 * The load-bearing assertion is "never points at something absent": a missing
 * target must clear its variable, because @playwright/mcp lets the ENOENT from
 * an unreadable config escape and exits during startup. That regression already
 * shipped once, from a tracked settings file that exported one machine's paths
 * to every checkout, so it is pinned from both directions here — the variable
 * is absent from `set`, AND present in `unset` so a stale value is removed
 * rather than left standing.
 */

import assert from 'node:assert/strict';

import {
  CONFIG_BASENAME,
  CONFIG_VAR,
  EXECUTABLE_PATH_VAR,
  applyToSettings,
  joinPath,
  resolvePlaywrightMcpEnv,
} from './playwrightMcpEnvCore.mjs';

const ROOT = '/home/user/Zedexams';
const CONFIG = `${ROOT}/${CONFIG_BASENAME}`;
const BROWSER = '/opt/pw-browsers/chromium';
const PROXY = 'http://127.0.0.1:41499';

const never = () => false;
const always = () => true;
const only = (...paths) => (p) => paths.includes(p);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nresolvePlaywrightMcpEnv\n');

test('a container with a browser and a proxy gets both variables', () => {
  const { set, unset } = resolvePlaywrightMcpEnv({
    repoRoot: ROOT,
    isExecutableFile: only(BROWSER),
    isReadableFile: only(CONFIG),
    httpsProxy: PROXY,
  });
  assert.equal(set[EXECUTABLE_PATH_VAR], BROWSER);
  assert.equal(set[CONFIG_VAR], CONFIG);
  assert.deepEqual(unset, []);
});

test('a laptop with no preinstalled browser and no proxy gets neither', () => {
  const { set, unset } = resolvePlaywrightMcpEnv({
    repoRoot: 'C:/Users/dev/zedexams.com',
    isExecutableFile: never,
    isReadableFile: always,
    httpsProxy: undefined,
  });
  assert.deepEqual(set, {}, 'a laptop must inherit stock Playwright resolution');
  assert.ok(unset.includes(EXECUTABLE_PATH_VAR));
  assert.ok(unset.includes(CONFIG_VAR));
});

test('the config is NOT applied without a proxy, even when the file is right there', () => {
  // The TLS 1.2 cap exists for an intercepting proxy. Applying it to a direct
  // connection would silently downgrade a handshake that works.
  const { set, unset } = resolvePlaywrightMcpEnv({
    repoRoot: ROOT,
    isExecutableFile: only(BROWSER),
    isReadableFile: always,
    httpsProxy: '',
  });
  assert.equal(set[EXECUTABLE_PATH_VAR], BROWSER);
  assert.equal(set[CONFIG_VAR], undefined);
  assert.ok(unset.includes(CONFIG_VAR));
});

test('a missing config file clears the variable rather than pointing at it', () => {
  // The exact shipped regression: a non-empty path to a file that is not there
  // kills the MCP server at startup.
  const { set, unset } = resolvePlaywrightMcpEnv({
    repoRoot: '/some/other/checkout',
    isExecutableFile: only(BROWSER),
    isReadableFile: never,
    httpsProxy: PROXY,
  });
  assert.equal(set[CONFIG_VAR], undefined, 'must not export a path to a missing file');
  assert.ok(unset.includes(CONFIG_VAR), 'must clear any stale value');
});

test('a missing browser clears the variable rather than pointing at it', () => {
  const { set, unset } = resolvePlaywrightMcpEnv({
    repoRoot: ROOT,
    isExecutableFile: never,
    isReadableFile: only(CONFIG),
    httpsProxy: PROXY,
  });
  assert.equal(set[EXECUTABLE_PATH_VAR], undefined);
  assert.ok(unset.includes(EXECUTABLE_PATH_VAR));
});

test('a present-but-not-executable browser does not count as present', () => {
  const { set, unset } = resolvePlaywrightMcpEnv({
    repoRoot: ROOT,
    isExecutableFile: never, // readable, but not +x
    isReadableFile: always,
    httpsProxy: PROXY,
  });
  assert.equal(set[EXECUTABLE_PATH_VAR], undefined);
  assert.ok(unset.includes(EXECUTABLE_PATH_VAR));
});

test('the config path is derived from the checkout, not hard-coded', () => {
  const other = '/srv/build/zedexams';
  const { set } = resolvePlaywrightMcpEnv({
    repoRoot: other,
    isExecutableFile: only(BROWSER),
    isReadableFile: only(`${other}/${CONFIG_BASENAME}`),
    httpsProxy: PROXY,
  });
  assert.equal(set[CONFIG_VAR], `${other}/${CONFIG_BASENAME}`);
});

test('a trailing slash on the checkout does not double the separator', () => {
  assert.equal(joinPath('/a/b/', 'c.json'), '/a/b/c.json');
  assert.equal(joinPath('/a/b', 'c.json'), '/a/b/c.json');
});

test('a missing repoRoot is refused rather than resolved against nothing', () => {
  assert.throws(
    () => resolvePlaywrightMcpEnv({ isExecutableFile: never, isReadableFile: never }),
    /repoRoot is required/,
  );
});

console.log('\napplyToSettings\n');

test('unrelated settings survive untouched', () => {
  const before = { permissions: { allow: ['Bash(ls)'] }, env: { EDITOR: 'vim' } };
  const after = applyToSettings(before, { set: { [EXECUTABLE_PATH_VAR]: BROWSER }, unset: [] });
  assert.deepEqual(after.permissions, { allow: ['Bash(ls)'] });
  assert.equal(after.env.EDITOR, 'vim', 'an unrelated env var must not be dropped');
  assert.equal(after.env[EXECUTABLE_PATH_VAR], BROWSER);
});

test('the input object is not mutated', () => {
  const before = { env: { EDITOR: 'vim' } };
  applyToSettings(before, { set: { [CONFIG_VAR]: CONFIG }, unset: [] });
  assert.deepEqual(before, { env: { EDITOR: 'vim' } });
});

test('a stale value is removed on a machine that no longer qualifies', () => {
  const before = { env: { [CONFIG_VAR]: '/gone/.playwright-mcp.config.json' } };
  const after = applyToSettings(before, { set: {}, unset: [CONFIG_VAR] });
  assert.equal(after.env, undefined, 'an emptied env block is dropped, not left as {}');
});

test('missing settings and a no-op resolution produce an empty object, not a crash', () => {
  assert.deepEqual(applyToSettings(undefined, { set: {}, unset: [CONFIG_VAR] }), {});
});

console.log(`\n─── ${passed} tests · ${passed} passed · 0 failed ───\n`);
