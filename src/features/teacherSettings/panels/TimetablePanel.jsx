import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  normalizeTimetable,
  normalizeTeaching,
  TIMETABLE_DAYS,
  MAX_PERIODS_PER_DAY,
} from '../../../utils/teacherSettingsCore'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../../config/teacherTaxonomy'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import Icon from '../../../components/ui/Icon'
import { Plus, Trash2 } from '../../../components/ui/icons'
import { useSettingsSave } from '../lib/useSettingsSave'

const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' }
const GRADE_OPTIONS = TEACHER_GRADES.filter((g) => g.value)
const SUBJECT_OPTIONS = TEACHER_SUBJECTS.filter((s) => s.value)

// 'HH:MM' + minutes → 'HH:MM' (clamped to the same day).
function addMinutes(time, minutes) {
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m) return ''
  const total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + minutes)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Simple weekly timetable: period length + Mon–Fri period entries
// (start/end/subject/grade). Deliberately no clash detection or printing —
// it's a calm reference grid, saved to users/{uid}.timetable.
export default function TimetablePanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const source = normalizeTimetable(userProfile?.timetable)
  const [form, setForm] = useState(source)
  const { run, saving, saved, error } = useSettingsSave()
  const teaching = normalizeTeaching(userProfile?.teaching)

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(source),
    [form, source],
  )
  const weeklyCount = TIMETABLE_DAYS.reduce((sum, d) => sum + form.days[d].length, 0)

  // Prefer the teacher's own subjects/grades in the selects; fall back to the
  // full lists when the Teaching panel hasn't been filled in yet.
  const subjectOptions = teaching.subjects.length
    ? SUBJECT_OPTIONS.filter((s) => teaching.subjects.includes(s.value))
    : SUBJECT_OPTIONS
  const gradeOptions = teaching.grades.length
    ? GRADE_OPTIONS.filter((g) => teaching.grades.includes(g.value))
    : GRADE_OPTIONS

  const onSave = () =>
    run(async () => {
      const next = normalizeTimetable(form)
      await updateProfileFields({ timetable: next })
      setForm(next)
    })

  const setEntry = (day, index, fields) =>
    setForm((f) => ({
      ...f,
      days: {
        ...f.days,
        [day]: f.days[day].map((e, i) => (i === index ? { ...e, ...fields } : e)),
      },
    }))

  const addEntry = (day) =>
    setForm((f) => {
      const list = f.days[day]
      if (list.length >= MAX_PERIODS_PER_DAY) return f
      // Chain from the previous period so times mostly type themselves.
      const prev = list[list.length - 1]
      const start = prev?.end || '08:00'
      return {
        ...f,
        days: {
          ...f.days,
          [day]: [
            ...list,
            { start, end: addMinutes(start, f.periodMinutes || 40), subject: '', grade: '', label: '' },
          ],
        },
      }
    })

  const removeEntry = (day, index) =>
    setForm((f) => ({
      ...f,
      days: { ...f.days, [day]: f.days[day].filter((_, i) => i !== index) },
    }))

  return (
    <SettingsDetailShell
      rowId="timetable"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Periods</h2>
        <div className="tset-grid">
          <FieldRow label="Period length (minutes)" htmlFor="tt-mins" help="New periods use this length automatically.">
            <input
              id="tt-mins"
              className="studio-input"
              type="number"
              min={5}
              max={240}
              value={form.periodMinutes}
              onChange={(e) => setForm((f) => ({ ...f, periodMinutes: Number(e.target.value) || 40 }))}
            />
          </FieldRow>
          <FieldRow label="Weekly load" help="Total periods currently on this timetable.">
            <p className="tset-usage-row__value" style={{ padding: '8px 0' }}>
              {weeklyCount} <small>period{weeklyCount === 1 ? '' : 's'}</small>
            </p>
          </FieldRow>
        </div>
      </section>

      {TIMETABLE_DAYS.map((day) => (
        <section key={day} className="tset-section tset-tt-day">
          <h2 className="tset-tt-day__name">{DAY_LABELS[day]}</h2>
          {form.days[day].length === 0 && (
            <p className="tset-section__hint" style={{ margin: '0 0 10px' }}>No periods yet.</p>
          )}
          {form.days[day].map((entry, i) => (
            <div key={i} className="tset-tt-entry">
              <input
                className="studio-input"
                type="time"
                aria-label={`${DAY_LABELS[day]} period ${i + 1} start`}
                value={entry.start}
                onChange={(e) =>
                  setEntry(day, i, {
                    start: e.target.value,
                    end: entry.end || addMinutes(e.target.value, form.periodMinutes || 40),
                  })
                }
              />
              <input
                className="studio-input"
                type="time"
                aria-label={`${DAY_LABELS[day]} period ${i + 1} end`}
                value={entry.end}
                onChange={(e) => setEntry(day, i, { end: e.target.value })}
              />
              <select
                className="studio-input"
                aria-label={`${DAY_LABELS[day]} period ${i + 1} subject`}
                value={entry.subject}
                onChange={(e) => setEntry(day, i, { subject: e.target.value })}
              >
                <option value="">Subject…</option>
                {subjectOptions.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <select
                className="studio-input"
                aria-label={`${DAY_LABELS[day]} period ${i + 1} grade`}
                value={entry.grade}
                onChange={(e) => setEntry(day, i, { grade: e.target.value })}
              >
                <option value="">Class…</option>
                {gradeOptions.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="tset-tt-remove"
                aria-label={`Remove ${DAY_LABELS[day]} period ${i + 1}`}
                onClick={() => removeEntry(day, i)}
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="tset-btn tset-btn--ghost tset-btn--sm"
            onClick={() => addEntry(day)}
            disabled={form.days[day].length >= MAX_PERIODS_PER_DAY}
          >
            <Icon as={Plus} size="sm" aria-hidden="true" />
            Add period
          </button>
        </section>
      ))}
    </SettingsDetailShell>
  )
}
