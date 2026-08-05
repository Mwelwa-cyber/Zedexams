import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// useFlashcardProgress loads a deck's mastery Set once, then keeps it in sync
// as the learner marks cards mastered / for-review. The subtle parts are the
// idempotency (marking an already-mastered card is a no-op — no state churn,
// no redundant save) and that a save only fires on a REAL change, with the
// mastered indices persisted sorted. useAuth + the Firestore-backed progress
// lib are mocked; this spec owns the hook's own load/persist/idempotency logic.

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../services/flashcardProgress', () => ({
  getFlashcardProgress: vi.fn(),
  saveFlashcardProgress: vi.fn(),
}))

import { useAuth } from '../../../contexts/AuthContext'
import {
  getFlashcardProgress,
  saveFlashcardProgress,
} from '../services/flashcardProgress'
import { useFlashcardProgress } from './useFlashcardProgress.js'

beforeEach(() => {
  useAuth.mockReturnValue({ currentUser: { uid: 'u1' } })
  getFlashcardProgress.mockReset().mockResolvedValue({ masteredCards: [] })
  saveFlashcardProgress.mockReset().mockResolvedValue(undefined)
})

describe('useFlashcardProgress — loading', () => {
  it('hydrates the mastered set from the saved record', async () => {
    getFlashcardProgress.mockResolvedValue({ masteredCards: [1, 3] })
    const { result } = renderHook(() => useFlashcardProgress('deck-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect([...result.current.masteredCards].sort()).toEqual([1, 3])
    expect(getFlashcardProgress).toHaveBeenCalledWith('u1', 'deck-1')
  })

  it('starts empty and skips the fetch when there is no deckId', async () => {
    const { result } = renderHook(() => useFlashcardProgress(null))
    expect(result.current.masteredCards.size).toBe(0)
    expect(getFlashcardProgress).not.toHaveBeenCalled()
  })

  it('skips the fetch when there is no signed-in user', async () => {
    useAuth.mockReturnValue({ currentUser: null })
    renderHook(() => useFlashcardProgress('deck-1'))
    expect(getFlashcardProgress).not.toHaveBeenCalled()
  })

  it('tolerates a missing/empty record without throwing', async () => {
    getFlashcardProgress.mockResolvedValue(null)
    const { result } = renderHook(() => useFlashcardProgress('deck-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.masteredCards.size).toBe(0)
  })
})

describe('useFlashcardProgress — markMastered', () => {
  it('adds a card and persists the new set (sorted)', async () => {
    getFlashcardProgress.mockResolvedValue({ masteredCards: [2] })
    const { result } = renderHook(() => useFlashcardProgress('deck-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.markMastered(0, 5) })

    expect(result.current.masteredCards.has(0)).toBe(true)
    expect(saveFlashcardProgress).toHaveBeenCalledWith('u1', 'deck-1', [0, 2], 5)
  })

  it('is a no-op when the card is already mastered', async () => {
    getFlashcardProgress.mockResolvedValue({ masteredCards: [0] })
    const { result } = renderHook(() => useFlashcardProgress('deck-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = result.current.masteredCards
    act(() => { result.current.markMastered(0, 5) })

    // Same Set reference back (no churn) and no redundant save.
    expect(result.current.masteredCards).toBe(before)
    expect(saveFlashcardProgress).not.toHaveBeenCalled()
  })
})

describe('useFlashcardProgress — markReview', () => {
  it('removes a mastered card and persists the smaller set', async () => {
    getFlashcardProgress.mockResolvedValue({ masteredCards: [0, 1] })
    const { result } = renderHook(() => useFlashcardProgress('deck-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.markReview(0, 5) })

    expect(result.current.masteredCards.has(0)).toBe(false)
    expect(saveFlashcardProgress).toHaveBeenCalledWith('u1', 'deck-1', [1], 5)
  })

  it('is a no-op when the card was not mastered', async () => {
    getFlashcardProgress.mockResolvedValue({ masteredCards: [1] })
    const { result } = renderHook(() => useFlashcardProgress('deck-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = result.current.masteredCards
    act(() => { result.current.markReview(0, 5) })

    expect(result.current.masteredCards).toBe(before)
    expect(saveFlashcardProgress).not.toHaveBeenCalled()
  })

  it('does not persist when there is no deck to save against', async () => {
    const { result } = renderHook(() => useFlashcardProgress(null))
    act(() => { result.current.markMastered(0, 5) })
    expect(saveFlashcardProgress).not.toHaveBeenCalled()
  })
})
