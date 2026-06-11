/**
 * ReportCardView — one pupil's end-of-term progress report, exactly as
 * reportCardsToDocx.js prints it (one A4 page per pupil): school head,
 * POSITION IN CLASS, the SUBJECT | MARK | OUT OF | % table with a TOTAL
 * row, the class teacher's comment pre-filled from the mark schedule,
 * and the blank lines schools complete by hand. Serif on white with a
 * black grid so it reads as the printed page, like the other official
 * views.
 *
 * Takes one `card` from buildReportCards() plus the schedule `header`.
 */

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-top'
const BLANK = '____________________'

export default function ReportCardView({ card, header }) {
  if (!card) return null
  const h = header || {}
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-5 py-6 sm:px-8 text-[13px] max-w-2xl mx-auto"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-lg font-bold tracking-[0.06em] uppercase">{h.school}</div>
        <div className="mt-1 text-[13px] font-bold uppercase">
          End of Term {h.term} Progress Report — {h.year}
        </div>
      </div>

      {/* Pupil line */}
      <div className="mt-5 space-y-1.5">
        <div>
          <strong className="font-bold">NAME:</strong> {card.name || BLANK}
          <span className="ml-6"><strong className="font-bold">GRADE:</strong> {gradeLabel}</span>
        </div>
        <div>
          <strong className="font-bold">POSITION IN CLASS:</strong> {card.position} of {card.classSize}
          <span className="ml-6"><strong className="font-bold">AVERAGE:</strong> {card.averagePercent}%</span>
        </div>
      </div>

      {/* Marks table */}
      <table className="mt-4 w-full border-collapse border border-black">
        <thead>
          <tr>
            <th className={`${TD} font-bold text-left w-[46%]`}>SUBJECT</th>
            <th className={`${TD} font-bold text-center w-[18%]`}>MARK</th>
            <th className={`${TD} font-bold text-center w-[18%]`}>OUT OF</th>
            <th className={`${TD} font-bold text-center w-[18%]`}>%</th>
          </tr>
        </thead>
        <tbody>
          {card.rows.map((r, i) => (
            <tr key={i}>
              <td className={`${TD} font-bold text-left`}>{r.subject}</td>
              <td className={`${TD} text-center`}>{r.mark}</td>
              <td className={`${TD} text-center`}>{r.max}</td>
              <td className={`${TD} text-center`}>{r.mark === '' ? '' : r.percent}</td>
            </tr>
          ))}
          <tr>
            <td className={`${TD} font-bold text-left`}>TOTAL</td>
            <td className={`${TD} font-bold text-center`}>{card.total}</td>
            <td className={`${TD} font-bold text-center`}>{card.maxTotal}</td>
            <td className={`${TD} font-bold text-center`}>{card.averagePercent}</td>
          </tr>
        </tbody>
      </table>

      {/* Comments + hand-completed lines */}
      <div className="mt-5 space-y-4">
        <div>
          <div className="font-bold">CLASS TEACHER&#x2019;S COMMENT:</div>
          <p className="mt-1">{card.comment || BLANK}</p>
          <div className="mt-2 border-b border-black/60" aria-hidden="true" />
        </div>
        <div>
          <div className="font-bold">HEAD TEACHER&#x2019;S COMMENT:</div>
          <div className="mt-5 border-b border-black/60" aria-hidden="true" />
          <div className="mt-5 border-b border-black/60" aria-hidden="true" />
        </div>
        <div className="pt-1">
          <strong className="font-bold">NEXT TERM OPENS:</strong> {h.nextTermOpens || BLANK}
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-2 pt-1">
          <span><strong className="font-bold">CLASS TEACHER&#x2019;S SIGNATURE:</strong> ______________</span>
          <span><strong className="font-bold">HEAD TEACHER&#x2019;S SIGNATURE:</strong> ______________</span>
        </div>
      </div>
    </article>
  )
}
