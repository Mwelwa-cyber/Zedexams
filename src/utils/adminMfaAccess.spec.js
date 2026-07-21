import { describe, it, expect } from 'vitest'
import { resolveAdminRouteAccess, MFA_SETUP_PATH } from './adminMfaAccess'

const base = {
  loading: false,
  hasUser: true,
  isAdmin: true,
  mfaEnrolled: true,
  isSetupRoute: false,
  needsVerification: false,
  profileIssue: false,
}

describe('resolveAdminRouteAccess', () => {
  it('shows a loader while auth resolves (no admin flash)', () => {
    expect(resolveAdminRouteAccess({ ...base, loading: true }).action).toBe('loading')
  })

  it('redirects a signed-out visitor to login', () => {
    const r = resolveAdminRouteAccess({ ...base, hasUser: false })
    expect(r).toEqual({ action: 'redirect', to: '/login', reason: 'signed-out' })
  })

  it('shows recovery on a profile issue', () => {
    expect(resolveAdminRouteAccess({ ...base, profileIssue: true }).action).toBe('recovery')
  })

  it('redirects an unverified admin to verify-email', () => {
    const r = resolveAdminRouteAccess({ ...base, needsVerification: true })
    expect(r.to).toBe('/verify-email')
  })

  it('redirects a non-admin to their role landing', () => {
    const r = resolveAdminRouteAccess({ ...base, isAdmin: false })
    expect(r).toEqual({ action: 'redirect', to: 'role-landing', reason: 'not-admin' })
  })

  it('redirects an admin WITHOUT MFA to the setup page', () => {
    const r = resolveAdminRouteAccess({ ...base, mfaEnrolled: false })
    expect(r).toEqual({ action: 'redirect', to: MFA_SETUP_PATH, reason: 'mfa-required' })
  })

  it('allows an admin WITH MFA', () => {
    expect(resolveAdminRouteAccess(base)).toEqual({ action: 'allow', reason: 'ok' })
  })

  it('never loops the setup route: admin without MFA is allowed ON the setup page', () => {
    const r = resolveAdminRouteAccess({ ...base, mfaEnrolled: false, isSetupRoute: true })
    expect(r).toEqual({ action: 'allow', reason: 'setup' })
  })

  it('a non-admin cannot reach the setup page', () => {
    const r = resolveAdminRouteAccess({ ...base, isAdmin: false, isSetupRoute: true })
    expect(r.action).toBe('redirect')
    expect(r.reason).toBe('not-admin')
  })
})
