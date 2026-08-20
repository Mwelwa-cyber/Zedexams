import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../../../shared/components/Logo'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Button from '../../../shared/components/Button'
import Card from '../../../shared/components/Card'
import Icon from '../../../shared/components/Icon'
import ContactDialog from '../components/ContactDialog'
import LiveStats from '../components/LiveStats'
import NewsletterSignup from '../components/NewsletterSignup'
import { listFeaturedPapersWithQuiz } from '../../../utils/pastPapers'
import { isNativePlatform } from '../../../utils/runtime'
import { SUBJECTS } from '../../../config/curriculum'
// Prices come from the same source-of-truth configs the /pricing page uses,
// so the homepage can never drift from the real numbers.
import { PLAN_PRICES } from '../../../config/teacherPlanPricing'
import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import {
  AcademicCapIcon,
  Sparkles,
  TrophyIcon,
  ShieldCheck,
  Download,
  BookOpen,
  BookMarked,
  FileText,
  ClipboardCheckList,
  Printer,
  Clock,
  TrendingUp,
  ComputerDesktop,
  GraduationCap,
  Users,
  CheckCircleIcon,
  Send,
  Mail,
  ChevronRight,
} from '../../../shared/components/icons'

// Public contact channels surfaced in the footer. WhatsApp opens the chat
// directly; the contact form opens an in-app modal that writes to the
// `contactMessages` Firestore collection.
const CONTACT_WHATSAPP_NUMBER = '+260 977 740 465'
const CONTACT_WHATSAPP_HREF = 'https://wa.me/260977740465'
const CONTACT_EMAIL = 'support@zedexams.com'
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`

// ── Prices resolved once from config (single source of truth) ──────────────
const LEARNER_WEEKLY = PLANS.weekly.priceZMW          // 15
const LEARNER_MONTHLY = PLANS.monthly.priceZMW        // 50
const GRADE7_MONTHLY = PLANS.grade7_monthly.priceZMW  // 75
const GRADE7_TERMLY = PLANS.grade7_termly.priceZMW    // 200
const PRO_MONTHLY = PLAN_PRICES.pro.monthly           // 59
const MAX_MONTHLY = PLAN_PRICES.max.monthly           // 149
// Binding yearly Pro price = 10x monthly ("two months free"), same framing
// as the /pricing plan cards.
const PRO_YEARLY = PRO_MONTHLY * 10                   // 590

// Small inline brand-mark SVG for WhatsApp — heroicons doesn't ship one.
function WhatsAppIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M19.05 4.91A10.05 10.05 0 0 0 12.04 2C6.5 2 2 6.5 2 12.04c0 1.77.46 3.5 1.34 5.02L2 22l5.07-1.32a10.05 10.05 0 0 0 4.97 1.27h.01c5.54 0 10.04-4.5 10.04-10.04a9.96 9.96 0 0 0-3.04-7.0ZM12.05 20.27h-.01a8.34 8.34 0 0 1-4.25-1.16l-.3-.18-3.01.79.81-2.94-.2-.31a8.32 8.32 0 0 1-1.27-4.43c0-4.6 3.74-8.34 8.35-8.34 2.23 0 4.32.87 5.9 2.45a8.27 8.27 0 0 1 2.44 5.9c0 4.61-3.75 8.35-8.34 8.35Zm4.58-6.24c-.25-.13-1.49-.74-1.72-.82-.23-.08-.4-.13-.57.13-.17.25-.65.82-.79.99-.15.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.25-.74-.66-1.24-1.47-1.39-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.57-1.37-.78-1.87-.21-.49-.42-.43-.57-.44h-.49c-.17 0-.43.06-.65.31-.22.25-.86.84-.86 2.06 0 1.21.88 2.38 1 2.55.13.17 1.74 2.66 4.22 3.73.59.25 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.49-.61 1.7-1.2.21-.59.21-1.09.15-1.2-.06-.11-.23-.17-.48-.3Z" />
    </svg>
  )
}

// Hero highlight chips (under the CTAs). The grade/curriculum split is
// deliberate and truthful: the learner app is CBC Grade 7 TODAY — Grades 4–6
// are built but not open, so claiming them here would sell a learner an empty
// app — while the teacher generation tools span the wider CBC (2023) + OBC
// (2013) frameworks. When a grade opens (`LEARNER_GRADES` in
// src/config/curriculum.js), this copy moves with it.
const HERO_CHIPS = [
  { icon: GraduationCap, label: 'Grade 7', sub: 'for learners · more grades soon' },
  { icon: BookOpen, label: 'CBC + OBC', sub: 'Nursery–Form 4 · teacher tools' },
  { icon: Sparkles, label: 'AI powered', sub: 'drafts in seconds' },
  { icon: ComputerDesktop, label: 'Any device', sub: 'phone, tablet, laptop' },
  { icon: ShieldCheck, label: 'Secure & private', sub: 'learner data never sold' },
]

// Teacher generation studios, grouped for the "what you can make" grid.
// Counts are the real AI-studio totals per bucket (5 / 5 / 7 / 1 = 18),
// verified against the teacher routes in App.jsx + TeacherDashboard groups.
const STUDIO_BUCKETS = [
  {
    icon: BookOpen,
    title: 'Planning',
    count: '5 studios',
    body: 'Lesson plans, schemes of work, weekly forecast, class timetables and record of work.',
  },
  {
    icon: FileText,
    title: 'Teaching resources',
    count: '4 studios',
    body: 'Notes, flashcards, homework and the visual studio for diagrams.',
  },
  {
    icon: ClipboardCheckList,
    title: 'Assessment',
    count: '6 studios',
    body: 'Tests, exam papers, mark schedules and SBA task, tracker and planner.',
  },
  {
    icon: BookMarked,
    title: 'Curriculum',
    count: '1 studio',
    body: 'Syllabus studio and coverage tools across CBC (2023) and OBC (2013).',
  },
]

const AUDIENCES = [
  {
    icon: AcademicCapIcon,
    title: 'Learners',
    tag: 'Grade 7',
    bullets: [
      'Daily CBC exams and curriculum-mapped quizzes',
      'Lessons, games, and study notes',
      'Badges, streaks, and friendly leaderboards',
      'Personalise it — themes, language and data-saver, right on your dashboard',
    ],
    cta: { label: 'Start learning free', to: '/register' },
  },
  {
    icon: Users,
    title: 'Teachers',
    tag: 'AI co-pilot',
    bullets: [
      'Generate lesson plans, homework, flashcards, and schemes of work',
      'Build assessments and exam papers aligned to CBC or OBC',
      'Export everything to DOCX or PDF — print and go',
    ],
    cta: { label: 'Start free', to: '/register' },
  },
]

const PRICING = [
  {
    title: 'Learners',
    price: `Free demo, then K${LEARNER_WEEKLY}/wk`,
    priceNative: 'Free demo',
    note: `or K${LEARNER_MONTHLY}/month for full access`,
    noteNative: 'Upgrade anytime — priced in Google Play',
    bullets: ['Daily exams & the full quiz library', 'All games & leaderboards', 'Every lesson and study note'],
    upgradeIncludes: `Full access unlocks every daily exam, the whole quiz & lesson library and all games. The Grade 7 ECZ exam pack is also available at K${GRADE7_MONTHLY}/month or K${GRADE7_TERMLY} a term.`,
    cta: { label: 'Create account', to: '/register' },
    primary: true,
  },
  {
    title: 'Teachers',
    price: `Free, then K${PRO_MONTHLY}/mo`,
    priceNative: 'Free to start',
    note: `Pro · 10 generations a day · or K${PRO_YEARLY}/yr`,
    noteNative: 'Pro · 10 generations a day',
    bullets: ['AI lesson plans, homework & notes', 'Assessments & exam papers', 'DOCX / PDF export'],
    cta: { label: 'See teacher plans', to: '/pricing' },
    primary: false,
  },
]

const FAQ = [
  {
    q: 'What is included in the free demo?',
    a: "A taste of daily exams, selected quizzes and lessons, and a few curriculum games. Sign up and you'll see exactly what's available for your grade.",
  },
  {
    q: 'What does upgrading unlock?',
    a: 'Full access to all daily exams, every quiz and lesson, and all curriculum games and leaderboards.',
  },
  {
    q: 'How much does it cost?',
    a: `Learners start with a free demo, then K${LEARNER_WEEKLY}/week or K${LEARNER_MONTHLY}/month for full access to every daily exam, quiz, lesson and game (the Grade 7 ECZ exam pack is K${GRADE7_MONTHLY}/month or K${GRADE7_TERMLY} a term). Teachers get the AI toolset free — 2 generations a day — with Pro at K${PRO_MONTHLY}/month for 10 a day and Max at K${MAX_MONTHLY}/month for heavy users. Pay with Airtel Money, MTN MoMo or card right inside the app — your account unlocks instantly.`,
  },
  {
    q: 'Is ZedExams safe for children?',
    a: 'Yes. Accounts use email and password, idle sessions sign out automatically, and we never sell or share learner data. See our Privacy Policy for the full detail.',
  },
  {
    q: 'Do teachers get verified?',
    a: "Yes. Teachers submit their school name and proof of teaching status before they can publish content to learners. Until they're verified, their account works in private mode.",
  },
  {
    q: 'Does it work on slow internet or basic phones?',
    a: 'Yes. Pages are light, there is a data-saver mode in your dashboard settings, and most things still work on slower 3G. We test on common Zambian network conditions.',
  },
  {
    q: 'Can I print lesson plans and assessments?',
    a: 'Every teacher generation downloads as DOCX (editable in Word) or PDF (ready to print). No copying-and-pasting from a chat window.',
  },
  {
    q: 'What grades are supported?',
    a: "Learners study Grades 4 to 7 with full CBC alignment. Teachers can generate material far wider — Nursery through Form 4 on the 2023 CBC, plus the 2013 Outcome-Based Curriculum for Grades 1 to 12. More learner grades are on the roadmap — WhatsApp us if you'd like to be notified when your grade is ready.",
  },
]

// Android (Google Play) build: the pricing answer must not quote ZMW web
// prices or name mobile-money/card payment methods (Play policy — in-app
// digital purchases go through Google Play Billing only).
const FAQ_NATIVE = FAQ.map((item) =>
  item.q === 'How much does it cost?'
    ? {
        ...item,
        a: 'Learners start with a free demo, and teachers get the AI toolset free with daily limits. Upgrade anytime from inside the app — subscriptions are billed securely through Google Play, with prices shown before you confirm, and your account unlocks instantly.',
      }
    : item
)

// Compact trust strip (dark band) — replaces the old trust-card section.
const TRUST_BAR = [
  { icon: ShieldCheck, label: 'Trusted by teachers across Zambia' },
  { icon: BookOpen, label: 'Curriculum-aligned · CBC & OBC' },
  { icon: Clock, label: 'Save hours every week' },
  { icon: TrendingUp, label: 'Better learning, better results' },
  { icon: Sparkles, label: 'Made in Zambia, for Zambia' },
]

function Section({ children, className = '', id }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  )
}

// Featured past-paper-quiz section — fetches a handful of published
// papers that have an attached quiz and surfaces them as CTA cards
// linked into the public quiz runner. Silent-fail empty when none are
// available yet (early-launch state).
function PastPaperPreviewSection() {
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    // Subject-integrity-filtered: only surface featured cards whose linked quiz
    // genuinely matches the paper's subject (fail closed against the
    // cross-subject featured-quiz defect).
    listFeaturedPapersWithQuiz({ count: 4 })
      .then((rows) => { if (!cancelled) setPapers(rows) })
      .catch((err) => console.warn('[Marketing] past-paper preview load failed', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  if (!loading && papers.length === 0) return null
  return (
    <Section className="py-16 sm:py-20">
      <div className="text-center mb-10">
        <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
          Try before you sign up
        </p>
        <h2 className="font-display font-black text-3xl sm:text-4xl mb-3">
          Free past-paper quizzes.
        </h2>
        <p className="theme-text-muted text-lg max-w-2xl mx-auto">
          Pick a real Grade 7 ECZ past paper and take the quiz right here — no account
          needed. Get instant feedback on the first 30 questions.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {papers.map((p) => {
          const subjectMeta = SUBJECTS.find((s) => s.id === p.subject)
          return (
            <Card key={p.id} variant="elevated" size="md" className="flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl theme-bg-subtle flex items-center justify-center text-xl">
                  <span aria-hidden="true">{subjectMeta?.icon || '📄'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="theme-text font-black text-sm leading-snug">{p.title}</p>
                  <p className="theme-text-muted text-xs mt-1">
                    Grade {p.grade} · {p.year} · {subjectMeta?.shortLabel || subjectMeta?.label || p.subject}
                  </p>
                </div>
              </div>
              <Button
                as={Link}
                to={`/papers/${p.id}/quiz`}
                variant="primary"
                size="sm"
                fullWidth
                className="mt-auto"
              >
                Take the quiz
              </Button>
            </Card>
          )
        })}
      </div>
      <div className="mt-6 text-center">
        <Link to="/papers" className="theme-accent-text font-black text-sm hover:underline">
          Browse the full archive →
        </Link>
      </div>
    </Section>
  )
}

// Mock learner Daily Exam preview - grounded product proof under the hero.
function DailyExamPreview() {
  return (
    <Card variant="elevated" size="lg" className="marketing-exam-preview">
      <div className="marketing-exam-preview-header">
        <div>
          <p className="text-eyebrow">Learner dashboard preview</p>
          <h2 className="font-display font-black text-2xl sm:text-3xl mt-1">
            Today's Grade 5 exam plan
          </h2>
        </div>
        <span className="marketing-exam-pill">
          <Icon as={Sparkles} size="xs" />
          3-day streak
        </span>
      </div>

      <div className="marketing-proof-grid">
        <div className="space-y-3">
          {[
            { subject: 'English',             score: '9 / 10',  tone: 'green' },
            { subject: 'Integrated Science',  score: '7 / 10',  tone: 'orange' },
            { subject: 'Mathematics',         score: '8 / 10',  tone: 'blue' },
            { subject: 'Social Studies',      score: '10 / 10', tone: 'green' },
          ].map((row) => (
            <div key={row.subject} className={`marketing-score-row tone-${row.tone}`}>
              <span>{row.subject}</span>
              <strong>{row.score}</strong>
            </div>
          ))}
        </div>

        <div className="marketing-rank-panel">
          <div className="marketing-rank-icon" aria-hidden="true">
            <Icon as={TrophyIcon} size="lg" />
          </div>
          <p className="text-eyebrow">Weekly position</p>
          <strong>#4</strong>
          <span>in Grade 5 this week</span>
          <div className="marketing-rank-bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </Card>
  )
}

// Mock teacher lesson-plan output — styled like a real printed A4 sheet to
// prove the CBC lesson plan generator drafts a full, structured plan in seconds.
function LessonPlanPreview() {
  return (
    <Card variant="elevated" size="lg" className="overflow-hidden">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
          >
            <Icon as={BookOpen} size="md" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wider theme-text-muted">
              Generated in 7 seconds
            </p>
            <h3 className="font-display font-black text-lg leading-tight">
              Grade 6 Science · The Water Cycle lesson plan
            </h3>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider theme-accent-text">
          <Icon as={Sparkles} size="xs" /> AI-drafted
        </span>
      </div>

      {/* A real printed A4 sheet — white page, ruled red margin, print serif type */}
      <div className="mk-sheet relative overflow-hidden rounded-sm bg-white text-slate-800 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_8px_24px_-6px_rgba(0,0,0,0.25)] ring-1 ring-slate-200">
        {/* punched binder holes down the left edge */}
        <div className="pointer-events-none absolute left-2 top-0 hidden h-full flex-col justify-center gap-8 sm:flex">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200 ring-1 ring-inset ring-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200 ring-1 ring-inset ring-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200 ring-1 ring-inset ring-slate-300" />
        </div>
        {/* red ruled margin line */}
        <div className="pointer-events-none absolute inset-y-0 left-8 hidden w-px bg-red-300/70 sm:block" />

        <div className="px-6 py-6 font-serif text-[13px] leading-relaxed sm:pl-12 sm:pr-8">
          {/* printed letterhead */}
          <div className="border-b-2 border-double border-slate-400 pb-3 text-center">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">
              Lesson Plan
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-widest text-slate-500">
              Republic of Zambia · CBC Syllabus
            </p>
          </div>

          {/* form-style meta grid */}
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
            <div className="flex gap-1.5">
              <dt className="font-semibold text-slate-500">Grade:</dt>
              <dd className="text-slate-800">6</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-semibold text-slate-500">Subject:</dt>
              <dd className="text-slate-800">Science</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-semibold text-slate-500">Topic:</dt>
              <dd className="text-slate-800">The Water Cycle</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-semibold text-slate-500">Duration:</dt>
              <dd className="text-slate-800">80 min</dd>
            </div>
          </dl>

          <div className="mt-4">
            <p className="font-bold uppercase tracking-wide text-slate-900">Learning outcomes</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
              <li>Describe how water moves through evaporation, condensation and precipitation.</li>
              <li>Relate the water cycle to rainfall and rivers in Zambia.</li>
            </ul>
          </div>

          <div className="mt-4">
            <p className="font-bold uppercase tracking-wide text-slate-900">Lesson development</p>
            <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-slate-700">
              <li>
                <span className="font-semibold text-slate-900">Introduction (10 min):</span> ask where
                the water in the Zambezi comes from to surface prior ideas.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Development (45 min):</span> demonstrate
                evaporation with a kettle, then map each stage of the cycle on the board.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Conclusion (15 min):</span> learners
                draw and label their own water cycle in their books.
              </li>
            </ol>
          </div>

          {/* slate-500, not slate-400: this sits on the white A4 mock, where
              slate-400 is 2.56:1 — below AA in every theme, not just the dark
              one. slate-500 clears 4.76:1 and still reads as a footnote. */}
          <p className="mt-4 border-t border-dashed border-slate-300 pt-2 text-[11px] italic text-slate-500">
            …materials, assessment and homework continue on the printable page
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--accent-bg)] theme-accent-text px-3 py-1 text-xs font-black">
          <Icon as={Download} size="xs" />
          DOCX
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--accent-bg)] theme-accent-text px-3 py-1 text-xs font-black">
          <Icon as={Download} size="xs" />
          PDF
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full theme-card border theme-border px-3 py-1 text-xs font-black theme-text-muted">
          Editable in Word
        </span>
      </div>
    </Card>
  )
}

export default function Marketing() {
  const [contactOpen, setContactOpen] = useState(false)
  const [contactSource, setContactSource] = useState('marketing-page')
  function openContact(source = 'marketing-page') {
    setContactSource(source)
    setContactOpen(true)
  }
  const native = isNativePlatform()
  return (
    <div className="marketing-page min-h-screen theme-bg theme-text font-body">
      <SeoHelmet
        title="Zambian CBC exam prep that fits the classroom"
        description="Daily CBC exams, quizzes, lessons, games and AI study help for Grade 7 learners. Printable lesson tools for Zambian teachers, all in one place."
        path="/"
      />
      {/* Top nav */}
      <header className="safe-top sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
        <Section className="flex items-center justify-between py-3">
          <Link to="/" aria-label="ZedExams home" className="flex items-center">
            <Logo size="sm" />
          </Link>
          <nav className="flex min-w-0 items-center gap-1 sm:gap-3">
            <Button as={Link} to="/login" variant="ghost" size="sm" className="shrink-0">
              Sign in
            </Button>
            <Button as={Link} to="/register" variant="primary" size="sm" className="shrink-0">
              Get started
            </Button>
          </nav>
        </Section>
      </header>

      {/* Hero — full-bleed illustration, text overlaid on the left */}
      <section className="marketing-hero relative overflow-hidden">
        {/* Desktop: illustration bleeds to the right edge, blended into the band */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] hidden w-[64%] lg:block" aria-hidden="true">
          <img
            src="/images/characters/zed-hero-team.webp"
            alt=""
            className="h-full w-full object-cover object-center"
            width="1536"
            height="1024"
            fetchPriority="high"
            loading="eager"
            decoding="async"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, #0F1B2D 0%, rgba(15,27,45,0.92) 16%, rgba(15,27,45,0.45) 38%, rgba(15,27,45,0) 60%)',
            }}
          />
        </div>
        <Section className="relative z-10 pt-14 pb-16 sm:pt-20 sm:pb-24 lg:pt-28 lg:pb-32">
          <div className="lg:max-w-[46%]">
            <div className="marketing-kicker">
              <span aria-hidden="true" />
              Built in Zambia, for the Zambian CBC
            </div>
            <h1
              className="marketing-hero-title"
              style={{ maxWidth: '15ch', fontSize: 'clamp(2.5rem, 4.8vw, 4.25rem)' }}
            >
              The AI partner for{' '}
              <span style={{ color: '#66BB6A' }}>Teachers</span>{' '}
              &amp;{' '}
              <span style={{ color: '#F9A825' }}>Learners</span>
            </h1>
            <p className="marketing-hero-copy">
              AI lesson plans, homework, quizzes, exams and notes for teachers — plus daily CBC
              exams, quizzes and study help for Grade 7 learners, with Grades 4–6 coming next.
              All aligned to the CBC (2023) and OBC (2013) curricula.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button as={Link} to="/register" variant="primary" size="lg">
                Get started free
              </Button>
              <Button as="a" href="#what-you-can-make" variant="secondary" size="lg" trailingIcon={<Icon as={ChevronRight} size="sm" />}>
                See how it works
              </Button>
            </div>
            <p className="mt-3 text-sm text-white/60">No card needed to start.</p>
            <div className="mt-8 flex flex-wrap gap-2.5" aria-label="ZedExams highlights">
              {HERO_CHIPS.map(({ icon, label, sub }) => (
                <div
                  key={label}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur"
                >
                  <Icon as={icon} size="sm" className="text-[#F9A825]" />
                  <span className="text-sm font-black text-white">{label}</span>
                  <span className="hidden text-xs text-white/60 sm:inline">{sub}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile/tablet: stacked illustration under the text */}
          <div className="mt-10 lg:hidden">
            <img
              src="/images/characters/zed-hero-team.webp"
              alt="A ZedExams teacher and a Grade 7 learner studying together with the Zed AI assistant"
              className="w-full rounded-3xl shadow-elev-lg ring-1 ring-white/15"
              width="1536"
              height="1024"
              fetchPriority="high"
              loading="eager"
              decoding="async"
            />
          </div>
        </Section>
      </section>

      <Section className="relative z-10 -mt-8 pb-8 sm:-mt-10 sm:pb-10">
        <DailyExamPreview />
      </Section>

      {/* What you can make — the teacher studio grid */}
      <Section id="what-you-can-make" className="py-16 sm:py-20">
        <div className="text-center mb-12">
          <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
            For teachers · 18 AI studios
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3">
            Every studio you need, in one login.
          </h2>
          <p className="theme-text-muted text-lg max-w-2xl mx-auto">
            Give ZedExams the grade, subject and topic. It drafts classroom-ready material in
            seconds — aligned to the CBC (2023) or the 2013 Outcome-Based Curriculum.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STUDIO_BUCKETS.map(({ icon, title, count, body }) => (
            <Card key={title} variant="elevated" size="lg" className="flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
                >
                  <Icon as={icon} size="lg" />
                </div>
                <span className="text-xs font-black uppercase tracking-wider theme-accent-text">
                  {count}
                </span>
              </div>
              <h3 className="font-display font-black text-xl mb-2">{title}</h3>
              <p className="theme-text-muted text-sm leading-relaxed">{body}</p>
            </Card>
          ))}
        </div>

        {/* AI creates. You edit. — export proof strip */}
        <Card variant="flat" size="md" className="mt-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
                style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
              >
                <Icon as={Sparkles} size="md" />
              </div>
              <div>
                <p className="font-display font-black text-lg leading-tight">AI creates. You edit.</p>
                <p className="theme-text-muted text-sm">
                  Download to Word or PDF, print, assign to a class and track progress.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--accent-bg)] theme-accent-text px-3 py-1 text-xs font-black">
                <Icon as={Download} size="xs" /> Word
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--accent-bg)] theme-accent-text px-3 py-1 text-xs font-black">
                <Icon as={Download} size="xs" /> PDF
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full theme-card border theme-border px-3 py-1 text-xs font-black theme-text-muted">
                <Icon as={Printer} size="xs" /> Print
              </span>
            </div>
          </div>
        </Card>

        <div className="mt-8 text-center">
          <Button as={Link} to="/teachers" variant="primary" size="lg">
            Explore the teacher tools
          </Button>
        </div>
      </Section>

      {/* Trust bar */}
      <Section className="py-8">
        <div
          className="rounded-3xl px-6 py-6 sm:px-10"
          style={{ background: 'linear-gradient(135deg, #0F1B2D 0%, #123629 58%, #1C4D37 100%)' }}
        >
          <ul className="grid gap-y-4 gap-x-6 sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-white/15">
            {TRUST_BAR.map(({ icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-white lg:justify-center lg:px-3 lg:text-center">
                <Icon as={icon} size="sm" className="shrink-0 text-[#F9A825]" />
                <span className="text-sm font-bold leading-snug">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Past-paper quizzes — try-before-signup hook. Renders nothing
          until at least one published paper has an attached quiz. */}
      <PastPaperPreviewSection />

      {/* Audience tracks — two equal primary tracks */}
      <Section className="py-16 sm:py-20">
        <div className="text-center mb-12">
          <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
            One platform, two strong tracks
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3">
            Pick the track that fits you.
          </h2>
          <p className="theme-text-muted text-lg max-w-2xl mx-auto">
            Whether you're studying for the next exam or planning tomorrow's lesson, ZedExams has
            tools made for you.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {AUDIENCES.map(({ icon, title, tag, bullets, cta }) => (
            <Card key={title} variant="elevated" size="lg" className="flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
                >
                  <Icon as={icon} size="lg" />
                </div>
                <span className="text-xs font-black uppercase tracking-wider theme-text-muted">
                  {tag}
                </span>
              </div>
              <h3 className="font-display font-black text-2xl mb-3">{title}</h3>
              <ul className="space-y-2.5 mb-6 theme-text-muted">
                {bullets.map((b) => (
                  <li key={b} className="flex gap-2.5">
                    <Icon
                      as={CheckCircleIcon}
                      size="sm"
                      className="mt-0.5 shrink-0 text-[color:var(--accent)]"
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Button as={Link} to={cta.to} variant="primary" fullWidth>
                  {cta.label}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* Teacher proof — realistic lesson-plan output preview */}
      <Section className="py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 items-center">
          <div className="lg:col-span-5">
            <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
              For teachers
            </p>
            <h2 className="font-display font-black text-3xl sm:text-4xl mb-4">
              Generate a lesson plan in seconds.
            </h2>
            <p className="theme-text-muted text-lg mb-6">
              Give ZedExams the grade, subject, and topic. Get a structured, CBC-aligned lesson
              plan — outcomes, lesson development, and assessment — ready to teach or edit in Word.
            </p>
            <ul className="space-y-2.5 theme-text-muted mb-7">
              {[
                'Clear learning outcomes mapped to the official CBC syllabus',
                'Timed introduction, development and conclusion you can teach straight from',
                'Built-in assessment, materials list and homework — no extra prep',
              ].map((b) => (
                <li key={b} className="flex gap-2.5">
                  <Icon as={CheckCircleIcon} size="sm" className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button as={Link} to="/register" variant="primary" size="lg">
                Start free
              </Button>
              <Button as={Link} to="/teachers" variant="secondary" size="lg">
                See real samples
              </Button>
            </div>
          </div>
          <div className="lg:col-span-7">
            <LessonPlanPreview />
          </div>
        </div>
      </Section>

      {/* Pricing / free clarity */}
      <Section className="py-16 sm:py-20">
        <div className="text-center mb-12">
          <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
            Pricing
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3">
            Free demo. Clear from day one.
          </h2>
          <p className="theme-text-muted text-lg max-w-2xl mx-auto">
            Learners can start with a free demo and selected practice. Teachers get the AI tools
            free to start, then Pro or Max when they need more.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 max-w-3xl mx-auto">
          {PRICING.map((tier) => (
            <Card
              key={tier.title}
              variant={tier.primary ? 'elevated' : 'flat'}
              size="lg"
              className={`flex flex-col ${tier.primary ? 'ring-2 ring-[color:var(--accent)]' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-black text-xl">{tier.title}</h3>
                {tier.primary && (
                  <span className="text-[10px] font-black uppercase tracking-wider theme-accent-text">
                    Most popular
                  </span>
                )}
              </div>
              <p className="font-display font-black text-3xl mb-1">
                {/* Android: no ZMW price literals — Google Play prices at checkout. */}
                {native ? tier.priceNative : tier.price}
              </p>
              <p className="theme-text-muted text-sm mb-5">{native ? tier.noteNative : tier.note}</p>
              <ul className="space-y-2.5 mb-4 theme-text-muted text-sm">
                {tier.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5">
                    <Icon as={CheckCircleIcon} size="sm" className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              {tier.upgradeIncludes && !native && (
                <p className="mb-5 text-xs leading-relaxed theme-text-muted italic border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
                  {tier.upgradeIncludes}
                </p>
              )}
              <div className="mt-auto">
                <Button as={Link} to={tier.cta.to} variant={tier.primary ? 'primary' : 'secondary'} fullWidth>
                  {tier.cta.label}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* Audit C4 — live activity numbers from publicStats/global. Self-
          hides when the cron hasn't populated the doc yet, so an empty
          dev environment doesn't render a row of zeros. */}
      <LiveStats />

      {/* FAQ — answers the questions visitors ask before signing up */}
      <Section className="py-16 sm:py-20">
        <div className="text-center mb-12">
          <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
            Common questions
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3">
            Frequently asked
          </h2>
          <p className="theme-text-muted text-lg max-w-2xl mx-auto">
            Don't see your question? <button
              type="button"
              onClick={() => openContact('faq')}
              className="underline underline-offset-4 theme-accent-text hover:opacity-80"
            >Send it through the contact form</button> and we'll get back to you.
          </p>
        </div>
        <div className="max-w-3xl mx-auto space-y-3">
          {(native ? FAQ_NATIVE : FAQ).map(({ q, a }) => (
            <details
              key={q}
              className="group theme-card border theme-border rounded-2xl px-5 py-4 transition-all open:shadow-elev-md"
            >
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-display font-black text-base sm:text-lg theme-text">
                <span>{q}</span>
                <span
                  className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full theme-bg-subtle theme-text-muted transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 theme-text-muted text-sm sm:text-base leading-relaxed">
                {a}
              </p>
            </details>
          ))}
        </div>
      </Section>

      {/* Final CTA banner — high-contrast white pill on hero gradient */}
      <Section className="pb-20">
        <Card variant="hero" size="lg" className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 text-white px-3 py-1 text-xs font-black uppercase tracking-wider mb-4">
            <Icon as={Sparkles} size="xs" /> Start in under a minute
          </div>
          <h2 className="font-display font-black text-3xl sm:text-4xl text-white mb-3">
            Ready to start studying smarter?
          </h2>
          <p className="text-white/90 text-lg max-w-xl mx-auto mb-7">
            Create a free ZedExams account and jump straight into today's daily exam.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-base font-black text-zambia-black shadow-elev-md hover:-translate-y-px hover:shadow-elev-lg active:scale-[0.97] transition-all"
            >
              Create a free account
              <Icon as={ChevronRight} size="sm" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-white/70 px-6 py-3.5 text-base font-black text-white hover:bg-white/10 active:scale-[0.97] transition-all"
            >
              Sign in
            </Link>
          </div>
        </Card>
      </Section>

      {/* Footer with visible contact */}
      <footer className="border-t theme-border">
        <Section className="py-10">
          {/* Newsletter signup — audit C6, list builder. White card on the
              cream footer so it reads as a sharp, deliberate surface rather
              than fading into the background band. */}
          <div className="mb-10">
            <div className="theme-card border theme-border rounded-2xl shadow-elev-sm p-5 sm:p-6">
              <NewsletterSignup source="marketing-footer" />
            </div>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Logo size="sm" />
              <p className="mt-3 text-sm theme-text-muted max-w-xs">
                CBC exam prep and AI teacher tools, built in Zambia for Zambian Grade 7
                classrooms.
              </p>
            </div>
            <div>
              <p className="font-display font-black text-sm uppercase tracking-wider theme-text mb-3">
                Get started
              </p>
              <ul className="space-y-2 text-sm theme-text-muted">
                <li><Link to="/register" className="hover:theme-text">Create a free account</Link></li>
                <li><Link to="/login" className="hover:theme-text">Sign in</Link></li>
                <li><Link to="/papers" className="hover:theme-text">ECZ past papers</Link></li>
                <li><Link to="/games" className="hover:theme-text">CBC games</Link></li>
                <li><Link to="/blog" className="hover:theme-text">Revision blog</Link></li>
                <li><Link to="/company" className="hover:theme-text">Meet our AI team</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-display font-black text-sm uppercase tracking-wider theme-text mb-3">
                Legal
              </p>
              <ul className="space-y-2 text-sm theme-text-muted">
                <li><Link to="/privacy" className="hover:theme-text">Privacy Policy</Link></li>
                <li><Link to="/terms" className="hover:theme-text">Terms &amp; Conditions</Link></li>
                <li><Link to="/preferences" className="hover:theme-text">Privacy preferences</Link></li>
                <li><Link to="/status" className="hover:theme-text">Service Status</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-display font-black text-sm uppercase tracking-wider theme-text mb-3">
                Talk to us
              </p>
              <ul className="space-y-2 text-sm theme-text-muted">
                <li>
                  <a
                    href={CONTACT_WHATSAPP_HREF}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 hover:theme-text"
                  >
                    <WhatsAppIcon size={16} />
                    WhatsApp {CONTACT_WHATSAPP_NUMBER}
                  </a>
                </li>
                <li>
                  <a
                    href={CONTACT_EMAIL_HREF}
                    className="inline-flex items-center gap-2 hover:theme-text"
                  >
                    <Icon as={Mail} size="sm" />
                    {CONTACT_EMAIL}
                  </a>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => openContact('footer')}
                    className="inline-flex items-center gap-2 hover:theme-text"
                  >
                    <Icon as={Send} size="sm" />
                    Contact form
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t theme-border text-xs theme-text-help flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} ZedExams. All rights reserved.</span>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link to="/privacy"     className="hover:theme-text">Privacy</Link>
              <Link to="/terms"       className="hover:theme-text">Terms</Link>
              <Link to="/preferences" className="hover:theme-text">Preferences</Link>
              <Link to="/status"      className="hover:theme-text">Status</Link>
              <span aria-hidden="true">·</span>
              <span>Made in Zambia.</span>
            </nav>
          </div>
        </Section>
      </footer>

      <ContactDialog
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        source={contactSource}
      />
    </div>
  )
}
