/**
 * Admin one-click backfill: import existing learner-quiz + AI-exam-paper
 * questions into the Central Question Bank, regraded to the CBC grade each
 * question belongs to (Grade 7 exam papers mix Grades 4–7).
 *
 * Runs entirely in the admin's browser, reusing the live capture path
 * (`captureQuestionsToBank`) so fingerprints/dedup stay consistent. The grade
 * is decided deterministically from the curriculum topic lists; the tricky
 * (ambiguous / unmatched) ones optionally go to the `classifyQuestionGrades`
 * admin callable for an AI grade. Idempotent — re-running skips anything
 * already banked.
 *
 * The pure index/lookup helpers are exported for unit tests; the Firestore
 * I/O lives below them.
 */

import {
  collection, query, where, getDocs, limit,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'
import { questionFingerprint, examPaperQuestionToBank } from './questionBankCore.js'
import { captureQuestionsToBank } from './questionBankService'
import {
  VALID_GRADES, buildGradeIndexFromCurriculum, lookupGradeClient, normalizeGrade,
} from './questionBankImportCore.js'

const functions = getFunctions(app, 'us-central1')
const classifyQuestionGradesCallable = httpsCallable(functions, 'classifyQuestionGrades', { timeout: 120_000 })

/* ----------------------------- source reads ------------------------------ */

/** Pull every candidate question (editor-shaped) from quizzes + AI exam papers. */
async function collectCandidates() {
  const out = []

  // Published learner quizzes (incl. ECZ past papers authored as quizzes).
  const quizzes = await getDocs(query(collection(db, 'quizzes'), where('isPublished', '==', true)))
  for (const quiz of quizzes.docs) {
    const qd = quiz.data() || {}
    const meta = { subject: qd.subject, grade: qd.grade, topic: qd.topic }
    const qs = await getDocs(collection(db, 'quizzes', quiz.id, 'questions'))
    for (const q of qs.docs) {
      out.push({ question: q.data() || {}, meta, source: 'quiz_studio' })
    }
  }

  // AI-generated exam papers.
  const gens = await getDocs(query(collection(db, 'aiGenerations'), where('tool', '==', 'exam_paper')))
  for (const gen of gens.docs) {
    const gd = gen.data() || {}
    if (gd.status && gd.status !== 'done') continue
    const inputs = gd.inputs || {}
    const meta = { subject: inputs.subject, grade: inputs.grade, topic: inputs.topic }
    const questions = (gd.output && Array.isArray(gd.output.questions)) ? gd.output.questions : []
    for (const raw of questions) {
      const mapped = examPaperQuestionToBank(raw)
      if (mapped) out.push({ question: mapped, meta, source: 'exam_paper_studio' })
    }
  }
  return out
}

/** Is this fingerprint already in the bank? Cached per session. */
async function makeBankChecker() {
  const cache = new Map()
  return async function isInBank(fp) {
    if (cache.has(fp)) return cache.get(fp)
    let exists = false
    try {
      const hit = await getDocs(query(collection(db, 'questionBank'), where('fingerprint', '==', fp), limit(1)))
      exists = !hit.empty
    } catch { exists = false }
    cache.set(fp, exists)
    return exists
  }
}

/* ------------------------------- preview --------------------------------- */

/**
 * Count-only preview — no writes, no AI. Returns totals + the deterministic
 * regrade split so the admin sees the size + cost before importing.
 */
export async function previewImport() {
  const index = buildGradeIndexFromCurriculum()
  const candidates = await collectCandidates()
  const isInBank = await makeBankChecker()

  const seen = new Set()
  let found = 0, alreadyBanked = 0, toImport = 0
  const regrade = { syllabus: 0, needsAi: 0, unchanged: 0 }

  for (const c of candidates) {
    found += 1
    const fp = questionFingerprint(c.question)
    if (seen.has(fp)) { alreadyBanked += 1; continue }
    seen.add(fp)
    if (await isInBank(fp)) { alreadyBanked += 1; continue }
    toImport += 1
    const lk = lookupGradeClient(index, c.meta.subject, c.meta.topic || c.question.topic)
    if (lk.grade) regrade.syllabus += 1
    else if (lk.ambiguous || normalizeGrade(c.meta.grade) === '') regrade.needsAi += 1
    else regrade.unchanged += 1
  }
  return { found, alreadyBanked, toImport, regrade }
}

/* -------------------------------- import --------------------------------- */

async function aiGradeBatch(items) {
  // items: [{ subject, topic, text, options, storedGrade }] → returns grades[]
  try {
    const res = await classifyQuestionGradesCallable({ questions: items })
    const grades = res?.data?.grades
    return Array.isArray(grades) ? grades : []
  } catch (err) {
    console.error('classifyQuestionGrades failed', err)
    return []
  }
}

/**
 * Run the import. Writes deduped, regraded questions into the bank via the
 * normal capture path (→ Qix review). Reports progress via onProgress.
 *
 * @param {{ uid:string, useAi?:boolean, onProgress?:(p)=>void }} opts
 */
export async function runImport({ uid, useAi = true, onProgress = () => {} } = {}) {
  if (!uid) throw new Error('Sign in as an admin to run the import.')
  const index = buildGradeIndexFromCurriculum()
  const candidates = await collectCandidates()
  const isInBank = await makeBankChecker()

  const totals = { found: candidates.length, imported: 0, skipped: 0, regraded: 0, processed: 0 }
  const seen = new Set()

  // Decide grade for one candidate (deterministic; queue AI when ambiguous).
  const aiQueue = []
  const prepared = []
  for (const c of candidates) {
    totals.processed += 1
    const fp = questionFingerprint(c.question)
    if (seen.has(fp)) { totals.skipped += 1; continue }
    seen.add(fp)
    if (await isInBank(fp)) { totals.skipped += 1; continue }

    const storedGrade = normalizeGrade(c.meta.grade)
    const lk = lookupGradeClient(index, c.meta.subject, c.meta.topic || c.question.topic)
    const entry = { c, fp, grade: lk.grade || storedGrade, needsAi: !lk.grade && (lk.ambiguous || !storedGrade) }
    if (entry.needsAi && useAi) aiQueue.push(entry)
    prepared.push(entry)
    if (totals.processed % 25 === 0) onProgress({ ...totals, phase: 'scanning' })
  }

  // Resolve AI grades in batches of 25.
  if (useAi) {
    for (let i = 0; i < aiQueue.length; i += 25) {
      const batch = aiQueue.slice(i, i + 25)
      const grades = await aiGradeBatch(batch.map((e) => ({
        subject: e.c.meta.subject, topic: e.c.meta.topic || e.c.question.topic,
        text: e.c.question.text, options: e.c.question.options, storedGrade: e.grade,
      })))
      batch.forEach((e, j) => {
        const g = normalizeGrade(grades[j])
        if (VALID_GRADES.has(g)) e.grade = g
      })
      onProgress({ ...totals, phase: 'grading' })
    }
  }

  // Group by (subject, grade) and write via the normal capture path.
  const groups = new Map()
  for (const e of prepared) {
    const subject = e.c.meta.subject || ''
    const key = `${subject}|${e.grade}|${e.c.source}`
    if (!groups.has(key)) groups.set(key, { subject, grade: e.grade, source: e.c.source, questions: [] })
    groups.get(key).questions.push(e.c.question)
    if (normalizeGrade(e.c.meta.grade) !== e.grade) totals.regraded += 1
  }
  for (const g of groups.values()) {
    const { saved } = await captureQuestionsToBank(uid, g.questions, { subject: g.subject, grade: g.grade }, g.source)
    totals.imported += saved
    onProgress({ ...totals, phase: 'writing' })
  }

  onProgress({ ...totals, phase: 'done' })
  return totals
}
