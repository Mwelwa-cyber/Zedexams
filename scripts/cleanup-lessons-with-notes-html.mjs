#!/usr/bin/env node
/**
 * scripts/cleanup-lessons-with-notes-html.mjs
 *
 * Find lessons whose slide bodies or top-level content contain raw HTML —
 * the tell-tale sign of Notes Studio output that leaked into the `lessons`
 * collection (e.g. by being pasted into the Quick Notes textarea in
 * LessonEditor, which feeds quickLessonConverter.js → slide.body, then
 * gets rendered as plain text by SlideRenderer).
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN  (default)         Reads only. Lists candidates. No writes.
 *   LIVE     (--live --delete) Backs up each candidate to
 *                              backups/lessons_notes_leak/<id>, then deletes.
 *
 * Run --live alone (without --delete) to verify backups land cleanly
 * without actually removing anything.
 *
 * ── Heuristic ─────────────────────────────────────────────────────────
 *
 *   A lesson is flagged when ANY of these are true:
 *     • A slide.body contains an HTML tag (e.g. <p>, <strong>, <ul>, <img …>)
 *     • The top-level `content` field contains an HTML tag
 *     • Notes Studio's `note-inline-image` class appears anywhere
 *
 *   Native lessons store plain text in slide.body — they should never
 *   contain raw HTML markup. False positives are unlikely; if one slips
 *   through, the dry-run output makes it visible before --delete.
 *
 * ── Prerequisites for LIVE mode ───────────────────────────────────────
 *
 *   npm install --save-dev firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   # Dry run first (read-only):
 *   node scripts/cleanup-lessons-with-notes-html.mjs
 *
 *   # Backup-only (writes backups but doesn't delete):
 *   node scripts/cleanup-lessons-with-notes-html.mjs --live
 *
 *   # Backup + delete:
 *   node scripts/cleanup-lessons-with-notes-html.mjs --live --delete
 */

import { readFileSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const LIVE = args.has('--live')
const DELETE = args.has('--delete')

const HTML_TAG = /<\/?(p|strong|em|b|i|u|ul|ol|li|h[1-6]|img|br|table|tr|td|th|figure|figcaption|blockquote|code|pre|span|div|a)\b/i
const NOTES_MARKER = /note-inline-image|class=["']note-/i

function snippet(str, n = 160) {
  if (typeof str !== 'string') return ''
  const flat = str.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n) + '…' : flat
}

function findHtmlInLesson(data) {
  const reasons = []
  if (typeof data?.content === 'string' && (HTML_TAG.test(data.content) || NOTES_MARKER.test(data.content))) {
    reasons.push({ field: 'content', sample: snippet(data.content) })
  }
  const slides = Array.isArray(data?.slides) ? data.slides : []
  slides.forEach((slide, i) => {
    const body = typeof slide?.body === 'string' ? slide.body : ''
    if (HTML_TAG.test(body) || NOTES_MARKER.test(body)) {
      reasons.push({ field: `slides[${i}].body`, sample: snippet(body) })
    }
    const title = typeof slide?.title === 'string' ? slide.title : ''
    if (HTML_TAG.test(title)) {
      reasons.push({ field: `slides[${i}].title`, sample: snippet(title) })
    }
  })
  return reasons
}

async function main() {
  console.log('▶ cleanup-lessons-with-notes-html')
  console.log(`  mode: ${LIVE ? (DELETE ? 'LIVE + DELETE' : 'LIVE (backup only)') : 'DRY RUN (read-only)'}`)
  console.log('')

  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app')
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore')

  // Service account via GOOGLE_APPLICATION_CREDENTIALS, falling back to ADC.
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credsPath) {
    const serviceAccount = JSON.parse(readFileSync(credsPath, 'utf8'))
    initializeApp({ credential: cert(serviceAccount) })
  } else {
    initializeApp({ credential: applicationDefault() })
  }

  const db = getFirestore()
  const snap = await db.collection('lessons').get()
  console.log(`  scanned ${snap.size} lessons`)
  console.log('')

  const candidates = []
  snap.forEach(doc => {
    const data = doc.data()
    const reasons = findHtmlInLesson(data)
    if (reasons.length === 0) return
    candidates.push({ id: doc.id, data, reasons })
  })

  if (candidates.length === 0) {
    console.log('✓ No notes-leaked lessons found. Nothing to do.')
    return
  }

  console.log(`⚠ Found ${candidates.length} candidate lesson(s):`)
  console.log('')
  for (const c of candidates) {
    console.log(`  • ${c.id}`)
    console.log(`      title:     ${c.data?.title ?? '(no title)'}`)
    console.log(`      createdBy: ${c.data?.createdBy ?? '(unknown)'}`)
    console.log(`      published: ${c.data?.isPublished ? 'yes' : 'no'}`)
    console.log(`      reasons:`)
    for (const r of c.reasons) {
      console.log(`        - ${r.field}: ${r.sample}`)
    }
    console.log('')
  }

  if (!LIVE) {
    console.log('Dry run — no writes performed. Re-run with --live --delete to clean up.')
    return
  }

  console.log(`Backing up ${candidates.length} lesson(s) to backups/lessons_notes_leak/…`)
  for (const c of candidates) {
    await db.collection('backups').doc('lessons_notes_leak').collection('docs').doc(c.id).set({
      ...c.data,
      _backedUpAt: FieldValue.serverTimestamp(),
      _reasons: c.reasons,
    })
    console.log(`  ✓ backup written for ${c.id}`)
  }

  if (!DELETE) {
    console.log('')
    console.log('--live without --delete: backups written, originals untouched.')
    return
  }

  console.log('')
  console.log(`Deleting ${candidates.length} lesson(s)…`)
  for (const c of candidates) {
    await db.collection('lessons').doc(c.id).delete()
    console.log(`  ✓ deleted ${c.id}`)
  }
  console.log('')
  console.log('Done. Backups remain in backups/lessons_notes_leak/docs/<id> if you need to restore.')
}

main().catch(err => {
  console.error('✗ cleanup-lessons-with-notes-html failed:', err)
  process.exit(1)
})
