// Personalisation panel — global ZedExams theme + the learner-scoped look-and-feel
// prefs (accent, card style, nav, dashboard layout, background). The Settings
// shell reads learnerSettings.personalisation live and applies data-accent /
// data-card-style / data-nav to the root, so committing here previews instantly.

import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { useTheme, THEMES, DEFAULT_THEME } from '../../../contexts/ThemeContext'
import { Panel, Section, Toggle, OptionCards, Note } from '../components/ui'
import {
  normalizePersonalisation,
  ACCENT_OPTIONS,
  CARD_STYLE_OPTIONS,
  NAV_STYLE_OPTIONS,
  DASHBOARD_LAYOUT_OPTIONS,
  BACKGROUND_OPTIONS,
} from '../lib/learnerPrefs'

export default function PersonalisationPanel({ section }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()
  const { theme, setTheme } = useTheme()

  const ps = normalizePersonalisation(userProfile?.learnerSettings?.personalisation)

  // Merge one personalisation key and persist the whole normalized object.
  const set = (key, value) =>
    commit({ 'learnerSettings.personalisation': { ...ps, [key]: value } })

  const isDark = theme === 'midnight'
  const onDarkMode = (value) => {
    setTheme(value ? 'midnight' : DEFAULT_THEME)
    set('darkMode', value)
  }

  return (
    <Panel section={section}>
      <Note tone="accent">
        Every change previews live and saves automatically — no need to hit save.
      </Note>

      <Section title="Theme" hint="Your global ZedExams colour palette. Applies everywhere.">
        <div className="lset-chips">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`lset-chip${theme === t.id ? ' lset-chip--on' : ''}`}
              aria-pressed={theme === t.id}
              onClick={() => setTheme(t.id)}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                  background: t.swatch, marginRight: 7, verticalAlign: 'middle',
                  border: '1px solid rgba(0,0,0,.15)',
                }}
              />
              {t.label}
            </button>
          ))}
        </div>
        <Toggle
          title="Dark mode"
          hint="Switch to the Midnight Tech palette."
          checked={isDark}
          onChange={onDarkMode}
        />
      </Section>

      <Section title="Accent colour" hint="Recolours buttons and highlights instantly.">
        <OptionCards options={ACCENT_OPTIONS} value={ps.accent} onChange={(v) => set('accent', v)} />
      </Section>

      <Section title="Card style" hint="How cards and panels are shaped across your dashboard.">
        <OptionCards options={CARD_STYLE_OPTIONS} value={ps.cardStyle} onChange={(v) => set('cardStyle', v)} />
      </Section>

      <Section title="Navigation style" hint="Switches the settings nav between a sidebar and top tabs.">
        <OptionCards options={NAV_STYLE_OPTIONS} value={ps.navStyle} onChange={(v) => set('navStyle', v)} />
      </Section>

      <Section title="Dashboard layout" hint="Choose how densely your dashboard packs in content.">
        <OptionCards options={DASHBOARD_LAYOUT_OPTIONS} value={ps.dashboardLayout} onChange={(v) => set('dashboardLayout', v)} />
      </Section>

      <Section title="Background" hint="An optional decorative backdrop behind your pages.">
        <OptionCards options={BACKGROUND_OPTIONS} value={ps.background} onChange={(v) => set('background', v)} />
      </Section>
    </Panel>
  )
}
