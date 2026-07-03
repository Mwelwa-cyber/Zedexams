import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import { useSchoolProfileForm } from '../lib/useSchoolProfileForm'
import SettingsDetailShell from '../components/SettingsDetailShell'
import SchoolProfileLoadError from '../components/SchoolProfileLoadError'
import FieldRow from '../components/fields/FieldRow'
import OptionCards from '../components/fields/OptionCards'
import { useSettingsSave } from '../lib/useSettingsSave'

const DIFFICULTY_OPTIONS = [
  { value: 'easy', title: 'Gentle', hint: 'Confidence-building, more scaffolding.' },
  { value: 'mixed', title: 'Mixed', hint: 'A balanced spread of difficulty.' },
  { value: 'hard', title: 'Challenging', hint: 'Stretch questions and deeper thinking.' },
]

function editable(prefs) {
  const { homeworkDifficulty, assessmentDifficulty } = prefs.ai
  return { homeworkDifficulty, assessmentDifficulty }
}

// The quiet knobs that pre-fill every studio: difficulty defaults (users doc)
// and the default paper duration (schoolProfiles). One Save writes both.
export default function SmartDefaultsPanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const source = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const [form, setForm] = useState(() => editable(source))
  const school = useSchoolProfileForm()
  const { run, saving, saved, error } = useSettingsSave()

  // The duration slice lives on schoolProfiles — while it can't load, only
  // that half is gated; the users-doc difficulty knobs stay editable.
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(editable(source)) || school.dirty,
    [form, source, school.dirty],
  )

  const onSave = () =>
    run(async () => {
      const latest = normalizeTeacherPreferences(userProfile?.teacherPreferences)
      const next = { ...latest, ai: { ...latest.ai, ...form } }
      await updateProfileFields({ teacherPreferences: next })
      // Reflect the normalized value back so the form isn't left "dirty"
      // against the freshly saved profile.
      setForm(editable(normalizeTeacherPreferences(next)))
      if (school.dirty) await school.save()
    })

  return (
    <SettingsDetailShell
      rowId="defaults"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <SchoolProfileLoadError school={school} />
      <section className="tset-section">
        <h2 className="tset-section__title">Homework difficulty</h2>
        <OptionCards
          label="Homework difficulty"
          value={form.homeworkDifficulty}
          onChange={(homeworkDifficulty) => setForm((f) => ({ ...f, homeworkDifficulty }))}
          options={DIFFICULTY_OPTIONS}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Assessment difficulty</h2>
        <OptionCards
          label="Assessment difficulty"
          value={form.assessmentDifficulty}
          onChange={(assessmentDifficulty) => setForm((f) => ({ ...f, assessmentDifficulty }))}
          options={DIFFICULTY_OPTIONS}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Papers</h2>
        <div className="tset-grid">
          <FieldRow
            label="Default paper duration (minutes)"
            htmlFor="sd-duration"
            help="Pre-filled on new test and exam papers."
          >
            <input
              id="sd-duration"
              className="studio-input"
              type="number"
              min={10}
              max={240}
              value={school.form.defaultDuration ?? ''}
              disabled={school.loading || school.loadError}
              onChange={(e) =>
                school.patch({
                  defaultDuration: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              placeholder="e.g. 90"
            />
          </FieldRow>
        </div>
      </section>
    </SettingsDetailShell>
  )
}
