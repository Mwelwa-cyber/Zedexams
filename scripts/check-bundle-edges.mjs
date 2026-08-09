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
 * So each entry records `cut` — **the EDGES the exception rests on**. Every one
 * must really exist, and with all of them removed the vendor must be
 * unreachable from that page. A new direct `import RichEditor` on the page, or
 * a second component that drags the editor in by another route, survives the
 * cut and fails.
 *
 * `cut` names the edge that IS the reason. The two obvious alternatives were
 * both tried here first and both churn:
 *
 *   • The full CHAIN. Enumerating chains produced
 *     `figureLabelLayout → buildExtensions`, then `… → quizRichText → …`, then
 *     a third through `migration` — the same fact restated once per chunk in
 *     the renderer cluster.
 *   • The page's own FIRST HOP, which is what this list held until now. It read
 *     `SbaTaskView`, then gained `sba` when that feature got a front door, then
 *     gained `classTimetable` when Rollup grouped the two front doors into one
 *     chunk — and on `PublicShareView` the `sba` entry had to be DELETED in the
 *     same edit because it was absorbed. Three rewrites in three consecutive
 *     migrations, and the measurement each time said the weight was unchanged.
 *     A record that every unrelated migration has to edit stops being read, and
 *     a record nobody reads is not a control.
 *
 * These are CHUNK edges, not import statements: a chunk is named for one module
 * and carries many, which is exactly why the chunk a dependency lands in moves
 * and the edge into the vendor does not.
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
  // schema, which is a project rather than an import to move.
  //
  // They are recorded rather than deleted from the list so the weight stays
  // countable and so the two pages that do NOT carry it — the entry chunk and
  // the /teachers marketing page — still fail if they ever join.
  //
  // Three edges, because the renderer cluster reaches the editor schema three
  // ways and all three mean the same thing. Cutting all three must leave
  // `buildExtensions` unreachable from these pages; that is what makes the
  // record complete rather than merely true.
  ['PublicShareView → buildExtensions', {
    why: 'the saved-document renderers it mounts (assessment papers, SBA tasks) draw stored rich text, and the shared paper renderer needs the editor schema to do it',
    cut: [['figureLabelLayout', 'buildExtensions'], ['quizRichText', 'buildExtensions'], ['migration', 'buildExtensions']],
  }],
  ['LockedStudio → buildExtensions', {
    why: 'the specimen documents it renders reach the same renderer, for the same reason',
    cut: [['figureLabelLayout', 'buildExtensions'], ['quizRichText', 'buildExtensions'], ['migration', 'buildExtensions']],
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
        for (const [edgeFrom, edgeTo] of acknowledged.cut) {
          if (!chunksNamed(remaining, edgeFrom).some((file) => hasDirectEdge(remaining, file, edgeTo))) {
            fail(
              `${key} records the edge ${edgeFrom} → ${edgeTo} as its reason, but that edge no longer exists. ` +
              `Delete it — the list only shrinks. (${acknowledged.why})`,
            );
            continue;
          }
          remaining = withoutEdge(remaining, edgeFrom, edgeTo);
        }
        const beyond = findPath(remaining, matches[0], vendor);
        if (beyond) {
          fail(
            `${key} reaches the vendor through something the record does not name:\n` +
            `         ${beyond.join(' → ')}\n` +
            `       recorded: ${acknowledged.cut.map(([a, b]) => `${a} → ${b}`).join(', ')} (${acknowledged.why})\n` +
            '       An acknowledgement covers the dependency that was reviewed, not the page/vendor pair for ever. ' +
            'Remove the new dependency, or record the edge it arrives on with the reason it is acceptable.',
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
