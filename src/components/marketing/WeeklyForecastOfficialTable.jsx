/**
 * WeeklyForecastOfficialTable — the official weekly-forecast document
 * Zambian teachers fill in for the coming week: a per-day plan with a
 * progress-remarks column they annotate after each lesson.
 *
 *   WEEK | DAY | TOPIC | SUB-TOPIC / TO BE DONE | SPECIFIC COMPETENCE |
 *   LEARNING ACTIVITY | EXPECTED STANDARD | T/L RESOURCES |
 *   REMARKS / COMMENTS ON PROGRESS
 *
 * Reads a `days[]` artifact (see src/data/teacherSamples.js). Serif on
 * white with a black grid so it reads as the printed/exported page,
 * mirroring LessonPlanOfficialTable / SchemeOfWorkOfficialTable.
 */

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

export default function WeeklyForecastOfficialTable({ forecast }) {
  if (!forecast) return null
  const h = forecast.header || {}
  const subject = (h.subject || '').toUpperCase()
  const days = forecast.days || []

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-base font-bold tracking-[0.08em] uppercase">
          Grade {h.grade} {subject} Weekly Forecast
        </div>
        <div className="mt-1 text-[12px] font-bold">
          TERM {h.term} &nbsp;·&nbsp; YEAR: {h.year}
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
        <table className="w-full border-collapse border border-black min-w-[920px]">
          <thead>
            <tr className="align-bottom">
              <th className={`${TD} font-bold w-[4%]`}>WEEK</th>
              <th className={`${TD} font-bold w-[4%]`}>DAY</th>
              <th className={`${TD} font-bold w-[10%]`}>TOPIC</th>
              <th className={`${TD} font-bold w-[12%]`}>SUB-TOPIC / TO BE DONE</th>
              <th className={`${TD} font-bold w-[15%]`}>SPECIFIC COMPETENCE</th>
              <th className={`${TD} font-bold w-[20%]`}>LEARNING ACTIVITY</th>
              <th className={`${TD} font-bold w-[13%]`}>EXPECTED STANDARD</th>
              <th className={`${TD} font-bold w-[12%]`}>T/L RESOURCES</th>
              <th className={`${TD} font-bold w-[10%]`}>REMARKS / COMMENTS ON PROGRESS</th>
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
                <td className={`${TD} text-center`}>{d.day}</td>
                <td className={`${TD} font-bold`}>{d.topic}</td>
                <td className={TD}>{d.subtopic}</td>
                <td className={TD}>{d.specificCompetence}</td>
                <td className={TD}><CellList items={d.learningActivities} /></td>
                <td className={TD}>{d.expectedStandard || '—'}</td>
                <td className={TD}><CellList items={d.resources} /></td>
                <td className={TD}>{d.remarks || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}
