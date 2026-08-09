#!/usr/bin/env node
/**
 * scripts/cleanup-classes.mjs
 *
 * One-off cleanup for the LEARNER↔TEACHER CLASS BRIDGE — the feature where a
 * teacher minted an 8-character invite code, learners joined by it and waited
 * for approval, and the teacher then assigned quizzes to the resulting roster
 * and watched per-learner completion.
 *
 * The feature was removed in full: both UIs, the eleven callables, the routes,
 * the nav, and the Firestore rules. This deletes the data it left behind.
 *
 * ── What it deletes ───────────────────────────────────────────────────
 *
 *   classes/{classId}          the roster itself — teacherUid, the live invite
 *                              code, learners[] and pendingLearners[] (arrays
 *                              of learner uids)
 *   classInvites/{code}        code → classId lookup docs
 *   assignments/{id}           one doc per (class, quiz-or-exam) pointer
 *
 * EVERY document in all three, unconditionally. There is no keep-rule and no
 * evidence to weigh, because nothing can read or write these collections any
 * more: firestore.rules has no match block for them, which in Firestore denies
 * every client read and write. The admin SDK this script uses bypasses rules,
 * so it is the only remaining way to reach the data — which is also why the
 * deletion has to be deliberate rather than a rules change.
 *
 * ── What it does NOT touch ────────────────────────────────────────────
 *
 *   • classRegisters (+ its roster / records / attendance subcollections) —
 *     the teacher-only Class Register. A different feature with a similar
 *     name; it survives the removal untouched.
 *   • results, quizzes, users — a learner's own work and account are theirs.
 *     Deleting a class never deleted a learner's results and this does not
 *     start.
 *   • roster entries' `linkedUid` — unless you pass --clear-linked-uids.
 *     See below.
 *
 * ── --clear-linked-uids (opt-in, off by default) ──────────────────────
 *
 * A Class Register roster entry could carry `linkedUid`, pointing at a real
 * learner account. The only writer of a non-null value was "import from
 * existing learner accounts", which sourced its list FROM the invite-code
 * classes — so it is bridge residue, and the UI that created it is gone. It
 * is inert (nothing reads it to fetch learner data; the class list shows a
 * link icon) but it is still a stored teacher→learner-account pointer.
 *
 * It lives in classRegisters, a collection this cleanup otherwise leaves
 * alone, so clearing it is a separate, explicit decision. With the flag, each
 * affected roster entry is backed up and its `linkedUid` set to null — the
 * entry, the learner's name and every mark stay exactly as they are.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN (default)   No writes. Prints what it would delete, per collection.
 *   LIVE  (--live)      Prints the same, then requires you to type DELETE.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --collection=<name>   Limit to one of classes|classInvites|assignments.
 *   --limit=N             Cap documents deleted PER COLLECTION.
 *   --clear-linked-uids   Also null out roster linkedUid values (see above).
 *   --yes                 Skip the typed confirmation (non-interactive; the
 *                         flag itself is the confirmation).
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Dry run by default, and --live still asks.
 *   • Every deleted document is copied to
 *       backups/removed_classes/docs/<collection>__<docId>
 *     before it is deleted, so a restore is a copy-back rather than a
 *     recreate. The backup write and the delete are in the same batch: if the
 *     backup cannot be written, the delete does not commit either.
 *   • Re-running is idempotent — a cleaned project finds nothing.
 *   • No query depends on an index. Paging is `orderBy('__name__')` with no
 *     filter, because this script cleans up after a change that DELETES
 *     indexes — one it needed could be gone by the time it runs. Guarded by
 *     `npm run test:cleanup-classes`.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/cleanup-classes.mjs                       # dry run
 *   node scripts/cleanup-classes.mjs --collection=classes  # dry run, one
 *   node scripts/cleanup-classes.mjs --live                # asks first
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON path).
 * Without it the script explains what it would do and exits — it never
 * pretends to have scanned anything.
 */

import { confirmByTyping } from './lib/confirmPrompt.mjs'

/**
 * The three collections of the removed learner↔teacher class bridge, in
 * deletion order: the pointers (invites, assignments) go before the class they
 * point at, so an interrupted run leaves orphaned classes rather than orphaned
 * invite codes and assignments.
 */
export const BRIDGE_COLLECTIONS = ['classInvites', 'assignments', 'classes']

/** Backup doc id. Flat, because a doc id is unique only within its collection. */
export function backupDocId(collection, docId) {
  return `${collection}__${docId}`
}

/**
 * Which collections a run covers, given a --collection value.
 * Returns [] for a name that is not part of the bridge — the caller reports
 * that as an error rather than silently scanning everything.
 */
export function resolveCollections(only) {
  if (!only) return [...BRIDGE_COLLECTIONS]
  return BRIDGE_COLLECTIONS.filter((c) => c === only)
}

const PAGE_SIZE = 300
const BATCH_SIZE = 400 // Firestore caps a batch at 500 ops; we write 2 per doc.

const LIVE = process.argv.includes('--live')
const ASSUME_YES = process.argv.includes('--yes')
const CLEAR_LINKED_UIDS = process.argv.includes('--clear-linked-uids')
const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}
const ONLY = arg('collection')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity

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

/**
 * Page through a collection so a large one does not land in memory at once.
 *
 * Ordered by `__name__` with no `where` — deliberately, because that uses the
 * index every collection always has. This script must not depend on a
 * composite index: it runs to clean up after a change that DELETES indexes,
 * and an index it needs could be gone by the time it runs.
 *
 * `cap` is the caller's, not the global --limit: that flag caps documents
 * DELETED per bridge collection, and reusing it for an incidental scan (the
 * classRegisters walk) would silently under-report.
 */
async function* pagesOf(db, collection, cap = Infinity) {
  let cursor = null
  let seen = 0
  for (;;) {
    let q = db.collection(collection).orderBy('__name__').limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) return
    const docs = snap.docs.slice(0, Math.max(0, cap - seen))
    if (docs.length) yield docs
    seen += docs.length
    if (seen >= cap || snap.docs.length < PAGE_SIZE) return
    cursor = snap.docs[snap.docs.length - 1]
  }
}

async function countCollections(db, collections) {
  const counts = {}
  for (const collection of collections) {
    let n = 0
    for await (const docs of pagesOf(db, collection, LIMIT)) n += docs.length
    counts[collection] = n
  }
  return counts
}

/** Back up then delete, in one batch per chunk so a failed backup blocks its delete. */
async function purgeCollection(admin, db, collection) {
  const backupRoot = db.collection('backups').doc('removed_classes').collection('docs')
  let deleted = 0
  for await (const docs of pagesOf(db, collection, LIMIT)) {
    let batch = db.batch()
    let ops = 0
    for (const doc of docs) {
      batch.set(backupRoot.doc(backupDocId(collection, doc.id)), {
        collection,
        docId: doc.id,
        original: doc.data(),
        at: admin.firestore.FieldValue.serverTimestamp(),
      })
      batch.delete(doc.ref)
      ops += 2
      if (ops >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()
    deleted += docs.length
  }
  return deleted
}

/**
 * Every Class Register roster entry carrying a non-null `linkedUid`.
 *
 * Walks classRegisters → each register's `roster` subcollection and filters in
 * memory. The obvious query — `collectionGroup('roster').where('linkedUid',
 * '!=', null)` — needs a COLLECTION_GROUP-scoped single-field index on
 * roster.linkedUid, and Firestore only auto-creates single-field indexes at
 * COLLECTION scope. That query therefore throws FAILED_PRECONDITION on a
 * project that has not declared the override, including on the dry run, where
 * a crash is the worst possible outcome. Shipping an index to support a
 * one-off cleanup — and leaving it behind afterwards — is the wrong trade, so
 * this reads instead. Registers are per-teacher and few; the cost is one read
 * per register plus its roster.
 */
async function findLinkedRosterEntries(db) {
  const found = []
  for await (const registers of pagesOf(db, 'classRegisters')) {
    for (const register of registers) {
      const roster = await register.ref.collection('roster').get()
      for (const entry of roster.docs) {
        // A missing field and an explicit null are both "no link".
        if (entry.data()?.linkedUid != null) found.push(entry)
      }
    }
  }
  return found
}

/**
 * Null out `linkedUid` on every Class Register roster entry that has one.
 * The entry itself, the learner's name and their marks are left alone.
 */
async function clearLinkedUids(admin, db, { dryRun }) {
  const backupRoot = db.collection('backups').doc('removed_classes').collection('roster_links')
  const entries = await findLinkedRosterEntries(db)
  if (entries.length === 0 || dryRun) return entries.length

  let batch = db.batch()
  let ops = 0
  for (const doc of entries) {
    batch.set(backupRoot.doc(doc.ref.path.replace(/\//g, '__')), {
      path: doc.ref.path,
      linkedUid: doc.data().linkedUid,
      at: admin.firestore.FieldValue.serverTimestamp(),
    })
    batch.update(doc.ref, { linkedUid: null })
    ops += 2
    if (ops >= BATCH_SIZE) {
      await batch.commit()
      batch = db.batch()
      ops = 0
    }
  }
  if (ops > 0) await batch.commit()
  return entries.length
}

async function runAgainstFirestore(admin) {
  const db = admin.firestore()
  const collections = resolveCollections(ONLY)
  if (collections.length === 0) {
    console.error(
      `ERROR: --collection=${ONLY} is not part of the class bridge. `
      + `Expected one of: ${BRIDGE_COLLECTIONS.join(', ')}.`,
    )
    process.exitCode = 1
    return
  }

  console.log(`Scanning ${collections.join(', ')}…\n`)
  const counts = await countCollections(db, collections)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  console.log('── documents to delete ──')
  for (const collection of collections) {
    console.log(`  ${collection.padEnd(14)} ${counts[collection]}`)
  }
  console.log(`  ${'TOTAL'.padEnd(14)} ${total}`)

  let linkedUids = 0
  if (CLEAR_LINKED_UIDS) {
    linkedUids = await clearLinkedUids(admin, db, { dryRun: true })
    console.log(`\n── roster entries whose linkedUid would be cleared ──\n  ${linkedUids}`)
  }

  if (total === 0 && linkedUids === 0) {
    console.log('\nNothing to do — already clean.')
    return
  }
  if (!LIVE) {
    console.log('\n── DRY RUN — nothing was written. Re-run with --live to delete. ──')
    return
  }

  const ok = ASSUME_YES || await confirmByTyping(
    `About to DELETE ${total} document${total === 1 ? '' : 's'} from `
    + `${collections.join(', ')}`
    + (CLEAR_LINKED_UIDS ? `, and clear linkedUid on ${linkedUids} roster entries` : '')
    + '. A copy of each is written to backups/removed_classes first.',
  )
  if (!ok) {
    console.log('\nAborted — nothing was deleted.')
    process.exitCode = 1
    return
  }

  let deleted = 0
  for (const collection of collections) {
    const n = await purgeCollection(admin, db, collection)
    console.log(`  deleted ${n} from ${collection}`)
    deleted += n
  }
  if (CLEAR_LINKED_UIDS) {
    const n = await clearLinkedUids(admin, db, { dryRun: false })
    console.log(`  cleared linkedUid on ${n} roster entries`)
  }
  console.log(
    `\nDeleted ${deleted} document${deleted === 1 ? '' : 's'}. `
    + 'Backups are in backups/removed_classes.',
  )
}

function explainWithoutCredentials() {
  console.log('No GOOGLE_APPLICATION_CREDENTIALS — not scanning anything.\n')
  console.log('This script deletes every document in the collections of the removed')
  console.log('learner/teacher class feature:\n')
  for (const c of BRIDGE_COLLECTIONS) console.log(`  ${c}`)
  console.log('\nIt does NOT touch classRegisters, results, quizzes or users.')
  console.log('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path,')
  console.log('then re-run for a dry run — and again with --live to delete.')
}

// Only run the CLI when this file IS the entry point, so importing it for its
// exported helpers (the test does) cannot connect to Firestore.
const invokedAsScript =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`

if (invokedAsScript) {
  const admin = await loadAdmin()
  if (admin) await runAgainstFirestore(admin)
  else explainWithoutCredentials()
}
