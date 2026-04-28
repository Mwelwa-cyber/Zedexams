import { useDeferredValue, useMemo, useState } from 'react'
import { buildQuizDisplaySections, hydrateMapLocation } from '../../utils/quizSections.js'
import { buildStaticMapUrl } from '../../utils/staticMap'
// Format-aware renderer: handles both legacy HTML and Tiptap JSON quizzes.
import RichContent from '../../editor/RichContent'

function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ')
}

function PassageMapPreview({ map }) {
  const hydrated = hydrateMapLocation(map)
  if (!hydrated) return null
  let url = ''
  try {
    url = buildStaticMapUrl({
      lat: hydrated.lat,
      lng: hydrated.lng,
      zoom: hydrated.zoom,
      mapType: hydrated.mapType,
      markers: hydrated.markers,
      size: [600, 320],
    })
  } catch {
    return null
  }
  return (
    <div className="theme-border theme-bg-subtle mt-4 overflow-hidden rounded-2xl border p-3">
      <img src={url} alt="Passage map" className="w-full rounded-xl object-contain" loading="lazy" />
    </div>
  )
}

function PreviewQuestion({ question }) {
  return (
    <div className="theme-card theme-border space-y-3 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="theme-accent-bg theme-accent-text rounded-full px-3 py-1 text-xs font-black">
          Q{question.questionNumber}
        </span>
        {question.topic && <span className="theme-bg-subtle theme-text-muted rounded-full px-2.5 py-1 text-xs font-bold">{question.topic}</span>}
        <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700">
          {question.marks || 1} mark{question.marks === 1 ? '' : 's'}
        </span>
      </div>

      {question.sharedInstruction && (
        <div className="theme-accent-bg theme-border rounded-2xl border px-3 py-2">
          <RichContent value={question.sharedInstruction} className="theme-accent-text text-sm font-bold" />
        </div>
      )}

      {question.imageUrl && (
        <div className="theme-border theme-bg-subtle overflow-hidden rounded-2xl border p-3">
          <img src={question.imageUrl} alt="Question illustration" className="max-h-64 w-full rounded-xl object-contain" />
        </div>
      )}

      <RichContent value={question.text} className="text-base font-bold leading-relaxed" />

      {question.diagramText && (
        <p className="theme-bg-subtle theme-text-muted rounded-xl px-3 py-2 text-xs font-bold leading-relaxed">
          {question.diagramText}
        </p>
      )}

      {(question.options || []).length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {question.options.map((option, index) => (
            <div
              key={`${question.id || question.localId || question.questionNumber}-${index}`}
              className={joinClasses(
                'rounded-2xl border-2 px-4 py-3 text-sm font-semibold',
                index === question.correctAnswer
                  ? 'border-green-300 bg-green-50 text-green-800'
                  : 'theme-border theme-bg-subtle theme-text',
              )}
            >
              <span className="mr-2 text-xs font-black">{['A', 'B', 'C', 'D'][index]}.</span>
              {option}
              {index === question.correctAnswer && <span className="ml-2 text-xs font-black">✓ Correct</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-xs font-black uppercase tracking-wide text-green-700">Expected answer</p>
          <p className="mt-1 text-sm font-semibold text-green-800">{question.correctAnswer || 'No expected answer yet.'}</p>
        </div>
      )}

      {question.explanation && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
          <p className="text-xs font-black uppercase tracking-wide text-sky-700">Explanation</p>
          <RichContent value={question.explanation} className="mt-2 text-sm leading-relaxed text-sky-950" />
        </div>
      )}
    </div>
  )
}

export default function QuizEditorPreviewPanel({ form, serializedSections }) {
  const [tab, setTab] = useState('preview')
  const deferredSections = useDeferredValue(serializedSections)
  const displayData = useMemo(
    () => buildQuizDisplaySections(deferredSections.questions || [], deferredSections.passages || []),
    [deferredSections],
  )
  const payloadPreview = useMemo(() => ({
    quiz: {
      title: form.title,
      subject: form.subject,
      grade: form.grade,
      term: form.term,
      duration: form.duration,
      topic: form.topic,
      type: form.type,
      mode: form.mode,
      importStatus: form.importStatus,
      questionCount: deferredSections.questionCount,
      totalMarks: deferredSections.totalMarks,
      passages: deferredSections.passages,
    },
    questions: deferredSections.questions,
  }), [deferredSections, form])

  return (
    <div className="theme-card theme-border rounded-3xl border p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="theme-text text-lg font-black">Preview & JSON</p>
          <p className="theme-text-muted mt-1 text-sm">See the learner-facing rendering and the exact stored structure before you save.</p>
        </div>
        <div className="theme-bg-subtle inline-flex rounded-full p-1">
          {[
            { id: 'preview', label: 'Preview' },
            { id: 'json', label: 'JSON' },
          ].map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={joinClasses(
                'min-h-0 rounded-full px-4 py-2 text-sm font-black transition-colors',
                tab === item.id
                  ? 'theme-accent-fill theme-on-accent'
                  : 'theme-text-muted bg-transparent',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'preview' ? (
        <div className="mt-5 space-y-4">
          <div className="theme-bg-subtle theme-border rounded-3xl border p-5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-wide">
              <span className="theme-accent-bg theme-accent-text rounded-full px-2.5 py-1">{form.subject || 'Subject'}</span>
              <span className="theme-card theme-border rounded-full border px-2.5 py-1">Grade {form.grade || '—'}</span>
              <span className="theme-card theme-border rounded-full border px-2.5 py-1">Term {form.term || '—'}</span>
              <span className="theme-card theme-border rounded-full border px-2.5 py-1">{deferredSections.questionCount || 0} Questions</span>
            </div>
            <h3 className="theme-text mt-3 text-2xl font-black">{form.title || 'Untitled quiz'}</h3>
            {form.topic && <p className="theme-text-muted mt-1 text-sm font-bold">{form.topic}</p>}
          </div>

          {displayData.sections.length === 0 ? (
            <div className="theme-bg-subtle theme-border rounded-3xl border border-dashed px-5 py-10 text-center">
              <p className="theme-text font-black">Nothing to preview yet.</p>
              <p className="theme-text-muted mt-1 text-sm">Add a question or passage and the learner view will appear here.</p>
            </div>
          ) : (
            displayData.sections.map(section => (
              section.kind === 'passage' ? (
                <div key={section.id} className="theme-accent-bg theme-border space-y-4 rounded-3xl border p-5">
                  <div className="theme-card theme-border rounded-3xl border p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="theme-accent-bg theme-accent-text rounded-full px-3 py-1 text-xs font-black">Comprehension Passage</span>
                      <span className="theme-bg-subtle theme-text-muted rounded-full px-2.5 py-1 text-xs font-bold">
                        {section.questions.length} question{section.questions.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {section.passage.title && <p className="theme-text mt-3 text-lg font-black">{section.passage.title}</p>}
                    {section.passage.instructions && (
                      <RichContent value={section.passage.instructions} className="theme-accent-text mt-2 text-sm font-bold" />
                    )}
                    {section.passage.imageUrl && (
                      <div className="theme-border theme-bg-subtle mt-4 overflow-hidden rounded-2xl border p-3">
                        <img src={section.passage.imageUrl} alt="Passage illustration" className="max-h-72 w-full rounded-xl object-contain" />
                      </div>
                    )}
                    <PassageMapPreview map={section.passage.mapLocation} />
                    <RichContent value={section.passage.passageText} className="mt-4 text-sm leading-7" />
                  </div>
                  {section.questions.map(question => <PreviewQuestion key={question.id || question.localId} question={question} />)}
                </div>
              ) : (
                <PreviewQuestion key={section.id} question={section.question} />
              )
            ))
          )}
        </div>
      ) : (
        <div className="theme-bg-subtle theme-border mt-5 overflow-hidden rounded-3xl border">
          <div className="theme-card theme-border border-b px-4 py-3">
            <p className="theme-text text-sm font-black">Stored payload</p>
            <p className="theme-text-muted mt-1 text-xs font-bold">Rich fields are saved as HTML strings.</p>
          </div>
          <pre className="max-h-[36rem] overflow-auto px-4 py-4 text-xs leading-6 text-slate-800">
            {JSON.stringify(payloadPreview, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
