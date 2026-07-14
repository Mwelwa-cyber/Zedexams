#!/usr/bin/env node
/**
 * check-curriculum-overrides.mjs
 * ==============================
 * Reports any Firestore syllabus OVERRIDE that could shadow or conflict with
 * the concatenation repair applied to public/syllabi/curriculum-data.json.
 *
 * Why this matters: getMergedSyllabi() overlays admin overrides
 * (cbcKnowledgeBase/{activeVersion}/syllabusOverrides/*) on top of the static
 * JSON, matching a row by its (topic, subtopic) VALUES. The repair changed
 * those values on 13 rows, so:
 *   • an override keyed to the OLD combined label no longer matches the
 *     repaired row and, via applyOverrides' `!matched` fallback, may be
 *     re-inserted as a PHANTOM row (stale — should be deleted or re-keyed);
 *   • an override keyed to the NEW split value is fine (informational).
 *
 * Read-only. Requires firebase-admin + credentials (same convention as the
 * other admin scripts):
 *   npm install --save-dev firebase-admin
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json \
 *     node scripts/check-curriculum-overrides.mjs
 *
 * Optional: pass a version id to check a specific KB version instead of the
 * active one:  node scripts/check-curriculum-overrides.mjs --version cbc-kb-xxxx
 */

const DEFAULT_VERSION = 'cbc-kb-2026-04-seed' // fallback when _meta has no pointer

// The 13 repaired rows, by {subject, sheet}. `oldValues` are the strings an
// existing override would have been keyed to BEFORE the repair; `newValues`
// are what the row carries now. Matching an override's topic/subtopic against
// either (case-insensitive) tells us whether it is stale or current.
const REPAIRED = [
  { subject: 'Agricultural Science Syllabus (Forms 1-4)', sheet: 'Form 2',
    oldValues: ['2.3 CLIMATE- SMART AGRICULTURE 2.3.I Climate Change Impact on Agriculture and Food Security'],
    newValues: ['2.3 Climate- Smart Agriculture'] },
  { subject: 'Agricultural Science Syllabus (Forms 1-4)', sheet: 'Form 3',
    oldValues: ['3.4 CROP PRODUCTION 3.4.1 Fruit and Tuber Crop Production'],
    newValues: ['3.4 Crop Production'] },
  { subject: 'Agricultural Science Syllabus (Forms 1-4)', sheet: 'Form 4',
    oldValues: ['4.3 CROP PRODUCTION 4.3.1 Legume Crop Production'],
    newValues: ['4.3 Crop Production'] },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 1',
    oldValues: ['1.2.1 COMPREHENSION 1.2.1.1. Listening Comprehension',
      '1.3.4 LETTER WRITING 1.3.4.1. Informal Letter',
      '1.4.20 SENSE RELATIONS 1.4.20.1. Antonyms'],
    newValues: ['1.2.1 Comprehension', '1.2.1.1 Listening Comprehension',
      '1.3.4 Letter Writing', '1.3.4.1 Informal Letter',
      '1.4.20 Sense Relations', '1.4.20.1 Antonyms'] },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2',
    oldValues: ['2.1.3 ANNOUNCEMENTS 2.1.3.1. Making Announcements',
      '2.1.9.2 Making an Offer 2.1.9.2.1. Use appropriate language to make an offer',
      '2.5.1.1 Title Summary 2.5.1.1.1. Compose titles'],
    newValues: ['2.1.3 Announcements', '2.1.3.1 Making Announcements',
      '2.1.9.2 Making an Offer', '2.5.1.1 Title Summary'] },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3',
    oldValues: ['3.3.9 EXPOSITORY 3.3.9.1. Expository Writing',
      '3.2.1.2 Efficient Reading 3.2.1.2.1. Read texts with understanding',
      '3.2.1.3 Intensive Reading 3.2.1.3.1. Read texts with comprehension',
      '3.4.2.1 Adverbs as Relatives 3.4.2.1.1. Use adverbs as relative pronouns'],
    newValues: ['3.3.9 Expository', '3.3.9.1 Expository Writing',
      '3.2.1.2 Efficient Reading', '3.2.1.3 Intensive Reading',
      '3.4.2.1 Adverbs as Relatives'] },
]

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
const hasCombinedLabel = (s) => ((String(s || '').match(/\d+(?:\.\d+)+/g) || []).length > 1)

function versionArg() {
  const i = process.argv.indexOf('--version')
  return i >= 0 ? process.argv[i + 1] : null
}

async function main() {
  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('ERROR: run `npm install --save-dev firebase-admin` first.')
    process.exit(1)
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.')
    process.exit(1)
  }
  admin.default.initializeApp()
  const db = admin.default.firestore()

  let version = versionArg()
  if (!version) {
    const meta = await db.doc('cbcKnowledgeBase/_meta').get()
    version = (meta.exists && typeof meta.data().version === 'string' && meta.data().version) || DEFAULT_VERSION
  }
  console.log(`Active KB version: ${version}`)
  console.log(`Reading cbcKnowledgeBase/${version}/syllabusOverrides …\n`)

  const snap = await db.collection('cbcKnowledgeBase').doc(version).collection('syllabusOverrides').get()
  console.log(`Total overrides in this version: ${snap.size}\n`)

  const repairedKey = new Map(REPAIRED.map((r) => [`${r.subject}||${r.sheet}`, r]))
  const stale = []
  const current = []
  const combinedElsewhere = []

  for (const doc of snap.docs) {
    const ov = { id: doc.id, ...doc.data() }
    const key = `${ov.studioSubject}||${ov.sheet}`
    const fields = [ov.topic, ov.subtopic, ov.cells?.TOPIC, ov.cells?.['SUB-TOPIC'], ov.cells?.SUBTOPIC].filter(Boolean)
    const r = repairedKey.get(key)
    if (r) {
      const matchesOld = fields.some((f) => r.oldValues.some((o) => norm(o) === norm(f)))
      const matchesNew = fields.some((f) => r.newValues.some((n) => norm(n) === norm(f)))
      if (matchesOld) stale.push({ ov, kind: ov.deleted ? 'deleted' : ov.inserted ? 'inserted' : 'edited' })
      else if (matchesNew) current.push({ ov })
    }
    // Any override anywhere whose topic/subtopic is ITSELF a combined label.
    if (fields.some(hasCombinedLabel)) combinedElsewhere.push(ov)
  }

  console.log('── STALE overrides keyed to an OLD combined value (ACTION: delete or re-key) ──')
  if (!stale.length) console.log('   none ✅')
  for (const { ov, kind } of stale) {
    console.log(`   • ${ov.id} [${ov.studioSubject} / ${ov.sheet}] kind=${kind}`)
    console.log(`       topic=${JSON.stringify(ov.topic)} subtopic=${JSON.stringify(ov.subtopic)}`)
  }

  console.log('\n── Overrides already keyed to the NEW split value (fine, informational) ──')
  if (!current.length) console.log('   none')
  for (const { ov } of current) console.log(`   • ${ov.id} [${ov.studioSubject} / ${ov.sheet}] topic=${JSON.stringify(ov.topic)}`)

  console.log('\n── Any override whose topic/subtopic is itself a combined label (review) ──')
  if (!combinedElsewhere.length) console.log('   none ✅')
  for (const ov of combinedElsewhere) {
    console.log(`   • ${ov.id} [${ov.studioSubject} / ${ov.sheet}] topic=${JSON.stringify(ov.topic)} subtopic=${JSON.stringify(ov.subtopic)}`)
  }

  console.log(`\nSummary: ${stale.length} stale, ${current.length} current, ${combinedElsewhere.length} combined-label override(s).`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
