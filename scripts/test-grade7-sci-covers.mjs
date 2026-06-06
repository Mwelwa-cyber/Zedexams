#!/usr/bin/env node
/**
 * test-grade7-sci-covers — guards the curated Integrated Science note covers
 * (src/features/notes/lib/noteCovers.js) against the seed they describe and the
 * image files they point at.
 *
 * Plain `node` test (no runner): throws on the first failed assertion.
 *   node scripts/test-grade7-sci-covers.mjs
 */

import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

const exists = async (p) => {
  try { await access(p); return true } catch { return false }
}

const { NOTE_COVER_REGISTRY, NOTE_COVER_BY_TITLE, resolveNoteCover } = await import(
  path.join(REPO_ROOT, 'src/features/notes/lib/noteCovers.js')
)

const seed = JSON.parse(
  await readFile(path.join(REPO_ROOT, 'src/features/notes/seed/grade7Seed.json'), 'utf8'),
)

const UNIT_CODE_RE = /^\s*(\d+\.\d+)/
let checked = 0

for (const [key, set] of Object.entries(NOTE_COVER_REGISTRY)) {
  const [grade, subject] = key.split('|')
  assert(grade && subject, `registry key "${key}" must be "<grade>|<subject>"`)

  // Notes for this grade+subject, indexed by unit code.
  const notesByCode = new Map()
  for (const n of seed.notes) {
    if (String(n.grade) !== grade || n.subject !== subject) continue
    const m = String(n.title || '').match(UNIT_CODE_RE)
    if (m) notesByCode.set(m[1], n)
  }

  const seenFiles = new Set()
  for (const [code, urlPath] of Object.entries(set)) {
    // 1. Each cover points at a real note with that unit code.
    const note = notesByCode.get(code)
    assert(note, `cover ${key} ${code} has no matching ${subject} note in the seed`)

    // 2. Path shape + uniqueness.
    assert(urlPath.startsWith('/notes/covers/'), `cover ${key} ${code} must live under /notes/covers/: ${urlPath}`)
    assert(!seenFiles.has(urlPath), `duplicate cover file in ${key}: ${urlPath}`)
    seenFiles.add(urlPath)

    // 3. The image file is committed.
    const filePath = path.join(REPO_ROOT, 'public', urlPath.replace(/^\//, ''))
    assert(await exists(filePath), `missing cover image file: public${urlPath}`)

    // 4. The runtime resolver returns this exact path for the note.
    const resolved = resolveNoteCover(note)
    assert(
      resolved === urlPath,
      `resolveNoteCover("${note.title}") = "${resolved}" !== "${urlPath}"`,
    )
    checked++
  }
}

// 5. Title-matched covers (un-coded authored notes, e.g. provinces). These
//    notes aren't in the committed seed, so we only guard the image file +
//    that the resolver returns the path for a note with that exact title.
const seenTitleFiles = new Set()
for (const [title, urlPath] of Object.entries(NOTE_COVER_BY_TITLE)) {
  assert(title === title.trim().toLowerCase().replace(/\s+/g, ' '),
    `title key must be normalised (trim/lower/single-spaced): "${title}"`)
  assert(urlPath.startsWith('/notes/covers/'), `title cover "${title}" must live under /notes/covers/: ${urlPath}`)
  assert(!seenTitleFiles.has(urlPath), `duplicate title cover file: ${urlPath}`)
  seenTitleFiles.add(urlPath)
  const filePath = path.join(REPO_ROOT, 'public', urlPath.replace(/^\//, ''))
  assert(await exists(filePath), `missing title cover image file: public${urlPath}`)
  // Resolves regardless of grade/subject, and is case/space-insensitive.
  assert(resolveNoteCover({ title: `  ${title.toUpperCase()}  ` }) === urlPath,
    `resolveNoteCover by title "${title}" did not return "${urlPath}"`)
  checked++
}

// 6. A note without a registered cover resolves to '' (graceful text-only card).
assert(
  resolveNoteCover({ grade: '7', subject: 'Integrated Science', title: '9.9 Nonexistent' }) === '',
  'unregistered note should resolve to an empty cover',
)
assert(
  resolveNoteCover({ grade: '7', subject: 'Mathematics', title: '1.1 Whole Numbers' }) === '',
  'subjects without a cover set should resolve to an empty cover',
)
assert(resolveNoteCover(null) === '', 'resolveNoteCover(null) should be safe and return ""')

console.log(`✓ grade7-sci-covers: ${checked} curated covers match the seed and exist on disk`)
