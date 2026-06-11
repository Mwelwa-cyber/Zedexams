/**
 * SchemeOfWorkOfficialTable — the new official CDC scheme-of-work format
 * Zambian schools use: the landscape 9-column grid
 *
 *   WEEK | TOPIC | SUBTOPIC | SPECIFIC COMPETENCES | LEARNING ACTIVITIES |
 *   EXPECTED STANDARD | METHODS | T/L AIDS | REF
 *
 * Reads a flat `weeks[]` artifact (see src/data/teacherSamples.js). Serif
 * on white with a black grid so it reads as the printed/exported page,
 * mirroring LessonPlanOfficialTable.
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

export default function SchemeOfWorkOfficialTable({ scheme }) {
  if (!scheme) return null
  const h = scheme.header || {}
  const subject = (h.subject || '').toUpperCase()

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-base font-bold tracking-[0.08em] uppercase">
          {subject} Schemes of Work
        </div>
        <div className="mt-1 text-[12px] font-bold">
          GRADE: {h.grade} &nbsp;·&nbsp; TERM {h.term} &nbsp; {h.year}
          {h.periodsPerWeek ? <> &nbsp;·&nbsp; PERIODS PER WEEK: {h.periodsPerWeek}</> : null}
        </div>
      </div>

      {/* Scheme grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border border-black min-w-[860px]">
          <thead>
            <tr className="align-bottom">
              <th className={`${TD} font-bold w-[4%]`}>WEEK</th>
              <th className={`${TD} font-bold w-[11%]`}>TOPIC</th>
              <th className={`${TD} font-bold w-[12%]`}>SUBTOPIC</th>
              <th className={`${TD} font-bold w-[17%]`}>SPECIFIC COMPETENCES</th>
              <th className={`${TD} font-bold w-[20%]`}>LEARNING ACTIVITIES</th>
              <th className={`${TD} font-bold w-[13%]`}>EXPECTED STANDARD</th>
              <th className={`${TD} font-bold w-[9%]`}>METHODS</th>
              <th className={`${TD} font-bold w-[9%]`}>T/L AIDS</th>
              <th className={`${TD} font-bold w-[6%]`}>REF</th>
            </tr>
          </thead>
          <tbody>
            {(scheme.weeks || []).map((w, i) => (
              <tr key={i}>
                <td className={`${TD} font-bold text-center`}>{w.week}</td>
                <td className={`${TD} font-bold`}>{w.topic}</td>
                <td className={TD}>{w.subtopic}</td>
                <td className={TD}><CellList items={w.specificCompetences} /></td>
                <td className={TD}><CellList items={w.learningActivities} /></td>
                <td className={TD}>{w.expectedStandard || '—'}</td>
                <td className={TD}><CellList items={w.methods} /></td>
                <td className={TD}><CellList items={w.tlAids} /></td>
                <td className={`${TD} text-[11px]`}>{w.references || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}
