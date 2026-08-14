/**
 * Read-only rendering of a generated SBA task. Shared by the SBA Studio and
 * the Library detail view.
 *
 * The task itself is drawn as a real school exam paper (the same marble-banner
 * layout the Assessment Studio uses) via `buildSbaPaperBlocks` → `PaperDocument`,
 * so what the teacher previews matches a printed paper. `showAnswers` adds the
 * teacher's marking scheme (model answers, per-step mark allocation and the
 * rubric/criteria table) beneath the paper — the learner-facing view hides it.
 */

import { PaperDocument } from '../../../engines/paper-render/PaperBlocks'
import { buildSbaPaperBlocks } from '../../../shared/utils/sbaTaskToPaper'

const STYLE_LABELS = {
  answer_key: 'Answer key',
  oral_observation: 'Oral observation sheet',
  method_marks: 'Method & accuracy marks',
  experiment_rubric: 'Experiment rubric',
  project_rubric: 'Project rubric',
  competence_rubric: 'Competence rubric',
  criteria_rubric: 'Marking criteria',
}

export default function SbaTaskView({ task, showAnswers = true, schoolName }) {
  if (!task) return null
  const header = task.header || {}
  const ms = task.markingScheme || {}
  const questions = Array.isArray(task.questions) ? task.questions : []
  // The school name on the banner: an explicit prop (the studio's editable
  // field / the teacher's profile) wins, else whatever was saved on the task.
  const blocks = buildSbaPaperBlocks(task, { schoolName: schoolName || header.schoolName || '' })

  // Teacher administration guidance — how to set up / run the task. Kept off
  // the learner's paper; it belongs with the marking scheme.
  const administration = String(task.administration || '').trim()

  // Teacher-only metadata that doesn't belong on the learner's paper.
  const meta = [
    ['Task type', header.taskType],
    ['Component', header.component],
    ['Skill', header.skill],
    ['Bloom level(s)', (header.bloomLevels || []).join(', ')],
    ['Syllabus outcome(s)', (header.outcomeRefs || []).join(', ')],
  ].filter(([, v]) => v)

  const hasMarking = (showAnswers && (
    questions.some((q) => q.answer || (q.markAllocation || []).length) ||
    ms.notes ||
    (ms.criteria || []).length > 0 ||
    administration ||
    meta.length > 0
  ))

  return (
    <div className="space-y-5">
      {/* The task as a printable school paper */}
      <PaperDocument blocks={blocks} />

      {/* Teacher's marking scheme — hidden on the learner copy */}
      {hasMarking && (
        <div className="rounded-xl border theme-border bg-white p-4 sm:p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="text-base">🗝️</span>
            <h3 className="text-base font-black theme-text">
              Marking scheme — {STYLE_LABELS[ms.style] || 'Marking'}
            </h3>
          </div>

          {meta.length > 0 && (
            <div className="rounded-lg border theme-border overflow-hidden">
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
          )}

          {administration && (
            <Section title="How to administer this task">
              {administration.split(/\n\s*\n/).filter((p) => p.trim()).map((p, i) => (
                <p key={i} className="text-sm theme-text mb-2 whitespace-pre-line">{p}</p>
              ))}
            </Section>
          )}

          {questions.some((q) => q.answer || (q.markAllocation || []).length > 0) && (
            <Section title="Model answers & mark allocation">
              <ol className="space-y-3">
                {questions.map((q, idx) => (
                  <li key={idx} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="font-black theme-text">{q.number}.</span>
                      <span className="flex-1 theme-text">{q.prompt}</span>
                      {q.marks ? (
                        <span className="font-black theme-text-secondary whitespace-nowrap">[{q.marks}]</span>
                      ) : null}
                    </div>
                    {q.answer && (
                      <p className="ml-5 mt-1 text-emerald-700">
                        <span className="font-bold">Answer:</span> {q.answer}
                      </p>
                    )}
                    {Array.isArray(q.markAllocation) && q.markAllocation.length > 0 && (
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

          {(ms.notes || (ms.criteria || []).length > 0) && (
            <Section title="How to award the marks">
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
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h4 className="text-sm font-black theme-text mb-2 border-b theme-border pb-1">{title}</h4>
      {children}
    </section>
  )
}
