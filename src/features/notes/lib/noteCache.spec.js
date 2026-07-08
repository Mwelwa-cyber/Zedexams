import { describe, it, expect } from 'vitest'
import { serializeNoteForCache, isPinnableNote } from './noteCache'

describe('serializeNoteForCache', () => {
  it('converts Firestore Timestamp fields to millis so they survive IndexedDB', () => {
    const ts = { toMillis: () => 1_700_000_000_000, toDate: () => new Date(1_700_000_000_000) }
    const out = serializeNoteForCache({ id: 'n1', title: 'T', publishedAt: ts, updatedAt: ts })
    expect(out.publishedAt).toBe(1_700_000_000_000)
    expect(out.updatedAt).toBe(1_700_000_000_000)
    expect(out.title).toBe('T')
  })

  it('falls back to seconds/nanoseconds when the methods are gone (post-clone)', () => {
    const out = serializeNoteForCache({ createdAt: { seconds: 1700, nanoseconds: 500_000_000 } })
    expect(out.createdAt).toBe(1700 * 1000 + 500)
  })

  it('leaves plain/ISO/number date values untouched', () => {
    const out = serializeNoteForCache({ publishedAt: '2026-06-12', updatedAt: 1234 })
    expect(out.publishedAt).toBe('2026-06-12')
    expect(out.updatedAt).toBe(1234)
  })

  it('does not mutate the input note', () => {
    const ts = { toMillis: () => 5 }
    const input = { publishedAt: ts }
    serializeNoteForCache(input)
    expect(input.publishedAt).toBe(ts)
  })

  it('passes null/undefined through (a missing note)', () => {
    expect(serializeNoteForCache(null)).toBeNull()
    expect(serializeNoteForCache(undefined)).toBeUndefined()
  })
})

describe('isPinnableNote', () => {
  it('is true for self-contained formats (study / visual / rich_text)', () => {
    expect(isPinnableNote({ noteFormat: 'study' })).toBe(true)
    expect(isPinnableNote({ noteFormat: 'visual_slides' })).toBe(true)
    expect(isPinnableNote({ noteFormat: 'rich_text' })).toBe(true)
  })

  it('treats a formatless legacy note as pinnable rich text', () => {
    expect(isPinnableNote({ id: 'n' })).toBe(true)
  })

  it('is false for FILE notes (external PDF — nothing to cache in the doc)', () => {
    expect(isPinnableNote({ noteFormat: 'file' })).toBe(false)
  })

  it('is false for a null note', () => {
    expect(isPinnableNote(null)).toBe(false)
  })
})
