import { useEffect, useRef } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from './AuthContext'
import { useTheme } from './ThemeContext'
import { resolveThemeConflict, shouldPersistTheme } from './teacherThemeCore'

/**
 * Binds the teacher workspace theme to the signed-in profile.
 *
 * This is a separate component rather than logic inside ThemeProvider
 * because main.jsx mounts <ThemeProvider> ABOVE <AuthProvider> — the theme
 * layer cannot call useAuth(). Mounting this inside the router (App.jsx)
 * puts it below both providers, so it can read auth and drive theme without
 * either one depending on the other.
 *
 * Renders nothing.
 */
export default function TeacherThemeSync() {
  const { currentUser, userProfile } = useAuth()
  const { teacherTheme, hydrateTeacherTheme, registerTeacherThemePersister } = useTheme()

  const uid = currentUser?.uid || null
  const profileTheme = userProfile?.preferences?.theme

  // Register the writer. A merge write, so it creates `preferences` if the
  // profile predates it and never disturbs a sibling preference.
  //
  // We deliberately do NOT go through AuthContext's updateProfileFields: that
  // helper merges the written keys into local profile state, and a dotted
  // path would land as a literal "preferences.theme" key on the in-memory
  // object. The profile snapshot listener brings the real value back anyway.
  useEffect(() => {
    if (!uid) return undefined
    return registerTeacherThemePersister(async (nextTheme) => {
      if (!shouldPersistTheme({ nextTheme, profileTheme })) return
      try {
        await setDoc(
          doc(db, 'users', uid),
          { preferences: { theme: nextTheme } },
          { merge: true },
        )
      } catch {
        // A failed write must not break theming — the choice is already
        // applied and saved on this device, so it survives a reload here and
        // simply doesn't follow the teacher to another device yet.
      }
    })
  }, [uid, profileTheme, registerTeacherThemePersister])

  /*
   * Profile wins over a stale localStorage value — but ONCE, at sign-in.
   *
   * Reconciling on every profile change instead looks equivalent and is not:
   * between a teacher picking a theme and the profile snapshot carrying it
   * back, the profile still holds the OLD value, so this effect reads
   * local≠profile and reverts the choice the teacher just made. Firestore's
   * optimistic local cache usually hides that behind a flicker; when the
   * write genuinely fails (offline past the cache, rules rejection) the
   * revert is permanent and the picker looks broken.
   *
   * So: hydrate the first time a real theme is seen for a uid, then let
   * local choices win and flow upward. The ref resets on sign-out so the
   * next account hydrates on its own terms.
   */
  const hydratedForUid = useRef(null)

  useEffect(() => {
    if (!uid) {
      hydratedForUid.current = null
      return
    }
    if (hydratedForUid.current === uid) return
    const { theme, source } = resolveThemeConflict({
      profileTheme,
      localTheme: teacherTheme,
    })
    // A profile with no theme yet is "not answered", not "answered with the
    // default" — leave the device's choice alone and stay unhydrated so the
    // real value still lands if it arrives in a later snapshot.
    if (source !== 'profile') return
    hydratedForUid.current = uid
    if (theme !== teacherTheme) hydrateTeacherTheme(theme)
  }, [uid, profileTheme, teacherTheme, hydrateTeacherTheme])

  return null
}
