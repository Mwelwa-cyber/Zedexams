/**
 * Where a learner's spelling record lives: `spellingProgress/{uid}`, mirrored
 * to this device.
 *
 * The mirror is not a cache of convenience — it is what makes the two halves
 * of the promise in §25 both true at once. Firestore is the record, so mastery
 * survives a new browser, a sign-out and a different device. The device copy is
 * what makes the map paint instantly on a slow connection, what keeps a
 * signed-out visitor playing, and what holds the work of a learner whose
 * network dropped mid-stage until they come back.
 *
 * THE ORDER MATTERS AND IS THE OPPOSITE OF WHAT IT LOOKS LIKE. On load the
 * device copy is read FIRST and rendered, then the server copy arrives and the
 * two are MERGED (`mergeProgress` — better of the two, never newer of the two)
 * rather than one replacing the other. A learner who played offline on a phone
 * and then signs in on a laptop has two honest records and "last write wins"
 * would throw one of them away.
 *
 * WRITES ARE COALESCED, NOT PER ANSWER. A stage is eight words with a miss
 * queue behind it, so answer-by-answer writes would be twenty document writes
 * per stage per learner. The device copy is written on every answer (it is
 * free and it is what a refresh reads back); the server is written when a
 * stage settles, and on leaving a stage part-way so the resume survives.
 *
 * NOTHING HERE THROWS AT ITS CALLER. A spelling round must not be interrupted
 * because a write failed — the device copy has already succeeded, so the work
 * is not lost, and the next successful sync carries it up.
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { readJson, writeJson } from '../../../shared/utils/safeStorage'
import { withFirestoreReadTimeout } from '../../../utils/firestoreTimeout'
import {
  emptyProgress,
  mergeProgress,
  normaliseProgress,
  serialiseProgress,
} from '../lib/spellingProgressCore'

const COLLECTION = 'spellingProgress'

/**
 * The device key. Keyed by GAME, not by user: a signed-out visitor has no uid,
 * and keying by uid would mean a learner who signs in on a shared phone reads
 * back the last child's practice. The merge on sign-in is what carries a
 * signed-out learner's work into their own record — once, on the way in.
 */
export function deviceKey(gameId) {
  return `zedexams:spelling:${gameId || 'default'}`
}

export function readDeviceProgress(gameId) {
  return normaliseProgress(readJson(deviceKey(gameId), null))
}

export function writeDeviceProgress(gameId, progress) {
  const record = normaliseProgress(progress)
  writeJson(deviceKey(gameId), { ...record, updatedAtMs: Date.now() })
  return record
}

/**
 * The signed-in learner's record from the server, or null when there is no
 * one signed in, no document yet, or the read failed.
 *
 * A FAILED READ IS NULL, NOT AN EMPTY RECORD. The difference decides whether
 * the next write is a merge or an overwrite: treating "we could not read your
 * progress" as "you have no progress" is how a learner's stars are silently
 * replaced with a fresh device's blank record on the first sync after an
 * outage.
 */
export async function readServerProgress() {
  const uid = auth.currentUser?.uid
  if (!uid) return null
  try {
    const snap = await withFirestoreReadTimeout(getDoc(doc(db, COLLECTION, uid)), 'spelling progress')
    return snap.exists() ? normaliseProgress(snap.data()) : emptyProgress()
  } catch {
    return null
  }
}

/**
 * Load the learner's record: the device copy merged with the server's.
 *
 * Returns `{ progress, synced }`. `synced: false` means the server was not
 * reachable or nobody is signed in, so the caller knows this record has not
 * been reconciled and a screen can say so rather than implying it has.
 */
export async function loadSpellingProgress(gameId) {
  const local = readDeviceProgress(gameId)
  const remote = await readServerProgress()
  if (!remote) return { progress: local, synced: false }
  const merged = mergeProgress(local, remote)
  // The merge is written straight back to the device, so a refresh before the
  // next sync reads the reconciled record rather than the stale local one.
  writeDeviceProgress(gameId, merged)
  return { progress: merged, synced: true }
}

/**
 * Push the record to the server. Merged against what is already there rather
 * than written over it, for the same reason the load merges: another device
 * may have moved on since this one last read.
 *
 * Returns `true` when the server holds it. `false` is not an error the caller
 * has to handle — the device copy is already written and the next sync
 * carries it — but it IS the honest answer, and screens that say "saved" read
 * it before saying so.
 */
export async function saveSpellingProgress(gameId, progress) {
  writeDeviceProgress(gameId, progress)
  const uid = auth.currentUser?.uid
  if (!uid) return false
  try {
    const remote = await readServerProgress()
    // A failed read is null and MUST NOT become an empty record here: merging
    // against `{}` would write this device's record over a fuller one.
    const merged = remote ? mergeProgress(progress, remote) : normaliseProgress(progress)
    await setDoc(
      doc(db, COLLECTION, uid),
      { ...serialiseProgress(merged, { uid }), updatedAt: serverTimestamp() },
      { merge: false },
    )
    writeDeviceProgress(gameId, merged)
    return true
  } catch {
    return false
  }
}
