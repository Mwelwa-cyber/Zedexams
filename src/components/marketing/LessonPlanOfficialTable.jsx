/**
 * LessonPlanOfficialTable — marketing-page replica of the Lesson Plan
 * Studio's "Classic (official module)" layout: the document teachers
 * actually print and export to Word.
 *
 * Mirrors public/studio/06-generate.js renderClassic():
 *   school head + LESSON PLAN title → two-column CAPS meta between black
 *   rules → CAPS field lines → one black-bordered LESSON PROGRESSION
 *   table [STAGES | TEACHER'S ACTIVITIES | LEARNERS' ACTIVITIES |
 *   ASSESSMENT CRITERIA] → remedial/extension → LESSON EVALUATION blanks.
 *
 * Takes the same v3 lesson-plan artifact JSON as LessonPlanView, so the
 * /teachers sample can flip between the studio document and the app view
 * without duplicating content.
 */

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-2 align-top text-left'

function Line({ label, children, indent = false, className = '' }) {
  return (
    <div className={`leading-snug my-0.5 ${indent ? 'pl-5' : ''} ${className}`}>
      {label && <strong className="font-bold">{label}: </strong>}
      {children}
    </div>
  )
}

function CellLines({ items }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : [])
  return list.map((item, i) => (
    <div key={i} className="my-1 leading-snug">{item}</div>
  ))
}

export default function LessonPlanOfficialTable({ plan }) {
  if (!plan) return null
  const h = plan.header || {}
  const le = plan.learningEnvironment || {}
  const blanks = (n) => '_'.repeat(n)
  const hasAttendance = h.boysPresent != null || h.girlsPresent != null || h.totalPupils != null

  const meta = [
    ['NAME OF TEACHER', h.teacherName || blanks(22), true],
    ['DATE', h.date || blanks(14)],
    ['TIME', h.time || blanks(14)],
    ['CLASS', h.class || ''],
    ['DURATION', h.durationMinutes ? `${h.durationMinutes} minutes` : blanks(10)],
    ['TERM & WEEK', h.termAndWeek || ''],
    hasAttendance && [
      'TOTAL ATTENDANCE',
      `Boys: ${h.boysPresent ?? '____'}   Girls: ${h.girlsPresent ?? '____'}   Total: ${h.totalPupils ?? '____'}`,
      true,
    ],
    ['SUBJECT', h.subject || '', true],
  ].filter(Boolean)

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-5 py-6 sm:px-8 text-[13px]"
      style={DOC_FONT}
    >
      {/* Document head */}
      <div className="text-center">
        <div className="text-lg font-bold">{h.school || 'School Name'}</div>
        <div className="mt-1 border-y border-black py-1 text-sm font-bold tracking-[0.18em] uppercase">
          Lesson Plan
        </div>
      </div>

      {/* Official meta grid */}
      <div className="mt-3 border-y-[1.5px] border-black py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5">
        {meta.map(([k, v, wide]) => (
          <div key={k} className={`leading-snug ${wide ? 'sm:col-span-2' : ''}`}>
            <strong className="font-bold">{k}:</strong> {v}
          </div>
        ))}
      </div>

      {/* Field lines */}
      <div className="mt-3">
        <Line label="TOPIC">{h.topic}</Line>
        <Line label="SUB-TOPIC">{h.subtopic}</Line>
        <Line label="GENERAL COMPETENCES">{(plan.generalCompetences || []).join(', ')}</Line>
        <Line label="SPECIFIC COMPETENCE">{plan.specificCompetence}</Line>
        <Line label="LESSON GOAL" className="mt-2">{plan.lessonGoal}</Line>
        <Line label="RATIONALE">{plan.rationale}</Line>
        <Line label="PRIOR KNOWLEDGE">{plan.priorKnowledge}</Line>
        {plan.references?.length > 0 && (
          <>
            <Line label="REFERENCES" className="mt-2" />
            {plan.references.map((r, i) => <Line key={i} indent>• {r}</Line>)}
          </>
        )}
        <Line label="LEARNING ENVIRONMENT" className="mt-2" />
        <Line indent>I. <strong className="font-bold">Natural:</strong> {le.natural}</Line>
        <Line indent>II. <strong className="font-bold">Artificial:</strong> {le.artificial}</Line>
        <Line indent>III. <strong className="font-bold">Technological:</strong> {le.technological}</Line>
        {plan.materials?.length > 0 && (
          <>
            <Line label="TEACHING AND LEARNING MATERIALS/RESOURCES" className="mt-2" />
            {plan.materials.map((m, i) => <Line key={i} indent>• {m}</Line>)}
          </>
        )}
        <Line label="EXPECTED STANDARD">{plan.expectedStandard}</Line>
      </div>

      {/* Progression table */}
      <div className="mt-4 font-bold tracking-[0.05em]">LESSON PROGRESSION</div>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full border-collapse border border-black">
          <thead>
            <tr>
              <th className={`${TD} font-bold w-[15%]`}>STAGES</th>
              <th className={`${TD} font-bold w-[31%]`}>TEACHER'S ACTIVITIES</th>
              <th className={`${TD} font-bold w-[30%]`}>LEARNERS' ACTIVITIES</th>
              <th className={`${TD} font-bold w-[24%]`}>ASSESSMENT CRITERIA</th>
            </tr>
          </thead>
          <tbody>
            {(plan.stages || []).map((s, i) => (
              <tr key={i}>
                <td className={`${TD} font-bold text-[11px]`}>
                  {String(s.name || '').split(/\s*\/\s*/).map((part, j) => (
                    <div key={j}>{part}</div>
                  ))}
                  {s.durationMinutes > 0 && (
                    <div className="font-normal italic text-[11px]">({s.durationMinutes} min)</div>
                  )}
                </td>
                <td className={TD}><CellLines items={s.teacherActivities} /></td>
                <td className={TD}><CellLines items={s.learnerActivities} /></td>
                <td className={TD}><CellLines items={s.assessmentCriteria} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Closing block */}
      <div className="mt-3">
        {plan.remedialWork && <Line label="REMEDIAL WORK" className="mt-2">{plan.remedialWork}</Line>}
        {plan.extensionActivity && <Line label="EXTENSION ACTIVITY">{plan.extensionActivity}</Line>}
        <Line label="LESSON EVALUATION" className="mt-3" />
        <Line><strong className="font-bold">Successes</strong> (competences achieved): {blanks(18)}</Line>
        <Line>{blanks(58)}</Line>
        <Line><strong className="font-bold">Challenges</strong> (competences not achieved and why): {blanks(18)}</Line>
        <Line>{blanks(58)}</Line>
        <Line><strong className="font-bold">Way forward</strong> (including remedial work if applicable): {blanks(18)}</Line>
        <Line>{blanks(58)}</Line>
      </div>
    </article>
  )
}
