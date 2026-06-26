// Per-user mastery progress for a saved flashcard deck.
// One document per user+deck in `flashcardProgress`, keyed `{uid}_{deckId}`.
//
// Document shape:
//   { uid, deckId, masteredCards: number[], totalCards: number,
//     status: 'not-started'|'in-progress'|'completed',
//     startedAt?, lastStudiedAt?, updatedAt }

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'

const COL = 'flashcardProgress'

export const FLASHCARD_PROGRESS_STATUS = {
  NOT_STARTED: 'not-started',
  IN_PROGRESS:  'in-progress',
  COMPLETED:    'completed',
}

const idFor = (uid, deckId) => `${uid}_${deckId}`

function deriveStatus(masteredCount, totalCards) {
  if (masteredCount === 0) return FLASHCARD_PROGRESS_STATUS.NOT_STARTED
  if (masteredCount >= totalCards) return FLASHCARD_PROGRESS_STATUS.COMPLETED
  return FLASHCARD_PROGRESS_STATUS.IN_PROGRESS
}

/** Read a single progress record, or null if not started. */
export async function getFlashcardProgress(uid, deckId) {
  if (!uid || !deckId) return null
  const snap = await getDoc(doc(db, COL, idFor(uid, deckId)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/**
 * Persist the current mastery set for a deck.
 * @param {string} uid
 * @param {string} deckId
 * @param {number[]} masteredCards  sorted array of mastered card indices
 * @param {number}   totalCards
 */
export async function saveFlashcardProgress(uid, deckId, masteredCards, totalCards) {
  if (!uid || !deckId) return
  const status = deriveStatus(masteredCards.length, totalCards)
  const ref = doc(db, COL, idFor(uid, deckId))
  const patch = {
    uid,
    deckId,
    masteredCards,
    totalCards,
    status,
    lastStudiedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await setDoc(ref, patch, { merge: true })
}
