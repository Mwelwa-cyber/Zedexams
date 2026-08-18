#!/usr/bin/env node
/**
 * scripts/audit-answer-key-shapes.mjs
 *
 * A census of how MCQ / true-false answer keys are actually STORED in
 * `quizzes/{quizId}/questions/{questionId}`, so the choice between the two
 * answer-key resolvers can be made on data instead of on argument.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 *
 * Two resolvers grade the same documents:
 *
 *   src/utils/quizScoring.js       isQuestionCorrect() ends MCQ grading with
 *                                  `answer === question.correctAnswer`
 *   PublicQuizRunner.jsx           isCorrectChoice() accepts FOUR shapes —
 *                                  correctAnswerIndex, correctIndex,
 *                                  correctAnswer (int | text | letter), and
 *                                  options[i].isCorrect
 *
 * Both read `quizzes/{id}/questions` (pastPaperQuiz.js:116,134), and a paper's
 * attached quiz is reachable through BOTH `/papers/:paperId/quiz` and
 * `/quiz/:quizId`. So the same question can be graded either way.
 *
 * A source audit says every writer in the repo normalises MCQ/TF answers to a
 * NUMERIC INDEX — the editor save path (questionWritePayload.js:170), CSV
 * import, document import, scanned import and the AI question generator. If
 * that holds in production too, the four-shape resolver's extra branches are
 * dead code and the two can be collapsed with no migration and no re-scoring.
 *
 * Source arguments cannot see legacy documents. This script can.
 *
 * ── The one rule it applies ───────────────────────────────────────────
 *
 * `Number.isInteger(correctAnswer)` is the ONLY shape the two resolvers agree
 * on. For every other shape the strict scorer compares the learner's option
 * INDEX (a number) against a non-number and returns false for every option —
 * so the learner is marked wrong whatever they pick — while the four-shape
 * resolver resolves it. Any question outside that shape is therefore both a
 * resolver disagreement and, on the practice-quiz route, a scoring bug.
 *
 * ── It is read-only, structurally ─────────────────────────────────────
 *
 * No write method is called anywhere in this file, and
 * `npm run test:answer-key-audit` fails the build if one appears. An audit that
 * could mutate the thing it is auditing is not an audit.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   npm run audit:answer-keys
 *
 * Flags:
 *   --quiz=<id>       Audit one quiz only.
 *   --limit=<n>       Stop after n quizzes (default: all).
 *   --show-values     Print the stored answer key itself. OFF by default —
 *                     the output otherwise contains no answer to any question,
 *                     so it is safe to paste into an issue or a chat.
 *   --json            Emit the full report as JSON on stdout instead of a
 *                     human summary, for piping.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON path).
 * Without it the script explains itself and scans nothing.
 */

const PAGE_SIZE = 200

/** Question types whose answer key is an option index. Everything else is out of scope. */
const CHOICE_TYPES = new Set([
  'mcq', 'multiple_choice', 'multipleChoice',
  'tf', 'truefalse', 'true_false', 'trueFalse',
])

export function isChoiceQuestion(q) {
  const type = String(q?.type ?? 'mcq').trim()
  // A question with no `type` is an MCQ by the schema's own default.
  return type === '' ? true : CHOICE_TYPES.has(type)
}

/**
 * Classify one stored question's answer key.
 *
 * Shapes are ordered by how the four-shape resolver reads them, so the label
 * says which branch WOULD win — not merely which fields happen to be present.
 *
 * @returns {{shape: string, agrees: boolean, corruptedByResave: boolean, value: unknown}}
 *   shape              a stable id, listed in SHAPES below
 *   agrees             do the two resolvers reach the same verdict
 *   corruptedByResave  would questionWritePayload's `Number(x) || 0` silently
 *                      rewrite this key to option A on the next editor save
 */
export function classifyAnswerKey(q) {
  const options = Array.isArray(q?.options) ? q.options : []
  const optionText = (o) => {
    if (o == null) return ''
    if (typeof o === 'string') return o
    if (typeof o === 'object') return String(o.text ?? '')
    return String(o)
  }

  // 1 & 2 — dedicated index fields. Nothing in the repo writes these.
  if (Number.isInteger(q?.correctAnswerIndex)) {
    return { shape: 'correctAnswerIndex', agrees: false, corruptedByResave: true, value: q.correctAnswerIndex }
  }
  if (Number.isInteger(q?.correctIndex)) {
    return { shape: 'correctIndex', agrees: false, corruptedByResave: true, value: q.correctIndex }
  }

  // 3 — the healthy shape, and the only one both resolvers agree on.
  if (Number.isInteger(q?.correctAnswer)) {
    return { shape: 'index', agrees: true, corruptedByResave: false, value: q.correctAnswer }
  }

  // 4 — per-option boolean.
  if (options.some((o) => o && typeof o === 'object' && o.isCorrect === true)) {
    return { shape: 'option.isCorrect', agrees: false, corruptedByResave: true, value: null }
  }

  // 5 — a string key. Three sub-shapes, because they carry different risk.
  if (typeof q?.correctAnswer === 'string') {
    const raw = q.correctAnswer.trim()
    if (raw === '') {
      return { shape: 'empty', agrees: false, corruptedByResave: false, value: '' }
    }
    const asNumber = Number(raw)
    if (Number.isFinite(asNumber)) {
      // "2" — re-save coerces it to the same index, so nothing is lost, but the
      // strict scorer still marks every answer wrong until it is re-saved.
      return { shape: 'numeric-string', agrees: false, corruptedByResave: false, value: raw }
    }
    const textHit = options.findIndex((o) => optionText(o).trim().toLowerCase() === raw.toLowerCase())
    if (textHit >= 0) {
      return { shape: 'option-text', agrees: false, corruptedByResave: true, value: raw }
    }
    if (/^[A-Ha-h]$/.test(raw)) {
      return { shape: 'letter', agrees: false, corruptedByResave: true, value: raw }
    }
    return { shape: 'text-unmatched', agrees: false, corruptedByResave: true, value: raw }
  }

  // 6 — nothing usable. An unanswerable question, not a resolver disagreement.
  return { shape: 'missing', agrees: false, corruptedByResave: false, value: q?.correctAnswer ?? null }
}

/** Human descriptions, printed under each non-zero count. */
export const SHAPES = {
  'index': 'healthy — both resolvers agree; nothing to do',
  'correctAnswerIndex': 'legacy index field — strict scorer marks every answer wrong',
  'correctIndex': 'legacy index field — strict scorer marks every answer wrong',
  'option.isCorrect': 'per-option flag — strict scorer marks every answer wrong',
  'numeric-string': 'index stored as text — strict scorer marks every answer wrong',
  'option-text': 'key is the option TEXT — strict scorer marks every answer wrong',
  'letter': 'key is a letter (A–D) — strict scorer marks every answer wrong',
  'text-unmatched': 'key matches no option — broken regardless of resolver',
  'empty': 'no answer key recorded',
  'missing': 'no answer key recorded',
}

/** Roll a stream of classifications into the report the CLI prints. */
export function summarise(rows) {
  const byShape = {}
  for (const r of rows) {
    byShape[r.shape] ??= { count: 0, quizzes: new Set(), examples: [] }
    const b = byShape[r.shape]
    b.count += 1
    b.quizzes.add(r.quizId)
    if (b.examples.length < 5) b.examples.push(r)
  }
  const total = rows.length
  const disagreeing = rows.filter((r) => !r.agrees).length
  const corruptible = rows.filter((r) => r.corruptedByResave).length
  return {
    total,
    disagreeing,
    corruptible,
    clean: disagreeing === 0,
    byShape: Object.fromEntries(
      Object.entries(byShape).map(([k, v]) => [k, { count: v.count, quizzes: v.quizzes.size, examples: v.examples }]),
    ),
  }
}

// ── Firestore ────────────────────────────────────────────────────────────────

const FLAG = (name) => process.argv.includes(`--${name}`)
const ARG = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : null
}

async function loadAdmin() {
  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('ERROR: this script needs `npm install --save-dev firebase-admin`')
    process.exit(1)
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null
  admin.default.initializeApp()
  return admin.default
}

/**
 * Page through a collection.
 *
 * Ordered by `__name__` with no `where`, so it uses the index every collection
 * already has — this must not depend on a composite index that may not exist
 * in the project it is pointed at.
 */
async function* pagesOf(ref, cap = Infinity) {
  let cursor = null
  let seen = 0
  for (;;) {
    let q = ref.orderBy('__name__').limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) return
    yield snap.docs
    seen += snap.docs.length
    if (seen >= cap || snap.docs.length < PAGE_SIZE) return
    cursor = snap.docs[snap.docs.length - 1]
  }
}

async function runAgainstFirestore(admin) {
  const db = admin.firestore()
  const onlyQuiz = ARG('quiz')
  const quizCap = Number(ARG('limit')) || Infinity
  const showValues = FLAG('show-values')
  const asJson = FLAG('json')

  const rows = []
  let quizzesSeen = 0
  let skippedNonChoice = 0

  const auditQuiz = async (quizDoc) => {
    quizzesSeen += 1
    const quiz = quizDoc.data() ?? {}
    for await (const page of pagesOf(quizDoc.ref.collection('questions'))) {
      for (const qDoc of page) {
        const q = qDoc.data() ?? {}
        if (!isChoiceQuestion(q)) { skippedNonChoice += 1; continue }
        const verdict = classifyAnswerKey(q)
        rows.push({
          quizId: quizDoc.id,
          quizTitle: String(quiz.title ?? '').slice(0, 60),
          questionId: qDoc.id,
          type: q.type ?? '(default mcq)',
          optionCount: Array.isArray(q.options) ? q.options.length : 0,
          ...verdict,
          value: showValues ? verdict.value : undefined,
        })
      }
    }
    if (!asJson && quizzesSeen % 25 === 0) {
      process.stderr.write(`  …${quizzesSeen} quizzes, ${rows.length} choice questions\n`)
    }
  }

  if (onlyQuiz) {
    const doc = await db.collection('quizzes').doc(onlyQuiz).get()
    if (!doc.exists) {
      console.error(`No quiz ${onlyQuiz}.`)
      process.exit(1)
    }
    await auditQuiz(doc)
  } else {
    for await (const page of pagesOf(db.collection('quizzes'), quizCap)) {
      for (const quizDoc of page) {
        if (quizzesSeen >= quizCap) break
        await auditQuiz(quizDoc)
      }
    }
  }

  const report = summarise(rows)
  if (asJson) {
    console.log(JSON.stringify({ quizzesSeen, skippedNonChoice, ...report }, null, 2))
    process.exit(report.clean ? 0 : 2)
  }
  printReport({ quizzesSeen, skippedNonChoice, showValues, ...report })
  // Exit 2 when anything diverges, so this can gate a follow-up step in CI or
  // a shell pipeline without anyone having to read the prose.
  process.exit(report.clean ? 0 : 2)
}

function printReport(r) {
  const pct = (n) => (r.total ? `${((n / r.total) * 100).toFixed(1)}%` : '0%')
  console.log('\n─── answer-key shapes in quizzes/*/questions ───────────────────\n')
  console.log(`  quizzes scanned        ${r.quizzesSeen}`)
  console.log(`  choice questions       ${r.total}`)
  console.log(`  other types skipped    ${r.skippedNonChoice}\n`)

  const width = Math.max(...Object.keys(r.byShape).map((s) => s.length), 18)
  for (const [shape, info] of Object.entries(r.byShape).sort((a, b) => b[1].count - a[1].count)) {
    const mark = shape === 'index' ? '  ' : '! '
    console.log(`${mark}${shape.padEnd(width)}  ${String(info.count).padStart(6)}  ${pct(info.count).padStart(6)}  across ${info.quizzes} quiz${info.quizzes === 1 ? '' : 'zes'}`)
    console.log(`  ${' '.repeat(width)}  ${SHAPES[shape] ?? ''}`)
    if (shape !== 'index') {
      for (const ex of info.examples) {
        const val = r.showValues && ex.value !== undefined ? `  key=${JSON.stringify(ex.value)}` : ''
        console.log(`  ${' '.repeat(width)}    quizzes/${ex.quizId}/questions/${ex.questionId}${val}`)
      }
    }
    console.log()
  }

  console.log('─── verdict ────────────────────────────────────────────────────\n')
  if (r.clean) {
    console.log('  Every choice question stores its key as a numeric index.')
    console.log('  The two resolvers agree on all of them, so PublicQuizRunner\'s')
    console.log('  four-shape isCorrectChoice can be replaced by isQuestionCorrect')
    console.log('  with NO migration and NO re-scoring of past results.\n')
  } else {
    console.log(`  ${r.disagreeing} question${r.disagreeing === 1 ? '' : 's'} (${pct(r.disagreeing)}) do NOT store a numeric index.`)
    console.log('  On the practice-quiz route these are graded by')
    console.log('  `answer === question.correctAnswer`, which compares the learner\'s')
    console.log('  option index against a non-number — so the learner is marked wrong')
    console.log('  whichever option they choose. The past-paper route resolves them.\n')
    if (r.corruptible) {
      console.log(`  ${r.corruptible} of them would be SILENTLY REWRITTEN to option A the next`)
      console.log('  time the question is saved in the editor: questionWritePayload.js')
      console.log('  computes `Number(correctAnswer) || 0`, and a letter or option text')
      console.log('  gives NaN → 0. Fix that coercion BEFORE anyone edits these.\n')
    }
    console.log('  Re-run with --show-values to see the stored keys, or')
    console.log('  --quiz=<id> to inspect one quiz.\n')
  }
}

function explainWithoutCredentials() {
  console.log('No GOOGLE_APPLICATION_CREDENTIALS — not scanning anything.\n')
  console.log('This script READS quizzes/*/questions and reports how each MCQ and')
  console.log('true-false answer key is stored. It writes nothing, ever.\n')
  console.log('It answers one question: does any question store its key as')
  console.log('something other than a numeric index? If none does, the two answer-key')
  console.log('resolvers can be collapsed into one with no migration.\n')
  console.log('  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json')
  console.log('  npm run audit:answer-keys\n')
  console.log('Exit code: 0 = every key is an index, 2 = at least one is not.')
}

// Only run the CLI when this file IS the entry point, so importing it for its
// exported helpers (the test does) cannot connect to Firestore.
const invokedAsScript =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`

if (invokedAsScript) {
  const admin = await loadAdmin()
  if (admin) await runAgainstFirestore(admin)
  else explainWithoutCredentials()
}
