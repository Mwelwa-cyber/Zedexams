// Guards <FullScreenLoader /> against the defect that made its wordmark
// invisible: the canvas moved to a theme token while the ink on it stayed a
// literal picked for the light palette. Under Midnight that was #1A1F2E on
// #1A222E — 1.03:1 — so "Zed" vanished and a returning dark-theme visitor saw
// a lone orange "Exams" for the whole auth-resolution window.
//
// This is a SOURCE scan rather than a render test on purpose. The contrast
// gate's fixture (scripts/test-route-contrast.mjs) measures whether the token
// PAIR is readable, but it carries its own copy of the markup — so reverting
// the component to a literal would leave that fixture green. Only reading the
// component catches that. It is also the established idiom here: test:monochrome
// scans the paper renderers the same way, and for the same reason — an
// undeclared colour fails, so adding one means saying what it is for.
//
// Plain-node test, auto-discovered by scripts/run-all-tests.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'src/shared/components/FullScreenLoader.jsx';
const src = readFileSync(join(root, FILE), 'utf8');

// Scan the CODE only — the header comment quotes the very hexes these rules
// are about, and a guard that trips over its own explanation is useless.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

let failed = 0;
function assert(cond, message) {
  if (!cond) {
    console.error(`FAIL: ${message}`);
    failed += 1;
  }
}

// Literals that are deliberately fixed. These are brand marks, not surface
// colours: they read on both the light and the dark canvas, and tokenising
// them would make the logo change colour with the theme. Adding an entry here
// is a decision — state what the colour is for.
const ALLOWED_LITERALS = {
  '#C5613F': 'brand orange — the "Exams" half of the wordmark, the orange arc/dot, and the progress gradient',
  '#2563EB': 'brand blue — the blue arc/dot and the progress gradient',
};

// 1. The canvas follows the theme. If this stops being a token the rest of
//    the file's reasoning collapses, because there is no surface to follow.
assert(
  /background:\s*'var\(--zt-surface\)'/.test(code),
  `${FILE}: the loader canvas must stay var(--zt-surface) — the ink tokens below are chosen to sit on it`,
);

// 2. The wordmark ink follows that canvas. This is the exact regression.
assert(
  /color:\s*'var\(--zt-text[,)]/.test(code),
  `${FILE}: the wordmark ink must resolve from var(--zt-text, …), not a literal — a hard-coded ink beside a themed canvas is only correct for the theme it was picked in`,
);

// 3. The ring track and the progress-bar track sit on the same canvas.
const trackTokens = code.match(/var\(--zt-line[,)]/g) || [];
assert(
  trackTokens.length >= 2,
  `${FILE}: the ring track and progress-bar track must both resolve from var(--zt-line, …) — found ${trackTokens.length} of 2`,
);

// 4. Every remaining literal hex is either a var() fallback or declared above.
//    A fallback is fine: it only renders where --zt-* is absent, which is
//    exactly the pre-token behaviour.
const fallbacks = new Set();
for (const m of code.matchAll(/var\(\s*--[\w-]+\s*,\s*(#[0-9A-Fa-f]{3,8})\s*\)/g)) {
  fallbacks.add(m[1].toUpperCase());
}
const undeclared = new Map();
for (const m of code.matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
  const hex = m[0].toUpperCase();
  if (ALLOWED_LITERALS[hex] || fallbacks.has(hex)) continue;
  // Skip the one inside a var() fallback we already collected, and count the rest.
  undeclared.set(hex, (undeclared.get(hex) || 0) + 1);
}
for (const [hex, count] of undeclared) {
  assert(
    false,
    `${FILE}: undeclared literal colour ${hex} (${count}×). Either make it a theme token `
    + `(var(--zt-…, ${hex})) so it follows the canvas, or add it to ALLOWED_LITERALS in `
    + `scripts/test-loader-theme-tokens.mjs with the reason it must stay fixed.`,
  );
}

if (failed) process.exit(1);
console.log(
  `ok: FullScreenLoader colours follow the themed canvas `
  + `(${Object.keys(ALLOWED_LITERALS).length} declared brand literals, ${fallbacks.size} token fallbacks)`,
);
