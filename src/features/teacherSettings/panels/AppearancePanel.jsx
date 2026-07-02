import { useState } from 'react'
import { useTheme, THEMES } from '../../../contexts/ThemeContext'
import {
  loadAccessibilityPrefs,
  saveAccessibilityPrefs,
} from '../../../utils/accessibility'
import SettingsDetailShell from '../components/SettingsDetailShell'
import ToggleRow from '../components/fields/ToggleRow'
import OptionCards from '../components/fields/OptionCards'

// Theme + accessibility. Both apply instantly (localStorage-backed), so
// there is no Save bar. The teacher studio surfaces keep their fixed warm
// look — the honest copy below says exactly where the theme applies.
export default function AppearancePanel() {
  const { theme, setTheme } = useTheme()
  const [a11y, setA11y] = useState(loadAccessibilityPrefs)

  const setPref = (key) => (value) => {
    const next = { ...a11y, [key]: value }
    setA11y(next)
    saveAccessibilityPrefs(next)
  }

  return (
    <SettingsDetailShell rowId="appearance">
      <section className="tset-section">
        <h2 className="tset-section__title">Theme</h2>
        <p className="tset-section__hint">
          Applies to the learner and quiz views. Your teacher workspace keeps its
          calm cream look.
        </p>
        <div className="tset-chips">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={theme === t.id}
              className={`tset-chip${theme === t.id ? ' tset-chip--on' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: t.swatch,
                  display: 'inline-block',
                }}
              />
              {t.label}
            </button>
          ))}
        </div>
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
