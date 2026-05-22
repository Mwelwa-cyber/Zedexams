#!/usr/bin/env node
/**
 * scripts/seed-approved-syllabi.mjs
 *
 * Seeds the `approvedSyllabi` Firestore index from the existing
 * Storage paths `syllabi/` (public PDFs) and `syllabus-uploads/`
 * (admin-only xlsx). One Firestore doc per Storage object, keyed by a
 * deterministic slug so the script is idempotent.
 *
 * Each approvedSyllabi doc carries:
 *   - title, grade, subject, term (parsed from the filename heuristically)
 *   - storagePath (gs://bucket/path)
 *   - sha256 (so the Curriculum Update Checker can flag drift)
 *   - kbVersion, uploadedAt, approvedAt
 *
 * Until this runs (and the matching `scripts/backfill-kb-source-refs.mjs`
 * has tagged each KB module with sourceDocId), the strict resolver in
 * functions/agents/learnerAi/curriculumResolver.js will refuse every
 * lookup — by design. See the foundation plan, Top 3 risks #1.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node scripts/seed-approved-syllabi.mjs          # dry-run
 *   node scripts/seed-approved-syllabi.mjs --live   # actually writes
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import crypto from 'node:crypto'

const argv = process.argv.slice(2)
const LIVE = argv.includes('--live')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const bucket = getStorage().bucket()

const KB_VERSION = 'cbc-kb-2026-04-seed'

const GRADE_RE = /\b(?:g|grade[ _-]?)([1-9]|1[0-2])\b/i
const SUBJECT_HINTS = {
  mathematics: 'Mathematics',
  maths: 'Mathematics',
  math: 'Mathematics',
  english: 'English',
  literacy: 'Literacy',
  science: 'Integrated Science',
  'social-studies': 'Social Studies',
  social_studies: 'Social Studies',
  re: 'Religious Education',
  civic: 'Civic Education',
  cts: 'Creative & Technology Studies',
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function parseMeta(name) {
  const lower = name.toLowerCase()
  const grade = (lower.match(GRADE_RE) || [])[1] || null
  let subject = null
  for (const [hint, canonical] of Object.entries(SUBJECT_HINTS)) {
    if (lower.includes(hint)) { subject = canonical; break }
  }
  const termMatch = lower.match(/term[ _-]?([123])/)
  const term = termMatch ? Number(termMatch[1]) : null
  return { grade, subject, term, title: name.replace(/\.[^.]+$/, '') }
}

async function sha256OfObject(file) {
  const [buf] = await file.download()
  return crypto.createHash('sha256').update(buf).digest('hex')
}

async function listPrefix(prefix) {
  const [files] = await bucket.getFiles({ prefix })
  return files
}

async function main() {
  console.log(`seed-approved-syllabi (${LIVE ? 'LIVE' : 'DRY-RUN'})`)
  const files = [
    ...await listPrefix('syllabi/'),
    ...await listPrefix('syllabus-uploads/'),
  ].filter(f => !f.name.endsWith('/'))

  console.log(`Found ${files.length} candidate Storage objects.`)

  let written = 0, skipped = 0
  for (const file of files) {
    const base = file.name.split('/').pop()
    if (!base) continue
    const meta = parseMeta(base)
    if (!meta.grade || !meta.subject) {
      console.log(`  SKIP (unparseable): ${file.name}`)
      skipped++
      continue
    }
    const id = slugify(`g${meta.grade}-${meta.subject}-${meta.term ?? 'all'}-${meta.title}`)
    const ref = db.collection('approvedSyllabi').doc(id)
    const existing = await ref.get()
    if (existing.exists) {
      console.log(`  KEEP: ${id} (already in approvedSyllabi)`)
      skipped++
      continue
    }
    const sha256 = LIVE ? await sha256OfObject(file) : '(dry-run-no-sha)'
    const payload = {
      schemaVersion: 1,
      title: meta.title,
      grade: meta.grade,
      subject: meta.subject,
      term: meta.term,
      storagePath: file.name,
      sha256,
      uploadedAt: FieldValue.serverTimestamp(),
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: 'system-seed',
      kbVersion: KB_VERSION,
      coverage: { topics: [], subtopics: [] },
    }
    console.log(`  ${LIVE ? 'WRITE' : 'DRY '} ${id}  ←  ${file.name}`)
    if (LIVE) await ref.set(payload, { merge: true })
    written++
  }

  console.log(`\nDone. ${written} written, ${skipped} skipped.`)
  if (!LIVE) console.log('Re-run with --live to actually write.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
