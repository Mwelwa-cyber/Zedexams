import { useState } from 'react'
import { useTheme } from '../../../contexts/ThemeContext'
import { capture } from '../../../utils/analytics'
import {
  loadAccessibilityPrefs,
  saveAccessibilityPrefs,
} from '../../../utils/accessibility'
import SettingsDetailShell from '../components/SettingsDetailShell'
import ToggleRow from '../components/fields/ToggleRow'
import OptionCards from '../components/fields/OptionCards'
import ThemeCards from '../components/fields/ThemeCards'

// Theme + accessibility. Everything here applies instantly, so there is no
// Save bar.
//
// ONE theme control, since 2026-07. The reading theme (the learner note
// reader and quiz runner palette) used to be offered here too, which meant
// the only place to change it was the one page it does not colour — a
// teacher picked a palette and nothing on screen moved. It now lives in the
// reader and quiz toolbars, where the change is visible the moment it is
// made. It is a per-device preference and always was; nothing a teacher sets
// here has ever reached a learner's screen.
export default function AppearancePanel() {
  const { teacherTheme, setTeacherTheme, teacherThemes } = useTheme()
  const [a11y, setA11y] = useState(loadAccessibilityPrefs)

  const setPref = (key) => (value) => {
    const next = { ...a11y, [key]: value }
    setA11y(next)
    saveAccessibilityPrefs(next)
  }

  // Recorded here, not in the theme provider: the provider also resolves a
  // theme on every page load and hydrates one from the signed-in profile, and
  // neither of those is someone choosing a theme.
  const chooseTeacherTheme = (next) => {
    if (next === teacherTheme) return
    capture('workspace_theme_selected', { theme: next, previous_theme: teacherTheme })
    setTeacherTheme(next)
  }

  return (
    <SettingsDetailShell rowId="appearance">
      <section className="tset-section">
        <h2 className="tset-section__title">Workspace theme</h2>
        <p className="tset-section__hint">
          Colours your dashboard and studios. Saved to your account, so it
          follows you to any device you sign in on. Printed and exported
          documents are unaffected — they always print on white.
        </p>
        <ThemeCards
          label="Workspace theme"
          value={teacherTheme}
          onChange={chooseTeacherTheme}
          options={teacherThemes}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Display & motion</h2>
        <ToggleRow
          title="Reduce motion"
          hint="Minimise animations across ZedExams."
          checked={a11y.reducedMotion}
          onChange={setPref('reducedMotion')}
        />
        <ToggleRow
          title="High contrast"
          hint="Stronger colours and outlines for readability."
          checked={a11y.highContrast}
          onChange={setPref('highContrast')}
        />
        <div style={{ paddingTop: 12 }}>
          <p className="studio-label" style={{ marginBottom: 8 }}>Text size</p>
          <OptionCards
            label="Text size"
            value={a11y.fontScale}
            onChange={setPref('fontScale')}
            options={[
              { value: 'small', title: 'Small' },
              { value: 'medium', title: 'Medium' },
              { value: 'large', title: 'Large' },
            ]}
          />
        </div>
      </section>
    </SettingsDetailShell>
  )
}
