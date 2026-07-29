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

let ctx
function Probe() {
  ctx = useTheme()
  return null
}

function mount() {
  return render(
    <ThemeProvider>
      <TeacherThemeSync />
      <Probe />
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
