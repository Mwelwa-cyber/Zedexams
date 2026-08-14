#!/usr/bin/env node
/**
 * End-to-end guard for the Quiz Editor's save path against firestore.rules,
 * run in the local Firestore emulator.
 *
 * Why this exists: the editor's auto-save writes a MUCH richer payload than
 * the minimal per-type saves in test-firestore-rules-emulator.mjs — ~40
 * fields per question (dual HTML+JSON rich text, import provenance, CBC
 * tags, review flags) plus a quiz-doc patch that merges onto whatever the
 * Past Paper Studio / server importer already stamped on the document. Any
 * single field that client code emits but `validQuestionFields()` /
 * `validQuizFields()` rejects fails the WHOLE batch with the opaque
 * "Missing or insufficient permissions" — the recurring "scanned paper
 * won't save" bug that has hit at least four times (#398 numeric, #399
 * hotspot, fill_blanks 2026-07, marks-cap lift).
 *
 * So instead of hand-modelling payloads, this test builds them with the REAL
 * production modules — the scanned importer's section mapper, the editor's
 * serializer, and normalizeQuestionPayload — and replays the exact write
 * sequence updateQuizWithQuestions performs (quiz patch → question batch),
 * as admin and as the owning teacher, against the real rules. If a client
 * or rules change ever re-opens the gap, this fails with the field name.
 *
 * The Tiptap/DOMPurify write pipeline needs a DOM, so a jsdom window is
 * installed on globalThis BEFORE the app modules load.
 *
 * Run:
 *   npm run test:quiz-autosave-rules
 * (wraps this in `firebase emulators:exec --only firestore`)
 *
 * Deliberately NOT part of `npm run test:all`: like test-firestore-rules-
 * emulator.mjs, it needs the Firestore emulator (a JVM process), and the
 * test:all runner only auto-discovers plain `node` scripts. CI runs it in
 * the "Tests (Firestore rules emulator)" job (see .github/workflows/ci.yml).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'

// ── DOM bootstrap (must precede every app-module import) ─────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://zedexams.com' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
globalThis.NodeFilter = dom.window.NodeFilter
globalThis.Element = dom.window.Element
globalThis.HTMLElement = dom.window.HTMLElement

const { initializeTestEnvironment, assertSucceeds } = await import('@firebase/rules-unit-testing')
const { doc, setDoc, updateDoc, writeBatch, serverTimestamp } = await import('firebase/firestore')

// Real production modules — the same code the editor runs in the browser.
const { mergeSectionBatches, visionSectionsToLocal, groupSectionsIntoParts } =
  await import('../src/services/quizImport/scannedQuizImporter.js')
const { serializeQuizSections } = await import('../src/utils/quizSections.js')
const { normalizeQuestionPayload } = await import('../src/utils/questionWritePayload.js')
const { quizUpdateSchema } = await import('../src/schemas/quiz.js')

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')

const PROJECT_ID = 'examsprepzambia-test'
const ADMIN = 'admin_user'
const TEACHER = 'teacher_user'

// The rules gate every studio write on isVerified() (email verification),
// so the test principals need a verified-email token — mirrors
// test-firestore-rules-emulator.mjs.
const verifiedToken = (uid) => ({ email: `${uid}@test.zedexams.com`, email_verified: true })

let pass = 0
let fail = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

/**
 * When a write is denied, bisect the payload to name the culprit field(s) in
 * the failure message — "permission denied" alone has cost hours of guessing
 * every time this class of bug recurs.
 *
 * Two passes: first try removing each field alone (names a single culprit
 * exactly); if no single removal unblocks the write — multiple fields are
 * invalid, or the failure isn't field-shaped (e.g. the expression-budget
 * cliff, an authorization denial) — peel fields cumulatively until the write
 * passes and report every peeled field as a candidate set.
 */
async function diagnoseDeniedWrite(db, ref, payload, { asUpdate = false } = {}) {
  const attempt = async (variant) => {
    try {
      if (asUpdate) await updateDoc(ref, variant)
      else await setDoc(ref, variant)
      return true
    } catch {
      return false
    }
  }
  // Pass 1: single-field removal — precise when exactly one field is at fault.
  for (const key of Object.keys(payload)) {
    const variant = { ...payload }
    delete variant[key]
    if (await attempt(variant)) return { culprits: [key], exact: true }
  }
  // Pass 2: cumulative peel — several fields (or none: auth/budget) at fault.
  const peeled = []
  const variant = { ...payload }
  for (const key of Object.keys(payload)) {
    delete variant[key]
    peeled.push(key)
    if (await attempt(variant)) return { culprits: [...peeled], exact: false }
  }
  return { culprits: [], exact: false }
}

function describeCulprits({ culprits, exact }) {
  if (!culprits.length) return ' — no field-level culprit (authorization or expression-budget failure)'
  if (exact) return ` — culprit field: ${culprits[0]}`
  return ` — culprit fields (candidate set, not minimal): ${culprits.join(', ')}`
}

// ── Fixture: a scanned ECZ-style paper as structureScannedQuiz returns it ──
// Covers every shape the scanned importer emits: comprehension passage with
// mixed-type sub-questions, true/false, fill-in-the-blank with a word bank,
// matching, handwritten maths, an unreadable stem (number only), a label-the-
// diagram question, and a multi-mark short answer grouped under a Section.
// Per-question ocrConfidence / source values mirror real importer output for
// fidelity: they flow into the persisted aiConfidence field and extra review
// notes, growing the written payload the way a real scan does — the field
// COUNT is what exercises the rules expression budget, so realistic optional
// fields are the point, not decoration.
function buildScannedBatchFixture() {
  return {
    detectedCount: 10,
    warnings: [],
    sections: [
      {
        kind: 'passage',
        title: 'Read the passage below and answer the questions that follow',
        instructions: 'Questions 1 to 3',
        passageText: 'Mulenga walked to the market in Lusaka.\nShe bought two mangoes.',
        passageKind: 'comprehension',
        sourcePage: 1,
        questions: [
          { text: 'Where did Mulenga walk to?', type: 'mcq', options: ['school', 'market', 'church', 'farm'], sourceQuestionNumber: 1, sourcePage: 1, ocrConfidence: 0.93 },
          { text: 'How many mangoes did she buy?', type: 'mcq', options: ['one', 'two', 'three', 'four'], sourceQuestionNumber: 2, sourcePage: 1, ocrConfidence: 0.91 },
          { text: 'Explain why markets are important.', type: 'short_answer', answerLines: 3, sourceQuestionNumber: 3, sourcePage: 1, ocrConfidence: 0.72 },
        ],
      },
      { kind: 'standalone', question: { text: 'Lusaka is the capital of Zambia.', type: 'true_false', options: ['True', 'False'], sourceQuestionNumber: 4, sourcePage: 2, ocrConfidence: 0.95 } },
      { kind: 'standalone', question: { text: 'The sun rises in the ____.', type: 'fill_blank', wordBank: ['east', 'west'], sourceQuestionNumber: 5, sourcePage: 2, ocrConfidence: 0.8 } },
      { kind: 'standalone', question: { text: 'Match the animals to their homes.', type: 'matching', matchingLeft: ['dog', 'bird'], matchingRight: ['kennel', 'nest'], sourceQuestionNumber: 6, sourcePage: 2, ocrConfidence: 0.7 } },
      { kind: 'standalone', question: { text: 'Work out \\frac{1}{2} + \\frac{1}{4}', type: 'short_answer', sourceQuestionNumber: 7, sourcePage: 3, ocrConfidence: 0.65, source: 'handwritten' } },
      { kind: 'standalone', question: { text: '', type: 'mcq', sourceQuestionNumber: 8, sourcePage: 3, ocrConfidence: null } },
      { kind: 'standalone', question: { text: 'Name the parts of the flower shown.', type: 'diagram_label', diagramLabels: ['petal', 'stem'], sourceQuestionNumber: 9, sourcePage: 3, hasDiagram: true, ocrConfidence: 0.6, sectionTitle: 'Section B' } },
      { kind: 'standalone', question: { text: 'Write the number 407 in words.', type: 'short_answer', marks: 2, sourceQuestionNumber: 10, sourcePage: 3, ocrConfidence: 0.88 } },
    ],
  }
}

// Run the import exactly as the editor does (merge → local sections → parts),
// then serialize for save. Replicates the fixture to production scale (65
// questions, like the reported failing paper) with distinct printed numbers
// so the importer's dedup keeps every copy.
function buildEditorSave() {
  const batches = []
  for (let rep = 0; rep < 7; rep++) {
    const batch = buildScannedBatchFixture()
    const shift = rep * 10
    for (const section of batch.sections) {
      const qs = section.kind === 'passage' ? section.questions : [section.question]
      for (const q of qs) {
        q.sourceQuestionNumber += shift
        q.text = q.text ? `${q.text} (v${rep + 1})` : q.text
        q.sourcePage = (q.sourcePage || 1) + rep * 3
      }
      if (section.kind === 'passage') section.sourcePage = (section.sourcePage || 1) + rep * 3
    }
    batches.push(batch)
  }
  const merged = mergeSectionBatches(batches)
  const { sections } = visionSectionsToLocal(merged.sections, { diagramHandling: 'keep' })
  const grouped = groupSectionsIntoParts(sections)
  return serializeQuizSections(grouped.sections || sections, grouped.parts || [])
}

// Worst-case editor questions: EVERY optional field a given type can carry,
// populated. These maximise the number of fields present on the written doc —
// the variable that pushed the old ~35-clause validator over Firestore's
// 1000-expression evaluation cap. If a future rules change re-approaches the
// cliff, these fail first.
function buildMaxedQuestions() {
  const longText = '<p>' + 'A question stem with substance. '.repeat(20) + '</p>'
  const base = {
    sharedInstruction: '<p>Answer all parts of this question.</p>',
    explanation: '<p>Because the syllabus says so.</p>',
    topic: 'Number and notation',
    subtopic: 'Place value'.padEnd(180, ' extension'),
    competency: 'Applies place value in real contexts',
    specificOutcome: 'Learners can decompose 6-digit numbers',
    curriculum: 'CBC-2023',
    difficulty: 'hard',
    bloom: 'analyze',
    marks: 20,
    requiresReview: true,
    reviewNotes: Array.from({ length: 10 }, (_, i) => `Review note ${i + 1}`),
    importWarnings: Array.from({ length: 10 }, (_, i) => `Import warning ${i + 1}`),
    sourcePage: 7,
    sourceQuestionNumber: 99,
    sourceBankId: 'bank_abcdef123456',
    aiConfidence: 0.42,
    imageAlt: 'A labelled figure of the question stimulus',
    imagePosition: 'below',
    imageWidth: 'medium',
    diagramText: 'Figure 3: cross-section of a maize seed',
    imageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/q.png',
    imageDiagram: { libraryKey: 'number_line', params: { min: '0', max: '100' } },
    images: Array.from({ length: 6 }, (_, i) => ({ url: `https://firebasestorage.googleapis.com/v0/b/x/o/extra${i}.png`, alt: `Extra figure ${i + 1}`, width: 'small' })),
    answerFormat: 'labelled_blanks',
    answerLines: 12,
    blankLabels: ['P', 'Q', 'R', 'S'],
    wordBank: ['east', 'west', 'north', 'south'],
    tableData: {
      headers: ['Item', 'Qty', 'Price', 'Total', 'Tax', 'Net'],
      rows: Array.from({ length: 12 }, (_, r) => ['a', 'b', 'c', 'd', 'e', 'f'].map(c => `${c}${r}`)),
    },
    drawingHeight: 240,
    diagramMode: 'identify',
    diagramLabels: Array.from({ length: 20 }, (_, i) => ({ id: `lbl-${i}`, x: 0.05 * i, y: 0.04 * i, tx: 0.5, ty: 0.5, text: `Part ${i + 1}` })),
    text: longText,
  }
  return [
    { ...base, type: 'mcq', options: ['a', 'b', 'c', 'd', 'e', 'f'], correctAnswer: 2,
      optionMedia: Array.from({ length: 6 }, (_, i) => ({ imageUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/opt${i}.png`, alt: `Option ${i + 1}`, diagram: { libraryKey: 'clock_face', params: { time: '10:30' } } })) },
    { ...base, type: 'hotspot', correctRegion: { x: 0.4, y: 0.6, radius: 0.1 }, correctAnswer: '' },
    { ...base, type: 'fill_blanks', correctAnswer: '', wordBankReuse: true,
      statements: Array.from({ length: 40 }, (_, i) => ({ text: `Statement ${i + 1} has a ____ here.`, answers: [`answer${i + 1}`] })) },
    { ...base, type: 'matching', correctAnswer: '',
      matchingLeft: Array.from({ length: 20 }, (_, i) => `Left ${i + 1}`),
      matchingRight: Array.from({ length: 20 }, (_, i) => `Right ${i + 1}`),
      matchingAnswer: Array.from({ length: 20 }, (_, i) => 19 - i) },
    { ...base, type: 'sequence', correctAnswer: '',
      sequenceItems: Array.from({ length: 20 }, (_, i) => `Step ${i + 1}`),
      sequenceAnswer: Array.from({ length: 20 }, (_, i) => i + 1) },
    { ...base, type: 'numeric', correctAnswer: '3.14', tolerance: 0.01, numericTolerance: 0.01, numericUnit: 'cm' },
    { ...base, type: 'short_answer', correctAnswer: 'A model answer', answerFormat: 'lines',
      subParts: Array.from({ length: 12 }, (_, i) => ({ text: `Sub-part ${i + 1}`, answer: `Answer ${i + 1}`, marks: 2, answerFormat: 'lines', answerLines: 3 })) },
  ]
}

// The quiz-doc patch performAutoSave sends through updateQuizWithQuestions,
// with the form fields EditQuizV2 loads + applyImportedPayload sets.
function buildQuizPatch(serialized, uid) {
  const form = {
    title: '', // the screenshot case: no title typed yet → safeTitle fallback
    subject: 'Mathematics',
    grade: '5',
    duration: 30,
    type: 'quiz',
    topic: 'past-paper',
    isDemo: false,
    shuffleQuestions: false,
    mode: 'imported_document',
    importStatus: 'needs_review',
    sourceFileName: 'Screenshot_20260706_161240_Past Papers ZM.jpg',
    sourceContentType: 'image/jpeg',
    importWarnings: [
      'Answers were left blank — set the correct answer for each question before publishing.',
      '"Screenshot_20260706_161408_Past Papers ZM.jpg" looks blurry — a sharper photo reads more accurately.',
    ],
    sourcePastPaperId: null,
    sourcePastPaperPdfPath: null,
    sourceMarkSchemePath: null,
    linkedPaperId: 'paper_abc123',
  }
  const safeTitle = String(form.title || '').trim()
    || String(form.sourceFileName || '').replace(/\.(docx?|pdf)$/i, '').trim()
    || 'Untitled quiz'
  const totalMarks = serialized.questions.reduce((s, q) => s + (q.marks || 1), 0)
  const parsed = quizUpdateSchema.safeParse({
    ...form,
    title: safeTitle,
    passages: serialized.passages,
    parts: serialized.parts,
    passageCount: serialized.passages.length,
    reviewCount: serialized.questions.filter(q => q?.requiresReview).length,
    status: 'draft',
    isPublished: false,
    updatedBy: uid,
    questionCount: serialized.questions.length,
    totalMarks,
  })
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    const path = first?.path?.join('.') || '(root)'
    throw new Error(`quizUpdateSchema rejected the autosave patch at "${path}": ${first?.message || 'schema violation'}`)
  }
  return parsed.data
}

// The linked quiz exactly as the Past Paper Studio's ensureLinkedQuiz creates
// it — including quizType 'past_paper', which is outside the client Zod enum
// but valid under the rules' string check.
function studioQuizSeed(uid) {
  return {
    title: 'Grade 5 Mathematics 2024 — Quiz',
    subject: 'Mathematics',
    topic: 'past-paper',
    isPublished: false,
    publicAccess: false,
    quizType: 'past_paper',
    linkedPaperId: 'paper_abc123',
    createdBy: uid,
    questionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// Replay updateQuizWithQuestions: quiz patch first, then the question batch.
// On denial, bisect and fail with the culprit field named.
async function replayAutosave(db, quizId, serialized, uid, { existingIds = null } = {}) {
  const quizRef = doc(db, 'quizzes', quizId)
  const quizPatch = { ...buildQuizPatch(serialized, uid), updatedAt: serverTimestamp() }
  try {
    await assertSucceeds(updateDoc(quizRef, quizPatch))
  } catch (err) {
    const diagnosis = await diagnoseDeniedWrite(db, quizRef, quizPatch, { asUpdate: true })
    throw new Error(`quiz-doc patch denied${describeCulprits(diagnosis)} (${err.message})`)
  }

  const payloads = []
  for (const [i, q] of serialized.questions.entries()) {
    payloads.push(await normalizeQuestionPayload(q, i + 1))
  }
  // Same chunked writeBatch shape as production (all 10 fit one batch).
  try {
    const batch = writeBatch(db)
    payloads.forEach((cleanQ, i) => {
      const id = existingIds ? existingIds[i] : `imported_q${String(i + 1).padStart(3, '0')}`
      if (existingIds) batch.update(doc(db, 'quizzes', quizId, 'questions', id), cleanQ)
      else batch.set(doc(db, 'quizzes', quizId, 'questions', id), cleanQ)
    })
    await assertSucceeds(batch.commit())
  } catch (err) {
    // Batches deny atomically — bisect question-by-question, then field-by-field.
    for (const [i, cleanQ] of payloads.entries()) {
      const id = existingIds ? existingIds[i] : `probe_q${String(i + 1).padStart(3, '0')}`
      const ref = doc(db, 'quizzes', quizId, 'questions', id)
      try {
        if (existingIds) await updateDoc(ref, cleanQ)
        else await setDoc(ref, cleanQ)
      } catch {
        const diagnosis = await diagnoseDeniedWrite(db, ref, cleanQ, { asUpdate: Boolean(existingIds) })
        throw new Error(
          `question ${i + 1} (type ${cleanQ.type}) denied${describeCulprits(diagnosis)} (${err.message})`,
        )
      }
    }
    throw new Error(`question batch denied but every individual write passed (${err.message})`)
  }
  return payloads
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:quiz-autosave-rules`.',
    )
  }
  const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  const port = Number(portStr) || 8080

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: readFileSync(RULES_PATH, 'utf8') },
  })

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', ADMIN), { role: 'admin' })
    await setDoc(doc(db, 'users', TEACHER), { role: 'teacher' })
    // Linked quizzes as the Past Paper Studio creates them.
    await setDoc(doc(db, 'quizzes', 'paper_quiz_admin'), studioQuizSeed(ADMIN))
    await setDoc(doc(db, 'quizzes', 'paper_quiz_teacher'), studioQuizSeed(TEACHER))
    // A question doc as the SERVER importer (admin SDK, bypasses rules) writes
    // it — later client updates must still pass the post-merge validation.
    await setDoc(doc(db, 'quizzes', 'paper_quiz_admin', 'questions', 'server_q001'), {
      type: 'mcq',
      text: 'Server-imported question',
      textJSON: null,
      explanation: '',
      explanationJSON: null,
      marks: 1,
      order: 0,
      passageId: null,
      requiresReview: true,
      validationStatus: 'warning',
      importSource: 'past_paper_ai',
      sourcePage: '12',
      sourceQuestionNumber: 12,
      options: ['a', 'b', 'c', 'd'],
      correctAnswer: 0,
      importedAt: new Date(),
    })
  })

  const adminDb = testEnv.authenticatedContext(ADMIN, verifiedToken(ADMIN)).firestore()
  const teacherDb = testEnv.authenticatedContext(TEACHER, verifiedToken(TEACHER)).firestore()

  const serialized = buildEditorSave()
  console.log(`\nBuilt editor save via real importer: ${serialized.questions.length} questions, ` +
    `${serialized.passages.length} passage(s), ${serialized.parts.length} part(s)`)

  console.log('\nquiz autosave — full real payloads through firestore.rules')

  let adminPayloads
  await test('admin can autosave a freshly imported scanned paper (quiz patch + question batch)', async () => {
    adminPayloads = await replayAutosave(adminDb, 'paper_quiz_admin', serialized, ADMIN)
  })

  await test('admin can re-autosave the same paper as UPDATES (post-merge rules validation)', async () => {
    if (!adminPayloads) throw new Error('create pass failed — skipping')
    const ids = serialized.questions.map((_, i) => `imported_q${String(i + 1).padStart(3, '0')}`)
    await replayAutosave(adminDb, 'paper_quiz_admin', serialized, ADMIN, { existingIds: ids })
  })

  await test('admin can update a SERVER-imported question doc (admin-SDK fields on the merged doc)', async () => {
    const cleanQ = await normalizeQuestionPayload(serialized.questions[0], 1)
    const ref = doc(adminDb, 'quizzes', 'paper_quiz_admin', 'questions', 'server_q001')
    try {
      await assertSucceeds(updateDoc(ref, cleanQ))
    } catch (err) {
      const diagnosis = await diagnoseDeniedWrite(adminDb, ref, cleanQ, { asUpdate: true })
      throw new Error(`denied${describeCulprits(diagnosis)} (${err.message})`)
    }
  })

  await test('owning teacher can autosave the same imported paper (draft lane)', async () => {
    await replayAutosave(teacherDb, 'paper_quiz_teacher', serialized, TEACHER)
  })

  await test('worst-case maxed questions (every optional field) save for admin AND teacher', async () => {
    const maxed = buildMaxedQuestions()
    for (const [i, raw] of maxed.entries()) {
      const cleanQ = await normalizeQuestionPayload(raw, i + 1)
      for (const [who, db, quizId] of [['admin', adminDb, 'paper_quiz_admin'], ['teacher', teacherDb, 'paper_quiz_teacher']]) {
        const ref = doc(db, 'quizzes', quizId, 'questions', `maxed_${who}_${raw.type}`)
        try {
          await assertSucceeds(setDoc(ref, cleanQ))
        } catch (err) {
          const diagnosis = await diagnoseDeniedWrite(db, ref, cleanQ)
          throw new Error(`maxed '${raw.type}' denied for ${who}${describeCulprits(diagnosis)} (${err.message})`)
        }
      }
    }
  })

  await test('teacher can save maxed questions into their own ASSESSMENT (Test Paper Studio path)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'assessments', 'assess_teacher'), {
        createdBy: TEACHER,
        title: 'Term 2 Maths test',
        grade: '7',
        subject: 'Mathematics',
      })
    })
    const maxed = buildMaxedQuestions()
    for (const [i, raw] of maxed.entries()) {
      const cleanQ = await normalizeQuestionPayload(raw, i + 1)
      const ref = doc(teacherDb, 'assessments', 'assess_teacher', 'questions', `maxed_${raw.type}`)
      try {
        await assertSucceeds(setDoc(ref, cleanQ))
      } catch (err) {
        const diagnosis = await diagnoseDeniedWrite(teacherDb, ref, cleanQ)
        throw new Error(`maxed '${raw.type}' denied on assessments${describeCulprits(diagnosis)} (${err.message})`)
      }
    }
  })

  await test('a bogus question type is still rejected (validator retains teeth)', async () => {
    const cleanQ = await normalizeQuestionPayload(serialized.questions[0], 1)
    let denied = false
    try {
      await setDoc(doc(adminDb, 'quizzes', 'paper_quiz_admin', 'questions', 'bogus_type'), {
        ...cleanQ,
        type: 'not_a_real_type',
      })
    } catch {
      denied = true
    }
    if (!denied) throw new Error('a bogus question type was accepted — _validQuestionType gate lost')
  })

  await test('out-of-range marks are still rejected (validator retains teeth)', async () => {
    const cleanQ = await normalizeQuestionPayload(serialized.questions[0], 1)
    let denied = false
    try {
      await setDoc(doc(adminDb, 'quizzes', 'paper_quiz_admin', 'questions', 'bogus_marks'), {
        ...cleanQ,
        marks: 5000,
      })
    } catch {
      denied = true
    }
    if (!denied) throw new Error('marks: 5000 was accepted — marks bounds gate lost')
  })

  await test('admin can publish the paper quiz (Studio publish flip)', async () => {
    // PastPaperStudio.publish(): setDoc(..., { merge: true }) flipping the
    // quiz public — the exact fields the studio writes.
    await assertSucceeds(setDoc(doc(adminDb, 'quizzes', 'paper_quiz_admin'), {
      isPublished: true,
      publicAccess: true,
      title: 'Grade 5 Mathematics 2024 — Quiz',
      subject: 'Mathematics',
      linkedPaperId: 'paper_abc123',
      quizType: 'past_paper',
      updatedAt: serverTimestamp(),
    }, { merge: true }))
  })

  await testEnv.cleanup()

  console.log('')
  console.log(`Passed: ${pass}`)
  console.log(`Failed: ${fail}`)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(1)
})
