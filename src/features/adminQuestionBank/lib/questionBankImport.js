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
  collection, query, where, getDocs, limit, doc, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'
import { questionFingerprint, examPaperQuestionToBank, MASTER_REVIEW_STATE } from '../../../utils/questionBankCore.js'
import { captureQuestionsToBank, promoteQuestionsToMaster, parseBankQuestion } from '../../../utils/questionBankService'
import {
  VALID_GRADES, buildGradeIndexFromCurriculum, lookupGradeClient, normalizeGrade, planBankAction,
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

/**
 * Look up the matching bank row for a fingerprint, if any. Returns
 * `{ id, ownerId, masterEligible }` of the best match (preferring a
 * master-eligible row, then one owned by the importing admin) or null when the
 * question isn't banked yet. Cached per session. `adminUid` lets the lookup
 * prefer the admin's own row so a prior pending import can be promoted rather
 * than re-created. A few extra reads (limit 5) keep us from mistaking a
 * teacher's private duplicate for the platform copy.
 */
async function makeBankLookup(adminUid) {
  const cache = new Map()
  return async function lookup(fp) {
    if (cache.has(fp)) return cache.get(fp)
    let row = null
    try {
      const hit = await getDocs(query(collection(db, 'questionBank'), where('fingerprint', '==', fp), limit(5)))
      const rows = hit.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
      row = rows.find(r => r.masterEligible === true)
        || rows.find(r => adminUid && r.ownerId === adminUid)
        || rows[0]
        || null
    } catch { row = null }
    cache.set(fp, row)
    return row
  }
}

/* ------------------------------- preview --------------------------------- */

/**
 * Count-only preview — no writes, no AI. Returns totals + the deterministic
 * regrade split so the admin sees the size + cost before importing.
 */
export async function previewImport({ uid } = {}) {
  const index = buildGradeIndexFromCurriculum()
  const candidates = await collectCandidates()
  const lookup = await makeBankLookup(uid)

  const seen = new Set()
  let found = 0, alreadyBanked = 0, toImport = 0, toPromote = 0
  const regrade = { syllabus: 0, needsAi: 0, unchanged: 0 }

  for (const c of candidates) {
    found += 1
    const fp = questionFingerprint(c.question)
    if (seen.has(fp)) { alreadyBanked += 1; continue }
    seen.add(fp)
    const action = planBankAction(await lookup(fp), uid)
    if (action === 'skip') { alreadyBanked += 1; continue }
    if (action === 'promote') { toPromote += 1; continue }
    toImport += 1
    const lk = lookupGradeClient(index, c.meta.subject, c.meta.topic || c.question.topic)
    // Exam-paper questions can't trust the paper's grade — a Grade 7 paper mixes
    // Grades 4–7 — so AI-grade each by its text when the syllabus doesn't pin it.
    const isExamPaper = c.source === 'exam_paper_studio'
    if (lk.grade) regrade.syllabus += 1
    else if (lk.ambiguous || normalizeGrade(c.meta.grade) === '' || isExamPaper) regrade.needsAi += 1
    else regrade.unchanged += 1
  }
  return { found, alreadyBanked, toImport, toPromote, regrade }
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
 * Run the import. Writes deduped, regraded questions straight into the shared
 * Master Bank (curated, already-vetted platform content — visible to every
 * teacher without per-question Qix review) and promotes any rows an earlier
 * run left sitting in review. Reports progress via onProgress.
 *
 * @param {{ uid:string, useAi?:boolean, onProgress?:(p)=>void }} opts
 */
export async function runImport({ uid, useAi = true, onProgress = () => {} } = {}) {
  if (!uid) throw new Error('Sign in as an admin to run the import.')
  const index = buildGradeIndexFromCurriculum()
  const candidates = await collectCandidates()
  const lookup = await makeBankLookup(uid)

  const totals = { found: candidates.length, imported: 0, promoted: 0, skipped: 0, regraded: 0, processed: 0 }
  const seen = new Set()

  // Decide grade for one candidate (deterministic; queue AI when ambiguous).
  const aiQueue = []
  const prepared = []
  const promoteIds = []
  for (const c of candidates) {
    totals.processed += 1
    const fp = questionFingerprint(c.question)
    if (seen.has(fp)) { totals.skipped += 1; continue }
    seen.add(fp)
    const existing = await lookup(fp)
    const action = planBankAction(existing, uid)
    if (action === 'skip') { totals.skipped += 1; continue }
    if (action === 'promote') { promoteIds.push(existing.id); continue }

    const storedGrade = normalizeGrade(c.meta.grade)
    const lk = lookupGradeClient(index, c.meta.subject, c.meta.topic || c.question.topic)
    // Exam-paper questions inherit the paper's grade, which is wrong for the
    // mixed-grade ones — AI-grade each by its own text unless the syllabus
    // already pins a unique grade.
    const isExamPaper = c.source === 'exam_paper_studio'
    const entry = { c, fp, grade: lk.grade || storedGrade, needsAi: !lk.grade && (lk.ambiguous || !storedGrade || isExamPaper) }
    if (entry.needsAi && useAi) aiQueue.push(entry)
    prepared.push(entry)
    if (totals.processed % 25 === 0) onProgress({ ...totals, phase: 'scanning' })
  }

  // Promote rows an earlier run captured as pending into the Master Bank.
  if (promoteIds.length) {
    totals.promoted += await promoteQuestionsToMaster(promoteIds)
    onProgress({ ...totals, phase: 'promoting' })
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
    // Curated platform content (already-published quizzes + completed exam
    // papers) seeds the shared Master Bank directly, so every teacher sees it
    // without waiting on per-question Qix review.
    const { saved } = await captureQuestionsToBank(
      uid, g.questions, { subject: g.subject, grade: g.grade }, g.source,
      { reviewState: MASTER_REVIEW_STATE },
    )
    totals.imported += saved
    onProgress({ ...totals, phase: 'writing' })
  }

  onProgress({ ...totals, phase: 'done' })
  return totals
}

/* ------------------------------ re-grade --------------------------------- */

// Sources produced by the admin import backfill. Past papers / mixed-grade
// exam papers live on the platform as PUBLISHED QUIZZES (source 'quiz_studio'),
// not just as 'exam_paper_studio' generations — so re-grade both. 'manual' admin
// captures are left alone.
const IMPORTED_SOURCES = new Set([
  'quiz_studio', 'exam_paper_studio', 'past_paper',
  'assessment_studio', 'test_paper_studio', 'homework_studio',
])

/**
 * Re-grade the admin's imported questions and re-file each under the grade it
 * actually belongs to. Imports inherited their source paper/quiz's grade (so a
 * Grade 7 paper filed all its Grade 4–6 questions as Grade 7); this re-decides
 * each question's grade — a unique syllabus match wins, otherwise the AI grader
 * reads the question text — and updates the bank row's grade where it differs.
 * Idempotent: re-running only changes rows whose grade still moves.
 *
 * @param {{ uid:string, onProgress?:(p)=>void }} opts
 * @returns {{ found, regraded, unchanged, processed }}
 */
export async function regradeExistingQuestions({ uid, onProgress = () => {} } = {}) {
  if (!uid) throw new Error('Sign in as an admin to re-grade.')
  const index = buildGradeIndexFromCurriculum()

  const snap = await getDocs(query(collection(db, 'questionBank'), where('ownerId', '==', uid)))
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((r) => IMPORTED_SOURCES.has(r.source))

  const totals = { found: rows.length, regraded: 0, unchanged: 0, processed: 0 }
  if (!rows.length) { onProgress({ ...totals, phase: 'done' }); return totals }

  // Decide each question's true grade — a unique syllabus match wins; otherwise
  // the AI grader reads the question text.
  const aiQueue = []
  const plans = []
  for (const r of rows) {
    const q = parseBankQuestion(r) || {}
    const lk = lookupGradeClient(index, r.subject, r.topic || q.topic)
    const plan = { r, q, grade: lk.grade || normalizeGrade(r.grade), needsAi: !lk.grade }
    if (plan.needsAi) aiQueue.push(plan)
    plans.push(plan)
  }

  for (let i = 0; i < aiQueue.length; i += 25) {
    const batch = aiQueue.slice(i, i + 25)
    const grades = await aiGradeBatch(batch.map((p) => ({
      subject: p.r.subject, topic: p.r.topic || p.q.topic,
      text: p.q.text, options: p.q.options, storedGrade: normalizeGrade(p.r.grade),
    })))
    batch.forEach((p, j) => {
      const g = normalizeGrade(grades[j])
      if (VALID_GRADES.has(g)) p.grade = g
    })
    totals.processed += batch.length
    onProgress({ ...totals, phase: 'grading' })
  }
  totals.processed = rows.length

  // Write back only the rows whose grade actually moved.
  const changed = plans.filter((p) => {
    const g = normalizeGrade(p.grade)
    return VALID_GRADES.has(g) && g !== normalizeGrade(p.r.grade)
  })
  for (let i = 0; i < changed.length; i += 400) {
    const slice = changed.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const p of slice) {
      batch.update(doc(db, 'questionBank', p.r.id), {
        grade: String(normalizeGrade(p.grade)),
        updatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
    totals.regraded += slice.length
    onProgress({ ...totals, phase: 'writing' })
  }
  totals.unchanged = rows.length - totals.regraded
  onProgress({ ...totals, phase: 'done' })
  return totals
}
