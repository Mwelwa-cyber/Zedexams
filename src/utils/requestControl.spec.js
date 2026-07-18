import { describe, it, expect } from 'vitest'
import {
  normalizeSearchText,
  isSearchableQuery,
  createSequenceGuard,
  createSearchCache,
  generateRequestId,
  createRequestLock,
} from './requestControl.js'

describe('normalizeSearchText', () => {
  it('trims, lowercases, and collapses repeated spaces', () => {
    expect(normalizeSearchText('  Math   Quiz  ')).toBe('math quiz')
  })

  it('strips accents by default', () => {
    expect(normalizeSearchText('café')).toBe('cafe')
  })

  it('can keep accents when disabled', () => {
    expect(normalizeSearchText('café', { stripAccents: false })).toBe('café')
  })

  it('never throws on non-string input', () => {
    expect(normalizeSearchText(undefined)).toBe('')
    expect(normalizeSearchText(null)).toBe('')
    expect(normalizeSearchText(42)).toBe('')
  })
})

describe('isSearchableQuery', () => {
  it('requires at least the minimum length', () => {
    expect(isSearchableQuery('', 2)).toBe(false)
    expect(isSearchableQuery('a', 2)).toBe(false)
    expect(isSearchableQuery('ab', 2)).toBe(true)
  })
})

describe('createSequenceGuard', () => {
  it('only the latest bumped token is current', () => {
    const guard = createSequenceGuard()
    const a = guard.bump()
    const b = guard.bump()
    expect(guard.isCurrent(a)).toBe(false)
    expect(guard.isCurrent(b)).toBe(true)
  })
})

describe('createSearchCache', () => {
  it('returns a cached value for the same key', () => {
    const cache = createSearchCache({ ttlMs: 60_000 })
    cache.set('math', ['q1'])
    expect(cache.get('math')).toEqual(['q1'])
    expect(cache.has('math')).toBe(true)
  })

  it('evicts the oldest entry once maxSize is exceeded', () => {
    const cache = createSearchCache({ ttlMs: 60_000, maxSize: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.size()).toBe(2)
    expect(cache.has('a')).toBe(false)
  })
})

describe('generateRequestId', () => {
  it('produces distinct ids', () => {
    const a = generateRequestId()
    const b = generateRequestId()
    expect(a).not.toBe(b)
    expect(typeof a).toBe('string')
  })
})

describe('createRequestLock', () => {
  it('only allows one holder at a time', () => {
    const lock = createRequestLock()
    const id = lock.begin()
    expect(id).toBeTruthy()
    expect(lock.begin()).toBeNull()
    lock.release(id)
    expect(lock.begin()).toBeTruthy()
  })
})
