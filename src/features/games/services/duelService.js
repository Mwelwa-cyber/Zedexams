/**
 * duelService — the client side of the LIVE learner-vs-learner challenge
 * (PROMPT 9, server half merged as functions/duel/).
 *
 * The shape mirrors the server's rules exactly:
 * - You queue by writing YOUR OWN duelQueue doc ({grade, createdAtMs}
 *   only — anything else the rules refuse) and you learn your match by
 *   WATCHING that doc for the server-stamped matchId. No client ever
 *   lists the queue; there is no roster to browse.
 * - The match doc is server-written; the only thing a client sends is
 *   raw answer indexes to the submitDuelAnswers callable, which grades
 *   them server-side. No score ever leaves this module.
 */

import {
  doc, setDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db, auth } from '../../../firebase/config'

const duelFunctions = getFunctions(app, 'us-central1')
const submitDuelAnswersCallable = httpsCallable(duelFunctions, 'submitDuelAnswers')

/**
 * Join the matchmaking queue and watch for a pairing.
 *
 * Returns an unsubscribe/cancel function. `onMatched(matchId)` fires
 * once when the server stamps the match; `onError` on a failed write.
 * Cancelling deletes the queue entry (leaving the queue is always the
 * caller's explicit choice — unmount included, so a closed tab does not
 * strand a ghost entry the TTL then has to age out).
 */
export function joinQueue({ grade, onMatched, onError }) {
  const user = auth.currentUser
  if (!user) { onError?.(new Error('not_signed_in')); return () => {} }
  const ref = doc(db, 'duelQueue', user.uid)
  let stopped = false
  let unsubscribe = () => {}

  setDoc(ref, { grade: Number(grade), createdAtMs: Date.now() })
    .then(() => {
      if (stopped) return null
      unsubscribe = onSnapshot(ref, (snap) => {
        const matchId = snap.exists() ? snap.get('matchId') : null
        if (matchId) {
          onMatched?.(matchId)
        }
      }, (err) => onError?.(err))
      return null
    })
    .catch((err) => onError?.(err))

  return () => {
    stopped = true
    unsubscribe()
    deleteDoc(ref).catch(() => { /* best-effort: the TTL ages out leftovers */ })
  }
}

/** Watch a match doc. Returns the unsubscribe. */
export function watchMatch(matchId, onChange, onError) {
  return onSnapshot(
    doc(db, 'matches', matchId),
    (snap) => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => onError?.(err),
  )
}

/**
 * Submit the finished answer sheet — raw option indexes, positional
 * against the match's question order. The server grades and settles;
 * the response carries the graded score and, once both players are in,
 * the outcome.
 */
export async function submitAnswers(matchId, answers) {
  const res = await submitDuelAnswersCallable({ matchId, answers })
  return res.data
}
