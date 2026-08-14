import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import { TERMS } from '../../../utils/classTerms'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import SelectField from '../components/fields/SelectField'
import Icon from '../../../shared/components/Icon'
import { CalendarDays, ChevronRight } from '../../../shared/components/icons'
import { useSettingsSave } from '../lib/useSettingsSave'

function editable(prefs) {
  const { academicYear, term } = prefs.curriculum
  return { academicYear, term }
}

// Academic year + current term (defaults used on documents and class tools),
// plus a shortcut to the full School Calendar page.
export default function CalendarPanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const source = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const [form, setForm] = useState(() => editable(source))
  const { run, saving, saved, error } = useSettingsSave()

  // This year ± 1 keeps the select honest at year boundaries (Term 1 planning
  // often happens in December).
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return [String(y - 1), String(y), String(y + 1)]
  }, [])

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
      rowId="calendar"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Current period</h2>
        <p className="tset-section__hint">
          Stamped onto documents and used as the default term across your class tools.
        </p>
        <div className="tset-grid">
          <FieldRow label="Academic year" htmlFor="cal-year">
            <SelectField
              id="cal-year"
              value={form.academicYear}
              onChange={(academicYear) => setForm((f) => ({ ...f, academicYear }))}
              options={yearOptions}
              placeholder="Not set"
            />
          </FieldRow>
          <FieldRow label="Term" htmlFor="cal-term">
            <SelectField
              id="cal-term"
              value={form.term}
              onChange={(term) => setForm((f) => ({ ...f, term }))}
              options={TERMS}
              placeholder="Not set"
            />
          </FieldRow>
        </div>
      </section>

      <section className="tset-card" style={{ marginBottom: 16 }}>
        <Link to="/teacher/calendar" className="tset-row">
          <span className="tset-row__badge tset-row__badge--green">
            <Icon as={CalendarDays} size="sm" />
          </span>
          <span className="tset-row__text">
            <p className="tset-row__title">School Calendar</p>
            <p className="tset-row__desc">Term dates, holidays and events for the year</p>
          </span>
          <ChevronRight size={16} className="tset-row__chevron" />
        </Link>
      </section>
    </SettingsDetailShell>
  )
}
