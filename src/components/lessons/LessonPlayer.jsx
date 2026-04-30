import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Volume2, Eye, EyeOff } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import SlideRenderer from './SlideRenderer'
import LessonCompleteScreen from './LessonCompleteScreen'
import PowerPointViewerPlayer from './PowerPointViewerPlayer'
import { convertQuickLessonToSlides } from './quickLessonConverter'
import { ensureEndSlide, getSlideAnswers } from './lessonConstants'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'

function AnswersPanel({ answers }) {
  if (!answers.length) {
    return (
      <div className="surface rounded-radius-lg p-5 text-center">
        <p className="font-black theme-text">No activity answers have been added yet.</p>
        <p className="mt-1 text-sm font-bold theme-text-muted">The teacher can add answers inside question/activity slides.</p>
      </div>
    )
  }

  return (
    <div className="surface rounded-radius-lg p-5">
      <h2 className="text-xl font-black theme-text">Activity Answers</h2>
      <div className="mt-4 space-y-3">
        {answers.map((answer, index) => (
          <div key={answer.id || answer.slideId || index} className="surface--tight rounded-radius-md p-4 bg-info-subtle">
            <p className="text-xs font-black uppercase tracking-wide text-info">Activity {index + 1}</p>
            <p className="mt-2 text-sm font-black theme-text">{answer.prompt}</p>
            <p className="mt-3 text-sm font-bold text-success"><span className="font-black">Answer:</span> {answer.answer}</p>
            {answer.explanation && <p className="mt-2 text-sm font-bold leading-relaxed theme-text-muted">{answer.explanation}</p>}
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
    let cancelled = false
    async function load() {
      try {
        const data = await getLessonById(lessonId)
        if (cancelled) return
        setLesson(data)
      } catch (err) {
        console.error('LessonPlayer load failed', err)
        if (!cancelled) setLesson(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
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
        <Skeleton height={32} width="66%" className="rounded-xl" />
        <Skeleton height={520} className="rounded-3xl" />
      </div>
    )
  }

  if (!lesson) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-display-xl text-gray-900">Lesson not found</h1>
          <div className="mt-4 inline-flex">
            <Button
              as={Link}
              to="/lessons"
              variant="primary"
              size="md"
              leadingIcon={<Icon as={ArrowLeft} size="sm" />}
            >
              Back to Lessons
            </Button>
          </div>
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
            <div className="mb-2 inline-flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/lessons')}
                leadingIcon={<Icon as={ArrowLeft} size="sm" />}
              >
                Back to Lessons
              </Button>
            </div>
            <p className="text-eyebrow">Lesson</p>
            <h1 className="text-display-xl text-gray-900 mt-1">{lesson.title}</h1>
            <p className="text-body-sm font-bold text-gray-500 mt-1">Grade {lesson.grade} · {lesson.subject} · {lesson.topic}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTeacherMode(value => !value)}
            >
              {teacherMode ? 'Learner Mode' : 'Teacher Mode'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => alert('Read-aloud support is prepared for a future text-to-speech integration.')}
              leadingIcon={<Icon as={Volume2} size="sm" />}
            >
              Read Aloud
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleFullscreen}
              leadingIcon={<Icon as={Maximize2} size="sm" />}
            >
              Full Screen
            </Button>
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
                <div className="mt-3 surface--tight rounded-radius-md p-4">
                  <p className="text-xs font-black uppercase tracking-wide theme-text-muted">Teacher notes</p>
                  <p className="mt-1 text-sm font-bold leading-relaxed theme-text">{activeSlide.teacherNotes}</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 surface--tight flex flex-wrap items-center justify-between gap-3 rounded-radius-md p-3">
            <Button
              variant="secondary"
              size="md"
              onClick={goPrevious}
              disabled={!complete && index === 0}
              leadingIcon={<Icon as={ChevronLeft} size="sm" />}
            >
              Previous
            </Button>
            {!complete && activeSlide?.type === 'question' && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => setShowAnswers(value => !value)}
                leadingIcon={<Icon as={showAnswers ? EyeOff : Eye} size="sm" />}
              >
                {showAnswers ? 'Hide Answer' : 'Check This Answer'}
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              onClick={goNext}
              trailingIcon={<Icon as={ChevronRight} size="sm" />}
            >
              {index >= slides.length - 1 && !complete ? 'Finish Lesson' : 'Next'}
            </Button>
          </div>
        </div>

        {showAnswers && complete && <AnswersPanel answers={answers} />}
      </div>
    </div>
  )
}
