/**
 * MarkScheduleOfficialTable — the class mark schedule teachers compile
 * after a test cycle: one row per pupil with per-subject marks, an
 * auto-computed total, the class position (ties share a position), and
 * a suggested report comment per position band — the three things the
 * upcoming Mark Schedule studio automates.
 *
 * Reads a `schedule` artifact (see src/data/teacherSamples.js):
 *   header   — { school, grade, term, year }
 *   subjects — [{ key, label, max }]
 *   pupils   — [{ sn, name, marks: { [key]: n }, total, position, comment }]
 *
 * Serif on white with a black grid, mirroring the other official
 * documents.
 */

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-top'

export default function MarkScheduleOfficialTable({ schedule }) {
  if (!schedule) return null
  const h = schedule.header || {}
  const subjects = schedule.subjects || []
  const maxTotal = subjects.reduce((sum, s) => sum + (s.max || 0), 0)

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-base font-bold uppercase">{h.school}</div>
        <div className="mt-1 border-y border-black py-1 text-sm font-bold tracking-[0.12em] uppercase">
          Grade {h.grade} · Term {h.term} Mark Schedule — {h.year}
        </div>
      </div>

      {/* Schedule grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border border-black min-w-[760px]">
          <thead>
            <tr className="align-bottom">
              <th className={`${TD} font-bold text-left w-[4%]`}>SN</th>
              <th className={`${TD} font-bold text-left w-[20%]`}>PUPIL'S NAME</th>
              {subjects.map((s) => (
                <th key={s.key} className={`${TD} font-bold text-center`}>{s.label}</th>
              ))}
              <th className={`${TD} font-bold text-center`}>TOTAL</th>
              <th className={`${TD} font-bold text-center`}>POSITION</th>
              <th className={`${TD} font-bold text-left w-[24%]`}>COMMENT</th>
            </tr>
            {/* Max-marks row, exactly like the printed schedule */}
            <tr className="italic">
              <td className={TD} />
              <td className={`${TD} text-right pr-2`}>Out of</td>
              {subjects.map((s) => (
                <td key={s.key} className={`${TD} text-center`}>{s.max}</td>
              ))}
              <td className={`${TD} text-center font-bold`}>{maxTotal}</td>
              <td className={TD} />
              <td className={TD} />
            </tr>
          </thead>
          <tbody>
            {(schedule.pupils || []).map((p) => (
              <tr key={p.sn}>
                <td className={`${TD} text-center`}>{p.sn}</td>
                <td className={`${TD} font-bold uppercase`}>{p.name}</td>
                {subjects.map((s) => (
                  <td key={s.key} className={`${TD} text-center`}>{p.marks?.[s.key] ?? '—'}</td>
                ))}
                <td className={`${TD} text-center font-bold`}>{p.total}</td>
                <td className={`${TD} text-center font-bold`}>{p.position}</td>
                <td className={`${TD} text-[11px]`}>{p.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] italic text-black/70">
        Totals, positions and comments are filled in automatically — ties share a
        position, and every comment can be edited before printing.
      </p>
    </article>
  )
}
