#!/usr/bin/env node
/**
 * test-grade7-ss-covers — guards the Grade 7 Social Studies cover spec
 * (scripts/data/grade7-ss-covers.js) against the seed it describes.
 *
 * Plain `node` test (no runner): throws on the first failed assertion.
 *   node scripts/test-grade7-ss-covers.mjs
 */

import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {COVER_TEMPLATE, buildCoverPrompt, COVERS} = require('./data/grade7-ss-covers.cjs')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

const seed = JSON.parse(
  await readFile(path.join(REPO_ROOT, 'src/features/notes/seed/grade7Seed.json'), 'utf8'),
)
const ssNotes = seed.notes.filter((n) => n.subject === 'Social Studies')

// 1. One cover entry per Social Studies note, no more, no fewer.
assert(
  COVERS.length === ssNotes.length,
  `cover count ${COVERS.length} !== Social Studies note count ${ssNotes.length}`,
)

const seedBySeedKey = new Map(ssNotes.map((n) => [n.seedKey, n]))
const seenKeys = new Set()
const seenFiles = new Set()

for (const c of COVERS) {
  // 2. Each cover points at a real SS note, with a matching title.
  const note = seedBySeedKey.get(c.seedKey)
  assert(note, `cover seedKey ${c.seedKey} has no matching Social Studies note`)
  assert(
    note.title === c.subtopic,
    `subtopic mismatch for ${c.seedKey}: cover "${c.subtopic}" !== seed "${note.title}"`,
  )

  // 3. seedKeys and output filenames are unique.
  assert(!seenKeys.has(c.seedKey), `duplicate seedKey in cover spec: ${c.seedKey}`)
  seenKeys.add(c.seedKey)
  assert(!seenFiles.has(c.file), `duplicate output file in cover spec: ${c.file}`)
  seenFiles.add(c.file)
  assert(/^g7-ss-[0-9]+-[0-9]+-cover\.png$/.test(c.file), `unexpected file name: ${c.file}`)

  // 4. A non-empty scene, and a filled prompt that drops both slots and the
  //    fixed "no text" guard rail.
  assert(c.scene && c.scene.trim().length > 0, `empty scene for ${c.seedKey}`)
  const prompt = buildCoverPrompt(c.subtopic, c.scene)
  assert(prompt.includes(c.subtopic), `prompt for ${c.seedKey} dropped the subtopic`)
  assert(prompt.includes(c.scene), `prompt for ${c.seedKey} dropped the scene`)
  assert(!prompt.includes('{SUBTOPIC}'), `prompt for ${c.seedKey} left {SUBTOPIC} unfilled`)
  assert(!prompt.includes('{scene}'), `prompt for ${c.seedKey} left {scene} unfilled`)
  assert(/no text/i.test(prompt), `prompt for ${c.seedKey} lost the "no text" guard`)
}

// 5. Every SS note is covered (no orphan note without a cover).
for (const n of ssNotes) {
  assert(seenKeys.has(n.seedKey), `Social Studies note ${n.seedKey} has no cover entry`)
}

// 6. The template still carries its slots so buildCoverPrompt stays meaningful.
assert(COVER_TEMPLATE.includes('{SUBTOPIC}'), 'COVER_TEMPLATE lost the {SUBTOPIC} slot')
assert(COVER_TEMPLATE.includes('{scene}'), 'COVER_TEMPLATE lost the {scene} slot')

console.log(`✓ grade7-ss-covers: ${COVERS.length} covers match the seed, all prompts well-formed`)
