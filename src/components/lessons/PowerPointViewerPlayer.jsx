import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LessonCompleteScreen from './LessonCompleteScreen'

function AnswersPanel({ answers }) {
  if (!answers.length) {
    return (
      <div className="rounded-3xl border theme-border bg-white p-5 text-center shadow-sm">
        <p className="font-black text-gray-800">No linked answers have been added yet.</p>
        <p className="mt-1 text-sm font-bold text-gray-500">The teacher can add presentation answers in PowerPoint Viewer Mode.</p>
      </div>
    )
  }

  return (
    <div className="rounded-3xl border theme-border bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black text-gray-900">Linked Answers</h2>
      <div className="mt-4 space-y-3">
        {answers.map((answer, index) => (
          <div key={answer.id || index} className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-sky-700">Answer {index + 1}</p>
            <p className="mt-2 text-sm font-bold text-emerald-800">{answer.answer}</p>
            {answer.explanation && <p className="mt-2 text-sm font-bold leading-relaxed text-gray-600">{answer.explanation}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PowerPointViewerPlayer({ lesson }) {
  const navigate = useNavigate()
  const deckRef = useRef(null)
  const [index, setIndex] = useState(0)
  const [complete, setComplete] = useState(false)
  const [showAnswers, setShowAnswers] = useState(false)
  const [embedLoaded, setEmbedLoaded] = useState(false)

  const slides = useMemo(() => {
    return (lesson?.presentation?.slideImages || [])
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  }, [lesson])

  const activeSlide = slides[index]
  const progress = complete ? 100 : slides.length ? Math.round(((index + 1) / slides.length) * 100) : 0
  const answers = lesson?.answers || []
  const sourceUrl = lesson?.presentation?.sourceUrl || ''
  const officeEmbedUrl = sourceUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(sourceUrl)}`
    : ''

  function goNext() {
    setShowAnswers(false)
    if (complete) return
    if (index >= slides.length - 1) {
      setComplete(true)
      return
    }
    setIndex(current => Math.min(slides.length - 1, current + 1))
  }

  function goPrevious() {
    setShowAnswers(false)
    if (complete) {
      setComplete(false)
      return
    }
    setIndex(current => Math.max(0, current - 1))
  }

  function replay() {
    setIndex(0)
    setComplete(false)
    setShowAnswers(false)
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement && deckRef.current?.requestFullscreen) {
        await deckRef.current.requestFullscreen()
      } else if (document.exitFullscreen) {
        await document.exitFullscreen()
      }
    } catch (error) {
      console.warn('Fullscreen unavailable:', error)
    }
  }

  if (!slides.length && officeEmbedUrl) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button onClick={() => navigate('/lessons')} className="mb-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-600">
                Back to Lessons
              </button>
              <h1 className="text-2xl font-black text-gray-900">{lesson.title}</h1>
              <p className="text-sm font-bold text-gray-500">Grade {lesson.grade} · {lesson.subject} · {lesson.topic}</p>
            </div>
            <button onClick={toggleFullscreen} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700">
              Full Screen
            </button>
          </div>

          <div ref={deckRef} className="rounded-[2rem] bg-gray-950 p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3 px-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-sky-400 transition-all duration-300" style={{ width: complete ? '100%' : '35%' }} />
              </div>
              <span className="text-xs font-black text-white">{complete ? 'Complete' : 'PowerPoint Viewer'}</span>
            </div>

            {complete ? (
              <LessonCompleteScreen
                lesson={lesson}
                onReplay={() => {
                  setComplete(false)
                  setShowAnswers(false)
                }}
                onCheckAnswers={() => setShowAnswers(true)}
              />
            ) : (
              <div className="overflow-hidden rounded-3xl bg-black">
                {!embedLoaded && (
                  <div className="flex h-[520px] items-center justify-center text-center text-white">
                    <div>
                      <p className="text-lg font-black">Loading presentation...</p>
                      <p className="mt-1 text-sm font-bold text-white/60">The original PowerPoint design is opening in the web viewer.</p>
                    </div>
                  </div>
                )}
                <iframe
                  title={`${lesson.title} PowerPoint viewer`}
                  src={officeEmbedUrl}
                  onLoad={() => setEmbedLoaded(true)}
                  className={`h-[72vh] min-h-[480px] w-full bg-white ${embedLoaded ? 'block' : 'hidden'}`}
                  allowFullScreen
                />
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3">
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="rounded-xl border-2 border-gray-200 px-4 py-2 text-sm font-black text-gray-700">
                Open File
              </a>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-sky-700">
                Original PowerPoint
              </span>
              <button onClick={() => setComplete(true)} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-black text-white">
                Finish Lesson
              </button>
            </div>
          </div>

          {showAnswers && complete && <AnswersPanel answers={answers} />}
        </div>
      </div>
    )
  }

  if (!slides.length) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="max-w-lg rounded-3xl border theme-border bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-black text-gray-900">Presentation preview is not ready</h1>
          <p className="mt-2 text-sm font-bold leading-relaxed text-gray-500">
            This PowerPoint lesson has the original file saved, but no web slide images are available yet.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {lesson?.presentation?.sourceUrl && (
              <a href={lesson.presentation.sourceUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white">
                Open Original File
              </a>
            )}
            <Link to="/lessons" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-black text-gray-700">
              Back to Lessons
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button onClick={() => navigate('/lessons')} className="mb-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-600">
              Back to Lessons
            </button>
            <h1 className="text-2xl font-black text-gray-900">{lesson.title}</h1>
            <p className="text-sm font-bold text-gray-500">Grade {lesson.grade} · {lesson.subject} · {lesson.topic}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={toggleFullscreen} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700">
              Full Screen
            </button>
          </div>
        </div>

        <div ref={deckRef} className="rounded-[2rem] bg-gray-950 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 px-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-sky-400 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-black text-white">{complete ? 'Complete' : `${index + 1} / ${slides.length}`}</span>
          </div>

          {complete ? (
            <LessonCompleteScreen
              lesson={lesson}
              onReplay={replay}
              onCheckAnswers={() => setShowAnswers(true)}
            />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center rounded-3xl bg-black p-2 sm:min-h-[520px]">
              <img
                src={activeSlide.imageUrl}
                alt={activeSlide.alt || `Slide ${index + 1}`}
                className="max-h-[78vh] w-full rounded-2xl object-contain shadow-lg"
              />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3">
            <button onClick={goPrevious} disabled={!complete && index === 0} className="rounded-xl border-2 border-gray-200 px-4 py-2 text-sm font-black text-gray-700 disabled:opacity-40">
              Previous
            </button>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-600">
              Presentation Mode
            </span>
            <button onClick={goNext} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-black text-white">
              {index >= slides.length - 1 && !complete ? 'Finish Lesson' : 'Next'}
            </button>
          </div>
        </div>

        {showAnswers && complete && <AnswersPanel answers={answers} />}
      </div>
    </div>
  )
}
