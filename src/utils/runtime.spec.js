import { describe, it, expect, vi, afterEach } from 'vitest'

// Capacitor.isNativePlatform() is the switch between the web and native shells.
// Mock it so we can drive siteOrigin() down both paths without a real device.
const isNativePlatform = vi.fn(() => false)
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}))

import { siteOrigin, apiUrl, SITE_ORIGIN } from './runtime.js'

afterEach(() => { isNativePlatform.mockReturnValue(false) })

describe('siteOrigin', () => {
  it('uses window.location.origin on the web (self-referential for staging/preview)', () => {
    isNativePlatform.mockReturnValue(false)
    // jsdom serves the tests from a real origin.
    expect(siteOrigin()).toBe(window.location.origin)
  })

  it('uses the canonical production origin in the native shell', () => {
    // THE regression: in the Capacitor WebView window.location.origin is
    // https://localhost, so a share link built from it (https://localhost/share/…)
    // is dead the moment it leaves the phone. Native must use zedexams.com.
    isNativePlatform.mockReturnValue(true)
    expect(siteOrigin()).toBe(SITE_ORIGIN)
    expect(SITE_ORIGIN).toBe('https://zedexams.com')
    expect(siteOrigin()).not.toContain('localhost')
  })
})

describe('apiUrl', () => {
  it('leaves /api paths untouched on the web', () => {
    isNativePlatform.mockReturnValue(false)
    expect(apiUrl('/api/ai/chat')).toBe('/api/ai/chat')
  })

  it('fully-qualifies /api paths against the canonical origin on native', () => {
    isNativePlatform.mockReturnValue(true)
    expect(apiUrl('/api/ai/chat')).toBe(`${SITE_ORIGIN}/api/ai/chat`)
  })
})
