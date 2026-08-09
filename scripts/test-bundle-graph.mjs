#!/usr/bin/env node
/**
 * Tests for scripts/lib/bundleGraph.mjs — the reachability the bundle-weight
 * check is built on.
 *
 * These matter more than the usual unit test, because every way this can be
 * wrong is SILENT. A walk that stops one hop short, or a pattern that stops
 * matching Rollup's output, makes `check:bundle-edges` report a clean bundle
 * rather than an error — and a guard that always passes is indistinguishable
 * from a codebase with nothing to find. So the multi-hop case below is not a
 * completeness exercise: it is the exact shape the check exists for, and the
 * exact shape a direct-edge grep missed in #2172.
 *
 * Plain-node, auto-discovered by scripts/run-all-tests.mjs. It needs NO build:
 * the graph is synthetic here, which is why the logic was split out of the
 * script that reads dist/.
 *
 * Run: node scripts/test-bundle-graph.mjs
 */
import { buildGraph, chunkName, chunksNamed, findPath, hasDirectEdge, withoutEdge } from './lib/bundleGraph.mjs';

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('chunkName');
assert(chunkName('PublicShareView-BWDDTO0_.js') === 'PublicShareView', 'strips the 8-char hash');
assert(chunkName('docx-vendor-KZ2GCLmu.js') === 'docx-vendor', 'keeps hyphens inside the name');
assert(chunkName('index.js') === 'index', 'tolerates an unhashed name');

console.log('\nbuildGraph — which edges count');
{
  const graph = buildGraph({
    'a.js': 'import{x}from"./b.js";import"./c.js";const p=import("./lazy.js");',
    'b.js': 'export const x=1',
    'c.js': 'export const y=2',
    'lazy.js': 'export const z=3',
  });
  const edges = graph.get('a.js');
  assert(edges.has('b.js'), 'a named import is a static edge');
  assert(edges.has('c.js'), 'a BARE import is a static edge — this is the evaluation-order form Rollup emits');
  assert(!edges.has('lazy.js'), 'import(...) is NOT an edge: a lazily-reached chunk is not downloaded with the page');
}
{
  // Unminified output, where the same statements carry whitespace.
  const graph = buildGraph({ 'a.js': 'import { x } from "./b.js"\nimport "./c.js"\n' });
  assert(graph.get('a.js').has('b.js') && graph.get('a.js').has('c.js'), 'spacing does not hide an edge');
}

console.log('\nfindPath — the multi-hop case the check exists for');
{
  // The real shape from #2172, renamed: the page reaches the vendor only
  // through an intermediate chunk, so a direct-edge check reports it clean.
  const graph = buildGraph({
    'Page-11111111.js': 'import{a}from"./barrel-22222222.js"',
    'barrel-22222222.js': 'import{b}from"./exporter-33333333.js"',
    'exporter-33333333.js': 'import{c}from"./heavy-vendor-44444444.js"',
    'heavy-vendor-44444444.js': 'export const c=1',
  });
  const path = findPath(graph, 'Page-11111111.js', 'heavy-vendor');
  assert(path !== null, 'a THREE-hop path is found — the case a direct grep misses');
  assert(
    path && path.join(' → ') === 'Page → barrel → exporter → heavy-vendor',
    'the path names every hop, so the message points at the import to change',
  );
  assert(findPath(graph, 'Page-11111111.js', 'not-bundled') === null, 'an unreachable vendor is null, not a false positive');
  assert(findPath(graph, 'absent.js', 'heavy-vendor') === null, 'an unknown starting file is null rather than a throw');
}
{
  // Shortest-path, so a failure message sends the reader to the right import.
  const graph = buildGraph({
    'P-11111111.js': 'import"./short-22222222.js";import"./long-33333333.js"',
    'short-22222222.js': 'import"./heavy-vendor-44444444.js"',
    'long-33333333.js': 'import"./mid-55555555.js"',
    'mid-55555555.js': 'import"./heavy-vendor-44444444.js"',
    'heavy-vendor-44444444.js': 'export const c=1',
  });
  const path = findPath(graph, 'P-11111111.js', 'heavy-vendor');
  assert(path.length === 3, 'breadth-first: the SHORTEST path is reported, not whichever was walked first');
}
{
  // A cycle must not hang the walk. Rollup does emit these.
  const graph = buildGraph({
    'A-11111111.js': 'import"./B-22222222.js"',
    'B-22222222.js': 'import"./A-11111111.js"',
  });
  assert(findPath(graph, 'A-11111111.js', 'nothing') === null, 'a cycle terminates instead of looping forever');
}

console.log('\nchunksNamed — a declared name that matches nothing must be visible');
{
  const graph = buildGraph({ 'Page-11111111.js': '', 'Page-22222222.js': '', 'Other-33333333.js': '' });
  assert(chunksNamed(graph, 'Other').length === 1, 'one match is one match');
  assert(chunksNamed(graph, 'Page').length === 2, 'two chunks sharing a name are BOTH returned, so the caller can refuse the ambiguity');
  assert(chunksNamed(graph, 'Renamed').length === 0, 'a name matching nothing returns empty — the caller turns that into a failure');
}

{
  // The shape the `cut` acknowledgement rests on: one page, two routes into the
  // heavy chunk that mean the same thing, and a THIRD that does not. Cutting the
  // two recorded edges must leave the third visible.
  const graph = buildGraph({
    'Page-11111111.js': 'import"./Renderer-22222222.js";import"./Editor-55555555.js"',
    'Renderer-22222222.js': 'import"./heavy-44444444.js";import"./RichText-33333333.js"',
    'RichText-33333333.js': 'import"./heavy-44444444.js"',
    'Editor-55555555.js': 'import"./heavy-44444444.js"',
    'heavy-44444444.js': 'export const c=1',
  });
  let g = withoutEdge(graph, 'Renderer', 'heavy');
  g = withoutEdge(g, 'RichText', 'heavy');
  const left = findPath(g, 'Page-11111111.js', 'heavy');
  assert(left !== null && left.includes('Editor'),
    'cutting the two acknowledged renderer edges leaves the unreviewed third route reachable, and names it');
  assert(findPath(withoutEdge(g, 'Editor', 'heavy'), 'Page-11111111.js', 'heavy') === null,
    'cutting all three leaves nothing — which is what a complete record looks like');
}

console.log('\nwithoutEdge + hasDirectEdge — scoping an acknowledged violation to what was reviewed');
{
  // A page reaching a heavy chunk through TWO of its own dependencies. Recording
  // only one and calling the pair acknowledged is the hole this pair closes.
  const graph = buildGraph({
    'Page-11111111.js': 'import"./ViewA-22222222.js";import"./ViewB-33333333.js"',
    'ViewA-22222222.js': 'import"./heavy-44444444.js"',
    'ViewB-33333333.js': 'import"./heavy-44444444.js"',
    'heavy-44444444.js': 'export const c=1',
  });
  assert(hasDirectEdge(graph, 'Page-11111111.js', 'ViewA'), 'a real page dependency is reported as one');
  assert(!hasDirectEdge(graph, 'Page-11111111.js', 'heavy'), 'a chunk reached only transitively is NOT a direct edge');
  assert(!hasDirectEdge(graph, 'Page-11111111.js', 'Missing'), 'a name matching no edge is not a direct edge');

  const cutOne = withoutEdge(graph, 'Page', 'ViewA');
  assert(findPath(cutOne, 'Page-11111111.js', 'heavy') !== null,
    'cutting ONE of two dependencies leaves the heavy chunk reachable — which is the unreviewed second route surfacing');
  const cutBoth = withoutEdge(cutOne, 'Page', 'ViewB');
  assert(findPath(cutBoth, 'Page-11111111.js', 'heavy') === null,
    'cutting every recorded dependency leaves it unreachable, which is what makes the record complete');
  assert(findPath(graph, 'Page-11111111.js', 'heavy') !== null,
    'the input graph is never mutated — the next page still needs it');
}
{
  // Parallel edges: two chunks share a name, and cutting must remove BOTH or the
  // leftover half reads as a second route that nobody added.
  const graph = buildGraph({
    'Page-11111111.js': 'import"./View-22222222.js";import"./View-33333333.js"',
    'View-22222222.js': 'import"./heavy-44444444.js"',
    'View-33333333.js': 'import"./heavy-44444444.js"',
    'heavy-44444444.js': 'export const c=1',
  });
  assert(findPath(withoutEdge(graph, 'Page', 'View'), 'Page-11111111.js', 'heavy') === null,
    'every parallel edge between the two names is cut, not just the first');
}
{
  const graph = buildGraph({ 'A-11111111.js': 'import"./B-22222222.js"', 'B-22222222.js': '' });
  assert(withoutEdge(graph, 'Nope', 'B').get('A-11111111.js').size === 1, 'cutting an edge that does not exist changes nothing');
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nok: bundle import-graph reachability');
