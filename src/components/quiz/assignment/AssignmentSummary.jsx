/**
 * Read-only "review & confirm" panel shown at the end of the
 * assignment wizard. Surfaces what the teacher chose so they can
 * spot mistakes before the assignment fans out.
 */

import { SUBJECTS } from '../../../config/curriculum'
import { getTemplate } from '../../../utils/assignmentTemplates'

function fmtDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime?.() ?? NaN)) return null
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function AssignmentSummary({
  mode,
  targets = [],
  options = {},
  template = null,
  quizTitle = '',
}) {
  const subjects = SUBJECTS
  const tpl = template ? getTemplate(template) : null
  const openLabel = fmtDate(options.openAt)
  const dueLabel = fmtDate(options.dueAt)
  const totalLearners = targets.reduce(
    (sum, t) => sum + (Array.isArray(t.classLearners) ? t.classLearners.length : 0),
    0,
  )

  return (
    <section className="surface space-y-4 p-4 sm:p-5">
      <header className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">📋</span>
        <h3 className="theme-text text-base font-black">Review assignment</h3>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="Quiz" value={quizTitle || 'Untitled quiz'} />
        <Row
          label="Mode"
          value={mode === 'automatic' ? '⚡ Automatic' : '🎯 Manual'}
        />
        <Row
          label="Template"
          value={tpl ? `${tpl.icon} ${tpl.label}` : 'Custom'}
        />
        <Row
          label="Classes"
          value={targets.length === 0
            ? 'None selected yet'
            : `${targets.length} class${targets.length === 1 ? '' : 'es'}`}
        />
        {totalLearners > 0 && (
          <Row label="Approx. learners reached" value={`${totalLearners}`} />
        )}
        {openLabel && <Row label="Opens" value={openLabel} />}
        {dueLabel && <Row label="Closes" value={dueLabel} />}
      </dl>

      {targets.length > 0 && (
        <div>
          <p className="theme-text-muted text-xs font-black uppercase tracking-widest mb-1.5">
            Will be assigned to
          </p>
          <ul className="theme-card theme-border rounded-2xl border divide-y divide-current/10 overflow-hidden">
            {targets.slice(0, 6).map((target) => {
              const subjectMeta = subjects.find((s) => s.id === target.classSubject)
              return (
                <li key={target.classId} className="p-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="theme-text font-bold truncate">{target.className || 'Class'}</p>
                    <p className="theme-text-muted text-xs truncate">
                      Grade {target.classGrade}
                      {subjectMeta ? ` · ${subjectMeta.label}` : ''}
                      {Array.isArray(target.classLearners)
                        ? ` · ${target.classLearners.length} learner${target.classLearners.length === 1 ? '' : 's'}`
                        : ''}
                      {Array.isArray(target.learnerUids) && target.learnerUids.length > 0
                        ? ` · scoped to ${target.learnerUids.length}`
                        : ''}
                    </p>
                  </div>
                </li>
              )
            })}
            {targets.length > 6 && (
              <li className="p-3 text-xs theme-text-muted">
                +{targets.length - 6} more class{targets.length - 6 === 1 ? '' : 'es'}…
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {options.timed && <Chip>⏱️ Timed</Chip>}
        {options.shuffleQuestions && <Chip>🔀 Shuffled</Chip>}
        {options.allowRetakes && <Chip>🔁 Retakes</Chip>}
        {options.lockAfterSubmission && <Chip>🔒 Lock on submit</Chip>}
        {options.notifyLearners !== false && <Chip>🔔 Notify learners</Chip>}
        {options.addToDailyChallenge && <Chip>🌟 Daily challenge</Chip>}
      </div>
    </section>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-black uppercase tracking-widest theme-text-muted">{label}</dt>
      <dd className="theme-text text-sm font-bold">{value}</dd>
    </div>
  )
}

function Chip({ children }) {
  return (
    <span className="rounded-full theme-bg-subtle px-2.5 py-1 text-xs font-bold theme-text">
      {children}
    </span>
  )
}
