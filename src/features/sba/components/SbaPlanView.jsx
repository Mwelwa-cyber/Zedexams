/**
 * Read-only rendering of a saved SBA Year Plan — used by the Library detail
 * view. Rebuilds the plan from the saved {subject, grade, statuses} and shows
 * overall + per-group progress with each task's status, without the controls.
 */

import { SBA_TASK_STATUSES, buildSbaPlan, normalizeSbaStatus } from '../../../utils/sbaPlanner'

const TONE_CLASSES = {
  slate: 'bg-slate-100 text-slate-600 border-slate-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  sky:   'bg-sky-100 text-sky-800 border-sky-300',
  green: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}
const STATUS_BY_VALUE = Object.fromEntries(SBA_TASK_STATUSES.map((s) => [s.value, s]))

export default function SbaPlanView({ plan: saved }) {
  if (!saved) return null
  const header = saved.header || {}
  const statuses = saved.statuses || {}
  const plan = buildSbaPlan(header.subject, header.grade, statuses)
  if (!plan) return null
  const summary = plan.summary

  return (
    <article className="space-y-4">
      <div>
        <h2 className="text-lg font-black theme-text">
          {header.subjectLabel} · {header.gradeLabel} — SBA Year Plan
        </h2>
        <p className="text-xs mt-0.5 theme-text-secondary">
          {[header.school, header.className, header.year].filter(Boolean).join(' · ')}
          {' '}· {plan.total} marks max → 10% · {summary.total} required tasks
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${summary.percentComplete}%` }} />
        </div>
        <span className="text-sm font-black text-emerald-700 whitespace-nowrap">
          {summary.done}/{summary.total} · {summary.percentComplete}%
        </span>
      </div>

      {plan.groups.map((g) => (
        <section key={g.group}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-black theme-text">{g.group}</h3>
            <span className="text-xs font-bold theme-text-secondary">
              {g.summary.done}/{g.summary.total} marked · {g.maxMarks} marks
            </span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {g.columns.map((c) => {
              const st = normalizeSbaStatus(statuses[c.key])
              const meta = STATUS_BY_VALUE[st]
              return (
                <div key={c.key} className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${TONE_CLASSES[meta.tone]}`}>
                  <span className="text-sm font-bold leading-tight">{c.label}</span>
                  <span className="text-[11px] font-bold opacity-80 whitespace-nowrap">/{c.max} · {meta.label}</span>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </article>
  )
}
