/**
 * Cross-device theme sync.
 *
 * Acceptance criterion: signing in on a second device applies the theme
 * saved on the account and overrides a stale local value. The inverse
 * matters just as much and is easier to get wrong — a profile that has never
 * recorded a theme must not reset a choice made on this device, and
 * hydrating from the profile must not echo straight back as a write.
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

const { ThemeProvider, useTheme } = await import('./ThemeContext')
const { resetTeacherThemeStore } = await import('./teacherThemeStore')
const { TEACHER_THEME_STORAGE_KEY } = await import('./teacherThemeCore')
const TeacherThemeSync = (await import('./TeacherThemeSync')).default
const useDashboardTheme = (await import('../features/teacherShell/hooks/useDashboardTheme')).default

let ctx
function Probe() {
  ctx = useTheme()
  return null
}

// The dashboard's light/dark toggle. It reads the module store directly and
// never touches ThemeProvider — which is the whole reason it was able to
// bypass persistence — so the probe for it has to be the real hook.
let dash
function DashboardProbe() {
  dash = useDashboardTheme()
  return null
}

function mount() {
  return render(
    <ThemeProvider>
      <TeacherThemeSync />
      <Probe />
      <DashboardProbe />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetTeacherThemeStore()
  document.documentElement.removeAttribute('data-theme')
  setDoc.mockClear()
  auth.currentUser = null
  auth.userProfile = null
})

afterEach(() => {
  localStorage.clear()
  resetTeacherThemeStore()
})

describe('TeacherThemeSync', () => {
  it('applies the profile theme over a stale local value on a new device', async () => {
    // This device was last used on Miombo; the account says Night.
    localStorage.setItem(TEACHER_THEME_STORAGE_KEY, 'miombo')
    resetTeacherThemeStore()
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { theme: 'night' } }

    mount()

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    })
    expect(localStorage.getItem(TEACHER_THEME_STORAGE_KEY)).toBe('night')
  })

  it('does not write back the value it just read', async () => {
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { theme: 'copperbelt' } }

    mount()

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('copperbelt')
    })
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('leaves a local choice alone when the profile has no theme yet', async () => {
    localStorage.setItem(TEACHER_THEME_STORAGE_KEY, 'copperbelt')
    resetTeacherThemeStore()
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: {} }

    mount()

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('copperbelt')
    })
  })

  it('merge-writes a new choice to the profile', async () => {
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { theme: 'terracotta' } }
    mount()

    await waitFor(() => expect(ctx).toBeTruthy())
    ctx.setTeacherTheme('miombo')

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, payload, options] = setDoc.mock.calls[0]
    expect(ref.path).toBe('users/u1')
    expect(payload).toEqual({ preferences: { theme: 'miombo' } })
    // Merge, or this write erases every sibling field on the profile.
    expect(options).toEqual({ merge: true })
  })

  it('applies and stores the choice even when signed out', async () => {
    mount()
    await waitFor(() => expect(ctx).toBeTruthy())
    ctx.setTeacherTheme('night')

    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    expect(localStorage.getItem(TEACHER_THEME_STORAGE_KEY)).toBe('night')
    expect(setDoc).not.toHaveBeenCalled()
  })

  /*
   * The regression this file exists to prevent a second time.
   *
   * The dashboard light/dark toggle is a SECOND write path, separate from the
   * settings picker, and it used to persist to the device only. The profile
   * kept the old value, so the next load applied the new one pre-paint and
   * then hydrated the old one back over it: a teacher turned dark mode off,
   * reloaded, and the app was dark again. Asserting the write is what pins it
   * — asserting the applied theme would have passed throughout, because the
   * bug was never in what the toggle applied.
   */
  it('persists a dark-mode toggle to the profile, not just to the device', async () => {
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { theme: 'night' } }
    mount()

    await waitFor(() => expect(dash?.dark).toBe(true))
    dash.toggleTheme()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, payload, options] = setDoc.mock.calls[0]
    expect(ref.path).toBe('users/u1')
    expect(payload.preferences.theme).not.toBe('night')
    expect(options).toEqual({ merge: true })
  })

  it('survives the reload that used to undo it', async () => {
    // Signed in on Night, the teacher toggles to light.
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { theme: 'night' } }
    const first = mount()

    await waitFor(() => expect(dash?.dark).toBe(true))
    dash.toggleTheme()
    await waitFor(() => expect(setDoc).toHaveBeenCalled())

    const chosen = setDoc.mock.calls[0][1].preferences.theme
    first.unmount()

    // Reload: the module store is rebuilt from localStorage, and the profile
    // now carries what the toggle wrote rather than the value it replaced.
    resetTeacherThemeStore()
    auth.userProfile = { preferences: { theme: chosen } }
    mount()

    await waitFor(() => expect(dash).toBeTruthy())
    expect(document.documentElement.getAttribute('data-theme')).toBe(chosen)
    expect(dash.dark).toBe(false)
  })

  it('keeps the theme applied when the profile write fails', async () => {
    setDoc.mockRejectedValueOnce(new Error('offline'))
    auth.currentUser = { uid: 'u1' }
    auth.userProfile = { preferences: { theme: 'terracotta' } }
    mount()

    await waitFor(() => expect(ctx).toBeTruthy())
    ctx.setTeacherTheme('miombo')

    await waitFor(() => expect(setDoc).toHaveBeenCalled())
    // The choice is local-first: a failed sync must not roll back the UI.
    expect(document.documentElement.getAttribute('data-theme')).toBe('miombo')
  })
})
