#!/usr/bin/env node
/**
 * repair-geography-form1-glued-header.mjs
 * =======================================
 * Splits the two-topics-in-one-cell row at the head of Geography Form 1.
 *
 * The PDF extractor merged the first two topic blocks into a single row:
 *   TOPIC             "1.1 Geography 1.2.The Solar System"
 *   SUB-TOPIC         "1.1.1 .Introduction to Geography 1.2.1.The Earth in the Solar System"
 *   SPECIFIC COMP.    "1.1.1.1.… Geography 1.2.1.1.… position of the Earth in the solar system"
 *   LEARNING ACTIV.   <3 Geography bullets> + <2 Solar-System bullets>
 *   EXPECTED STANDARD <Geography line> + <Solar-System line>
 * so topic "1.2 The Solar System" has no header of its own and its 1.2.2–1.2.5
 * sub-topics inherit the fused parent (they show as code-mismatch orphans).
 *
 * Verified against GEOGRAPHY-SYLLABUS.pdf p.4 (topics 1.1 Geography / 1.2 The
 * Solar System), this splits that one row into the two real rows. The learning
 * activities and expected-standard TEXT are preserved verbatim — only
 * partitioned at the boundary the source defines (first 3 activity bullets +
 * first standard line → 1.1.1; the rest → 1.2.1) — so no wording is invented.
 * All other Form-1 rows already match the source and are left untouched.
 *
 * Signature-matched + idempotent: fires only while the glued row is present.
 * Keeps both data copies identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Geography Syllabus (Forms 1-4)'
const SHEET = 'Form 1'

// The glued head row: TOPIC carries both "1.1 Geography" and "1.2 …Solar System".
function isGluedHeadRow(row) {
  if (row?.type !== 'data') return false
  const t = String(row.cells?.TOPIC || '')
  return /1\.1\s+Geography/i.test(t) && /1\.2\.?\s*The Solar System/i.test(t)
}

function splitRow(row) {
  const c = row.cells || {}
  const acts = String(c['LEARNING ACTIVITIES'] || '').split('\n')
  const stds = String(c['EXPECTED STANDARD'] || '').split('\n')
  const comp = String(c['SPECIFIC COMPETENCES'] || '')
  // Competences split at the 1.2.1.1 marker (the second competence's code).
  const compParts = comp.split(/(?=1\.2\.1\.1\.)/)
  // Source boundary (p.4): first 3 activity bullets are Geography (1.1.1),
  // the remaining bullets are the Solar System (1.2.1).
  const GEO_ACTIVITY_BULLETS = 3

  const geo = {
    type: 'data',
    cells: {
      TOPIC: '1.1 Geography',
      'SUB-TOPIC': '1.1.1 Introduction to Geography',
      'SPECIFIC COMPETENCES': (compParts[0] || '').trim(),
      'LEARNING ACTIVITIES': acts.slice(0, GEO_ACTIVITY_BULLETS).join('\n'),
      'EXPECTED STANDARD': (stds[0] || '').trim(),
    },
  }
  const solar = {
    type: 'data',
    cells: {
      TOPIC: '1.2 The Solar System',
      'SUB-TOPIC': '1.2.1 The Earth in the Solar System',
      'SPECIFIC COMPETENCES': (compParts.slice(1).join('') || '').trim(),
      'LEARNING ACTIVITIES': acts.slice(GEO_ACTIVITY_BULLETS).join('\n'),
      'EXPECTED STANDARD': stds.slice(1).join('\n').trim(),
    },
  }
  return [geo, solar]
}

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  let split = 0
  const out = []
  for (const row of sheet.rows) {
    if (isGluedHeadRow(row)) {
      const [geo, solar] = splitRow(row)
      out.push(geo, solar)
      split++
    } else {
      out.push(row)
    }
  }
  sheet.rows = out

  console.log(`\n=== Geography Form 1 · glued-header split ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  if (split) {
    console.log('  1.1 Geography            <- 1.1.1 Introduction to Geography')
    console.log('  1.2 The Solar System     <- 1.2.1 The Earth in the Solar System')
    console.log(`\n  ${split} glued row split into 2.`)
  } else {
    console.log('  Nothing to do (already split).')
  }

  if (APPLY && split > 0) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && split > 0) {
    console.log('\nDry-run — re-run with --apply to write.')
  }
  return split
}

run()
