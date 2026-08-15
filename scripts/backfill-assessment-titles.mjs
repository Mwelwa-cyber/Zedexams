#!/usr/bin/env node
/**
 * scripts/backfill-assessment-titles.mjs
 *
 * Retitle assessment papers saved under the old generated name.
 *
 * The old name was level + type + year — "GRADE 4 END OF TERM 1 TEST - 2026" —
 * with no subject, and with a term the studio defaulted rather than read from
 * the paper (a Term 2 paper was titled TERM 1). So a teacher's Integrated
 * Science, Technology Studies and Home Economics papers across two terms all
 * appeared in their library under one identical name. New papers are named
 * "GRADE 4 INTEGRATED SCIENCE - END OF TERM 2 TEST - 2026"
 * (src/features/assessmentStudio/lib/assessmentTitle.js); this brings the existing ones over.
 *
 * ── What it will and will not rewrite ─────────────────────────────────
 *
 * ONLY a title this codebase generated for that same paper is replaced —
 * recognised by isGeneratedAssessmentTitle, which knows the current shape, the
 * old subject-less shape, a termless shape, and (crucially) a title stamped with
 * the WRONG term, since that misreporting is the bug being repaired.
 *
 * A title a teacher typed is never touched. NOTE, and this is worth being
 * straight about: manual titles are not TRACKED historically. The studio has no
 * "paper title" field at all, so nothing in the collection was hand-typed
 * through it, and matching the generated shape is the strongest evidence
 * available for papers saved before now. Papers saved from now on record
 * `titleSource: 'auto' | 'manual'`, which this script honours, so a future
 * migration will not have to infer anything.
 *
 * The paper's own fields decide the new title. The year falls back to the
 * paper's CREATION year, never to today, so a 2025 paper is not retitled 2026.
 *
 * ── RUN ORDER: canonical-education migration FIRST ────────────────────
 *
 * If scripts/migrate-canonical-education.mjs has not been run against this
 * collection yet, run it before this script.
 *
 * The generated title interpolates the paper's `subject` verbatim
 * (buildAssessmentDocumentTitle → readPaperSubject), and that migration rewrites
 * assessments.subject onto its canonical name — "Integrated Science" becomes
 * "Science", which is what the Syllabus Studio calls it.
 *
 * Run in the wrong order and a paper ends up titled
 * "GRADE 4 INTEGRATED SCIENCE - …" while its subject reads "Science". It is then
 * STUCK: generatedAssessmentTitleVariants builds its variants from the paper's
 * CURRENT subject, so every variant says SCIENCE, the stored title matches none
 * of them, and a re-run skips it as "its title is not one we generated". A wrong
 * title this script then refuses to repair.
 *
 * Nothing here detects that, because a title generated from a since-changed
 * field is indistinguishable from one a teacher typed — which is the whole
 * reason the order matters rather than being a preference.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN (default)   No writes. Prints every old → new title.
 *   LIVE  (--live)      Prints the same list, then requires you to type RETITLE.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --teacher=<uid>   Limit to one teacher's papers (createdBy).
 *   --limit=N         Cap papers inspected.
 *   --show-skipped    Also print the papers left alone, and why.
 *   --yes             Skip the typed confirmation (non-interactive runs).
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/backfill-assessment-titles.mjs                 # dry run
 *   node scripts/backfill-assessment-titles.mjs --live          # asks first
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS. Without it the script explains itself
 * and runs the rules against a fixture — the seven reported papers.
 */

import {
  buildAssessmentDocumentTitle,
  isTeacherAuthoredTitle,
  normalizeTitleForCompare,
} from '../src/features/assessmentStudio/lib/assessmentTitle.js'
import { confirmByTyping } from './lib/confirmPrompt.mjs'

const LIVE = process.argv.includes('--live')
const ASSUME_YES = process.argv.includes('--yes')
const SHOW_SKIPPED = process.argv.includes('--show-skipped')
const arg = (name) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}
const TEACHER = arg('teacher')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const BATCH_SIZE = 400

/**
 * Decide what happens to one paper.
 *
 * @returns {{action:'retitle'|'skip', from:string, to:string, reason?:string}}
 */
export function planTitleBackfill({ assessment = {}, createdYear } = {}) {
  const from = String(assessment.title ?? '').trim()
  const to = buildAssessmentDocumentTitle(assessment, { fallbackYear: createdYear })
  // The two signals this used to check inline now live together as
  // isTeacherAuthoredTitle (assessmentTitle.js) — the same call the library card
  // and the builder's title bar make, so a name this script would refuse to
  // rewrite is a name neither of them rewrites on screen either. The reasons
  // stay separate because an operator reading the dry run needs to know WHICH
  // signal spared a paper.
  if (assessment.titleSource === 'manual') {
    return { action: 'skip', from, to, reason: 'the teacher named it' }
  }
  if (isTeacherAuthoredTitle(assessment, { fallbackYear: createdYear })) {
    return { action: 'skip', from, to, reason: 'its title is not one we generated' }
  }
  if (from === to) return { action: 'skip', from, to, reason: 'already up to date' }
  return { action: 'retitle', from, to }
}

export function planAll(entries = []) {
  const retitle = []
  const skip = []
  for (const entry of entries) {
    const plan = planTitleBackfill(entry)
    const row = { ...entry, ...plan }
    if (plan.action === 'retitle') retitle.push(row)
    else skip.push(row)
  }
  return { retitle, skip }
}

/**
 * Titles that would STILL be shared by more than one of this teacher's papers
 * after the run — the check that decides whether the backfill actually achieved
 * the distinct names it exists to produce.
 *
 * Compared through normalizeTitleForCompare, not as raw strings. Two titles
 * differing only by a hyphen flavour, a double space or capitalisation are the
 * same name to the teacher reading the library, and that function is the one
 * place this codebase decides what "the same title" means — this comparison is
 * exactly the question it was written for, and not calling it meant the warning
 * under-reported.
 *
 * It compares the name each paper ENDS UP with: the new title for a paper being
 * retitled, the existing one for a paper left alone. A collision between a
 * regenerated name and a legacy one is a real collision.
 *
 * KNOWN GAP, deliberately not closed here: the normaliser folds case, dashes and
 * whitespace, not number words. A legacy "GRADE FOUR END OF TERM 1 TEST - 2026"
 * still does not collide with a regenerated "GRADE 4 …", even though a teacher
 * reads them as one name. Spelled-out levels only survive on papers this script
 * SKIPS (an unrecognised title is left alone), regenerated titles always take
 * the "GRADE 4" form from paperGradeLabel, and this output is advisory — so
 * closing it would change no write. Worth doing when the library list is
 * actually confusing someone, not before.
 *
 * @param {Array<{action?:string, to?:string, from?:string, assessment?:object}>} rows
 * @returns {Map<string, string[]>} owner uid → the shared titles, as displayed
 */
export function findSharedTitles(rows = []) {
  const byOwner = new Map()
  for (const row of rows) {
    const owner = row?.assessment?.createdBy || 'unknown'
    const title = row?.action === 'retitle' ? row.to : row.from
    if (!byOwner.has(owner)) byOwner.set(owner, [])
    byOwner.get(owner).push(String(title ?? ''))
  }
  const shared = new Map()
  for (const [owner, titles] of byOwner) {
    // Group by the normalised key, but report the title as it will be DISPLAYED
    // — an operator has to find these in the library, and the normalised form
    // (upper-cased, dashes folded) is not what they will see there.
    const seen = new Map()
    for (const title of titles) {
      const key = normalizeTitleForCompare(title)
      if (!key) continue
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key).push(title)
    }
    const collisions = [...seen.values()].filter((group) => group.length > 1).map((g) => g[0])
    if (collisions.length) shared.set(owner, collisions)
  }
  return shared
}

function creationYear(assessment) {
  const createdAt = assessment?.createdAt
  // Firestore Timestamp | Date | ISO string | epoch ms — or nothing.
  const date = typeof createdAt?.toDate === 'function' ? createdAt.toDate()
    : createdAt ? new Date(createdAt.seconds ? createdAt.seconds * 1000 : createdAt)
      : null
  return date && !Number.isNaN(date.getTime()) ? date.getFullYear() : undefined
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

async function runAgainstFirestore(admin) {
  const db = admin.firestore()
  let query = db.collection('assessments')
  if (TEACHER) query = query.where('createdBy', '==', TEACHER)
  const snap = await query.get()
  const entries = []
  for (const doc of snap.docs) {
    if (entries.length >= LIMIT) break
    const assessment = doc.data()
    entries.push({
      id: doc.id, ref: doc.ref, assessment, createdYear: creationYear(assessment),
    })
  }

  const { retitle, skip } = planAll(entries)
  console.log(`Inspected ${entries.length} paper${entries.length === 1 ? '' : 's'}.`)
  console.log(`\n── ${retitle.length} paper${retitle.length === 1 ? '' : 's'} to retitle ──`)
  for (const row of retitle) {
    console.log(`  ${row.id}`)
    console.log(`      from: ${row.from || '(no title)'}`)
    console.log(`        to: ${row.to}`)
  }
  if (!retitle.length) console.log('  (none — nothing to do)')

  // The whole point is that the new names are DISTINCT. Say so out loud, per
  // teacher, so a run that leaves a collision in place is visible rather than
  // reported as a success.
  for (const [owner, titles] of findSharedTitles([...retitle, ...skip])) {
    console.log(`\n  ⚠ ${owner}: ${titles.length} title(s) still shared by more than one paper:`)
    for (const title of titles) console.log(`      ${title}`)
    console.log('      (same subject, term, level, type and year — a real duplicate, not a naming gap.)')
  }

  if (SHOW_SKIPPED) {
    console.log(`\n── ${skip.length} paper${skip.length === 1 ? '' : 's'} left alone ──`)
    for (const row of skip) console.log(`  ${row.id}  "${row.from}"  — ${row.reason}`)
  } else {
    console.log(`\n${skip.length} paper${skip.length === 1 ? '' : 's'} left alone (--show-skipped to list them).`)
  }

  if (!retitle.length) return
  if (!LIVE) {
    console.log('\n── DRY RUN — nothing was written. Re-run with --live to apply. ──')
    return
  }
  const ok = ASSUME_YES || await confirmByTyping(
    `About to rename ${retitle.length} paper${retitle.length === 1 ? '' : 's'} listed above. `
    + 'Only titles this codebase generated are replaced; question content is untouched.',
    'RETITLE',
  )
  if (!ok) {
    console.log('\nAborted — nothing was written.')
    process.exitCode = 1
    return
  }

  let batch = db.batch()
  let ops = 0
  for (const row of retitle) {
    batch.update(row.ref, {
      title: row.to,
      // Recorded so this never has to be inferred again.
      titleSource: 'auto',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    ops += 1
    if (ops >= BATCH_SIZE) { await batch.commit(); batch = db.batch(); ops = 0 }
  }
  if (ops > 0) await batch.commit()
  console.log(`\nRenamed ${retitle.length} paper${retitle.length === 1 ? '' : 's'}.`)
}

function runFixtureDemo() {
  console.log('No GOOGLE_APPLICATION_CREDENTIALS — running the rules against a fixture.')
  console.log('Set it to a service-account JSON path to scan the real collection.\n')
  // The reported collision: seven Grade 4 2026 end-of-term papers across three
  // subjects and two terms, every one of them titled "…END OF TERM 1 TEST…".
  const reported = [
    { subject: 'Integrated Science', term: '1' },
    { subject: 'Integrated Science', term: '2' },
    { subject: 'Technology Studies', term: '1' },
    { subject: 'Technology Studies', term: '2' },
    { subject: 'Home Economics', term: '1' },
    { subject: 'Home Economics', term: '2' },
    { subject: 'Home Economics', term: '3' },
  ]
  const entries = reported.map((paper, index) => ({
    id: `paper-${index + 1}`,
    createdYear: 2026,
    assessment: {
      title: 'GRADE 4 END OF TERM 1 TEST - 2026',
      grade: '4', year: 2026, assessmentType: 'end_of_term', createdBy: 'teacher-1', ...paper,
    },
  }))
  entries.push({
    id: 'paper-8',
    createdYear: 2026,
    assessment: {
      title: "Revision paper for Mrs Banda's class", grade: '4', subject: 'English',
      term: '1', year: 2026, assessmentType: 'topic_test', createdBy: 'teacher-1',
    },
  })
  const { retitle, skip } = planAll(entries)
  for (const row of retitle) console.log(`  RETITLE  ${row.id}\n      from: ${row.from}\n        to: ${row.to}`)
  for (const row of skip) console.log(`  SKIP     ${row.id}  "${row.from}"  — ${row.reason}`)
  const names = new Set(retitle.map(r => r.to))
  console.log(`\n  ${retitle.length} papers → ${names.size} distinct names.`)
}

// Only run the CLI when this file IS the entry point. Without this, importing it
// for its exported rules (test:assessment-title does) runs the whole script —
// and with GOOGLE_APPLICATION_CREDENTIALS set that means connecting to Firestore
// from a test. Matches the guard on the other migration scripts.
const invokedAsScript =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`

if (invokedAsScript) {
  const admin = await loadAdmin()
  if (admin) await runAgainstFirestore(admin)
  else runFixtureDemo()
}
