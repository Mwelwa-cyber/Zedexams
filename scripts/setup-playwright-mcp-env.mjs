#!/usr/bin/env node
/**
 * Environment setup for the Playwright MCP server (.mcp.json).
 *
 * Run this from a Claude Code cloud environment's setup script. It resolves the
 * checkout and the browser at runtime and writes the answers to
 * ~/.claude/settings.json — outside the repository, so a path belonging to one
 * machine can never be committed and exported to every other one. That is the
 * failure this replaces: the same two variables were once set in a tracked
 * settings file, which pointed every other checkout at files it did not have.
 *
 * Safe to run repeatedly, and safe to run on a machine that needs none of it —
 * a target that cannot be confirmed clears its variable rather than guessing.
 *
 * Usage:  node scripts/setup-playwright-mcp-env.mjs
 */

import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyToSettings, resolvePlaywrightMcpEnv } from './playwrightMcpEnvCore.mjs';

const probe = (mode) => (path) => {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
};

function main() {
  // The checkout is derived from this file's own location, never from cwd — a
  // setup script is not guaranteed to be invoked from the repo root.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  const resolution = resolvePlaywrightMcpEnv({
    repoRoot,
    isExecutableFile: probe(constants.X_OK),
    isReadableFile: probe(constants.R_OK),
    httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy,
  });

  const settingsDir = resolve(homedir(), '.claude');
  const settingsPath = resolve(settingsDir, 'settings.json');

  let existing = {};
  try {
    existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    // A missing file is the normal first run. A malformed one is not ours to
    // discard — bail rather than overwrite settings a human wrote by hand.
    if (err.code !== 'ENOENT') {
      console.error(`[playwright-mcp-env] ${settingsPath} is not valid JSON; leaving it alone.`);
      console.error(`[playwright-mcp-env] ${err.message}`);
      return;
    }
  }

  const updated = applyToSettings(existing, resolution);

  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');

  console.log(`[playwright-mcp-env] wrote ${settingsPath}`);
  for (const note of resolution.notes) console.log(`[playwright-mcp-env]   ${note}`);
}

try {
  main();
} catch (err) {
  // Best-effort convenience. Failing an environment build over an optional
  // browser tweak would cost more than the tweak is worth, so this reports
  // loudly and exits clean.
  console.error(`[playwright-mcp-env] skipped: ${err.message}`);
}
