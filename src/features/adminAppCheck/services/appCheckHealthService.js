/**
 * The only place adminAppCheck touches Firebase (architecture.md §14.2).
 *
 * Two reads and one callable:
 *   - the per-day attestation rollups the Cloud Functions writer produces,
 *   - the `appCheckPing` self-test, which is what turns "this device is
 *     unattested" into a reason rather than a symptom.
 *
 * Every read is admin-only per `firestore.rules`; a non-admin caller gets
 * permission-denied rather than an empty window.
 */

import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'
import { COLLECTION, healthWindowDates, mergeDayCounters } from '../lib/appCheckHealthCore'

/** Read + merge one date's legacy doc and its shard subcollection. */
async function readDayHealth(date) {
  const [legacySnap, shardsSnap] = await Promise.all([
    getDoc(doc(db, COLLECTION, date)).catch(() => null),
    getDocs(collection(db, COLLECTION, date, 'shards')).catch(() => null),
  ])
  const docs = []
  if (legacySnap && legacySnap.exists()) docs.push(legacySnap.data())
  if (shardsSnap) shardsSnap.forEach((s) => docs.push(s.data()))
  return mergeDayCounters(date, docs)
}

/**
 * Last `days` day-rollups, oldest → newest. Each day is summed from its
 * legacy parent doc (if any) PLUS every doc in its `shards` subcollection
 * (the sharded + sampled writer, appCheckHealthCore.js in functions/). Date
 * keys are enumerated locally rather than via a collection query because the
 * new writer never touches the shared parent doc.
 */
export async function listAppCheckHealth({ days = 14 } = {}) {
  return Promise.all(healthWindowDates({ days }).map((date) => readDayHealth(date)))
}

/**
 * The server-side self-test: does THIS session's token verify?
 *
 * Called with `{}` rather than no argument — a callable invoked bare sends
 * `null` as its payload, which is a different request on the wire, and a
 * migration is a move.
 */
export async function pingAppCheck() {
  const ping = httpsCallable(getFunctions(app, 'us-central1'), 'appCheckPing')
  return ping({})
}
