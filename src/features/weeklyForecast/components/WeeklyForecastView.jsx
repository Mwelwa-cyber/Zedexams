/**
 * WeeklyForecastView — the official weekly-forecast document
 * Zambian teachers fill in for the coming week: a per-day plan with a
 * progress-remarks column they annotate after each lesson.
 *
 *   WEEK | DAY | TOPIC | SUB-TOPIC / TO BE DONE | SPECIFIC COMPETENCE |
 *   LEARNING ACTIVITY | EXPECTED STANDARD | T/L RESOURCES |
 *   REMARKS / COMMENTS ON PROGRESS
 *
 * Shared by the Weekly Forecast studio, the /teachers sample library
 * and the teacher library detail view. Reads a `days[]` artifact. Serif on
 * white with a black grid so it reads as the printed/exported page,
 * mirroring LessonPlanOfficialTable / SchemeOfWorkOfficialTable.
 */

import { forecastColumns, forecastCurriculum, curriculumLabel } from '../../../shared/utils/schemeFormat'

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-top text-left'

function CellList({ items }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : [])
  if (list.length === 0) return <>—</>
  if (list.length === 1) return <>{list[0]}</>
  return (
    <ul className="list-disc pl-3.5 space-y-0.5">
      {list.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

function ForecastCell({ day, col }) {
  if (col.type === 'list') {
    return <td className={TD}><CellList items={day[col.key]} /></td>
  }
  const cls = col.key === 'topic' ? `${TD} font-bold` : (col.key === 'day' ? `${TD} text-center` : TD)
  const val = day[col.key]
  return <td className={cls}>{val || (col.key === 'remarks' ? '' : '—')}</td>
}

export default function WeeklyForecastView({ forecast }) {
  if (!forecast) return null
  const h = forecast.header || {}
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const subject = (h.subject || '').toUpperCase()
  const days = forecast.days || []
  // CBC (with Learning Activity + Expected Standard) vs OBC (without) — the
  // same column source the scheme + exporters use.
  const curriculum = forecastCurriculum(forecast)
  const columns = forecastColumns(curriculum)
  const minWidth = curriculum === 'obc' ? 720 : 920

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-base font-bold tracking-[0.08em] uppercase">
          Grade {gradeLabel} {subject} Weekly Forecast
        </div>
        <div className="mt-1 text-[12px] font-bold">
          TERM {h.term} &nbsp;·&nbsp; YEAR: {h.year}
        </div>
        <div className="mt-0.5 text-[10px] font-bold tracking-[0.12em] uppercase" style={{ color: '#555' }}>
          {curriculumLabel(curriculum)} · {curriculum === 'obc' ? 'Outcome-Based' : 'Competency-Based'} Curriculum
        </div>
      </div>

      {/* Fill-in header line */}
      <div className="mt-3 border-y-[1.5px] border-black py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
        <div><strong className="font-bold">NAME OF SCHOOL:</strong> {h.school || '_______________________'}</div>
        <div><strong className="font-bold">TEACHER&#x2019;S NAME:</strong> {h.teacherName || '_______________________'}</div>
        <div><strong className="font-bold">WEEK BEGINNING:</strong> {h.weekBeginning || '____________'}</div>
        <div><strong className="font-bold">WEEK ENDING:</strong> {h.weekEnding || '____________'}</div>
      </div>

      {/* Forecast grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border border-black" style={{ minWidth }}>
          <thead>
            <tr className="align-bottom">
              <th className={`${TD} font-bold`} style={{ width: '4%' }}>WEEK</th>
              {columns.map((col) => (
                <th key={col.key} className={`${TD} font-bold`} style={{ width: `${col.width}%` }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={i}>
                {i === 0 && (
                  <td className={`${TD} font-bold text-center align-middle`} rowSpan={days.length}>
                    {h.weekNumber}
                  </td>
                )}
                {columns.map((col) => <ForecastCell key={col.key} day={d} col={col} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}
