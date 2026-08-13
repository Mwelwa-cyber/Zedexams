import { Link, useNavigate } from 'react-router-dom'
import { LESSON_THEME_MAP } from '../lib/lessonConstants'

export default function LessonCompleteScreen({ lesson, onReplay, onCheckAnswers }) {
  const navigate = useNavigate()
  const theme = LESSON_THEME_MAP[lesson?.theme] ?? LESSON_THEME_MAP.fresh
  const quizPath = lesson?.linkedQuizId
    ? `/quiz/${lesson.linkedQuizId}`
    : `/quizzes?grade=${encodeURIComponent(lesson?.grade || '')}&subject=${encodeURIComponent(lesson?.subject || '')}&topic=${encodeURIComponent(lesson?.topic || '')}`

  return (
    <section className={`rounded-3xl border ${theme.border} bg-white p-6 text-center shadow-sm sm:p-8`}>
      <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${theme.panel} text-3xl font-black text-white`}>
        ✓
      </div>
      <p className={`text-sm font-black uppercase tracking-wide ${theme.text}`}>Lesson complete</p>
      <h2 className="mt-2 text-3xl font-black text-gray-900 sm:text-4xl">{lesson?.title || 'Lesson'} is complete</h2>
      <p className="mx-auto mt-3 max-w-xl text-base font-bold leading-relaxed text-gray-600">
        Choose what you want to do next. You can practise with a quiz, check activity answers, or replay the slides.
      </p>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to={quizPath} className={`${theme.panel} rounded-xl px-4 py-3 text-sm font-black text-white shadow-sm hover:brightness-95`}>
          Take Quiz
        </Link>
        <button onClick={onCheckAnswers} className="rounded-xl border-2 border-sky-200 bg-sky-50 px-4 py-3 text-sm font-black text-sky-800">
          Check Answers
        </button>
        <button onClick={onReplay} className="rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
          Replay Lesson
        </button>
        <button onClick={() => navigate('/lessons')} className="rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 text-sm font-black text-gray-700">
          Back to Lessons
        </button>
      </div>
    </section>
  )
}
