import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { PLANS, PAYMENT_DETAILS } from '../../utils/subscriptionConfig'
import { captureReferralFromUrl } from '../../utils/referrals'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import SeoHelmet from '../seo/SeoHelmet'

const UpgradeModal = lazy(() => import('../subscription/UpgradeModal'))

// One row per grade we have a product for. Keys match the URL slug
// (/grade-7, /grade-9, /grade-12). When a grade's content isn't ready
// yet we can either omit it from this map (404) or set `available:
// false` to show a "coming soon" page that still collects email
// signups. For now Grade 7 is the only live product per Mwelwa's
// "ship Grade 7 first" call.
const GRADE_PACKS = {
  '7': {
    grade: 7,
    title: 'Grade 7 ECZ Exam Pack',
    eyebrow: 'Composite exam · End of Primary',
    monthlyPlanId: 'grade7_monthly',
    termlyPlanId: 'grade7_termly',
    subjects: [
      'English',
      'Mathematics',
      'Integrated Science',
      'Social Studies',
      'Zambian Languages',
    ],
    examMonth: 'October–November',
    available: true,
  },
  '9': {
    grade: 9,
    title: 'Grade 9 ECZ Exam Pack',
    eyebrow: 'Junior secondary',
    monthlyPlanId: 'grade9_monthly',
    termlyPlanId: null,
    subjects: [
      'English',
      'Mathematics',
      'Integrated Science',
      'Social Studies',
      'Civic Education',
    ],
    examMonth: 'November',
    available: false,
  },
  '12': {
    grade: 12,
    title: 'Grade 12 ECZ Exam Pack',
    eyebrow: 'School-leaver exam',
    monthlyPlanId: 'grade12_monthly',
    termlyPlanId: null,
    subjects: [
      'English',
      'Mathematics',
      'Sciences (Biology, Chemistry, Physics)',
      'Geography',
      'History',
      'Civic Education',
    ],
    examMonth: 'October–November',
    available: false,
  },
}

const WHAT_YOU_GET = [
  {
    icon: '📖',
    title: 'Topic-by-topic revision notes',
    body: 'Condensed "must know" notes per syllabus topic. Mobile-readable — short paragraphs, clear headers, key definitions highlighted.',
  },
  {
    icon: '📑',
    title: 'Past papers with solutions',
    body: 'Every ECZ past paper from the last 5 years, with step-by-step worked solutions — not just the answer, but how to get there.',
  },
  {
    icon: '✏️',
    title: 'Auto-marked practice quizzes',
    body: '20 questions per topic, three difficulty levels (Recall · Apply · Stretch). Instant marking with explanations on every answer.',
  },
  {
    icon: '🎯',
    title: 'Exam strategy guide',
    body: 'Time management, common traps, paper structure, and a day-before checklist for parents and learners — the practical stuff schools skip.',
  },
]

const FAQ = [
  {
    q: 'How do I pay?',
    a: 'Pick a plan, then send the amount to our Mobile Money number (Airtel Money or MTN MoMo). Use your email as the reference, then tap the WhatsApp button to send us your confirmation. We activate your account within 30 minutes, 7 days a week.',
  },
  {
    q: 'Is this all the subjects?',
    a: 'Yes — every ECZ composite-exam subject is included. English, Maths, Science, Social Studies, and Zambian Languages are all in the pack at no extra cost.',
  },
  {
    q: 'What happens after 30 days?',
    a: 'Your access expires unless you renew. We send a WhatsApp reminder before that happens, and you can renew for K75 to keep going. There\'s no auto-renewal — you only pay for the periods you actually want.',
  },
  {
    q: 'Can multiple children share one account?',
    a: 'For now each account is one learner. We\'re working on a Family pack (one payment, multiple learners) — message us on WhatsApp if you want first access when it launches.',
  },
  {
    q: 'My child uses a phone, not a laptop. Does it work?',
    a: 'Yes — ZedExams is built mobile-first. Notes, quizzes, and past papers all work on any smartphone. Save the site to your home screen for one-tap access.',
  },
]

function Section({ children, className = '' }) {
  return (
    <section className={`mx-auto w-full max-w-4xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  )
}

function ComingSoon({ pack }) {
  return (
    <div className="min-h-screen theme-bg theme-text font-body">
      <SeoHelmet
        title={`${pack.title} — Coming soon`}
        description={`The ${pack.title} is in production — message us on WhatsApp to be first in line when it launches.`}
        path={`/grade-${pack.grade}`}
      />
      <Section className="py-16">
        <Link to="/" aria-label="ZedExams home" className="inline-block mb-10"><Logo size="sm" /></Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-xs font-black uppercase tracking-wider">
          ✦ Coming soon
        </span>
        <h1 className="font-display font-black text-4xl sm:text-5xl mt-4 mb-3">{pack.title}</h1>
        <p className="text-lg theme-text-muted max-w-xl">
          The {pack.title.toLowerCase()} is in production. Message us on WhatsApp and we'll let
          you know the moment it launches — usually a 50% early-bird discount for the first
          week.
        </p>
        <a
          href={`https://wa.me/${PAYMENT_DETAILS.contact.whatsapp.replace(/[^\d]/g, '')}?text=${encodeURIComponent(`Hi! Please let me know when the ${pack.title} launches.`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-6 bg-[#25D366] hover:bg-[#1FBE5C] text-white font-bold px-6 py-3 rounded-2xl"
        >
          💬 Notify me on WhatsApp
        </a>
      </Section>
    </div>
  )
}

export default function GradePackLanding() {
  const { gradeSlug } = useParams()
  const pack = GRADE_PACKS[gradeSlug]
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [showUpgrade, setShowUpgrade] = useState(false)

  // Capture ?ref=ABC12345 → localStorage so the eventual /register
  // flow writes user.referredBy. Same helper the /register page
  // uses, so a learner who lands here via a friend's share link and
  // signs up later still triggers the referral credit when their
  // grant lands. Runs once per mount; no-op if no ref or already
  // signed in (existing users can't re-attribute).
  useEffect(() => {
    if (currentUser) return
    captureReferralFromUrl(searchParams)
  }, [currentUser, searchParams])

  if (!pack) return <Navigate to="/pricing" replace />
  if (!pack.available) return <ComingSoon pack={pack} />

  const monthly = PLANS[pack.monthlyPlanId]
  const termly = pack.termlyPlanId ? PLANS[pack.termlyPlanId] : null

  function handleStart(planId) {
    if (!currentUser) {
      navigate(`/register?intent=upgrade&plan=${planId}`)
      return
    }
    setShowUpgrade(planId)
  }

  return (
    <>
      <SeoHelmet
        title={`${pack.title} — K${monthly.priceZMW}/month`}
        description={`Grade ${pack.grade} ECZ revision pack — notes, past papers, practice quizzes & exam strategy. Pay K${monthly.priceZMW} via Mobile Money, confirm on WhatsApp, activated in 30 minutes.`}
        path={`/grade-${pack.grade}`}
      />
      <div className="min-h-screen theme-bg theme-text font-body">
        {/* Nav */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
          <Section className="flex items-center justify-between py-3">
            <Link to="/" aria-label="ZedExams home"><Logo size="sm" /></Link>
            <nav className="flex items-center gap-2">
              <Button as={Link} to="/pricing" variant="ghost" size="sm">All plans</Button>
              {!currentUser && <Button as={Link} to="/login" variant="ghost" size="sm">Sign in</Button>}
            </nav>
          </Section>
        </header>

        {/* Hero */}
        <Section className="pt-12 pb-10 sm:pt-16">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#B8860B] text-white px-3 py-1 text-xs font-black uppercase tracking-wider">
            ✦ {pack.eyebrow}
          </span>
          <h1 className="font-display font-black tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mt-5 mb-4">
            {pack.title}
          </h1>
          <p className="text-lg theme-text-muted max-w-2xl mb-8">
            Everything your Grade {pack.grade} needs to walk into the {pack.examMonth} ECZ exam ready:
            condensed notes, past papers with worked solutions, auto-marked quizzes, and an exam
            strategy guide. Built by Zambian teachers, syllabus-aligned, mobile-first.
          </p>

          {/* Price cards */}
          <div className={`grid gap-4 ${termly ? 'sm:grid-cols-2' : ''}`}>
            <div className="bg-white rounded-2xl border-2 border-gray-200 p-6 hover:border-[#B8860B] transition-colors">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-bold">{monthly.tagline}</p>
              <p className="text-4xl font-black text-gray-800 mt-1">K{monthly.priceZMW}<span className="text-base font-bold text-gray-500"> / 30 days</span></p>
              <p className="text-sm text-gray-600 mt-2">Pay once. No auto-renewal. Cancel just by not topping up.</p>
              <Button variant="primary" size="lg" fullWidth className="mt-4" onClick={() => handleStart(pack.monthlyPlanId)}>
                Get the pack · K{monthly.priceZMW}
              </Button>
            </div>
            {termly && (
              <div className="bg-gradient-to-br from-[#0B1A2C] to-[#1F3A5F] text-white rounded-2xl p-6 relative">
                <span className="absolute -top-2 right-4 bg-[#F4E4BC] text-[#0B1A2C] text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                  Save K{(monthly.priceZMW * 3) - termly.priceZMW}
                </span>
                <p className="text-xs uppercase tracking-wider text-white/70 font-bold">{termly.tagline}</p>
                <p className="text-4xl font-black mt-1">K{termly.priceZMW}<span className="text-base font-bold text-white/70"> / 90 days</span></p>
                <p className="text-sm text-white/80 mt-2">Locks in the full exam run-up. Best for parents who want to pay once and forget.</p>
                <Button variant="primary" size="lg" fullWidth className="mt-4 bg-white !text-[#0B1A2C] hover:bg-white" onClick={() => handleStart(pack.termlyPlanId)}>
                  Get the term · K{termly.priceZMW}
                </Button>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-4 text-center">
            Pay via Airtel Money or MTN MoMo · Confirm on WhatsApp · Activated in 30 minutes
          </p>
        </Section>

        {/* What's inside */}
        <Section className="py-12">
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-2">What's inside</h2>
          <p className="theme-text-muted mb-8 max-w-xl">
            Four things, all included at the K{monthly.priceZMW} price — no add-ons, no upsells.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {WHAT_YOU_GET.map((item) => (
              <div key={item.title} className="bg-white border theme-border rounded-2xl p-5">
                <div className="text-3xl mb-3" aria-hidden="true">{item.icon}</div>
                <h3 className="font-display font-bold text-lg mb-1">{item.title}</h3>
                <p className="text-sm theme-text-muted leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Subjects covered */}
        <Section className="py-12">
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-2">Every subject covered</h2>
          <p className="theme-text-muted mb-6">All {pack.subjects.length} ECZ composite-exam subjects in one pack.</p>
          <div className="flex flex-wrap gap-2">
            {pack.subjects.map((subject) => (
              <span key={subject} className="inline-flex items-center gap-1.5 bg-white border-2 theme-border rounded-full px-4 py-2 text-sm font-bold theme-text">
                ✓ {subject}
              </span>
            ))}
          </div>
        </Section>

        {/* How it works */}
        <Section className="py-12">
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-6">How it works</h2>
          <div className="space-y-4">
            {[
              { n: 1, h: 'Pick a plan', b: `K${monthly.priceZMW} monthly or K${termly?.priceZMW || ''} for a whole term.` },
              { n: 2, h: 'Pay via Mobile Money', b: 'Airtel Money or MTN MoMo to our number. Use your email as the reference.' },
              { n: 3, h: 'Confirm on WhatsApp', b: 'Tap the button, send us the confirmation. Takes 30 seconds.' },
              { n: 4, h: 'Start studying', b: 'We activate within 30 minutes. Login at zedexams.com and the pack is unlocked.' },
            ].map((step) => (
              <div key={step.n} className="bg-white border theme-border rounded-2xl p-4 flex gap-4 items-start">
                <span className="flex-shrink-0 grid place-items-center w-10 h-10 rounded-full bg-[#B8860B] text-white font-black">
                  {step.n}
                </span>
                <div>
                  <h3 className="font-bold text-gray-800">{step.h}</h3>
                  <p className="text-sm theme-text-muted">{step.b}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* FAQ */}
        <Section className="py-12">
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-6">Common questions</h2>
          <div className="space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="bg-white border theme-border rounded-2xl px-5 py-4 [&[open]]:border-[#B8860B]">
                <summary className="cursor-pointer list-none font-bold text-base flex items-center justify-between gap-4">
                  <span>{item.q}</span>
                  <span className="text-2xl theme-text-muted leading-none">
                    <span className="group-open:hidden">+</span>
                  </span>
                </summary>
                <p className="mt-3 text-sm theme-text-muted leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* Footer CTA */}
        <Section className="py-12">
          <div className="bg-gradient-to-br from-[#0B1A2C] to-[#1F3A5F] text-white rounded-3xl p-8 text-center">
            <h3 className="font-display font-black text-3xl mb-2">Ready to start?</h3>
            <p className="text-white/80 mb-6 max-w-md mx-auto">
              K{monthly.priceZMW}, paid once, 30 days of unlimited access. No card needed.
            </p>
            <Button variant="primary" size="lg" className="bg-[#F4E4BC] !text-[#0B1A2C] hover:bg-white" onClick={() => handleStart(pack.monthlyPlanId)}>
              Get the {pack.title} → K{monthly.priceZMW}
            </Button>
          </div>
        </Section>

        {/* Footer */}
        <footer className="border-t theme-border mt-6">
          <Section className="py-6 text-xs theme-text-muted flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <span>© 2026 ZedExams · Made in Lusaka 🇿🇲</span>
            <span className="flex items-center gap-4">
              <Link to="/terms" className="hover:theme-text">Terms</Link>
              <Link to="/privacy" className="hover:theme-text">Privacy</Link>
              <Link to="/pricing" className="hover:theme-text">All plans</Link>
            </span>
          </Section>
        </footer>
      </div>

      {showUpgrade && (
        <Suspense fallback={null}>
          <UpgradeModal
            portal="learner"
            planIds={[pack.monthlyPlanId, pack.termlyPlanId].filter(Boolean)}
            defaultPlanId={showUpgrade}
            onClose={() => setShowUpgrade(false)}
          />
        </Suspense>
      )}
    </>
  )
}
