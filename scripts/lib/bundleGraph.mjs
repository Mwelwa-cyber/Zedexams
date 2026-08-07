/**
 * The static-import graph of a built bundle, and reachability over it.
 *
 * Pure — it takes `{fileName: source}` and returns data. The module that reads
 * `dist/` is `scripts/check-bundle-edges.mjs`; this half is separated so the
 * logic can be tested under plain `node` with no build (the `*Core.js` split
 * in AI_DEVELOPMENT_GUIDE.md, applied to a script).
 *
 * ## Why reachability rather than a grep
 *
 * The rule being enforced is "this page must not download that vendor", and a
 * page downloads every chunk its STATIC imports reach, however many hops away.
 * A direct-edge grep answers a different and much weaker question. That is not
 * a hypothetical distinction: PR #2172 checked direct edges by hand, concluded
 * the flashcards front door was clean, and it was not — the path is
 * `PublicShareView → flashcards → flashcardsToPdf → docx-vendor`, three hops,
 * and the middle one is why one grep found nothing.
 *
 * DYNAMIC imports are deliberately NOT followed, and that is the whole point of
 * the distinction: `import()` is what a lazily-loaded route is made of, and a
 * chunk that is only reached dynamically is not downloaded until something asks
 * for it. Rollup emits the two differently — a static edge is
 * `from"./chunk.js"` or a bare `import"./chunk.js"` at the top of the file,
 * while a dynamic one is `import("./chunk.js")` with parentheses — so the
 * pattern below matches the static forms only.
 */

/** Strip Rollup's 8-character content hash: `Foo-a1B2c3D4.js` → `Foo`. */
export function chunkName(fileName) {
  return fileName.replace(/-[A-Za-z0-9_-]{8}\.js$/, '').replace(/\.js$/, '');
}

/**
 * `from"./x.js"` and bare `import"./x.js"`, but NOT `import("./x.js")`.
 *
 * The negative lookahead on `(` is what keeps dynamic imports out. Minified
 * output has no spaces, but unminified builds do, so whitespace is tolerated
 * everywhere it can legally appear.
 */
const STATIC_EDGE = /(?:\bfrom\s*|\bimport\s*(?!\())["']\.\/([A-Za-z0-9_.-]+\.js)["']/g;

/**
 * @param {Map<string,string>|Record<string,string>} sources fileName → code
 * @returns {Map<string, Set<string>>} fileName → statically imported fileNames
 */
export function buildGraph(sources) {
  const entries = sources instanceof Map ? [...sources] : Object.entries(sources);
  const graph = new Map();
  for (const [file, code] of entries) {
    const targets = new Set();
    for (const match of code.matchAll(STATIC_EDGE)) targets.add(match[1]);
    graph.set(file, targets);
  }
  return graph;
}

/**
 * The shortest static-import path from `fromFile` to any chunk NAMED
 * `targetName`, or null when it is unreachable.
 *
 * Breadth-first, so the path returned is the shortest one — a failure message
 * naming a 12-hop path when a 3-hop path exists sends the reader to the wrong
 * import. Returns chunk NAMES (hashes stripped) because the hash changes on
 * every content edit and a message quoting it would be unreadable in a diff.
 *
 * Edges pointing at files absent from the graph are skipped rather than
 * throwing: a bundle can legitimately reference something outside `dist/assets`.
 */
export function findPath(graph, fromFile, targetName) {
  if (!graph.has(fromFile)) return null;
  const cameFrom = new Map([[fromFile, null]]);
  const queue = [fromFile];
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) || []) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, current);
      if (chunkName(next) === targetName) {
        const path = [];
        for (let step = next; step !== null; step = cameFrom.get(step)) path.unshift(chunkName(step));
        return path;
      }
      if (graph.has(next)) queue.push(next);
    }
  }
  return null;
}

/**
 * Every file whose name matches `name`.
 *
 * Returned as a list rather than a single file so the caller can fail on BOTH
 * zero matches and more than one. Zero is the dangerous case: a declared page
 * that no longer names a chunk stops being checked, and a check that silently
 * covers nothing reads exactly like a codebase with no violations — the lesson
 * `scripts/visual/printAffectingPaths.js` records for its own path list.
 */
export function chunksNamed(graph, name) {
  return [...graph.keys()].filter((file) => chunkName(file) === name);
}
