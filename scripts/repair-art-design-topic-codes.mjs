#!/usr/bin/env node
/**
 * repair-art-design-topic-codes.mjs
 * =================================
 * Restores the numeric topic codes the extractor dropped from every Art &
 * Design (Forms 1-4) topic header. The official ART-AND-DESIGN-SYLLABUS-FINAL.pdf
 * prints topics as "1.1 INTRODUCTION TO ART, CRAFTS AND DESIGN", but the app
 * data kept only the title ("Introduction to Art, Crafts and Design") with no
 * code — so unlike every other subject, Art & Design topics carry no "N.M"
 * prefix in the studio pickers.
 *
 * Each topic's code is deterministic: for a topic whose sub-topics are coded
 * (e.g. 1.1.1..1.1.8) the code is their shared parent (1.1); the handful of
 * topics whose sub-topics carry no code fill the exact gaps in the otherwise
 * contiguous 1.1..1.N sequence, verified against the source pages. Only the
 * numeric prefix is added; titles are untouched, nothing invented.
 *
 * Idempotent (skips a topic that already starts with a digit). Both data copies
 * kept byte-identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Art & Design Syllabus (Forms 1-4)'

// form -> { exact current topic title : numeric code }
const CODES = {
  'Form 1': {
    'Introduction to Art, Crafts and Design': '1.1',
    'History of Zambian Art-I': '1.2',
    'Introduction to Colour': '1.3',
    'Studio Practice': '1.4',
    'Graphic Design': '1.5',
    'Pattern and Design': '1.6',
    'Drawing and or Painting from Imagination': '1.7',
    'Drawing and or Painting from Observation': '1.8',
    'Drawing and or Painting from Still Life': '1.9',
    'Figure Drawing': '1.10',
    'Crafts in 2D': '1.11',
    'Crafts in 3D': '1.12',
    'Sculpture': '1.13',
    'Entrepreneurship': '1.14',
  },
  'Form 2': {
    'History of Zambian Art-II': '2.1',
    'Colour': '2.2',
    'Studio Practice': '2.3',
    'Perspective': '2.4',
    'Drawing or Painting from Imaginative Composition': '2.5',
    'Drawing or Painting from Observation': '2.6',
    'Drawing or Painting from Still Life': '2.7',
    'Figure Drawing': '2.8',
    'Crafts': '2.9',
    'Graphic Design': '2.10',
    'Sculpture': '2.11',
    'Entrepreneurship': '2.12',
  },
  'Form 3': {
    'Introduction to African Art': '3.1',
    'Drawing or Painting from Imagination': '3.2',
    'Drawing or Painting from Observation': '3.3',
    'Drawing or Painting from Still Life': '3.4',
    'Figure Drawing or Painting': '3.5',
    'Crafts': '3.6',
    'Graphic Design': '3.7',
    'Photography and Filming': '3.8',
    'Sculpture': '3.9',
    'Entrepreneurship': '3.10',
  },
  'Form 4': {
    'Introduction to Art Careers': '4.1',
    'World Art History': '4.2',
    'Drawing or Painting from Imagination': '4.3',
    'Drawing or Painting from Observation': '4.4',
    'Drawing or Painting from Still Life': '4.5',
    'Figure Drawing or Painting': '4.6',
    'Crafts': '4.7',
    'Graphic Design (Computer Aided)': '4.8',
    'Photography and Filming': '4.9',
    'Sculpture': '4.10',
    'Entrepreneurship': '4.11',
  },
}

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const applied = []
  const unmatched = []

  for (const [form, map] of Object.entries(CODES)) {
    const sheet = primary?.[SUBJECT]?.[form]
    if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${form} not found`)
    const hit = new Set()
    for (const row of sheet.rows) {
      if (row.type !== 'data') continue
      const raw = String(row.cells?.TOPIC || '')
      const title = raw.trim()
      if (!title || /^\d/.test(title)) continue // empty or already coded
      const code = map[title]
      if (!code) continue
      row.cells.TOPIC = `${code} ${title}`
      hit.add(title)
    }
    for (const [title, code] of Object.entries(map)) {
      if (hit.has(title)) applied.push(`${form}: ${code} ${title}`)
      else unmatched.push(`${form}: ${code} ${title}`)
    }
  }

  console.log(`\n=== Art & Design topic-code restore ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  for (const a of applied) console.log(`  ✓ ${a}`)
  if (unmatched.length) {
    console.log('\n  (title not found this run — already coded or absent):')
    for (const u of unmatched) console.log(`    · ${u}`)
  }
  console.log(`\n  ${applied.length} topic(s) coded, ${unmatched.length} not applied.`)

  if (APPLY && applied.length > 0) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && applied.length > 0) {
    console.log('\nDry-run — re-run with --apply to write.')
  }
  return { applied: applied.length, unmatched: unmatched.length }
}

run()
