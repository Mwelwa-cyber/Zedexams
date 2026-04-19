/**
 * Read-only rendering of a validated worksheet JSON object.
 * Shared by the Worksheet Generator and the Library detail view.
 */

export default function WorksheetView({ worksheet, showAnswers = false }) {
  if (!worksheet) return null
  return (
    <article className="space-y-5">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{worksheet.header?.grade}</div>
          <div><span className="font-bold">Subject: </span>{worksheet.header?.subject}</div>
          <div><span className="font-bold">Topic: </span>{worksheet.header?.topic}</div>
          {worksheet.header?.subtopic && (
            <div><span className="font-bold">Sub-topic: </span>{worksheet.header.subtopic}</div>
          )}
          <div><span className="font-bold">Duration: </span>{worksheet.header?.duration}</div>
          <div><span className="font-bold">Total marks: </span>{worksheet.header?.totalMarks}</div>
        </div>
        {worksheet.header?.instructions && (
          <p className="mt-3 text-sm italic theme-text-secondary">
            {worksheet.header.instructions}
          </p>
        )}
      </div>

      {(worksheet.sections || []).map((section, idx) => (
        <div key={idx} className="space-y-3">
          <h3 className="text-base font-black theme-text border-b theme-border pb-1">
            {section.title}
          </h3>
          {section.instructions && (
            <p className="text-sm italic theme-text-secondary">{section.instructions}</p>
          )}
          {(section.questions || []).map((q) => (
            <QuestionView key={q.number} q={q} showAnswers={showAnswers} />
          ))}
        </div>
      ))}

      {showAnswers && worksheet.answerKey?.markingNotes && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-bold text-sm text-emerald-900 mb-1">Marking Guidance</h4>
          <p className="text-sm text-emerald-800">{worksheet.answerKey.markingNotes}</p>
        </div>
      )}
    </article>
  )
}

function QuestionView({ q, showAnswers }) {
  const letters = ['A', 'B', 'C', 'D', 'E']
  return (
    <div className="rounded-xl border theme-border p-3">
      <div className="flex items-start gap-2">
        <span className="font-black theme-text shrink-0">{q.number}.</span>
        <div className="flex-1">
          <p className="theme-text">{q.prompt}</p>
          {(q.type === 'multiple_choice' || q.type === 'true_false') && q.options?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {q.options.map((opt, i) => (
                <li key={i} className="text-sm theme-text">
                  <span className="font-bold mr-2">{letters[i] || '•'}.</span>{opt}
                </li>
              ))}
            </ul>
          )}
          {showAnswers && q.answer && (
            <div className="mt-2 pt-2 border-t theme-border">
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                <span className="font-bold">✓ Answer: </span>{q.answer}
              </p>
              {q.workingNotes && (
                <p className="text-xs theme-text-secondary italic mt-1">
                  {q.workingNotes}
                </p>
              )}
            </div>
          )}
        </div>
        <span className="text-xs theme-text-secondary shrink-0 ml-2">
          [{q.marks}]
        </span>
      </div>
    </div>
  )
}
