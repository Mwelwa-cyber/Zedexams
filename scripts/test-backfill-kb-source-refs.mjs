#!/usr/bin/env node
/**
 * Unit test for functions/teacherTools/backfillKbSourceRefs.js — the
 * admin-callable wrapper around scripts/backfill-kb-source-refs.mjs.
 *
 * Exercises the pure matching logic (pickSyllabus, syllabusKey,
 * normTerm) without booting firebase-admin / firebase-functions, so
 * this runs in plain Node from CI just like the other test:* scripts.
 *
 * Run: npm run test:backfill-kb-source-refs  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TARGET = join(__dirname, '..', 'functions', 'teacherTools', 'backfillKbSourceRefs.js')

// Mock firebase-admin, firebase-functions/v2/https, and the sibling
// modules the target requires at import time, so the unit under test
// can load without a Google Cloud environment.
const fakeAdmin = {
  firestore: () => ({ collection: () => ({ get: async () => ({ docs: [], forEach: () => {} }) }) }),
}
fakeAdmin.firestore.FieldValue = { serverTimestamp: () => '__ts__' }

const fakeCbcKnowledge = {
  invalidateKbCache: () => {},
  getActiveKbVersion: async () => 'test-version',
  normalizeGrade: (g) => {
    if (g == null) return ''
    const raw = String(g).trim().toUpperCase().replace(/\s+/g, '')
    if (!raw) return ''
    if (/^G\d+$/.test(raw)) return raw
    if (/^\d+$/.test(raw)) return `G${raw}`
    const m = raw.match(/^GRADE(\d+)$/)
    if (m) return `G${m[1]}`
    return raw
  },
  normalizeSubject: (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '_'),
}

const fakeAiService = {
  getUserRole: async () => 'admin',
}

const fakeFunctionsHttps = {
  onCall: (_opts, handler) => handler,
  HttpsError: class extends Error {
    constructor(code, message) { super(message); this.code = code }
  },
}

// CommonJS resolver injection — the target uses require(), so we patch
// Module._resolveFilename to redirect the known imports.
const originalResolve = Module._resolveFilename
Module._resolveFilename = function patched(request, ...rest) {
  if (request === 'firebase-admin') return 'firebase-admin'
  if (request === 'firebase-functions/v2/https') return 'firebase-functions/v2/https'
  if (request === '../aiService') return '../aiService'
  if (request === './cbcKnowledge') return './cbcKnowledge'
  return originalResolve.call(this, request, ...rest)
}
const originalLoad = Module._load
Module._load = function patched(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === 'firebase-functions/v2/https') return fakeFunctionsHttps
  if (request === '../aiService') return fakeAiService
  if (request === './cbcKnowledge') return fakeCbcKnowledge
  return originalLoad.call(this, request, parent, ...rest)
}

const { createRequire } = await import('node:module')
const requireCjs = createRequire(import.meta.url)
const mod = requireCjs(TARGET)
const { pickSyllabus, syllabusKey, normTerm } = mod.__test

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass += 1; return }
  fail += 1
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── normTerm ────────────────────────────────────────────────────────
console.log('normTerm')
check('1 → 1', normTerm(1) === 1)
check('"2" → 2', normTerm('2') === 2)
check('3 → 3', normTerm(3) === 3)
check('0 → null', normTerm(0) === null)
check('4 → null', normTerm(4) === null)
check('"foo" → null', normTerm('foo') === null)
check('null → null', normTerm(null) === null)
check('undefined → null', normTerm(undefined) === null)
check('"1.5" → null (non-integer)', normTerm('1.5') === null)

// ── syllabusKey ─────────────────────────────────────────────────────
console.log('syllabusKey')
check('G4 / Integrated Science', syllabusKey('G4', 'Integrated Science') === 'G4::integrated_science')
check('plain 4 → G4', syllabusKey('4', 'maths') === 'G4::maths')
check('Grade 5 → G5', syllabusKey('Grade 5', 'English') === 'G5::english')
check('ECE preserved', syllabusKey('ECE', 'maths_science') === 'ECE::maths_science')
check('PP1 preserved', syllabusKey('PP1', 'Literacy') === 'PP1::literacy')

// ── pickSyllabus ────────────────────────────────────────────────────
console.log('pickSyllabus')
check('empty → null', pickSyllabus([], 1) === null)
check('null → null', pickSyllabus(null, 1) === null)
check('exact term wins', pickSyllabus([
  { id: 'a', term: 1 },
  { id: 'b', term: 2 },
], 2).id === 'b')
check('term-agnostic preferred over wrong term', pickSyllabus([
  { id: 'wrong', term: 1 },
  { id: 'any',   term: null },
], 2).id === 'any')
check('falls back to first when no exact + no term-agnostic', pickSyllabus([
  { id: 'first',  term: 1 },
  { id: 'second', term: 3 },
], 2).id === 'first')
check('no term: prefers term-agnostic', pickSyllabus([
  { id: 'termed', term: 1 },
  { id: 'any',    term: null },
], null).id === 'any')
check('no term, no agnostic: first', pickSyllabus([
  { id: 'a', term: 1 },
  { id: 'b', term: 2 },
], null).id === 'a')

// ── summary ─────────────────────────────────────────────────────────
console.log(`\nbackfillKbSourceRefs: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
