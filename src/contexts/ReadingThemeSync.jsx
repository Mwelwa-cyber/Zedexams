import { useCallback, useEffect, useRef } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from './AuthContext'
import {
  readStoredThemeChoice,
  resolveReadingThemeConflict,
  shouldPersistReadingTheme,
  useTheme,
} from './ThemeContext'

/**
 * Binds the learner READING theme to the signed-in profile
 * (users/{uid}.preferences.readingTheme). The twin of <TeacherThemeSync />
 * for the other palette set, and it exists for the same reason that one is a
 * component rather than logic inside the provider: main.jsx mounts
 * <ThemeProvider> ABOVE <AuthProvider>, so the theme layer cannot call
 * useAuth(). Mounting this inside the router (App.jsx) puts it below both.
 *
 * THE BUG THIS CLOSES
 * -------------------
 * The reading theme was a device-only preference — one `examprep:theme` key
 * in localStorage and nothing on the account. On its own that is defensible;
 * combined with the prefers-color-scheme seeding in resolveInitialTheme it is
 * not, because the two together mean a learner's theme is decided by whichever
 * of the two happens to be present:
 *
 *   Chrome (has the key)                 → the theme they picked
 *   Incognito / another browser (no key) → the OS setting, i.e. Midnight
 *
 * So a learner on a dark-mode laptop who deliberately reads on a light palette
 * got a dark one everywhere except the one browser they first chose it in, and
 * re-picking there fixed nothing anywhere else. The account knew who they were
 * the whole time and simply was not being asked. It is now: the profile is the
 * answer, localStorage is a cache of it, and the OS seed is what a visitor who
 * has genuinely never chosen still gets.
 *
 * Renders nothing.
 */
export default function ReadingThemeSync() {
  const { currentUser, userProfile } = useAuth()
  const { theme, hydrateTheme, registerReadingThemePersister } = useTheme()

  const uid = currentUser?.uid || null
  const profileTheme = userProfile?.preferences?.readingTheme
  /*
   * The MODE is the field that actually closes the "it came back" loop.
   * `readingTheme` alone records WHICH palette; it cannot record that the
   * choice was deliberate, so a browser that had never seen this account
   * asked the operating system instead — and, the seed never being written,
   * asked it again on every cold start. `readingThemeMode` is the answer;
   * `readingLightTheme` is which light palette that answer means.
   */
  const profileMode = userProfile?.preferences?.readingThemeMode
  const profileLight = userProfile?.preferences?.readingLightTheme
  // Distinguishing "no profile loaded yet" from "profile loaded, no theme on
  // it" is load-bearing for the backfill below — writing this device's value
  // during the loading window would overwrite an account theme we simply had
  // not read yet.
  const profileLoaded = Boolean(userProfile)

  /*
   * A merge write, so it creates `preferences` if the profile predates it and
   * never disturbs a sibling preference — the teacher workspace theme lives
   * at preferences.theme and must survive this write untouched.
   *
   * We deliberately do NOT go through AuthContext's updateProfileFields: that
   * helper merges the written keys into local profile state, and a dotted
   * path would land as a literal "preferences.readingTheme" key on the
   * in-memory object. The profile snapshot listener brings the real value
   * back anyway.
   */
  const persist = useCallback(async (next, current) => {
    if (!uid) return
    const { theme: nextTheme, mode: nextMode, light: nextLight } = next || {}
    if (!shouldPersistReadingTheme({
      nextTheme,
      nextMode,
      nextLight,
      profileTheme: current?.theme,
      profileMode: current?.mode,
      profileLight: current?.light,
    })) return
    try {
      await setDoc(
        doc(db, 'users', uid),
        {
          preferences: {
            readingTheme: nextTheme,
            readingThemeMode: nextMode,
            readingLightTheme: nextLight,
          },
        },
        { merge: true },
      )
    } catch {
      // A failed write must not break theming — the choice is already applied
      // and saved on this device, so it survives a reload here and simply
      // doesn't follow the learner to another browser yet.
    }
  }, [uid])

  // Register the writer that setTheme calls on every deliberate choice.
  useEffect(() => {
    if (!uid) return undefined
    return registerReadingThemePersister((next) => {
      persist(next, { theme: profileTheme, mode: profileMode, light: profileLight })
    })
  }, [uid, profileTheme, profileMode, profileLight, persist, registerReadingThemePersister])

  /*
   * Profile wins over a stale local value — but ONCE, at sign-in.
   *
   * Reconciling on every profile change instead looks equivalent and is not:
   * between a learner picking a theme and the profile snapshot carrying it
   * back, the profile still holds the OLD value, so this effect reads
   * local≠profile and reverts the choice they just made. Firestore's
   * optimistic local cache usually hides that behind a flicker; when the
   * write genuinely fails (offline past the cache, rules rejection) the
   * revert is permanent and the Night toggle looks broken.
   *
   * So: hydrate the first time a real theme is seen for a uid, then let local
   * choices win and flow upward. Both refs reset on sign-out so the next
   * account resolves on its own terms — which matters on the shared school
   * devices this app runs on, where the previous learner's palette is exactly
   * the stale local value that must not stick.
   */
  const hydratedForUid = useRef(null)
  const backfilledForUid = useRef(null)

  useEffect(() => {
    if (!uid) {
      hydratedForUid.current = null
      backfilledForUid.current = null
      return
    }
    if (hydratedForUid.current === uid) return
    const { theme: resolved, mode, light, source } = resolveReadingThemeConflict({
      profileTheme,
      profileMode,
      profileLight,
      localTheme: theme,
    })

    if (source === 'profile') {
      hydratedForUid.current = uid
      // Applied even when the palette matches: the account may be carrying a
      // MODE this device has not recorded, and adopting it is the whole point
      // — it is what stops this browser asking the OS on the next cold start.
      hydrateTheme({ theme: resolved, mode, light })
      return
    }

    /*
     * The profile has no reading theme. That is "not answered", not "answered
     * with the default", so nothing is applied — but if this device holds a
     * REAL saved choice, adopt it as the account's answer so it reaches every
     * other browser.
     *
     * Without this the fix would be inert for every learner who already has
     * one: their profile field is empty, so nothing syncs until the day they
     * happen to open the picker again — which is precisely the "I already set
     * this and it still opens dark elsewhere" complaint.
     *
     * readStoredThemeChoice(), not the live `theme`, is what may be adopted.
     * The live value is never empty: on a browser that has never saved
     * anything it is the prefers-color-scheme seed, and promoting that to the
     * account would turn one visit on a dark-mode machine into a permanent
     * dark answer on every device the learner owns — the exact bug being
     * fixed, re-introduced from the other end.
     *
     * Shared-device note: a school machine where the previous learner chose
     * Midnight will hand that value to the next account that signs in with an
     * empty profile. It is the palette they would have been shown on that
     * machine either way (a local choice already wins over the seed), so this
     * changes how far the value travels, not what they see here — and the
     * picker overrides it in one tap.
     */
    if (!profileLoaded) return
    if (backfilledForUid.current === uid) return
    const stored = readStoredThemeChoice()
    if (!stored) return
    backfilledForUid.current = uid
    persist(stored, { theme: profileTheme, mode: profileMode, light: profileLight })
  }, [uid, profileTheme, profileMode, profileLight, profileLoaded, theme, hydrateTheme, persist])

  return null
}
