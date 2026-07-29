/**
 * Decides which PLAYWRIGHT_MCP_* variables a machine should export, given what
 * actually exists on it. Pure: every filesystem question arrives as an answer.
 *
 * The rule that matters, and the reason this is a module rather than three
 * lines of shell: a variable is set ONLY when its target has been confirmed to
 * exist. `@playwright/mcp` opens its config eagerly and lets the ENOENT escape,
 * so pointing the variable at a missing file does not degrade the server, it
 * kills it at startup and every browser tool disappears with it. Exporting
 * nothing is a working default; exporting a hopeful path is not.
 *
 * `unset` is the other half of that rule. A machine that used to have a browser
 * — or a checkout that moved — keeps the stale variable in its settings file
 * and crashes on the next launch, so a run that cannot confirm a target says so
 * explicitly instead of leaving the previous answer standing.
 */

/** Absolute paths where a preinstalled Chromium is known to live, in priority order. */
export const CHROMIUM_CANDIDATES = ['/opt/pw-browsers/chromium'];

export const EXECUTABLE_PATH_VAR = 'PLAYWRIGHT_MCP_EXECUTABLE_PATH';
export const CONFIG_VAR = 'PLAYWRIGHT_MCP_CONFIG';

/** The launch-args config lives at the repo root under this name. */
export const CONFIG_BASENAME = '.playwright-mcp.config.json';

/**
 * @param {object} input
 * @param {string} input.repoRoot           Absolute path to the checkout.
 * @param {(p: string) => boolean} input.isExecutableFile  Probe: exists AND executable.
 * @param {(p: string) => boolean} input.isReadableFile    Probe: exists AND readable.
 * @param {string|undefined} input.httpsProxy  HTTPS_PROXY as seen by the machine.
 * @param {string[]} input.candidates       Override for tests.
 * @returns {{set: Record<string,string>, unset: string[], notes: string[]}}
 */
export function resolvePlaywrightMcpEnv({
  repoRoot,
  isExecutableFile,
  isReadableFile,
  httpsProxy,
  candidates = CHROMIUM_CANDIDATES,
}) {
  if (!repoRoot) throw new Error('resolvePlaywrightMcpEnv: repoRoot is required');

  const set = {};
  const unset = [];
  const notes = [];

  const browser = candidates.find((p) => isExecutableFile(p));
  if (browser) {
    set[EXECUTABLE_PATH_VAR] = browser;
    notes.push(`browser: ${browser}`);
  } else {
    unset.push(EXECUTABLE_PATH_VAR);
    notes.push('browser: none preinstalled — leaving Playwright to resolve its own');
  }

  // The TLS cap in the config is a workaround for an intercepting proxy that
  // resets on Chromium's TLS 1.3 handshake. A machine reaching the internet
  // directly negotiates 1.3 fine and must not be capped, so proxy absence is
  // itself a reason not to apply it — this is what keeps the file opt-in
  // rather than a project-wide default.
  const configPath = joinPath(repoRoot, CONFIG_BASENAME);
  const hasProxy = Boolean(httpsProxy && httpsProxy.trim());
  if (!hasProxy) {
    unset.push(CONFIG_VAR);
    notes.push('proxy: none — not applying the TLS cap');
  } else if (!isReadableFile(configPath)) {
    unset.push(CONFIG_VAR);
    notes.push(`config: ${configPath} not found — not applying the TLS cap`);
  } else {
    set[CONFIG_VAR] = configPath;
    notes.push(`config: ${configPath}`);
  }

  return { set, unset, notes };
}

/** POSIX join, deliberately tiny — this module stays dependency-free so it can be unit-tested as data. */
export function joinPath(dir, base) {
  return `${dir.replace(/\/+$/, '')}/${base}`;
}

/**
 * Folds a resolution into an existing settings object without disturbing
 * anything else in it. Returns a NEW object; never mutates the input, because
 * the caller re-serialises a file a human may also be editing.
 */
export function applyToSettings(settings, { set, unset }) {
  const next = { ...(settings || {}) };
  const env = { ...(next.env || {}) };

  for (const [key, value] of Object.entries(set)) env[key] = value;
  for (const key of unset) delete env[key];

  if (Object.keys(env).length > 0) next.env = env;
  else delete next.env;

  return next;
}
