/**
 * Read-only renderer for a generated homework (generateHomework output).
 * Shared by the Homework Studio result panel and the Library detail view so
 * a saved homework renders exactly as it did in the studio.
 */
import { renderText } from '../../../utils/mathRender'

export default function HomeworkView({ hw, showAnswers = false }) {
  const h = hw.header || {}
  return (
    <article className="space-y-4">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          <div><span className="font-bold">Topic: </span>{h.topic}</div>
          {h.subtopic && <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>}
        </div>
        {hw.instructions && (
          <p className="mt-3 text-sm italic theme-text-secondary">{hw.instructions}</p>
        )}
      </div>
      <ol className="list-decimal pl-5 space-y-3 text-sm theme-text">
        {(hw.questions || []).map((q) => (
          <li key={q.number}>
            <p>{renderText(q.prompt)}</p>
            {showAnswers && (
              <div className="mt-1 pt-1 border-t theme-border">
                <p className="text-emerald-700 dark:text-emerald-400">
                  <span className="font-bold">Answer: </span>{renderText(q.answer)}
                </p>
                {q.workingNotes && (
                  <p className="text-xs theme-text-secondary italic mt-0.5">
                    {renderText(q.workingNotes)}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {hw.parentNote && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h4 className="font-bold text-sm text-sky-900 mb-1">Note for parent / guardian</h4>
          <p className="text-sm text-sky-800">{hw.parentNote}</p>
        </div>
      )}
      {showAnswers && hw.answerKey?.markingNotes && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-bold text-sm text-emerald-900 mb-1">Marking guidance</h4>
          <p className="text-sm text-emerald-800">{hw.answerKey.markingNotes}</p>
        </div>
      )}
    </article>
  )
}
