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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
// what stops a new one arriving unnoticed. Each clears when its caller migrates
// into a feature.
//
// Was eleven at the end of Phase 1. Phase 2 cleared two by moving
// useFlashcardProgress (and its spec) into src/features/flashcards/hooks/,
// where reaching the progress repository is an intra-feature import.
//
// The papers migration cleared a third, and not by moving the caller alone —
// that would only have converted a legacy→feature import into a cross-feature
// one, and KNOWN_CROSS_FEATURE_IMPORTS below only shrinks. `paperResumeSync`
// moved INTO src/features/papers/lib/ (it is about papers; it merely lived
// next to its reader), and the storage keys the two features share went to
// src/shared/utils/paperResumeStorage.js.
//
// The lessons migration cleared a fourth the same way, as that entry
// predicted it would: `lessonResume` moved from features/learnerHome/lib/
// into features/lessons/lib/ alongside LessonPlayer, its only importer.
// It needed no shared module, and the difference from the papers case is
// worth keeping — `paperResumeSync` and learner-home shared a localStorage
// contract, so something had to sit below both. `lessonResume` writes the
// `noteProgress` collection directly and learner-home meets it THERE, at the
// collection rather than at a module. Nothing to put below two features that
// do not import each other.
const KNOWN_LEGACY_FEATURE_IMPORTS = new Set([
  'src/components/teacher/TeacherDashboard.jsx → ../../features/teacherSettings/lib/useTeachingProfile',
  // FORCED, and recorded rather than avoided — `teacherShell` PR B. Every other
  // entry on this list clears when its caller migrates into a feature; this one
  // has no such path, so its retirement condition is written down instead of
  // left to be rediscovered.
  //
  // The spec probes the REAL hook on purpose. Its own comment: the hook "reads
  // the module store directly and never touches ThemeProvider — which is the
  // whole reason it was able to bypass persistence — so the probe for it has to
  // be the real hook." A fake would gut the regression the spec exists to hold.
  //
  // The three ways out were all worse. Exporting `useDashboardTheme` from
  // `teacherShell`'s front door puts a hook on the import graph of everything
  // that opens the door — what #2247 refused, and a locked §9 decision.
  // Relocating the hook because `teacherThemeStore` lives in `src/contexts/` is
  // a seam redesign riding inside a path migration, which is the rule the
  // 4,047-line stylesheet was held to. Refusing to record a real edge would
  // only make this list lie.
  //
  // RETIRES when the `useDashboardTheme` / `teacherThemeStore` seam is
  // revisited — the store is in `src/contexts/` and the hook is in the feature,
  // and closing that split is the actual fix. Deferred deliberately, not
  // forgotten.
  'src/contexts/TeacherThemeSync.spec.jsx → ../features/teacherShell/hooks/useDashboardTheme',
]);

const usedAllowances = new Set();

/**
 * Non-relative specifiers are treated as packages and skipped, which is only
 * safe while no path alias maps one back into src/.
 *
 * What this detects, stated exactly: a literal `alias:` key — bare or quoted,
 * with any whitespace or comment lines before the colon — in either Vite
 * config. That is the form an alias is added in, and catching it stops the scan
 * from quietly covering half the tree. It is NOT every form an alias can arrive
 * in: a computed key (`[someName]: …`), or an alias object spread in from
 * another module, leaves no `alias:` token in these two files and passes.
 *
 * The residual is deliberate. Closing it means resolving the real Vite config,
 * which trades a narrow gap for a dependency on Vite's internals inside a
 * migration guard — and the build-plugin version of that puts the dependency in
 * the production build path. If an alias is ever added by one of the forms
 * above, teach this resolver about it in the same change.
 */
function assertNoUnknownAliases() {
  for (const config of ['vite.config.js', 'vitest.config.js']) {
    const source = readFileSync(join(root, config), 'utf8');
    // Bare and quoted keys, with any whitespace or comment lines before the
    // colon. A COMPUTED key (`[someName]: …`) is out of reach of a source scan
    // and stays the honest residual: closing it means resolving the real Vite
    // config, which trades this gap for a dependency on Vite's internals.
    if (/['"]?\balias\b['"]?\s*:/.test(source)) {
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

  // Comments are scanned too — a JSDoc `@example` block writes imports that
  // look exactly like real ones. That over-collection is safe for the boundary
  // checks (a documented import that would be a violation is worth seeing) but
  // NOT for the resolution check: `src/editor/utils/migration.js` documents a
  // `./db.js` that has not existed for some time, and failing the build over a
  // stale code sample would be the guard crying wolf.
  //
  // So each match is classified where it SITS, by the text before it on its own
  // line. The first attempt stripped comments from the whole file instead, and a
  // `/*` inside a string ate 22 KB of App.jsx — every import in the deleted span
  // silently stopped being resolved, which is the failure mode this check exists
  // to prevent. A line-local test cannot do that: if it is ever wrong it
  // over-reports, and an over-report is visible.
  const isCommentLine = (index) => {
    const before = source.slice(source.lastIndexOf('\n', index) + 1, index).trimStart();
    return before.startsWith('*') || before.startsWith('//') || before.startsWith('/*');
  };

  const specs = [];
  const patterns = [
    [/\bfrom\s*['"]([^'"]+)['"]/g, false],
    [/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g, false],
    [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, true],
    [/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, false],
  ];
  for (const [pattern, dynamic] of patterns) {
    for (const match of source.matchAll(pattern)) {
      specs.push({
        spec: match[1],
        dynamic,
        routeMount: dynamic && routeMounts.has(match[1]),
        inCode: !isCommentLine(match.index),
      });
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

/**
 * Does a relative specifier point at a file that exists?
 *
 * Vite resolves these at build time, so a broken STATIC import fails the build.
 * A broken DYNAMIC one does not: `lazy(() => import('./gone'))` is a runtime
 * chunk-load error on the route that uses it, which is why a migration that
 * moves a lazily-mounted page needs this and not just the layering check.
 * Extensionless imports are the repo's normal style, so try what Vite tries.
 */
const RESOLVE_SUFFIXES = ['', '.js', '.jsx', '.mjs', '.json', '.css', '/index.js', '/index.jsx'];
function resolvesToFile(abs) {
  return RESOLVE_SUFFIXES.some((suffix) => {
    const candidate = abs + suffix;
    return existsSync(candidate) && statSync(candidate).isFile();
  });
}

/**
 * The file a relative specifier names, ignoring any query or hash.
 *
 * A specifier may carry one. Vite defines several (`?raw`, `?url`, `?worker`)
 * and Node treats a query as part of the module KEY — which is how a test loads
 * a fresh instance of a module holding page-load state, as
 * `src/utils/visitorId.test.js` does to exercise its per-load memo. Both forms
 * name the same file on disk. Stripping is not a loosening: the layer checks
 * still apply to the resolved path, and a specifier whose BASE does not exist
 * still fails, which is what the self-check below pins.
 */
function specifierPath(fromFile, spec) {
  return resolve(dirname(fromFile), spec.replace(/[?#].*$/, ''));
}

{
  const self = join(root, 'scripts/test-import-boundaries.mjs');
  if (!resolvesToFile(specifierPath(self, './lib/declaredRoutes.mjs?fresh=1'))) {
    fail('the resolver no longer sees through a query suffix — every ?query import now reads as missing');
  }
  if (resolvesToFile(specifierPath(self, './lib/does-not-exist.mjs?fresh=1'))) {
    fail('a query suffix hides a missing file from the resolver — the check has been loosened, not taught');
  }
}

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

  for (const { spec, dynamic, routeMount, inCode } of importSpecifiers(readFileSync(file, 'utf8'))) {
    if (isFirebasePackage(spec) && NO_FIREBASE_LAYERS.has(from.layer)) {
      fail(
        `${posix(file)} imports '${spec}'. src/${from.layer}/ reaches Firebase through src/services/ ` +
        '(docs/architecture.md §14.2) — the dynamic and require() forms are not an exemption, ' +
        'they are only the forms ESLint cannot see.'
      );
      continue;
    }
    if (!spec.startsWith('.')) continue;              // a package, not our tree
    const resolvedPath = specifierPath(file, spec);
    if (inCode && !resolvesToFile(resolvedPath)) {
      fail(
        `${posix(file)} imports '${spec}', which resolves to nothing on disk` +
        (dynamic ? ' — and a dynamic import that resolves to nothing is a runtime chunk-load error, not a build failure.' : '.')
      );
      continue;
    }
    const target = locate(resolvedPath);
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
