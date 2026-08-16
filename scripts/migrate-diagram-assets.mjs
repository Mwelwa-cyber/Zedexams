#!/usr/bin/env node
/**
 * scripts/migrate-diagram-assets.mjs
 *
 * Visual Studio v2 (spec 1A): migrate the two legacy stores into the
 * curriculum Diagram Library (`diagramAssets`):
 *
 *   • pictureBank/{id}   → art + empty labels + inferred metadata (provenance
 *                          'bank'; active pictures stay publicly readable)
 *   • visualAssets/{id}  → art + upgraded labels (v1 { letter, text, x, y } →
 *                          v2 { word, anchor, box }; letters are DROPPED — a
 *                          render-time projection is never stored)
 *
 * Nothing visible breaks: the legacy collections are READ ONLY here — the
 * Picture Bank browse/search and My Visuals keep working untouched, and the
 * Library builds alongside them.
 *
 * ── Modes ─────────────────────────────────────────────────────────────
 *
 *   DRY RUN (default)   No writes. Prints every doc it would create and every
 *                       source it would skip (with the reason).
 *   LIVE  (--live)      Prints the same plan, then requires typing MIGRATE.
 *
 * ── Idempotency ───────────────────────────────────────────────────────
 *
 *   The target doc id is a pure function of the source
 *   (`migrationDocId`: mig-pb-<id> / mig-va-<id>), so a re-run finds its own
 *   previous output and skips it (`exists`). --overwrite re-writes them (for
 *   a mapping fix), still onto the SAME ids — never siblings.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --limit=N       Cap source docs read per collection.
 *   --only=<name>   'pictureBank' or 'visualAssets' (default: both).
 *   --overwrite     Re-write targets that already exist.
 *   --yes           Skip the typed confirmation (non-interactive runs).
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to touch Firestore. Without it the
 * script exercises the mapping against a fixture so the logic can be reviewed
 * with no project access (same convention as cleanup-phantom-assessments).
 */

import {
  planDiagramAssetMigration, migrationDocId,
} from '../src/features/visualStudio/lib/diagramAssetMigration.js'
import { diagramAssetWriteSchema } from '../src/shared/schemas/diagramAsset.js'
import { confirmByTyping } from './lib/confirmPrompt.mjs'

const LIVE = process.argv.includes('--live')
const ASSUME_YES = process.argv.includes('--yes')
const OVERWRITE = process.argv.includes('--overwrite')
const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const ONLY = arg('only')
const BATCH_SIZE = 400

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

async function readCollection(db, name) {
  if (ONLY && ONLY !== name) return []
  const snap = await db.collection(name).get()
  const rows = []
  for (const doc of snap.docs) {
    if (rows.length >= LIMIT) break
    rows.push({ id: doc.id, ...doc.data() })
  }
  return rows
}

function validatePlan(plan) {
  // Every planned write must pass the SAME write schema the app enforces —
  // a migration that files invalid docs just moves the mess.
  const invalid = []
  for (const w of plan.writes) {
    const parsed = diagramAssetWriteSchema.safeParse(w.data)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      invalid.push(`${w.source}: ${first ? `${first.path.join('.')} ${first.message}` : 'invalid'}`)
    }
  }
  return invalid
}

function printPlan(plan) {
  for (const w of plan.writes) {
    console.log(`  WRITE ${w.docId}  ← ${w.source}  "${w.data.title}"  (${w.data.provenance}, ${w.data.scope}, ${w.data.labels.length} labels)`)
  }
  for (const s of plan.skipped) {
    console.log(`  skip  ${s.source}  (${s.reason})`)
  }
  console.log(`\n  ${plan.writes.length} to write, ${plan.skipped.length} skipped.`)
}

async function main() {
  const admin = await loadAdmin()
  if (!admin) {
    console.log('No GOOGLE_APPLICATION_CREDENTIALS — running the mapping against a fixture instead.\n')
    const plan = planDiagramAssetMigration({
      pictureBank: [
        { id: 'p1', name: 'Maize plant', url: 'https://x/p1.png', storagePath: 'picture-bank/p1.png', subject: 'science', gradeBand: 'G4', status: 'active', createdBy: 'admin' },
        { id: 'p2', name: 'No art here', status: 'staged', createdBy: 'admin' },
      ],
      visualAssets: [
        { id: 'v1', createdBy: 'uid-1', title: 'Respiratory system', imageUrl: 'https://x/v1.png', storagePath: 'visual-studio/uid-1/v1.png', sourceType: 'ai', labels: [{ id: 'l1', letter: 'P', text: 'Trachea', x: 0.4, y: 0.3 }] },
      ],
    })
    printPlan(plan)
    const invalid = validatePlan(plan)
    if (invalid.length) {
      console.error('\nFixture plan produced invalid docs:\n  ' + invalid.join('\n  '))
      process.exit(1)
    }
    console.log('\nFixture plan validates. Set GOOGLE_APPLICATION_CREDENTIALS for a real run.')
    return
  }

  const db = admin.firestore()
  const [pictureBank, visualAssets] = await Promise.all([
    readCollection(db, 'pictureBank'),
    readCollection(db, 'visualAssets'),
  ])
  console.log(`Read ${pictureBank.length} pictureBank + ${visualAssets.length} visualAssets docs.`)

  // Existing targets (idempotency): only migrated ids can collide, so one
  // query over migratedFrom-stamped docs is enough.
  const existingIds = new Set()
  const existingSnap = await db.collection('diagramAssets')
    .where('migratedFrom', '>', '').get()
  for (const doc of existingSnap.docs) existingIds.add(doc.id)

  const plan = planDiagramAssetMigration({ pictureBank, visualAssets }, { existingIds, overwrite: OVERWRITE })
  printPlan(plan)
  const invalid = validatePlan(plan)
  if (invalid.length) {
    console.error('\nABORTING — plan contains docs the write schema refuses:\n  ' + invalid.join('\n  '))
    process.exit(1)
  }

  if (!LIVE) {
    console.log('\nDry run — nothing written. Re-run with --live to migrate.')
    return
  }
  if (!ASSUME_YES) {
    const confirmed = await confirmByTyping(
      `About to write ${plan.writes.length} docs into diagramAssets.`, 'MIGRATE')
    if (!confirmed) { console.log('Not confirmed — nothing written.'); return }
  }

  let batch = db.batch()
  let ops = 0
  const flush = async () => {
    if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0 }
  }
  for (const w of plan.writes) {
    const ref = db.collection('diagramAssets').doc(w.docId)
    batch.set(ref, {
      ...w.data,
      id: w.docId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    ops += 1
    if (ops >= BATCH_SIZE) await flush()
  }
  await flush()
  console.log(`\nMigrated ${plan.writes.length} docs into diagramAssets.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
