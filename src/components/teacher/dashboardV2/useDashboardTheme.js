import { useCallback } from 'react'
import { DARK_TEACHER_THEME_IDS, DEFAULT_TEACHER_THEME } from '../../../contexts/teacherThemeCore'
import { useTeacherThemeValue, writeTeacherTheme } from '../../../contexts/teacherThemeStore'

const DARK_THEME = DARK_TEACHER_THEME_IDS[0]
const LAST_LIGHT_KEY = 'zedexams:tdv2-last-light-theme'

/**
 * Light/dark for the V2 dashboard surfaces, toggled from the account menu.
 *
 * This used to be a per-device boolean in its own `zedexams:tdv2-theme` key,
 * deliberately independent of the app's theme layer. It cannot stay that way
 * now that Night is one of the four selectable workspace themes: two
 * independent switches over the same pixels means a teacher can hold Night in
 * Settings and Light here, and get Night's dark tokens rendered underneath
 * light-mode overrides. So `dark` is now DERIVED from the active theme —
 * there is one value, and the toggle is a shortcut into it.
 *
 * Toggling back out of Night returns to the light theme the teacher was last
 * on, not a hardcoded default: someone who set Copperbelt and then tried dark
 * for an evening should get Copperbelt back, not Terracotta.
 */
export default function useDashboardTheme() {
  const theme = useTeacherThemeValue()
  const dark = DARK_TEACHER_THEME_IDS.includes(theme)

  const toggleTheme = useCallback(() => {
    if (DARK_TEACHER_THEME_IDS.includes(theme)) {
      let back = DEFAULT_TEACHER_THEME
      try {
        const saved = localStorage.getItem(LAST_LIGHT_KEY)
        if (saved && !DARK_TEACHER_THEME_IDS.includes(saved)) back = saved
      } catch { /* storage unavailable — the default is a safe landing */ }
      writeTeacherTheme(back)
      return
    }
    try { localStorage.setItem(LAST_LIGHT_KEY, theme) } catch { }
    writeTeacherTheme(DARK_THEME)
  }, [theme])

  return { theme: dark ? 'dark' : 'light', dark, toggleTheme }
}
