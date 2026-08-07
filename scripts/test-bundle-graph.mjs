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
import { buildGraph, chunkName, chunksNamed, findPath } from './lib/bundleGraph.mjs';

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

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nok: bundle import-graph reachability');
