import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getFlashcardProgress,
  saveFlashcardProgress,
} from '../services/flashcardProgress'

/**
 * Loads and persists mastery state for a single flashcard deck.
 *
 * @param {string|null} deckId  — the generationId of the saved deck.
 *   Pass null/undefined when there is no persisted deck (e.g. a freshly
 *   generated deck that hasn't been saved yet).
 *
 * @returns {{
 *   masteredCards: Set<number>,
 *   loading: boolean,
 *   markMastered: (index: number, totalCards: number) => void,
 *   markReview:   (index: number, totalCards: number) => void,
 * }}
 */
export function useFlashcardProgress(deckId) {
  const { currentUser } = useAuth()
  const [masteredCards, setMasteredCards] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  // Track the latest Set in a ref so the save callbacks are always fresh.
  const masteredRef = useRef(masteredCards)
  masteredRef.current = masteredCards

  useEffect(() => {
    if (!currentUser?.uid || !deckId) {
      setMasteredCards(new Set())
      return
    }
    let cancelled = false
    setLoading(true)
    getFlashcardProgress(currentUser.uid, deckId)
      .then((rec) => {
        if (cancelled) return
        setMasteredCards(new Set(rec?.masteredCards || []))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser?.uid, deckId])

  const persist = useCallback((next, totalCards) => {
    if (!currentUser?.uid || !deckId) return
    const arr = Array.from(next).sort((a, b) => a - b)
    saveFlashcardProgress(currentUser.uid, deckId, arr, totalCards).catch(() => {})
  }, [currentUser?.uid, deckId])

  const markMastered = useCallback((index, totalCards) => {
    setMasteredCards((prev) => {
      if (prev.has(index)) return prev
      const next = new Set(prev)
      next.add(index)
      persist(next, totalCards)
      return next
    })
  }, [persist])

  const markReview = useCallback((index, totalCards) => {
    setMasteredCards((prev) => {
      if (!prev.has(index)) return prev
      const next = new Set(prev)
      next.delete(index)
      persist(next, totalCards)
      return next
    })
  }, [persist])

  return { masteredCards, loading, markMastered, markReview }
}
