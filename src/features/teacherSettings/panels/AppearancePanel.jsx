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
import { ReadingThemeSwatches } from '../../learnerSettings'

// Theme + accessibility. Everything here applies instantly, so there is no
// Save bar.
//
// TWO theme controls, because a teacher's pages are painted by TWO palettes
// and Appearance is the one place they will look when the colour is wrong.
//
//   workspace theme  --zt-*, `data-theme` on <html>. Paints everything
//                    inside TeacherLayout: the dashboard, the studios, and
//                    this page.
//   reading theme    --bg / --card / --text, `theme-<id>` on <body>. Paints
//                    everything OUTSIDE it — the marketing site, sign-in,
//                    /papers, /pricing, /my-subscription, the note reader
//                    and the quiz runner.
//
// The reading theme was removed from this page in 2026-07 on the reasoning
// that it "colours nothing on this screen". That much is true and it is the
// whole of why it was a trap: `.studio-theme` REMAPS the reading tokens onto
// --zt-* (src/index.css), so the palette is masked here and nowhere else. A
// teacher whose account recorded Midnight therefore had every non-studio page
// dark, on every device (<ReadingThemeSync> syncs the palette to the
// account), and the only two controls left were the note-reader and
// quiz-runner toolbars — surfaces a teacher may never open. Settings offered
// four workspace cards, none of which could touch it. That is the
// "site stuck on dark mode" report.
//
// So the control is back, and the thing that made it confusing is answered
// instead of avoided: the swatches self-preview (each draws its own ink on
// its own page colour), and the hint says plainly that this screen is not one
// of the pages it repaints. A control you can see the effect of is not the
// same problem as a control that appears to do nothing.
export default function AppearancePanel() {
  const { teacherTheme, setTeacherTheme, teacherThemes, theme, setTheme } = useTheme()
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

  // Same event name and shape the reader and quiz toolbars send, so the three
  // homes of this one control report as one control. `surface` is what tells
  // them apart — a teacher fixing a palette in Settings is a different moment
  // from a learner adjusting one mid-note.
  const chooseReadingTheme = (next) => {
    if (next === theme) return
    capture('reading_theme_selected', {
      theme: next,
      previous_theme: theme,
      surface: 'teacher_settings',
    })
    setTheme(next)
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
        <h2 className="tset-section__title">Reading theme</h2>
        <p className="tset-section__hint">
          Colours the pages outside your workspace — the ZedExams site,
          sign-in, past papers, your subscription, and the note reader and quiz
          runner. Saved to your account, so it follows you to any device you
          sign in on. This settings screen uses your workspace theme above, so
          it will not change colour here — each swatch shows its own page
          colour and ink instead.
        </p>
        <ReadingThemeSwatches value={theme} onChange={chooseReadingTheme} />
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
