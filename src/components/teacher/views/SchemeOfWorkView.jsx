/**
 * Read-only rendering of a validated scheme-of-work JSON object.
 * Shared by the Scheme of Work Generator and the Library detail view.
 */

import { renderText } from '../../../utils/mathRender'

export default function SchemeOfWorkView({ scheme }) {
  if (!scheme) return null
  return (
    <article className="space-y-6">
      <HeaderBlock header={scheme.header} overview={scheme.overview} />
      <Section title="Weekly Plan">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-300 text-xs font-black uppercase tracking-wide text-slate-700">
                <th className="text-left px-3 py-2 border border-slate-300 w-12">Week</th>
                <th className="text-left px-3 py-2 border border-slate-300 w-56">Topic / Sub-topics</th>
                <th className="text-left px-3 py-2 border border-slate-300">Specific Outcomes</th>
                <th className="text-left px-3 py-2 border border-slate-300">Activities</th>
                <th className="text-left px-3 py-2 border border-slate-300">Materials</th>
                <th className="text-left px-3 py-2 border border-slate-300 w-44">Assessment</th>
              </tr>
            </thead>
            <tbody>
              {(scheme.weeks || []).map((w) => (
                <tr key={w.weekNumber} className="align-top border-b theme-border">
                  <td className="px-3 py-2 border theme-border font-black text-slate-700">
                    {w.weekNumber}
                  </td>
                  <td className="px-3 py-2 border theme-border">
                    <div className="font-bold theme-text">{renderText(w.topic)}</div>
                    {w.subtopics?.length > 0 && (
                      <ul className="mt-1 text-xs theme-text-secondary list-disc list-inside">
                        {w.subtopics.map((s, i) => <li key={i}>{renderText(s)}</li>)}
                      </ul>
                    )}
                    {w.references && (
                      <div className="mt-1 text-xs italic theme-text-secondary">
                        {w.references}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 border theme-border">
                    <CellList items={w.specificOutcomes} />
                    {(w.keyCompetencies?.length > 0 || w.values?.length > 0) && (
                      <div className="mt-2 text-[10px] theme-text-secondary">
                        {w.keyCompetencies?.length > 0 && (
                          <div>
                            <span className="font-bold">Competencies:</span>{' '}
                            {w.keyCompetencies.join(' · ')}
                          </div>
                        )}
                        {w.values?.length > 0 && (
                          <div>
                            <span className="font-bold">Values:</span>{' '}
                            {w.values.join(' · ')}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 border theme-border">
                    <CellList items={w.teachingLearningActivities} />
                  </td>
                  <td className="px-3 py-2 border theme-border">
                    <CellList items={w.materials} />
                  </td>
                  <td className="px-3 py-2 border theme-border text-xs">
                    {renderText(w.assessment) || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </article>
  )
}

function HeaderBlock({ header = {}, overview = {} }) {
  const rows = [
    ['School', header.school],
    ['Teacher', header.teacherName],
    ['Class', header.class],
    ['Subject', header.subject],
    ['Term', header.term],
    ['Weeks', header.numberOfWeeks],
    ['Academic Year', header.academicYear],
    ['Medium', header.mediumOfInstruction],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  return (
    <div className="space-y-3">
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

      {overview.termTheme && (
        <div className="rounded-xl border theme-border p-4 bg-teal-50/40">
          <p className="text-xs font-black uppercase tracking-wide theme-text-secondary mb-1">Term Theme</p>
          <p className="theme-text text-sm">{overview.termTheme}</p>
          {(overview.overallCompetencies?.length > 0 || overview.overallValues?.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {overview.overallCompetencies?.length > 0 && (
                <div>
                  <p className="text-xs font-bold theme-text mb-1">Key Competencies (Term)</p>
                  <CellList items={overview.overallCompetencies} />
                </div>
              )}
              {overview.overallValues?.length > 0 && (
                <div>
                  <p className="text-xs font-bold theme-text mb-1">Values (Term)</p>
                  <CellList items={overview.overallValues} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-base font-black theme-text mb-2 border-b theme-border pb-1">
        {title}
      </h3>
      {children}
    </div>
  )
}

function CellList({ items }) {
  if (!items?.length) return <span className="text-xs theme-text-secondary italic">—</span>
  return (
    <ul className="list-disc list-inside space-y-0.5 text-xs theme-text">
      {items.map((it, i) => <li key={i}>{renderText(it)}</li>)}
    </ul>
  )
}
