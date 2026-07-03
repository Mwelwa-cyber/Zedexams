import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../../config/teacherTaxonomy'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import SelectField from '../components/fields/SelectField'
import OptionCards from '../components/fields/OptionCards'
import { useSettingsSave } from '../lib/useSettingsSave'

const GRADE_OPTIONS = TEACHER_GRADES.filter((g) => g.value)
const SUBJECT_OPTIONS = TEACHER_SUBJECTS.filter((s) => s.value)

function editable(prefs) {
  const { curriculum, grade, subject } = prefs.curriculum
  return { curriculum, grade, subject }
}

// Default curriculum + grade + subject. Studios read these through
// src/utils/teacherDefaults.curriculumSeedFromProfile, so a saved default
// pre-fills the curriculum pickers across ZedExams.
export default function CurriculumPanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const source = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const [form, setForm] = useState(() => editable(source))
  const { run, saving, saved, error } = useSettingsSave()

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(editable(source)),
    [form, source],
  )

  const onSave = () =>
    run(async () => {
      const latest = normalizeTeacherPreferences(userProfile?.teacherPreferences)
      const next = { ...latest, curriculum: { ...latest.curriculum, ...form } }
      await updateProfileFields({ teacherPreferences: next })
      setForm(editable(normalizeTeacherPreferences(next)))
    })

  return (
    <SettingsDetailShell
      rowId="curriculum"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Curriculum</h2>
        <OptionCards
          label="Curriculum"
          columns={2}
          value={form.curriculum}
          onChange={(curriculum) => setForm((f) => ({ ...f, curriculum }))}
          options={[
            { value: 'cbc', title: 'CBC (2023)', hint: 'The Competency-Based Curriculum — current syllabi.' },
            { value: 'previous', title: 'Previous (2013)', hint: 'The outgoing curriculum, for classes still on it.' },
          ]}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Defaults</h2>
        <p className="tset-section__hint">
          Pre-selected whenever you open a studio — you can always change them per document.
        </p>
        <div className="tset-grid">
          <FieldRow label="Default grade" htmlFor="cu-grade">
            <SelectField
              id="cu-grade"
              value={form.grade}
              onChange={(grade) => setForm((f) => ({ ...f, grade }))}
              options={GRADE_OPTIONS}
              placeholder="No default"
            />
          </FieldRow>
          <FieldRow label="Default subject" htmlFor="cu-subject">
            <SelectField
              id="cu-subject"
              value={form.subject}
              onChange={(subject) => setForm((f) => ({ ...f, subject }))}
              options={SUBJECT_OPTIONS}
              placeholder="No default"
            />
          </FieldRow>
        </div>
      </section>
    </SettingsDetailShell>
  )
}
