import { LESSON_THEME_MAP } from '../lib/lessonConstants'

function LessonIllustration({ slide }) {
  return (
    <div className="relative h-full min-h-[220px] rounded-2xl bg-gradient-to-br from-sky-100 via-white to-emerald-100 border border-white/70 overflow-hidden flex items-center justify-center">
      <div className="absolute inset-x-8 top-8 h-10 rounded-full bg-white/70" />
      <div className="relative flex flex-col items-center">
        <div className="w-14 h-14 rounded-full bg-amber-100 border-4 border-white shadow-sm flex items-center justify-center text-2xl">☺</div>
        <div className="w-4 h-20 bg-sky-300 rounded-full mt-1" />
        <div className="flex gap-4 -mt-12">
          <div className="w-20 h-28 rounded-[48%] bg-rose-200 border-4 border-white shadow-sm" />
          <div className="w-20 h-28 rounded-[48%] bg-rose-200 border-4 border-white shadow-sm" />
        </div>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-sky-700 shadow-sm">
          {slide.imageAlt || 'Lesson visual'}
        </div>
      </div>
    </div>
  )
}

function SlideShell({ children, lesson, slide, compact }) {
  const theme = LESSON_THEME_MAP[lesson?.theme] ?? LESSON_THEME_MAP.fresh
  return (
    <article
      className={`relative overflow-hidden rounded-3xl border ${theme.border} bg-gradient-to-br ${theme.bg} shadow-sm ${
        compact ? 'min-h-[280px] p-5' : 'min-h-[520px] p-6 sm:p-8 lg:p-10'
      }`}
    >
      <div className="absolute right-6 top-5 text-xs font-black uppercase tracking-wide text-gray-400">
        {slide.type === 'imageText' ? 'Image + text' : slide.type}
      </div>
      <div className="relative z-10 h-full">{children}</div>
    </article>
  )
}

function MetaLine({ lesson }) {
  return (
    <div className="flex flex-wrap gap-2">
      {lesson?.grade && <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-gray-700">Grade {lesson.grade}</span>}
      {lesson?.subject && <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-gray-700">{lesson.subject}</span>}
      {lesson?.topic && <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-gray-700">{lesson.topic}</span>}
    </div>
  )
}

function BulletList({ bullets = [] }) {
  return (
    <ul className="space-y-3">
      {bullets.filter(Boolean).map((bullet, index) => (
        <li key={`${bullet}-${index}`} className="flex gap-3 text-gray-700">
          <span className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-black text-white">
            {index + 1}
          </span>
          <span className="text-base font-bold leading-relaxed sm:text-lg">{bullet}</span>
        </li>
      ))}
    </ul>
  )
}

export default function SlideRenderer({ lesson, slide, index = 0, total = 1, showAnswer = false, compact = false }) {
  const safeSlide = slide || { type: 'text', title: 'No slide selected', body: 'Add a slide to preview it.' }
  const theme = LESSON_THEME_MAP[lesson?.theme] ?? LESSON_THEME_MAP.fresh

  if (safeSlide.type === 'title') {
    return (
      <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
        <div className="flex min-h-[240px] flex-col justify-center gap-6">
          <MetaLine lesson={lesson} />
          <div>
            <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>{safeSlide.subtitle || lesson?.topic || 'Lesson'}</p>
            <h1 className="max-w-3xl text-4xl font-black leading-tight text-gray-900 sm:text-5xl">
              {safeSlide.title || lesson?.title || 'Untitled Lesson'}
            </h1>
            {safeSlide.body && <p className="mt-5 max-w-2xl text-lg font-bold leading-relaxed text-gray-600">{safeSlide.body}</p>}
          </div>
          <div className="flex items-center gap-3 text-sm font-black text-gray-500">
            <span className={`h-2 w-16 rounded-full ${theme.panel}`} />
            Slide {index + 1} of {total}
          </div>
        </div>
      </SlideShell>
    )
  }

  if (safeSlide.type === 'bullets') {
    return (
      <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
        <div className="grid h-full gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>Key points</p>
            <h2 className="text-3xl font-black leading-tight text-gray-900 sm:text-4xl">{safeSlide.title || 'Important Points'}</h2>
            {safeSlide.body && <p className="mt-4 text-base font-bold leading-relaxed text-gray-600">{safeSlide.body}</p>}
          </div>
          <div className="rounded-2xl bg-white/80 p-5 shadow-sm">
            <BulletList bullets={safeSlide.bullets} />
          </div>
        </div>
      </SlideShell>
    )
  }

  if (safeSlide.type === 'imageText') {
    return (
      <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
        <div className="grid h-full gap-6 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div className="min-h-[240px]">
            {safeSlide.imageUrl ? (
              <img
                src={safeSlide.imageUrl}
                alt={safeSlide.imageAlt || safeSlide.title || 'Lesson image'}
                onError={event => { event.currentTarget.style.display = 'none' }}
                className="h-full max-h-[360px] w-full rounded-2xl border border-white/70 object-cover shadow-sm"
              />
            ) : (
              <LessonIllustration slide={safeSlide} />
            )}
          </div>
          <div>
            <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>Look closely</p>
            <h2 className="text-3xl font-black leading-tight text-gray-900 sm:text-4xl">{safeSlide.title || 'Lesson Visual'}</h2>
            <p className="mt-4 text-lg font-bold leading-relaxed text-gray-700">{safeSlide.body || 'Add a short explanation for this visual.'}</p>
          </div>
        </div>
      </SlideShell>
    )
  }

  if (safeSlide.type === 'example') {
    return (
      <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
        <div className="mx-auto flex max-w-3xl flex-col justify-center gap-6">
          <div>
            <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>Worked example</p>
            <h2 className="text-3xl font-black leading-tight text-gray-900 sm:text-4xl">{safeSlide.title || 'Example'}</h2>
            {safeSlide.body && <p className="mt-4 text-lg font-bold leading-relaxed text-gray-600">{safeSlide.body}</p>}
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white/85 p-5">
            <p className="text-base font-black text-amber-700">Example</p>
            <p className="mt-2 text-lg font-bold leading-relaxed text-gray-800">{safeSlide.example || 'Add the example here.'}</p>
          </div>
          {safeSlide.explanation && <p className="rounded-2xl bg-emerald-50 p-4 text-base font-bold leading-relaxed text-emerald-800">{safeSlide.explanation}</p>}
        </div>
      </SlideShell>
    )
  }

  if (safeSlide.type === 'question') {
    return (
      <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
        <div className="mx-auto flex max-w-3xl flex-col justify-center gap-6">
          <div>
            <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>Activity</p>
            <h2 className="text-3xl font-black leading-tight text-gray-900 sm:text-4xl">{safeSlide.title || 'Try It'}</h2>
          </div>
          <div className="rounded-2xl bg-white/90 p-6 shadow-sm">
            <p className="text-xl font-black leading-relaxed text-gray-900">{safeSlide.prompt || safeSlide.body || 'Add a learner activity.'}</p>
          </div>
          {showAnswer && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-black uppercase text-emerald-700">Answer</p>
                <p className="mt-2 text-sm font-bold leading-relaxed text-emerald-950">{safeSlide.answer || 'No answer added yet.'}</p>
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <p className="text-xs font-black uppercase text-sky-700">Explanation</p>
                <p className="mt-2 text-sm font-bold leading-relaxed text-sky-950">{safeSlide.explanation || 'No explanation added yet.'}</p>
              </div>
            </div>
          )}
        </div>
      </SlideShell>
    )
  }

  if (safeSlide.type === 'summary') {
    return (
      <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
        <div className="grid h-full gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>Recap</p>
            <h2 className="text-3xl font-black leading-tight text-gray-900 sm:text-4xl">{safeSlide.title || 'Summary'}</h2>
            {safeSlide.body && <p className="mt-4 text-lg font-bold leading-relaxed text-gray-600">{safeSlide.body}</p>}
          </div>
          <div className="rounded-2xl bg-white/85 p-5 shadow-sm">
            <BulletList bullets={safeSlide.bullets} />
          </div>
        </div>
      </SlideShell>
    )
  }

  if (safeSlide.type === 'end') {
    return (
      <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
        <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
          <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${theme.panel} text-3xl font-black text-white`}>✓</div>
          <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>End of lesson</p>
          <h2 className="text-4xl font-black leading-tight text-gray-900 sm:text-5xl">{safeSlide.title || 'Lesson Complete'}</h2>
          {safeSlide.subtitle && <p className="mt-3 text-xl font-black text-gray-700">{safeSlide.subtitle}</p>}
          {safeSlide.body && <p className="mt-4 max-w-2xl text-lg font-bold leading-relaxed text-gray-600">{safeSlide.body}</p>}
        </div>
      </SlideShell>
    )
  }

  return (
    <SlideShell lesson={lesson} slide={safeSlide} compact={compact}>
      <div className="mx-auto flex max-w-3xl flex-col justify-center">
        <p className={`mb-3 text-sm font-black uppercase ${theme.text}`}>Lesson note</p>
        <h2 className="text-3xl font-black leading-tight text-gray-900 sm:text-4xl">{safeSlide.title || 'Key Idea'}</h2>
        <p className="mt-5 text-xl font-bold leading-relaxed text-gray-700">{safeSlide.body || 'Add lesson text here.'}</p>
      </div>
    </SlideShell>
  )
}
