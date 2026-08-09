#!/usr/bin/env node
/**
 * Does every lazily-mounted route resolve to a module that actually exports
 * what the mount asks for?
 *
 * ## Why a page is the one thing nothing checks
 *
 * Phase 1 gave pages a deliberate exception: a page is NOT exported from its
 * feature's `index.js`, because a page in a front door lands in the chunk of
 * every consumer. The two route tables reach them with
 * `lazy(() => import('…/pages/Thing'))` instead — and a lazy import is a
 * STRING. Nothing resolves it at build time: Rollup emits a chunk for a path
 * that exists, ESLint's `no-restricted-imports` matches text, and
 * `test:import-boundaries` checks which LAYER an import crosses, not whether
 * the module on the end of it exports a component.
 *
 * So the failure mode is specific and quiet: a migration moves a page, the
 * mount is re-pointed, and the export SHAPE silently stops matching — a page
 * that exported `default` now exports a name, or a `.then(m => ({ default:
 * m.Thing }))` mount names an export that was renamed on the way across. The
 * suite stays green, because a route-mounted page is not rendered by any spec;
 * the route simply throws in the browser, on a surface someone has to visit to
 * find out.
 *
 * Phase 4 has re-pointed 177 of these across eleven pull requests, and Wave 4
 * moves twelve more teacher and admin surfaces. This check is the Phase 4
 * review sweep's answer to the one hazard in a "pure move" that no existing
 * guard could see.
 *
 * ## What it checks
 *
 *   • the path resolves to a real file (a moved page whose mount was missed);
 *   • a bare `import('…')` mount finds a default export — including the
 *     `export { default } from '…'` re-export shim form, which is how several
 *     teacher studios are mounted;
 *   • a `.then(m => ({ default: m.Thing }))` mount finds `Thing` exported,
 *     following one level of `export … from '…'` re-export so a feature's
 *     page barrel counts.
 *
 * It does NOT type-check the export or confirm it renders. It answers the
 * question a moved file makes urgent — is the thing the router asks for still
 * there — and nothing more.
 *
 * Plain-node, no build, auto-discovered by scripts/run-all-tests.mjs.
 *
 * Run: node scripts/test-route-mounts.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { APP_PATH, ROOT, TEACHER_ROUTES_PATH, readSource } from './lib/declaredRoutes.mjs';

/** Vite's resolution order for the extensionless specifiers this repo writes. */
const SUFFIXES = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx'];
const resolveModule = (base) =>
  SUFFIXES.map((suffix) => base + suffix).find((path) => existsSync(path) && statSync(path).isFile()) || null;

/**
 * `import('./x')`, optionally followed by the `.then(m => ({ default: m.Y }))`
 * form the named-export pages are mounted with. Both route tables write these
 * on one line, which is what makes a line-scoped pattern honest here.
 */
const MOUNT = /import\(\s*['"](\.[^'"]+)['"]\s*\)(?:\s*\.then\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\(\{\s*default:\s*\2\.(\w+)\s*\}\)\s*\))?/g;

const hasDefaultExport = (code) =>
  /export\s+default\b/.test(code) || /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(code);

/**
 * Is `name` exported by this module, directly or by re-export?
 *
 * One level of `export { Name } from '…'` / `export * from '…'` is followed,
 * because a feature's `pages/` module legitimately re-exports from a sibling.
 * Deeper chains are not followed: the point is to catch a rename, and a name
 * that survives two hops of re-export has not been renamed.
 */
function hasNamedExport(file, name, depth = 0) {
  const code = readFileSync(file, 'utf8');
  if (new RegExp(`export\\s+(?:async\\s+)?(?:const|let|var|function|class)\\s+${name}\\b`).test(code)) return true;
  if (new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}(?!\\s*from)`).test(code)) return true;
  if (new RegExp(`export\\s*\\{[^}]*\\bas\\s+${name}\\b`).test(code)) return true;
  if (depth > 0) return false;
  for (const match of code.matchAll(/export\s*(?:\{[^}]*\}|\*)\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolveModule(resolve(dirname(file), match[1]));
    if (target && hasNamedExport(target, name, depth + 1)) return true;
  }
  return false;
}

let failures = 0;
let checked = 0;
const fail = (message) => { failures += 1; console.error(`FAIL: ${message}`); };

for (const table of [APP_PATH, TEACHER_ROUTES_PATH]) {
  const source = readSource(table);
  for (const match of source.matchAll(MOUNT)) {
    const [, specifier, , named] = match;
    const line = source.slice(0, match.index).split('\n').length;
    const where = `${table}:${line}`;
    const file = resolveModule(resolve(dirname(join(ROOT, table)), specifier));
    checked += 1;

    if (!file) {
      fail(`${where}\n        lazy(() => import('${specifier}')) resolves to no file.\n` +
        '        Nothing build-time checks a lazy specifier, so this route throws only when someone visits it.');
      continue;
    }
    if (named) {
      if (!hasNamedExport(file, named)) {
        fail(`${where}\n        the mount reads the named export '${named}' off ${relative(ROOT, file)}, which does not export it.\n` +
          '        A page that was renamed on the way into a feature leaves the route table pointing at the old name.');
      }
      continue;
    }
    if (!hasDefaultExport(readFileSync(file, 'utf8'))) {
      fail(`${where}\n        the mount expects a DEFAULT export from ${relative(ROOT, file)}, which has none.\n` +
        "        If the page now exports a name, mount it as .then(m => ({ default: m.Name })).");
    }
  }
}

if (failures) {
  console.error(`\n${failures} route mount(s) that would throw in the browser.`);
  process.exit(1);
}

console.log(`ok: ${checked} lazy route mount(s) across the two route tables all resolve to the export they name`);
