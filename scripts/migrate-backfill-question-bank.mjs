/**
 * One-off backfill: add existing learner-quiz + AI-exam-paper questions into the
 * Central Question Bank (`questionBank`), regraded to the CBC grade each question
 * actually belongs to (Grade 7 exam papers mix Grades 4–7).
 *
 * SAFE BY DEFAULT — dry-run, no writes, deterministic-only grading (free):
 *   GOOGLE_APPLICATION_CREDENTIALS=sa.json node scripts/migrate-backfill-question-bank.mjs
 *
 * Enable the AI grade fallback for topics the syllabus can't place uniquely
 * (needs ANTHROPIC_API_KEY; costs ~$0.002 per fallback question):
 *   … node scripts/migrate-backfill-question-bank.mjs --ai
 *
 * Actually write (a wave at a time is recommended — re-runs are idempotent):
 *   … node scripts/migrate-backfill-question-bank.mjs --live --ai --limit=200
 *
 * Flags:
 *   --live              perform writes (default: dry-run, read-only)
 *   --ai                enable the Haiku grade fallback (default: deterministic only)
 *   --limit=N           cap the number of questions processed
 *   --owner=<uid>       ownerId for the created rows (default: "system")
 *   --sources=a,b       which sources (default: quizzes,examPapers)
 *   --selftest          build the grade index + classify a couple of samples,
 *                       no Firestore (proves the syllabus index loads)
 *
 * Writing each row as reviewStatus:"pending_review" triggers the Qix Cloud
 * Function (embedding + Haiku review + dedup). The dry-run reports the projected
 * count so you can budget before going live.
 */

import { createRequire } from 'module'
import {
  sanitizeQuestionForBank, bankPreview, extractKeywords,
  questionFingerprint, questionTokens, REVIEW_STATUS, examPaperQuestionToBank,
} from '../src/utils/questionBankCore.js'

const require = createRequire(import.meta.url)
const { getCurriculumDataTopics } = require('../functions/teacherTools/syllabiCurriculumData.js')
const { buildGradeIndex } = require('../functions/teacherTools/gradeReclassifierCore.js')
const { classifyGrade } = require('../functions/teacherTools/gradeReclassifier.js')

const ARGV = process.argv.slice(2)
const LIVE = ARGV.includes('--live')
const USE_AI = ARGV.includes('--ai')
const SELFTEST = ARGV.includes('--selftest')
const arg = (name, dflt) => {
  const hit = ARGV.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : dflt
}
const LIMIT = Number(arg('limit', '')) || Infinity
const OWNER = arg('owner', 'system')
const SOURCES = String(arg('sources', 'quizzes,examPapers')).split(',').map((s) => s.trim())
const ANTHROPIC_KEY = USE_AI ? (process.env.ANTHROPIC_API_KEY || '') : ''

/* ----------------------------- shared helpers ----------------------------- */

function questionHasDiagram(q) {
  return Boolean(
    q?.imageUrl || q?.imageDiagram ||
    (Array.isArray(q?.diagramLabels) && q.diagramLabels.length) ||
    (Array.isArray(q?.optionMedia) && q.optionMedia.some((m) => m?.imageUrl || m?.diagram)),
  )
}

/** Build the admin-side questionBank row (mirrors buildBankRow in the client service). */
function buildRow(question, meta, source, grade, migratedFrom, FieldValue) {
  const clean = sanitizeQuestionForBank(question)
  return {
    ownerId: OWNER,
    data: JSON.stringify(clean),
    type: String(question.type || 'mcq'),
    subject: String(meta.subject || ''),
    grade: String(grade || meta.grade || ''),
    topic: String(meta.topic || question.topic || ''),
    subtopic: String(meta.subtopic || question.subtopic || ''),
    curriculum: 'CBC',
    difficulty: String(question.difficulty || ''),
    marks: Number(question.marks) || 1,
    preview: bankPreview(question),
    hasDiagram: questionHasDiagram(question),
    keywords: extractKeywords(question, meta),
    fingerprint: questionFingerprint(question),
    simhashTokens: questionTokens(question),
    source,
    reviewStatus: REVIEW_STATUS.PENDING_REVIEW,
    masterEligible: false,
    usageCount: 0,
    version: 1,
    migratedFrom,
    createdAt: FieldValue ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue ? FieldValue.serverTimestamp() : null,
  }
}

async function buildIndex() {
  try {
    const topics = await getCurriculumDataTopics(null, { framework: '2023' })
    const flat = []
    for (const t of topics || []) {
      if (t?.subject && t?.grade && t?.topic) flat.push({ subject: t.subject, grade: t.grade, topic: t.topic })
      for (const st of t?.subtopics || []) {
        const name = typeof st === 'string' ? st : st?.name
        if (name) flat.push({ subject: t.subject, grade: t.grade, topic: name })
      }
    }
    return buildGradeIndex(flat)
  } catch (err) {
    console.warn('⚠ Could not load syllabus topics — grade index empty, questions keep stored grade:', err.message)
    return new Map()
  }
}

/* -------------------------------- self test ------------------------------- */

async function runSelfTest() {
  const index = await buildIndex()
  console.log(`Grade index built: ${index.size} topic keys\n`)
  const samples = [
    { subject: 'mathematics', topic: 'Fractions', text: 'Add 1/2 + 1/4.', storedGrade: '7' },
    { subject: 'integrated_science', topic: 'Photosynthesis', text: 'What gas do plants release?', storedGrade: '7' },
    { subject: 'social_studies', topic: 'Unknown Topic XYZ', text: 'Name the capital of Zambia.', storedGrade: '7' },
  ]
  for (const s of samples) {
    const r = await classifyGrade(s, { index, anthropicKey: '' }) // no AI in selftest
    console.log(`  ${s.subject} / "${s.topic}" (stored ${s.storedGrade}) → grade ${r.grade} [${r.method}]`)
  }
  console.log('\nSelf-test complete (no Firestore touched).')
}

/* ------------------------------- the migration ---------------------------- */

const stats = {
  scanned: 0, mapped: 0, skippedEmpty: 0, skippedDup: 0, written: 0,
  regrade: { syllabus: 0, ai: 0, unchanged: 0, moved: 0 },
  bySource: {},
}

function note(source, grade, method, movedFrom) {
  stats.bySource[source] = (stats.bySource[source] || 0) + 1
  stats.regrade[method] = (stats.regrade[method] || 0) + 1
  if (movedFrom && String(movedFrom) !== String(grade)) stats.regrade.moved += 1
}

async function* iterateSource(db, source) {
  if (source === 'quizzes') {
    const quizzes = await db.collection('quizzes').where('isPublished', '==', true).get()
    for (const quiz of quizzes.docs) {
      const qd = quiz.data() || {}
      const meta = { subject: qd.subject, grade: qd.grade, topic: qd.topic }
      const qs = await quiz.ref.collection('questions').get()
      for (const q of qs.docs) {
        yield { question: q.data() || {}, meta, source: 'quiz_studio', parentId: quiz.id, questionId: q.id, collection: 'quizzes' }
      }
    }
  } else if (source === 'examPapers') {
    const gens = await db.collection('aiGenerations')
      .where('tool', '==', 'exam_paper').where('status', '==', 'done').get()
    for (const gen of gens.docs) {
      const gd = gen.data() || {}
      const inputs = gd.inputs || {}
      const meta = { subject: inputs.subject, grade: inputs.grade, topic: inputs.topic }
      const questions = (gd.output && Array.isArray(gd.output.questions)) ? gd.output.questions : []
      let i = 0
      for (const raw of questions) {
        const mapped = examPaperQuestionToBank(raw)
        i += 1
        if (mapped) yield { question: mapped, meta, source: 'exam_paper_studio', parentId: gen.id, questionId: `q${i}`, collection: 'aiGenerations' }
      }
    }
  }
}

async function fingerprintExists(db, fp, seen) {
  if (seen.has(fp)) return true
  seen.add(fp)
  const hit = await db.collection('questionBank').where('fingerprint', '==', fp).limit(1).get()
  return !hit.empty
}

async function runMigration() {
  const admin = (await import('firebase-admin')).default
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.')
    process.exit(1)
  }
  if (!admin.apps.length) admin.initializeApp()
  const db = admin.firestore()
  const FieldValue = admin.firestore.FieldValue

  const index = await buildIndex()
  console.log(`Grade index: ${index.size} topic keys. Mode: ${LIVE ? 'LIVE (writing)' : 'DRY-RUN (no writes)'}; AI fallback: ${USE_AI ? 'on' : 'off'}.\n`)

  const seen = new Set()
  let batch = LIVE ? db.batch() : null
  let batchOps = 0
  const samples = []

  for (const source of SOURCES) {
    for await (const item of iterateSource(db, source)) {
      if (stats.scanned >= LIMIT) break
      stats.scanned += 1
      const { question, meta } = item

      if (!bankPreview(question)) { stats.skippedEmpty += 1; continue }
      stats.mapped += 1

      const fp = questionFingerprint(question)
      if (await fingerprintExists(db, fp, seen)) { stats.skippedDup += 1; continue }

      const decided = await classifyGrade(
        { subject: meta.subject, topic: meta.topic || question.topic, text: question.text, options: question.options, storedGrade: meta.grade },
        { index, anthropicKey: ANTHROPIC_KEY },
      )
      note(item.source, decided.grade, decided.method, meta.grade)

      const row = buildRow(question, meta, item.source, decided.grade,
        { collection: item.collection, parentId: item.parentId, questionId: item.questionId }, FieldValue)

      if (samples.length < 5) samples.push({ preview: row.preview.slice(0, 70), grade: row.grade, method: decided.method, source: row.source })

      if (LIVE) {
        batch.set(db.collection('questionBank').doc(), row)
        batchOps += 1
        stats.written += 1
        if (batchOps >= 400) { await batch.commit(); batch = db.batch(); batchOps = 0 }
      }
    }
    if (stats.scanned >= LIMIT) break
  }
  if (LIVE && batchOps > 0) await batch.commit()

  if (LIVE) {
    await db.collection('backups').doc('questionBankBackfill').collection('runs').doc().set({
      at: FieldValue.serverTimestamp(), owner: OWNER, sources: SOURCES, stats,
    })
  }

  console.log('\n── Sample rows ──')
  for (const s of samples) console.log(`  [${s.source}] grade ${s.grade} (${s.method}) — ${s.preview}…`)
  console.log('\n── Summary ──')
  console.log(JSON.stringify(stats, null, 2))
  const wouldWrite = stats.mapped - stats.skippedDup
  console.log(`\n${LIVE ? `Wrote ${stats.written} questions.` : `DRY-RUN: would write ~${wouldWrite} questions`} → each triggers Qix (≈ $0.002 review). ${LIVE ? '' : 'Re-run with --live to apply.'}`)
}

/* --------------------------------- entry ---------------------------------- */

const invokedDirectly = import.meta.url.endsWith(process.argv[1]?.split(/[\\/]/).pop() ?? '')
if (invokedDirectly) {
  if (SELFTEST) await runSelfTest()
  else await runMigration()
}
