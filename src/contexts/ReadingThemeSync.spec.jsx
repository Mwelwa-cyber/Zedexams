/**
 * Cross-browser reading-theme sync.
 *
 * The reported failure, stated as an acceptance criterion: a learner picks a
 * light palette in Chrome, then opens the site in incognito or another
 * browser on the same dark-mode machine and gets Midnight — because that
 * browser has no `examprep:theme` key and resolveInitialTheme seeds from
 * prefers-color-scheme. The account is the only thing that knows better, so
 * these tests pin that it is asked, and that asking it does not break the
 * three things a device-local preference already got right: the OS seed for
 * someone who has genuinely never chosen, a local choice surviving an empty
 * profile, and theming working at all when signed out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const setDoc = vi.fn(() => Promise.resolve())
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ path: `${col}/${id}` }),
  setDoc: (...a) => setDoc(...a),
}))
vi.mock('../firebase/config', () => ({ db: {} }))

const auth = { currentUser: null, userProfile: null }
vi.mock('./AuthContext', () => ({ useAuth: () => auth }))

const { ThemeProvider, useTheme, resetReadingThemePersister } = await import('./ThemeContext')
const ReadingThemeSync = (await import('./ReadingThemeSync')).default

const LS_KEY = 'examprep:theme'

let ctx
function Probe() {
  ctx = useTheme()
  return null
}

function mount() {
  return render(
    <ThemeProvider>
      <ReadingThemeSync />
      <Probe />
    </ThemeProvider>,
  )
}

/**
 * The OS colour scheme. jsdom has no matchMedia, and the seeding path this
 * bug lives on reads exactly one query — so every test states what the
 * machine is asking for rather than inheriting a default.
 */
function setOsDark(dark) {
  window.matchMedia = (query) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
}

beforeEach(() => {
  localStorage.clear()
  resetReadingThemePersister()
  setDoc.mockClear()
  setDoc.mockImplementation(() => Promise.resolve())
  auth.currentUser = null
  auth.userProfile = null
  setOsDark(false)
  ctx = undefined
})

afterEach(() => {
  localStorage.clear()
  resetReadingThemePersister()
})

describe('ReadingThemeSync', () => {
  /*
   * The regression this file exists to prevent a second time. Asserting the
   * applied theme is what pins it — the bug was never in what the picker
   * saved, it was in this browser never being told the account had an answer.
   */
  it('applies the account theme instead of the dark-OS seed in a fresh browser', async () => {
    // Incognito: no saved key at all, on a machine whose OS asks for dark.
    setOsDark(true)
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { readingTheme: 'oatmeal' } }

    mount()

    await waitFor(() => expect(ctx?.theme).toBe('oatmeal'))
    // And the browser is left able to paint it pre-paint next time, so the
    // account theme is applied once rather than a frame late on every load.
    expect(localStorage.getItem(LS_KEY)).toBe('oatmeal')
  })

  it('applies the account theme over a stale local value', async () => {
    localStorage.setItem(LS_KEY, 'solar')
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { readingTheme: 'midnight' } }

    mount()

    await waitFor(() => expect(ctx?.theme).toBe('midnight'))
    expect(localStorage.getItem(LS_KEY)).toBe('midnight')
  })

  it('does not write back the value it just read', async () => {
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { readingTheme: 'sky' } }

    mount()

    await waitFor(() => expect(ctx?.theme).toBe('sky'))
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('merge-writes a new choice to the profile', async () => {
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { readingTheme: 'oatmeal' } }
    mount()

    await waitFor(() => expect(ctx).toBeTruthy())
    ctx.setTheme('midnight')

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, payload, options] = setDoc.mock.calls[0]
    expect(ref.path).toBe('users/u1')
    expect(payload).toEqual({ preferences: { readingTheme: 'midnight' } })
    // Merge, or this write erases every sibling field on the profile —
    // including preferences.theme, the teacher workspace palette.
    expect(options).toEqual({ merge: true })
  })

  it('adopts an existing device choice when the profile has none', async () => {
    // Every learner who set a theme before this shipped is in exactly this
    // state. Without the backfill the fix stays inert for all of them.
    localStorage.setItem(LS_KEY, 'oatmeal')
    setOsDark(true)
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: {} }

    mount()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect(setDoc.mock.calls[0][1]).toEqual({ preferences: { readingTheme: 'oatmeal' } })
    // Nothing was applied — the device already had it.
    expect(ctx.theme).toBe('oatmeal')
  })

  it('never promotes the OS seed to the account', async () => {
    // No saved key: 'midnight' here is the prefers-color-scheme seed, not an
    // answer. Writing it up would make one visit on a dark-mode machine the
    // permanent answer on every browser the learner owns.
    setOsDark(true)
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: {} }

    mount()

    await waitFor(() => expect(ctx?.theme).toBe('midnight'))
    await Promise.resolve()
    expect(setDoc).not.toHaveBeenCalled()
    expect(localStorage.getItem(LS_KEY)).toBe(null)
  })

  it('leaves a local choice alone while the profile is still loading', async () => {
    // userProfile is null until the snapshot lands. Backfilling in that
    // window would overwrite an account theme not yet read.
    localStorage.setItem(LS_KEY, 'solar')
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = null

    mount()

    await waitFor(() => expect(ctx?.theme).toBe('solar'))
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('applies and stores the choice even when signed out', async () => {
    mount()
    await waitFor(() => expect(ctx).toBeTruthy())
    ctx.setTheme('midnight')

    await waitFor(() => expect(ctx.theme).toBe('midnight'))
    expect(localStorage.getItem(LS_KEY)).toBe('midnight')
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('keeps the theme applied when the profile write fails', async () => {
    setDoc.mockRejectedValueOnce(new Error('offline'))
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { readingTheme: 'oatmeal' } }
    mount()

    await waitFor(() => expect(ctx).toBeTruthy())
    ctx.setTheme('midnight')

    await waitFor(() => expect(setDoc).toHaveBeenCalled())
    // The choice is local-first: a failed sync must not roll back the UI.
    expect(ctx.theme).toBe('midnight')
    expect(localStorage.getItem(LS_KEY)).toBe('midnight')
  })

  it('does not let one account inherit the previous account theme on sign-out', async () => {
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { readingTheme: 'midnight' } }
    const first = mount()
    await waitFor(() => expect(ctx?.theme).toBe('midnight'))
    first.unmount()

    // A second learner signs in on the same device; their account says sky.
    auth.currentUser = { uid: 'u2' }
    auth.userProfile = { preferences: { readingTheme: 'sky' } }
    mount()

    await waitFor(() => expect(ctx?.theme).toBe('sky'))
  })
})
