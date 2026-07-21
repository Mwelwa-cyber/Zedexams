import { describe, it, expect } from 'vitest'
import { mfaErrorMessage, isMfaRequiredError, isRecentLoginError } from './mfaErrors'

describe('mfaErrorMessage', () => {
  it('maps invalid code to friendly copy', () => {
    expect(mfaErrorMessage({ code: 'auth/invalid-verification-code' })).toMatch(/isn't right/i)
  })
  it('maps expired code', () => {
    expect(mfaErrorMessage({ code: 'auth/code-expired' })).toMatch(/expired/i)
  })
  it('maps multi-factor-auth-required', () => {
    expect(mfaErrorMessage({ code: 'auth/multi-factor-auth-required' })).toMatch(/6-digit/i)
  })
  it('maps both mfa-info-not-found spellings', () => {
    expect(mfaErrorMessage({ code: 'auth/multi-factor-info-not-found' })).toMatch(/reset your MFA/i)
    expect(mfaErrorMessage({ code: 'auth/mfa-info-not-found' })).toMatch(/reset your MFA/i)
  })
  it('maps backend reason admin-mfa-required over the raw code', () => {
    const err = { code: 'functions/failed-precondition', details: { reason: 'admin-mfa-required' } }
    expect(mfaErrorMessage(err)).toMatch(/Multi-factor authentication is required/i)
  })
  it('maps self-reset-forbidden reason', () => {
    const err = { code: 'functions/failed-precondition', details: { reason: 'self-reset-forbidden' } }
    expect(mfaErrorMessage(err)).toMatch(/another super admin/i)
  })
  it('never echoes a raw firebase code for unknown errors', () => {
    const msg = mfaErrorMessage({ code: 'auth/some-internal-thing-xyz' })
    expect(msg).not.toMatch(/auth\//)
    expect(msg).toMatch(/try again/i)
  })
  it('accepts a bare code string', () => {
    expect(mfaErrorMessage('auth/too-many-requests')).toMatch(/wait a few minutes/i)
  })
  it('falls back for null', () => {
    expect(mfaErrorMessage(null)).toMatch(/try again/i)
  })
})

describe('isMfaRequiredError', () => {
  it('true for the required code', () => {
    expect(isMfaRequiredError({ code: 'auth/multi-factor-auth-required' })).toBe(true)
  })
  it('false otherwise', () => {
    expect(isMfaRequiredError({ code: 'auth/wrong-password' })).toBe(false)
  })
})

describe('isRecentLoginError', () => {
  it('true for auth/requires-recent-login', () => {
    expect(isRecentLoginError({ code: 'auth/requires-recent-login' })).toBe(true)
  })
  it('true for backend reason', () => {
    expect(isRecentLoginError({ details: { reason: 'requires-recent-login' } })).toBe(true)
  })
  it('false otherwise', () => {
    expect(isRecentLoginError({ code: 'auth/invalid-verification-code' })).toBe(false)
  })
})
