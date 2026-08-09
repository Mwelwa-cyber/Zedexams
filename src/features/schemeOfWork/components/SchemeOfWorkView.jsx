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
import {
  schemeColumns,
  schemeCurriculum,
  curriculumLabel,
  cleanCellText,
  cleanCellList,
} from '../../../utils/schemeFormat'

export default function SchemeOfWorkView({ scheme }) {
  if (!scheme) return null
  return isOfficialScheme(scheme)
    ? <OfficialScheme scheme={scheme} />
    : <LegacyScheme scheme={scheme} />
}

/* ── Official 9-column CDC format ───────────────────────────── */

// Times New Roman is the standard for official Zambian scheme-of-work
// documents and matches the .pdf export, so the on-screen preview reads as the
// real printed page. One consistent size across the whole grid — no cell is
// bigger or smaller than another.
const DOC_FONT = { fontFamily: "'Times New Roman', Georgia, 'Nimbus Roman', serif" }
const TD = 'border border-black px-2 py-1.5 align-top text-left text-[12px] leading-snug'

/* Provenance of a scheme's topics. The source badges/legend were removed from
 * the printed page so it reads as a clean official document; SOURCE_META stays
 * exported for the studio's advisory panel (curriculum-source note). */
export const SOURCE_META = {
  syllabi_studio: { label: 'Syllabi Studio', short: 'Syllabi', bg: '#dcfce7', fg: '#166534' },
  uploaded_module: { label: 'Uploaded module', short: 'Module', bg: '#dbeafe', fg: '#1e40af' },
  ai_inferred: { label: 'General CBC (AI)', short: 'AI', bg: '#fef3c7', fg: '#92400e' },
  teacher: { label: 'Teacher', short: 'Teacher', bg: '#f3e8ff', fg: '#6b21a8' },
}

function DocCellList({ items }) {
  const list = cleanCellList(items)
  if (list.length === 0) return <>—</>
  if (list.length === 1) return <>{list[0]}</>
  return (
    <ul className="list-disc pl-3.5 space-y-0.5">
      {list.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

/** Render one week's value for a column descriptor (week | text | list). */
function OfficialCell({ week, col }) {
  if (col.type === 'week') {
    return <td className={`${TD} font-bold text-center`}>{week.week}</td>
  }
  if (col.key === 'topic') {
    return <td className={`${TD} font-bold`}>{cleanCellText(week.topic) || '—'}</td>
  }
  if (col.type === 'list') {
    return <td className={TD}><DocCellList items={week[col.key]} /></td>
  }
  return <td className={TD}>{cleanCellText(week[col.key]) || '—'}</td>
}

function OfficialScheme({ scheme }) {
  const h = scheme.header || {}
  const subject = (h.subject || '').toUpperCase()
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  // CBC (9-column) vs OBC (7-column) — one column spec shared with the
  // exporters + the editable table so the printed page never diverges.
  const curriculum = schemeCurriculum(scheme)
  const columns = schemeColumns(curriculum)
  // 9-column CBC only fits landscape; OBC's 7 columns are narrower.
  const minWidth = curriculum === 'obc' ? 640 : 860

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px] leading-snug"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-[18px] font-bold tracking-[0.06em] uppercase">
          {subject} Schemes of Work
        </div>
        <div className="mt-1.5 text-[13px] font-bold tracking-[0.01em]">
          GRADE: {gradeLabel} &nbsp;·&nbsp; TERM {h.term} &nbsp; {h.year}
          {h.periodsPerWeek ? <> &nbsp;·&nbsp; PERIODS PER WEEK: {h.periodsPerWeek}</> : null}
        </div>
        <div className="mt-1 text-[11px] font-bold tracking-[0.14em] uppercase" style={{ color: '#555' }}>
          {curriculumLabel(curriculum)} · {curriculum === 'obc' ? 'Outcome-Based' : 'Competency-Based'} Curriculum
        </div>
      </div>

      {/* School / teacher line — generated schemes carry these; the
          marketing sample doesn't, so the line only prints when present. */}
      {(h.school || h.teacherName) && (
        <div className="mt-3.5 border-y-[1.5px] border-black py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-[12.5px]">
          <div><strong className="font-bold">NAME OF SCHOOL:</strong> {h.school || '_______________________'}</div>
          <div><strong className="font-bold">TEACHER&#x2019;S NAME:</strong> {h.teacherName || '_______________________'}</div>
        </div>
      )}

      {/* Scheme grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border border-black" style={{ minWidth }}>
          <thead>
            <tr className="align-bottom">
              {columns.map((col) => (
                <th key={col.key} className={`${TD} font-bold`} style={{ width: `${col.width}%` }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(scheme.weeks || []).map((w, i) => (
              <tr key={i}>
                {columns.map((col) => <OfficialCell key={col.key} week={w} col={col} />)}
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
