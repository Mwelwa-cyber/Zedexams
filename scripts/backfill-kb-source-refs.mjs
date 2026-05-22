#!/usr/bin/env node
/**
 * scripts/backfill-kb-source-refs.mjs
 *
 * For every doc in
 *   cbcKnowledgeBase/{KB_VERSION}/topics/{topicId}/lessons/{moduleId}
 * look up a matching `approvedSyllabi` entry (by grade+subject, with
 * term as a tiebreak when present) and write `sourceDocId` +
 * `sourceStoragePath` + `verifiedAt` + `verifiedBy:'system-backfill'`.
 *
 * Idempotent: skips modules that already have a sourceDocId. This MUST
 * run after seed-approved-syllabi.mjs; otherwise the strict curriculum
 * resolver will refuse every learner-AI generation request.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node scripts/backfill-kb-source-refs.mjs          # dry-run
 *   node scripts/backfill-kb-source-refs.mjs --live   # actually writes
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const argv = process.argv.slice(2)
const LIVE = argv.includes('--live')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const KB_VERSION = 'cbc-kb-2026-04-seed'

function normSubject(s) { return String(s || '').trim().toLowerCase() }

async function loadSyllabusIndex() {
  const snap = await db.collection('approvedSyllabi').get()
  // Keyed by `${grade}::${normSubject}` → array of {id, storagePath, term}
  const idx = new Map()
  snap.forEach(d => {
    const v = d.data()
    const key = `${v.grade}::${normSubject(v.subject)}`
    if (!idx.has(key)) idx.set(key, [])
    idx.get(key).push({ id: d.id, storagePath: v.storagePath, term: v.term ?? null })
  })
  return idx
}

function pickSyllabus(candidates, term) {
  if (!candidates || !candidates.length) return null
  if (term != null) {
    const exact = candidates.find(c => c.term === term)
    if (exact) return exact
  }
  // Fall back to a term-agnostic syllabus (term:null) if present.
  const all = candidates.find(c => c.term == null)
  return all || candidates[0]
}

async function main() {
  console.log(`backfill-kb-source-refs (${LIVE ? 'LIVE' : 'DRY-RUN'})`)
  const idx = await loadSyllabusIndex()
  console.log(`Loaded ${idx.size} (grade,subject) buckets from approvedSyllabi.`)

  const topicsSnap = await db.collection('cbcKnowledgeBase')
      .doc(KB_VERSION)
      .collection('topics')
      .get()
  console.log(`Scanning ${topicsSnap.size} topics under cbcKnowledgeBase/${KB_VERSION}/topics`)

  let updated = 0, alreadySet = 0, noMatch = 0
  for (const topicDoc of topicsSnap.docs) {
    const lessonsSnap = await topicDoc.ref.collection('lessons').get()
    for (const lessonDoc of lessonsSnap.docs) {
      const lesson = lessonDoc.data()
      if (lesson.sourceDocId) { alreadySet++; continue }
      const key = `${lesson.grade}::${normSubject(lesson.subject)}`
      const pick = pickSyllabus(idx.get(key), lesson.term)
      if (!pick) {
        noMatch++
        console.log(`  no syllabus for G${lesson.grade}/${lesson.subject} (${lessonDoc.ref.path})`)
        continue
      }
      console.log(`  ${LIVE ? 'WRITE' : 'DRY '} ${lessonDoc.ref.path}  ←  ${pick.id}`)
      if (LIVE) {
        await lessonDoc.ref.set({
          sourceDocId: pick.id,
          sourceStoragePath: pick.storagePath || null,
          verifiedAt: FieldValue.serverTimestamp(),
          verifiedBy: 'system-backfill',
        }, { merge: true })
      }
      updated++
    }
  }

  console.log(`\nDone. ${updated} updated, ${alreadySet} already set, ${noMatch} no-match.`)
  if (!LIVE) console.log('Re-run with --live to actually write.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
