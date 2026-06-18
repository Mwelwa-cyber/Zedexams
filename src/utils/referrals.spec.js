import { beforeEach, describe, expect, it, vi } from 'vitest'

// referrals.js imports firebase/config (which initialises a real app) and the
// Firestore SDK at module load. Mock both so the pure helpers can be tested in
// jsdom without env vars or a network. setDoc/getDoc are spies the Firestore
// tests drive.
const setDoc = vi.fn()
const getDoc = vi.fn()

vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ col, id }),
  getDoc: (...args) => getDoc(...args),
  setDoc: (...args) => setDoc(...args),
  serverTimestamp: () => '__ts__',
}))

const referrals = await import('./referrals')
const {
  generateReferralCode,
  normaliseReferralCode,
  readPendingReferral,
  setPendingReferral,
  clearPendingReferral,
  captureReferralFromUrl,
  buildReferralShareUrl,
  buildReferralWhatsAppUrl,
  mintAndPersistReferralCode,
  resolveReferralCode,
  REFERRAL_CONSTANTS,
} = referrals

beforeEach(() => {
  setDoc.mockReset()
  getDoc.mockReset()
  window.localStorage.clear()
})

describe('generateReferralCode', () => {
  it('produces a code of the documented length from the safe alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateReferralCode()
      expect(code).toHaveLength(REFERRAL_CONSTANTS.CODE_LENGTH)
      expect(code).toMatch(new RegExp(`^[${REFERRAL_CONSTANTS.ALPHABET}]+$`))
      // No visually-ambiguous characters.
      expect(code).not.toMatch(/[O0I1L]/)
    }
  })
})

describe('normaliseReferralCode', () => {
  it('upper-cases and trims valid codes', () => {
    expect(normaliseReferralCode('  abcd2345  ')).toBe('ABCD2345')
  })

  it('rejects malformed input', () => {
    expect(normaliseReferralCode('')).toBeNull()
    expect(normaliseReferralCode(null)).toBeNull()
    expect(normaliseReferralCode('short')).toBeNull()
    expect(normaliseReferralCode('toolongcode')).toBeNull()
    // Contains an ambiguous char that's not in the alphabet.
    expect(normaliseReferralCode('ABCD2340')).toBeNull()
  })
})

describe('pending-referral localStorage helpers', () => {
  it('round-trips a valid code through set/read/clear', () => {
    setPendingReferral('abcd2345')
    expect(window.localStorage.getItem(REFERRAL_CONSTANTS.STORAGE_KEY)).toBe('ABCD2345')
    expect(readPendingReferral()).toBe('ABCD2345')
    clearPendingReferral()
    expect(readPendingReferral()).toBeNull()
  })

  it('refuses to persist a malformed code', () => {
    setPendingReferral('nope')
    expect(window.localStorage.getItem(REFERRAL_CONSTANTS.STORAGE_KEY)).toBeNull()
  })

  it('readPendingReferral validates a tampered store', () => {
    window.localStorage.setItem(REFERRAL_CONSTANTS.STORAGE_KEY, '<script>')
    expect(readPendingReferral()).toBeNull()
  })
})

describe('captureReferralFromUrl', () => {
  it('captures + persists a valid ?ref code', () => {
    const params = new URLSearchParams('?ref=abcd2345')
    expect(captureReferralFromUrl(params)).toBe('ABCD2345')
    expect(readPendingReferral()).toBe('ABCD2345')
  })

  it('returns null when ref is absent, empty, or malformed', () => {
    expect(captureReferralFromUrl(null)).toBeNull()
    expect(captureReferralFromUrl(new URLSearchParams(''))).toBeNull()
    expect(captureReferralFromUrl(new URLSearchParams('?ref=bad'))).toBeNull()
  })
})

describe('share-url builders', () => {
  it('builds a register deep-link', () => {
    expect(buildReferralShareUrl('abcd2345')).toBe('https://zedexams.com/register?ref=ABCD2345')
    expect(buildReferralShareUrl('abcd2345', { baseUrl: 'https://x.test' }))
      .toBe('https://x.test/register?ref=ABCD2345')
  })

  it('returns null for an invalid code', () => {
    expect(buildReferralShareUrl('bad')).toBeNull()
    expect(buildReferralWhatsAppUrl('bad')).toBeNull()
  })

  it('encodes the WhatsApp message + url', () => {
    const url = buildReferralWhatsAppUrl('abcd2345', 'Mara')
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    const text = decodeURIComponent(url.split('text=')[1])
    expect(text).toContain('Mara on ZedExams')
    expect(text).toContain('https://zedexams.com/register?ref=ABCD2345')
  })
})

describe('mintAndPersistReferralCode', () => {
  it('requires a uid', async () => {
    await expect(mintAndPersistReferralCode('')).rejects.toThrow(/uid is required/)
  })

  it('writes the lookup doc keyed by uid and returns the code', async () => {
    setDoc.mockResolvedValueOnce(undefined)
    const code = await mintAndPersistReferralCode('uid-1')
    expect(code).toHaveLength(REFERRAL_CONSTANTS.CODE_LENGTH)
    expect(setDoc).toHaveBeenCalledTimes(1)
    expect(setDoc.mock.calls[0][1]).toMatchObject({ uid: 'uid-1', createdAt: '__ts__' })
  })

  it('retries on a collision then succeeds', async () => {
    setDoc.mockRejectedValueOnce(new Error('exists')).mockResolvedValueOnce(undefined)
    const code = await mintAndPersistReferralCode('uid-2')
    expect(code).toHaveLength(REFERRAL_CONSTANTS.CODE_LENGTH)
    expect(setDoc).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries', async () => {
    setDoc.mockRejectedValue(new Error('exists'))
    await expect(mintAndPersistReferralCode('uid-3')).rejects.toThrow()
    expect(setDoc).toHaveBeenCalledTimes(6)
  })
})

describe('resolveReferralCode', () => {
  it('returns the uid behind an existing code', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ uid: 'owner-1' }) })
    expect(await resolveReferralCode('abcd2345')).toBe('owner-1')
  })

  it('returns null for a malformed code without hitting Firestore', async () => {
    expect(await resolveReferralCode('bad')).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('returns null when the code does not exist', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false })
    expect(await resolveReferralCode('abcd2345')).toBeNull()
  })

  it('swallows Firestore errors and returns null', async () => {
    getDoc.mockRejectedValueOnce(new Error('offline'))
    expect(await resolveReferralCode('abcd2345')).toBeNull()
  })
})
