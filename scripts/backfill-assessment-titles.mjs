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
 * (src/components/teacher/assessmentTitle.js); this brings the existing ones over.
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
  isGeneratedAssessmentTitle,
} from '../src/components/teacher/assessmentTitle.js'
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
  if (assessment.titleSource === 'manual') {
    return { action: 'skip', from, to, reason: 'the teacher named it' }
  }
  if (!isGeneratedAssessmentTitle(from, assessment, { fallbackYear: createdYear })) {
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
  const byOwner = new Map()
  for (const row of [...retitle, ...skip]) {
    const owner = row.assessment?.createdBy || 'unknown'
    if (!byOwner.has(owner)) byOwner.set(owner, [])
    byOwner.get(owner).push(row.action === 'retitle' ? row.to : row.from)
  }
  for (const [owner, titles] of byOwner) {
    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i)
    if (dupes.length) {
      console.log(`\n  ⚠ ${owner}: ${new Set(dupes).size} title(s) still shared by more than one paper:`)
      for (const dupe of new Set(dupes)) console.log(`      ${dupe}`)
      console.log('      (same subject, term, level, type and year — a real duplicate, not a naming gap.)')
    }
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

const admin = await loadAdmin()
if (admin) await runAgainstFirestore(admin)
else runFixtureDemo()
