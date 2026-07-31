#!/usr/bin/env node
/**
 * scripts/migrate-canonical-education.mjs
 *
 * Rewrite every stored subject, grade and curriculum value onto the canonical
 * education model (src/config/canonicalEducation.js).
 *
 * ── Why ────────────────────────────────────────────────────────────────
 *
 * Five subject vocabularies, four curriculum names and three grade lists were
 * in production at once. Records written by one studio could not be matched to
 * records written by another: a scheme of work for "Integrated Science" and a
 * timetable slot for "Science" named the same subject and shared no value.
 * The code now renders every picker from the canonical model, so NEW records
 * agree. This migration brings the OLD ones into line.
 *
 * ── The one thing to understand before running it ──────────────────────
 *
 * Different collections legitimately store the same concept in different
 * SCHEMES, and this migration does not flatten them into one:
 *
 *   • The learner quiz catalogue stores a subject's learner-facing LABEL
 *     ('Integrated Science') and a bare grade number ('5'), because that is
 *     what its filters and its Firestore composite indexes query on.
 *   • A class stores the canonical subject ID ('integrated_science') and the
 *     canonical grade CODE ('G5').
 *   • The class register stores its own grade scheme ('nursery', '4', 'form-1').
 *
 * Rewriting a learner quiz's subject to 'integrated_science' would make it
 * invisible to every learner filter, and rewriting a class's grade to '5'
 * would undo the FK the new pickers write. So each field below declares the
 * scheme it must END UP in, and the migration converts to THAT — canonical
 * identity is established by making every value resolve to the same canonical
 * record, not by making every value the same string.
 *
 * ── Fail loudly, never guess ───────────────────────────────────────────
 *
 * A value the canonical model cannot map is REPORTED and left untouched. Two
 * kinds are distinguished, because they need different human responses:
 *
 *   unmapped    nothing in the model recognises it — likely a typo or a
 *               subject we do not carry. Someone must look.
 *   ambiguous   it named TWO subjects at once (the pre-split
 *               "Commerce & Principles of Accounts"). There is no correct
 *               fold; the record has to be classified from its own topics or
 *               re-picked by the teacher.
 *
 * The process exits NON-ZERO when either count is greater than zero, in both
 * dry-run and live mode, so a migration that quietly skipped half the corpus
 * cannot be mistaken for a clean one.
 *
 * ── Safety guarantees ──────────────────────────────────────────────────
 *
 *   • Idempotent — a canonical value maps to itself, so a second pass is a
 *     no-op. This is exercised by the test suite rather than asserted here.
 *   • Backs the ORIGINAL doc up to backups/canonical_education/docs/… before
 *     any write.
 *   • Field-level merge — no other field on the doc is touched.
 *   • Logs every rewrite, with the collection, doc id, field, and before/after.
 *   • Batched writes (Firestore cap 500; 400 for headroom).
 *   • Pure planning logic is exported so the tests exercise it with no
 *     Firestore at all.
 *
 * ── Usage ──────────────────────────────────────────────────────────────
 *
 *   node scripts/migrate-canonical-education.mjs              # dry run
 *   node scripts/migrate-canonical-education.mjs --live       # writes
 *   node scripts/migrate-canonical-education.mjs --live --limit=50
 *   node scripts/migrate-canonical-education.mjs --report=out.json
 */

import {
  migrationSubjectId, migrationGradeCode, migrationCurriculumId,
  ambiguousSubjectOptions, getGrade, getSubject, subjectName, gradeNumberOf,
} from '../src/config/canonicalEducation.js'
import { SUBJECTS, PAPER_SUBJECTS } from '../src/config/curriculum.js'

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const REPORT_ARG = process.argv.find((a) => a.startsWith('--report='))
const REPORT_PATH = REPORT_ARG ? REPORT_ARG.split('=')[1] : ''
const BATCH_SIZE = 400

/* ── Target schemes ──────────────────────────────────────────────────────
 * Each writes a DIFFERENT string for the same canonical record. See the
 * header: this is deliberate, not an oversight.
 */

/** canonical subject id → the learner catalogue's display label. */
const LEARNER_LABEL_BY_CANONICAL_ID = (() => {
  const map = {}
  for (const s of PAPER_SUBJECTS) {
    if (s.canonicalId && !(s.canonicalId in map)) map[s.canonicalId] = s.label
  }
  return map
})()

/** Learner-catalogue labels that are NOT canonical subjects (Special Paper 1). */
const NON_CANONICAL_LEARNER_LABELS = new Set(
  PAPER_SUBJECTS.filter((s) => !s.canonicalId).map((s) => s.label),
)

const SUBJECT_SCHEMES = {
  /** The stable slug: 'integrated_science'. */
  'canonical-id': (id) => id,
  /** The canonical display name: 'Science'. */
  'canonical-name': (id) => subjectName(id),
  /**
   * The learner catalogue's label: 'Integrated Science'. Used where learner
   * filters and Firestore indexes query on the label. A canonical subject with
   * no learner-catalogue entry (a secondary subject) has no label to write, so
   * the record is reported rather than rewritten to something no filter knows.
   */
  'learner-label': (id) => LEARNER_LABEL_BY_CANONICAL_ID[id] || '',
}

const GRADE_SCHEMES = {
  /** 'G5', 'ECE_N'. */
  code: (code) => code,
  /** '5' — the learner catalogue's bare number. ECE has none. */
  number: (code) => gradeNumberOf(code),
  /** The class register's own scheme: 'nursery' / '4' / 'form-1'. */
  register: (code) => {
    const g = getGrade(code)
    if (!g) return ''
    if (g.stage === 'ece') return g.properName.toLowerCase()
    if (g.formNumber != null) return `form-${g.formNumber}`
    return String(g.gradeNumber)
  },
}

/* ── What gets migrated ──────────────────────────────────────────────────
 * One entry per (collection, field). `kind` selects the resolver, `scheme`
 * selects what string is written back.
 */
export const MIGRATION_TARGETS = [
  // Classes now store canonical ids/codes — the pickers write them, so old
  // documents must catch up or a class and a paper disagree again.
  { collection: 'classes', field: 'grade', kind: 'grade', scheme: 'code' },
  { collection: 'classes', field: 'subject', kind: 'subject', scheme: 'canonical-id' },

  // The register keeps its own grade scheme; only genuinely stale spellings
  // ('baby', 'middle', 'Grade 4') are normalised onto it.
  { collection: 'classRegisters', field: 'grade', kind: 'grade', scheme: 'register' },
  { collection: 'classRegisters', field: 'subject', kind: 'subject', scheme: 'canonical-id' },

  // The learner catalogue keeps its label + bare-number scheme.
  { collection: 'quizzes', field: 'subject', kind: 'subject', scheme: 'learner-label' },
  { collection: 'quizzes', field: 'grade', kind: 'grade', scheme: 'number' },
  { collection: 'lessons', field: 'subject', kind: 'subject', scheme: 'learner-label' },
  { collection: 'lessons', field: 'grade', kind: 'grade', scheme: 'number' },
  { collection: 'notes', field: 'subject', kind: 'subject', scheme: 'learner-label' },
  { collection: 'notes', field: 'grade', kind: 'grade', scheme: 'number' },
  { collection: 'results', field: 'subject', kind: 'subject', scheme: 'learner-label' },
  { collection: 'results', field: 'grade', kind: 'grade', scheme: 'number' },

  // Teacher-authored documents speak the canonical slug + G-code, which is what
  // the generators' ALLOWED_SUBJECTS / ALLOWED_GRADES already accept.
  { collection: 'aiGenerations', field: 'subject', kind: 'subject', scheme: 'canonical-id' },
  { collection: 'aiGenerations', field: 'grade', kind: 'grade', scheme: 'code' },
  { collection: 'aiGenerations', field: 'curriculum', kind: 'curriculum' },
  { collection: 'questionBank', field: 'subject', kind: 'subject', scheme: 'canonical-id' },
  { collection: 'questionBank', field: 'grade', kind: 'grade', scheme: 'code' },
  { collection: 'questionBank', field: 'curriculum', kind: 'curriculum' },

  // A saved paper's subject is the NAME printed on it, so it takes the
  // canonical display name rather than the slug. Its grade keeps the paper
  // ladder's mixed scheme, which `register`-style conversion would break, so it
  // is deliberately absent here — paperTaxonomy.normalizePaperGrade already
  // repairs it on every open and save.
  { collection: 'assessments', field: 'subject', kind: 'subject', scheme: 'canonical-name' },
  { collection: 'assessments', field: 'curriculum', kind: 'curriculum' },
  { collection: 'assessments', field: 'framework', kind: 'curriculum' },
]

/* ── Pure planning ───────────────────────────────────────────────────────── */

/**
 * Decide what a single field should become.
 *
 * @returns {{status:'noop'|'rewrite'|'unmapped'|'ambiguous', from?:string,
 *            to?:string, options?:string[], reason?:string}}
 */
export function planField(value, target) {
  if (value == null || value === '') return { status: 'noop' }
  const from = String(value)
  if (!from.trim()) return { status: 'noop' }

  if (target.kind === 'curriculum') {
    const id = migrationCurriculumId(from)
    if (!id) return { status: 'unmapped', from, reason: 'no canonical curriculum for this value' }
    return id === from ? { status: 'noop' } : { status: 'rewrite', from, to: id }
  }

  if (target.kind === 'grade') {
    const code = migrationGradeCode(from)
    if (!code) return { status: 'unmapped', from, reason: 'no canonical grade for this value' }
    const to = GRADE_SCHEMES[target.scheme](code)
    if (!to) {
      // An ECE band written into a bare-number field has no representation
      // there. Reported rather than blanked — losing the level is worse than
      // leaving it in a spelling the filter does not match.
      return {
        status: 'unmapped', from,
        reason: `grade ${code} has no value in the '${target.scheme}' scheme`,
      }
    }
    return to === from ? { status: 'noop' } : { status: 'rewrite', from, to }
  }

  // subject
  const ambiguous = ambiguousSubjectOptions(from)
  if (ambiguous) {
    return {
      status: 'ambiguous', from, options: [...ambiguous],
      reason: 'this value named two subjects; classify it from the record itself',
    }
  }
  // A learner-catalogue category that is not a canonical subject (the Grade 7
  // PSLE "Special Paper 1") is left exactly as it is — it is correct already.
  if (target.scheme === 'learner-label' && NON_CANONICAL_LEARNER_LABELS.has(from)) {
    return { status: 'noop' }
  }
  const id = migrationSubjectId(from)
  if (!id) return { status: 'unmapped', from, reason: 'no canonical subject for this value' }
  const to = SUBJECT_SCHEMES[target.scheme](id)
  if (!to) {
    return {
      status: 'unmapped', from,
      reason: `${id} has no learner-catalogue label; it is not a learner subject`,
    }
  }
  return to === from ? { status: 'noop' } : { status: 'rewrite', from, to }
}

/**
 * Plan every migratable field on one document.
 *
 * @returns {{patch:object|null, rewrites:Array, problems:Array}}
 */
export function planDocument(collection, docId, data) {
  const patch = {}
  const rewrites = []
  const problems = []
  for (const target of MIGRATION_TARGETS) {
    if (target.collection !== collection) continue
    if (!Object.prototype.hasOwnProperty.call(data || {}, target.field)) continue
    const result = planField(data[target.field], target)
    if (result.status === 'noop') continue
    if (result.status === 'rewrite') {
      patch[target.field] = result.to
      rewrites.push({ collection, docId, field: target.field, from: result.from, to: result.to })
      continue
    }
    problems.push({
      collection, docId, field: target.field, value: result.from,
      status: result.status, reason: result.reason, options: result.options,
    })
  }
  return { patch: Object.keys(patch).length ? patch : null, rewrites, problems }
}

/** The collections this migration touches, de-duplicated, in declared order. */
export function migratedCollections() {
  return [...new Set(MIGRATION_TARGETS.map((t) => t.collection))]
}

/* ── Reporting ───────────────────────────────────────────────────────────── */

function printReport({ inspected, rewrites, problems }) {
  console.log('\n── summary ──')
  console.log(`  documents inspected: ${inspected}`)
  console.log(`  field rewrites:      ${rewrites.length}`)

  const unmapped = problems.filter((p) => p.status === 'unmapped')
  const ambiguous = problems.filter((p) => p.status === 'ambiguous')
  console.log(`  unmapped values:     ${unmapped.length}`)
  console.log(`  ambiguous values:    ${ambiguous.length}`)

  if (problems.length) {
    console.log('\n── values the canonical model could not map ──')
    console.log('   Nothing below was written. Each needs a human decision.\n')
    for (const p of problems) {
      const tag = p.status === 'ambiguous' ? 'AMBIGUOUS' : 'UNMAPPED '
      console.log(`  ${tag} ${p.collection}/${p.docId}.${p.field} = ${JSON.stringify(p.value)}`)
      console.log(`            ${p.reason}`)
      if (p.options) console.log(`            names: ${p.options.join(' | ')}`)
    }
  }
  return problems.length
}

async function writeReportFile(payload) {
  if (!REPORT_PATH) return
  const { writeFile } = await import('node:fs/promises')
  await writeFile(REPORT_PATH, JSON.stringify(payload, null, 2))
  console.log(`\n  report written to ${REPORT_PATH}`)
}

/* ── Firestore runner ────────────────────────────────────────────────────── */

async function runLive() {
  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('ERROR: --live requires `npm install --save-dev firebase-admin`')
    process.exit(1)
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path')
    process.exit(1)
  }

  admin.default.initializeApp()
  const db = admin.default.firestore()

  const rewrites = []
  const problems = []
  let inspected = 0

  for (const collection of migratedCollections()) {
    console.log(`\n── Scanning ${collection} ──`)
    const snap = await db.collection(collection).get()
    console.log(`  ${snap.size} documents`)

    let batch = db.batch()
    let ops = 0

    for (const doc of snap.docs) {
      if (inspected >= LIMIT) break
      inspected += 1
      const data = doc.data()
      const plan = planDocument(collection, doc.id, data)
      problems.push(...plan.problems)
      if (!plan.patch) continue

      const backupRef = db.collection('backups')
        .doc('canonical_education')
        .collection('docs')
        .doc(`${collection}_${doc.id}`)
      batch.set(backupRef, {
        collection,
        docId: doc.id,
        original: data,
        at: admin.default.firestore.FieldValue.serverTimestamp(),
      })
      batch.set(doc.ref, plan.patch, { merge: true })
      ops += 2

      for (const r of plan.rewrites) {
        rewrites.push(r)
        console.log(`  rewrite ${r.collection}/${r.docId}.${r.field}: ` +
          `${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`)
      }

      if (ops >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()
  }

  const problemCount = printReport({ inspected, rewrites, problems })
  await writeReportFile({ mode: 'live', inspected, rewrites, problems })
  return problemCount
}

/**
 * Dry run. With no Firestore credentials there is no corpus to scan, so this
 * exercises the planner against fixtures covering every vocabulary the audit
 * found — including the two that must NOT be rewritten.
 */
async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──')
  console.log('   Run with --live to migrate. Fixtures below cover every')
  console.log('   vocabulary variant the audit found.\n')

  const fixtures = [
    ['classes', 'c1', { grade: '5', subject: 'science' }],
    ['classes', 'c2', { grade: 'Grade 7', subject: 'Integrated Science' }],
    ['classes', 'c3', { grade: 'Form 1', subject: 'Expressive Art' }],
    ['classes', 'c4', { grade: 'Nursery', subject: 'Cinyanja' }],
    ['classes', 'c5', { grade: 'G5', subject: 'integrated_science' }],   // already canonical
    ['classRegisters', 'r1', { grade: 'baby', subject: 'English Language' }],
    ['classRegisters', 'r2', { grade: 'Grade 12', subject: 'english' }],
    ['quizzes', 'q1', { subject: 'Science', grade: '5' }],
    ['quizzes', 'q2', { subject: 'Special Paper 1', grade: '7' }],       // not canonical, correct
    ['quizzes', 'q3', { subject: 'Biology', grade: '10' }],              // no learner label
    ['aiGenerations', 'g1', { subject: 'Science', grade: '4', curriculum: 'previous' }],
    ['aiGenerations', 'g2', { subject: 'english_language', grade: 'Form 3', curriculum: '2023' }],
    ['assessments', 'a1', { subject: 'Integrated Science', curriculum: 'New Curriculum (CBC)' }],
    ['assessments', 'a2', { subject: 'commerce_and_principles_of_accounts', framework: '2013' }],
    ['assessments', 'a3', { subject: 'Underwater Basket Weaving' }],
  ]

  const rewrites = []
  const problems = []
  for (const [collection, docId, data] of fixtures) {
    const plan = planDocument(collection, docId, data)
    rewrites.push(...plan.rewrites)
    problems.push(...plan.problems)
    for (const r of plan.rewrites) {
      console.log(`  rewrite ${r.collection}/${r.docId}.${r.field}: ` +
        `${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`)
    }
    if (!plan.patch && !plan.problems.length) {
      console.log(`  noop    ${collection}/${docId}`)
    }
  }

  const problemCount = printReport({ inspected: fixtures.length, rewrites, problems })
  await writeReportFile({ mode: 'dry-run', inspected: fixtures.length, rewrites, problems })
  return problemCount
}

const invokedAsScript =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`

if (invokedAsScript) {
  const problemCount = await (LIVE ? runLive() : runDryRun())
  if (problemCount > 0) {
    console.error(
      `\n✗ ${problemCount} value(s) could not be mapped. Nothing was guessed; ` +
      'resolve them and re-run (the migration is idempotent).',
    )
    process.exit(1)
  }
  console.log('\n✓ every stored value maps to a canonical record.')
}

// Re-exported so callers/tests can resolve without a second import.
export { getSubject, getGrade, SUBJECTS }
