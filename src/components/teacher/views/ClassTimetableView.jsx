/**
 * Read-only rendering of a validated class-timetable artifact.
 * Shared by the Class Timetable Studio (print preview) and the Library
 * detail view.
 *
 * Renders the official document look — a black-grid grid on white, serif
 * type — so it reads as the printed timetable pinned on the classroom wall.
 * Lesson cells carry a faint per-subject tint (deterministic by the order
 * subjects first appear) so the week is scannable at a glance; break/lunch
 * rows span every day column.
 */

import { lessonPeriods } from '../../../utils/classTimetable'

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-middle text-center'

// Soft, print-safe tints cycled across the distinct subjects in the grid.
const SUBJECT_TINTS = [
  '#fbe7c8', '#dfeadd', '#e3dcf5', '#dbe7f4', '#fde2c4',
  '#e1e8ee', '#f4d6e2', '#f9d8c8', '#d8ecd0', '#fde9b8',
]

function buildTints(slots, days, periods) {
  const order = []
  const seen = new Set()
  for (const p of lessonPeriods(periods)) {
    for (const day of days) {
      const subj = slots?.[p.id]?.[day]
      if (subj && !seen.has(subj)) { seen.add(subj); order.push(subj) }
    }
  }
  const map = {}
  order.forEach((subj, i) => { map[subj] = SUBJECT_TINTS[i % SUBJECT_TINTS.length] })
  return map
}

export default function ClassTimetableView({ timetable }) {
  if (!timetable) return null
  const h = timetable.header || {}
  const days = Array.isArray(timetable.days) ? timetable.days : []
  const periods = Array.isArray(timetable.periods) ? timetable.periods : []
  const slots = timetable.slots || {}
  const tints = buildTints(slots, days, periods)

  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const titleBits = [
    h.className && h.className.trim(),
    gradeLabel && `Grade ${gradeLabel}`,
  ].filter(Boolean).join(' · ')

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        {h.school && (
          <div className="text-sm font-bold uppercase tracking-[0.06em]">{h.school}</div>
        )}
        <div className="mt-1 text-base font-bold tracking-[0.08em] uppercase">
          Class Timetable
        </div>
        <div className="mt-1 text-[12px] font-bold">
          {titleBits}
          {h.term ? <> &nbsp;·&nbsp; TERM {h.term}</> : null}
          {h.year ? <> &nbsp;·&nbsp; {h.year}</> : null}
        </div>
        {h.teacherName && (
          <div className="mt-1 text-[12px]">Class teacher: {h.teacherName}</div>
        )}
      </div>

      {/* Grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border border-black min-w-[720px]">
          <thead>
            <tr>
              <th className={`${TD} font-bold w-[14%]`}>TIME</th>
              {days.map((day) => (
                <th key={day} className={`${TD} font-bold`}>{day.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              if (p.kind === 'break') {
                return (
                  <tr key={p.id}>
                    <td className={`${TD} font-bold whitespace-nowrap`}>
                      {p.start}–{p.end}
                    </td>
                    <td
                      className={`${TD} font-bold uppercase tracking-[0.15em]`}
                      colSpan={days.length || 1}
                      style={{ background: '#f1ece0' }}
                    >
                      {p.label}
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={p.id}>
                  <td className={`${TD} font-bold whitespace-nowrap`}>
                    <div>{p.start}–{p.end}</div>
                    <div className="text-[10px] font-normal opacity-70">{p.label}</div>
                  </td>
                  {days.map((day) => {
                    const subj = slots?.[p.id]?.[day] || ''
                    return (
                      <td
                        key={day}
                        className={TD}
                        style={subj ? { background: tints[subj] } : undefined}
                      >
                        {subj || <span className="opacity-30">—</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </article>
  )
}
