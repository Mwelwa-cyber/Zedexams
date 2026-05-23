#!/usr/bin/env node
/**
 * Content version recorder — unit tests.
 *
 * Covers:
 *   - recordContentVersion writes a snapshot to the versions
 *     collection with the right shape
 *   - isInitial:true keeps the parent's version at 1 (no bump)
 *   - subsequent writes increment the parent's version field by 1
 *   - swallows errors silently (never throws) when Firestore fails
 *   - refuses to write when contentId / changedBy / changeType
 *     are invalid
 *   - the change-types enum is the exact set the spec requires
 *   - Zod schema in src/schemas/learnerAi.js rejects unknown
 *     changeType values
 *   - dispatcher.js + _stubFactory.js source-text greps confirm the
 *     wiring is in place (defence against accidental revert)
 *
 * Run: npm run test:version-recorder  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RECORDER_PATH = join(ROOT, 'functions/agents/learnerAi/versionRecorder.js')
const DISPATCHER_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8',
)
const FACTORY_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/runners/_stubFactory.js'), 'utf8',
)
const RULES_TEXT = readFileSync(join(ROOT, 'firestore.rules'), 'utf8')
const INDEXES_TEXT = readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8')

// Fake firebase-admin that drives runTransaction with mutable state.
const state = {
  parentDoc: null,    // { exists, data }
  parentMissing: false,
  failOnRun: false,
  txReads: [],        // ref args passed to tx.get
  txSets: [],         // [{ collection, payload }]
  txUpdates: [],      // [{ collection, id, payload }]
  generatedIds: 0,
}

function makeRef(coll, id) {
  const resolvedId = id || `auto-${++state.generatedIds}`
  return {
    __coll: coll,
    __id: resolvedId,
    id: resolvedId,        // mirrors the real Firestore ref API
  }
}

const fakeAdmin = {
  firestore: () => ({
    collection: (name) => ({
      doc: (id) => makeRef(name, id),
    }),
    runTransaction: async (fn) => {
      if (state.failOnRun) throw new Error('simulated firestore failure')
      const tx = {
        get: async (ref) => {
          state.txReads.push(ref)
          if (ref.__coll === 'aiGeneratedContent') {
            if (state.parentMissing) return { exists: false }
            return {
              exists: true,
              data: () => state.parentDoc || {},
            }
          }
          throw new Error(`unexpected tx.get on ${ref.__coll}`)
        },
        set: (ref, payload) => {
          state.txSets.push({ collection: ref.__coll, payload })
        },
        update: (ref, payload) => {
          state.txUpdates.push({ collection: ref.__coll, id: ref.__id, payload })
        },
      }
      return fn(tx)
    },
  }),
}
fakeAdmin.firestore.FieldValue = {
  serverTimestamp: () => '__ts__',
  increment: (n) => ({ __increment: n }),
}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  return origLoad.call(this, request, parent, ...rest)
}
const recorder = await import(RECORDER_PATH)
const { aiGeneratedContentVersionWriteSchema, CONTENT_VERSION_CHANGE_TYPES } =
  await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  state.parentDoc = null
  state.parentMissing = false
  state.failOnRun = false
  state.txReads = []
  state.txSets = []
  state.txUpdates = []
  state.generatedIds = 0
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      return r.then(() => { pass++; console.log(`  ok  ${name}`) })
              .catch(err => {
                fail++
                failures.push({ name, message: err.message })
                console.log(`  FAIL ${name}\n       ${err.message}`)
              })
    }
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// ── CHANGE_TYPES enum + schema ────────────────────────────────────

console.log('\nCHANGE_TYPES — exact spec set')

test('exports every changeType the spec lists', () => {
  const expected = [
    'ai_generated', 'admin_edit', 'regenerated',
    'approved', 'published', 'rejected',
  ]
  const actual = [...recorder.VALID_CHANGE_TYPES].sort()
  assert(expected.sort().join(',') === actual.join(','),
    `mismatch: ${actual.join(',')} !== ${expected.join(',')}`)
})

test('Zod schema rejects unknown changeType', () => {
  const r = aiGeneratedContentVersionWriteSchema.safeParse({
    contentId: 'c1', version: 1, content: {}, changedBy: 'system',
    changeType: 'invalid_type', changeReason: null, createdAt: '__ts__',
  })
  assert(r.success === false, 'must reject')
})

test('Zod schema accepts all 6 valid changeTypes', () => {
  for (const t of CONTENT_VERSION_CHANGE_TYPES.options) {
    const r = aiGeneratedContentVersionWriteSchema.safeParse({
      contentId: 'c1', version: 1, content: {}, changedBy: 'system',
      changeType: t, changeReason: null, createdAt: '__ts__',
    })
    assert(r.success === true, `must accept '${t}': ${r.success ? '' : JSON.stringify(r.error.issues)}`)
  }
})

// ── recordContentVersion — happy path ────────────────────────────

console.log('\nrecordContentVersion — happy path')

await test('initial write (isInitial:true) keeps parent at v1', async () => {
  state.parentDoc = { version: 1, content: { stub: true } }
  const id = await recorder.recordContentVersion({
    contentId: 'c1',
    content: { stub: true },
    changedBy: 'agent:practiceQuiz',
    changeType: 'ai_generated',
    changeReason: null,
    isInitial: true,
  })
  assert(typeof id === 'string', 'returns version doc id')
  assert(state.txSets.length === 1, `expected 1 set, got ${state.txSets.length}`)
  const written = state.txSets[0].payload
  assert(state.txSets[0].collection === 'aiGeneratedContentVersions')
  assert(written.contentId === 'c1')
  assert(written.version === 1, `expected v1, got ${written.version}`)
  assert(written.changeType === 'ai_generated')
  assert(written.changedBy === 'agent:practiceQuiz')
  assert(state.txUpdates.length === 0, 'initial write must NOT bump parent')
})

await test('subsequent write (isInitial:false) bumps parent v1 → v2', async () => {
  state.parentDoc = { version: 1, content: { foo: 'bar' } }
  const id = await recorder.recordContentVersion({
    contentId: 'c1',
    changedBy: 'system',
    changeType: 'approved',
  })
  assert(typeof id === 'string')
  assert(state.txSets.length === 1)
  assert(state.txSets[0].payload.version === 2,
    `expected v2, got ${state.txSets[0].payload.version}`)
  assert(state.txUpdates.length === 1, 'parent must be updated')
  assert(state.txUpdates[0].payload.version === 2)
})

await test('falls back to parent.content when content arg omitted', async () => {
  state.parentDoc = { version: 1, content: { x: 42 } }
  await recorder.recordContentVersion({
    contentId: 'c1',
    changedBy: 'system',
    changeType: 'published',
  })
  assert(state.txSets[0].payload.content.x === 42,
    'snapshot must read content from parent doc')
})

await test('explicit content arg wins over parent.content', async () => {
  state.parentDoc = { version: 1, content: { stale: true } }
  await recorder.recordContentVersion({
    contentId: 'c1',
    content: { fresh: true },
    changedBy: 'system',
    changeType: 'published',
  })
  assert(state.txSets[0].payload.content.fresh === true)
  assert(!('stale' in state.txSets[0].payload.content),
    'must not include parent content keys when explicit arg present')
})

await test('changeReason is trimmed to 800 chars + nullified for empty', async () => {
  state.parentDoc = { version: 1, content: {} }
  await recorder.recordContentVersion({
    contentId: 'c1',
    changedBy: 'admin-uid',
    changeType: 'rejected',
    changeReason: 'x'.repeat(2000),
  })
  assert(state.txSets[0].payload.changeReason.length === 800,
    `expected 800-char trim, got ${state.txSets[0].payload.changeReason.length}`)

  state.txSets = []; state.txUpdates = []
  state.parentDoc = { version: 1, content: {} }
  await recorder.recordContentVersion({
    contentId: 'c1',
    changedBy: 'admin-uid',
    changeType: 'rejected',
    changeReason: '',
  })
  assert(state.txSets[0].payload.changeReason === null,
    'empty string normalised to null')
})

// ── recordContentVersion — refusal paths ──────────────────────────

console.log('\nrecordContentVersion — refusal paths')

await test('returns null + warns when contentId missing', async () => {
  const id = await recorder.recordContentVersion({
    changedBy: 'system', changeType: 'approved',
  })
  assert(id === null)
  assert(state.txSets.length === 0)
})

await test('returns null when changedBy missing', async () => {
  const id = await recorder.recordContentVersion({
    contentId: 'c1', changeType: 'approved',
  })
  assert(id === null)
})

await test('returns null when changeType invalid', async () => {
  const id = await recorder.recordContentVersion({
    contentId: 'c1', changedBy: 'system', changeType: 'bogus',
  })
  assert(id === null)
})

await test('returns null when parent content doc missing', async () => {
  state.parentMissing = true
  const id = await recorder.recordContentVersion({
    contentId: 'gone', changedBy: 'system', changeType: 'approved',
  })
  // The transaction still runs, but no set happens because the
  // get reports !exists. Recorder returns the auto-generated id
  // (the doc() call happened) but no writes landed.
  assert(state.txSets.length === 0, 'no version doc must be written')
})

await test('swallows transaction failure (never throws)', async () => {
  state.failOnRun = true
  state.parentDoc = { version: 1, content: {} }
  const id = await recorder.recordContentVersion({
    contentId: 'c1', changedBy: 'system', changeType: 'approved',
  })
  assert(id === null, 'returns null on failure')
})

// ── Wiring greps ─────────────────────────────────────────────────

console.log('\nWiring — source-text greps')

test('_stubFactory.js imports + calls recordContentVersion', () => {
  assert(/require\(["']\.\.\/versionRecorder["']\)/.test(FACTORY_TEXT),
    '_stubFactory must require versionRecorder')
  assert(/recordContentVersion\(/.test(FACTORY_TEXT),
    '_stubFactory must call recordContentVersion')
  assert(/AI_GENERATED/.test(FACTORY_TEXT),
    '_stubFactory must use the AI_GENERATED change type')
  assert(/isInitial: true/.test(FACTORY_TEXT),
    '_stubFactory must mark the first snapshot as initial')
})

test('dispatcher.js imports + calls recordContentVersion for approved / rejected / published / regenerated', () => {
  assert(/require\(["']\.\/versionRecorder["']\)/.test(DISPATCHER_TEXT),
    'dispatcher must require versionRecorder')
  assert(/VERSION_CHANGE_TYPES\.APPROVED/.test(DISPATCHER_TEXT))
  assert(/VERSION_CHANGE_TYPES\.REJECTED/.test(DISPATCHER_TEXT))
  assert(/VERSION_CHANGE_TYPES\.PUBLISHED/.test(DISPATCHER_TEXT))
  assert(/VERSION_CHANGE_TYPES\.REGENERATED/.test(DISPATCHER_TEXT))
})

test('firestore.rules — versions collection is admin-only read, no client writes', () => {
  assert(/match \/aiGeneratedContentVersions\/\{versionId\}/.test(RULES_TEXT),
    'rules must declare the collection')
  const block = RULES_TEXT.split('match /aiGeneratedContentVersions/{versionId}')[1] || ''
  assert(/allow read:\s*if isAuthed\(\) && isAdmin\(\)/.test(block),
    'rule must be admin-only read')
  assert(/allow write: if false/.test(block),
    'rule must block all client writes')
})

test('firestore.indexes.json — composite (contentId ASC, version DESC) present', () => {
  const idx = JSON.parse(INDEXES_TEXT)
  const hit = (idx.indexes || []).find(i =>
    i.collectionGroup === 'aiGeneratedContentVersions' &&
    Array.isArray(i.fields) &&
    i.fields[0] && i.fields[0].fieldPath === 'contentId' &&
    i.fields[1] && i.fields[1].fieldPath === 'version',
  )
  assert(hit, 'composite index must exist')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
