/**
 * Read-only rendering of a saved SBA mark sheet — used by the Library detail
 * view. Mirrors the SBA Mark Tracker's table (task columns grouped by
 * term/skill, raw total, converted 10%-per-grade SBA mark) without the inputs.
 */

import { convertSbaMark } from '../../../config/sba'

export default function SbaTrackerView({ sheet }) {
  if (!sheet) return null
  const header = sheet.header || {}
  const columns = sheet.columns || []
  const total = Number(sheet.total) || 0
  const pupils = sheet.pupils || []

  // Group columns into header bands (Term 1 / Listening & Speaking / …).
  const groups = []
  for (const c of columns) {
    const last = groups[groups.length - 1]
    if (last && last.group === c.group) last.span += 1
    else groups.push({ group: c.group, span: 1 })
  }

  return (
    <article className="space-y-4">
      <div>
        <h2 className="text-lg font-black theme-text">
          {header.subjectLabel} · {header.gradeLabel} — SBA Mark Sheet
        </h2>
        <p className="text-xs mt-0.5 theme-text-secondary">
          {[header.school, header.className, header.year].filter(Boolean).join(' · ')}
          {' '}· maximum {total} marks → 10%
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm border-collapse min-w-[640px]">
          <thead>
            <tr className="text-[11px] font-black uppercase tracking-wide" style={{ color: '#566f76' }}>
              <th className="py-1.5 pr-2 w-8 text-left" rowSpan={2}>SN</th>
              <th className="py-1.5 pr-2 text-left" rowSpan={2}>Pupil's name</th>
              {groups.map((g, i) => (
                <th key={i} colSpan={g.span} className="py-1 px-1 text-center border-b theme-border">{g.group}</th>
              ))}
              <th className="py-1.5 px-2 text-center" rowSpan={2}>Total<br />/{total}</th>
              <th className="py-1.5 px-2 text-center text-emerald-700" rowSpan={2}>SBA<br />/10</th>
            </tr>
            <tr className="text-[10px] font-bold" style={{ color: '#7a8e94' }}>
              {columns.map((c) => (
                <th key={c.key} className="py-1 px-1 text-center align-bottom" title={c.label}>
                  <span className="block max-w-[64px] truncate mx-auto">{c.label}</span>
                  <span className="opacity-60">/{c.max}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pupils.map((p, idx) => {
              const raw = columns.reduce((s, c) => s + (Number(p.marks?.[c.key]) || 0), 0)
              const conv = convertSbaMark(raw, total).rounded
              return (
                <tr key={idx} className="border-t theme-border">
                  <td className="py-1.5 pr-2 text-xs theme-text-secondary">{idx + 1}</td>
                  <td className="py-1.5 pr-2 font-bold theme-text">{p.name}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="py-1.5 px-1 text-center theme-text">
                      {p.marks?.[c.key] != null ? p.marks[c.key] : ''}
                    </td>
                  ))}
                  <td className="py-1.5 px-2 text-center font-bold theme-text">{raw}</td>
                  <td className="py-1.5 px-2 text-center font-black text-emerald-700">{conv}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </article>
  )
}
