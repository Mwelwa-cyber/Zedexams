#!/usr/bin/env node
/**
 * scripts/cleanup-phantom-assessments.mjs
 *
 * One-off cleanup for PHANTOM assessment papers — papers the Assessment Paper
 * Studio filed without a teacher ever authoring them.
 *
 * How they got there: the studio seeds a new paper with one blank starter
 * question in local state, and it decided "the teacher has edited this" from
 * paper CONTENT — a test its own School-Profile seeding defeated by writing the
 * teacher's school name onto an untouched paper. So loading
 * /teacher/assessment-papers/new and doing nothing filed a paper (one blank
 * question, the generated title, one mark) into the library and onto the
 * dashboard's Recent Documents feed about two seconds later, every visit.
 *
 * The trigger condition is fixed in code (isUntouchedPaper +
 * countAuthoredQuestions, src/components/teacher/assessmentAutosave.js), so no
 * new phantoms are being created. This removes the ones already filed. It is
 * NOT a scheduled sweep and must never become one: deleting papers on a timer
 * is how a teacher's real work disappears.
 *
 * ── What counts as a phantom ───────────────────────────────────────────
 *
 * Every check is a reason to KEEP; a paper is deleted only when there is
 * nothing in it a teacher could have put there:
 *
 *   • no questions, or exactly one and that one is blank — no text, no
 *     options, no figure, the default single mark, not `teacherEdited`;
 *   • questionCount ≤ 1, totalMarks ≤ 1, no passages / parts / page breaks;
 *   • nothing typed into the paper itself (topic, class, paper name, date);
 *   • not generated against a blueprint, not imported from a file;
 *   • its title is one this codebase generated for it, and not one a teacher
 *     typed (`titleSource: 'manual'`).
 *
 * School branding (school name, motto, address, EMIS, footer), the duration and
 * the cover instructions are deliberately NOT evidence of authoring — the studio
 * seeds all of them from the saved School Profile, which is what made them
 * useless as a signal and caused the bug.
 *
 * The rules live in src/components/teacher/phantomAssessment.js and are tested
 * by `npm run test:phantom-assessments`.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN (default)   No writes. Prints every paper it would delete, and the
 *                       reason each kept paper is being kept.
 *   LIVE  (--live)      Prints the same list, then requires you to type DELETE.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --teacher=<uid>   Limit to one teacher's papers (createdBy).
 *   --limit=N         Cap papers inspected.
 *   --show-kept       Also print every kept paper and why.
 *   --yes             Skip the typed confirmation (for a non-interactive run;
 *                     the flag itself is the confirmation).
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Dry run by default, and --live still asks.
 *   • Every deleted doc — the paper AND its question — is copied to
 *       backups/phantom_assessments/docs/<assessmentId>[_<questionId>]
 *     first, so a restore is a copy-back rather than a recreate.
 *   • Re-running is idempotent: a clean library finds nothing.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/cleanup-phantom-assessments.mjs                  # dry run
 *   node scripts/cleanup-phantom-assessments.mjs --show-kept
 *   node scripts/cleanup-phantom-assessments.mjs --live           # asks first
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON path) to read
 * or write Firestore. Without it the script explains the rules and exercises
 * them against a fixture, so the logic can be reviewed with no project access.
 */

import { planPhantomCleanup } from '../src/components/teacher/phantomAssessment.js'
import { createStandaloneSection, serializeQuizSections } from '../src/utils/quizSections.js'
import { confirmByTyping } from './lib/confirmPrompt.mjs'

const LIVE = process.argv.includes('--live')
const ASSUME_YES = process.argv.includes('--yes')
const SHOW_KEPT = process.argv.includes('--show-kept')
const arg = (name) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}
const TEACHER = arg('teacher')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const BATCH_SIZE = 400

function describe(row) {
  const a = row.assessment || {}
  const title = String(a.title ?? '').trim() || '(no title)'
  return `${row.id}  "${title}"  ${a.subject || '—'} / ${a.grade || '—'} / term ${a.term || '—'}`
    + `  · questions ${(row.questions || []).length}, marks ${a.totalMarks ?? 0}`
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

async function readCandidates(db) {
  let query = db.collection('assessments')
  if (TEACHER) query = query.where('createdBy', '==', TEACHER)
  const snap = await query.get()
  const entries = []
  for (const doc of snap.docs) {
    if (entries.length >= LIMIT) break
    const questionsSnap = await doc.ref.collection('questions').get()
    entries.push({
      id: doc.id,
      ref: doc.ref,
      assessment: doc.data(),
      questions: questionsSnap.docs.map(q => ({ id: q.id, ...q.data() })),
      questionRefs: questionsSnap.docs.map(q => q.ref),
    })
  }
  return entries
}

async function deletePhantoms(admin, db, rows) {
  let batch = db.batch()
  let ops = 0
  const flush = async () => {
    if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0 }
  }
  for (const row of rows) {
    const backupRef = db.collection('backups').doc('phantom_assessments')
      .collection('docs').doc(row.id)
    batch.set(backupRef, {
      assessmentId: row.id,
      original: row.assessment,
      questions: row.questions,
      evidence: row.evidence,
      at: admin.firestore.FieldValue.serverTimestamp(),
    })
    ops += 1
    for (const ref of row.questionRefs) {
      batch.delete(ref)
      ops += 1
    }
    batch.delete(row.ref)
    ops += 1
    if (ops >= BATCH_SIZE) await flush()
  }
  await flush()
}

async function runAgainstFirestore(admin) {
  const db = admin.firestore()
  console.log(`Scanning assessments${TEACHER ? ` for teacher ${TEACHER}` : ''}…\n`)
  const entries = await readCandidates(db)
  const { remove, keep } = planPhantomCleanup(entries)

  console.log(`Inspected ${entries.length} paper${entries.length === 1 ? '' : 's'}.`)
  console.log(`\n── ${remove.length} phantom paper${remove.length === 1 ? '' : 's'} to delete ──`)
  for (const row of remove) {
    console.log(`  ${describe(row)}`)
    console.log(`      because: ${row.evidence.join('; ')}`)
  }
  if (!remove.length) console.log('  (none — nothing to do)')

  if (SHOW_KEPT) {
    console.log(`\n── ${keep.length} paper${keep.length === 1 ? '' : 's'} kept ──`)
    for (const row of keep) {
      console.log(`  ${describe(row)}`)
      console.log(`      kept because: ${row.keptBecause.join('; ')}`)
    }
  } else {
    console.log(`\n${keep.length} paper${keep.length === 1 ? '' : 's'} kept (--show-kept to list them).`)
  }

  if (!remove.length) return
  if (!LIVE) {
    console.log('\n── DRY RUN — nothing was written. Re-run with --live to delete. ──')
    return
  }

  const questionDocs = remove.reduce((sum, row) => sum + row.questionRefs.length, 0)
  const ok = ASSUME_YES || await confirmByTyping(
    `About to DELETE ${remove.length} paper${remove.length === 1 ? '' : 's'} `
    + `and ${questionDocs} question doc${questionDocs === 1 ? '' : 's'} listed above. `
    + `A copy of each is written to backups/phantom_assessments first.`,
  )
  if (!ok) {
    console.log('\nAborted — nothing was deleted.')
    process.exitCode = 1
    return
  }
  await deletePhantoms(admin, db, remove)
  console.log(`\nDeleted ${remove.length} phantom paper${remove.length === 1 ? '' : 's'} `
    + `(${questionDocs} question doc${questionDocs === 1 ? '' : 's'}). `
    + 'Backups are in backups/phantom_assessments/docs.')
}

// No credentials: demonstrate the rules on a fixture rather than pretending to
// have scanned anything.
function runFixtureDemo() {
  console.log('No GOOGLE_APPLICATION_CREDENTIALS — running the rules against a fixture.')
  console.log('Set it to a service-account JSON path to scan the real collection.\n')
  const blankQuestion = serializeQuizSections([createStandaloneSection()], []).questions[0]
  const branding = {
    schoolName: 'Kabulonga Primary School', motto: 'Knowledge is power',
    coverInstructions: 'Answer ALL questions.', duration: 90,
  }
  const entries = [
    {
      id: 'phantom-visit-1',
      assessment: {
        ...branding, title: 'GRADE 4 END OF TERM 1 TEST - 2026', subject: 'Integrated Science',
        grade: '4', term: '1', year: 2026, assessmentType: 'end_of_term',
        questionCount: 1, totalMarks: 1,
      },
      questions: [blankQuestion],
      questionRefs: [null],
    },
    {
      id: 'real-paper-1',
      assessment: {
        ...branding, title: 'GRADE 4 HOME ECONOMICS - END OF TERM 2 TEST - 2026',
        subject: 'Home Economics', grade: '4', term: '2', year: 2026,
        assessmentType: 'end_of_term', questionCount: 20, totalMarks: 40,
      },
      questions: [{ ...blankQuestion, text: '<p>Name two kitchen tools.</p>' }],
      questionRefs: [null],
    },
  ]
  const { remove, keep } = planPhantomCleanup(entries)
  for (const row of remove) {
    console.log(`  DELETE  ${describe(row)}`)
    console.log(`      because: ${row.evidence.join('; ')}`)
  }
  for (const row of keep) {
    console.log(`  KEEP    ${describe(row)}`)
    console.log(`      kept because: ${row.keptBecause.join('; ')}`)
  }
  console.log('\nRun `npm run test:phantom-assessments` to exercise the rules in full.')
}

const admin = await loadAdmin()
if (admin) await runAgainstFirestore(admin)
else runFixtureDemo()
