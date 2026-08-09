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
import { buildGraph, chunksNamed, findPath, hasDirectEdge, withoutEdge } from './lib/bundleGraph.mjs';

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
  TeachersLanding: 'the /teachers marketing page: top-of-funnel, signed-out, and it renders a flashcards specimen',
};

/**
 * Chunks worth protecting those pages from, with the size that makes each one
 * worth naming. Sizes are indicative — the check is on the EDGE, not the byte
 * count, because a chunk does not stop mattering when it gets smaller.
 *
 * `pdf-vendor` and `buildExtensions` were added by the Phase 4 review sweep,
 * and the reason is the whole argument for keeping this list honest: the two
 * heaviest things the light pages could reach were the two this check did not
 * name. It reported "4 light pages checked" while every visitor — the marketing
 * page included — statically downloaded 578 kB of jsPDF/html2canvas. A guard
 * that protects against the third- and fourth-largest chunks and not the first
 * two is green for the wrong reason.
 *
 * `buildExtensions` is an app chunk rather than a vendor bucket (Rollup names
 * it after `src/editor/extensions/buildExtensions.js`, where the TipTap and
 * ProseMirror packages land). It is listed anyway: what matters to a page is
 * the weight it downloads, not which directory the weight came from.
 */
const HEAVY_VENDORS = {
  'docx-vendor': '~382 kB — the Word exporter runtime',
  pdfjs: 'the PDF viewer runtime, lazily loaded for past papers by design',
  'pdf-vendor': '~578 kB — jsPDF + html2canvas, reached by dynamic import() from htmlToPdf.js by design',
  buildExtensions: '~705 kB — the TipTap/ProseMirror editor runtime',
};

/**
 * Known violations. SHRINK-ONLY, in the sense the Phase 1 debt lists
 * established: an unrecorded violation fails, and a recorded one that no longer
 * happens ALSO fails, with an instruction to delete the line — so clearing debt
 * means removing a row rather than leaving a note about work already done.
 *
 * Keyed `<page> → <vendor>`, and each entry records **what was acknowledged**,
 * not merely that the pair is allowed. The distinction is the whole value of
 * the record (Codex, #2210): keyed on the pair alone, accepting
 * "the share page reaches the editor through the paper renderer" also accepts a
 * direct `import RichEditor` added to that page next month — a different
 * dependency, never reviewed, and CI green because the pair was already on the
 * list.
 *
 * So each entry records `via` — **the page's OWN dependencies through which the
 * weight arrives**. Every one must really lead to the vendor, and cutting all of
 * them must leave the vendor unreachable. A new direct `import RichEditor` on
 * the page, or a second component that drags the editor in, survives the cut and
 * fails.
 *
 * `via` is the page's own edges rather than the full chain because the full
 * chain is not stable enough to be a record. Enumerating chains here found
 * `figureLabelLayout → buildExtensions`, then
 * `figureLabelLayout → quizRichText → buildExtensions`, then a third through
 * `migration` — all the same fact (a page that DISPLAYS saved rich text needs
 * the schema that produced it), restated once per chunk in the renderer cluster.
 * These are CHUNK edges, not import statements: a chunk is named for one module
 * and carries many. What is worth pinning is the page's own reach, and the
 * enumeration is what proves the pin covers everything.
 */
const ACKNOWLEDGED = new Map([
  // #2176 added this check and recorded the two flashcards paths here; #2177
  // cleared them by moving the exporters back to src/utils/, which is what
  // deleting a row looks like.
  //
  // The two below are the read-only rich-text renderer, and unlike the
  // flashcards paths they are not a mistake to undo. `src/editor/utils/
  // safeRender.js` statically imports `renderExtensions`, because rendering
  // stored ProseMirror JSON needs the schema that produced it — a page that
  // DISPLAYS saved rich text genuinely depends on the editor's node
  // definitions. Making a share page light would mean a second, render-only
  // schema, which is a project rather than an import to move, and it is not
  // being done inside a review sweep.
  //
  // They are recorded rather than deleted from the list so the weight stays
  // countable and so the two pages that do NOT carry it — the entry chunk and
  // the /teachers marketing page — still fail if they ever join.
  //
  // Both entries name several front doors AND `SbaTaskView`, which is not
  // redundancy: since the SBA migration the pages import the view THROUGH a
  // feature's front door, and Rollup emits both a front-door chunk and a chunk
  // for the view itself, giving the page an edge to each. The weight behind
  // them is one component either way. Naming each is what keeps the record a
  // statement about the page's actual reach rather than about one spelling of
  // it.
  //
  // `classTimetable` joined both entries with the class-timetable migration,
  // and it is a good illustration of why `via` is a list rather than a chain.
  // That feature's front door is tiny — one presentational view — but Rollup
  // grouped it into the same chunk as the `sba` front door, which is how the
  // SBA renderer is reached. So the page/vendor pair did not change, the WEIGHT
  // did not change (measured: 576 chunks before and after, the same heavy
  // vendors reachable from each of the four light pages, +52 bytes on these two
  // — the length of the new import path strings), and yet the chunk carrying
  // the acknowledged dependency was renamed. On PublicShareView the `sba` edge
  // was absorbed entirely and had to be deleted; on LockedStudio it survived
  // alongside. A chunk carries many modules, so an entry here names the
  // dependencies of the page, and the emitted graph decides which chunk answers
  // for them.
  ['PublicShareView → buildExtensions', {
    why: 'the saved-document renderers it mounts reach the editor schema to draw saved rich text; `classTimetable` is the front-door chunk that now carries the SBA front door, which is how SbaTaskView is reached since the SBA migration',
    via: ['AssessmentPaperView', 'classTimetable', 'SbaTaskView'],
  }],
  ['LockedStudio → buildExtensions', {
    why: 'the specimen SBA task it renders reaches the same schema, for the same reason, through the sba front door and the classTimetable chunk grouped with it',
    via: ['sba', 'classTimetable', 'SbaTaskView'],
  }],
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

/**
 * A declared heavy chunk that names no chunk was SKIPPED silently until the
 * Phase 4 review sweep — the exact failure the LIGHT_PAGES loop below already
 * refused to allow, left open on the other side of the same comparison. A
 * renamed vendor bucket would have taken every page's protection from it with
 * no output at all, and the check would still have printed "ok".
 */
const vendorsPresent = new Set();
for (const [vendor, cost] of Object.entries(HEAVY_VENDORS)) {
  if (chunksNamed(graph, vendor).length > 0) { vendorsPresent.add(vendor); continue; }
  fail(
    `no chunk is named "${vendor}", so no page is being checked against it. ` +
    'Either the chunk was renamed — update HEAVY_VENDORS — or the dependency is gone and the line ' +
    `should go with it. (${cost})`,
  );
}

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
    if (!vendorsPresent.has(vendor)) continue;   // already reported once, below
    const path = findPath(graph, matches[0], vendor);
    const key = `${page} → ${vendor}`;
    if (path) {
      seen.add(key);
      const acknowledged = ACKNOWLEDGED.get(key);
      if (acknowledged) {
        let remaining = graph;
        for (const via of acknowledged.via) {
          if (!hasDirectEdge(graph, matches[0], via)) {
            fail(
              `${key} records "${via}" as how the weight arrives, but ${page} no longer imports it. ` +
              `Delete that entry — the list only shrinks. (${acknowledged.why})`,
            );
            continue;
          }
          remaining = withoutEdge(remaining, page, via);
        }
        const beyond = findPath(remaining, matches[0], vendor);
        if (beyond) {
          fail(
            `${key} reaches the vendor through something the record does not name:\n` +
            `         ${beyond.join(' → ')}\n` +
            `       recorded: ${acknowledged.via.join(', ')} (${acknowledged.why})\n` +
            '       An acknowledgement covers the dependencies that were reviewed, not the page/vendor pair for ' +
            'ever. Remove the new dependency, or add it to `via` with the reason it is acceptable.',
          );
        }
      } else {
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

for (const [key, { why }] of ACKNOWLEDGED) {
  if (!seen.has(key)) {
    fail(`"${key}" is recorded as a known violation but no longer happens. Delete its line — the list only shrinks. (${why})`);
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
