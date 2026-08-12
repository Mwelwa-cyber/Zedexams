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
import { extractExports, extractRewrites, seedClassification, RISK_RANK, resolveExport, createModuleReader, followDelegation, followFactory } from './lib/functionsManifest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readFunctionsModule = createModuleReader(path.join(ROOT, 'functions'))

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
    // Options here are index.js's, so this compares them wherever index.js
    // DECLARES them — every builder kind, inline body or not. (Keying this on
    // `inline` unguarded every extracted handler's region the moment its body
    // moved out; found by control on batch 1a.) A delegated/factory export's
    // options live elsewhere and are compared by the tests below.
    if (e.kind === 'delegated' || e.kind === 'factory') continue
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
  //
  // The seed is computed from the RESOLVED export — the same call the manifest
  // was written with. Seeding from the raw `exports.x = mod.y` line gave the
  // rule an empty options map and the kind `delegated`, so a module binding
  // `secrets` seeded `mechanical` and this floor would then have defended
  // nothing: eight escalations (weeklyParentDigest, aiCostDailySummary,
  // opsHeartbeatCheck, …) could have been hand-edited straight back down.
  const problems = []
  for (const e of live) {
    const m = manifest[e.name]
    if (!m) continue
    const seed = seedClassification(e, rewrites, resolveExport(e, indexSource, readFunctionsModule))
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

test('a DELEGATED or FACTORY export\'s options are frozen where they actually live', () => {
  // Codex P1 on #2194: the guard read index.js only, so apiImageProxy's
  // region/timeout/memory/cors — declared in imageProxy.js — could change
  // freely. Following the delegation extends the frozen surface from the 44
  // handlers declared here to every one it can reach.
  //
  // FACTORY entries are compared here too, and that word is the whole reason
  // this test is worth re-reading. When the factory reader landed, 49 exports
  // gained a full options record in the manifest that NOTHING compared —
  // `delegated` here and `delegated || factory` skipped in the index.js
  // comparison meant every one of them could drift freely behind a populated,
  // confident-looking row. Caught by mutation (createGenerateQuiz's timeout
  // 120 -> 60, suite still green), which is the only way to catch it: reading
  // the manifest tells you the data is there, not that anyone checks it.
  const drifts = []
  for (const e of live) {
    if ((e.kind !== 'delegated' && e.kind !== 'factory') || !e.target) continue
    const m = manifest[e.name]
    if (!m || m.optionsUnresolved) continue
    const followed = resolveExport(e, indexSource, readFunctionsModule)
    if (followed.optionsUnresolved) { drifts.push(`${e.name}: was followable, now ${followed.optionsUnresolved}`); continue }
    if ((m.optionsFrom ?? null) !== (followed.optionsFrom ?? null)) {
      // Where the options live is part of what is frozen: the same option
      // values read out of a DIFFERENT module means the export was rebound.
      drifts.push(`${e.name}: optionsFrom ${m.optionsFrom} → ${followed.optionsFrom}`)
    }
    const keys = new Set([...Object.keys(m.options), ...Object.keys(followed.options)])
    for (const k of keys) {
      if ((m.options[k] ?? null) !== (followed.options[k] ?? null)) {
        drifts.push(`${e.name} (${m.optionsFrom}): option ${k}: ${JSON.stringify(m.options[k] ?? null)} → ${JSON.stringify(followed.options[k] ?? null)}`)
      }
    }
  }
  assert.deepEqual(drifts, [],
    `a delegated/factory export's wrapper drifted where it is defined:\n    ${drifts.join('\n    ')}`)
})

test('an EXTRACTED handler keeps its options guarded in index.js', () => {
  // Batch 1a's shape — body moves to a module, builder and options stay here —
  // only preserves the frozen surface if the guard still reads those options.
  // A control caught it not doing so: the seven passkey callables went
  // `inline: false` and dropped out of the comparison entirely. This pins the
  // property directly: a non-inline BUILDER still declares options here, and
  // the manifest must record where they came from.
  const extracted = live.filter((e) => !e.inline && e.kind !== 'delegated' && e.kind !== 'factory')
  for (const e of extracted) {
    const m = manifest[e.name]
    assert.ok(m, `${e.name} manifested`)
    assert.equal(m.optionsFrom, 'index.js',
      `${e.name} is a builder in index.js — its options must be recorded as coming from here, not ${m.optionsFrom}`)
    assert.ok(Object.keys(m.options).length > 0 || Object.keys(e.options).length === 0,
      `${e.name} declares options in index.js that the manifest did not record`)
  }
})

test('a RESOLVED export never records nothing — no false greens', () => {
  // The failure this pins is worse than an unreadable export, because it does
  // not look like one: `optionsUnresolved: null` with `options: {}` reads as
  // "followed successfully, this function declares no options", and the guard
  // then defends an empty set forever.
  //
  // Two source shapes produced it, both live on main before #2262:
  //   • `onSchedule(HOURLY_MONITOR_OPTS, …)` — the options are an identifier.
  //     18 exports, `agents/cron.js` alone accounting for eleven, several
  //     binding eight secrets apiece. Recorded as {}.
  //   • `{document: "quizzes/{quizId}", ...COMMON_OPTS}` — a spread has no
  //     `:`, so the parser committed nothing for it and onQuizWritten's
  //     `africa-south1` pin vanished, leaving only the document path.
  //
  // A Firestore trigger's region is the one option CLAUDE.md calls
  // routing-critical: wrong, and every event takes a cross-region Eventarc hop.
  const problems = []
  for (const [name, m] of Object.entries(manifest)) {
    if (m.optionsUnresolved) continue
    if (Object.keys(m.options).length === 0 && m.kind !== 'authTrigger') {
      // A builder that genuinely takes no options object is possible; one
      // reached by FOLLOWING and recording nothing is the bug. index.js's own
      // declarations are visible in review, a module's are not.
      if (m.optionsFrom && m.optionsFrom !== 'index.js' && !m.noOptionsDeclared) {
        problems.push(`${name}: followed into ${m.optionsFrom} and recorded NO options — resolved-but-empty is a false green, not a clean read. If the builder genuinely takes no options object, the reader must SAY so (noOptionsDeclared), not leave it to be inferred from an empty map.`)
      }
      continue
    }
    for (const key of Object.keys(m.options)) {
      if (key.startsWith('...')) {
        problems.push(`${name}: options carry an unexpanded spread ${key} — whatever it holds is unguarded`)
      }
    }
  }
  assert.deepEqual(problems, [], `false greens in the manifest:\n    ${problems.join('\n    ')}`)
})

test('"declares no options" and "recorded nothing" are different answers', () => {
  // resolvePaperAssetUrl is `onCall(async (request) => {…})` — no options
  // object at all. That is a real answer, and without a way to say it, an
  // empty options map is indistinguishable from a failed read. The rule above
  // would then have to permit every empty map, which is the false green it
  // exists to forbid.
  const reader = (source) => () => ({ source, dir: '.' })
  const index = 'const {createThing} = require("./mod");\nexports.thing = createThing();\n'

  const bare = followFactory('createThing()', index, reader(
    'function createThing() {\n  return onCall(async (r) => r)\n}\n'))
  assert.equal(bare.unresolved, undefined)
  assert.deepEqual(bare.options, {})
  assert.equal(bare.noOptions, true, 'a builder with no options argument must say so positively')

  const withOpts = followFactory('createThing()', index, reader(
    'function createThing() {\n  return onCall({timeoutSeconds: 30}, async (r) => r)\n}\n'))
  assert.equal(withOpts.noOptions, false, 'a builder that DOES declare options must not claim it declares none')
  assert.equal(withOpts.options.timeoutSeconds, '30')
})

test('options the follower cannot read are reported UNRESOLVED, never as empty', () => {
  // A direct control on the rule above, so it cannot pass by accident of the
  // current tree: a module whose builder takes an identifier that is not a
  // const object must come back unresolved, and the same module WITH that const
  // must come back with its contents.
  const withConst = `
    const OPTS = {region: "africa-south1", memory: "256MiB"};
    exports.thing = onSchedule(OPTS, async () => {});
  `
  const withoutConst = `
    exports.thing = onSchedule(OPTS_FROM_SOMEWHERE_ELSE, async () => {});
  `
  const reader = (source) => () => ({ source, dir: '.' })
  const index = 'const mod = require("./mod");\nexports.thing = mod.thing;\n'

  const good = followDelegation('mod.thing', index, reader(withConst))
  assert.equal(good.unresolved, undefined, 'a resolvable const options object must resolve')
  assert.equal(good.options.region, '"africa-south1"')
  assert.equal(good.options.memory, '"256MiB"')

  const bad = followDelegation('mod.thing', index, reader(withoutConst))
  assert.ok(bad.unresolved, 'an unresolvable identifier must be reported, not flattened to {}')
  assert.match(bad.unresolved, /OPTS_FROM_SOMEWHERE_ELSE/,
    'the report must name the identifier, so the baseline row is a work item')
  assert.equal(bad.options, undefined, 'an unresolved read must not hand back an options map at all')
})

test('a factory is read from its ONE builder, and ambiguity is refused', () => {
  // Direct control, independent of the current tree. The refusal half matters
  // most: picking the first of several builder calls would produce a populated,
  // plausible options row for the wrong function — and a wrong answer that
  // looks like a right one is worse than the blind spot it replaced.
  const oneBuilder = `
    function createThing(secret) {
      return onCall({secrets: [secret], timeoutSeconds: 90, memory: "512MiB"}, async () => {});
    }
    module.exports = {createThing};
  `
  const twoBuilders = `
    function createThing(secret) {
      const other = onCall({region: "europe-west1"}, async () => {});
      return onCall({secrets: [secret]}, async () => {});
    }
  `
  const reader = (source) => () => ({ source, dir: '.' })
  const index = 'const {createThing} = require("./mod");\nexports.thing = createThing(someSecret);\n'

  const good = followFactory('createThing(someSecret)', index, reader(oneBuilder))
  assert.equal(good.unresolved, undefined, 'a factory with one builder must resolve')
  assert.equal(good.kind, 'onCall', 'the builder kind comes from the factory body, not the export line')
  assert.equal(good.options.timeoutSeconds, '90')
  assert.equal(good.options.secrets, '[secret]',
    'the factory PARAMETER is what the factory declares — the argument is frozen separately, in `target`')

  const ambiguous = followFactory('createThing(someSecret)', index, reader(twoBuilders))
  assert.ok(ambiguous.unresolved, 'two builders in one factory must not be guessed between')
  assert.match(ambiguous.unresolved, /2 builder calls/)
  assert.equal(ambiguous.options, undefined, 'a refused read must not hand back an options map')

  // A comment between the builder and its options must not hide them —
  // createGenerateSlideNotes writes one there, and trimming whitespace alone
  // left the reader looking at "//" and returning {}.
  const commented = `
    function createThing(secret) {
      return onCall(
        // why this is 300
        {secrets: [secret], timeoutSeconds: 300},
        async () => {});
    }
  `
  const past = followFactory('createThing(someSecret)', index, reader(commented))
  assert.equal(past.unresolved, undefined, 'a comment before the options object must be stepped over')
  assert.equal(past.options.timeoutSeconds, '300')
})

test('a MODULE-LOCAL factory binds its arguments, because nothing else freezes them', () => {
  // `onQuizQuestionDeleted: makeDeletedTrigger("quizzes/{quizId}/questions/{questionId}")`
  // in storageCleanup/onQuestionChange.js. The difference from an index.js
  // factory is the whole reason arguments are substituted here and not there:
  // index.js's call site is frozen verbatim in `target`, this one is inside
  // the module and `target` records only `storageCleanup.onQuizQuestionDeleted`.
  // Leave `document: documentPath` as the parameter name and the collection a
  // Firestore trigger fires on is frozen NOWHERE.
  const mod = `
    const COMMON = {region: "africa-south1", timeoutSeconds: 60}
    function makeDeletedTrigger(documentPath) {
      return onDocumentDeleted({document: documentPath, ...COMMON}, async (e) => {})
    }
    module.exports = {
      onThingDeleted: makeDeletedTrigger("quizzes/{quizId}/questions/{questionId}"),
    }
  `
  const index = 'const storage = require("./mod");\nexports.onThingDeleted = storage.onThingDeleted;\n'
  const got = followDelegation('storage.onThingDeleted', index, () => ({ source: mod, dir: '.' }))
  assert.equal(got.unresolved, undefined)
  assert.equal(got.options.document, '"quizzes/{quizId}/questions/{questionId}"',
    'the ARGUMENT must reach the manifest — the parameter name freezes nothing')
  assert.equal(got.options.region, '"africa-south1"', 'the shared options const must still expand')

  // A parameter with no matching argument is left as its name, never guessed at.
  const short = `
    function make(a, b) { return onDocumentDeleted({document: a, extra: b}, h) }
    module.exports = {onThingDeleted: make("only/one")}
  `
  const partial = followDelegation('storage.onThingDeleted', index, () => ({ source: short, dir: '.' }))
  assert.equal(partial.options.document, '"only/one"')
  assert.equal(partial.options.extra, 'b', 'an unmatched parameter keeps its name')
})

test('a v1 CHAINED builder is read across the chain, event included', () => {
  // `functions.region("us-central1").runWith({…}).auth.user().onDelete(…)` —
  // onUserDeleted, the last export the follower could not read at all. Its
  // surface is spread across the chain rather than gathered in one object, and
  // the EVENT is the whole meaning of the trigger: onCreate vs onDelete is the
  // difference between a cleanup hook and a provisioning hook.
  const mod = `
    const onUserDeleted = functions
      .region("us-central1")
      .runWith({timeoutSeconds: 300, memory: "256MB"})
      .auth.user()
      .onDelete(async (user) => {})
    module.exports = {onUserDeleted}
  `
  const index = 'const storage = require("./mod");\nexports.onUserDeleted = storage.onUserDeleted;\n'
  const got = followDelegation('storage.onUserDeleted', index, () => ({ source: mod, dir: '.' }))
  assert.equal(got.unresolved, undefined)
  assert.equal(got.options.region, '"us-central1"')
  assert.equal(got.options.timeoutSeconds, '300')
  assert.equal(got.options.memory, '"256MB"')
  assert.equal(got.options.event, 'functions.auth.user().onDelete',
    'canonicalised to the spelling extractExports produces for index.js v1 triggers, so the same trigger written either way compares alike')
  assert.equal(got.kind, 'authTrigger')

  // The chain is written one call per line in the real file. A pattern that
  // allows no whitespace between segments matches nothing on the only file it
  // has to read — which is how this first came back "names no event".
  const oneLine = 'const x = functions.region("us-central1").auth.user().onCreate(h)\nmodule.exports = {x}\n'
  const flat = followDelegation('storage.x', 'const storage = require("./mod");\nexports.x = storage.x;\n',
    () => ({ source: oneLine, dir: '.' }))
  assert.equal(flat.options.event, 'functions.auth.user().onCreate')
})

test('an option VALUE that is an identifier resolves — unless resolving would be a guess', () => {
  // The region hole. 17 exports recorded `region: REGION` and 4 recorded
  // `region: PASSKEY_REGIONAL_REGION`: swapping which const an option read was
  // caught, changing what the const HELD was not. One edit to one string could
  // have moved 17 functions out of their region with the guard silent, and a
  // Firestore trigger in the wrong region takes a cross-region Eventarc hop on
  // every event.
  //
  // The refusals matter as much as the resolutions. A confidently wrong value
  // is worse than a vague one, so anything the reader cannot be sure of keeps
  // the bare token.
  const reader = (source) => () => ({ source, dir: '.' })
  const index = 'const {createThing} = require("./mod");\nexports.thing = createThing();\n'
  const optionsOf = (body) => followFactory('createThing()', index, reader(body)).options

  assert.equal(
    optionsOf('const REGION = "us-central1"\nfunction createThing() { return onCall({region: REGION}, h) }\n').region,
    '"us-central1"', 'a const string must resolve to its value')

  assert.equal(
    optionsOf('const A = "x"\nfunction f() { const A = "y" }\nfunction createThing() { return onCall({region: A}, h) }\n').region,
    'A', 'two declarations of one name are scopes this cannot tell apart — refuse')

  assert.equal(
    optionsOf('let R = "a"\nfunction createThing() { return onCall({region: R}, h) }\n').region,
    'R', 'only const is safe to read')

  assert.equal(
    optionsOf('const s = [a]\ns.push(b)\nfunction createThing() { return onCall({secrets: s}, h) }\n').secrets,
    's', 'a mutated binding must not be reported as its initializer — that is a confidently wrong answer')

  assert.equal(
    optionsOf('function createThing(secrets = []) { return onCall({secrets}, h) }\n').secrets,
    'secrets', 'a factory PARAMETER is not a declaration; its value is frozen at the call site in `target`')

  // Cross-module, one hop — and keyed on module+name, because a binding
  // imported under its own name is not a cycle. Keying on the name alone made
  // this return the bare token, which is indistinguishable from never trying.
  const importer = 'const {R} = require("./regions");\nfunction createThing() { return onCall({region: R}, h) }\n'
  const readTwo = (spec) => spec.includes('regions')
    ? { source: 'const R = "africa-south1"\nmodule.exports = {R}\n', dir: '.' }
    : { source: importer, dir: '.' }
  const crossed = followFactory('createThing()', importer, readTwo)
  assert.equal(crossed.options.region, '"africa-south1"', 'an imported const must resolve across the hop')
})

// A region passed to a factory as a PARAMETER is frozen at the call site in
// `target`, not in the options map, so it legitimately stays a token. There
// are none today; the list exists so the rule below is satisfiable without
// being weakened, and each entry has to say which export and why.
const REGION_BY_PARAMETER = {}

test('no export\'s region is left as the NAME of a const', () => {
  // Region is the first thing architecture.md § Phase 5 freezes, and the one
  // CLAUDE.md calls routing-critical: a Firestore trigger outside
  // africa-south1 takes a cross-region Eventarc hop on every event. 21 rows
  // recorded `region: REGION` / `region: PASSKEY_REGIONAL_REGION`, so a single
  // edit to a single string could have moved 17 functions with the guard
  // silent — it was watching which const was read, not what it held.
  //
  // Kept as a standing rule rather than a one-off cleanup: the next factory
  // that reaches for a const is caught on the PR that adds it.
  const problems = []
  for (const [name, m] of Object.entries(manifest)) {
    const region = m.options?.region
    if (!region || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(region)) continue
    if (name in REGION_BY_PARAMETER) continue
    problems.push(
      `${name}: region is the identifier ${region}, not a value. Declare it as ` +
      `a module-level const the reader can follow, or — if it is a factory ` +
      `PARAMETER, frozen at the call site in \`target\` — add ${name} to ` +
      `REGION_BY_PARAMETER with the reason.`)
  }
  assert.deepEqual(problems, [], `unresolved regions:\n    ${problems.join('\n    ')}`)
})

test('the follower refuses a specifier that escapes functions/', () => {
  // github-actions security review on #2197: the follower reads what a
  // require() specifier names, so a traversal like ../../../.env.production
  // would have had this script parse a credentials file. Refused, and refused
  // in a way a test can see.
  for (const escape of ['../../secrets', '../../../.env.production', '/etc/passwd']) {
    assert.equal(readFunctionsModule(escape), null, `${escape} must not be readable`)
  }
  // …while a legitimate sibling module still resolves.
  assert.ok(readFunctionsModule('./imageProxy'), './imageProxy must still resolve')
})

test('the guard\'s blind spot is ratcheted BY NAME, not by count', () => {
  // What the follower cannot reach is stated, named, and ratcheted — a blind
  // spot that is written down is a work item; one that reads as "no options"
  // is a false green.
  //
  // This used to assert `unresolved.length <= 141`, which cannot see a SWAP:
  // resolve ten entries, add ten new ones, and the count is still 141 while
  // the set has completely changed. A count also drifts loose on its own — by
  // the time this was replaced, main had fallen to 132, so the 141 ceiling was
  // silently permitting NINE new blind exports before it would fail.
  //
  // The baseline is therefore the NAMES (scripts/functions-unresolved-baseline.json),
  // and it is shrink-only in both directions, per the repo's other debt lists:
  // a new name fails, and an entry that no longer applies must be deleted from
  // the file in the same PR — so the list cannot quietly keep stale rows and
  // read as bigger work than it is.
  const baseline = JSON.parse(
    readFileSync(path.join(ROOT, 'scripts', 'functions-unresolved-baseline.json'), 'utf8'),
  ).unresolved
  // NOT named `live` — that is the file-scope source-derived export list, and
  // shadowing it is what made the first version answer "does this export still
  // exist?" from manifest membership instead of from the source (Codex on
  // #2246). The manifest is a record; index.js is the fact.
  const unresolvedNames = Object.entries(manifest)
    .filter(([, m]) => m.optionsUnresolved)
    .map(([n]) => n)
  const exportedNames = new Set(live.map((e) => e.name))

  // ONE assertion, with each row carrying its own reason.
  //
  // Splitting this into two assertions was worse than the single vague one it
  // replaced: assert.deepEqual throws on the first, so a baseline holding both
  // a resolved row and a retired row reported only the resolved one, and the
  // maintainer fixed it, re-ran, and met the second (Codex on #2246). Accuracy
  // of the message and completeness of the report are both required — a guard
  // that makes you run it three times to learn three things is a guard people
  // stop running.
  const problems = []

  for (const name of unresolvedNames) {
    if (!(name in baseline)) {
      problems.push(
        `${name}: NEW unguarded export — its frozen options (region, secrets, ` +
        `timeout, App Check) are outside the guard entirely. Declare it so the ` +
        `follower can read it (a named alias beats require('./x').y), or add it ` +
        `to the baseline WITH the reason it cannot be read.`)
    }
  }

  for (const name of Object.keys(baseline)) {
    if (unresolvedNames.includes(name)) continue
    if (!exportedNames.has(name)) {
      problems.push(
        `${name}: NO LONGER EXPORTED — retired without dropping its baseline ` +
        `row. Delete the row.`)
    } else if (name in manifest) {
      problems.push(
        `${name}: options ARE now readable — good news. Delete the row so the ` +
        `list stays a true work list.`)
    } else {
      // Exported, but absent from the manifest: the manifest is stale, and
      // deleting the baseline row would be exactly the wrong fix.
      problems.push(
        `${name}: still exported but MISSING FROM THE MANIFEST — regenerate ` +
        `with \`node scripts/generate-functions-manifest.mjs\`. Do NOT delete ` +
        `the baseline row.`)
    }
  }

  assert.deepEqual(problems, [],
    `blind-spot baseline is out of date:\n    ${problems.join('\n    ')}`)
})

console.log(`\nfunctions manifest: ${passed} passed`)
