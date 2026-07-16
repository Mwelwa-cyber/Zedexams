/**
 * Attendance tab — the Class Register Studio workspace inside one register's
 * detail page (/teacher/register/:classId/attendance). Uses the class's own
 * current term/year (the selector at the top of the detail page); the
 * standalone studio at /teacher/attendance adds free year/term/class pickers
 * around the same AttendanceWorkspace.
 */

import { TERMS } from '../../../utils/classTerms'
import { getActiveTerm } from '../../../utils/moeCalendar'
import AttendanceWorkspace from './attendance/AttendanceWorkspace'

export default function AttendanceTab({ register }) {
  const active = getActiveTerm()
  const term = TERMS.includes(register.term) ? register.term : (active ? TERMS[active.term.number - 1] : TERMS[0])
  const year = Number(register.year) || (active ? active.year : new Date().getFullYear())
  return (
    <AttendanceWorkspace
      key={`${register.id}|${term}|${year}`}
      register={register}
      termSelection={{ term, year }}
    />
  )
}
