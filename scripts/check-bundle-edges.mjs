#!/usr/bin/env node
/**
 * Do the pages that must stay light still stay light?
 *
 * ## What this exists to catch
 *
 * A feature's `index.js` is one module that re-exports everything the feature
 * offers. Rollup assigns modules to chunks by which entries reach them, so
 * putting a heavy exporter behind a front door can group a light component into
 * the exporter's chunk — and every consumer that wanted the light component now
 * statically downloads the heavy one. Nothing in ESLint, Vitest or the node
 * suite says a word about it; the bundle simply gets bigger for pages that
 * gained no feature.
 *
 * This is not hypothetical twice over:
 *
 *   • #2172 measured it while migrating the rubric studio. Listing its two
 *     exporters on the front door gave `PublicShareView` — the public,
 *     SEO-visible share page — a static edge to a 382 kB `docx-vendor` chunk,
 *     to render a table. The exporters were left in `src/utils/` instead.
 *   • The SAME PR then checked the flashcards front door BY HAND, found no
 *     direct `docx-vendor` edge, and concluded it was clean. It is not: the
 *     path is `PublicShareView → flashcards → flashcardsToPdf → docx-vendor`.
 *     A grep for a direct edge answers a weaker question than the one that
 *     matters, which is why this walks the graph transitively.
 *
 * That second miss is the argument for a script rather than a habit. The
 * measurement was in the PR description, the reviewer had it, and it was still
 * wrong — because the thing being asked for ("does this page download docx")
 * is one hop away from the thing being checked ("does this chunk mention it").
 *
 * ## What it does NOT claim
 *
 * Only STATIC reachability, which is what a page downloads to render. A chunk
 * behind `import()` is not counted, deliberately: a lazily-mounted route is
 * supposed to be reachable and is not downloaded until it is used. And "light"
 * is a declared list, not a derived property — the point is to protect pages
 * someone has decided matter, not to police chunk sizes generally.
 *
 * ## Running it
 *
 * Needs a build; `test:all` does not build, so this is `check:bundle-edges`
 * rather than `test:*` (the runner auto-discovers every `test:*` node script,
 * and one that needs dist/ would fail there for the wrong reason). CI runs it
 * in the "Build + mobile smoke" job, straight after the build. The reachability
 * logic itself is `scripts/lib/bundleGraph.mjs`, unit-tested with no build by
 * `npm run test:bundle-graph`.
 *
 *   npm run build && npm run check:bundle-edges
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, chunksNamed, findPath } from './lib/bundleGraph.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'dist', 'assets');

/**
 * Pages that must not drag a heavy vendor in, and why each one is on the list.
 * A page earns a place here by being reached by people who did not ask for the
 * heavy thing — not by being important.
 */
const LIGHT_PAGES = {
  PublicShareView: 'the public share page: signed-out, SEO-visible, renders a saved document and offers no export',
  LockedStudio: 'the free-plan paywall sample: renders a specimen document behind a locked studio',
  index: 'the entry chunk: every visitor downloads it, including on the marketing page',
};

/**
 * Vendors worth protecting those pages from, with the size that makes them
 * worth naming. Sizes are indicative — the check is on the EDGE, not the byte
 * count, because a vendor does not stop mattering when it gets smaller.
 */
const HEAVY_VENDORS = {
  'docx-vendor': '~382 kB — the Word exporter runtime',
  pdfjs: 'the PDF viewer runtime, lazily loaded for past papers by design',
};

/**
 * Known violations. SHRINK-ONLY, in the sense the Phase 1 debt lists
 * established: an unrecorded violation fails, and a recorded one that no longer
 * happens ALSO fails, with an instruction to delete the line — so clearing debt
 * means removing a row rather than leaving a note about work already done.
 *
 * Keyed `<page> → <vendor>`.
 */
const ACKNOWLEDGED = new Map([
  [
    'PublicShareView → docx-vendor',
    'src/features/flashcards/index.js re-exports its two exporters (Phase 2), so the front door ' +
    'reaches docx-vendor through flashcardsToPdf. The rubric and homework migrations (#2172, #2173) ' +
    'chose the other way and left their exporters in src/utils/; clearing this means flashcards ' +
    'doing the same, or the exporters moving to src/engines/export-engine/ where §12 puts them.',
  ],
  [
    'LockedStudio → docx-vendor',
    'Same cause as the row above — the locked studio renders the flashcards sample through the same front door.',
  ],
]);

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL: ${message}`); };

if (!existsSync(ASSETS)) {
  // A missing build is not "nothing to check". Treating it as a pass is how a
  // guard reports green in exactly the CI job where it was meant to run.
  console.error('FAIL: dist/assets does not exist — run `npm run build` first. An unbuilt tree is not a clean one.');
  process.exit(1);
}

const sources = new Map();
for (const file of readdirSync(ASSETS)) {
  if (file.endsWith('.js')) sources.set(file, readFileSync(join(ASSETS, file), 'utf8'));
}
if (sources.size === 0) fail('dist/assets holds no .js chunks — the build produced nothing to check.');

const graph = buildGraph(sources);
const seen = new Set();

for (const [page, why] of Object.entries(LIGHT_PAGES)) {
  const matches = chunksNamed(graph, page);
  if (matches.length === 0) {
    // The failure mode this repo has already met once, in printAffectingPaths:
    // a declared name that matches nothing stops being checked, and reads
    // exactly like a clean result.
    fail(
      `no chunk is named "${page}", so it is no longer being checked. ` +
      `Either the chunk was renamed — update this list — or the page is gone and the line should go with it. (${why})`,
    );
    continue;
  }
  if (matches.length > 1) {
    fail(`"${page}" names ${matches.length} chunks (${matches.join(', ')}); the check cannot tell which one is meant.`);
    continue;
  }

  for (const [vendor, cost] of Object.entries(HEAVY_VENDORS)) {
    if (chunksNamed(graph, vendor).length === 0) continue;   // vendor not in this build
    const path = findPath(graph, matches[0], vendor);
    const key = `${page} → ${vendor}`;
    if (path) {
      seen.add(key);
      if (!ACKNOWLEDGED.has(key)) {
        fail(
          `${page} statically reaches ${vendor} (${cost}):\n` +
          `         ${path.join(' → ')}\n` +
          `       ${why}.\n` +
          '       A page downloads everything its static imports reach. If this came from adding a name to a ' +
          "feature's index.js, that is the front door dragging the vendor in — see docs/architecture.md §13 " +
          '(Phase 4) for the two migrations that met this and what they did instead.',
        );
      }
    }
  }
}

for (const [key, note] of ACKNOWLEDGED) {
  if (!seen.has(key)) {
    fail(`"${key}" is recorded as a known violation but no longer happens. Delete its line — the list only shrinks. (${note})`);
  }
}

if (failures) {
  console.error(`\n${failures} bundle-edge failure(s).`);
  process.exit(1);
}

console.log(
  `ok: ${Object.keys(LIGHT_PAGES).length} light pages checked against ${Object.keys(HEAVY_VENDORS).length} heavy vendors ` +
  `over ${graph.size} chunks; ${ACKNOWLEDGED.size} known violation(s) recorded, and no new ones`,
);
