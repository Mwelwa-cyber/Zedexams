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
//  2. Every import in src/ is resolved to a real path and checked against the
//     layering. This is not a duplicate of part 1 — it sees three things the
//     lint rules structurally cannot:
//
//       • Sibling features. `src/features/A/pages/X.jsx` reaching
//         `src/features/B` is written `../../B/lib/y`, which names no layer —
//         as a string it is identical in shape to its own `../lib/y`.
//       • Dynamic `import('…')`. `no-restricted-imports` inspects static
//         import/export declarations only, so a lazily-loaded module crosses
//         any boundary it likes without a word from ESLint.
//       • Growth. Warnings do not fail `eslint .`, so the legacy debt below
//         could double without a red build. Here it is a shrink-only list.
//
// Both debt lists only shrink: an import that is NOT recorded fails, and a
// recorded entry that no longer exists fails too, so clearing one means
// deleting its line rather than leaving a note about work already done.
//
// Plain-node test, auto-discovered by scripts/run-all-tests.mjs via the
// test:import-boundaries script.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ESLint } from 'eslint';
import { APP_PATH, TEACHER_ROUTES_PATH } from './lib/declaredRoutes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const FEATURES_DIR = join(SRC, 'features');
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

  // The two bottom layers that predate the scaffold.
  { file: 'src/services/probe.js', spec: '../features/notes/lib/firestore', severity: 2,
    why: 'a feature calls a service, never the reverse' },
  { file: 'src/services/probe.js', spec: '../engines/export-engine', severity: 2,
    why: 'services sit below the engines that call them' },
  { file: 'src/config/probe.js', spec: '../services/passkeyService.js', severity: 2,
    why: 'config is data — reaching a service inverts what the taxonomy depends on' },
  { file: 'src/config/probe.js', spec: '../curriculum/catalog', severity: 2,
    why: 'the catalog reads config, not the other way round' },

  // The repo configures no path aliases today (no jsconfig/tsconfig, no
  // resolve.alias), and `assertNoUnknownAliases` below fails if one appears.
  // These pin that the patterns would hold anyway: the `**/` prefix matches an
  // alias segment, so `@/features/…` is caught exactly like the relative form.
  { file: 'src/shared/utils/probe.js', spec: '@/features/notes/lib/x', severity: 2,
    why: 'an alias must not be a way around the layer rule' },
  { file: 'src/features/notes/pages/Probe.jsx', spec: '@/features/learnerHome/lib/x', severity: 2,
    why: 'an alias must not be a way around the cross-feature rule' },

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
  { file: 'src/features/notes/pages/Probe.jsx', spec: '../../visualStudio/index', severity: 0,
    why: 'the repo omits extensions, and the front door with one omitted is still the front door' },
  { file: 'src/hooks/probe.js', spec: '../features/visualStudio/index', severity: 0,
    why: 'lint and the path resolver must agree on what the front door is' },
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
// Part 2 — every import in src/, resolved.
// ---------------------------------------------------------------------------

// Which layer may not import which. A layer may always use what is below it;
// these are the upward edges (docs/architecture.md §12). `legacy` is everything
// in src/ that has not migrated into a layer yet — it is not restricted here,
// but its reach INTO feature internals is ratcheted below.
//
// `services` and `config` are bottom layers too, not `legacy`: the arrow ends
// at them. `config` additionally refuses `services`, because it is data, and
// data that reaches a Firebase-backed service inverts the direction the whole
// taxonomy depends on. `firebase` is listed so that src/firebase/ is a
// destination the three lowest layers can be kept away from — the SDK reached
// by a relative path is the same dependency as the SDK reached by package name.
const FORBIDDEN_TARGETS = {
  app: [],
  features: ['app'],
  engines: ['app', 'features', 'firebase'],
  curriculum: ['app', 'features', 'engines', 'firebase'],
  shared: ['app', 'features', 'engines', 'curriculum', 'firebase'],
  services: ['app', 'features', 'engines', 'curriculum'],
  config: ['app', 'features', 'engines', 'curriculum', 'services'],
  firebase: [],
  legacy: [],
};

/**
 * The layers that must not touch the Firebase SDK at all (§14.2). ESLint
 * refuses the static form; this catches `await import('firebase/firestore')`
 * and `require('firebase/auth')`, which it does not see, and which would
 * otherwise be skipped below as ordinary package specifiers.
 */
const NO_FIREBASE_LAYERS = new Set(['shared', 'engines', 'curriculum']);
const isFirebasePackage = (spec) => spec === 'firebase' || spec.startsWith('firebase/');

// Cross-feature imports that predate the boundary. The fix is the Phase 4
// migration that gives notes a public index — a re-export added now would pull
// the notes pages into the lessons chunk to satisfy a lint rule.
const KNOWN_CROSS_FEATURE_IMPORTS = new Set([
  'src/features/lessons/components/LearnerLessonCard.jsx → ../../notes/lib/format',
  'src/features/lessons/pages/LearnerLessonsList.jsx → ../../notes/hooks/useLearnerProfile',
  'src/features/lessons/pages/LearnerLessonsList.jsx → ../../notes/styles/notes.css',
]);

// The legacy tree reaching into feature internals. ESLint reports each as a
// warning at the call site, and warnings do not fail `eslint .` — this list is
// what stops a twelfth from arriving unnoticed. Each clears when its caller
// migrates into a feature (Phase 4).
const KNOWN_LEGACY_FEATURE_IMPORTS = new Set([
  'src/components/admin/VisualStudioAdmin.jsx → ../../features/visualStudio/services/visualAssetService',
  'src/components/lessons/LessonPlayer.jsx → ../../features/learnerHome/lib/lessonResume',
  'src/components/papers/PastPaperViewer.jsx → ../../features/learnerHome/lib/paperResumeSync',
  'src/components/teacher/TeacherDashboard.jsx → ../../features/teacherSettings/lib/useTeachingProfile',
  'src/components/teacher/TeacherTopBar.jsx → ../../features/teacherSettings/lib/useTeachingProfile',
  'src/components/teacher/dashboardV2/useTeacherDashboardData.js → ../../../features/teacherSettings/lib/useTeachingProfile',
  'src/components/teacher/generate/ClassTimetableStudio.jsx → ../../../features/teacherSettings/lib/useTeachingProfile',
  'src/components/teacher/studio/hooks/useActiveAssignmentContext.js → ../../../../features/teacherSettings/lib/useTeachingProfile',
  'src/hooks/useFlashcardProgress.js → ../features/flashcards/lib/progress',
  'src/hooks/useFlashcardProgress.spec.js → ../features/flashcards/lib/progress',
  'src/hooks/useLearnerSearch.js → ../features/notes/lib/firestore',
]);

const usedAllowances = new Set();

/**
 * Non-relative specifiers are treated as packages and skipped, which is only
 * safe while no path alias maps one back into src/. Fail closed rather than
 * quietly stop covering half the tree the day someone adds one.
 */
function assertNoUnknownAliases() {
  for (const config of ['vite.config.js', 'vitest.config.js']) {
    const source = readFileSync(join(root, config), 'utf8');
    if (/\balias\s*:/.test(source)) {
      fail(
        `${config} now configures resolve.alias. Aliased specifiers do not start with "." and are ` +
        'skipped by this scan as packages — teach the resolver below about the alias before adding it, ' +
        'or the layering stops being checked for every import that uses it.'
      );
    }
  }
}

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
 * dynamic `import('…')`, and `require('…')` — src/ is ESM and has none today,
 * but a boundary that stops applying the moment someone writes one is not a
 * boundary. Regex rather than a parser because only the
 * specifier matters and every form above puts it in quotes. Over-collecting is
 * harmless — a non-import match (`Array.from('x')`) yields a bare string that
 * is skipped below as a package name, while a pattern narrow enough to be
 * exact is a pattern that can silently skip a real import.
 */
function importSpecifiers(source) {
  // Specifiers appearing in a `lazy(() => import('…'))` route mount. Matched
  // separately so the route-table exemption below can require the mount
  // pattern itself rather than trusting any dynamic import in those files:
  // a bare `import('../../features/notes/lib/firestore')` prefetch is not a
  // route mount and does not inherit its licence.
  const routeMounts = new Set(
    [...source.matchAll(/\blazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  );

  const specs = [];
  const patterns = [
    [/\bfrom\s*['"]([^'"]+)['"]/g, false],
    [/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g, false],
    [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, true],
    [/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, false],
  ];
  for (const [pattern, dynamic] of patterns) {
    for (const match of source.matchAll(pattern)) {
      specs.push({ spec: match[1], dynamic, routeMount: dynamic && routeMounts.has(match[1]) });
    }
  }
  return specs;
}

/**
 * The two files that declare routes, per scripts/lib/declaredRoutes.mjs — the
 * one module that knows where routes are declared, so this cannot drift from
 * the route-parsing guards.
 *
 * A route mount is the one place allowed to name a page module inside a
 * feature, and only through `lazy(() => import(…))` — the pattern is matched,
 * not assumed from the file. Sending a mount through the feature's index would
 * load the whole front door to render one route, which is the opposite of what
 * a lazy route is for. Nothing else in these files inherits that licence: a
 * static deep import defeats the split AND crosses the boundary, and a bare
 * dynamic prefetch crosses it without even being a route.
 */
const ROUTE_TABLES = new Set([join(root, APP_PATH), join(root, TEACHER_ROUTES_PATH)]);

/** `{layer, feature}` for a path under src/, or null if it is outside src/. */
function locate(absPath) {
  const rel = relative(SRC, absPath);
  if (!rel || rel.startsWith('..')) return null;
  const segments = rel.split(sep);
  const layer = Object.hasOwn(FORBIDDEN_TARGETS, segments[0]) ? segments[0] : 'legacy';
  return { layer, feature: layer === 'features' ? segments[1] : null };
}

const posix = (absPath) => relative(root, absPath).split(sep).join('/');

assertNoUnknownAliases();

let scanned = 0;
for (const file of walk(SRC)) {
  const from = locate(file);
  scanned += 1;

  for (const { spec, routeMount } of importSpecifiers(readFileSync(file, 'utf8'))) {
    if (isFirebasePackage(spec) && NO_FIREBASE_LAYERS.has(from.layer)) {
      fail(
        `${posix(file)} imports '${spec}'. src/${from.layer}/ reaches Firebase through src/services/ ` +
        '(docs/architecture.md §14.2) — the dynamic and require() forms are not an exemption, ' +
        'they are only the forms ESLint cannot see.'
      );
      continue;
    }
    if (!spec.startsWith('.')) continue;              // a package, not our tree
    const target = locate(resolve(dirname(file), spec));
    if (!target) continue;                            // resolves outside src/

    if (FORBIDDEN_TARGETS[from.layer].includes(target.layer)) {
      fail(
        `${posix(file)} imports '${spec}', which resolves into src/${target.layer}/. ` +
        `src/${from.layer}/ sits below it — the layering is one-way (docs/architecture.md §12).`
      );
      continue;
    }

    if (target.layer !== 'features' || target.feature === from.feature) continue;
    if (routeMount && ROUTE_TABLES.has(file)) continue;  // a lazily-mounted route

    const frontDoor = join(FEATURES_DIR, target.feature);
    const resolved = resolve(dirname(file), spec);
    const isFrontDoor = [frontDoor, join(frontDoor, 'index'), join(frontDoor, 'index.js'), join(frontDoor, 'index.jsx')]
      .includes(resolved);
    if (isFrontDoor) continue;

    const entry = `${posix(file)} → ${spec}`;
    const list = from.layer === 'features' ? KNOWN_CROSS_FEATURE_IMPORTS : KNOWN_LEGACY_FEATURE_IMPORTS;
    if (from.layer === 'features' || from.layer === 'legacy') {
      if (list.has(entry)) {
        usedAllowances.add(entry);
        continue;
      }
    }
    fail(
      `${posix(file)} imports '${spec}', which resolves inside the "${target.feature}" feature. ` +
      `Cross-feature imports go through src/features/${target.feature}/index.js (docs/architecture.md §14.7).`
    );
  }
}

for (const entry of [...KNOWN_CROSS_FEATURE_IMPORTS, ...KNOWN_LEGACY_FEATURE_IMPORTS]) {
  if (!usedAllowances.has(entry)) {
    fail(`A recorded import no longer exists: "${entry}". Delete the line — the lists only shrink.`);
  }
}

if (failures) {
  console.error(`\n${failures} import-boundary failure(s).`);
  process.exit(1);
}

console.log(
  `ok: ${lintCases.length} boundary cases verified against eslint.config.js; ` +
  `${scanned} src files resolved, no layering violation; ` +
  `${KNOWN_CROSS_FEATURE_IMPORTS.size} cross-feature and ${KNOWN_LEGACY_FEATURE_IMPORTS.size} legacy imports recorded, and no new ones`
);
