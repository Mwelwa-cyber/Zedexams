/**
 * Read-only rendering of a generated SBA task. Shared by the SBA Studio and
 * the Library detail view. `showAnswers` toggles the model answers, mark
 * allocations and marking scheme (the learner-facing view hides them).
 */

const STYLE_LABELS = {
  answer_key: 'Answer key',
  oral_observation: 'Oral observation sheet',
  method_marks: 'Method & accuracy marks',
  experiment_rubric: 'Experiment rubric',
  project_rubric: 'Project rubric',
  competence_rubric: 'Competence rubric',
  criteria_rubric: 'Marking criteria',
}

export default function SbaTaskView({ task, showAnswers = true }) {
  if (!task) return null
  const header = task.header || {}
  const ms = task.markingScheme || {}
  const meta = [
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Task type', header.taskType],
    ['Component', header.component],
    ['Skill', header.skill],
    ['Term', header.term],
    ['Duration', header.duration],
    ['Bloom', (header.bloomLevels || []).join(', ')],
    ['Outcomes', (header.outcomeRefs || []).join(', ')],
    ['Total marks', header.totalMarks != null ? String(header.totalMarks) : ''],
  ].filter(([, v]) => v)

  return (
    <article className="space-y-5">
      <div>
        <h2 className="text-lg font-black theme-text">{header.title || 'SBA Task'}</h2>
        <p className="text-[11px] uppercase tracking-wide theme-text-secondary mt-0.5">
          School Based Assessment · ECZ
        </p>
      </div>

      <div className="rounded-xl border theme-border overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {meta.map(([k, v], idx) => (
              <tr key={k} className={idx % 2 === 0 ? 'bg-slate-50/50' : ''}>
                <th className="px-3 py-1.5 text-left font-bold theme-text w-1/3">{k}</th>
                <td className="px-3 py-1.5 theme-text">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {task.instructions && (
        <Section title="Teacher’s instructions">
          <p className="text-sm theme-text whitespace-pre-line">{task.instructions}</p>
        </Section>
      )}

      {task.stimulus && (
        <Section title="Stimulus">
          <div className="rounded-xl border theme-border bg-amber-50/40 p-4 text-sm theme-text whitespace-pre-line">
            {task.stimulus}
          </div>
        </Section>
      )}

      {Array.isArray(task.questions) && task.questions.length > 0 && (
        <Section title={showAnswers ? 'Tasks and marking' : 'Tasks'}>
          <ol className="space-y-3">
            {task.questions.map((q, idx) => (
              <li key={idx} className="text-sm">
                <div className="flex items-start gap-2">
                  <span className="font-black theme-text">{q.number}.</span>
                  <span className="flex-1 theme-text">{q.prompt}</span>
                  {q.marks ? (
                    <span className="font-black theme-text-secondary whitespace-nowrap">[{q.marks}]</span>
                  ) : null}
                </div>
                {showAnswers && q.answer && (
                  <p className="ml-5 mt-1 text-emerald-700">
                    <span className="font-bold">Answer:</span> {q.answer}
                  </p>
                )}
                {showAnswers && Array.isArray(q.markAllocation) && q.markAllocation.length > 0 && (
                  <ul className="ml-8 mt-1 list-disc text-xs theme-text-secondary">
                    {q.markAllocation.map((m, i) => (
                      <li key={i}>{m.description}{m.marks ? ` (${m.marks})` : ''}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {showAnswers && (ms.notes || (ms.criteria || []).length > 0) && (
        <Section title={`Marking scheme — ${STYLE_LABELS[ms.style] || 'Marking'}`}>
          {ms.notes && <p className="text-sm theme-text mb-2">{ms.notes}</p>}
          {Array.isArray(ms.criteria) && ms.criteria.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-700">
                    <th className="text-left px-3 py-2 border border-slate-300">Criterion</th>
                    <th className="text-center px-3 py-2 border border-slate-300 w-16">Marks</th>
                    <th className="text-left px-3 py-2 border border-slate-300">What earns the marks</th>
                  </tr>
                </thead>
                <tbody>
                  {ms.criteria.map((c, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="px-3 py-2 border theme-border font-bold theme-text">{c.name}</td>
                      <td className="px-3 py-2 border theme-border text-center font-black text-slate-700">{c.maxMarks}</td>
                      <td className="px-3 py-2 border theme-border theme-text">{c.descriptor || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-black">
                    <td className="px-3 py-2 border border-slate-300 text-right">Total</td>
                    <td className="px-3 py-2 border border-slate-300 text-center">
                      {ms.criteria.reduce((s, c) => s + (Number(c.maxMarks) || 0), 0)}
                    </td>
                    <td className="px-3 py-2 border border-slate-300" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Section>
      )}
    </article>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-base font-black theme-text mb-2 border-b theme-border pb-1">{title}</h3>
      {children}
    </section>
  )
}
