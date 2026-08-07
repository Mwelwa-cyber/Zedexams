import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Sentry — the SECOND session-replay system.
 *
 * Privacy Policy §4 says we never record a learner's screen. Gating PostHog
 * is only half of that promise: Sentry's replayIntegration with
 * replaysOnErrorSampleRate: 1.0 records any session that hits an error, and
 * learners hit errors. These tests hold Sentry to the same rule, and exist
 * mainly so the integration cannot drift back into the init() call — where it
 * would look entirely reasonable and silently re-record children.
 */

const replayInstance = { stop: vi.fn(), start: vi.fn(), startBuffering: vi.fn() }

// Faithful to the real SDK: Sentry's Replay class is a SINGLETON, and
// constructing a second instance throws. The previous mock allowed unlimited
// re-construction, which is exactly why the sign-out → sign-in cycle bug
// (#2156) passed this suite while throwing on every profile snapshot in
// production.
let replayConstructed = false

const Sentry = {
  init: vi.fn((opts) => { Sentry.__opts = opts }),
  setUser: vi.fn(),
  addIntegration: vi.fn(),
  replayIntegration: vi.fn(() => {
    if (replayConstructed) throw new Error('Multiple Sentry Session Replay instances are not supported')
    replayConstructed = true
    return replayInstance
  }),
  browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })),
  __opts: null,
}

vi.mock('@sentry/react', () => Sentry)

// The re-arm serialises behind the stop's promise chain, so it lands a few
// microtasks after the call that requested it. One macrotask drains them all.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

async function loadSentry() {
  vi.resetModules()
  vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
  const mod = await import('./sentry.js')
  await mod.initSentry()
  return mod
}

beforeEach(() => {
  for (const fn of Object.values(Sentry)) if (typeof fn?.mockClear === 'function') fn.mockClear()
  replayInstance.stop.mockClear()
  replayInstance.startBuffering.mockClear()
  replayConstructed = false
  Sentry.__opts = null
})

afterEach(() => { vi.unstubAllEnvs() })

describe('sentry — replay is not registered at init', () => {
  it('init registers no replay integration', async () => {
    await loadSentry()
    // The failure this guards: adding replayIntegration() back to the
    // integrations array. It buffers frames from the first paint, so a
    // learner erroring on /login is recorded before any role is known.
    expect(Sentry.replayIntegration).not.toHaveBeenCalled()
    const names = Sentry.__opts.integrations.map((i) => i.name)
    expect(names).not.toContain('Replay')
  })

  it('never samples random sessions for replay', async () => {
    await loadSentry()
    expect(Sentry.__opts.replaysSessionSampleRate).toBe(0)
  })
})

describe('sentry — replay follows the same role rule as PostHog', () => {
  it('does not record a learner', async () => {
    const { setSentryUser } = await loadSentry()
    setSentryUser('uid-learner', 'learner')
    expect(Sentry.addIntegration).not.toHaveBeenCalled()
  })

  it('does not record a parent', async () => {
    const { setSentryUser } = await loadSentry()
    setSentryUser('uid-parent', 'parent')
    expect(Sentry.addIntegration).not.toHaveBeenCalled()
  })

  it('does not record a session whose role is not known yet', async () => {
    // AuthContext calls setSentryUser(uid) on auth state change, before the
    // profile read returns. That call must not start a recorder.
    const { setSentryUser } = await loadSentry()
    setSentryUser('uid-unknown')
    expect(Sentry.addIntegration).not.toHaveBeenCalled()
  })

  it('records a teacher', async () => {
    const { setSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    expect(Sentry.addIntegration).toHaveBeenCalledWith(replayInstance)
  })

  it('masks all text and blocks media when it does record', async () => {
    const { setSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    expect(Sentry.replayIntegration).toHaveBeenCalledWith({
      maskAllText: true,
      blockAllMedia: true,
    })
  })

  it('registers the recorder at most once', async () => {
    const { setSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    setSentryUser('uid-teacher', 'teacher')
    expect(Sentry.addIntegration).toHaveBeenCalledTimes(1)
  })
})

describe('sentry — error reporting survives replay problems', () => {
  it('still tags the user when replay registration throws', async () => {
    // Replay is a debugging nicety; error reporting is the reason Sentry is
    // here at all. The former must never cost us the latter.
    Sentry.addIntegration.mockImplementationOnce(() => { throw new Error('nope') })
    const { setSentryUser } = await loadSentry()
    expect(() => setSentryUser('uid-teacher', 'teacher')).not.toThrow()
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'uid-teacher' })
  })
})

describe('sentry — the recorder survives a sign-out (one instance per page load)', () => {
  it('a teacher after a teacher re-ARMS the one instance, never constructs a second', async () => {
    // The live failure: sign-out stopped the recorder and dropped the
    // reference; the next recordable sign-in constructed a second Replay,
    // which the SDK refuses — and because the failure path also dropped the
    // reference, every later profile snapshot retried and threw again. Net
    // effect on zedexams.com: "[sentry] replay registration failed" in a
    // loop, and no session replay at all.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { setSentryUser, clearSentryUser } = await loadSentry()
      setSentryUser('uid-teacher', 'teacher')
      clearSentryUser()
      setSentryUser('uid-teacher-2', 'teacher')
      await flushMicrotasks()

      expect(Sentry.replayIntegration).toHaveBeenCalledTimes(1)
      expect(replayInstance.startBuffering).toHaveBeenCalledTimes(1)
      const warned = warn.mock.calls.some((c) => String(c[0]).includes('replay registration failed'))
      expect(warned, 'the singleton throw must never be reachable').toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('a learner after a teacher does not re-arm the stopped instance', async () => {
    const { setSentryUser, clearSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    clearSentryUser()
    setSentryUser('uid-learner', 'learner')
    await flushMicrotasks()
    expect(replayInstance.startBuffering).not.toHaveBeenCalled()
  })

  it('a repeat role while already recording does not re-arm or re-add', async () => {
    const { setSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    setSentryUser('uid-teacher', 'teacher')
    expect(replayInstance.startBuffering).not.toHaveBeenCalled()
    expect(Sentry.addIntegration).toHaveBeenCalledTimes(1)
  })
})

describe('sentry — the re-arm serialises behind a pending stop', () => {
  it('a quick sign-out → sign-in does not lose the recorder to the stop\'s final flush', async () => {
    // Codex P2 on #2156 (r3733994279): stop() is async — after an error has
    // promoted buffering to session mode it awaits a final flush before
    // destroying the buffer. A startBuffering() issued while that teardown is
    // pending gets torn down WITH it, and replayActive stays true, so nothing
    // ever retries: replay is silently off for the rest of the session.
    let settleStop
    replayInstance.stop.mockImplementationOnce(() => new Promise((res) => { settleStop = res }))
    const { setSentryUser, clearSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    clearSentryUser()                       // stop() begins its final flush
    setSentryUser('uid-teacher-2', 'teacher')

    // The re-arm must WAIT — buffering started now would be destroyed by the
    // teardown still in flight.
    expect(replayInstance.startBuffering).not.toHaveBeenCalled()

    settleStop()
    await flushMicrotasks()
    expect(replayInstance.startBuffering).toHaveBeenCalledTimes(1)
  })

  it('a sign-out while the stop is still settling withdraws the queued re-arm', async () => {
    let settleStop
    replayInstance.stop.mockImplementationOnce(() => new Promise((res) => { settleStop = res }))
    const { setSentryUser, clearSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    clearSentryUser()
    setSentryUser('uid-teacher-2', 'teacher') // queued behind the flush…
    clearSentryUser()                          // …and withdrawn before it lands

    settleStop()
    await flushMicrotasks()
    expect(replayInstance.startBuffering).not.toHaveBeenCalled()
  })
})

describe('sentry — shared devices', () => {
  it('stops the recorder on sign-out', async () => {
    const { setSentryUser, clearSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    clearSentryUser()
    expect(replayInstance.stop).toHaveBeenCalled()
  })

  it('a learner signing in after a teacher is not recorded', async () => {
    const { setSentryUser, clearSentryUser } = await loadSentry()
    setSentryUser('uid-teacher', 'teacher')
    clearSentryUser()
    Sentry.addIntegration.mockClear()
    setSentryUser('uid-learner', 'learner')
    expect(Sentry.addIntegration).not.toHaveBeenCalled()
  })
})

describe('sentry — role arriving before the SDK loads', () => {
  it('applies the role queued before init resolved', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
    const mod = await import('./sentry.js')
    // Buffered: setSentryUser lands before initSentry has resolved.
    mod.setSentryUser('uid-teacher', 'teacher')
    expect(Sentry.addIntegration).not.toHaveBeenCalled()
    await mod.initSentry()
    expect(Sentry.addIntegration).toHaveBeenCalledWith(replayInstance)
  })

  it('does not record a learner queued before init resolved', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
    const mod = await import('./sentry.js')
    mod.setSentryUser('uid-learner', 'learner')
    await mod.initSentry()
    expect(Sentry.addIntegration).not.toHaveBeenCalled()
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'uid-learner' })
  })
})
