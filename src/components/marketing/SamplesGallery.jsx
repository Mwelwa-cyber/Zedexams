import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { SAMPLE_LESSON_PLANS } from '../../data/sampleLessonPlans'

/**
 * Public samples gallery at /teachers/samples. SEO landing for queries like
 * "Grade 5 Mathematics Fractions lesson plan Zambia".
 */
export default function SamplesGallery() {
  useEffect(() => {
    document.title = 'Sample CBC Lesson Plans — ZedExams Teacher Suite'
    setMetaDescription(
      'Browse free ready-to-use Zambian CBC lesson plans for all grades. Download as Word, print for class, or generate your own in 30 seconds.',
    )
  }, [])

  return (
    <div className="force-light-theme min-h-screen bg-white text-slate-900">
      <NavBar />
      <header className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-b border-emerald-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <Link to="/teachers" className="text-sm font-bold text-slate-700 hover:text-slate-900">
            ← Back to Teacher Suite
          </Link>
          <h1 className="mt-3 text-3xl sm:text-4xl font-black">
            Sample Zambian CBC Lesson Plans
          </h1>
          <p className="mt-3 text-base sm:text-lg text-slate-700 max-w-2xl">
            Ready-to-use lesson plans in the proper CDC format — Specific
            Outcomes, Key Competencies, Values, Pupils' &amp; Teacher's
            Activities, Assessment. Use them as-is, or see what the tool
            produces and generate your own for any topic in under a minute.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SAMPLE_LESSON_PLANS.map((s) => (
            <SampleCard key={s.slug} sample={s} />
          ))}
        </div>

        <div className="mt-12 rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-6 text-center">
          <h2 className="text-xl sm:text-2xl font-black mb-2">
            Need a different grade or topic?
          </h2>
          <p className="text-slate-700 max-w-xl mx-auto mb-5">
            Generate a lesson plan for any Zambian CBC grade and subject in
            about 30 seconds. Free tier gives you 10 plans a month.
          </p>
          <Link
            to="/teachers#waitlist"
            className="inline-block px-6 py-3 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
          >
            Join the waitlist →
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  )
}

function SampleCard({ sample }) {
  const { slug, meta, plan } = sample
  return (
    <Link
      to={`/teachers/samples/${slug}`}
      className="group rounded-2xl border-2 border-slate-200 p-5 bg-white hover:-translate-y-0.5 hover:shadow-md hover:border-emerald-300 transition-all block"
    >
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500 mb-2">
        <span>{meta.grade}</span>
        <span>·</span>
        <span>{formatSubject(meta.subject)}</span>
      </div>
      <h3 className="font-black text-lg leading-snug text-slate-900 group-hover:text-emerald-700 transition">
        {meta.topic}
      </h3>
      {meta.subtopic && (
        <p className="text-sm text-slate-600 mt-1">{meta.subtopic}</p>
      )}
      <p className="text-xs text-slate-500 mt-3">
        {plan.header?.durationMinutes || 40} min · {plan.specificOutcomes?.length || 0} Specific Outcomes
      </p>
      <span className="mt-4 inline-block text-sm font-black text-emerald-600 group-hover:underline">
        View the full plan →
      </span>
    </Link>
  )
}

function NavBar() {
  return (
    <nav className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/zedexams-logo.png?v=4"
            alt="ZedExams"
            className="h-9 w-auto object-contain flex-shrink-0"
          />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-800">
            for Teachers
          </span>
        </Link>
        <div className="flex items-center gap-3">
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row gap-4 items-center justify-between text-sm text-slate-600">
        <div>© {new Date().getFullYear()} ZedExams · Made in Zambia 🇿🇲</div>
        <div className="flex items-center gap-4">
          <Link to="/teachers" className="hover:text-slate-900">Teacher Suite</Link>
          <a href="mailto:hello@zedexams.com" className="hover:text-slate-900">Contact</a>
          <Link to="/login" className="hover:text-slate-900">Sign in</Link>
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
