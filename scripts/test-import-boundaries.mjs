// Guards the src/ import boundaries introduced with the Phase 1 scaffold
// (docs/architecture.md §3, §12, §14.7). Two parts, because one mechanism
// cannot cover the whole contract:
//
//  1. The ESLint rules in eslint.config.js are run against the REAL config on
//     synthetic files, and asserted to fire on a violation and stay quiet on
//     the legitimate import next to it. A boundary rule is only worth having if
//     it still matches; `no-restricted-imports` patterns are matched against
//     the import specifier by a glob library, so a pattern that quietly stops
//     matching looks exactly like a codebase with no violations.
//
//  2. The one case those patterns structurally cannot see is resolved here.
//     `src/features/A/pages/X.jsx` reaching into `src/features/B` is written
//     `../../B/lib/y`, which names no layer — as a string it is identical in
//     shape to its own `../lib/y`. So this part resolves every relative
//     specifier under src/features/ to a real path and fails on any that lands
//     inside a DIFFERENT feature, anywhere but that feature's index.
//
// Deliberately not covered here: the legacy tree (src/components, src/hooks,
// src/utils) reaching into feature internals. Those are Phase 4 migration debt,
// and ESLint reports each as a warning at the call site — recording them in a
// second place would only add something to update when one clears.
//
// Plain-node test, auto-discovered by scripts/run-all-tests.mjs via the
// test:import-boundaries script.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ESLint } from 'eslint';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOUNDARY_RULE = 'no-restricted-imports';

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

// ---------------------------------------------------------------------------
// Part 1 — the ESLint rules fire, against the real eslint.config.js.
// ---------------------------------------------------------------------------

/** @type {{file: string, spec: string, severity: 0|1|2, why: string}[]} */
const lintCases = [
  // The new layers refuse everything above them.
  { file: 'src/shared/utils/probe.js', spec: '../../features/notes/lib/firestore', severity: 2,
    why: 'shared must not import a feature' },
  { file: 'src/shared/hooks/probe.js', spec: '../../engines/export-engine', severity: 2,
    why: 'shared must not import an engine' },
  { file: 'src/shared/utils/probe.js', spec: '../../curriculum/catalog', severity: 2,
    why: 'shared must not import curriculum' },
  { file: 'src/shared/utils/probe.js', spec: 'firebase/firestore', severity: 2,
    why: 'shared must not touch the Firebase SDK' },
  { file: 'src/engines/export-engine/probe.js', spec: '../../app/routes', severity: 2,
    why: 'an engine must not import the app shell' },
  { file: 'src/engines/export-engine/probe.js', spec: '../../features/notes/lib/firestore', severity: 2,
    why: 'an engine must not import a feature' },
  { file: 'src/curriculum/resolvers/probe.js', spec: '../../engines/assessment-engine', severity: 2,
    why: 'curriculum must not import an engine' },
  { file: 'src/curriculum/resolvers/probe.js', spec: '../../features/notes', severity: 2,
    why: 'curriculum must not import a feature' },

  // Feature front doors.
  { file: 'src/features/notes/pages/Probe.jsx', spec: '../../../features/learnerHome/lib/x', severity: 2,
    why: 'a feature must not reach past another feature index' },
  { file: 'src/features/notes/pages/Probe.jsx', spec: '../../../app/guards', severity: 2,
    why: 'a feature must not import the app shell' },
  { file: 'src/app/routes/probe.js', spec: '../../features/notes/pages/NotesPage.jsx', severity: 2,
    why: 'the app shell must not reach past a feature index' },
  { file: 'src/hooks/probe.js', spec: '../features/notes/lib/firestore', severity: 1,
    why: 'legacy tree reaching into a feature warns (Phase 4 debt), it does not fail the build' },

  // The imports each layer is supposed to be able to make.
  { file: 'src/shared/utils/probe.js', spec: '../../config/canonicalEducation.js', severity: 0,
    why: 'shared may read config' },
  { file: 'src/curriculum/catalog/probe.js', spec: '../../config/educationLevels.js', severity: 0,
    why: 'the catalog exists to re-export config' },
  { file: 'src/curriculum/resolvers/probe.js', spec: '../catalog/index.js', severity: 0,
    why: 'curriculum resolvers read the catalog' },
  { file: 'src/engines/export-engine/probe.js', spec: '../../curriculum/catalog', severity: 0,
    why: 'an engine may read curriculum' },
  { file: 'src/features/notes/pages/Probe.jsx', spec: '../lib/firestore', severity: 0,
    why: 'a feature reads its own internals' },
  { file: 'src/features/notes/pages/Probe.jsx', spec: '../../visualStudio/index.js', severity: 0,
    why: 'a feature index is the front door, and it stays open' },
  { file: 'src/app/routes/probe.js', spec: '../../features/notes/index.js', severity: 0,
    why: 'the app shell mounts features through their index' },
];

const eslint = new ESLint({ cwd: root });

for (const { file, spec, severity, why } of lintCases) {
  const code = `import probeValue from '${spec}'\nexport default probeValue\n`;
  const [result] = await eslint.lintText(code, { filePath: join(root, file) });
  const hits = result.messages.filter((m) => m.ruleId === BOUNDARY_RULE);

  if (severity === 0) {
    if (hits.length) fail(`${file} importing '${spec}' should be allowed (${why}) — got: ${hits[0].message}`);
    continue;
  }
  if (!hits.length) {
    fail(`${file} importing '${spec}' should be reported (${why}) — the boundary rule did not match`);
    continue;
  }
  if (hits[0].severity !== severity) {
    const word = (s) => (s === 2 ? 'error' : 'warning');
    fail(`${file} importing '${spec}' should be a ${word(severity)} (${why}) — got a ${word(hits[0].severity)}`);
  }
}

// ---------------------------------------------------------------------------
// Part 2 — no feature reaches into a sibling feature's internals.
// ---------------------------------------------------------------------------

const FEATURES_DIR = join(root, 'src', 'features');

// Cross-feature imports that predate the boundary. They are Phase 4 debt: the
// lessons feature reads three things out of notes, and the honest fix is the
// migration that gives notes a public index — not a re-export added now, which
// would pull the notes pages into the lessons chunk to satisfy a lint rule.
//
// This list only shrinks. A cross-feature import that is NOT here fails the
// test, and an entry here that no longer exists fails it too, so clearing one
// means deleting its line rather than leaving a comment about work already
// done.
const KNOWN_CROSS_FEATURE_IMPORTS = new Set([
  'src/features/lessons/components/LearnerLessonCard.jsx → ../../notes/lib/format',
  'src/features/lessons/pages/LearnerLessonsList.jsx → ../../notes/hooks/useLearnerProfile',
  'src/features/lessons/pages/LearnerLessonsList.jsx → ../../notes/styles/notes.css',
]);
const usedAllowances = new Set();

/** Every .js/.jsx file under a directory, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.jsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Import specifiers in a module: static `… from '…'`, side-effect `import '…'`,
 * and dynamic `import('…')`. Regex rather than a parser because only the
 * specifier matters and every form above puts it in quotes. Over-collecting is
 * harmless — a non-import match (`Array.from('x')`) yields a bare string that
 * is skipped below as a package name, while a pattern narrow enough to be
 * exact is a pattern that can silently skip a real import.
 */
function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

/** The feature a path under src/features/ belongs to, or null. */
function featureOf(absPath) {
  const rel = relative(FEATURES_DIR, absPath);
  if (!rel || rel.startsWith('..')) return null;
  return rel.split(sep)[0];
}

let scanned = 0;
for (const file of walk(FEATURES_DIR)) {
  const owner = featureOf(file);
  scanned += 1;
  for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
    if (!spec.startsWith('.')) continue;                       // a package, not our tree
    const target = resolve(dirname(file), spec);
    const targetFeature = featureOf(target);
    if (!targetFeature || targetFeature === owner) continue;   // own feature, or out of src/features

    const frontDoor = join(FEATURES_DIR, targetFeature);
    const isFrontDoor = target === frontDoor ||
      target === join(frontDoor, 'index') ||
      target === join(frontDoor, 'index.js') ||
      target === join(frontDoor, 'index.jsx');
    if (isFrontDoor) continue;

    const entry = `${relative(root, file).split(sep).join('/')} → ${spec}`;
    if (KNOWN_CROSS_FEATURE_IMPORTS.has(entry)) {
      usedAllowances.add(entry);
      continue;
    }
    fail(
      `${relative(root, file)} imports '${spec}', which resolves inside the ` +
      `"${targetFeature}" feature. Cross-feature imports go through ` +
      `src/features/${targetFeature}/index.js (docs/architecture.md §14.7).`
    );
  }
}

for (const entry of KNOWN_CROSS_FEATURE_IMPORTS) {
  if (!usedAllowances.has(entry)) {
    fail(`KNOWN_CROSS_FEATURE_IMPORTS still lists "${entry}", which no longer exists — delete the line.`);
  }
}

if (failures) {
  console.error(`\n${failures} import-boundary failure(s).`);
  process.exit(1);
}

console.log(
  `ok: ${lintCases.length} boundary cases verified against eslint.config.js, ` +
  `${scanned} feature files scanned, ` +
  `${KNOWN_CROSS_FEATURE_IMPORTS.size} recorded cross-feature imports and no new ones`
);
