/**
 * MarkScheduleView — the class mark schedule teachers compile
 * after a test cycle: one row per pupil with per-subject marks, an
 * auto-computed total, the class position (ties share a position), and
 * a suggested report comment per position band — the three things the
 * upcoming Mark Schedule studio automates.
 *
 * Shared by the Mark Schedule studio, the /teachers sample library
 * and (later) the teacher library detail view.
 *
 * Reads a `schedule` artifact:
 *   header   — { school, grade, term, year }
 *   subjects — [{ key, label, max }]
 *   pupils   — [{ sn, name, marks: { [key]: n }, total, position, comment }]
 *
 * `mode` is 'marks' (raw, out of each subject's max) or 'percent' —
 * the percentage view is DERIVED here from the same marks (each subject
 * converted to % of its max, plus an AVERAGE % column), demonstrating
 * the studio's switch-and-everything-recalculates behaviour. Positions
 * are the official ones from the raw totals in both views.
 *
 * Serif on white with a black grid, mirroring the other official
 * documents.
 */

import { scheduleClassLabel } from '../../../shared/utils/markSchedule.js'

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-top'

const pct = (mark, max) => (max > 0 ? Math.round((mark / max) * 100) : 0)

export default function MarkScheduleView({ schedule, mode = 'marks' }) {
  if (!schedule) return null
  const h = schedule.header || {}
  // Prefer the human label ("Form 1") saved with new schedules; old data
  // falls back to the historical G-strip of the wire code ('G4' → "Grade 4").
  const classLabel = scheduleClassLabel(h)
  const subjects = schedule.subjects || []
  const maxTotal = subjects.reduce((sum, s) => sum + (s.max || 0), 0)
  const isPercent = mode === 'percent'
  const averagePct = (p) => Math.round(
    subjects.reduce((sum, s) => sum + pct(p.marks?.[s.key] ?? 0, s.max), 0) / (subjects.length || 1),
  )

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-base font-bold uppercase">{h.school}</div>
        <div className="mt-1 border-y border-black py-1 text-sm font-bold tracking-[0.12em] uppercase">
          {classLabel} · Term {h.term} Mark Schedule — {h.year}
        </div>
      </div>

      {/* Schedule grid — the clean A4 schedule, no comment column: with
          five subjects (and classes of 80+) the page has no room for one. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border border-black min-w-[620px]">
          <thead>
            <tr className="align-bottom">
              <th className={`${TD} font-bold text-left w-[5%]`}>SN</th>
              <th className={`${TD} font-bold text-left w-[26%]`}>PUPIL'S NAME</th>
              {subjects.map((s) => (
                <th key={s.key} className={`${TD} font-bold text-center`}>
                  {s.label}{isPercent && ' %'}
                </th>
              ))}
              <th className={`${TD} font-bold text-center`}>{isPercent ? 'AVERAGE %' : 'TOTAL'}</th>
              <th className={`${TD} font-bold text-center`}>POSITION</th>
            </tr>
            {/* Max-marks row, exactly like the printed schedule */}
            <tr className="italic">
              <td className={TD} />
              <td className={`${TD} text-right pr-2`}>Out of</td>
              {subjects.map((s) => (
                <td key={s.key} className={`${TD} text-center`}>{isPercent ? 100 : s.max}</td>
              ))}
              <td className={`${TD} text-center font-bold`}>{isPercent ? 100 : maxTotal}</td>
              <td className={TD} />
            </tr>
          </thead>
          <tbody>
            {(schedule.pupils || []).map((p) => (
              <tr key={p.sn}>
                <td className={`${TD} text-center`}>{p.sn}</td>
                <td className={`${TD} font-bold uppercase`}>{p.name}</td>
                {subjects.map((s) => (
                  <td key={s.key} className={`${TD} text-center`}>
                    {isPercent ? pct(p.marks?.[s.key] ?? 0, s.max) : (p.marks?.[s.key] ?? '—')}
                  </td>
                ))}
                <td className={`${TD} text-center font-bold`}>{isPercent ? averagePct(p) : p.total}</td>
                <td className={`${TD} text-center font-bold`}>{p.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Page 2 — the report comments sheet. The schedule stays clean;
          the suggested comments print on their own sheet, one line per
          pupil, ready to copy into report books. */}
      <div className="mt-6 pt-5 border-t-2 border-dashed border-black/30">
        <div className="text-center">
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-black/50">Page 2</div>
          <div className="mt-1 border-y border-black py-1 text-sm font-bold tracking-[0.12em] uppercase inline-block px-6">
            Report Comments Sheet
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse border border-black min-w-[520px]">
            <thead>
              <tr>
                <th className={`${TD} font-bold text-left w-[6%]`}>SN</th>
                <th className={`${TD} font-bold text-left w-[26%]`}>PUPIL'S NAME</th>
                <th className={`${TD} font-bold text-center w-[10%]`}>POSITION</th>
                <th className={`${TD} font-bold text-left`}>SUGGESTED COMMENT</th>
              </tr>
            </thead>
            <tbody>
              {(schedule.pupils || []).map((p) => (
                <tr key={p.sn}>
                  <td className={`${TD} text-center`}>{p.sn}</td>
                  <td className={`${TD} font-bold uppercase`}>{p.name}</td>
                  <td className={`${TD} text-center font-bold`}>{p.position}</td>
                  <td className={TD}>{p.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[11px] italic text-black/70">
        {isPercent
          ? 'Every subject converts to a percentage of its maximum, with the average per pupil — switch views any time, nothing is retyped. Positions follow the official raw totals; ties share a position. '
          : 'Totals and positions are calculated automatically — ties share a position. '}
        Suggested comments print on their own sheet so the A4 schedule stays clean
        even for classes of 80+, ready to copy into report books. Every comment is
        editable.
      </p>
    </article>
  )
}
