/**
 * Regression guard: inserting a banked question must never become a
 * read-modify-write of a question ARRAY.
 *
 * `node scripts/test-bank-insert-writes.mjs` or `npm run test:bank-insert-writes`.
 *
 * ## Why this is a source scan and not a behaviour test
 *
 * The failure it guards against is the historical zero-question wipe: a flow
 * that reads a paper's questions, appends one in memory and writes the whole
 * list back loses every question the moment the read comes back short — an
 * offline read, a partial page, a permissions hiccup — and it loses them
 * *silently*, because writing an array of one is a perfectly successful write.
 *
 * A behaviour test cannot see the difference. `saveAssessmentQuestions(id, [q])`
 * writing one document and `updateDoc(paper, { questions: [q] })` writing one
 * array both "insert a question"; only the second can erase the other 29, and
 * only the shape of the call tells you which one you have. So the shape is what
 * is pinned:
 *
 *   1. A paper's questions live in the `assessments/{id}/questions` SUBCOLLECTION,
 *      one document per question, written with `batch.set` on a fresh ref.
 *   2. Nothing in the insert flow uses `arrayUnion`, and nothing writes a
 *      `questions:` field onto the paper document.
 *   3. The studio's bank insert touches React state only — the existing save
 *      path does the persisting, unchanged.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/**
 * The Firestore data layer, read as ONE text.
 *
 * `useFirestore.js` was a single 1,144-line module when this guard was
 * written, so it named that file. The layer is now a facade over
 * `src/hooks/firestore/*`, and the assessment write path this guard exists to
 * pin lives in `authoringData.js`. Reading the whole directory rather than
 * naming the current file keeps the guard pointed at the BEHAVIOUR (no
 * `arrayUnion`, no `questions:` field written on a paper doc, one subcollection
 * doc per question) instead of at a filename — so the next reorganisation of
 * the data layer cannot quietly move the write path out from under it.
 */
const FIRESTORE_DIR = 'src/hooks/firestore'
const firestore = [
  read('src/hooks/useFirestore.js'),
  ...readdirSync(new URL(`../${FIRESTORE_DIR}`, import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => read(`${FIRESTORE_DIR}/${f}`)),
].join('\n')
const studio = read('src/features/assessmentStudio/pages/AssessmentStudio.jsx')
const placement = read('src/features/assessmentStudio/lib/questionBankPlacement.js')

console.log('\nbank-insert-writes')

check('questions are written one document per question into the subcollection', () => {
  assert.match(
    firestore,
    /doc\(collection\(db, 'assessments', assessmentId, 'questions'\)\)/,
    'saveAssessmentQuestions must mint a fresh subcollection doc ref per question',
  )
  assert.match(firestore, /batch\.set\(ref, await normalizeQuestionPayload/)
})

check('no assessment write path uses arrayUnion', () => {
  // arrayUnion on a questions field is the shape this guard exists to refuse:
  // it is an append to an array living on the paper document.
  for (const [name, source] of [['the Firestore data layer', firestore], ['AssessmentStudio.jsx', studio]]) {
    assert.equal(/arrayUnion/.test(source), false, `${name} must not use arrayUnion`)
  }
})

/**
 * Does any `updateDoc(` / `setDoc(` / `addDoc(` call in `source` write a
 * `questions:` field?
 *
 * Scanned by walking forward from each call rather than with one regex: a
 * character class cannot be used to "stay inside the call", because the very
 * first argument is itself a call — `updateDoc(doc(db, 'assessments', id), …)`
 * — and `[^)]*` stops dead at its closing bracket, which is how a guard like
 * this ends up matching nothing and passing forever. The window is the call's
 * own balanced extent, so `questions:` in an unrelated call further down the
 * file is not attributed to this one.
 */
function writesQuestionsField(source) {
  const hits = []
  const call = /\b(updateDoc|setDoc|addDoc)\s*\(/g
  let match
  while ((match = call.exec(source)) !== null) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1
      else if (source[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const body = source.slice(match.index, end + 1)
    if (/\bquestions\s*:/.test(body)) hits.push(body.slice(0, 120))
  }
  return hits
}

check('the extent scanner really finds a questions-array write', () => {
  // A guard that cannot fail is decoration. Prove it fires on the exact shape
  // it is meant to refuse, and stays quiet on the count field beside it.
  assert.equal(
    writesQuestionsField("await updateDoc(doc(db, 'assessments', id), { questions: qs, updatedAt: 1 })").length,
    1,
  )
  assert.equal(
    writesQuestionsField("await updateDoc(doc(db, 'assessments', id), { questionCount: 3, totalMarks })").length,
    0,
  )
})

check('the paper document never carries a questions array', () => {
  // `questionCount` is a number and is fine; `questions:` as a written FIELD is
  // the array whose overwrite loses a paper.
  assert.deepEqual(writesQuestionsField(firestore), [], 'the Firestore data layer must not write a questions field on a doc')
  assert.deepEqual(writesQuestionsField(studio), [], 'AssessmentStudio must not write a questions field on a doc')
})

check('the bank insert path touches React state only', () => {
  const start = studio.indexOf('function insertBankCopyAt')
  assert.ok(start > 0, 'insertBankCopyAt must exist — this guard is pinned to it by name')
  const body = studio.slice(start, studio.indexOf('\n  }', start))
  // The whole insert is a setSections splice plus a fire-and-forget usage bump.
  assert.match(body, /setSections\(prev =>/)
  assert.match(body, /insertStandaloneSection\(prev, \{/)
  for (const forbidden of ['updateDoc', 'setDoc', 'writeBatch', 'addDoc', 'getDocs', 'saveAssessmentQuestions']) {
    assert.equal(body.includes(forbidden), false, `insertBankCopyAt must not call ${forbidden}`)
  }
})

check('the usage counter is an atomic increment, not a read-then-write', () => {
  const service = read('src/utils/questionBankService.js')
  assert.match(service, /usageCount: increment\(1\)/)
  // A read-modify-write of the counter would lose one of two rapid inserts.
  assert.equal(/usageCount:\s*\(?\s*Number\(/.test(service), false)
})

check('the insert copy is deep, so the paper and the bank share no state', () => {
  assert.match(placement, /structuredClone\(question\)/)
  assert.match(placement, /JSON\.parse\(JSON\.stringify\(question\)\)/)
})

console.log(`\n✅ bank-insert-writes: ${passed} assertions passed\n`)
