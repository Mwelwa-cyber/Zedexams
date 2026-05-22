// One-time uploader for the CDC syllabi library.
//
// Reads `public/syllabi/manifest.json`, uploads every referenced PDF from
// `public/syllabi/` to Cloud Storage at `syllabi/<file>`, and marks each
// object publicly readable to match storage.rules's `match /syllabi/`.
//
// Run once locally (outside CI). After it succeeds the PDFs can be removed
// from `public/syllabi/` — the SyllabiLibrary component already fetches
// them via the public Cloud Storage URL.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
//   FIREBASE_STORAGE_BUCKET=examsprepzambia.appspot.com \
//     node scripts/upload-syllabi-to-storage.mjs
//
// Re-runs are safe: existing objects are overwritten with matching metadata.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import admin from 'firebase-admin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const bucketName = process.env.FIREBASE_STORAGE_BUCKET
if (!bucketName) {
  console.error('FIREBASE_STORAGE_BUCKET env var is required.')
  process.exit(1)
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS env var is required.')
  console.error('Download a service-account key from the Firebase console and point this at the JSON file.')
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: bucketName,
})

const bucket = admin.storage().bucket()
const manifestPath = resolve(root, 'public/syllabi/manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

let uploaded = 0
let skipped = 0
let failed = 0

for (const entry of manifest) {
  if (!entry?.file) {
    console.warn(`- ${entry?.id || '(no id)'}: manifest entry has no .file, skipping`)
    skipped += 1
    continue
  }

  const localPath = resolve(root, 'public/syllabi', entry.file)
  if (!existsSync(localPath)) {
    console.warn(`- ${entry.id}: ${entry.file} not found on disk, skipping`)
    skipped += 1
    continue
  }

  const destination = `syllabi/${entry.file}`
  try {
    await bucket.upload(localPath, {
      destination,
      resumable: false,
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'public, max-age=86400',
        contentDisposition: 'inline',
      },
    })
    uploaded += 1
    console.log(`  uploaded  ${destination}`)
  } catch (err) {
    failed += 1
    console.error(`  FAILED    ${destination}: ${err?.message || err}`)
  }
}

console.log(`\nDone. uploaded=${uploaded} skipped=${skipped} failed=${failed}`)
if (failed > 0) process.exit(1)
