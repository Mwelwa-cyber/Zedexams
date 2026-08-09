/**
 * RecordOfWorkView — the official record-of-work document Zambian
 * teachers keep as the term runs: one row per week logging what was
 * ACTUALLY taught, with a remarks column (coverage + notes) and the
 * checked-by signature block head teachers sign during inspection.
 *
 *   WEEK | WEEK ENDING | TOPIC | SUB-TOPIC | WORK DONE | REMARKS
 *
 * Shared by the Record of Work studio and the teacher library detail
 * view. Reads a `weeks[]` artifact. Serif on white with a black grid so
 * it reads as the printed/exported page, mirroring WeeklyForecastView.
 */

import { printedRemark } from '../../../shared/utils/recordOfWork'

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

export default function RecordOfWorkView({ record }) {
  if (!record) return null
  const h = record.header || {}
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const subject = (h.subject || '').toUpperCase()
  const weeks = record.weeks || []

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-base font-bold tracking-[0.08em] uppercase">
          Grade {gradeLabel} {subject} Record of Work
        </div>
        <div className="mt-1 text-[12px] font-bold">
          TERM {h.term} &nbsp;·&nbsp; YEAR: {h.year}
        </div>
      </div>

      {/* Fill-in header line */}
      <div className="mt-3 border-y-[1.5px] border-black py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
        <div><strong className="font-bold">NAME OF SCHOOL:</strong> {h.school || '_______________________'}</div>
        <div><strong className="font-bold">TEACHER&#x2019;S NAME:</strong> {h.teacherName || '_______________________'}</div>
      </div>

      {/* Record grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border border-black min-w-[860px]">
          <thead>
            <tr className="align-bottom">
              <th className={`${TD} font-bold w-[5%]`}>WEEK</th>
              <th className={`${TD} font-bold w-[10%]`}>WEEK ENDING</th>
              <th className={`${TD} font-bold w-[16%]`}>TOPIC</th>
              <th className={`${TD} font-bold w-[16%]`}>SUB-TOPIC</th>
              <th className={`${TD} font-bold w-[33%]`}>WORK DONE</th>
              <th className={`${TD} font-bold w-[20%]`}>REMARKS</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={i}>
                <td className={`${TD} font-bold text-center`}>{w.week}</td>
                <td className={TD}>{w.weekEnding || ''}</td>
                <td className={`${TD} font-bold`}>{w.topic}</td>
                <td className={TD}>{w.subtopic}</td>
                <td className={TD}><CellList items={w.workDone} /></td>
                <td className={TD}>{printedRemark(w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Signature block — the record of work is a checked document */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
        <div><strong className="font-bold">TEACHER&#x2019;S SIGNATURE:</strong> ______________________ <strong className="font-bold">DATE:</strong> ____________</div>
        <div><strong className="font-bold">CHECKED BY (H.O.D / HEAD TEACHER):</strong> ______________________ <strong className="font-bold">DATE:</strong> ____________</div>
      </div>
    </article>
  )
}
