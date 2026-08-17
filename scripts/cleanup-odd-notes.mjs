#!/usr/bin/env node
/**
 * scripts/cleanup-odd-notes.mjs
 *
 * Learner redesign step 8: the Notes tab lists ONLY reader-format notes
 * (noteFormat 'study' whose blocks carry an interactive reader block).
 * Every other published learner note — legacy study, rich_text, visual,
 * file — is an "odd note": already hidden from the hub and shown a
 * retirement card if reached by link. This script retires them at the
 * data level too, so admin lists and counts agree with the learner
 * surface.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN  (default)            Reads only. Lists candidates. No writes.
 *   LIVE     (--live --unpublish) Backs up each candidate's {published,
 *                                 noteFormat, title} to
 *                                 backups/odd_notes/<id>, then sets
 *                                 published: false. Nothing is deleted —
 *                                 the docs stay for the regeneration
 *                                 pipeline to rebuild subject by subject.
 *
 *   Run --live alone (without --unpublish) to verify backups land
 *   cleanly without changing anything.
 *
 * ── Prerequisites for LIVE mode ───────────────────────────────────────
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   node scripts/cleanup-odd-notes.mjs                       # dry run
 *   node scripts/cleanup-odd-notes.mjs --live                # backups only
 *   node scripts/cleanup-odd-notes.mjs --live --unpublish    # retire
 */

import { readFileSync } from 'node:fs'
import { isReaderNote } from '../src/features/notes/reader/readerCore.js'
import { coerceStudyBlocks } from '../src/features/notes/lib/studySchema.js'

const args = new Set(process.argv.slice(2))
const LIVE = args.has('--live')
const UNPUBLISH = args.has('--unpublish')

/** Same verdict the learner hub uses: is this a reader-format note? */
function isReaderFormatNote(data) {
  if (data?.noteFormat !== 'study') return false
  try {
    return isReaderNote(coerceStudyBlocks(data.blocks))
  } catch {
    return false
  }
}

async function main() {
  console.log('▶ cleanup-odd-notes')
  console.log(`  mode: ${LIVE ? (UNPUBLISH ? 'LIVE + UNPUBLISH' : 'LIVE (backup only)') : 'DRY RUN (read-only)'}`)
  console.log('')

  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')

  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credsPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(credsPath, 'utf8'))) })
  } else {
    initializeApp({ credential: applicationDefault() })
  }

  const db = getFirestore()
  const snap = await db.collection('lessons').where('published', '==', true).get()
  console.log(`  scanned ${snap.size} published docs in lessons/`)
  console.log('')

  const candidates = []
  snap.forEach((doc) => {
    const data = doc.data()
    // Slide-based lessons are the /lessons surface, not notes — skip.
    if (!data?.noteFormat && Array.isArray(data?.slides) && data.slides.length > 0) return
    if (isReaderFormatNote(data)) return
    candidates.push({
      id: doc.id,
      title: data.title || '(untitled)',
      subject: data.subject || '—',
      grade: data.grade ?? '—',
      noteFormat: data.noteFormat || '(none)',
    })
  })

  if (candidates.length === 0) {
    console.log('✓ No odd notes — every published note is reader-format.')
    return
  }

  console.log(`  ${candidates.length} odd note(s):`)
  for (const c of candidates) {
    console.log(`   · ${c.id}  [${c.noteFormat}]  G${c.grade} ${c.subject} — ${c.title}`)
  }
  console.log('')

  if (!LIVE) {
    console.log('Dry run only. Re-run with --live to back up, --live --unpublish to retire.')
    return
  }

  for (const c of candidates) {
    await db.collection('backups').doc('odd_notes').collection('notes').doc(c.id).set({
      ...c,
      retiredAt: new Date().toISOString(),
      restoredBy: 'set published: true on lessons/' + c.id,
    })
    if (UNPUBLISH) {
      await db.collection('lessons').doc(c.id).update({ published: false })
      console.log(`  retired ${c.id}`)
    } else {
      console.log(`  backed up ${c.id} (not unpublished — pass --unpublish)`)
    }
  }
  console.log('')
  console.log(`✓ ${UNPUBLISH ? 'Retired' : 'Backed up'} ${candidates.length} note(s).`)
}

main().catch((err) => {
  console.error('✗ cleanup-odd-notes failed:', err)
  process.exitCode = 1
})
