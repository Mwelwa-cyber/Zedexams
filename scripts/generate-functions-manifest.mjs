/**
 * (Re)generate `scripts/functions-manifest.json` — Phase 5's frozen-surface
 * manifest — from the live `functions/index.js` and `firebase.json`.
 *
 *   node scripts/generate-functions-manifest.mjs
 *
 * Frozen fields (kind, options, target, rewrite path) are always taken from
 * the SOURCE — the manifest records reality, and the drift guard
 * (`test:functions-manifest`) is what makes changing reality require touching
 * the manifest in the same PR. The two HAND-OWNED fields — `classification`
 * and `batch` — are preserved across regeneration when present, and seeded by
 * rule when absent, so a new export arrives classified-by-rule and the guard
 * forces a human to confirm it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractExports, extractRewrites, seedClassification, RISK_RANK, resolveExport, createModuleReader } from './lib/functionsManifest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readFunctionsModule = createModuleReader(path.join(ROOT, 'functions'))
const OUT = path.join(ROOT, 'scripts', 'functions-manifest.json')

const indexSource = readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8')
const entries = extractExports(indexSource)
const rewrites = extractRewrites(readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'))
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).exports : {}

// Extraction batches, risk-ascending (docs/phase5-plan.md): 1 = mechanical
// inline, 2 = secrets-bound inline, 3 = payment/webhook + audit-surface
// inline (last, and only with external review coverage restored). Non-inline
// entries have no extraction batch — they are already modular.
const BATCH_FOR = { mechanical: 1, 'secrets-bound': 2, 'payment-webhook': 3, 'audit-surface': 3 }

const manifest = {}
for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  const rewriteEntry = Object.entries(rewrites).find(([, r]) => r.functionId === e.name)
  const rewritePath = rewriteEntry?.[0] ?? null
  const rewriteRegion = rewriteEntry?.[1].region ?? null
  const prev = previous[e.name] ?? {}
  // FOLLOW FIRST, CLASSIFY SECOND. A delegated export's real wrapper lives in
  // its module — follow it, so the guard freezes 201 surfaces rather than the
  // 44 declared in index.js (Codex P1 on #2194). Unfollowable ones say so;
  // they never read as empty.
  //
  // The order is the whole point: classifying before the follow handed the
  // rule an empty options map and the literal kind `delegated`, so a module
  // that binds secrets or serves HTTP seeded `mechanical` unless its NAME gave
  // it away. Two of the three classification rules were reading a blank.
  const resolved = resolveExport(e, indexSource, readFunctionsModule)
  const seed = seedClassification(e, rewrites, resolved)
  // Regeneration may ESCALATE a stale hand classification to the rule seed
  // (the floor), never lower one below it.
  const classification = RISK_RANK[prev.classification] >= RISK_RANK[seed] ? prev.classification : seed
  manifest[e.name] = {
    kind: e.kind,
    inline: e.inline,
    options: resolved.options,
    optionsFrom: resolved.optionsFrom,
    optionsUnresolved: resolved.optionsUnresolved,
    // Written only when TRUE, and only for an export whose options were read
    // outside index.js: it is the positive statement "this builder declares no
    // options object", which is a different fact from "nothing was recorded".
    // `resolvePaperAssetUrl` is the whole reason it exists — `onCall(handler)`
    // with no options at all, indistinguishable from a failed read without it.
    ...(resolved.noOptionsDeclared ? { noOptionsDeclared: true } : {}),
    target: e.target,
    rewritePath,
    rewriteRegion,
    classification,
    // An extracted handler leaves the batch plan: regeneration must emit a
    // manifest the validator accepts, not one every extraction PR hand-edits
    // (Codex P2 on #2194).
    batch: e.inline ? (prev.batch ?? BATCH_FOR[classification]) : null,
  }
}

writeFileSync(OUT, JSON.stringify({
  _comment: 'Phase 5 frozen-surface manifest. Regenerate with scripts/generate-functions-manifest.mjs; classification and batch are hand-owned and survive regeneration. Guarded by test:functions-manifest.',
  generatedFrom: 'functions/index.js + firebase.json',
  exports: manifest,
}, null, 2) + '\n')

const counts = {}
for (const e of Object.values(manifest)) {
  const key = `${e.classification}${e.inline ? '' : ' (modular)'}`
  counts[key] = (counts[key] ?? 0) + 1
}
console.log(`wrote ${Object.keys(manifest).length} exports`)
console.log(counts)
