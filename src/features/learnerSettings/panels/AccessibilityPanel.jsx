// Accessibility panel — reading, vision and motion preferences. These apply
// IMMEDIATELY and persist to localStorage (they ride on <body> data-attrs via
// saveAccessibilityPrefs). We also mirror to Firestore for cross-device sync,
// but localStorage stays the source of truth for what's applied on screen.

import { useState } from 'react'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, SelectField, Toggle, Note } from '../components/ui'
import {
  loadAccessibilityPrefs,
  saveAccessibilityPrefs,
} from '../../../utils/accessibility'

const FONT_SCALE_OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium (default)' },
  { value: 'large', label: 'Larger text' },
]

const COLOR_BLIND_OPTIONS = [
  { value: 'none', label: 'Off' },
  { value: 'protanopia', label: 'Protanopia (red-green)' },
  { value: 'deuteranopia', label: 'Deuteranopia (red-green)' },
  { value: 'tritanopia', label: 'Tritanopia (blue-yellow)' },
]

export default function AccessibilityPanel({ section, pushToast }) {
  const { commit } = useSettingsSave()
  const [prefs, setPrefs] = useState(() => loadAccessibilityPrefs())

  const set = (key, value) => {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    saveAccessibilityPrefs(next) // applies to <body> + persists to localStorage
    commit({ 'learnerSettings.accessibility': next }) // cross-device sync
    pushToast('success', 'Accessibility updated.')
  }

  return (
    <Panel section={section}>
      <Note tone="accent">
        Changes here apply right away — no need to save. They stay on this device
        and sync to your account so they follow you everywhere.
      </Note>

      <Section title="Reading" hint="Make text easier to read across ZedExams.">
        <SelectField
          label="Text size"
          value={prefs.fontScale}
          onChange={(v) => set('fontScale', v)}
          options={FONT_SCALE_OPTIONS}
        />
        <Toggle
          title="Dyslexia-friendly font"
          hint="Switches body text to a typeface with clearer letter shapes."
          checked={prefs.dyslexiaFont}
          onChange={(v) => set('dyslexiaFont', v)}
        />
      </Section>

      <Section title="Vision" hint="Boost contrast or adjust colours for colour vision.">
        <Toggle
          title="High contrast"
          hint="Stronger contrast between text and background."
          checked={prefs.highContrast}
          onChange={(v) => set('highContrast', v)}
        />
        <SelectField
          label="Colour-blind friendly mode"
          hint="Adjusts on-screen colours to be easier to tell apart."
          value={prefs.colorBlind}
          onChange={(v) => set('colorBlind', v)}
          options={COLOR_BLIND_OPTIONS}
        />
      </Section>

      <Section title="Motion" hint="Calm down animations and transitions.">
        <Toggle
          title="Reduce animations"
          hint="Minimises movement, fades and sliding effects."
          checked={prefs.reducedMotion}
          onChange={(v) => set('reducedMotion', v)}
        />
      </Section>

      <Section title="Assistive tech" hint="Deeper support for screen readers and voice control.">
        <div className="lset-toggle">
          <div className="lset-toggle__text">
            <p className="lset-toggle__title">Screen reader enhancements</p>
          </div>
          <span className="lset-soon">Coming soon</span>
        </div>
        <div className="lset-toggle">
          <div className="lset-toggle__text">
            <p className="lset-toggle__title">Voice navigation</p>
          </div>
          <span className="lset-soon">Coming soon</span>
        </div>
        <Note>
          ZedExams already ships semantic labels and keyboard focus for screen
          readers today. These deeper, configurable options are on the way.
        </Note>
      </Section>
    </Panel>
  )
}
