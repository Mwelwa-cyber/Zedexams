import { useState } from 'react'
import { Link } from 'react-router-dom'
import { submitWaitlist } from '../../utils/waitlistService'
import {
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
} from '../../utils/teacherTools'

/**
 * Public marketing page for the Teacher Suite on zedexams.com.
 * Mobile-first, Zambian-priced, Kwacha-visible, waitlist-driven.
 */
export default function TeacherLandingPage() {
  return (
    <div className="force-light-theme min-h-screen bg-white text-slate-900">
      <NavBar />
      <Hero />
      <SocialProof />
      <ProblemSection />
      <ToolsSection />
      <HowItWorks />
      <PricingSection />
      <FaqSection />
      <WaitlistSection />
      <Footer />
    </div>
  )
}

/* ── Nav ────────────────────────────────────────────────────── */

function NavBar() {
  return (
    <nav className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">📘</span>
          <span className="font-black text-lg">ZedExams</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-800">
            for Teachers
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/teachers/samples" className="hidden sm:block text-sm font-bold text-slate-700 hover:text-slate-900">Samples</Link>
          <a href="#pricing" className="hidden sm:block text-sm font-bold text-slate-700 hover:text-slate-900">Pricing</a>
          <a href="#faq" className="hidden sm:block text-sm font-bold text-slate-700 hover:text-slate-900">FAQ</a>
          <Link
            to="/login"
            className="text-sm font-bold text-slate-700 hover:text-slate-900"
          >
            Sign in
          </Link>
          <a
            href="#waitlist"
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
          >
            Join the waitlist
          </a>
        </div>
      </div>
    </nav>
  )
}

/* ── Hero ───────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-b border-emerald-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-emerald-200 text-xs font-black uppercase tracking-wide text-emerald-800 mb-5">
            <span>🇿🇲</span>
            <span>Made in Zambia · CBC-aligned</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight text-slate-900">
            AI lesson plans, worksheets &amp; flashcards for Zambian teachers —{' '}
            <span className="text-emerald-600">in 30 seconds</span>.
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-700 max-w-xl">
            Stop spending Sundays writing lesson plans by hand. Generate a full
            CBC-format plan — Specific Outcomes, Key Competencies, Values,
            Pupils' &amp; Teacher's Activities — and print it for your head
            teacher before the bell rings.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <a
              href="#waitlist"
              className="px-6 py-3 rounded-xl text-base font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-center"
            >
              Join the waitlist →
            </a>
            <Link
              to="/teachers/samples"
              className="px-6 py-3 rounded-xl text-base font-black text-slate-900 bg-white border-2 border-slate-200 hover:border-slate-300 text-center"
            >
              See sample plans
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Free tier: 10 lesson plans, 5 worksheets, 20 flashcard sets every month. No card required.
          </p>
        </div>

        {/* Hero preview card */}
        <div className="relative">
          <HeroPreviewCard />
        </div>
      </div>
    </section>
  )
}

function HeroPreviewCard() {
  return (
    <div className="relative rounded-2xl border-2 border-slate-200 bg-white shadow-2xl p-5 max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-3 h-3 rounded-full bg-rose-400"></span>
        <span className="w-3 h-3 rounded-full bg-amber-400"></span>
        <span className="w-3 h-3 rounded-full bg-emerald-400"></span>
        <span className="ml-3 text-xs text-slate-500 font-mono">zedexams.com/teacher/generate/lesson-plan</span>
      </div>
      <div className="space-y-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-800 mb-1">Lesson Plan</p>
          <p className="font-black text-slate-900">Grade 5 Mathematics — Adding Fractions</p>
          <p className="text-xs text-slate-500">40 min · CDC-aligned</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-bold text-slate-800">Specific Outcomes</p>
          <ul className="mt-1 text-xs text-slate-600 space-y-0.5">
            <li>• Identify the LCD of two unlike denominators.</li>
            <li>• Add fractions with unlike denominators.</li>
            <li>• Apply fraction addition to real-life problems.</li>
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 p-2">
            <p className="font-bold text-slate-800 mb-0.5">Key Competencies</p>
            <p className="text-slate-600">Critical thinking · Numeracy · Collaboration</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-2">
            <p className="font-bold text-slate-800 mb-0.5">Values</p>
            <p className="text-slate-600">Accuracy · Perseverance · Cooperation</p>
          </div>
        </div>
        <button className="w-full px-3 py-2 rounded-xl text-xs font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500">
          📄 Download .docx
        </button>
      </div>
      <div className="absolute -bottom-3 -right-3 rotate-3 bg-amber-400 text-slate-900 text-xs font-black px-3 py-1 rounded-full shadow-md">
        Generated in 18 seconds ⚡
      </div>
    </div>
  )
}

/* ── Social proof (seeds/placeholders — replace with real teachers) ─ */

function SocialProof() {
  return (
    <section className="border-b border-slate-200 py-6 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <p className="text-center text-xs font-black uppercase tracking-wide text-slate-500">
          Built for Zambian CBC — Grades 1-9 syllabus seeded, Grades 10-12 on the way
        </p>
      </div>
    </section>
  )
}

/* ── Problem ────────────────────────────────────────────────── */

function ProblemSection() {
  return (
    <section className="py-14 sm:py-20 bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-black text-center mb-4">
          Lesson planning shouldn't steal your Sundays.
        </h2>
        <p className="text-base sm:text-lg text-slate-700 text-center max-w-2xl mx-auto">
          Every Zambian teacher knows it. The head teacher wants proper CDC-format
          plans. The pupils need fresh worksheets. The ECZ exams are coming. And
          the Wi-Fi at home is patchy, the printer is out of toner, and it's 9pm.
        </p>
        <p className="text-lg sm:text-xl text-emerald-700 font-black text-center mt-6">
          ZedExams Teacher Suite writes the first draft. You just review and teach.
        </p>
      </div>
    </section>
  )
}

/* ── Tools ──────────────────────────────────────────────────── */

function ToolsSection() {
  const tools = [
    {
      icon: '✨',
      colour: 'emerald',
      title: 'CBC Lesson Plan',
      body: 'Specific Outcomes, Key Competencies, Values, parallel Pupils\' and Teacher\'s Activities, Assessment, Differentiation. Exactly the format your head teacher expects. Download as Word.',
      time: '20–30 sec',
    },
    {
      icon: '📝',
      colour: 'indigo',
      title: 'Worksheet + Answer Key',
      body: 'Printable questions with working space, a matching answer key for you, and full marking notes. Pick difficulty, question count, and duration.',
      time: '10–20 sec',
    },
    {
      icon: '🎴',
      colour: 'amber',
      title: 'Revision Flashcards',
      body: 'Quick study decks for your pupils, with an on-screen study mode and printable cut-out cards for class.',
      time: '5–15 sec',
    },
  ]
  return (
    <section id="tools" className="py-14 sm:py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-black text-center mb-3">
          Three tools. All Zambian CBC. All yours.
        </h2>
        <p className="text-center text-slate-600 max-w-2xl mx-auto mb-10">
          Built on Anthropic's Claude and grounded in real Zambian CDC syllabi.
          Not generic "pan-African" content — the words and structure Zambian
          teachers actually use.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {tools.map((t) => (
            <div
              key={t.title}
              className={`rounded-2xl border-2 p-6 bg-gradient-to-br ${
                t.colour === 'emerald' ? 'border-emerald-200 from-emerald-50 to-teal-50' :
                t.colour === 'indigo' ? 'border-indigo-200 from-indigo-50 to-purple-50' :
                                         'border-amber-200 from-amber-50 to-orange-50'
              }`}
            >
              <div className="text-4xl mb-3">{t.icon}</div>
              <h3 className="font-black text-lg mb-2">{t.title}</h3>
              <p className="text-sm text-slate-700 leading-relaxed">{t.body}</p>
              <p className="text-xs font-black uppercase tracking-wide text-slate-500 mt-4">
                ⚡ {t.time}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── How it works ───────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    { n: '1', title: 'Pick your lesson', body: 'Grade, subject, topic. That\'s it. Use the exact CDC topic names, or type your own.' },
    { n: '2', title: 'Claude does the writing', body: 'In under 30 seconds, you get a full Zambian CBC-format plan, worksheet, or flashcard set.' },
    { n: '3', title: 'Review, export, print', body: 'Download as Word, edit if you want to, print for class — or keep teaching from your phone.' },
  ]
  return (
    <section className="py-14 sm:py-20 bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-black text-center mb-10">
          How it works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {steps.map((s) => (
            <div key={s.n} className="rounded-2xl border-2 border-slate-200 bg-white p-6">
              <div className="w-10 h-10 rounded-full bg-emerald-500 text-white font-black flex items-center justify-center mb-3">
                {s.n}
              </div>
              <h3 className="font-black text-base mb-1">{s.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Pricing ────────────────────────────────────────────────── */

function PricingSection() {
  const tiers = [
    {
      name: 'Free',
      price: 'K0',
      period: 'forever',
      highlight: false,
      features: [
        '10 lesson plans / month',
        '5 worksheets / month',
        '20 flashcard sets / month',
        'DOCX export',
        'Grades 1–9 CBC topics',
      ],
      cta: 'Sign up free',
      ctaHref: '/register',
    },
    {
      name: 'Teacher',
      price: 'K89',
      period: '/ month',
      altPrice: 'or K799 / year — save K269',
      highlight: true,
      features: [
        '100 lesson plans / month',
        '50 worksheets / month',
        '200 flashcard sets / month',
        'All CBC grades as they roll out',
        'Priority generation',
        'MTN, Airtel and Zamtel mobile money',
      ],
      cta: 'Join the waitlist',
      ctaHref: '#waitlist',
    },
    {
      name: 'School',
      price: 'K5,000',
      period: '/ year',
      altPrice: 'up to 20 teachers (K15,000 for up to 60)',
      highlight: false,
      features: [
        'All Teacher features, per seat',
        'School admin dashboard',
        'Bulk invoicing for your bursar',
        'Head-teacher content moderation',
        'Priority support',
      ],
      cta: 'Contact us',
      ctaHref: 'mailto:hello@zedexams.com?subject=School%20pricing',
    },
  ]
  return (
    <section id="pricing" className="py-14 sm:py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-black text-center mb-3">
          Zambian pricing. Pay with mobile money.
        </h2>
        <p className="text-center text-slate-600 max-w-2xl mx-auto mb-10">
          Priced for real Zambian teacher salaries, not Silicon Valley. Annual
          plans billed once via MTN MoMo, Airtel Money or Zamtel Kwacha.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`rounded-2xl border-2 p-6 ${
                t.highlight ?
                  'border-emerald-400 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-lg relative' :
                  'border-slate-200 bg-white'
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-3 right-6 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide bg-emerald-500 text-white">
                  Most popular
                </span>
              )}
              <h3 className="font-black text-xl mb-2">{t.name}</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-black">{t.price}</span>
                <span className="text-slate-500 text-sm">{t.period}</span>
              </div>
              {t.altPrice && (
                <p className="text-xs text-slate-500 mb-4">{t.altPrice}</p>
              )}
              <ul className="space-y-2 mb-6 mt-4">
                {t.features.map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="text-emerald-600 font-black">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {t.ctaHref.startsWith('#') || t.ctaHref.startsWith('mailto:') ? (
                <a
                  href={t.ctaHref}
                  className={`block text-center w-full py-3 rounded-xl font-black transition ${
                    t.highlight ?
                      'text-white bg-gradient-to-r from-emerald-500 to-teal-500' :
                      'text-slate-900 bg-white border-2 border-slate-300'
                  }`}
                >
                  {t.cta}
                </a>
              ) : (
                <Link
                  to={t.ctaHref}
                  className={`block text-center w-full py-3 rounded-xl font-black transition ${
                    t.highlight ?
                      'text-white bg-gradient-to-r from-emerald-500 to-teal-500' :
                      'text-slate-900 bg-white border-2 border-slate-300'
                  }`}
                >
                  {t.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── FAQ ────────────────────────────────────────────────────── */

function FaqSection() {
  const faqs = [
    {
      q: 'Is this actually aligned to the Zambian CBC?',
      a: 'Yes. Every generation is grounded in the 2013 Zambia Education Curriculum Framework and CDC syllabi for the grade and subject you pick. The output uses proper Zambian terms — Specific Outcomes, Key Competencies, Values, Pupils\' Activities, Teacher\'s Reflection — in the exact format head teachers expect to see.',
    },
    {
      q: 'Who is behind ZedExams?',
      a: 'ZedExams is a Zambian-built platform already serving students with past papers, quizzes, and revision lessons. The Teacher Suite is our new tool for the people doing the actual teaching.',
    },
    {
      q: 'Do I need a bank card?',
      a: 'No. Mobile money works — MTN Money, Airtel Money, and Zamtel Kwacha. The Free tier never asks for payment.',
    },
    {
      q: 'Can my school buy for all our teachers?',
      a: 'Yes, the School tier is designed for that. Email hello@zedexams.com and we\'ll send you an invoice your bursar can process.',
    },
    {
      q: 'What about Grades 10, 11 and 12?',
      a: 'The Grade 1–9 CBC topic library is seeded and curated. Grade 10–12 (Biology, Chemistry, Physics, History, Geography, Literature, etc.) works via general CBC knowledge and is being added to the curated library over the next few months.',
    },
    {
      q: 'Is the output really accurate?',
      a: 'The AI writes an excellent first draft, but you are the teacher — you should always review before using. Nothing replaces your professional judgement, and we\'re very clear about that in every generation.',
    },
    {
      q: 'What languages does it support?',
      a: 'English today. Bemba, Nyanja, Tonga, Lozi, Kaonde, Lunda and Luvale are on the roadmap.',
    },
  ]
  return (
    <section id="faq" className="py-14 sm:py-20 bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-black text-center mb-10">
          Questions Zambian teachers ask us
        </h2>
        <div className="space-y-3">
          {faqs.map((item, i) => (
            <details key={i} className="rounded-xl border-2 border-slate-200 bg-white p-4 group">
              <summary className="cursor-pointer font-black text-slate-900 list-none flex justify-between items-center">
                {item.q}
                <span className="text-xl group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="mt-3 text-sm text-slate-700 leading-relaxed">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Waitlist ───────────────────────────────────────────────── */

function WaitlistSection() {
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    schoolName: '',
    grade: '',
    subject: '',
    role: 'teacher',
  })
  const [status, setStatus] = useState('idle') // idle | submitting | done | error
  const [errorMessage, setErrorMessage] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMessage('')
    const res = await submitWaitlist({ ...form, source: 'landing_page' })
    if (!res.ok) {
      setErrorMessage(res.error)
      setStatus('error')
      return
    }
    setStatus('done')
  }

  return (
    <section id="waitlist" className="py-14 sm:py-20 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {status !== 'done' ? (
          <>
            <h2 className="text-2xl sm:text-3xl font-black text-center mb-3">
              Be first when we open the doors
            </h2>
            <p className="text-center text-white/90 max-w-xl mx-auto mb-8">
              Founding teachers get three months free and help shape what we
              build next. Tell us where you teach and we'll send an invite as
              soon as your grade is ready.
            </p>
            <form
              onSubmit={onSubmit}
              className="rounded-2xl bg-white text-slate-900 p-5 shadow-2xl space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Your name"
                  value={form.fullName}
                  onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
                  placeholder="Mr / Mrs / Ms …"
                  max={120}
                />
                <Field
                  label="Email *"
                  type="email"
                  value={form.email}
                  onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                  placeholder="you@school.zm"
                  required
                  max={254}
                />
              </div>
              <Field
                label="School"
                value={form.schoolName}
                onChange={(v) => setForm((f) => ({ ...f, schoolName: v }))}
                placeholder="e.g. Kamwala Secondary School"
                max={160}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FieldSelect
                  label="Grade you teach"
                  value={form.grade}
                  options={[{ value: '', label: 'Pick a grade' }, ...TEACHER_GRADES]}
                  onChange={(v) => setForm((f) => ({ ...f, grade: v }))}
                />
                <FieldSelect
                  label="Subject"
                  value={form.subject}
                  options={[{ value: '', label: 'Pick a subject' }, ...TEACHER_SUBJECTS]}
                  onChange={(v) => setForm((f) => ({ ...f, subject: v }))}
                />
              </div>
              {errorMessage && (
                <p className="text-sm text-rose-700 font-bold">{errorMessage}</p>
              )}
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full py-3 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50"
              >
                {status === 'submitting' ? 'Submitting…' : 'Get my early access →'}
              </button>
              <p className="text-xs text-slate-500 text-center">
                No spam. No card. You'll hear from us when your grade is ready.
              </p>
            </form>
          </>
        ) : (
          <div className="text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl sm:text-3xl font-black mb-3">You're on the list.</h2>
            <p className="text-white/90 max-w-lg mx-auto mb-6">
              We'll email you as soon as your grade and subject are ready. In
              the meantime, tell a teacher friend — we give priority access to
              schools with multiple sign-ups.
            </p>
            <a
              href="https://wa.me/?text=Have%20you%20seen%20ZedExams%20Teacher%20Suite%3F%20It%20writes%20full%20CBC%20lesson%20plans%20in%2030%20seconds.%20https%3A%2F%2Fzedexams.com%2Fteachers"
              target="_blank"
              rel="noopener"
              className="inline-block px-5 py-3 rounded-xl font-black text-emerald-700 bg-white"
            >
              Share on WhatsApp
            </a>
          </div>
        )}
      </div>
    </section>
  )
}

function Field({ label, value, onChange, placeholder, max, type = 'text', required = false }) {
  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={max}
        required={required}
        className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 focus:outline-none focus:border-emerald-400"
      />
    </div>
  )
}

function FieldSelect({ label, value, options, onChange }) {
  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 focus:outline-none focus:border-emerald-400 bg-white"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ── Footer ─────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-slate-200 py-8 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row gap-4 items-center justify-between text-sm text-slate-600">
        <div>
          © {new Date().getFullYear()} ZedExams · Made in Zambia 🇿🇲
        </div>
        <div className="flex items-center gap-4">
          <a href="mailto:hello@zedexams.com" className="hover:text-slate-900">Contact</a>
          <Link to="/login" className="hover:text-slate-900">Sign in</Link>
          <a href="#faq" className="hover:text-slate-900">FAQ</a>
        </div>
      </div>
    </footer>
  )
}
