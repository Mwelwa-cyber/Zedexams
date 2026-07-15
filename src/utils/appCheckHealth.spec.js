/**
 * classifyDeviceAttestation — the "this device" self-test verdict on
 * /admin/app-check. Each branch maps one failure mode the server-side
 * counters can't separate (they fold everything into "missing") to an
 * actionable next step, so the ordering and tones here are load-bearing.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase/config', () => ({ db: {} }))

import { classifyDeviceAttestation, mergeDayCounters } from './appCheckHealth'

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

  it('names a not-yet-deployed diagnostic when the ping 404s', () => {
    const v = classifyDeviceAttestation({ ...base, attested: null, pingError: 'functions/not-found' })
    expect(v.tone).toBe('warn')
    expect(v.title).toContain('not deployed')
    expect(v.detail).toContain('not-found')
  })

  it('points at the session when the ping is rejected as unauthenticated', () => {
    const v = classifyDeviceAttestation({ ...base, attested: null, pingError: { code: 'unauthenticated' } })
    expect(v.tone).toBe('warn')
    expect(v.title).toContain('authenticated')
  })

  it('surfaces any other ping error code in the detail', () => {
    const v = classifyDeviceAttestation({ ...base, attested: null, pingError: 'unavailable' })
    expect(v.tone).toBe('warn')
    expect(v.detail).toContain('unavailable')
  })
})

describe('mergeDayCounters', () => {
  it('sums a pre-migration legacy day off the parent doc', () => {
    const row = mergeDayCounters('2026-07-01', [
      { date: '2026-07-01', aiChat_attempts: 100, aiChat_valid: 90, updatedAt: 'ts' },
    ])
    expect(row.aiChat_attempts).toBe(100)
    expect(row.aiChat_valid).toBe(90)
    expect(row.updatedAt).toBeUndefined() // non-numeric fields are dropped
  })

  it('sums shard docs across the subcollection', () => {
    const row = mergeDayCounters('2026-07-15', [
      { aiChat_attempts: 20, aiChat_valid: 20 },
      { aiChat_attempts: 40, aiChat_valid: 20, aiChat_missing: 20 },
    ])
    expect(row.aiChat_attempts).toBe(60)
    expect(row.aiChat_valid).toBe(40)
    expect(row.aiChat_missing).toBe(20)
  })

  it('is additive across legacy + shards without double-counting', () => {
    const row = mergeDayCounters('2026-07-10', [
      { aiChat_attempts: 5 },
      { aiChat_attempts: 15 },
    ])
    expect(row.aiChat_attempts).toBe(20)
    expect(row.date).toBe('2026-07-10')
  })

  it('tolerates a null (failed) shard read', () => {
    const row = mergeDayCounters('2026-07-10', [null, { aiChat_attempts: 7 }, undefined])
    expect(row.aiChat_attempts).toBe(7)
  })
})
