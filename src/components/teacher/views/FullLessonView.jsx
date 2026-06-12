/**
 * FullLessonView — read-only rendering of a generated Full Lesson
 * (objectives, vocabulary, teaching content, worked examples, practice,
 * checks, summary, homework, references). Shared by the Full Lesson
 * studio and the Library detail view.
 */

function Sec({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="text-base font-black theme-text border-b theme-border pb-1 mb-2">
        {title}
      </h3>
      {children}
    </section>
  )
}

function List({ items, ordered }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1 text-sm theme-text`}>
      {(items || []).map((it, i) => <li key={i}>{it}</li>)}
    </Tag>
  )
}

export default function FullLessonView({ lesson }) {
  if (!lesson) return null
  const h = lesson.header || {}
  const intro = lesson.introduction || {}
  const a = lesson.assessment || {}
  const hw = lesson.homework || {}
  return (
    <article className="space-y-1">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          <div><span className="font-bold">Topic: </span>{h.topic}</div>
          {h.subtopic && (
            <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>
          )}
          {h.term && <div><span className="font-bold">Term: </span>{h.term}</div>}
          <div><span className="font-bold">Duration: </span>{h.durationMinutes} min</div>
        </div>
      </div>

      {lesson.objectives?.length > 0 && (
        <Sec title="Objectives"><List items={lesson.objectives} /></Sec>
      )}
      {lesson.keyVocabulary?.length > 0 && (
        <Sec title="Key Vocabulary">
          <ul className="space-y-1 text-sm theme-text">
            {lesson.keyVocabulary.map((g, i) => (
              <li key={i}><span className="font-bold">{g.term}: </span>{g.definition}</li>
            ))}
          </ul>
        </Sec>
      )}
      {(intro.hook || intro.priorKnowledge) && (
        <Sec title="Introduction">
          {intro.hook && <p className="text-sm theme-text mb-2"><span className="font-bold">Hook: </span>{intro.hook}</p>}
          {intro.priorKnowledge && <p className="text-sm theme-text"><span className="font-bold">Prior knowledge: </span>{intro.priorKnowledge}</p>}
        </Sec>
      )}
      {lesson.teaching?.length > 0 && (
        <Sec title="Lesson Content">
          {lesson.teaching.map((t, i) => (
            <div key={i} className="mb-3">
              <p className="font-bold text-sm theme-text">{t.heading}</p>
              <p className="text-sm theme-text">{t.explanation}</p>
            </div>
          ))}
        </Sec>
      )}
      {lesson.workedExamples?.length > 0 && (
        <Sec title="Worked Examples">
          {lesson.workedExamples.map((w, i) => (
            <div key={i} className="mb-3">
              <p className="font-bold text-sm theme-text">Example {i + 1}: {w.problem}</p>
              {w.steps?.length > 0 && (
                <ol className="list-decimal pl-5 text-sm theme-text">
                  {w.steps.map((s, j) => <li key={j}>{s}</li>)}
                </ol>
              )}
              {w.answer && <p className="text-sm text-emerald-700 dark:text-emerald-400"><span className="font-bold">Answer: </span>{w.answer}</p>}
            </div>
          ))}
        </Sec>
      )}
      {lesson.guidedPractice?.length > 0 && (
        <Sec title="Guided Practice"><List items={lesson.guidedPractice} ordered /></Sec>
      )}
      {lesson.learnerActivities?.length > 0 && (
        <Sec title="Learner Activities"><List items={lesson.learnerActivities} /></Sec>
      )}
      {a.checks?.length > 0 && (
        <Sec title="Formative Checks">
          <List items={a.checks} ordered />
          {a.answers?.length > 0 && (
            <div className="mt-2">
              <p className="font-bold text-sm theme-text">Answer key</p>
              <List items={a.answers} ordered />
            </div>
          )}
        </Sec>
      )}
      {lesson.summary && (
        <Sec title="Summary"><p className="text-sm theme-text">{lesson.summary}</p></Sec>
      )}
      {hw.task && (
        <Sec title="Homework">
          <p className="text-sm theme-text">{hw.task}</p>
          {hw.answerGuide && <p className="text-sm theme-text-secondary mt-1"><span className="font-bold">Answer guide: </span>{hw.answerGuide}</p>}
        </Sec>
      )}
      {lesson.references?.length > 0 && (
        <Sec title="References"><List items={lesson.references} /></Sec>
      )}
    </article>
  )
}
