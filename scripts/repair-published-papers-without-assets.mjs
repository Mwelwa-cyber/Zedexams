#!/usr/bin/env node
/**
 * scripts/repair-published-papers-without-assets.mjs
 *
 * One-off repair for the bug fixed alongside it: `handleRemoveAsset()` in the
 * Past Paper Studio had no equivalent of `publish()`'s "at least one file"
 * check, so removing the last file from a LIVE paper left it listed in the
 * archive and blank when a learner opened it.
 *
 * This finds the papers already in that state and takes them back to `draft`.
 *
 * WHAT COUNTS AS BROKEN is decided by `isPublishedWithoutReadableSource` in
 * src/features/adminPastPapers/lib/publishedPaperAssets.js — the SAME module
 * the Studio guard uses, imported rather than restated, so the repair and the
 * guard cannot drift into disagreeing about what a broken paper is.
 *
 * It is narrower than "assets is empty", and both halves matter:
 *   - a paper whose source is the legacy `pdfPath` renders fine with `assets`
 *     empty (both readers PREFER pdfPath), so it is NOT broken and is left
 *     alone. Unpublishing those would take working papers off the shelf.
 *   - a paper whose only asset is the mark scheme IS broken: the readers build
 *     the paper preview from assets with role != 'mark-scheme', so the learner
 *     gets the same blank screen.
 *
 * Reversible by construction: the only field written is `status`, and every
 * affected paper was 'published' before. The script prints the exact revert
 * command. Nothing is deleted, so there is no backup file to leak (#2243).
 *
 * Linked quizzes are deliberately NOT touched. The Studio's own unpublish()
 * makes a linked quiz private too, but a paper being blank says nothing about
 * whether its quiz is good, and silently hiding learner content this script
 * was not asked to judge is the wrong default. Any affected paper with a live
 * quiz is REPORTED so the decision stays with an admin.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node scripts/repair-published-papers-without-assets.mjs          # dry run
 *   node scripts/repair-published-papers-without-assets.mjs --live   # write
 *   node scripts/repair-published-papers-without-assets.mjs --json   # machine-readable
 */
import {
  hasReadablePaperSource,
  isPublishedWithoutReadableSource,
  paperRoleAssets,
} from '../src/features/adminPastPapers/lib/publishedPaperAssets.js'

const COLLECTION = 'pastPapers'

function parseArgs(argv) {
  const args = { live: false, json: false }
  for (const a of argv) {
    if (a === '--live') args.live = true
    else if (a === '--json') args.json = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

/** Why this paper is broken, in words an admin can act on. */
function describeBreakage(paper) {
  const assets = Array.isArray(paper.assets) ? paper.assets : []
  if (assets.length === 0) return 'no files at all'
  if (paperRoleAssets(assets).length === 0) {
    return `only a mark scheme (${assets.length} file${assets.length === 1 ? '' : 's'}, all mark-scheme)`
  }
  return 'no readable source'
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/repair-published-papers-without-assets.mjs [--live] [--json]')
    process.exit(0)
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.')
    console.error('       This script reads and (with --live) writes production Firestore.')
    process.exit(1)
  }

  let admin
  try {
    admin = (await import('firebase-admin')).default
  } catch {
    console.error('ERROR: install firebase-admin first: `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  admin.initializeApp()
  const db = admin.firestore()

  // Read every published paper and classify in memory. The archive is a few
  // hundred documents, and "published with no assets" is not a query Firestore
  // can serve (there is no is-empty operator on an array field), so filtering
  // here is the honest way rather than an index that cannot exist.
  const snap = await db.collection(COLLECTION).where('status', '==', 'published').get()

  const broken = []
  for (const docSnap of snap.docs) {
    const paper = { id: docSnap.id, ...docSnap.data() }
    if (!isPublishedWithoutReadableSource(paper)) continue
    broken.push({
      id: docSnap.id,
      title: paper.title || '(untitled)',
      grade: paper.grade ?? '?',
      subject: paper.subject || '?',
      year: paper.year ?? '?',
      reason: describeBreakage(paper),
      quizId: paper.quizId || null,
      quizStatus: paper.quizStatus || null,
    })
  }

  if (args.json) {
    console.log(JSON.stringify({ scanned: snap.size, broken }, null, 2))
  } else {
    // ── The report comes FIRST, in every mode. Even --live prints the full
    //    list before it writes, so the run is auditable from its own output.
    console.log(`# scanned ${snap.size} published paper${snap.size === 1 ? '' : 's'} in ${COLLECTION}`)
    console.log(`# BROKEN (published, nothing a learner can open): ${broken.length}`)
    console.log('')
    if (broken.length === 0) {
      console.log('Nothing to repair.')
    } else {
      for (const p of broken) {
        console.log(`  ${p.id}`)
        console.log(`      ${p.title}  [grade ${p.grade} · ${p.subject} · ${p.year}]`)
        console.log(`      reason: ${p.reason}`)
        if (p.quizId) {
          console.log(`      NOTE: has a linked quiz (${p.quizId}, ${p.quizStatus || 'status unknown'}).`)
          console.log('            This script does NOT change quizzes — review it separately.')
        }
      }
    }
    console.log('')
  }

  if (broken.length === 0) process.exit(0)

  if (!args.live) {
    console.log(`DRY RUN — nothing was written. Re-run with --live to unpublish these ${broken.length}.`)
    process.exit(0)
  }

  // ── write ──────────────────────────────────────────────────────────
  let updated = 0
  for (const p of broken) {
    try {
      await db.collection(COLLECTION).doc(p.id).update({
        status: 'draft',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      updated += 1
      console.log(`  unpublished ${p.id}`)
    } catch (err) {
      console.error(`  FAILED ${p.id}: ${err.message}`)
    }
  }

  console.log('')
  console.log(`# unpublished ${updated}/${broken.length}`)
  console.log('# these papers are now admin-only; their files, quizzes and stats are untouched.')
  console.log('# to revert, set status back to "published" on exactly these ids:')
  console.log(`#   ${broken.map((p) => p.id).join(' ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
