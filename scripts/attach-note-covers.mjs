#!/usr/bin/env node
/**
 * attach-note-covers — backfill cover illustrations onto Grade-7 Social
 * Studies study-notes (the `lessons` collection, noteFormat 'study').
 *
 * Each note title starts with a unit code ("1.1 What is Democracy?"). We
 * match it to a cover file in --dir whose name starts with that code
 * ("1.1-what-is-democracy.jpg"), upload the image to Storage, and write the
 * download URL onto the note's `coverImage` field (rendered by
 * LearnerNoteCard).
 *
 * SAFETY: dry-run by default. Nothing is written or uploaded unless --live.
 * Idempotent: notes that already have a coverImage are skipped (use --force
 * to overwrite). Uses firebase-admin, which bypasses Firestore rules, so the
 * service account must have Firestore + Storage write access.
 *
 * Usage:
 *   # Offline preview of the match plan — no credentials needed:
 *   node scripts/attach-note-covers.mjs --source seed
 *
 *   # Dry-run against live Firestore (reads only):
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   node scripts/attach-note-covers.mjs
 *
 *   # Actually upload + write:
 *   node scripts/attach-note-covers.mjs --live
 *
 * Flags:
 *   --live              perform uploads + Firestore writes (default: dry-run)
 *   --force             overwrite notes that already have a coverImage
 *   --source <s>        'firestore' (default) or 'seed' (offline preview only)
 *   --dir <path>        cover image folder (default: generated/covers)
 *   --grade <g>         grade to target (default: 7)
 *   --subject <s>       subject to target (default: "Social Studies")
 *   --bucket <name>     Storage bucket (default: STORAGE_BUCKET env or
 *                       examsprepzambia.appspot.com)
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const IMAGE_RE = /\.(jpe?g|png|webp)$/i
const CODE_RE = /^\s*(\d+\.\d+)/

function parseArgs(argv) {
  const out = { _: [] }
  const flags = new Set(['source', 'dir', 'grade', 'subject', 'bucket'])
  const bools = new Set(['live', 'force'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (bools.has(key)) out[key] = true
      else if (flags.has(key)) out[key] = argv[++i]
      else { console.error(`Unknown flag: --${key}`); process.exit(2) }
    } else out._.push(a)
  }
  return out
}

const unitCode = (title) => {
  const m = String(title || '').match(CODE_RE)
  return m ? m[1] : null
}

// Build a code -> filename map from the cover folder. A file matches a code
// when its basename starts with "<code>-" or "<code>." (so "1.1" matches
// "1.1-what-is-democracy.jpg" but not "1.10-...").
async function indexCovers(dir) {
  let files
  try {
    files = await readdir(dir)
  } catch (err) {
    throw new Error(`Cannot read cover dir "${dir}": ${err.message}`)
  }
  const byCode = {}
  for (const f of files) {
    if (!IMAGE_RE.test(f)) continue
    const code = unitCode(f)
    if (code && (f.startsWith(`${code}-`) || f.startsWith(`${code}.j`) || f.startsWith(`${code}.p`) || f.startsWith(`${code}.w`))) {
      byCode[code] = f
    }
  }
  return byCode
}

async function loadSeedNotes(grade, subject) {
  const seedPath = path.join(REPO_ROOT, 'src/features/notes/seed/grade7Seed.json')
  const j = JSON.parse(await readFile(seedPath, 'utf8'))
  const notes = Array.isArray(j) ? j : (j.notes || Object.values(j))
  return notes
    .filter(n => n && String(n.grade) === String(grade) && n.subject === subject)
    .map(n => ({ id: n.seedKey || n.title, title: n.title, coverImage: null, _seed: true }))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const source = args.source || 'firestore'
  const grade = String(args.grade || '7')
  const subject = args.subject || 'Social Studies'
  const dir = path.resolve(REPO_ROOT, args.dir || 'generated/covers')
  const live = Boolean(args.live)
  const force = Boolean(args.force)

  const covers = await indexCovers(dir)
  console.log(`Covers in ${path.relative(REPO_ROOT, dir)}: ${Object.keys(covers).length} unit-coded`)
  console.log(`Target: grade ${grade}, subject "${subject}", source ${source}, mode ${live ? 'LIVE' : 'dry-run'}\n`)

  // ─── load notes ──────────────────────────────────────────────────────
  let notes
  let admin = null
  let bucket = null
  if (source === 'seed') {
    if (live) { console.error('--source seed cannot write (--live). Drop --live to preview, or use --source firestore.'); process.exit(2) }
    notes = await loadSeedNotes(grade, subject)
  } else {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error('GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at a Firebase service-account JSON key,')
      console.error('or run an offline preview with: --source seed')
      process.exit(1)
    }
    try {
      admin = (await import('firebase-admin')).default
    } catch {
      console.error('firebase-admin not installed. Run: npm install --save-dev firebase-admin')
      process.exit(1)
    }
    const bucketName = args.bucket || process.env.STORAGE_BUCKET || 'examsprepzambia.appspot.com'
    admin.initializeApp({ storageBucket: bucketName })
    const db = admin.firestore()
    bucket = admin.storage().bucket()
    const snap = await db.collection('lessons')
      .where('grade', '==', grade)
      .where('subject', '==', subject)
      .get()
    notes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  // ─── build plan ──────────────────────────────────────────────────────
  const matched = []
  const notesNoCover = []
  const usedCodes = new Set()
  for (const note of notes) {
    const code = unitCode(note.title)
    const file = code ? covers[code] : null
    if (file) { matched.push({ note, code, file }); usedCodes.add(code) }
    else notesNoCover.push({ note, code })
  }
  const orphanFiles = Object.entries(covers).filter(([code]) => !usedCodes.has(code))

  console.log(`Notes found: ${notes.length}  |  matched to a cover: ${matched.length}\n`)
  console.log('MATCHES:')
  for (const m of matched) {
    const has = m.note.coverImage ? ' [already has cover]' : ''
    console.log(`  ${m.code}  ${truncate(m.note.title, 42)} -> ${m.file}${has}`)
  }
  if (notesNoCover.length) {
    console.log('\nNOTES WITHOUT A MATCHING COVER FILE:')
    for (const n of notesNoCover) console.log(`  ${n.code || '(no code)'}  ${truncate(n.note.title, 50)}`)
  }
  if (orphanFiles.length) {
    console.log('\nCOVER FILES WITH NO MATCHING NOTE (skipped):')
    for (const [code, file] of orphanFiles) console.log(`  ${code}  ${file}`)
  }

  if (!live) {
    console.log(`\nDry-run complete. ${source === 'seed' ? 'Offline preview only. ' : ''}Re-run with --live to upload + write.`)
    return
  }

  // ─── live writes ─────────────────────────────────────────────────────
  console.log('\n── LIVE: uploading covers + writing coverImage ──')
  let wrote = 0, skipped = 0, failed = 0
  for (const { note, file } of matched) {
    if (note.coverImage && !force) { skipped++; console.log(`  skip   ${note.title} (already has cover)`); continue }
    try {
      const buffer = await readFile(path.join(dir, file))
      const token = randomUUID()
      const ext = path.extname(file).toLowerCase()
      const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const objectPath = `note-covers/${note.id}/cover-${token}${ext}`
      await bucket.file(objectPath).save(buffer, {
        resumable: false,
        contentType,
        metadata: {
          contentType,
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: { firebaseStorageDownloadTokens: token, generator: 'kie', attachedBy: 'attach-note-covers' },
        },
      })
      const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
        `/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`
      await admin.firestore().collection('lessons').doc(note.id).update({
        coverImage: url,
        coverImageStoragePath: objectPath,
        coverImageUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      wrote++
      console.log(`  wrote  ${note.title}`)
    } catch (err) {
      failed++
      console.log(`  FAIL   ${note.title} — ${err.message}`)
    }
  }
  console.log(`\nDone: ${wrote} written, ${skipped} skipped, ${failed} failed.`)
}

function truncate(s, n) {
  s = String(s || '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

main().catch((err) => {
  console.error(`\nattach-note-covers failed: ${err.message}`)
  process.exit(1)
})
