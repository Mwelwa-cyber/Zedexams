/**
 * Phase 5's drift guard: the frozen surface of `functions/index.js` may not
 * move without the manifest moving in the same PR.
 *
 * architecture.md § Phase 5 freezes export names, trigger/callable kinds,
 * regions, secrets bindings, and Hosting rewrite paths for the duration of the
 * restructure. This test compares the LIVE table (extracted from source) to
 * `scripts/functions-manifest.json` — semantically, not textually: reindenting
 * an options object, reordering keys, or rewording a comment changes nothing;
 * a region, secret, schedule, timeout, memory or App Check option changing
 * value fails with the field named.
 *
 * A batch PR that intends a change updates the manifest alongside the source
 * (`node scripts/generate-functions-manifest.mjs`) — the diff then SHOWS the
 * frozen-surface change to the reviewer instead of burying it in a move.
 *
 * Run: node scripts/test-functions-manifest.mjs  (test:functions-manifest)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractExports, extractRewrites, classify, RISK_RANK, followDelegation } from './lib/functionsManifest.mjs'

function readFunctionsModule(rel) {
  const base = path.join(ROOT, 'functions', rel.replace(/^\.\//, ''))
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    try { return readFileSync(candidate, 'utf8') } catch { /* next */ }
  }
  return null
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'functions-manifest.json'), 'utf8')).exports
const indexSource = readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8')
const live = extractExports(indexSource)
const rewrites = extractRewrites(readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'))

const CLASSES = ['mechanical', 'secrets-bound', 'payment-webhook', 'audit-surface']
const BATCH_BAND = { mechanical: [1], 'secrets-bound': [2], 'payment-webhook': [3], 'audit-surface': [3] }

console.log('Phase 5 — the frozen surface holds')

test('the extractor is not blind', () => {
  // A parser that silently matched nothing would make every other test here
  // pass by inspecting nothing.
  assert.ok(live.length > 150, `only ${live.length} exports extracted`)
  const kinds = new Set(live.map((e) => e.kind))
  for (const k of ['onCall', 'onRequest', 'factory', 'delegated']) {
    assert.ok(kinds.has(k), `no ${k} entries extracted — the parser has gone blind to them`)
  }
})

test('every live export is in the manifest, and nothing in the manifest is dead', () => {
  const liveNames = new Set(live.map((e) => e.name))
  const missing = [...liveNames].filter((n) => !manifest[n])
  const stale = Object.keys(manifest).filter((n) => !liveNames.has(n))
  assert.deepEqual(missing, [],
    `new exports without a manifest entry (run generate-functions-manifest and CLASSIFY them):\n    ${missing.join('\n    ')}`)
  assert.deepEqual(stale, [],
    `manifest entries with no live export (removed? renamed? — the manifest must say so):\n    ${stale.join('\n    ')}`)
})

test('no frozen field has moved without the manifest moving with it', () => {
  const drifts = []
  for (const e of live) {
    const m = manifest[e.name]
    if (!m) continue
    if (m.kind !== e.kind) drifts.push(`${e.name}: kind ${m.kind} → ${e.kind}`)
    if (m.inline !== e.inline) drifts.push(`${e.name}: inline ${m.inline} → ${e.inline}`)
    if ((m.target ?? null) !== (e.target ?? null)) drifts.push(`${e.name}: target changed`)
    // Options here are index.js's, so this compares them only where index.js
    // DECLARES them. A delegated export's options live in its module and are
    // compared by the followed-delegation test below, against the module.
    if (!e.inline) continue
    const keys = new Set([...Object.keys(m.options), ...Object.keys(e.options)])
    for (const k of keys) {
      if ((m.options[k] ?? null) !== (e.options[k] ?? null)) {
        drifts.push(`${e.name}: option ${k}: ${JSON.stringify(m.options[k] ?? null)} → ${JSON.stringify(e.options[k] ?? null)}`)
      }
    }
  }
  assert.deepEqual(drifts, [],
    `the frozen surface moved without a manifest update:\n    ${drifts.join('\n    ')}`)
})

test('every Hosting rewrite resolves to a manifested function, and paths match', () => {
  const drifts = []
  for (const [pathSpec, r] of Object.entries(rewrites)) {
    const fn = r.functionId
    if (!manifest[fn]) { drifts.push(`rewrite ${pathSpec} → ${fn}: no manifest entry`); continue }
    if (manifest[fn].rewritePath !== pathSpec) drifts.push(`${fn}: rewritePath ${manifest[fn].rewritePath} → ${pathSpec}`)
    // The rewrite's region is routing-critical (Codex P1 on #2194): Hosting
    // routing to a different regional function is a frozen-surface change.
    if ((manifest[fn].rewriteRegion ?? null) !== (r.region ?? null)) {
      drifts.push(`${fn}: rewriteRegion ${manifest[fn].rewriteRegion} → ${r.region}`)
    }
  }
  for (const [name, m] of Object.entries(manifest)) {
    if (m.rewritePath && rewrites[m.rewritePath]?.functionId !== name) {
      drifts.push(`${name}: manifest claims rewrite ${m.rewritePath} but firebase.json disagrees`)
    }
  }
  assert.deepEqual(drifts, [], `rewrite surface drifted:\n    ${drifts.join('\n    ')}`)
})

test('every entry is classified, and inline batches stay risk-ascending', () => {
  const problems = []
  for (const [name, m] of Object.entries(manifest)) {
    if (!CLASSES.includes(m.classification)) problems.push(`${name}: classification "${m.classification}"`)
    if (m.inline) {
      const band = BATCH_BAND[m.classification] ?? []
      if (!band.includes(m.batch)) problems.push(`${name}: ${m.classification} in batch ${m.batch} (allowed: ${band})`)
    } else if (m.batch !== null) {
      problems.push(`${name}: not inline but carries extraction batch ${m.batch}`)
    }
  }
  assert.deepEqual(problems, [], `classification/batch problems:\n    ${problems.join('\n    ')}`)
})

test('the payment surface is where the plan says it is', () => {
  // The extraction order's whole point: payment/webhook handlers are batch 3,
  // last, and only with review coverage restored (docs/phase5-plan.md). A
  // reclassification that quietly moved lencoWebhook into an earlier batch is
  // exactly the drift this pins.
  for (const name of ['lencoWebhook', 'verifyGooglePlayPurchase', 'initiateLencoPayment', 'submitLencoOtp']) {
    assert.equal(manifest[name]?.classification, 'payment-webhook', `${name} must stay payment-webhook`)
    if (manifest[name]?.inline) assert.equal(manifest[name].batch, 3, `${name} must stay in the last batch`)
  }
})

test('a hand classification may raise risk, never lower it below the rule seed', () => {
  // Codex P2 on #2194: trusting the hand-owned field outright meant a stray
  // reclassification of aiChat to "mechanical" passed with its openaiApiKey
  // binding intact. The rule seed is the FLOOR; escalation (getUpgradeQuote
  // mechanical → payment-webhook) is legitimate, de-escalation is drift.
  const problems = []
  for (const e of live) {
    const m = manifest[e.name]
    if (!m) continue
    const seed = classify(e, rewrites)
    if (RISK_RANK[m.classification] < RISK_RANK[seed]) {
      problems.push(`${e.name}: classified ${m.classification} below its rule seed ${seed}`)
    }
  }
  assert.deepEqual(problems, [], `de-escalated classifications:\n    ${problems.join('\n    ')}`)
})

test('extraction keeps builders in index.js — the delegated set may only shrink', () => {
  // Codex P1 on #2194: a delegated/factory entry has empty options here, so
  // converting an inline builder to a bare re-export would move its region,
  // secrets and runtime options OUT of this guard's sight. The batch-1a shape
  // (body moves, builder stays) is therefore a RULE: the count of
  // guard-blind kinds is a ceiling fixed at PR-zero's 157 and may only fall.
  const blind = live.filter((e) => e.kind === 'delegated' || e.kind === 'factory').length
  assert.ok(blind <= 157,
    `${blind} delegated/factory exports (ceiling 157) — an extraction converted a builder to a re-export; move the BODY and keep the builder in index.js`)
})

test('a DELEGATED export\'s options are frozen where they actually live', () => {
  // Codex P1 on #2194: the guard read index.js only, so apiImageProxy's
  // region/timeout/memory/cors — declared in imageProxy.js — could change
  // freely. Following the delegation extends the frozen surface from the 44
  // handlers declared here to every one it can reach.
  const drifts = []
  for (const e of live) {
    if (e.kind !== 'delegated' || !e.target) continue
    const m = manifest[e.name]
    if (!m || m.optionsUnresolved) continue
    const followed = followDelegation(e.target, indexSource, readFunctionsModule)
    if (followed.unresolved) { drifts.push(`${e.name}: was followable, now ${followed.unresolved}`); continue }
    const keys = new Set([...Object.keys(m.options), ...Object.keys(followed.options)])
    for (const k of keys) {
      if ((m.options[k] ?? null) !== (followed.options[k] ?? null)) {
        drifts.push(`${e.name} (${m.optionsFrom}): option ${k}: ${JSON.stringify(m.options[k] ?? null)} → ${JSON.stringify(followed.options[k] ?? null)}`)
      }
    }
  }
  assert.deepEqual(drifts, [],
    `a delegated export's wrapper drifted in its own module:\n    ${drifts.join('\n    ')}`)
})

test('the guard\'s blind spot is measured and may only shrink', () => {
  // What the follower cannot reach is stated, counted, and ratcheted — a
  // blind spot that is written down is a work item; one that reads as "no
  // options" is a false green.
  const unresolved = Object.entries(manifest).filter(([, m]) => m.optionsUnresolved)
  assert.ok(unresolved.length <= 141,
    `${unresolved.length} exports have unguarded options (ceiling 141) — a new one appeared:\n    ${unresolved.map(([n, m]) => `${n}: ${m.optionsUnresolved}`).join('\n    ')}`)
})

console.log(`\nfunctions manifest: ${passed} passed`)
