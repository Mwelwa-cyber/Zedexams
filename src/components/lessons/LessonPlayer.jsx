import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import SlideRenderer from './SlideRenderer'
import LessonCompleteScreen from './LessonCompleteScreen'
import PowerPointViewerPlayer from './PowerPointViewerPlayer'
import { convertQuickLessonToSlides } from './quickLessonConverter'
import { ensureEndSlide, getSlideAnswers } from './lessonConstants'

function AnswersPanel({ answers }) {
  if (!answers.length) {
    return (
      <div className="rounded-3xl border border-gray-100 bg-white p-5 text-center shadow-sm">
        <p className="font-black text-gray-800">No activity answers have been added yet.</p>
        <p className="mt-1 text-sm font-bold text-gray-500">The teacher can add answers inside question/activity slides.</p>
      </div>
    )
  }

  return (
    <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black text-gray-900">Activity Answers</h2>
      <div className="mt-4 space-y-3">
        {answers.map((answer, index) => (
          <div key={answer.id || answer.slideId || index} className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-sky-700">Activity {index + 1}</p>
            <p className="mt-2 text-sm font-black text-gray-900">{answer.prompt}</p>
            <p className="mt-3 text-sm font-bold text-emerald-800"><span className="font-black">Answer:</span> {answer.answer}</p>
            {answer.explanation && <p className="mt-2 text-sm font-bold leading-relaxed text-gray-600">{answer.explanation}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function LessonPlayer() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const deckRef = useRef(null)
  const { getLessonById } = useFirestore()

  const [lesson, setLesson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [complete, setComplete] = useState(false)
  const [showAnswers, setShowAnswers] = useState(false)
  const [teacherMode, setTeacherMode] = useState(false)

  useEffect(() => {
    async function load() {
      const data = await getLessonById(lessonId)
      setLesson(data)
      setLoading(false)
    }
    load()
  }, [lessonId])

  const slides = useMemo(() => {
    if (!lesson) return []
    if (lesson.mode === 'pptx_viewer' || lesson.creationMode === 'pptx_viewer') return []
    if (lesson.slides?.length) return ensureEndSlide(lesson.slides)
    return convertQuickLessonToSlides({ title: lesson.title, topic: lesson.topic, content: lesson.content || '' })
  }, [lesson])

  const answers = useMemo(() => lesson?.answers?.length ? lesson.answers : getSlideAnswers(slides), [lesson, slides])
  const activeSlide = slides[index]
  const progress = complete ? 100 : slides.length ? Math.round(((index + 1) / slides.length) * 100) : 0

  useEffect(() => {
    function handleKey(event) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return
      if (event.key === 'ArrowRight') goNext()
      if (event.key === 'ArrowLeft') goPrevious()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [complete, index, slides.length])

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

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div className="h-8 w-2/3 animate-pulse rounded-xl bg-gray-200" />
        <div className="h-[520px] animate-pulse rounded-3xl bg-gray-200" />
      </div>
    )
  }

  if (!lesson) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-black text-gray-900">Lesson not found</h1>
          <Link to="/lessons" className="mt-4 inline-block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white">Back to Lessons</Link>
        </div>
      </div>
    )
  }

  if (lesson.mode === 'pptx_viewer' || lesson.creationMode === 'pptx_viewer') {
    return <PowerPointViewerPlayer lesson={lesson} />
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
            <button onClick={() => setTeacherMode(value => !value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700">
              {teacherMode ? 'Learner Mode' : 'Teacher Mode'}
            </button>
            <button onClick={() => alert('Read-aloud support is prepared for a future text-to-speech integration.')} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700">
              Read Aloud
            </button>
            <button onClick={toggleFullscreen} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700">
              Full Screen
            </button>
          </div>
        </div>

        <div ref={deckRef} className="rounded-[2rem] bg-gray-950 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 px-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-emerald-400 transition-all duration-300" style={{ width: `${progress}%` }} />
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
            <div className="animate-fade-in">
              <SlideRenderer lesson={lesson} slide={activeSlide} index={index} total={slides.length} showAnswer={showAnswers} />
              {teacherMode && activeSlide?.teacherNotes && (
                <div className="mt-3 rounded-2xl bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-wide text-gray-400">Teacher notes</p>
                  <p className="mt-1 text-sm font-bold leading-relaxed text-gray-700">{activeSlide.teacherNotes}</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3">
            <button onClick={goPrevious} disabled={!complete && index === 0} className="rounded-xl border-2 border-gray-200 px-4 py-2 text-sm font-black text-gray-700 disabled:opacity-40">
              Previous
            </button>
            {!complete && activeSlide?.type === 'question' && (
              <button onClick={() => setShowAnswers(value => !value)} className="rounded-xl border-2 border-sky-200 bg-sky-50 px-4 py-2 text-sm font-black text-sky-700">
                {showAnswers ? 'Hide Answer' : 'Check This Answer'}
              </button>
            )}
            <button onClick={goNext} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white">
              {index >= slides.length - 1 && !complete ? 'Finish Lesson' : 'Next'}
            </button>
          </div>
        </div>

        {showAnswers && complete && <AnswersPanel answers={answers} />}
      </div>
    </div>
  )
}
