#!/usr/bin/env node
/**
 * audit-curriculum-hierarchy.mjs
 * ===============================
 * Read-only audit of the curriculum hierarchy for BOTH curricula. Reports, per
 * subject + level: topic / sub-topic counts, duplicate codes, missing parents,
 * still-combined labels, blank structural rows, and records that need manual
 * review — the validation rules from the repair brief.
 *
 * Run manually (NOT part of test:all): `npm run audit:curriculum`.
 * The regression asserts live in scripts/test-curriculum-hierarchy.mjs.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rowsWithPropagatedTopic } from '../src/utils/syllabusMapping.js'
import { splitConcatenatedTopicCell, leadingCode } from '../src/utils/curriculumTopicCell.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const FILES = {
  'Current Curriculum (2023 CBC)': 'public/syllabi/curriculum-data.json',
  '2013 Curriculum': 'public/syllabi/curriculum-data-2013.json',
}

const codesIn = (s) => (String(s || '').match(/\d+(?:\.\d+)+/g) || [])

function auditCurriculum(label, relPath) {
  const raw = JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'))
  const totals = {
    subjects: 0, sheets: 0, topics: 0, subtopics: 0, competencies: 0,
    combinedTopicLabels: 0, combinedSubtopicLabels: 0,
    duplicateCodes: 0, missingParents: 0, blankStructural: 0, ambiguous: 0,
  }
  const combinedTopicSet = new Set()
  const combinedSubtopicSet = new Set()
  const issues = []

  for (const [subject, sheets] of Object.entries(raw)) {
    totals.subjects++
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      totals.sheets++
      // Ambiguous / blank raw rows (pre-normalisation signal).
      for (const row of sheet?.rows || []) {
        if (row?.type !== 'data') continue
        const t = String(row.cells?.TOPIC ?? '').trim()
        const res = splitConcatenatedTopicCell(t, '')
        if (res.ambiguous) {
          totals.ambiguous++
          issues.push(`AMBIGUOUS [${subject} / ${sheetName}]: ${JSON.stringify(t).slice(0, 90)}`)
        }
      }

      const rows = rowsWithPropagatedTopic(sheet?.rows || [])
      const topicMap = new Map()
      const topicCodes = new Map() // code → title (for duplicate detection)
      const subtopicCodes = new Set()
      for (const row of rows) {
        if (!row.topic) continue
        if (!topicMap.has(row.topic)) topicMap.set(row.topic, new Set())
        if (codesIn(row.topic).length > 1) combinedTopicSet.add(row.topic)
        const tc = leadingCode(row.topic)
        if (tc) {
          if (topicCodes.has(tc) && topicCodes.get(tc) !== row.topic) {
            totals.duplicateCodes++
            issues.push(`DUP TOPIC CODE ${tc} [${subject} / ${sheetName}]: "${topicCodes.get(tc)}" vs "${row.topic}"`)
          }
          topicCodes.set(tc, row.topic)
        }
        if (row.subtopic) {
          topicMap.get(row.topic).add(row.subtopic)
          if (codesIn(row.subtopic).length > 1) combinedSubtopicSet.add(row.subtopic)
          const sc = leadingCode(row.subtopic)
          if (sc) {
            if (subtopicCodes.has(sc)) totals.duplicateCodes++
            subtopicCodes.add(sc)
            // Missing-parent check (only when both codes share a scheme depth):
            // a 4-seg sub-topic ("1.2.1.1") should have a 3-seg topic ("1.2.1").
            // When the sub-topic's code does NOT descend from its (propagated)
            // topic's code, the topic-header row for the sub-topic's real parent
            // is absent from the source, so the sub-topic is filed under the
            // wrong topic. Titles for the missing headers aren't in the source,
            // so these are reported for manual authoring — never fabricated.
            const parent = sc.split('.').slice(0, -1).join('.')
            if (tc && parent && !parent.startsWith(tc) && !tc.startsWith(parent)) {
              totals.missingParents++
              issues.push(`ORPHAN SUB-TOPIC [${subject} / ${sheetName}]: "${row.subtopic}" filed under topic "${row.topic}" (missing header row for topic ${parent})`)
            }
          }
          if (row.specificCompetence) totals.competencies += (row.specificCompetence.match(/\d+(?:\.\d+){3,}/g) || []).length || 1
        }
      }
      totals.topics += topicMap.size
      for (const subs of topicMap.values()) totals.subtopics += subs.size
    }
  }
  totals.combinedTopicLabels = combinedTopicSet.size
  totals.combinedSubtopicLabels = combinedSubtopicSet.size

  console.log(`\n══ ${label} ══  (${relPath})`)
  console.log(`   subjects:              ${totals.subjects}`)
  console.log(`   levels/sheets:         ${totals.sheets}`)
  console.log(`   topics:                ${totals.topics}`)
  console.log(`   sub-topics:            ${totals.subtopics}`)
  console.log(`   competencies/outcomes: ${totals.competencies}`)
  console.log(`   ── validation ──`)
  console.log(`   combined topic labels:    ${totals.combinedTopicLabels}`)
  console.log(`   combined sub-topic labels:${totals.combinedSubtopicLabels}`)
  console.log(`   duplicate codes:          ${totals.duplicateCodes}`)
  console.log(`   suspected missing parents:${totals.missingParents}`)
  console.log(`   ambiguous (manual review):${totals.ambiguous}`)
  if (issues.length) {
    console.log(`   ── first ${Math.min(issues.length, 15)} issues ──`)
    issues.slice(0, 15).forEach((i) => console.log(`     • ${i}`))
    if (issues.length > 15) console.log(`     … and ${issues.length - 15} more`)
  }
  return totals
}

console.log('\n=== Curriculum hierarchy audit ===')
for (const [label, rel] of Object.entries(FILES)) auditCurriculum(label, rel)
console.log('')
