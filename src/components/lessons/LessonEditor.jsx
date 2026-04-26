import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useAuth } from '../../contexts/AuthContext'
import { storage } from '../../firebase/config'
import { useFirestore } from '../../hooks/useFirestore'
import SlideEditor from './SlideEditor'
import SlideRenderer from './SlideRenderer'
import { convertQuickLessonToSlides } from './quickLessonConverter'
import { importPowerPointLesson } from './pptxImporter'
import { renderPowerPointToImages } from './pptxPresentationRenderer'
import { SAMPLE_QUICK_NOTES, SAMPLE_RESPIRATORY_LESSON } from './sampleLesson'
import {
  CREATION_MODES,
  LESSON_GRADES,
  LESSON_SCHEMA_VERSION,
  LESSON_SUBJECTS,
  LESSON_TERMS,
  LESSON_THEMES,
  createBlankSlide,
  createEmptyLesson,
  createEmptyPresentation,
  createStarterSlides,
  ensureEndSlide,
  getSlideActivities,
  getSlideAnswers,
  makeLessonId,
  normalizeSlideForSave,
  slidesToPlainText,
} from './lessonConstants'

const INPUT = 'w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 outline-none transition-colors focus:border-emerald-500'
const LABEL = 'mb-1.5 block text-xs font-black uppercase tracking-wide text-gray-500'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function revokePendingImageUrls(assets = {}) {
  Object.values(assets).forEach(asset => {
    if (asset?.objectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(asset.objectUrl)
    }
  })
}

function revokePresentationUrls(presentation) {
  presentation?.slideImages?.forEach(slide => {
    if (slide?.objectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(slide.objectUrl)
    }
  })
}

function assetsById(assets = []) {
  return Object.fromEntries(assets.map(asset => [asset.assetId, asset]))
}

function safeStorageName(value, fallback = 'asset') {
  const cleaned = String(value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || fallback
}

function answersToText(answers = []) {
  return answers.map(answer => [
    answer.prompt && answer.prompt !== 'Presentation answer' ? `${answer.prompt}:` : '',
    answer.answer,
    answer.explanation ? `- ${answer.explanation}` : '',
  ].filter(Boolean).join(' ')).join('\n')
}

function textToViewerAnswers(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: makeLessonId('pptx-answer'),
      slideId: 'presentation',
      slideTitle: `Presentation Answer ${index + 1}`,
      prompt: 'Presentation answer',
      answer: line,
      explanation: '',
      order: index + 1,
    }))
}

function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`fixed right-4 top-4 z-50 max-w-sm rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg ${toast.error ? 'bg-red-600' : 'bg-emerald-700'}`}>
      {toast.message}
    </div>
  )
}

function ModeChoice({ onChoose, onSample }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-eyebrow text-emerald-700">Create lesson</p>
        <h1 className="text-display-xl text-gray-900 mt-2">Choose how you want to build</h1>
        <p className="text-body text-gray-500 mt-2 max-w-2xl font-bold">
          Every option creates the same final structure: a native slide lesson that learners can play inside the website.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 stagger">
        {CREATION_MODES.map(mode => (
          <button
            key={mode.id}
            onClick={() => onChoose(mode.id)}
            className="rounded-3xl border-2 theme-border bg-white p-6 text-left shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-elev-md animate-slide-in-soft"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl font-black text-emerald-700 shadow-elev-inner-hl">
              {mode.icon}
            </span>
            <h2 className="text-display-md text-gray-900 mt-4" style={{ fontSize: 18 }}>{mode.label}</h2>
            <p className="text-body-sm text-gray-500 mt-2 font-bold">{mode.description}</p>
          </button>
        ))}
      </div>

      <div className="rounded-3xl border border-sky-100 bg-sky-50 p-5 shadow-elev-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-display-md text-sky-900" style={{ fontSize: 15 }}>Need a starting point?</p>
            <p className="text-body-sm text-sky-700 mt-1 font-bold">Load the Grade 4 Integrated Science respiratory system sample lesson.</p>
          </div>
          <button onClick={onSample} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white shadow-elev-sm shadow-elev-inner-hl transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md">
            Use sample lesson
          </button>
        </div>
      </div>
    </div>
  )
}

function MetadataForm({ form, quizzes, onPatch }) {
  return (
    <div className="rounded-3xl border theme-border bg-white p-5 shadow-elev-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-display-md text-gray-900" style={{ fontSize: 17 }}>Lesson details</h2>
          <p className="text-body-sm font-bold text-gray-500 mt-0.5">These fields power filtering, quiz linking, and learner discovery.</p>
        </div>
        <span className="text-eyebrow bg-emerald-50 px-3 py-1 rounded-full text-emerald-700">Schema v{LESSON_SCHEMA_VERSION}</span>
      </div>

      <div className="mt-4 grid gap-4">
        <label>
          <span className={LABEL}>Lesson title</span>
          <input value={form.title} onChange={event => onPatch('title', event.target.value)} placeholder="The Respiratory System" className={INPUT} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label>
            <span className={LABEL}>Grade</span>
            <select value={form.grade} onChange={event => onPatch('grade', event.target.value)} className={INPUT}>
              {LESSON_GRADES.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
            </select>
          </label>
          <label>
            <span className={LABEL}>Subject</span>
            <select value={form.subject} onChange={event => onPatch('subject', event.target.value)} className={INPUT}>
              {LESSON_SUBJECTS.map(subject => <option key={subject} value={subject}>{subject}</option>)}
            </select>
          </label>
          <label>
            <span className={LABEL}>Term</span>
            <select value={form.term} onChange={event => onPatch('term', event.target.value)} className={INPUT}>
              {LESSON_TERMS.map(term => <option key={term} value={term}>Term {term}</option>)}
            </select>
          </label>
          <label>
            <span className={LABEL}>Topic</span>
            <input value={form.topic} onChange={event => onPatch('topic', event.target.value)} placeholder="Respiratory System" className={INPUT} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={LABEL}>Theme</span>
            <select value={form.theme || 'fresh'} onChange={event => onPatch('theme', event.target.value)} className={INPUT}>
              {LESSON_THEMES.map(theme => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
            </select>
          </label>
          <label>
            <span className={LABEL}>Linked quiz</span>
            <select value={form.linkedQuizId || ''} onChange={event => onPatch('linkedQuizId', event.target.value)} className={INPUT}>
              <option value="">No linked quiz yet</option>
              {quizzes.map(quiz => (
                <option key={quiz.id} value={quiz.id}>
                  {quiz.title} - Grade {quiz.grade} {quiz.subject}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}

function QuickLessonForm({ form, notes, onPatch, onNotes, onConvert, onLoadSample }) {
  return (
    <div className="space-y-5">
      <MetadataForm form={form} quizzes={[]} onPatch={onPatch} />
      <div className="rounded-3xl border theme-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-900">Quick lesson notes</h2>
            <p className="text-xs font-bold text-gray-500">Use headings, paragraphs, bullet points, and activity questions. The converter will turn them into slides.</p>
          </div>
          <button onClick={onLoadSample} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700">
            Load Sample Notes
          </button>
        </div>
        <textarea
          value={notes}
          onChange={event => onNotes(event.target.value)}
          rows={14}
          placeholder="Paste lesson notes here..."
          className={`${INPUT} mt-4 resize-y leading-relaxed`}
        />
        <button onClick={onConvert} className="mt-4 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700">
          Convert Notes to Slides
        </button>
      </div>
    </div>
  )
}

function ImportPowerPointForm({ form, onPatch, onImport, importing, onPreserveMode }) {
  return (
    <div className="space-y-5">
      <MetadataForm form={form} quizzes={[]} onPatch={onPatch} />
      <div className="rounded-3xl border theme-border bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-emerald-700">Import PowerPoint</p>
          <h2 className="mt-1 text-xl font-black text-gray-900">Convert .pptx slides into editable lesson slides</h2>
          <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-gray-500">
            The importer extracts titles, text, bullet points, and pictures where possible, then turns them into editable website slides. Imported media uploads when you save or publish.
          </p>
        </div>

        <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-emerald-200 bg-emerald-50 px-4 py-10 text-center hover:border-emerald-400">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl font-black text-emerald-700">P</span>
          <span className="mt-3 text-base font-black text-gray-900">{importing ? 'Importing PowerPoint...' : 'Choose a .pptx file'}</span>
          <span className="mt-1 text-sm font-bold text-gray-500">The file is converted into native website slides.</span>
          <input
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            disabled={importing}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) onImport(file)
              event.target.value = ''
            }}
            className="sr-only"
          />
        </label>

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-900">Review required before publishing</p>
          <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">
            Slides marked "Needs review" may have split images, ignored backgrounds, unusual layout, or uncertain reading order. Check those slides before publishing.
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-sky-900">Want the original PowerPoint design?</p>
              <p className="mt-1 text-xs font-bold leading-relaxed text-sky-800">Preserve the presentation as fixed slides instead of converting it into editable website slides.</p>
            </div>
            <button onClick={onPreserveMode} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white">
              Preserve as Presentation
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PresentationPreview({ presentation }) {
  const slides = presentation?.slideImages || []

  if (!slides.length) {
    if (!presentation?.sourceFileName) return null

    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-amber-950">PowerPoint file ready</h2>
            <p className="mt-1 text-sm font-bold leading-relaxed text-amber-800">
              {presentation.sourceFileName} will be saved for presentation viewing. A visual slide preview could not be generated in this browser, so review the saved lesson before sharing it.
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-800">Needs review</span>
        </div>
        {presentation.conversionWarnings?.length ? (
          <ul className="mt-4 space-y-1">
            {presentation.conversionWarnings.slice(0, 4).map((warning, index) => (
              <li key={`${warning}-${index}`} className="text-xs font-bold leading-relaxed text-amber-800">{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  return (
    <div className="rounded-3xl border theme-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-gray-900">Presentation preview</h2>
          <p className="text-xs font-bold text-gray-500">{slides.length} web slide images generated from the PowerPoint.</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Ready for viewer mode</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slides.slice(0, 8).map(slide => (
          <div key={slide.id || slide.order} className="overflow-hidden rounded-2xl border theme-border bg-gray-50">
            <img src={slide.imageUrl} alt={slide.alt || `Slide ${slide.order}`} className="aspect-video w-full object-contain" />
            <p className="px-3 py-2 text-xs font-black text-gray-500">Slide {slide.order}</p>
          </div>
        ))}
      </div>
      {presentation.conversionWarnings?.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-900">Needs visual review</p>
          <ul className="mt-2 space-y-1">
            {presentation.conversionWarnings.slice(0, 4).map((warning, index) => (
              <li key={`${warning}-${index}`} className="text-xs font-bold leading-relaxed text-amber-800">{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function PowerPointViewerForm({ form, quizzes, answersText, onPatch, onAnswers, onUpload, converting }) {
  const presentation = form.presentation || createEmptyPresentation()
  return (
    <div className="space-y-5">
      <MetadataForm form={form} quizzes={quizzes} onPatch={onPatch} />

      <div className="rounded-3xl border theme-border bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-sky-700">PowerPoint Viewer Mode</p>
          <h2 className="mt-1 text-xl font-black text-gray-900">Preserve the original slide design</h2>
          <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-gray-500">
            Upload a .pptx file. The original file is stored, and the lesson viewer uses generated slide images for a centered presentation experience.
          </p>
        </div>

        <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-sky-200 bg-sky-50 px-4 py-10 text-center hover:border-sky-400">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl font-black text-sky-700">P</span>
          <span className="mt-3 text-base font-black text-gray-900">{converting ? 'Creating web slides...' : presentation.sourceFileName || 'Choose a .pptx file'}</span>
          <span className="mt-1 text-sm font-bold text-gray-500">Learners will view the preserved presentation layout, not editable native slides.</span>
          <input
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            disabled={converting}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) onUpload(file)
              event.target.value = ''
            }}
            className="sr-only"
          />
        </label>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-black text-emerald-900">Preserved presentation</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-emerald-800">
              This mode keeps the PowerPoint as fixed slide images for faithful viewing. Use editable import only when teachers need to change each slide's content.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-black text-amber-900">Check before publishing</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">
              Charts, tables, SmartArt, animations, and unusual fonts may need a quick visual check after conversion.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border theme-border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-gray-900">Linked answers</h2>
        <p className="mt-1 text-xs font-bold text-gray-500">Add one answer per line for any activities inside the PowerPoint.</p>
        <textarea
          value={answersText}
          onChange={event => onAnswers(event.target.value)}
          rows={5}
          placeholder="Example: The trachea carries air to the lungs."
          className={`${INPUT} mt-4 resize-y leading-relaxed`}
        />
      </div>

      <PresentationPreview presentation={presentation} />
    </div>
  )
}

function SlideStrip({ slides, activeIndex, onSelect, onAdd, onMove, draggedIndex, setDraggedIndex }) {
  return (
    <div className="rounded-3xl border theme-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-black text-gray-900">Slides</h2>
        <select onChange={event => event.target.value && onAdd(event.target.value)} value="" className="rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs font-black text-gray-700">
          <option value="">Add slide</option>
          <option value="title">Title slide</option>
          <option value="text">Text slide</option>
          <option value="bullets">Bullet list</option>
          <option value="imageText">Image + text</option>
          <option value="example">Example</option>
          <option value="question">Question/activity</option>
          <option value="summary">Summary</option>
          <option value="end">End slide</option>
        </select>
      </div>
      <div className="max-h-[620px] space-y-2 overflow-auto pr-1">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            draggable
            onDragStart={() => setDraggedIndex(index)}
            onDragOver={event => event.preventDefault()}
            onDrop={() => {
              if (draggedIndex !== null && draggedIndex !== index) onMove(draggedIndex, index)
              setDraggedIndex(null)
            }}
            onClick={() => onSelect(index)}
            className={`w-full rounded-2xl border-2 p-3 text-left transition-all ${
              activeIndex === index ? 'border-emerald-500 bg-emerald-50' : 'theme-border bg-gray-50 hover:border-emerald-200'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-white text-xs font-black text-gray-500">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-gray-900">{slide.title || 'Untitled slide'}</p>
                <p className="mt-0.5 text-xs font-bold capitalize text-gray-500">{slide.type === 'imageText' ? 'Image + text' : slide.type}</p>
                {slide.requiresReview && <p className="mt-1 text-xs font-black text-amber-700">Needs review</p>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function PreviewModal({ lesson, slideIndex, onClose }) {
  const [index, setIndex] = useState(slideIndex)
  const isPresentationMode = lesson.mode === 'pptx_viewer' || lesson.creationMode === 'pptx_viewer'
  const presentationSlides = (lesson.presentation?.slideImages || [])
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  const slides = lesson.slides || []
  const total = isPresentationMode ? presentationSlides.length : slides.length
  const slide = isPresentationMode ? presentationSlides[Math.min(index, Math.max(0, total - 1))] : slides[index]

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/80 p-4">
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-3">
        <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
          <div>
            <p className="text-sm font-black text-gray-900">Preview: {lesson.title || 'Untitled lesson'}</p>
            <p className="text-xs font-bold text-gray-500">
              {total ? `Slide ${Math.min(index + 1, total)} of ${total}` : 'No preview slides yet'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-black text-gray-700">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {isPresentationMode ? (
            <div className="flex min-h-full items-center justify-center rounded-3xl bg-gray-950 p-3">
              {slide?.imageUrl ? (
                <img
                  src={slide.imageUrl}
                  alt={slide.alt || `Slide ${index + 1}`}
                  className="max-h-full w-full rounded-2xl object-contain shadow-lg"
                />
              ) : (
                <div className="max-w-lg rounded-3xl bg-white p-6 text-center">
                  <p className="text-xl font-black text-gray-900">Presentation file is attached</p>
                  <p className="mt-2 text-sm font-bold leading-relaxed text-gray-500">
                    Upload conversion did not create web slide images yet. Save the lesson, then open the original PowerPoint viewer to check it.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <SlideRenderer lesson={lesson} slide={slide} index={index} total={slides.length} />
          )}
        </div>
        <div className="flex justify-center gap-3 rounded-2xl bg-white p-3">
          <button onClick={() => setIndex(value => Math.max(0, value - 1))} disabled={index === 0 || total === 0} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-black text-gray-700 disabled:opacity-40">
            Previous
          </button>
          <button onClick={() => setIndex(value => Math.min(total - 1, value + 1))} disabled={total === 0 || index >= total - 1} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LessonEditor() {
  const { lessonId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { currentUser, isAdmin } = useAuth()
  const {
    createLesson,
    updateLesson,
    getLessonById,
    getAllQuizzes,
    getMyQuizzes,
  } = useFirestore()

  const isEditing = Boolean(lessonId)
  const isTeacherArea = location.pathname.startsWith('/teacher')
  const returnPath = isTeacherArea ? '/teacher/lessons' : '/admin/lessons'

  const [selectedMode, setSelectedMode] = useState(null)
  const [form, setForm] = useState(() => createEmptyLesson())
  const [quickNotes, setQuickNotes] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [autoSavedAt, setAutoSavedAt] = useState(null)
  const [importingPptx, setImportingPptx] = useState(false)
  const [pendingImageAssets, setPendingImageAssets] = useState({})
  const [pendingPresentation, setPendingPresentation] = useState(null)
  const [convertingPresentation, setConvertingPresentation] = useState(false)
  const [presentationAnswersText, setPresentationAnswersText] = useState('')

  const activeSlide = form.slides?.[activeIndex] || form.slides?.[0]
  const draftKey = `zedexams-lesson-draft-${lessonId || selectedMode || 'new'}`

  function show(message, error = false) {
    setToast({ message, error })
    setTimeout(() => setToast(null), 3200)
  }

  useEffect(() => {
    return () => revokePendingImageUrls(pendingImageAssets)
  }, [pendingImageAssets])

  useEffect(() => {
    return () => revokePresentationUrls(pendingPresentation)
  }, [pendingPresentation])

  useEffect(() => {
    async function loadLesson() {
      if (!lessonId) return
      setLoading(true)
      const lesson = await getLessonById(lessonId)
      if (!lesson) {
        show('Lesson not found.', true)
        setLoading(false)
        return
      }
      const mode = lesson.creationMode || 'slide-builder'
      const slides = mode === 'pptx_viewer'
        ? []
        : lesson.slides?.length
          ? ensureEndSlide(lesson.slides)
          : convertQuickLessonToSlides({ title: lesson.title, topic: lesson.topic, content: lesson.content })

      setForm({
        ...createEmptyLesson(mode),
        ...lesson,
        schemaVersion: lesson.schemaVersion || LESSON_SCHEMA_VERSION,
        creationMode: mode,
        mode: lesson.mode || mode,
        presentation: {
          ...createEmptyPresentation(),
          ...(lesson.presentation || {}),
        },
        slides,
      })
      setPresentationAnswersText(answersToText(lesson.answers || []))
      setSelectedMode(mode)
      setLoading(false)
    }
    loadLesson()
  }, [lessonId])

  useEffect(() => {
    async function loadQuizzes() {
      if (!currentUser) return
      const data = isTeacherArea ? await getMyQuizzes(currentUser.uid) : await getAllQuizzes()
      setQuizzes(data)
    }
    loadQuizzes()
  }, [currentUser, isTeacherArea])

  useEffect(() => {
    if (!selectedMode || loading) return undefined
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ form, quickNotes, savedAt: new Date().toISOString() }))
        setAutoSavedAt(new Date())
      } catch (error) {
        console.warn('Lesson draft auto-save failed:', error)
      }
    }, 900)
    return () => clearTimeout(timer)
  }, [draftKey, form, loading, quickNotes, selectedMode])

  const lessonForPreview = useMemo(() => {
    const isPresentationLesson = form.mode === 'pptx_viewer' || form.creationMode === 'pptx_viewer'
    return {
      ...form,
      slides: isPresentationLesson ? [] : ensureEndSlide(form.slides || []),
    }
  }, [form])

  function patchForm(field, value) {
    setForm(current => {
      const next = { ...current, [field]: value }
      if ((field === 'title' || field === 'topic') && current.slides?.length) {
        const slides = [...current.slides]
        if (slides[0]?.type === 'title') {
          const previousTitleWasStarter = !current.title || slides[0].title === current.title || slides[0].title === 'New Lesson'
          const previousTopicWasStarter = !current.topic || slides[0].subtitle === current.topic || slides[0].subtitle === 'Lesson Topic'
          slides[0] = {
            ...slides[0],
            ...(field === 'title' && previousTitleWasStarter ? { title: value } : {}),
            ...(field === 'topic' && previousTopicWasStarter ? { subtitle: value } : {}),
          }
          next.slides = slides
        }
      }
      return next
    })
  }

  function chooseMode(mode) {
    const lesson = createEmptyLesson(mode)
    setSelectedMode(mode)
    setForm(lesson)
    setPendingPresentation(null)
    setPresentationAnswersText('')
    setActiveIndex(0)
  }

  function loadSampleLesson() {
    const sample = clone(SAMPLE_RESPIRATORY_LESSON)
    setSelectedMode(sample.creationMode)
    setForm(sample)
    setQuickNotes(SAMPLE_QUICK_NOTES)
    setPendingPresentation(null)
    setPresentationAnswersText('')
    setActiveIndex(0)
  }

  function convertNotes() {
    if (!form.title.trim()) return show('Please add a lesson title before converting.', true)
    if (!form.topic.trim()) return show('Please add a topic before converting.', true)
    if (!quickNotes.trim()) return show('Paste lesson notes before converting.', true)
    const slides = convertQuickLessonToSlides({ title: form.title, topic: form.topic, content: quickNotes })
    setForm(current => ({ ...current, creationMode: 'quick-lesson', slides }))
    setActiveIndex(0)
    show('Notes converted into editable slides.')
  }

  async function importPptx(file) {
    setImportingPptx(true)
    try {
      const imported = await importPowerPointLesson(file)
      const { imageAssets = [], ...importedLesson } = imported
      setPendingImageAssets(assetsById(imageAssets))
      setForm(current => ({
        ...current,
        ...importedLesson,
        title: current.title.trim() ? current.title : importedLesson.title,
        topic: current.topic.trim() ? current.topic : importedLesson.title,
        creationMode: 'imported_pptx',
        mode: 'imported_pptx',
        assetBatchId: importedLesson.assetBatchId,
        slides: importedLesson.slides,
      }))
      setSelectedMode('imported_pptx')
      setActiveIndex(0)
      show(importedLesson.importStatus === 'needs_review'
        ? 'PowerPoint imported. Some slides need review before publishing.'
        : 'PowerPoint imported into editable slides.')
    } catch (error) {
      console.error(error)
      show(error.message || 'Could not import this PowerPoint file.', true)
    } finally {
      setImportingPptx(false)
    }
  }

  async function preparePowerPointViewer(file) {
    setConvertingPresentation(true)
    try {
      let rendered = null
      let renderError = null
      try {
        rendered = await renderPowerPointToImages(file)
      } catch (error) {
        renderError = error
        console.warn('PowerPoint slide image rendering failed, falling back to embedded viewer:', error)
      }

      const fallbackWarning = renderError
        ? [`Slide image conversion failed: ${renderError.message || 'The browser could not render this PowerPoint into images.'}`]
        : []
      const presentation = {
        ...createEmptyPresentation(),
        sourceFileName: file.name,
        sourceContentType: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sourceSize: file.size,
        viewerType: rendered?.slideImages?.length ? 'slide_images' : 'office_embed',
        conversionStatus: rendered?.conversionWarnings?.length || fallbackWarning.length ? 'needs_review' : 'ready',
        slideCount: rendered?.slideCount || 0,
        slideImages: (rendered?.slideImages || []).map(({ blob, objectUrl, ...slide }) => ({
          ...slide,
          imageUrl: objectUrl,
          objectUrl,
        })),
        conversionWarnings: [
          ...(rendered?.conversionWarnings || []),
          ...fallbackWarning,
        ],
      }

      setPendingPresentation({
        sourceFile: file,
        slideImages: rendered?.slideImages || [],
      })
      setForm(current => ({
        ...current,
        title: current.title.trim() ? current.title : file.name.replace(/\.pptx$/i, '').replace(/[_-]+/g, ' '),
        topic: current.topic.trim() ? current.topic : file.name.replace(/\.pptx$/i, '').replace(/[_-]+/g, ' '),
        sourceFileName: file.name,
        assetBatchId: current.assetBatchId || makeLessonId('presentation-assets'),
        creationMode: 'pptx_viewer',
        mode: 'pptx_viewer',
        slides: [],
        presentation,
      }))
      setSelectedMode('pptx_viewer')
      show(presentation.conversionWarnings.length
        ? 'Presentation preview created. Some slides may need a visual check.'
        : 'Presentation preview created for viewer mode.')
    } catch (error) {
      console.error(error)
      show(error.message || 'Could not prepare this PowerPoint for viewer mode.', true)
    } finally {
      setConvertingPresentation(false)
    }
  }

  function updatePresentationAnswers(value) {
    setPresentationAnswersText(value)
    setForm(current => ({
      ...current,
      answers: textToViewerAnswers(value),
    }))
  }

  function updateSlide(updatedSlide) {
    setForm(current => ({
      ...current,
      slides: current.slides.map((slide, index) => index === activeIndex ? updatedSlide : slide),
    }))
  }

  function addSlide(type) {
    const newSlide = createBlankSlide(type || 'text')
    setForm(current => {
      const slides = [...(current.slides || [])]
      const insertAt = Math.min(activeIndex + 1, slides.length)
      slides.splice(insertAt, 0, newSlide)
      return { ...current, slides }
    })
    setActiveIndex(index => Math.min(index + 1, (form.slides?.length || 0)))
  }

  function duplicateSlide(index) {
    setForm(current => {
      const copy = { ...clone(current.slides[index]), id: makeLessonId('slide'), title: `${current.slides[index].title || 'Slide'} copy` }
      const slides = [...current.slides]
      slides.splice(index + 1, 0, copy)
      return { ...current, slides }
    })
    setActiveIndex(index + 1)
  }

  function deleteSlide(index) {
    if ((form.slides || []).length <= 1) {
      show('A lesson needs at least one slide.', true)
      return
    }
    setForm(current => ({ ...current, slides: current.slides.filter((_, i) => i !== index) }))
    setActiveIndex(current => Math.max(0, Math.min(current, form.slides.length - 2)))
  }

  function moveSlide(from, to) {
    if (to < 0 || to >= form.slides.length || from === to) return
    setForm(current => {
      const slides = [...current.slides]
      const [moved] = slides.splice(from, 1)
      slides.splice(to, 0, moved)
      return { ...current, slides }
    })
    setActiveIndex(to)
  }

  async function uploadImportedImages(slides) {
    const slidesWithBlobUrls = slides.filter(slide => String(slide.imageUrl || '').startsWith('blob:'))
    const assetIds = Array.from(new Set(slides
      .map(slide => slide.importAssetId || slide.imageAssetId)
      .filter(Boolean)))
    const idsToUpload = assetIds.filter(assetId => pendingImageAssets[assetId])

    if (slidesWithBlobUrls.some(slide => !pendingImageAssets[slide.importAssetId || slide.imageAssetId])) {
      throw new Error('Imported images are waiting in this browser only. Please re-import the PowerPoint or replace missing image URLs before saving.')
    }

    if (!idsToUpload.length) {
      return {
        slides,
        assetBatchId: form.assetBatchId || '',
      }
    }

    if (!currentUser?.uid) {
      throw new Error('Please sign in before saving imported lesson images.')
    }

    const assetBatchId = form.assetBatchId || makeLessonId('lesson-assets')
    const uploadedPairs = await Promise.all(idsToUpload.map(async assetId => {
      const asset = pendingImageAssets[assetId]
      if (!asset?.blob) throw new Error('An imported image could not be prepared for upload.')

      const extension = asset.extension || asset.contentType?.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      const fileName = `${safeStorageName(assetId)}.${extension}`
      const path = `lesson-images/${currentUser.uid}/${assetBatchId}/${fileName}`
      const snapshot = await uploadBytes(storageRef(storage, path), asset.blob, {
        contentType: asset.contentType || 'image/png',
        customMetadata: {
          sourceFileName: form.sourceFileName || '',
          sourcePath: asset.sourcePath || '',
        },
      })
      const url = await getDownloadURL(snapshot.ref)
      return [assetId, { url, path }]
    }))

    const uploadedById = Object.fromEntries(uploadedPairs)
    return {
      assetBatchId,
      slides: slides.map(slide => {
        const assetId = slide.importAssetId || slide.imageAssetId
        const uploaded = uploadedById[assetId]
        if (!uploaded) return slide
        return {
          ...slide,
          imageUrl: uploaded.url,
          imageStoragePath: uploaded.path,
          importAssetId: '',
          imageAssetId: '',
        }
      }),
    }
  }

  async function uploadPresentationAssets() {
    const existingPresentation = {
      ...createEmptyPresentation(),
      ...(form.presentation || {}),
    }

    if (!pendingPresentation?.sourceFile) {
      return {
        assetBatchId: form.assetBatchId || '',
        presentation: existingPresentation,
      }
    }

    if (!currentUser?.uid) {
      throw new Error('Please sign in before saving PowerPoint presentation files.')
    }

    const assetBatchId = form.assetBatchId || makeLessonId('presentation-assets')
    const sourceFile = pendingPresentation.sourceFile
    const sourceFileName = `${safeStorageName(sourceFile.name, 'presentation')}.pptx`
    const sourcePath = `lesson-presentations/${currentUser.uid}/${assetBatchId}/source/${sourceFileName}`
    const sourceSnapshot = await uploadBytes(storageRef(storage, sourcePath), sourceFile, {
      contentType: sourceFile.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      customMetadata: {
        lessonTitle: form.title || '',
      },
    })
    const sourceUrl = await getDownloadURL(sourceSnapshot.ref)

    const slidePairs = await Promise.all((pendingPresentation.slideImages || []).map(async (slide, index) => {
      const contentType = slide.contentType || slide.blob?.type || 'image/svg+xml'
      const extension = slide.extension || (contentType === 'image/svg+xml' ? 'svg' : contentType.split('/')[1]?.replace('jpeg', 'jpg')) || 'svg'
      const slidePath = `lesson-presentations/${currentUser.uid}/${assetBatchId}/slides/slide-${String(index + 1).padStart(3, '0')}.${extension}`
      const snapshot = await uploadBytes(storageRef(storage, slidePath), slide.blob, {
        contentType,
        customMetadata: {
          sourceFileName: sourceFile.name,
          sourceSlidePath: slide.sourceSlidePath || '',
        },
      })
      const imageUrl = await getDownloadURL(snapshot.ref)
      return {
        id: slide.id || makeLessonId('presentation-slide'),
        order: index + 1,
        imageUrl,
        storagePath: slidePath,
        contentType,
        extension,
        width: Number(slide.width) || 1280,
        height: Number(slide.height) || 720,
        alt: slide.alt || `PowerPoint slide ${index + 1}`,
      }
    }))

    return {
      assetBatchId,
      presentation: {
        ...existingPresentation,
        sourceFileName: sourceFile.name,
        sourcePath,
        sourceUrl,
        sourceContentType: sourceFile.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sourceSize: sourceFile.size,
        viewerType: slidePairs.length ? 'slide_images' : 'office_embed',
        conversionStatus: existingPresentation.conversionStatus || 'ready',
        slideCount: slidePairs.length,
        slideImages: slidePairs,
        conversionWarnings: existingPresentation.conversionWarnings || [],
      },
    }
  }

  async function saveLesson({ publish = false, submit = false } = {}) {
    if (!form.title.trim()) return show('Please add a lesson title.', true)
    if (!form.topic.trim()) return show('Please add a topic.', true)
    const lessonMode = selectedMode || form.mode || form.creationMode || 'slide-builder'
    const isPresentationMode = lessonMode === 'pptx_viewer'
    if (!isPresentationMode && !form.slides?.length) return show('Add or convert at least one slide.', true)
    if (isPresentationMode && !pendingPresentation?.sourceFile && !form.presentation?.sourceUrl) {
      return show('Upload a PowerPoint file before saving this presentation lesson.', true)
    }

    setSaving(true)
    try {
      let slides = []
      let uploadedImport = { assetBatchId: form.assetBatchId || '' }
      let uploadedPresentation = {
        assetBatchId: form.assetBatchId || '',
        presentation: {
          ...createEmptyPresentation(),
          ...(form.presentation || {}),
        },
      }

      if (isPresentationMode) {
        uploadedPresentation = await uploadPresentationAssets()
      } else {
        slides = ensureEndSlide(form.slides)
        uploadedImport = await uploadImportedImages(slides)
        slides = uploadedImport.slides.map(normalizeSlideForSave)
      }

      let status = form.status || 'draft'
      let isPublished = Boolean(form.isPublished)

      if (publish) {
        status = 'published'
        isPublished = true
      } else if (submit) {
        status = 'pending'
        isPublished = false
      } else if (!isEditing) {
        status = 'draft'
        isPublished = false
      }

      const payload = {
        schemaVersion: LESSON_SCHEMA_VERSION,
        title: form.title.trim(),
        grade: String(form.grade || '4'),
        subject: form.subject || 'Integrated Science',
        term: String(form.term || '1'),
        topic: form.topic.trim(),
        creationMode: lessonMode,
        mode: lessonMode,
        sourceFileName: String(form.sourceFileName || '').trim(),
        assetBatchId: uploadedPresentation.assetBatchId || uploadedImport.assetBatchId || form.assetBatchId || '',
        presentation: uploadedPresentation.presentation,
        importStatus: lessonMode === 'imported_pptx'
          ? (slides.some(slide => slide.requiresReview) ? 'needs_review' : 'success')
          : '',
        theme: form.theme || 'fresh',
        slides,
        content: isPresentationMode
          ? [form.title, form.topic, uploadedPresentation.presentation.sourceFileName].filter(Boolean).join(' ')
          : slidesToPlainText(slides),
        activities: isPresentationMode ? [] : getSlideActivities(slides),
        answers: isPresentationMode ? (form.answers || []) : getSlideAnswers(slides),
        linkedQuizId: String(form.linkedQuizId || '').trim(),
        linkedActivities: isPresentationMode ? [] : getSlideActivities(slides).map(activity => activity.id),
        status,
        isPublished,
        ...(submit && { submittedAt: new Date() }),
      }

      if (isEditing) {
        await updateLesson(lessonId, payload)
      } else {
        await createLesson({ ...payload, createdBy: currentUser.uid })
      }

      localStorage.removeItem(draftKey)
      setPendingImageAssets({})
      setPendingPresentation(null)
      show(publish ? 'Lesson published.' : submit ? 'Lesson submitted for approval.' : 'Lesson saved.')
      setTimeout(() => navigate(returnPath), 900)
    } catch (error) {
      console.error(error)
      show(error.message || 'Could not save lesson.', true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-2/3 animate-pulse rounded-xl bg-gray-200" />
        <div className="h-64 animate-pulse rounded-3xl bg-gray-200" />
      </div>
    )
  }

  if (!isEditing && !selectedMode) {
    return (
      <>
        <Toast toast={toast} />
        <ModeChoice onChoose={chooseMode} onSample={loadSampleLesson} />
      </>
    )
  }

  if (selectedMode === 'quick-lesson' && !form.slides?.length) {
    return (
      <div className="space-y-5">
        <Toast toast={toast} />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow text-sky-700">Quick lesson mode</p>
            <h1 className="text-display-xl text-gray-900 mt-1">Convert notes into slides</h1>
          </div>
          <button onClick={() => setSelectedMode(null)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-600 shadow-elev-sm transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md">
            Change mode
          </button>
        </div>
        <QuickLessonForm
          form={form}
          notes={quickNotes}
          onPatch={patchForm}
          onNotes={setQuickNotes}
          onConvert={convertNotes}
          onLoadSample={() => {
            setForm(current => ({ ...current, title: 'The Respiratory System', grade: '4', subject: 'Integrated Science', topic: 'Respiratory System' }))
            setQuickNotes(SAMPLE_QUICK_NOTES)
          }}
        />
      </div>
    )
  }

  if (selectedMode === 'imported_pptx' && !form.slides?.length) {
    return (
      <div className="space-y-5">
        <Toast toast={toast} />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow text-emerald-700">Import PowerPoint</p>
            <h1 className="text-display-xl text-gray-900 mt-1">Upload and convert a .pptx lesson</h1>
          </div>
          <button onClick={() => setSelectedMode(null)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-600 shadow-elev-sm transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md">
            Change mode
          </button>
        </div>
        <ImportPowerPointForm
          form={form}
          onPatch={patchForm}
          onImport={importPptx}
          importing={importingPptx}
          onPreserveMode={() => chooseMode('pptx_viewer')}
        />
      </div>
    )
  }

  if (selectedMode === 'pptx_viewer' || form.mode === 'pptx_viewer' || form.creationMode === 'pptx_viewer') {
    return (
      <div className="space-y-5">
        <Toast toast={toast} />
        {previewOpen && <PreviewModal lesson={lessonForPreview} slideIndex={0} onClose={() => setPreviewOpen(false)} />}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow text-sky-700">PowerPoint viewer mode</p>
            <h1 className="text-display-xl text-gray-900 mt-1">{form.title || 'Preserved presentation lesson'}</h1>
            <p className="text-body-sm font-bold text-gray-500 mt-1">
              {form.presentation?.slideCount || 0} presentation slides
              {autoSavedAt ? ` · Auto-saved ${autoSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isEditing && (
              <button onClick={() => setSelectedMode(null)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-600 shadow-elev-sm transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md">
                Change mode
              </button>
            )}
            <button onClick={() => setPreviewOpen(true)} disabled={convertingPresentation || (!form.presentation?.slideImages?.length && !form.presentation?.sourceFileName)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-700 shadow-elev-sm transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
              Preview
            </button>
            <button onClick={() => saveLesson({})} disabled={saving || convertingPresentation} className="rounded-xl border-2 border-sky-500 bg-white px-4 py-2 text-sm font-black text-sky-700 shadow-elev-sm transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save draft'}
            </button>
            {isAdmin ? (
              <button onClick={() => saveLesson({ publish: true })} disabled={saving || convertingPresentation} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-elev-sm shadow-elev-inner-hl transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
                Publish
              </button>
            ) : (
              <button onClick={() => saveLesson({ submit: true })} disabled={saving || convertingPresentation} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white shadow-elev-sm shadow-elev-inner-hl transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
                Submit
              </button>
            )}
          </div>
        </div>

        <PowerPointViewerForm
          form={form}
          quizzes={quizzes}
          answersText={presentationAnswersText}
          onPatch={patchForm}
          onAnswers={updatePresentationAnswers}
          onUpload={preparePowerPointViewer}
          converting={convertingPresentation}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Toast toast={toast} />
      {previewOpen && <PreviewModal lesson={lessonForPreview} slideIndex={activeIndex} onClose={() => setPreviewOpen(false)} />}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow text-emerald-700">
            {isEditing ? 'Edit lesson' : selectedMode === 'quick-lesson' ? 'Quick lesson generated' : selectedMode === 'imported_pptx' ? 'Imported PowerPoint' : 'Slide builder mode'}
          </p>
          <h1 className="text-display-xl text-gray-900 mt-1">{form.title || 'Untitled lesson'}</h1>
          <p className="text-body-sm font-bold text-gray-500 mt-1">
            {form.slides?.length || 0} slides
            {autoSavedAt ? ` · Auto-saved ${autoSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreviewOpen(true)} className="rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-elev-sm transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md">
            Preview
          </button>
          <button onClick={() => saveLesson({})} disabled={saving} className="rounded-xl border-2 border-emerald-500 bg-white px-4 py-2 text-sm font-black text-emerald-700 shadow-elev-sm transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save draft'}
          </button>
          {isAdmin && (
            <button onClick={() => saveLesson({ publish: true })} disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-elev-sm shadow-elev-inner-hl transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
              Publish
            </button>
          )}
          {!isAdmin && (
            <button onClick={() => saveLesson({ submit: true })} disabled={saving} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white shadow-elev-sm shadow-elev-inner-hl transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
              Submit
            </button>
          )}
        </div>
      </div>

      {form.mode === 'imported_pptx' || form.creationMode === 'imported_pptx' ? (
        <div className={`rounded-3xl border p-4 ${form.importStatus === 'needs_review' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={`text-sm font-black ${form.importStatus === 'needs_review' ? 'text-amber-900' : 'text-emerald-900'}`}>
                Review imported PowerPoint slides before publishing
              </p>
              <p className={`mt-1 text-xs font-bold leading-relaxed ${form.importStatus === 'needs_review' ? 'text-amber-800' : 'text-emerald-800'}`}>
                Source file: {form.sourceFileName || 'PowerPoint file'} · Status: {form.importStatus || 'needs_review'} · Pictures save to lesson media storage.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-black ${form.importStatus === 'needs_review' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {(form.slides || []).filter(slide => slide.requiresReview).length} slides need review
            </span>
          </div>
        </div>
      ) : null}

      <MetadataForm form={form} quizzes={quizzes} onPatch={patchForm} />

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <SlideStrip
          slides={form.slides || []}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          onAdd={addSlide}
          onMove={moveSlide}
          draggedIndex={draggedIndex}
          setDraggedIndex={setDraggedIndex}
        />

        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-3xl border theme-border bg-white p-5 shadow-sm">
            {activeSlide && (
              <SlideEditor
                slide={activeSlide}
                index={activeIndex}
                total={form.slides.length}
                onChange={updateSlide}
                onDuplicate={duplicateSlide}
                onDelete={deleteSlide}
                onMove={moveSlide}
              />
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-gray-900">Live preview</h2>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-500">Learner view</span>
            </div>
            <SlideRenderer lesson={lessonForPreview} slide={activeSlide} index={activeIndex} total={form.slides.length} compact />
          </div>
        </div>
      </div>
    </div>
  )
}
