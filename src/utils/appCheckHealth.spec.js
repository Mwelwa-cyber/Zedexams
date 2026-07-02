/**
 * classifyDeviceAttestation — the "this device" self-test verdict on
 * /admin/app-check. Each branch maps one failure mode the server-side
 * counters can't separate (they fold everything into "missing") to an
 * actionable next step, so the ordering and tones here are load-bearing.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase/config', () => ({ db: {} }))

import { classifyDeviceAttestation } from './appCheckHealth'

const base = {
  native: false,
  recaptchaKeyConfigured: true,
  initialized: true,
  tokenKind: 'real',
  attested: null,
}

describe('classifyDeviceAttestation', () => {
  it('reports success whenever the server verified the token', () => {
    // attested=true wins even if local state looks odd — the server verdict
    // is the ground truth.
    const v = classifyDeviceAttestation({ ...base, recaptchaKeyConfigured: false, attested: true })
    expect(v.tone).toBe('good')
  })

  it('flags a build shipped without the reCAPTCHA key (web only)', () => {
    const v = classifyDeviceAttestation({ ...base, recaptchaKeyConfigured: false, attested: false })
    expect(v.tone).toBe('block')
    expect(v.detail).toContain('VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY')
  })

  it('does not blame the reCAPTCHA key on native', () => {
    const v = classifyDeviceAttestation({
      ...base, native: true, recaptchaKeyConfigured: false, initialized: false,
    })
    expect(v.detail).not.toContain('VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY')
    expect(v.detail).toContain('cap sync')
  })

  it('flags the fail-open placeholder with a platform-specific fix', () => {
    const web = classifyDeviceAttestation({ ...base, tokenKind: 'placeholder' })
    expect(web.tone).toBe('block')
    expect(web.title).toContain('reCAPTCHA')

    const native = classifyDeviceAttestation({ ...base, native: true, tokenKind: 'placeholder' })
    expect(native.title).toContain('Play Integrity')
    expect(native.detail).toContain('B3-PLAY-INTEGRITY-SETUP')
  })

  it('flags a console-side mismatch when a real token is rejected', () => {
    const v = classifyDeviceAttestation({ ...base, attested: false })
    expect(v.tone).toBe('block')
    expect(v.detail).toContain('Firebase Console')
  })

  it('stays inconclusive when the ping never reached the server', () => {
    const v = classifyDeviceAttestation({ ...base, attested: null })
    expect(v.tone).toBe('warn')
  })
})
