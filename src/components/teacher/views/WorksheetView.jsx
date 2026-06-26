/**
 * Read-only rendering of a validated worksheet JSON object.
 * Shared by the Worksheet Generator, the Library detail view, the public
 * share page and the teachers landing demo.
 */

import { renderText } from '../../../utils/mathRender'

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
          {section.passage && <PassageView section={section} />}
          {section.layout === 'grid' ? (
            <GridQuestions section={section} showAnswers={showAnswers} />
          ) : (
            (section.questions || []).map((q) => (
              <QuestionView key={q.number} q={q} showAnswers={showAnswers} />
            ))
          )}
        </div>
      ))}

      {showAnswers && worksheet.answerKey?.markingNotes && (
        <div className="rounded-xl p-4" style={{ background: '#e6f5ed', border: '1.5px solid #10864e' }}>
          <h4 className="font-bold text-sm mb-1" style={{ color: '#0a5a35' }}>Marking Guidance</h4>
          <p className="text-sm" style={{ color: '#0a5a35' }}>{worksheet.answerKey.markingNotes}</p>
        </div>
      )}
    </article>
  )
}

/* A reading passage pupils read before answering (comprehension worksheets). */
function PassageView({ section }) {
  return (
    <div className="rounded-xl border theme-border p-4 bg-amber-50/40 dark:bg-amber-900/10">
      {section.passageTitle && (
        <h4 className="font-bold text-sm theme-text mb-1 text-center">{section.passageTitle}</h4>
      )}
      <div className="text-sm theme-text whitespace-pre-line leading-relaxed">
        {renderText(section.passage)}
      </div>
    </div>
  )
}

/* Compact multi-column drill grid (fraction→decimal, fill-ins, mental maths). */
function GridQuestions({ section, showAnswers }) {
  const cols = Math.min(4, Math.max(2, Number(section.columns) || 3))
  const colClass = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-4',
  }[cols] || 'sm:grid-cols-3'
  return (
    <div className={`grid grid-cols-1 ${colClass} gap-2`}>
      {(section.questions || []).map((q) => (
        <div key={q.number} className="rounded-lg border theme-border px-3 py-2 text-sm">
          <div className="flex items-baseline gap-1">
            <span className="font-black theme-text shrink-0">{q.number}.</span>
            <span className="theme-text">{renderText(q.prompt)}</span>
            <span className="theme-text-secondary">&nbsp;______</span>
          </div>
          {showAnswers && q.answer && (
            <p className="text-xs mt-1" style={{ color: '#0a5a35' }}>
              ✓ {renderText(q.answer)}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function QuestionView({ q, showAnswers }) {
  const letters = ['A', 'B', 'C', 'D', 'E']
  return (
    <div className="rounded-xl border theme-border p-3">
      <div className="flex items-start gap-2">
        <span className="font-black theme-text shrink-0">{q.number}.</span>
        <div className="flex-1">
          <p className="theme-text">{renderText(q.prompt)}</p>
          {(q.type === 'multiple_choice' || q.type === 'true_false') && q.options?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {q.options.map((opt, i) => (
                <li key={i} className="text-sm theme-text">
                  <span className="font-bold mr-2">{letters[i] || '•'}.</span>{renderText(opt)}
                </li>
              ))}
            </ul>
          )}
          {!showAnswers && <WorkingSpace q={q} />}
          {showAnswers && q.answer && (
            <div className="mt-2 pt-2 border-t theme-border">
              <p className="text-sm" style={{ color: '#0a5a35' }}>
                <span className="font-bold">✓ Answer: </span>{renderText(q.answer)}
              </p>
              {q.workingNotes && (
                <p className="text-xs theme-text-secondary italic mt-1">
                  {renderText(q.workingNotes)}
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

/* On-screen hint of the working room the printout/DOCX will leave. The DOCX
 * exporter is the source of truth for actual print spacing. */
function WorkingSpace({ q }) {
  const style = q.workingStyle || autoWorkingStyle(q.type)
  if (style === 'none') return null
  if (style === 'columns') {
    return (
      <div className="mt-2 rounded-lg border border-dashed theme-border h-28" aria-hidden="true" />
    )
  }
  if (style === 'box') {
    return (
      <div className="mt-2 rounded-lg border border-dashed theme-border h-12" aria-hidden="true" />
    )
  }
  if (style === 'lines') {
    return (
      <div className="mt-2 space-y-3" aria-hidden="true">
        <div className="border-b theme-border" />
        <div className="border-b theme-border" />
      </div>
    )
  }
  return null
}

function autoWorkingStyle(type) {
  if (type === 'calculation') return 'columns'
  if (type === 'essay') return 'lines'
  if (type === 'short_answer' || type === 'fill_in_blank') return 'lines'
  return 'none'
}
