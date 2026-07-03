import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeaching, timetableWeeklyLoad } from '../../../utils/teacherSettingsCore'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../../config/teacherTaxonomy'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import ChipMultiSelect from '../components/fields/ChipMultiSelect'
import { useSettingsSave } from '../lib/useSettingsSave'

// Taxonomy lists carry { group } header items for <optgroup> rendering —
// chips only want the real values.
const GRADE_OPTIONS = TEACHER_GRADES.filter((g) => g.value)
const SUBJECT_OPTIONS = TEACHER_SUBJECTS.filter((s) => s.value)

// Teaching assignment: grades, subjects, streams, class-teacher class,
// department and weekly load. Drives the hero stats and (via
// teacherDefaults.teachingCounts) any surface that summarises your classes.
export default function TeachingPanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const source = normalizeTeaching(userProfile?.teaching)
  const [form, setForm] = useState(source)
  const { run, saving, saved, error } = useSettingsSave()

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(source),
    [form, source],
  )
  const timetabledLoad = timetableWeeklyLoad(userProfile?.timetable)

  const onSave = () =>
    run(async () => {
      const next = normalizeTeaching({ ...userProfile?.teaching, ...form })
      await updateProfileFields({ teaching: next })
      // Reflect the normalized value back (trimmed/deduped) so the form
      // matches the freshly saved profile and dirty clears.
      setForm(next)
    })

  return (
    <SettingsDetailShell
      rowId="teaching"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Grades you teach</h2>
        <ChipMultiSelect
          label="Grades you teach"
          values={form.grades}
          onChange={(grades) => setForm((f) => ({ ...f, grades }))}
          options={GRADE_OPTIONS}
          maxValues={16}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Subjects you teach</h2>
        <ChipMultiSelect
          label="Subjects you teach"
          values={form.subjects}
          onChange={(subjects) => setForm((f) => ({ ...f, subjects }))}
          options={SUBJECT_OPTIONS}
          maxValues={20}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Classes & load</h2>
        <div className="tset-grid">
          <FieldRow
            label="Streams / classes"
            htmlFor="tp-streams"
            full
            help="Add each class you take, e.g. 5A, 6 Blue. These count as your Classes stat."
          >
            <ChipMultiSelect
              id="tp-streams"
              label="Streams / classes"
              values={form.streams}
              onChange={(streams) => setForm((f) => ({ ...f, streams }))}
              options={[]}
              allowCustom
              customPlaceholder="e.g. 5A"
              maxValues={12}
            />
          </FieldRow>
          <FieldRow label="Class teacher of" htmlFor="tp-classteacher" help="The class you are class teacher for (if any).">
            <input
              id="tp-classteacher"
              className="studio-input"
              type="text"
              value={form.classTeacherOf}
              onChange={(e) => setForm((f) => ({ ...f, classTeacherOf: e.target.value }))}
              placeholder="e.g. 5A"
              maxLength={40}
            />
          </FieldRow>
          <FieldRow label="Department" htmlFor="tp-dept">
            <input
              id="tp-dept"
              className="studio-input"
              type="text"
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              placeholder="e.g. Sciences"
              maxLength={80}
            />
          </FieldRow>
          <FieldRow
            label="Weekly teaching load (periods)"
            htmlFor="tp-load"
            help={timetabledLoad > 0 ? `Your timetable currently has ${timetabledLoad} periods.` : undefined}
          >
            <input
              id="tp-load"
              className="studio-input"
              type="number"
              min={0}
              max={60}
              value={form.weeklyLoadPeriods ?? ''}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  weeklyLoadPeriods: e.target.value === '' ? null : Number(e.target.value),
                }))
              }
              placeholder="e.g. 28"
            />
          </FieldRow>
        </div>
      </section>
    </SettingsDetailShell>
  )
}
