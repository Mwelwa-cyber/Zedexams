/**
 * Regression tests for the branded Google sign-in domain (resolveAuthDomain).
 *
 * The bug: the Google OAuth popup always read "to continue to
 * examsprepzambia.firebaseapp.com" because authDomain came straight from
 * VITE_FIREBASE_AUTH_DOMAIN. On the production custom domain the page's own
 * hostname serves the /__/auth/* helpers, so authDomain must resolve to the
 * hostname there — and ONLY there. Localhost dev, the smoke build, the
 * Capacitor shell, and arbitrary origins must keep the env value, otherwise
 * sign-in breaks (no /__/auth handler on those origins).
 */
import { describe, it, expect } from 'vitest'
import { resolveAuthDomain } from './authDomain'

const ENV_DOMAIN = 'examsprepzambia.firebaseapp.com'

describe('resolveAuthDomain', () => {
  it('uses the page hostname on the production custom domains', () => {
    expect(resolveAuthDomain(ENV_DOMAIN, 'zedexams.com')).toBe('zedexams.com')
    expect(resolveAuthDomain(ENV_DOMAIN, 'www.zedexams.com')).toBe('www.zedexams.com')
  })

  it('keeps the env authDomain on dev/preview/native origins', () => {
    expect(resolveAuthDomain(ENV_DOMAIN, 'localhost')).toBe(ENV_DOMAIN)
    expect(resolveAuthDomain(ENV_DOMAIN, '127.0.0.1')).toBe(ENV_DOMAIN)
    // Firebase preview channels / default hosting domains
    expect(resolveAuthDomain(ENV_DOMAIN, 'examsprepzambia.web.app')).toBe(ENV_DOMAIN)
    expect(resolveAuthDomain(ENV_DOMAIN, 'examsprepzambia.firebaseapp.com')).toBe(ENV_DOMAIN)
    // A lookalike must not be treated as the brand domain
    expect(resolveAuthDomain(ENV_DOMAIN, 'evil-zedexams.com')).toBe(ENV_DOMAIN)
    expect(resolveAuthDomain(ENV_DOMAIN, 'zedexams.com.evil.example')).toBe(ENV_DOMAIN)
  })

  it('keeps the env authDomain when no hostname is available (SSR / native)', () => {
    expect(resolveAuthDomain(ENV_DOMAIN, '')).toBe(ENV_DOMAIN)
    expect(resolveAuthDomain(ENV_DOMAIN, undefined)).toBe(ENV_DOMAIN)
  })
})
