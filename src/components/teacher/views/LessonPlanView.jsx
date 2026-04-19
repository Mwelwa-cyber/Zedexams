/**
 * Read-only rendering of a validated lesson-plan JSON object.
 * Used by both the Lesson Plan Generator and the Library detail view.
 */

export default function LessonPlanView({ plan }) {
  if (!plan) return null
  return (
    <article className="space-y-6 print:space-y-4">
      <HeaderBlock header={plan.header} />
      <Section title="Specific Outcomes">
        <OrderedList items={plan.specificOutcomes} />
      </Section>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniSection title="Key Competencies" items={plan.keyCompetencies} />
        <MiniSection title="Values" items={plan.values} />
        <MiniSection title="Prerequisite Knowledge" items={plan.prerequisiteKnowledge} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MiniSection title="Teaching / Learning Materials" items={plan.teachingLearningMaterials} />
        <ReferencesBlock refs={plan.references} />
      </div>
      <Section title="Lesson Development">
        <PhaseBlock
          phase="Introduction"
          minutes={plan.lessonDevelopment?.introduction?.durationMinutes}
          teacher={plan.lessonDevelopment?.introduction?.teacherActivities}
          pupils={plan.lessonDevelopment?.introduction?.pupilActivities}
        />
        {(plan.lessonDevelopment?.development || []).map((step) => (
          <PhaseBlock
            key={step.stepNumber}
            phase={`Development — Step ${step.stepNumber}: ${step.title}`}
            minutes={step.durationMinutes}
            teacher={step.teacherActivities}
            pupils={step.pupilActivities}
          />
        ))}
        <PhaseBlock
          phase="Conclusion"
          minutes={plan.lessonDevelopment?.conclusion?.durationMinutes}
          teacher={plan.lessonDevelopment?.conclusion?.teacherActivities}
          pupils={plan.lessonDevelopment?.conclusion?.pupilActivities}
        />
      </Section>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Assessment">
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm mb-1">Formative</h4>
              <UnorderedList items={plan.assessment?.formative} />
            </div>
            {plan.assessment?.summative?.description && (
              <div>
                <h4 className="font-bold text-sm mb-1">Summative</h4>
                <p className="text-sm theme-text">{plan.assessment.summative.description}</p>
                {plan.assessment.summative.successCriteria && (
                  <p className="text-xs theme-text-secondary mt-1">
                    <span className="font-bold">Success criteria: </span>
                    {plan.assessment.summative.successCriteria}
                  </p>
                )}
              </div>
            )}
          </div>
        </Section>
        <Section title="Differentiation">
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm mb-1">For struggling pupils</h4>
              <UnorderedList items={plan.differentiation?.forStruggling} />
            </div>
            <div>
              <h4 className="font-bold text-sm mb-1">For advanced pupils</h4>
              <UnorderedList items={plan.differentiation?.forAdvanced} />
            </div>
          </div>
        </Section>
      </div>
      {plan.homework?.description && (
        <Section title="Homework">
          <p className="text-sm theme-text">{plan.homework.description}</p>
          {plan.homework.estimatedMinutes > 0 && (
            <p className="text-xs theme-text-secondary mt-1">
              Estimated time: {plan.homework.estimatedMinutes} minutes
            </p>
          )}
        </Section>
      )}
      <Section title="Teacher's Reflection (fill in after teaching)">
        <div className="text-sm theme-text-secondary italic">
          — What went well? What will you improve next time? Which pupils need follow-up?
        </div>
      </Section>
    </article>
  )
}

function HeaderBlock({ header = {} }) {
  const rows = [
    ['School', header.school],
    ['Teacher', header.teacherName],
    ['Date', header.date],
    ['Time', header.time],
    ['Duration', header.durationMinutes ? `${header.durationMinutes} min` : ''],
    ['Class', header.class],
    ['Subject', header.subject],
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Term & Week', header.termAndWeek],
    ['Number of Pupils', header.numberOfPupils],
    ['Medium', header.mediumOfInstruction],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  return (
    <div className="rounded-xl border theme-border overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v], idx) => (
            <tr key={k} className={idx % 2 === 0 ? 'bg-slate-50/50 dark:bg-slate-900/20' : ''}>
              <th className="px-3 py-2 text-left font-bold theme-text w-1/3">{k}</th>
              <td className="px-3 py-2 theme-text">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function MiniSection({ title, items }) {
  return (
    <div className="rounded-xl border theme-border p-3">
      <h4 className="font-bold text-sm mb-2 theme-text">{title}</h4>
      <UnorderedList items={items} />
    </div>
  )
}

function OrderedList({ items }) {
  if (!items?.length) return <p className="text-sm theme-text-secondary italic">—</p>
  return (
    <ol className="list-decimal list-inside space-y-1 text-sm theme-text">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ol>
  )
}

function UnorderedList({ items }) {
  if (!items?.length) return <p className="text-sm theme-text-secondary italic">—</p>
  return (
    <ul className="list-disc list-inside space-y-1 text-sm theme-text">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  )
}

function ReferencesBlock({ refs }) {
  return (
    <div className="rounded-xl border theme-border p-3">
      <h4 className="font-bold text-sm mb-2 theme-text">References</h4>
      {!refs?.length ? (
        <p className="text-sm theme-text-secondary italic">—</p>
      ) : (
        <ul className="space-y-1 text-sm theme-text">
          {refs.map((r, i) => (
            <li key={i}>
              <span className="font-bold">{r.title}</span>
              {r.publisher && <span> — {r.publisher}</span>}
              {r.pages && <span className="theme-text-secondary"> (pp. {r.pages})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PhaseBlock({ phase, minutes, teacher = [], pupils = [] }) {
  return (
    <div className="rounded-xl border theme-border overflow-hidden mb-3">
      <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b theme-border flex justify-between">
        <h4 className="font-bold text-sm theme-text">{phase}</h4>
        {minutes != null && (
          <span className="text-xs theme-text-secondary">{minutes} min</span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x theme-border">
        <div className="p-3">
          <h5 className="text-xs uppercase font-bold theme-text-secondary mb-2">
            Teacher's Activities
          </h5>
          <UnorderedList items={teacher} />
        </div>
        <div className="p-3">
          <h5 className="text-xs uppercase font-bold theme-text-secondary mb-2">
            Pupils' Activities
          </h5>
          <UnorderedList items={pupils} />
        </div>
      </div>
    </div>
  )
}
