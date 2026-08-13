/**
 * Read-only rendering of a validated lesson-plan JSON object.
 * Used by the Lesson Plan Generator, the Library detail view, and the
 * public share viewer.
 *
 * Supports three schemas:
 *   • v3 (official CDC module structure) — stages array (INTRODUCTION →
 *     LESSON DEVELOPMENT → EXERCISE/ASSESSMENT → HOMEWORK → CONCLUSION),
 *     generalCompetences, specificCompetence, rationale, expectedStandard.
 *   • v2 (Bernard Tito CBC) — lessonProgression (5E), lessonGoal,
 *     lessonCompetencies, methodology, learningEnvironment, etc.
 *   • v1 (legacy) — lessonDevelopment (Introduction/Development/Conclusion),
 *     specificOutcomes, keyCompetencies, values.
 * Detection is by field presence so older saved plans render without error.
 */

import { renderText } from '../../../utils/mathRender'

export default function LessonPlanView({ plan }) {
  if (!plan) return null
  const isV3 = Array.isArray(plan.stages) || plan.schemaVersion === '3.0'
  if (isV3) return <LessonPlanViewV3 plan={plan} />
  const isV2 = !!plan.lessonProgression || !!plan.lessonCompetencies || plan.schemaVersion === '2.0'
  return isV2 ? <LessonPlanViewV2 plan={plan} /> : <LessonPlanViewV1 plan={plan} />
}

/**
 * v3 — mirrors the SAMPLE LESSON PLAN appendix of the official CDC
 * teaching modules: field sections in the official order, then the
 * lesson progression as one block per stage with teacher activities,
 * learner activities and assessment criteria, closing with remedial
 * work / extension and the blank LESSON EVALUATION.
 */
function LessonPlanViewV3({ plan }) {
  const le = plan.learningEnvironment || {}
  return (
    <article className="space-y-6 print:space-y-4">
      <HeaderBlock header={plan.header} />

      <LessonIllustration diagram={plan.lessonDiagram} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MiniSection title="General Competences" items={plan.generalCompetences} />
        <div className="rounded-xl border theme-border p-3">
          <h4 className="font-bold text-sm mb-2 theme-text">Specific Competence</h4>
          {plan.specificCompetence
            ? <p className="text-sm theme-text">{renderText(plan.specificCompetence)}</p>
            : <p className="text-sm theme-text-secondary italic">—</p>}
        </div>
      </div>

      {plan.lessonGoal && (
        <Section title="Lesson Goal">
          <p className="text-sm theme-text leading-relaxed">{renderText(plan.lessonGoal)}</p>
        </Section>
      )}

      {plan.rationale && (
        <Section title="Rationale">
          <p className="text-sm theme-text leading-relaxed">{renderText(plan.rationale)}</p>
        </Section>
      )}

      {plan.priorKnowledge && (
        <Section title="Prior Knowledge">
          <p className="text-sm theme-text leading-relaxed">{renderText(plan.priorKnowledge)}</p>
        </Section>
      )}

      {plan.references?.length > 0 && (
        <Section title="References">
          <UnorderedList items={plan.references} />
        </Section>
      )}

      <Section title="Learning Environment">
        <div className="text-sm space-y-1">
          <p className="theme-text"><span className="font-bold">Natural: </span>{le.natural ? renderText(le.natural) : '—'}</p>
          <p className="theme-text"><span className="font-bold">Artificial: </span>{le.artificial ? renderText(le.artificial) : '—'}</p>
          <p className="theme-text"><span className="font-bold">Technological: </span>{le.technological ? renderText(le.technological) : '—'}</p>
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MiniSection title="Teaching and Learning Materials/Resources" items={plan.materials} />
        <div className="rounded-xl border theme-border p-3">
          <h4 className="font-bold text-sm mb-2 theme-text">Expected Standard</h4>
          {plan.expectedStandard
            ? <p className="text-sm theme-text">{renderText(plan.expectedStandard)}</p>
            : <p className="text-sm theme-text-secondary italic">—</p>}
        </div>
      </div>

      <Section title="Lesson Progression">
        {(plan.stages || []).map((s, i) => (
          <PhaseBlock
            key={i}
            phase={s.name || 'STAGE'}
            minutes={s.durationMinutes > 0 ? s.durationMinutes : null}
            teacher={s.teacherActivities}
            pupils={s.learnerActivities}
            criteria={s.assessmentCriteria}
          />
        ))}
      </Section>

      {(plan.remedialWork || plan.extensionActivity) && (
        <Section title="Remedial Work & Extension">
          <div className="text-sm space-y-1">
            {plan.remedialWork && (
              <p className="theme-text"><span className="font-bold">Remedial work: </span>{renderText(plan.remedialWork)}</p>
            )}
            {plan.extensionActivity && (
              <p className="theme-text"><span className="font-bold">Extension activity: </span>{renderText(plan.extensionActivity)}</p>
            )}
          </div>
        </Section>
      )}

      <Section title="Lesson Evaluation (fill in after teaching)">
        <div className="text-sm theme-text-secondary italic">
          — Successes (competences achieved) · Challenges (competences not achieved and why) · Way forward (including remedial work if applicable)
        </div>
      </Section>
    </article>
  )
}

function LessonPlanViewV2({ plan }) {
  const lc = plan.lessonCompetencies || {}
  const le = plan.learningEnvironment || {}
  const m  = plan.methodology || {}
  const cc = plan.competenceContinuity || {}
  const lp = plan.lessonProgression || {}
  return (
    <article className="space-y-6 print:space-y-4">
      <HeaderBlock header={plan.header} />

      <LessonIllustration diagram={plan.lessonDiagram} />

      {plan.lessonGoal && (
        <Section title="Lesson Goal (SMART)">
          <p className="text-sm theme-text leading-relaxed">{renderText(plan.lessonGoal)}</p>
        </Section>
      )}

      <Section title="Competences">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MiniSection title="Broad Competences" items={plan.broadCompetences} />
          <div className="rounded-xl border theme-border p-3">
            <h4 className="font-bold text-sm mb-2 theme-text">Expected Target Competence</h4>
            {plan.expectedTargetCompetence
              ? <p className="text-sm theme-text">{renderText(plan.expectedTargetCompetence)}</p>
              : <p className="text-sm theme-text-secondary italic">—</p>}
          </div>
        </div>
        <div className="mt-4 rounded-xl border theme-border p-3">
          <h4 className="font-bold text-sm mb-2 theme-text">Lesson Competencies</h4>
          <ol className="list-decimal list-inside space-y-1.5 text-sm theme-text">
            {lc.competency1 && <li><span className="font-bold">Higher-order thinking —</span> {renderText(lc.competency1)}</li>}
            {lc.competency2 && <li><span className="font-bold">Thinking process —</span> {renderText(lc.competency2)}</li>}
            {lc.competency3 && <li><span className="font-bold">Tangible output —</span> {renderText(lc.competency3)}</li>}
            {!lc.competency1 && !lc.competency2 && !lc.competency3 && (
              <li className="list-none theme-text-secondary italic">—</li>
            )}
          </ol>
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Methodology & Strategies">
          <div className="space-y-2 text-sm">
            {m.approach && (
              <p className="theme-text"><span className="font-bold">Approach: </span>{renderText(m.approach)}</p>
            )}
            {m.strategies?.length > 0 && (
              <div>
                <span className="font-bold theme-text">Strategies: </span>
                <UnorderedList items={m.strategies} />
              </div>
            )}
            {!m.approach && !(m.strategies?.length) && (
              <p className="theme-text-secondary italic">—</p>
            )}
          </div>
        </Section>
        <Section title="Learning Environment">
          <div className="text-sm space-y-1">
            <p className="theme-text">
              <span className="font-bold capitalize">{le.category || 'classroom'}</span>
              {le.specific && <> — {renderText(le.specific)}</>}
            </p>
            {le.rationale && <p className="theme-text-secondary text-xs">{renderText(le.rationale)}</p>}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MiniSection title="Teaching / Learning Materials" items={plan.teachingLearningMaterials} />
        <MiniSection title="Prior Knowledge" items={plan.prerequisiteKnowledge} />
      </div>

      {plan.interdisciplinaryConnections?.length > 0 && (
        <Section title="Interdisciplinary Connections">
          <div className="rounded-xl border theme-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/30 border-b theme-border">
                  <th className="px-3 py-2 text-left font-bold theme-text w-1/3">Subject</th>
                  <th className="px-3 py-2 text-left font-bold theme-text">How the concept connects</th>
                </tr>
              </thead>
              <tbody>
                {plan.interdisciplinaryConnections.map((c, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-slate-50/50 dark:bg-slate-900/20' : ''}>
                    <td className="px-3 py-2 theme-text font-bold">{c.subject}</td>
                    <td className="px-3 py-2 theme-text">{renderText(c.connection)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Lesson Progression (5E)">
        <PhaseBlock phase="1. Engagement — Introduction" minutes={lp.engagement?.durationMinutes} teacher={lp.engagement?.teacherActivities} pupils={lp.engagement?.learnerActivities} criteria={lp.engagement?.assessmentCriteria} />
        <PhaseBlock phase="2. Exploration — Development" minutes={lp.exploration?.durationMinutes} teacher={lp.exploration?.teacherActivities} pupils={lp.exploration?.learnerActivities} criteria={lp.exploration?.assessmentCriteria} />
        <PhaseBlock phase="3. Explanation — Conceptualization" minutes={lp.explanation?.durationMinutes} teacher={lp.explanation?.teacherActivities} pupils={lp.explanation?.learnerActivities} criteria={lp.explanation?.assessmentCriteria} />
        <PhaseBlock phase="4. Synthesis — Continuity & Extension" minutes={lp.synthesis?.durationMinutes} teacher={lp.synthesis?.teacherActivities} pupils={lp.synthesis?.learnerActivities} criteria={lp.synthesis?.assessmentCriteria} />
        <PhaseBlock phase="5. Evaluation & Reflection — Conclusion" minutes={lp.evaluation?.durationMinutes} teacher={lp.evaluation?.teacherActivities} pupils={lp.evaluation?.learnerActivities} criteria={lp.evaluation?.assessmentCriteria} />
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
                <p className="text-sm theme-text">{renderText(plan.assessment.summative.description)}</p>
                {plan.assessment.summative.successCriteria && (
                  <p className="text-xs theme-text-secondary mt-1">
                    <span className="font-bold">Success criteria: </span>
                    {renderText(plan.assessment.summative.successCriteria)}
                  </p>
                )}
              </div>
            )}
          </div>
        </Section>
        <Section title="Differentiation">
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm mb-1">For struggling learners</h4>
              <UnorderedList items={plan.differentiation?.forStruggling} />
            </div>
            <div>
              <h4 className="font-bold text-sm mb-1">For advanced learners</h4>
              <UnorderedList items={plan.differentiation?.forAdvanced} />
            </div>
          </div>
        </Section>
      </div>

      <Section title="Competence Continuity & Strategy">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MiniSection title="Long-term projects" items={cc.longTermProjects} />
          <MiniSection title="Homework extensions" items={cc.homeworkExtensions} />
          <MiniSection title="Upcoming connections" items={cc.upcomingConnections} />
          <MiniSection title="Teacher actions" items={cc.teacherActions} />
        </div>
      </Section>

      {plan.references?.length > 0 && (
        <Section title="References">
          <ReferencesBlock refs={plan.references} />
        </Section>
      )}

      {plan.homework?.description && (
        <Section title="Homework">
          <p className="text-sm theme-text">{renderText(plan.homework.description)}</p>
          {plan.homework.estimatedMinutes > 0 && (
            <p className="text-xs theme-text-secondary mt-1">
              Estimated time: {plan.homework.estimatedMinutes} minutes
            </p>
          )}
        </Section>
      )}

      <Section title="Teacher's Reflection (fill in after teaching)">
        <div className="text-sm theme-text-secondary italic">
          — What went well? What will you improve next time? Which learners need follow-up?
        </div>
      </Section>
    </article>
  )
}

function LessonPlanViewV1({ plan }) {
  return (
    <article className="space-y-6 print:space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm print:hidden">
        ℹ️ This plan was generated with the older template. New plans use the full CBC 5E format.
      </div>
      <HeaderBlock header={plan.header} />
      <LessonIllustration diagram={plan.lessonDiagram} />
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
        <PhaseBlock phase="Introduction" minutes={plan.lessonDevelopment?.introduction?.durationMinutes} teacher={plan.lessonDevelopment?.introduction?.teacherActivities} pupils={plan.lessonDevelopment?.introduction?.pupilActivities} />
        {(plan.lessonDevelopment?.development || []).map((step) => (
          <PhaseBlock key={step.stepNumber} phase={`Development — Step ${step.stepNumber}: ${step.title}`} minutes={step.durationMinutes} teacher={step.teacherActivities} pupils={step.pupilActivities} />
        ))}
        <PhaseBlock phase="Conclusion" minutes={plan.lessonDevelopment?.conclusion?.durationMinutes} teacher={plan.lessonDevelopment?.conclusion?.teacherActivities} pupils={plan.lessonDevelopment?.conclusion?.pupilActivities} />
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
                <p className="text-sm theme-text">{renderText(plan.assessment.summative.description)}</p>
                {plan.assessment.summative.successCriteria && (
                  <p className="text-xs theme-text-secondary mt-1">
                    <span className="font-bold">Success criteria: </span>
                    {renderText(plan.assessment.summative.successCriteria)}
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
          <p className="text-sm theme-text">{renderText(plan.homework.description)}</p>
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
  const hasAttendance =
    header.boysPresent != null || header.girlsPresent != null || header.totalPupils != null
  const attendance = hasAttendance
    ? `${header.boysPresent ?? '—'} boys · ${header.girlsPresent ?? '—'} girls · Total: ${header.totalPupils ?? header.numberOfPupils ?? '—'}`
    : header.numberOfPupils
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
    ['Attendance', attendance],
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

// Black-and-white drawing generated for the lesson (see the Lesson Plan
// Studio's illustration panel). Rendered here so it shows in the preview and,
// because the same `plan.lessonDiagram` is read by the PDF/DOCX exporters, in
// the downloads too.
function LessonIllustration({ diagram }) {
  if (!diagram?.url) return null
  return (
    <Section title="Lesson Illustration">
      <figure className="rounded-xl border theme-border p-3 text-center">
        <img
          src={diagram.url}
          alt={diagram.prompt || 'Lesson illustration'}
          loading="lazy"
          className="mx-auto max-h-80 w-auto rounded-lg"
        />
        {diagram.prompt && (
          <figcaption className="mt-2 text-xs theme-text-secondary italic">
            {diagram.prompt}
          </figcaption>
        )}
      </figure>
    </Section>
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
      {items.map((it, i) => <li key={i}>{renderText(it)}</li>)}
    </ol>
  )
}

function UnorderedList({ items }) {
  if (!items?.length) return <p className="text-sm theme-text-secondary italic">—</p>
  return (
    <ul className="list-disc list-inside space-y-1 text-sm theme-text">
      {items.map((it, i) => <li key={i}>{renderText(it)}</li>)}
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

function PhaseBlock({ phase, minutes, teacher = [], pupils = [], criteria }) {
  const hasCriteria = Array.isArray(criteria) && criteria.length > 0
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
            Teacher Activities
          </h5>
          <UnorderedList items={teacher} />
        </div>
        <div className="p-3">
          <h5 className="text-xs uppercase font-bold theme-text-secondary mb-2">
            Learner Activities
          </h5>
          <UnorderedList items={pupils} />
        </div>
      </div>
      {hasCriteria && (
        <div className="p-3 border-t theme-border bg-slate-50/60 dark:bg-slate-900/20">
          <h5 className="text-xs uppercase font-bold theme-text-secondary mb-2">
            Assessment Criteria
          </h5>
          <UnorderedList items={criteria} />
        </div>
      )}
    </div>
  )
}
