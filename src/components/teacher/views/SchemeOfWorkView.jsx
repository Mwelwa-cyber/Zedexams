/**
 * Read-only rendering of a validated scheme-of-work JSON object.
 * Shared by the Scheme of Work Generator, the Library detail view, public
 * shares, and the /teachers sample library.
 *
 * Two saved shapes exist:
 *   • official (v2 generator + sow-table sample): the CDC 9-column grid
 *     WEEK | TOPIC | SUBTOPIC | SPECIFIC COMPETENCES | LEARNING ACTIVITIES |
 *     EXPECTED STANDARD | METHODS | T/L AIDS | REF — serif on white with a
 *     black grid so it reads as the printed page, mirroring
 *     WeeklyForecastView / LessonPlanOfficialTable.
 *   • legacy (v1 generator): outcomes/materials/assessment weeks — kept so
 *     every scheme already in teachers' libraries still renders.
 */

import { renderText } from '../../../utils/mathRender'
import { isOfficialScheme } from '../../../utils/weeklyForecast'

export default function SchemeOfWorkView({ scheme }) {
  if (!scheme) return null
  return isOfficialScheme(scheme)
    ? <OfficialScheme scheme={scheme} />
    : <LegacyScheme scheme={scheme} />
}

/* ── Official 9-column CDC format ───────────────────────────── */

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-top text-left'

function DocCellList({ items }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : [])
  if (list.length === 0) return <>—</>
  if (list.length === 1) return <>{list[0]}</>
  return (
    <ul className="list-disc pl-3.5 space-y-0.5">
      {list.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

function OfficialScheme({ scheme }) {
  const h = scheme.header || {}
  const subject = (h.subject || '').toUpperCase()
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')

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
          GRADE: {gradeLabel} &nbsp;·&nbsp; TERM {h.term} &nbsp; {h.year}
          {h.periodsPerWeek ? <> &nbsp;·&nbsp; PERIODS PER WEEK: {h.periodsPerWeek}</> : null}
        </div>
      </div>

      {/* School / teacher line — generated schemes carry these; the
          marketing sample doesn't, so the line only prints when present. */}
      {(h.school || h.teacherName) && (
        <div className="mt-3 border-y-[1.5px] border-black py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
          <div><strong className="font-bold">NAME OF SCHOOL:</strong> {h.school || '_______________________'}</div>
          <div><strong className="font-bold">TEACHER&#x2019;S NAME:</strong> {h.teacherName || '_______________________'}</div>
        </div>
      )}

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
                <td className={TD}><DocCellList items={w.specificCompetences} /></td>
                <td className={TD}><DocCellList items={w.learningActivities} /></td>
                <td className={TD}>{w.expectedStandard || '—'}</td>
                <td className={TD}><DocCellList items={w.methods} /></td>
                <td className={TD}><DocCellList items={w.tlAids} /></td>
                <td className={`${TD} text-[11px]`}>{w.references || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

/* ── Legacy v1 format (outcomes / materials / assessment) ───── */

function LegacyScheme({ scheme }) {
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
        <div className="rounded-xl border theme-border p-4" style={{ background: '#fff5e6' }}>
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
