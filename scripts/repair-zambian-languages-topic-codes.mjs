#!/usr/bin/env node
/**
 * repair-zambian-languages-topic-codes.mjs
 * ========================================
 * Restores the numeric codes the extractor dropped across the Zambian Languages
 * (Forms 1-4) syllabus. The official syllabus prints strand-based codes
 * N.S.T.U (form.strand.topic.sub-topic — e.g. 2.1.1.1), but only the Speaking
 * (N.1) and Reading (N.2) strands kept their codes in the app data; the Writing
 * (N.3) and Grammar / Language Structure (N.4/N.5) strands lost them entirely,
 * so most Writing/Grammar topics + sub-topics show as code-less rows in the
 * studio pickers. (A handful of coded topics also carried an uncoded sub-topic,
 * e.g. Form 2 "2.1.2 Drama" / "Play".)
 *
 * Two-part deterministic restore, verified against the four official
 * ZAMBIAN-LANGUAGES-...-SYLLABUS pages:
 *   1. Topic codes come from the source, matched to the app topic title
 *      (case-insensitive). Only the numeric prefix is prepended; the app's
 *      title casing is kept verbatim. Nothing is invented — every uncoded topic
 *      has an explicit source code in the per-form map below.
 *   2. Sub-topic codes are numbered POSITIONALLY within each topic's existing
 *      app grouping ("<topicCode>.<n>"), continuing after any already-coded
 *      sibling, so the result is orphan-free without restructuring content.
 *      Repeated/continuation rows (same sub-topic title) share one code.
 *
 * This does NOT move rows between topics. Where the app groups a sub-topic under
 * a different parent than the source does, the app grouping is kept and flagged
 * (see FLAGGED_DIVERGENCES) rather than silently restructured.
 *
 * Idempotent (already-coded topics/sub-topics are left untouched). Both data
 * copies kept byte-identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Zambian Languages Syllabus (Forms 1-4)'

// form -> { UPPER-CASED source topic title : numeric code }.
// Verified against the four official ZAMBIAN-LANGUAGES-...-SYLLABUS pages.
// Keys are upper-cased; matching against the app title is case-insensitive so
// the app's own title casing is preserved when the code is prepended.
const TOPIC_CODES = {
  'Form 1': {
    'CONVERSATIONS': '1.1.1', 'SONGS': '1.1.2', 'RIDDLES': '1.1.3',
    'STORY TELLING': '1.1.4', 'PUBLIC SPEAKING': '1.1.5',
    'INTENSIVE READING': '1.2.1', 'READING ALOUD': '1.2.2',
    'EXTENSIVE READING': '1.2.3', 'STUDY SKILLS': '1.2.4',
    'COMPOSITION': '1.3.1', 'SUMMARY': '1.3.2',
    'WORD CLASSES': '1.4.1', 'PUNCTUATION': '1.4.2', 'NOUNS': '1.4.3',
    'PRONOUNS': '1.4.4', 'ADVERBS': '1.4.5', 'VOWELS': '1.4.6',
    'LOCATIVES': '1.4.7', 'WORD BUILDING': '1.4.8', 'IDEOPHONES': '1.4.9',
    'TENSES': '1.4.10', 'DIRECT AND INDIRECT SPEECH': '1.4.11',
    'ACTIVE AND PASSIVE VOICE': '1.4.12', 'FIGURATIVE LANGUAGE': '1.4.13',
    'VOCABULARY': '1.4.14', 'TRANSLATION': '1.5.1',
  },
  'Form 2': {
    'CONVERSATIONS': '2.1.1', 'DRAMA': '2.1.2', 'SONGS': '2.1.3',
    'RIDDLES AND PUZZLES': '2.1.4', 'STORY TELLING': '2.1.5',
    'PUBLIC SPEAKING': '2.1.6',
    'INTENSIVE READING': '2.2.1', 'READING ALOUD': '2.2.2',
    'EXTENSIVE READING': '2.2.3', 'STUDY SKILLS': '2.2.4',
    'COMPOSITION': '2.3.1', 'SUMMARY': '2.3.2', 'DICTATION': '2.3.3',
    'NOUNS': '2.4.1', 'PRONOUNS': '2.4.2', 'ADJECTIVES': '2.4.3',
    'CONJUNCTIONS': '2.4.4', 'INTERJECTIONS': '2.4.5', 'PUNCTUATION': '2.4.6',
    'WORD BUILDING': '2.4.7', 'ONOMATOPOEIA': '2.4.8', 'TENSES': '2.4.9',
    'ACTIVE AND PASSIVE VOICE': '2.4.10', 'FIGURATIVE LANGUAGE': '2.4.11',
    'VOCABULARY': '2.4.12', 'TRANSLATION': '2.5.1',
  },
  'Form 3': {
    'CONVERSATIONS': '3.1.1', 'DRAMA': '3.1.2', 'RIDDLES': '3.1.3',
    'PUBLIC SPEAKING': '3.1.4',
    'INTENSIVE READING': '3.2.1', 'EXTENSIVE READING': '3.2.2',
    'STUDY SKILLS': '3.2.3',
    'COMPOSITION': '3.3.1', 'SUMMARY': '3.3.2', 'DICTATION': '3.3.3',
    'NOUNS': '3.4.1', 'VERBS': '3.4.2', 'PUNCTUATION': '3.4.3',
    'WORD BUILDING': '3.4.4', 'TENSES': '3.4.5', 'COMPARISON': '3.4.6',
    'DIRECT AND INDIRECT SPEECH': '3.4.7', 'SENTENCE': '3.4.8',
    'WORD RELATIONSHIPS': '3.4.9', 'FIGURATIVE LANGUAGE': '3.4.10',
    'VOCABULARY': '3.4.11', 'TRANSLATION': '3.5.1',
  },
  'Form 4': {
    'CONVERSATIONS': '4.1.1', 'PUBLIC SPEAKING': '4.1.2',
    'INTENSIVE READING': '4.2.1', 'EXTENSIVE READING': '4.2.2',
    'COMPOSITION': '4.3.1', 'SUMMARY': '4.3.2',
    'VERBS': '4.4.1', 'WORD BUILDING': '4.4.2', 'PUNCTUATION': '4.4.3',
    'INDIRECT SPEECH': '4.4.4', 'TENSES': '4.4.5', 'ADVERBIAL PHRASES': '4.4.6',
    'ADVERBIAL CLAUSES': '4.4.7', 'RELATIVE CLAUSES': '4.4.8',
    'WORD RELATIONSHIPS': '4.4.9', 'ACTIVE AND PASSIVE VOICES': '4.4.10',
    'FIGURATIVE LANGUAGE': '4.4.11', 'VOCABULARY': '4.4.12', 'TRANSLATION': '4.5.1',
  },
}

// Sub-topics the app groups under a different parent than the source. We KEEP
// the app grouping (and code positionally within it); listed here so the
// divergence is surfaced, not hidden.
const FLAGGED_DIVERGENCES = [
  'Form 1 · "Sayings" is grouped under Vocabulary in the app; the source lists it under Figurative Language (1.4.13.2). Kept under Vocabulary.',
  'Form 3 · "Advertisements" is grouped under Composition in the app; the source lists it under Summary. Kept under Composition.',
]

const CODE_LEAD = /^\s*(\d+(?:\.\d+)*)/

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const topicChanges = []
  const subtopicChanges = []
  const unmatched = []

  for (const [form, map] of Object.entries(TOPIC_CODES)) {
    const sheet = primary?.[SUBJECT]?.[form]
    if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${form} not found`)

    // Build topic groups: a data row with a non-blank TOPIC starts a group;
    // blank-TOPIC data rows continue the current group.
    const groups = []
    let current = null
    for (const row of sheet.rows) {
      if (row.type !== 'data') { current = null; continue }
      const topicRaw = String(row.cells?.TOPIC || '').trim()
      if (topicRaw) { current = { topicRow: row, rows: [row] }; groups.push(current) }
      else if (current) current.rows.push(row)
      else groups.push({ topicRow: row, rows: [row] }) // leading blank-topic row (defensive)
    }

    for (const g of groups) {
      const topicRaw = String(g.topicRow.cells?.TOPIC || '').trim()
      let topicCode
      if (CODE_LEAD.test(topicRaw)) {
        topicCode = topicRaw.match(CODE_LEAD)[1] // already coded — reuse for sub-topics
      } else if (topicRaw) {
        const code = map[topicRaw.toUpperCase()]
        if (!code) { unmatched.push(`${form}: TOPIC "${topicRaw}"`); continue }
        g.topicRow.cells.TOPIC = `${code} ${topicRaw}`
        topicChanges.push(`${form}: ${code} ${topicRaw}`)
        topicCode = code
      } else {
        continue
      }

      // Number sub-topics positionally within this topic, continuing after the
      // highest already-coded sibling index; repeated titles share a code.
      let maxIdx = 0
      for (const row of g.rows) {
        const m = String(row.cells?.['SUB-TOPIC'] || '').match(CODE_LEAD)
        if (m) {
          const seg = m[1].split('.')
          const last = Number(seg[seg.length - 1])
          if (Number.isFinite(last)) maxIdx = Math.max(maxIdx, last)
        }
      }
      const assigned = new Map()
      let next = maxIdx
      for (const row of g.rows) {
        const subRaw = String(row.cells?.['SUB-TOPIC'] || '')
        const title = subRaw.trim()
        if (!title) continue                 // blank sub-topic row — leave
        if (CODE_LEAD.test(title)) continue  // already coded — leave
        let idx
        if (assigned.has(title)) idx = assigned.get(title)
        else { idx = ++next; assigned.set(title, idx) }
        row.cells['SUB-TOPIC'] = `${topicCode}.${idx} ${title}`
        subtopicChanges.push(`${form}: ${topicCode}.${idx} ${title}`)
      }
    }
  }

  console.log(`\n=== Zambian Languages topic-code restore ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  console.log(`Topics coded (${topicChanges.length}):`)
  for (const t of topicChanges) console.log(`  ✓ ${t}`)
  console.log(`\nSub-topics coded (${subtopicChanges.length}):`)
  for (const s of subtopicChanges) console.log(`  ✓ ${s}`)
  if (unmatched.length) {
    console.log(`\n  ⚠ UNMATCHED topics (no source code — NOT changed):`)
    for (const u of unmatched) console.log(`    · ${u}`)
  }
  console.log(`\nFlagged app-vs-source grouping divergences (kept as-is):`)
  for (const f of FLAGGED_DIVERGENCES) console.log(`  ⚑ ${f}`)

  const total = topicChanges.length + subtopicChanges.length
  if (APPLY && total > 0) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && total > 0) {
    console.log('\nDry-run — re-run with --apply to write.')
  }
  return { topics: topicChanges.length, subtopics: subtopicChanges.length, unmatched: unmatched.length }
}

run()
