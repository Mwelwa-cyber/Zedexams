import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * analytics — the PostHog wiring, as distinct from the policy decision.
 *
 * analyticsPolicy.test.js proves the DECISION is right. These prove the SDK
 * is actually driven by it, which is the half that a refactor breaks
 * silently: a policy object that is computed, logged, and then not applied
 * looks identical in review to one that is enforced.
 *
 * The module reads VITE_POSTHOG_KEY at import time and lazily imports
 * posthog-js, so each test stubs the env, resets the module registry, and
 * imports fresh — otherwise the module-level instance leaks between cases
 * and the second test observes the first test's decisions.
 */

const posthog = {
  init: vi.fn((_key, opts) => { posthog.__opts = opts; opts?.loaded?.(posthog) }),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
  set_config: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  __opts: null,
}

/**
 * The last value posthog.set_config() was given for a key, or undefined if it
 * was never set. applyPolicy sends heatmaps and surveys through set_config,
 * and "the most recent call wins" is the semantics the SDK itself has.
 */
function lastConfig(key) {
  for (let i = posthog.set_config.mock.calls.length - 1; i >= 0; i -= 1) {
    const arg = posthog.set_config.mock.calls[i][0]
    if (arg && key in arg) return arg[key]
  }
  return undefined
}

vi.mock('posthog-js', () => ({ default: posthog }))

async function loadAnalytics() {
  vi.resetModules()
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
  const consent = await import('./analyticsConsent.js')
  consent.setConsent(consent.CONSENT_ACCEPTED)
  const analytics = await import('./analytics.js')
  analytics.initAnalytics()
  // loadPostHog() is async (dynamic import); let it settle.
  await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled())
  return analytics
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(posthog)) if (typeof fn?.mockClear === 'function') fn.mockClear()
  posthog.has_opted_out_capturing.mockReturnValue(false)
  posthog.__opts = null
})

afterEach(() => { vi.unstubAllEnvs() })

describe('analytics — session replay is off until a role permits it', () => {
  it('initialises with recording disabled and inputs masked', async () => {
    await loadAnalytics()
    const opts = posthog.__opts
    // Disabled AT INIT, not stopped afterwards: the pre-sign-in screens a
    // child types on (/login, /register) must never be captured at all.
    expect(opts.disable_session_recording).toBe(true)
    expect(opts.session_recording.maskAllInputs).toBe(true)
    expect(opts.session_recording.maskInputOptions.password).toBe(true)
  })

  it('never starts recording for a signed-out visitor', async () => {
    await loadAnalytics()
    expect(posthog.startSessionRecording).not.toHaveBeenCalled()
  })

  it('starts recording once a teacher is known', async () => {
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-teacher', 'teacher')
    expect(posthog.startSessionRecording).toHaveBeenCalled()
  })

  it('leaves recording stopped for a learner', async () => {
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-learner', 'learner')
    expect(posthog.startSessionRecording).not.toHaveBeenCalled()
    expect(posthog.stopSessionRecording).toHaveBeenCalled()
  })
})

describe('analytics — a learner is never named to PostHog', () => {
  it('does not call identify for a learner', async () => {
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-learner', 'learner')
    expect(posthog.identify).not.toHaveBeenCalled()
  })

  it('does not leak the uid through any other call for a learner', async () => {
    // The uid is the whole identifier — if it reaches PostHog by any route
    // (register, capture properties) the "anonymous counts" claim is false.
    const { identifyUser, capture } = await loadAnalytics()
    identifyUser('uid-learner', 'learner')
    capture('quiz_completed', { quizId: 'q1' })
    const everySentArg = [...posthog.register.mock.calls, ...posthog.capture.mock.calls]
    expect(JSON.stringify(everySentArg)).not.toContain('uid-learner')
  })

  it('does identify a teacher, with role only', async () => {
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-teacher', 'teacher')
    expect(posthog.identify).toHaveBeenCalledWith('uid-teacher', { role: 'teacher' })
  })

  it('still records anonymous learner events', async () => {
    const { identifyUser, capture } = await loadAnalytics()
    identifyUser('uid-learner', 'learner')
    capture('quiz_completed', { quizId: 'q1' })
    expect(posthog.capture).toHaveBeenCalledWith('quiz_completed', { quizId: 'q1' })
  })
})

describe('analytics — replay is not the only recorder', () => {
  // Heatmaps and surveys are separate PostHog subsystems whose client config
  // defaults to the PostHog PROJECT's setting, and this project has both
  // enabled. So "we didn't configure it" meant "it is on for every learner",
  // and the only place that was visible was the vendor's dashboard. These
  // assertions fail if either switch drifts back to unset.
  it('initialises with heatmap collection and surveys off', async () => {
    await loadAnalytics()
    expect(posthog.__opts.capture_heatmaps).toBe(false)
    expect(posthog.__opts.disable_surveys).toBe(true)
  })

  it('leaves both off for a learner', async () => {
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-learner', 'learner')
    expect(lastConfig('capture_heatmaps')).toBe(false)
    expect(lastConfig('disable_surveys')).toBe(true)
  })

  it('leaves both off for a signed-out visitor', async () => {
    await loadAnalytics()
    // Nothing has identified yet — the /login and /register screens a child
    // types on are exactly this state.
    expect(lastConfig('capture_heatmaps')).not.toBe(true)
    expect(lastConfig('disable_surveys')).not.toBe(false)
  })

  it('turns both on once a teacher is known', async () => {
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-teacher', 'teacher')
    expect(lastConfig('capture_heatmaps')).toBe(true)
    expect(lastConfig('disable_surveys')).toBe(false)
  })

  it('turns both back off when a teacher signs out', async () => {
    const { identifyUser, resetAnalytics } = await loadAnalytics()
    identifyUser('uid-teacher', 'teacher')
    resetAnalytics()
    expect(lastConfig('capture_heatmaps')).toBe(false)
    expect(lastConfig('disable_surveys')).toBe(true)
  })

  it('every switch in the policy object reaches the SDK', async () => {
    // The failure this catches is a new observation switch being added to
    // analyticsPolicy and then never applied — a policy that is computed,
    // logged and ignored reviews identically to one that is enforced.
    const { identifyUser } = await loadAnalytics()
    const { FULL_POLICY } = await import('./analyticsPolicy.js')
    identifyUser('uid-teacher', 'teacher')
    const applied = {
      identify: posthog.identify.mock.calls.length > 0,
      sessionRecording: posthog.startSessionRecording.mock.calls.length > 0,
      heatmaps: lastConfig('capture_heatmaps'),
      surveys: lastConfig('disable_surveys') === false,
      geoip: posthog.register.mock.calls.at(-1)?.[0]?.$geoip_disable === false,
      capture: true,
    }
    for (const key of Object.keys(FULL_POLICY)) {
      expect(applied[key], `policy key "${key}" is never applied to the SDK`).toBe(true)
    }
  })
})

describe('analytics — consent withdrawn and given again', () => {
  it('re-applies the policy when the SDK singleton is already loaded', async () => {
    // posthog-js is a module singleton and init() early-returns once loaded,
    // WITHOUT running loaded(). A decline-then-accept cycle therefore used to
    // leave the previous user's observation settings in force.
    const consent = await import('./analyticsConsent.js')
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-teacher', 'teacher')

    consent.setConsent(consent.CONSENT_DECLINED)
    expect(lastConfig('capture_heatmaps')).toBe(false)

    // Now the SDK is loaded but our reference was dropped; re-accepting must
    // not resume the teacher's treatment for whoever is at the keyboard.
    posthog.init.mockImplementationOnce(() => undefined) // already-loaded path
    posthog.has_opted_out_capturing.mockReturnValue(true)
    posthog.set_config.mockClear()
    consent.setConsent(consent.CONSENT_ACCEPTED)

    await vi.waitFor(() => expect(posthog.set_config).toHaveBeenCalled())
    expect(lastConfig('capture_heatmaps')).toBe(false)
    expect(lastConfig('disable_surveys')).toBe(true)
    expect(posthog.startSessionRecording).not.toHaveBeenCalledTimes(2)
    expect(posthog.opt_in_capturing).toHaveBeenCalled()
  })
})

describe('analytics — IP geolocation', () => {
  it('suppresses geoip for a learner and allows it for a teacher', async () => {
    const { identifyUser } = await loadAnalytics()
    identifyUser('uid-learner', 'learner')
    expect(posthog.register).toHaveBeenCalledWith({ $geoip_disable: true })
    posthog.register.mockClear()
    identifyUser('uid-teacher', 'teacher')
    expect(posthog.register).toHaveBeenCalledWith({ $geoip_disable: false })
  })
})

describe('analytics — shared devices', () => {
  it('stops recording before rotating identity on sign-out', async () => {
    // On a shared school phone the next user may be a learner. Recording has
    // to stop BEFORE reset(), or the first frames of the next session are
    // captured under the old permission.
    const { identifyUser, resetAnalytics } = await loadAnalytics()
    identifyUser('uid-teacher', 'teacher')
    posthog.stopSessionRecording.mockClear()
    resetAnalytics()
    expect(posthog.stopSessionRecording).toHaveBeenCalled()
    const stopOrder = posthog.stopSessionRecording.mock.invocationCallOrder[0]
    const resetOrder = posthog.reset.mock.invocationCallOrder.at(-1)
    expect(stopOrder).toBeLessThan(resetOrder)
  })

  it('a learner signing in after a teacher does not inherit recording', async () => {
    const { identifyUser, resetAnalytics } = await loadAnalytics()
    identifyUser('uid-teacher', 'teacher')
    resetAnalytics()
    posthog.startSessionRecording.mockClear()
    identifyUser('uid-learner', 'learner')
    expect(posthog.startSessionRecording).not.toHaveBeenCalled()
  })
})
