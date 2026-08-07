/**
 * Read-only rendering of a validated rubric JSON object.
 * Shared by the Rubric Generator and the Library detail view.
 */

const LEVEL_COLOURS = {
  'Excellent':         'bg-emerald-50 text-emerald-900 border-emerald-200',
  'Good':              'bg-sky-50     text-sky-900     border-sky-200',
  'Satisfactory':      'bg-amber-50   text-amber-900   border-amber-200',
  'Needs Improvement': 'bg-rose-50    text-rose-900    border-rose-200',
}

export default function RubricView({ rubric }) {
  if (!rubric) return null
  return (
    <article className="space-y-5">
      <HeaderBlock header={rubric.header} />

      {rubric.markingNotes && (
        <div className="rounded-xl border theme-border p-4 bg-slate-50/60">
          <p className="text-xs font-black uppercase tracking-wide theme-text-secondary mb-1">
            Marking Notes
          </p>
          <p className="text-sm theme-text">{rubric.markingNotes}</p>
        </div>
      )}

      <section>
        <h3 className="text-base font-black theme-text mb-2 border-b theme-border pb-1">
          Criteria
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-700">
                <th className="text-left px-3 py-2 border border-slate-300 w-48">Criterion</th>
                <th className="text-center px-3 py-2 border border-slate-300 w-16">Marks</th>
                {['Excellent', 'Good', 'Satisfactory', 'Needs Improvement'].map((name) => (
                  <th key={name} className="text-left px-3 py-2 border border-slate-300">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rubric.criteria || []).map((c, idx) => (
                <tr key={idx} className="align-top border-b theme-border">
                  <td className="px-3 py-2 border theme-border font-bold theme-text">
                    {c.name}
                    {c.keyCompetencies?.length > 0 && (
                      <div className="mt-1 text-[10px] theme-text-secondary">
                        {c.keyCompetencies.join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 border theme-border text-center font-black text-slate-700">
                    {c.maxMarks}
                  </td>
                  {(c.levels || []).map((lvl) => (
                    <td
                      key={lvl.levelName}
                      className={`px-3 py-2 border theme-border text-xs ${LEVEL_COLOURS[lvl.levelName] || ''}`}
                    >
                      <div className="font-black mb-0.5">
                        {lvl.marks} {lvl.marks === 1 ? 'mark' : 'marks'}
                      </div>
                      <div>{lvl.descriptor || '—'}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-black">
                <td className="px-3 py-2 border border-slate-300 text-right">Total</td>
                <td className="px-3 py-2 border border-slate-300 text-center">
                  {rubric.header?.totalMarks || 0}
                </td>
                <td colSpan={4} className="px-3 py-2 border border-slate-300" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {rubric.header?.gradeBands?.length > 0 && (
        <section>
          <h3 className="text-base font-black theme-text mb-2 border-b theme-border pb-1">
            Overall Grade Bands
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {rubric.header.gradeBands.map((b, i) => (
              <div key={i} className="rounded-xl border-2 theme-border p-3 text-center">
                <div className="text-2xl font-black theme-text">{b.symbol}</div>
                <div className="text-xs font-bold theme-text mt-1">{b.name}</div>
                <div className="text-xs theme-text-secondary">{b.range}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}

function HeaderBlock({ header = {} }) {
  const rows = [
    ['Task', header.taskDescription || header.taskType],
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Task type', header.taskType],
    ['Total marks', header.totalMarks],
    ['Assessment type', header.assessmentType],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  return (
    <div className="rounded-xl border theme-border overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v], idx) => (
            <tr key={k} className={idx % 2 === 0 ? 'bg-slate-50/50' : ''}>
              <th className="px-3 py-2 text-left font-bold theme-text w-1/3">{k}</th>
              <td className="px-3 py-2 theme-text">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
