// Per-user mastery progress for a saved flashcard deck — the feature's only
// Firestore access. One document per user+deck in `flashcardProgress`, keyed
// `{uid}_{deckId}`.
//
// Document shape:
//   { uid, deckId, masteredCards: number[], totalCards: number,
//     status: 'not-started'|'in-progress'|'completed',
//     startedAt?, lastStudiedAt?, updatedAt }
//
// The rules for this collection are in firestore.rules and exercised by
// scripts/test-firestore-rules-emulator.mjs: owner-scoped read, owner-scoped
// create/update with a field allowlist, admin-only delete. The client cannot
// write another learner's progress, and nothing here should be read as the
// enforcement — the rules are.
//
// Decisions live in ../lib/flashcardProgressCore.js so they are testable
// without Firebase; this file is the I/O half and holds no rule of its own.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { deriveFlashcardStatus, flashcardProgressId } from '../lib/flashcardProgressCore.js'

const COL = 'flashcardProgress'

/** Read a single progress record, or null if not started. */
export async function getFlashcardProgress(uid, deckId) {
  if (!uid || !deckId) return null
  const snap = await getDoc(doc(db, COL, flashcardProgressId(uid, deckId)))
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
  const status = deriveFlashcardStatus(masteredCards.length, totalCards)
  const ref = doc(db, COL, flashcardProgressId(uid, deckId))
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
