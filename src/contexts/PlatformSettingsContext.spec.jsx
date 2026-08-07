/**
 * What the provider claims after its subscription dies.
 *
 * Firestore does not resume a listener once it has called `onError`. The
 * provider kept the last snapshot and left `loaded` true, which for most
 * settings is right — the last known `siteName` beats reverting to a default
 * over a transient error. For a FEATURE FLAG it is exactly backwards: a flag's
 * safety argument is that flipping it off reverts every client within seconds,
 * and a client holding a dead read cannot be reached at all.
 *
 * So the two halves are asserted separately: the values are RETAINED, and the
 * claim about them is DOWNGRADED. Getting either one wrong is a real bug in
 * opposite directions.
 *
 * The probe deliberately uses a made-up flag name rather than the engine's.
 * What is being tested here is the PROVIDER's claim about any flag; naming the
 * engine's would also make this a second file reading that flag's raw shape,
 * which `test:engine-flag-single-reader` refuses on purpose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { PlatformSettingsProvider, usePlatformSettings } from './PlatformSettingsContext'

// The listener's two callbacks, captured so a test can fire either.
let onNext = null
let onError = null
const unsubscribe = vi.fn()

vi.mock('firebase/firestore', () => ({
  doc: () => ({ path: 'settings/global' }),
  onSnapshot: (_ref, next, error) => {
    onNext = next
    onError = error
    return unsubscribe
  },
}))
vi.mock('../firebase/config', () => ({ db: {} }))

function Probe() {
  const { settings, loaded, live } = usePlatformSettings()
  return (
    <div>
      <span data-testid="site">{settings.siteName}</span>
      <span data-testid="flag">{String(settings.featureFlags?.someRollout)}</span>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="live">{String(live)}</span>
    </div>
  )
}

const snapshot = (data) => ({ exists: () => true, data: () => data })
const read = (id) => screen.getByTestId(id).textContent

beforeEach(() => {
  onNext = null
  onError = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('PlatformSettingsProvider', () => {
  it('is live before anything has been heard — nothing has failed yet', () => {
    render(<PlatformSettingsProvider><Probe /></PlatformSettingsProvider>)
    expect(read('loaded')).toBe('false')
    expect(read('live')).toBe('true')
  })

  it('serves a snapshot and stays live', () => {
    render(<PlatformSettingsProvider><Probe /></PlatformSettingsProvider>)
    act(() => onNext(snapshot({ siteName: 'ZedExams', featureFlags: { someRollout: true } })))
    expect(read('flag')).toBe('true')
    expect(read('live')).toBe('true')
  })

  it('KEEPS the settings when the subscription dies', () => {
    // Clearing them would revert siteName, theme and maintenance state over an
    // error that may be about something else entirely.
    render(<PlatformSettingsProvider><Probe /></PlatformSettingsProvider>)
    // NOT the default value. Asserting against `DEFAULTS.siteName` would pass
    // whether the settings were kept or cleared, which a mutation control
    // caught: the first version of this test used 'ZedExams', which is the
    // default, and survived a provider that wiped everything on error.
    act(() => onNext(snapshot({ siteName: 'ZedExams Beta' })))
    act(() => onError(new Error('permission-denied')))
    expect(read('site')).toBe('ZedExams Beta')
  })

  it('but stops claiming they are CURRENT', () => {
    // The half that matters for a rollback: this is now the last thing we
    // heard, not the current value, and a consumer that needs the difference
    // can now see it.
    render(<PlatformSettingsProvider><Probe /></PlatformSettingsProvider>)
    act(() => onNext(snapshot({ featureFlags: { someRollout: true } })))
    expect(read('live')).toBe('true')
    act(() => onError(new Error('permission-denied')))
    expect(read('live')).toBe('false')
    expect(read('loaded')).toBe('true')
  })

  it('an error before any snapshot still resolves the load', () => {
    // Otherwise every consumer waits forever on a read that will never arrive.
    render(<PlatformSettingsProvider><Probe /></PlatformSettingsProvider>)
    act(() => onError(new Error('unavailable')))
    expect(read('loaded')).toBe('true')
    expect(read('live')).toBe('false')
  })

  it('a later snapshot restores the claim', () => {
    // A remount resubscribes. If one ever succeeds again, the read is live
    // again — the flag must not be latched off by a failure it recovered from.
    render(<PlatformSettingsProvider><Probe /></PlatformSettingsProvider>)
    act(() => onError(new Error('unavailable')))
    act(() => onNext(snapshot({ siteName: 'Back' })))
    expect(read('live')).toBe('true')
    expect(read('site')).toBe('Back')
  })
})
