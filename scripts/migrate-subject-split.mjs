/**
 * Compatibility migration for the 2026-07 subject split.
 *
 *   commerce_and_principles_of_accounts → commerce | principles_of_accounts
 *   home_economics (senior secondary)   → food_and_nutrition | home_management
 *                                       | fashion_and_fabrics
 *                                       | hospitality_management
 *   mathematics (Forms 1-4)             → mathematics_ii, when its topics say so
 *
 *   node scripts/migrate-subject-split.mjs              # DRY RUN (default)
 *   node scripts/migrate-subject-split.mjs --apply      # write the changes
 *   node scripts/migrate-subject-split.mjs --json       # machine-readable report
 *   node scripts/migrate-subject-split.mjs --only=assessments,aiGenerations
 *   node scripts/migrate-subject-split.mjs --fixtures=path.json   # no Firestore
 *
 * DRY RUN IS THE DEFAULT and --apply is the only way to write. Nothing here
 * deletes, merges or rewrites curriculum content: it only changes the subject
 * KEY a teacher's own record is filed under, and only when the record's own
 * topics say which subject it is.
 *
 * A record that cannot be classified is REPORTED, never assigned. That is the
 * point: guessing would move somebody's paper into a syllabus it was not written
 * against, and the teacher would have no way to know.
 *
 * The eight record families, and where they actually live:
 *
 *   saved assessments    assessments/{id}
 *   AI generations       aiGenerations/{id}                (inputs.subject)
 *   schemes of work      aiGenerations/{id} tool=scheme_of_work
 *   lesson plans         aiGenerations/{id} tool=lesson_plan
 *   weekly focus         aiGenerations/{id} tool=weekly_forecast
 *   topic references     questionBank/{id}, quizzes/{id}
 *   teacher assignments  teacherProfiles/{uid}/teachingAssignments/{id}
 *   syllabus selections  teacherProfiles/{uid}          (default/current pick)
 *
 * The three aiGenerations families share one collection, so they are counted
 * per `tool` in the report rather than scanned three times.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  classifyRecord, buildTopicSubjectIndex, buildSubjectPresence, resolveGradeCode,
  OUTCOMES, SPLIT_SOURCES,
} from '../src/utils/subjectSplitClassifier.js'
import { syllabiToKbTopics } from '../src/utils/syllabusMapping.js'
import { extract2013TopicLookup } from '../src/utils/syllabus2013Topics.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : ''
}

const APPLY = has('--apply')
const AS_JSON = has('--json')
const ONLY = new Set(valueOf('--only').split(',').map((s) => s.trim()).filter(Boolean))
const FIXTURES = valueOf('--fixtures')

/* ── the topic index the classifier reasons from ─────────────────────────── */

function loadTopicIndex() {
  const index = new Map()
  const presence = new Set()
  const cbcFile = path.join(ROOT, 'public/syllabi/curriculum-data.json')
  const prevFile = path.join(ROOT, 'public/syllabi/curriculum-data-2013.json')

  if (existsSync(cbcFile)) {
    const topics = syllabiToKbTopics(JSON.parse(readFileSync(cbcFile, 'utf8')))
    buildTopicSubjectIndex(topics, 'cbc', index)
    buildSubjectPresence(topics, 'cbc', presence)
  }
  if (existsSync(prevFile)) {
    // The 2013 extractor yields "GRADE|subject" → Map<topic, subs>; flatten it
    // to the {grade, subject, topic} shape the index builder takes.
    const lookup = extract2013TopicLookup(JSON.parse(readFileSync(prevFile, 'utf8')))
    const flat = []
    for (const [key, inner] of lookup) {
      const [grade, subject] = String(key).split('|')
      for (const topic of inner.keys()) flat.push({ grade, subject, topic })
    }
    buildTopicSubjectIndex(flat, 'previous', index)
    buildSubjectPresence(flat, 'previous', presence)
  }
  return { index, presence }
}

/* ── the record families ─────────────────────────────────────────────────── */

/**
 * `subjectPath` is where the subject key lives; `groupBy` splits the report for
 * collections that hold several families (aiGenerations holds schemes of work,
 * lesson plans and weekly focus alongside everything else).
 */
const FAMILIES = [
  { id: 'assessments', label: 'Saved assessments', collection: 'assessments', subjectPath: 'subject' },
  { id: 'aiGenerations', label: 'AI generations', collection: 'aiGenerations', subjectPath: 'inputs.subject', groupBy: 'tool' },
  { id: 'questionBank', label: 'Topic references (question bank)', collection: 'questionBank', subjectPath: 'subject' },
  { id: 'quizzes', label: 'Topic references (quizzes)', collection: 'quizzes', subjectPath: 'subject' },
  {
    id: 'teachingAssignments',
    label: 'Teacher assignments',
    collectionGroup: 'teachingAssignments',
    subjectPath: 'subject',
  },
  {
    id: 'syllabusSelections',
    label: 'Syllabus selections (teacher profiles)',
    collection: 'teacherProfiles',
    subjectPath: 'defaultSubject',
    alsoPaths: ['currentSubject', 'syllabusSubject'],
  },
]

function readPath(doc, dotted) {
  return String(dotted).split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), doc)
}

/* ── classification over one document ────────────────────────────────────── */

function inspect(doc, family, topicIndex, subjectPresence) {
  const paths = [family.subjectPath, ...(family.alsoPaths || [])]
  const results = []
  for (const p of paths) {
    const subject = readPath(doc, p)
    if (!subject || !SPLIT_SOURCES[String(subject).toLowerCase()]) continue
    const verdict = classifyRecord(
      {
        ...doc,
        subject,
        grade: readPath(doc, 'grade') ?? readPath(doc, 'inputs.grade') ?? readPath(doc, 'meta.grade'),
        curriculum: readPath(doc, 'curriculum') ?? readPath(doc, 'framework')
          ?? readPath(doc, 'inputs.framework') ?? readPath(doc, 'curriculumType'),
      },
      { topicIndex, subjectPresence, gradeResolver: resolveGradeCode },
    )
    results.push({ path: p, ...verdict })
  }
  return results
}

/* ── orphan detection ────────────────────────────────────────────────────── */

/**
 * A reference becomes orphaned when its record moves subject but the topic it
 * names does not exist under the new subject — i.e. reassigning the key would
 * leave it pointing at nothing. Reported, and (in --apply) the record is skipped
 * rather than moved, because a moved record with dangling topics is worse than
 * one still on the old key.
 */
function wouldOrphan(doc, verdict, topicIndex) {
  if (verdict.outcome !== OUTCOMES.CLASSIFIED) return false
  if (verdict.topicsSeen === 0) return false
  return verdict.topicsResolved === 0
}

/* ── Firestore / fixtures ────────────────────────────────────────────────── */

async function loadDocs(family) {
  if (FIXTURES) {
    const all = JSON.parse(readFileSync(path.resolve(ROOT, FIXTURES), 'utf8'))
    return (all[family.id] || []).map((data, i) => ({ id: data.id || `fixture-${i}`, data, ref: null }))
  }
  const admin = await import('firebase-admin')
  if (!admin.default.apps.length) admin.default.initializeApp()
  const db = admin.default.firestore()
  const snap = family.collectionGroup
    ? await db.collectionGroup(family.collectionGroup).get()
    : await db.collection(family.collection).get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data(), ref: d.ref }))
}

/* ── run ─────────────────────────────────────────────────────────────────── */

// Families whose records have no topics by nature — a classifier cannot help
// them and pretending otherwise would misreport the run.
const TOPICLESS_FAMILIES = ['teachingAssignments', 'syllabusSelections']

const report = {
  mode: APPLY ? 'apply' : 'dry-run',
  totals: { inspected: 0, classified: 0, ambiguous: 0, unchanged: 0, orphanRisk: 0, written: 0 },
  families: [],
  ambiguousRecords: [],
  orphanRecords: [],
}

const { index: topicIndex, presence: subjectPresence } = loadTopicIndex()

for (const family of FAMILIES) {
  if (ONLY.size && !ONLY.has(family.id)) continue

  let docs
  try {
    docs = await loadDocs(family)
  } catch (err) {
    report.families.push({
      id: family.id, label: family.label, error: err.message,
      inspected: 0, classified: 0, ambiguous: 0, unchanged: 0, orphanRisk: 0,
    })
    continue
  }

  const stats = {
    id: family.id, label: family.label, error: '',
    inspected: docs.length, candidates: 0, classified: 0, ambiguous: 0,
    unchanged: 0, orphanRisk: 0, written: 0, byGroup: {},
  }

  for (const doc of docs) {
    const verdicts = inspect(doc.data, family, topicIndex, subjectPresence)
    if (!verdicts.length) continue
    stats.candidates += 1
    const group = family.groupBy ? String(readPath(doc.data, family.groupBy) || 'unknown') : ''
    if (group) {
      stats.byGroup[group] = stats.byGroup[group] || { candidates: 0, classified: 0, ambiguous: 0, unchanged: 0 }
      stats.byGroup[group].candidates += 1
    }

    for (const verdict of verdicts) {
      const orphan = wouldOrphan(doc.data, verdict, topicIndex)
      if (orphan) {
        stats.orphanRisk += 1
        report.orphanRecords.push({
          family: family.id, id: doc.id, path: verdict.path,
          from: verdict.from, to: verdict.subject, evidence: verdict.evidence,
        })
        continue
      }
      if (verdict.outcome === OUTCOMES.CLASSIFIED) {
        stats.classified += 1
        if (group) stats.byGroup[group].classified += 1
        if (APPLY && doc.ref) {
          await doc.ref.update({
            [verdict.path]: verdict.subject,
            subjectSplitMigration: {
              from: verdict.from, to: verdict.subject, evidence: verdict.evidence, at: new Date().toISOString(),
            },
          })
          stats.written += 1
        }
      } else if (verdict.outcome === OUTCOMES.AMBIGUOUS) {
        stats.ambiguous += 1
        if (group) stats.byGroup[group].ambiguous += 1
        report.ambiguousRecords.push({
          family: family.id, id: doc.id, path: verdict.path, from: verdict.from,
          candidates: verdict.candidates, topicsSeen: verdict.topicsSeen,
          reason: verdict.evidence,
        })
      } else if (verdict.outcome === OUTCOMES.UNCHANGED) {
        stats.unchanged += 1
        if (group) stats.byGroup[group].unchanged += 1
      }
    }
  }

  report.families.push(stats)
  report.totals.inspected += stats.inspected
  report.totals.classified += stats.classified
  report.totals.ambiguous += stats.ambiguous
  report.totals.unchanged += stats.unchanged
  report.totals.orphanRisk += stats.orphanRisk
  report.totals.written += stats.written
}

/* ── output ──────────────────────────────────────────────────────────────── */

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`\nSubject-split migration — ${report.mode.toUpperCase()}\n`)
  console.log(`  ${pad('Family', 38)}${pad('seen', 8)}${pad('on old key', 12)}${pad('classified', 12)}${pad('ambiguous', 11)}${pad('unchanged', 11)}orphan risk`)
  console.log(`  ${'─'.repeat(100)}`)
  for (const f of report.families) {
    if (f.error) {
      console.log(`  ${pad(f.label, 38)}could not read: ${f.error}`)
      continue
    }
    console.log(`  ${pad(f.label, 38)}${pad(f.inspected, 8)}${pad(f.candidates, 12)}${pad(f.classified, 12)}${pad(f.ambiguous, 11)}${pad(f.unchanged, 11)}${f.orphanRisk}`)
    for (const [group, g] of Object.entries(f.byGroup || {})) {
      if (!g.candidates) continue
      console.log(`      ${pad(`· ${group}`, 34)}${pad('', 8)}${pad(g.candidates, 12)}${pad(g.classified, 12)}${pad(g.ambiguous, 11)}${g.unchanged}`)
    }
  }
  const t = report.totals
  console.log(`\n  Records inspected:            ${t.inspected}`)
  console.log(`  Classified automatically:     ${t.classified}`)
  console.log(`  Ambiguous (need review):      ${t.ambiguous}`)
  console.log(`  Unchanged (already correct):  ${t.unchanged}`)
  console.log(`  References that would orphan: ${t.orphanRisk}`)
  if (APPLY) console.log(`  Written:                      ${t.written}`)

  if (TOPICLESS_FAMILIES.some((id) => report.families.some((f) => f.id === id && f.candidates))) {
    console.log(
      `\n  Note: teacher assignments and syllabus selections carry no topics, so a\n` +
      `  script has nothing to classify them from. They resolve where they were made:\n` +
      `  the studio now rejects a key that names several subjects — the retired\n` +
      `  Commerce workbook everywhere, Home Economics at CBC Forms 1-4 — and asks the\n` +
      `  teacher which subject it is (see validateAssignment). They are listed below as\n` +
      `  ambiguous because that is what they are — not because the run failed.`,
    )
  }

  if (report.ambiguousRecords.length) {
    console.log(`\n  Ambiguous records — assign these by hand, never in bulk:`)
    for (const r of report.ambiguousRecords.slice(0, 40)) {
      console.log(`    ${r.family}/${r.id}  ${r.from} → ? (${r.candidates.join(' | ')})`)
      console.log(`        ${r.reason}`)
    }
    if (report.ambiguousRecords.length > 40) {
      console.log(`    … and ${report.ambiguousRecords.length - 40} more (use --json for the full list)`)
    }
  }
  if (report.orphanRecords.length) {
    console.log(`\n  Would orphan their topic references — left on the old key:`)
    for (const r of report.orphanRecords.slice(0, 20)) {
      console.log(`    ${r.family}/${r.id}  ${r.from} → ${r.to}: ${r.evidence}`)
    }
  }
  console.log(
    APPLY
      ? '\nApplied. Each changed record carries a subjectSplitMigration audit stamp.\n'
      : '\nDry run — nothing was written. Re-run with --apply to commit these changes.\n',
  )
}
