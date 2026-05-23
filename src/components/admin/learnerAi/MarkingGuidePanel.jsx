import { useEffect } from 'react'

// Side drawer that renders the answer key + marking guide for an
// exam-quiz artifact. No download — that's the DOCX 'scheme' mode.
// Same look as RunningTaskDetailDrawer for consistency.

export default function MarkingGuidePanel({ content, onClose }) {
  useEffect(() => {
    if (!content) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [content])

  if (!content) return null

  const answerKey = Array.isArray(content.answerKey) ? content.answerKey : []
  const markingGuide = typeof content.markingGuide === 'string' ? content.markingGuide : ''
  const grade = content.header && content.header.grade
  const subject = content.header && content.header.subject

  return (
    <div role="dialog" aria-modal="true" aria-label="Marking guide"
         className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/40"
      />
      <aside className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-xl flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 sticky top-0 bg-white z-10 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Marking guide</div>
            <h3 className="text-base font-bold text-slate-900">
              {subject ? `${subject} · ` : ''}{grade ? `Grade ${grade}` : ''}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <section className="px-4 py-3 border-b border-slate-100">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Answer key ({answerKey.length})
          </h4>
          {answerKey.length ? (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Sec</th>
                    <th className="px-2 py-1.5 text-left">Q#</th>
                    <th className="px-2 py-1.5 text-left">Answer</th>
                    <th className="px-2 py-1.5 text-left">Marks</th>
                    <th className="px-2 py-1.5 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {answerKey.map((k, idx) => (
                    <tr key={`${k.sectionId}-${k.questionNumber}-${idx}`}
                        className="border-t border-slate-100">
                      <td className="px-2 py-1 font-semibold">{k.sectionId}</td>
                      <td className="px-2 py-1">{k.questionNumber}</td>
                      <td className="px-2 py-1 max-w-[280px] whitespace-pre-wrap">{k.answer}</td>
                      <td className="px-2 py-1 tabular-nums">{k.marks}</td>
                      <td className="px-2 py-1 text-slate-600">{k.markingNotes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-slate-500">No answer-key entries.</div>
          )}
        </section>

        <section className="px-4 py-3">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Marking guide narrative
          </h4>
          {markingGuide ? (
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {markingGuide}
            </p>
          ) : (
            <div className="text-xs text-slate-500">No marking-guide text.</div>
          )}
        </section>
      </aside>
    </div>
  )
}
