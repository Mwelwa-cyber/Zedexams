import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSampleBySlug, SAMPLE_LESSON_PLANS } from '../../data/sampleLessonPlans'
import LessonPlanView from '../teacher/views/LessonPlanView'
import { downloadLessonPlanDocx } from '../../utils/lessonPlanToDocx'

/**
 * Public sample lesson plan page. SEO landing for direct-from-Google traffic.
 */
export default function SampleDetailPage() {
  const { slug } = useParams()
  const sample = getSampleBySlug(slug)

  useEffect(() => {
    if (sample) {
      document.title = sample.seo?.title || 'Sample Lesson Plan — ZedExams'
      setMetaDescription(sample.seo?.description || '')
    } else {
      document.title = 'Sample not found — ZedExams Teacher Suite'
    }
  }, [sample])

  if (!sample) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-3">🤷</div>
          <h1 className="text-2xl font-black mb-2">Sample not found</h1>
          <p className="text-slate-600 mb-4">
            That sample doesn't exist. Browse all samples or generate your own.
          </p>
          <div className="flex gap-2 justify-center">
            <Link to="/teachers/samples" className="px-4 py-2 rounded-xl font-bold border-2 border-slate-200">
              See all samples
            </Link>
            <Link to="/teachers" className="px-4 py-2 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500">
              Generate your own
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const { plan, meta, slug: sampleSlug } = sample
  const others = SAMPLE_LESSON_PLANS.filter((s) => s.slug !== sampleSlug)

  function onDownload() {
    const filename = `${sampleSlug}-sample.docx`
    downloadLessonPlanDocx(plan, filename)
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <NavBar />

      {/* Page header */}
      <header className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-b border-emerald-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <Link to="/teachers/samples" className="text-sm font-bold text-slate-700 hover:text-slate-900">
            ← All samples
          </Link>
          <div className="mt-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
            <span>{meta.grade}</span>
            <span>·</span>
            <span>{formatSubject(meta.subject)}</span>
          </div>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black">
            {meta.topic}
          </h1>
          {meta.subtopic && (
            <p className="mt-2 text-lg text-slate-700">{meta.subtopic}</p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={onDownload}
              className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
            >
              📄 Download this lesson plan (.docx)
            </button>
            <Link
              to="/teachers#waitlist"
              className="px-5 py-2.5 rounded-xl text-sm font-black border-2 border-slate-200 text-slate-900 bg-white hover:border-slate-300"
            >
              Generate your own →
            </Link>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Zambian CBC format · CDC-aligned · Free to use in your classroom
          </p>
        </div>
      </header>

      {/* The lesson plan itself */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="rounded-2xl border-2 border-slate-200 p-5 sm:p-6">
          <LessonPlanView plan={plan} />
        </div>

        {/* CTA after the content */}
        <div className="mt-10 rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-6 text-center">
          <h2 className="text-xl sm:text-2xl font-black mb-2">
            Want this for YOUR exact topic?
          </h2>
          <p className="text-slate-700 max-w-xl mx-auto mb-5">
            Type your grade, subject and topic — get a full Zambian CBC lesson plan
            in about 30 seconds. The tool also generates worksheets with answer keys
            and revision flashcards.
          </p>
          <Link
            to="/teachers#waitlist"
            className="inline-block px-6 py-3 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
          >
            Join the waitlist →
          </Link>
        </div>

        {/* More samples */}
        {others.length > 0 && (
          <section className="mt-14">
            <h2 className="text-xl font-black mb-4">More samples</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {others.map((s) => (
                <Link
                  key={s.slug}
                  to={`/teachers/samples/${s.slug}`}
                  className="rounded-2xl border-2 border-slate-200 p-4 hover:border-emerald-300 transition"
                >
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500 mb-1">
                    {s.meta.grade} · {formatSubject(s.meta.subject)}
                  </div>
                  <div className="font-black text-slate-900">{s.meta.topic}</div>
                  {s.meta.subtopic && (
                    <div className="text-sm text-slate-600 mt-0.5">{s.meta.subtopic}</div>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  )
}

function NavBar() {
  return (
    <nav className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-2xl">📘</span>
          <span className="font-black text-lg">ZedExams</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-800">
            for Teachers
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/teachers/samples" className="hidden sm:block text-sm font-bold text-slate-700">Samples</Link>
          <Link to="/login" className="text-sm font-bold text-slate-700">Sign in</Link>
          <Link
            to="/teachers#waitlist"
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
          >
            Join the waitlist
          </Link>
        </div>
      </div>
    </nav>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 py-8 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row gap-4 items-center justify-between text-sm text-slate-600">
        <div>© {new Date().getFullYear()} ZedExams · Made in Zambia 🇿🇲</div>
        <div className="flex items-center gap-4">
          <Link to="/teachers" className="hover:text-slate-900">Teacher Suite</Link>
          <Link to="/teachers/samples" className="hover:text-slate-900">Samples</Link>
          <a href="mailto:hello@zedexams.com" className="hover:text-slate-900">Contact</a>
        </div>
      </div>
    </footer>
  )
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function setMetaDescription(content) {
  if (typeof document === 'undefined') return
  let tag = document.querySelector('meta[name="description"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('name', 'description')
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}
