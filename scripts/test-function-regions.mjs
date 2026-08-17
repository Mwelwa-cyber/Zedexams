// Plain-node guard for the staged us-central1 → africa-south1 migration of the
// HTTP/callable surface (functions/functionRegions.json).
//
// The failures this exists to catch are all silent ones — a function that
// deploys to one region while its callers address another produces a
// `functions/not-found`, or a 404 on a public /api/ URL, and nothing in lint
// or the build says a word. Run: node scripts/test-function-regions.mjs

import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  LEGACY_REGION as CLIENT_LEGACY,
  FIRESTORE_REGION as CLIENT_FIRESTORE,
  MIGRATED_FUNCTIONS as CLIENT_MIGRATED,
  regionFor as clientRegionFor,
  isMigrated as clientIsMigrated,
} from '../src/config/functionRegions.js'

const require = createRequire(import.meta.url)
const server = require('../functions/functionRegions.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = JSON.parse(readFileSync(join(root, 'functions/functionRegions.json'), 'utf8'))
const indexSrc = readFileSync(join(root, 'functions/index.js'), 'utf8')
const firebaseJson = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// ── The registry itself ──────────────────────────────────────────────────
console.log('\nregistry shape')

ok('legacy region is us-central1', registry.legacyRegion === 'us-central1')
ok('Firestore region is africa-south1', registry.firestoreRegion === 'africa-south1')
ok('migrated is an array', Array.isArray(registry.migrated))
ok(
  'migrated has no duplicates',
  new Set(registry.migrated).size === registry.migrated.length,
)
ok(
  'migrated holds only non-empty strings',
  registry.migrated.every((n) => typeof n === 'string' && n.length > 0),
)

// The whole premise of the migration is colocation with Firestore, so the
// target region must be the one the existing Firestore triggers already use.
// The agent dispatcher is the canonical africa-south1-pinned trigger (see
// CLAUDE.md's Firestore-region note).
ok(
  'the target region is the one Firestore triggers already run in',
  indexSrc.includes(`region: "${registry.firestoreRegion}"`) ||
    readFileSync(join(root, 'functions/agents/dispatcher.js'), 'utf8')
      .includes(`"${registry.firestoreRegion}"`),
)

// ── The client mirror matches the server registry ────────────────────────
// This is the drift guard. The client is a hand-written mirror, so every
// value it declares is compared against the server's JSON here — a wave that
// updates one side and not the other fails CI rather than production.
console.log('\nthe client mirror matches the server registry exactly')

ok('legacy region matches across the boundary', server.LEGACY_REGION === CLIENT_LEGACY)
ok('Firestore region matches across the boundary', server.FIRESTORE_REGION === CLIENT_FIRESTORE)
ok(
  'the migrated list matches across the boundary',
  JSON.stringify([...CLIENT_MIGRATED].sort()) ===
    JSON.stringify([...registry.migrated].sort()),
)

for (const name of registry.migrated) {
  ok(
    `${name}: client and server agree it serves from ${registry.firestoreRegion}`,
    server.regionFor(name) === clientRegionFor(name) &&
      server.regionFor(name) === registry.firestoreRegion,
  )
}

for (const name of ['aiChat', 'generateAssessment', 'verifyQuiz', '__not_a_function__']) {
  if (registry.migrated.includes(name)) continue
  ok(
    `${name}: unmigrated resolves to ${registry.legacyRegion} on both sides`,
    server.regionFor(name) === clientRegionFor(name) &&
      server.regionFor(name) === registry.legacyRegion,
  )
}

ok('isMigrated agrees across the boundary', registry.migrated.every(
  (n) => server.isMigrated(n) === clientIsMigrated(n),
))

ok('regionFor rejects a missing name rather than guessing', (() => {
  try { server.regionFor(''); return false } catch { /* expected */ }
  try { clientRegionFor(undefined); return false } catch { /* expected */ }
  return true
})())

// ── Every migrated name is a real export ─────────────────────────────────
console.log('\nmigrated names correspond to real function exports')

for (const name of registry.migrated) {
  ok(
    `${name} is exported from functions/index.js`,
    new RegExp(`^exports\\.${name}\\s*=`, 'm').test(indexSrc),
  )
}

// ── A migrated function must not still declare the legacy region ─────────
// The registry saying "moved" while the export still hard-codes us-central1 is
// the exact split that deploys the function to one region and points every
// caller at the other.
console.log('\nno migrated export still hard-codes the legacy region')

for (const name of registry.migrated) {
  const start = indexSrc.search(new RegExp(`^exports\\.${name}\\s*=`, 'm'))
  if (start === -1) continue
  // The options object ends at the first `}, ` that opens the handler.
  const block = indexSrc.slice(start, start + 600)
  const optionsEnd = block.indexOf('}, ')
  const options = optionsEnd === -1 ? block : block.slice(0, optionsEnd)
  ok(
    `${name} does not hard-code region: "${registry.legacyRegion}"`,
    !options.includes(`region: "${registry.legacyRegion}"`),
  )
}

// ── Nothing ineligible may be marked migrated ────────────────────────────
// Two hard platform limits, enforced here rather than left in the runbook —
// prose does not fail a build.
//
// Resolving an export's KIND needs one hop: most scheduled functions are
// defined in another file (functions/agents/cron.js, opsHeartbeat.js, …) and
// re-exported from index.js as a bare identifier
// (`exports.nightlyQaSmoke = nightlyQaSmokeCron;`), so reading the text at
// the export site alone sees nothing and the guard silently passes everything.
function collectKinds() {
  const kinds = new Map() // identifier → 'schedule' | 'gen1'
  const files = readdirSync(join(root, 'functions'), { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.js'))
    .filter((f) => !f.includes('node_modules') && !f.includes('.test.'))
  for (const rel of files) {
    let src
    try { src = readFileSync(join(root, 'functions', rel), 'utf8') } catch { continue }
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*onSchedule\s*\(/g)) {
      kinds.set(m[1], 'schedule')
    }
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*functions\s*\./g)) {
      kinds.set(m[1], 'gen1')
    }
  }
  return kinds
}
const identifierKinds = collectKinds()

/**
 * index.js renames most of what it re-exports on the way in
 * (`const { nightlyQaSmoke: nightlyQaSmokeCron } = require("./agents/cron")`),
 * so the local identifier at the export site is not the name the function was
 * defined under. Resolve the alias back to the original.
 */
function originalNameOf(local) {
  const m = indexSrc.match(new RegExp(`(\\w+)\\s*:\\s*${local}\\s*[,}]`))
  return m ? m[1] : null
}

/** The trigger kind of an index.js export, following the re-export hops. */
function exportKind(name) {
  const m = indexSrc.match(new RegExp(`^exports\\.${name}\\s*=\\s*([\\s\\S]{0,80})`, 'm'))
  if (!m) return 'unknown'
  const rhs = m[1]
  if (/^\s*onSchedule\s*\(/.test(rhs)) return 'schedule'
  if (/^\s*functions\s*\./.test(rhs)) return 'gen1'
  const alias = rhs.match(/^\s*(\w+)\s*;/)
  if (!alias) return 'other'
  const local = alias[1]
  if (identifierKinds.has(local)) return identifierKinds.get(local)
  const original = originalNameOf(local)
  if (original && identifierKinds.has(original)) return identifierKinds.get(original)
  return 'other'
}

console.log('\nonly functions that CAN run in the target region are migrated')

// Self-check: the resolver must actually recognise the two kinds in this repo,
// or every assertion below passes vacuously.
ok(
  'the kind resolver recognises a 1st-gen export (setUserRole)',
  exportKind('setUserRole') === 'gen1',
)
ok(
  'the kind resolver recognises a re-exported scheduled function (nightlyQaSmoke)',
  exportKind('nightlyQaSmoke') === 'schedule',
)

for (const name of registry.migrated) {
  const kind = exportKind(name)
  // africa-south1 is 2nd-generation ONLY. A 1st-gen export (the
  // `functions.<trigger>` builder from firebase-functions/v1) cannot deploy
  // there at all — e.g. setUserRole, which uses functions.auth.user(), a
  // trigger type with no 2nd-gen equivalent.
  ok(`${name} is not a 1st-generation (firebase-functions/v1) export`, kind !== 'gen1')
  // Cloud Scheduler has no African region, so an onSchedule function cannot
  // be scheduled from africa-south1. Moving one means splitting the schedule
  // from the work — a design change, not a region flip.
  ok(
    `${name} is not an onSchedule export (Cloud Scheduler has no africa-south1)`,
    kind !== 'schedule',
  )
}

// ── Hosting rewrites track the registry ──────────────────────────────────
// A rewrite is a PUBLIC url. If it names a region the function no longer
// serves from, zedexams.com/api/... returns 404 — including the Lenco and
// WhatsApp webhooks, where the caller is a third party that will not retry
// forever.
console.log('\nfirebase.json rewrites point at the region each function serves from')

const hosting = Array.isArray(firebaseJson.hosting) ? firebaseJson.hosting[0] : firebaseJson.hosting
const rewrites = (hosting?.rewrites || []).filter((r) => r?.function?.functionId)

ok('there are function rewrites to check', rewrites.length > 0)

for (const rewrite of rewrites) {
  const { functionId, region } = rewrite.function
  ok(
    `rewrite ${rewrite.source} → ${functionId} names ${server.regionFor(functionId)}`,
    region === server.regionFor(functionId),
  )
}

console.log(`\nfunction-regions: ${passed} tests passed`)
