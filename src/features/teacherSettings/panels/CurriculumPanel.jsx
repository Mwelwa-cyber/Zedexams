import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import {
  getSubjectsForGrade, gradeOptionsForCurriculum,
} from '../../../config/teacherTaxonomy'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import SelectField from '../components/fields/SelectField'
import OptionCards from '../components/fields/OptionCards'
import { useSettingsSave } from '../lib/useSettingsSave'

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

  // Each curriculum offers its OWN grade/form structure — never a shared
  // generic Grade 1–12 list (CBC has ECE bands + Forms 1–4 and no Grade 7/12;
  // the 2013 set has Grades 1–12 and no ECE).
  const gradeOptions = useMemo(
    () => gradeOptionsForCurriculum(form.curriculum).filter((o) => o.value !== undefined),
    [form.curriculum],
  )

  // Scope the default-subject options to the default grade + curriculum so the
  // pair is always a valid combination and the list is never a mixed CBC+OBC,
  // all-levels dump. With no grade chosen yet we show nothing (the subject
  // select is disabled) rather than every subject at once.
  const subjectOptions = useMemo(
    () => (form.grade
      ? getSubjectsForGrade(form.grade, form.curriculum).filter((o) => o.value !== undefined)
      : []),
    [form.grade, form.curriculum],
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
          onChange={(curriculum) => setForm((f) => (
            // Changing the curriculum clears BOTH downstream picks — the new
            // curriculum has its own grade structure and subject catalog, so a
            // carried-over grade/subject could silently be invalid.
            curriculum === f.curriculum ? f : { ...f, curriculum, grade: '', subject: '' }
          ))}
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
              onChange={(grade) => setForm((f) => (
                // Changing the grade always clears the subject — it must be
                // re-picked from the new grade's list, never carried over.
                grade === f.grade ? f : { ...f, grade, subject: '' }
              ))}
              options={gradeOptions}
              placeholder="No default"
            />
          </FieldRow>
          <FieldRow label="Default subject" htmlFor="cu-subject">
            <SelectField
              id="cu-subject"
              value={form.subject}
              onChange={(subject) => setForm((f) => ({ ...f, subject }))}
              options={subjectOptions}
              placeholder={form.grade ? 'No default' : 'Select a grade first'}
              disabled={!form.grade}
            />
          </FieldRow>
        </div>
      </section>
    </SettingsDetailShell>
  )
}
