#!/usr/bin/env node
/**
 * repair-curriculum-hierarchy.mjs
 * ================================
 * Idempotent repair of CONCATENATED topic cells in the curriculum source JSON.
 *
 * A PDF-extraction artefact glued a topic heading and its first sub-topic into
 * one `TOPIC` cell and left the `SUB-TOPIC` cell empty, e.g.
 *
 *   TOPIC="1.2.1 COMPREHENSION 1.2.1.1. Listening Comprehension"  SUB-TOPIC=""
 *
 * This script walks every subject / sheet / row of both curriculum files and
 * uses the SHARED splitConcatenatedTopicCell classifier (the same one the
 * runtime picker normaliser uses) to separate the two, writing the topic back
 * to TOPIC and the recovered sub-topic to the sheet's sub-topic column ONLY when
 * it was empty. It never guesses: ambiguous cells (two sibling codes, three+
 * codes) are left untouched and listed in a manual-review report.
 *
 * Safe by construction:
 *   • dry-run by default — prints the change report, writes nothing
 *   • --apply           — writes a timestamped .bak, then the repaired JSON
 *   • idempotent        — re-running after --apply reports 0 changes
 *
 * Usage:
 *   node scripts/repair-curriculum-hierarchy.mjs            # dry-run (default)
 *   node scripts/repair-curriculum-hierarchy.mjs --apply    # write changes
 *   node scripts/repair-curriculum-hierarchy.mjs --json     # machine report
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { splitConcatenatedTopicCell } from '../src/utils/curriculumTopicCell.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Only the current (2023 CBC) curriculum is REPAIRED here: its runtime
// normaliser (rowsWithPropagatedTopic) reads sheet cells directly, so the
// concatenation must be fixed in the source. The 2013 curriculum has its own
// schema-adaptive runtime parser (curriculum2013Parser / propagatePreviousRows)
// that already splits glued outcomes at read-time, so its source is left as
// read-only reference — its issues are surfaced by scripts/audit-curriculum-hierarchy.mjs
// rather than mutated here (where a naive split would risk data loss).
const TARGETS = [
  { label: 'current (2023 CBC)', files: ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json'] },
]

const APPLY = process.argv.includes('--apply')
const AS_JSON = process.argv.includes('--json')

function subtopicColumnOf(sheet) {
  const cols = Array.isArray(sheet?.columns) ? sheet.columns : []
  return cols.find((c) => /sub[\s_-]*topic/i.test(String(c || ''))) || 'SUB-TOPIC'
}

function competenceColumnOf(sheet) {
  const cols = Array.isArray(sheet?.columns) ? sheet.columns : []
  return cols.find((c) => /competenc|outcome/i.test(String(c || ''))) ||
    'SPECIFIC COMPETENCES'
}

/** Repair one parsed curriculum object in place. Returns {changes[], review[]}. */
function repairCurriculum(data) {
  const changes = []
  const review = []
  for (const [subject, sheets] of Object.entries(data || {})) {
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const subCol = subtopicColumnOf(sheet)
      const compCol = competenceColumnOf(sheet)
      for (let i = 0; i < (sheet?.rows || []).length; i++) {
        const row = sheet.rows[i]
        if (row?.type !== 'data') continue
        const cells = row.cells || {}

        // (1) TOPIC cell glued a topic + its first sub-topic.
        const topicCell = String(cells.TOPIC ?? '').trim()
        if (topicCell) {
          const subCell = String(cells[subCol] ?? cells['SUB-TOPIC'] ?? cells.SUBTOPIC ?? '').trim()
          const res = splitConcatenatedTopicCell(topicCell, subCell)
          if (res.ambiguous) {
            review.push({ subject, sheet: sheetName, rowIndex: i, field: 'TOPIC', topic: topicCell, subtopic: subCell, reason: 'multiple/sibling codes — cannot split safely' })
          } else if (res.split) {
            changes.push({
              subject, sheet: sheetName, rowIndex: i, field: 'TOPIC',
              before: { topic: topicCell, subtopic: subCell || '(empty)' },
              after: { topic: res.topic, subtopic: res.subtopic },
            })
            cells.TOPIC = res.topic
            if (!subCell) cells[subCol] = res.subtopic
          }
        }

        // (2) SUB-TOPIC cell glued a sub-topic + its first specific competence
        //     (same bug one tier down: "2.1.9.2 Making an Offer 2.1.9.2.1 …").
        const subCell2 = String(cells[subCol] ?? cells['SUB-TOPIC'] ?? cells.SUBTOPIC ?? '').trim()
        if (subCell2) {
          const compCell = String(cells[compCol] ?? cells['SPECIFIC COMPETENCES'] ?? '').trim()
          const res2 = splitConcatenatedTopicCell(subCell2, compCell)
          if (res2.ambiguous) {
            review.push({ subject, sheet: sheetName, rowIndex: i, field: 'SUB-TOPIC', topic: subCell2, subtopic: compCell, reason: 'sub-topic cell holds multiple/sibling codes — cannot split safely' })
          } else if (res2.split) {
            changes.push({
              subject, sheet: sheetName, rowIndex: i, field: 'SUB-TOPIC',
              before: { topic: subCell2, subtopic: compCell || '(empty)' },
              after: { topic: res2.topic, subtopic: res2.subtopic },
            })
            cells[subCol] = res2.topic
            if (!compCell) cells[compCol] = res2.subtopic
          }
        }
        row.cells = cells
      }
    }
  }
  return { changes, review }
}

const report = { targets: [], totalChanges: 0, totalReview: 0 }

for (const target of TARGETS) {
  const primaryPath = join(ROOT, target.files[0])
  const data = JSON.parse(readFileSync(primaryPath, 'utf8'))
  const { changes, review } = repairCurriculum(data)
  report.totalChanges += changes.length
  report.totalReview += review.length
  report.targets.push({ label: target.label, files: target.files, changes, review })

  if (APPLY && changes.length > 0) {
    const serialized = JSON.stringify(data, null, 2) + '\n'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    for (const rel of target.files) {
      const abs = join(ROOT, rel)
      // Back up the current file, then write the repaired copy. Both file
      // copies of a framework get the SAME repaired JSON (they must stay
      // byte-identical — see CLAUDE.md).
      const current = readFileSync(abs, 'utf8')
      writeFileSync(`${abs}.${stamp}.bak`, current)
      writeFileSync(abs, serialized)
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

console.log('\n=== Curriculum hierarchy repair ' + (APPLY ? '(APPLIED)' : '(DRY-RUN)') + ' ===\n')
for (const t of report.targets) {
  console.log(`── ${t.label} ──`)
  console.log(`   files: ${t.files.join(', ')}`)
  console.log(`   concatenated rows repaired: ${t.changes.length}`)
  for (const c of t.changes) {
    console.log(`     • [${c.subject} / ${c.sheet}] row ${c.rowIndex} (${c.field} cell)`)
    console.log(`         parent:  ${JSON.stringify(c.before.topic)}`)
    console.log(`              →   ${JSON.stringify(c.after.topic)}`)
    console.log(`         child:   ${JSON.stringify(c.before.subtopic)} → ${JSON.stringify(c.after.subtopic)}`)
  }
  if (t.review.length) {
    console.log(`   ⚠ manual review (left untouched): ${t.review.length}`)
    for (const r of t.review) {
      console.log(`     • [${r.subject} / ${r.sheet}] row ${r.rowIndex} (${r.field} cell): ${r.reason}`)
      console.log(`         value: ${JSON.stringify(r.topic)}`)
      if (r.subtopic) console.log(`         next:  ${JSON.stringify(r.subtopic)}`)
    }
  }
  console.log('')
}
console.log(`TOTAL: ${report.totalChanges} repaired, ${report.totalReview} for manual review`)
if (!APPLY && report.totalChanges > 0) {
  console.log('\nDry-run only — re-run with --apply to write the changes (a .bak is saved first).')
}
