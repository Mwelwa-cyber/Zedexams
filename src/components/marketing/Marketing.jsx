import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../ui/Logo'
import SeoHelmet from '../seo/SeoHelmet'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Icon from '../ui/Icon'
import ContactDialog from './ContactDialog'
import LiveStats from './LiveStats'
import NewsletterSignup from './NewsletterSignup'
import { listPapersWithQuiz } from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import {
  AcademicCapIcon,
  Sparkles,
  TrophyIcon,
  ShieldCheck,
  Download,
  BookOpen,
  Users,
  CheckCircleIcon,
  Lock,
  FileText,
  Send,
  Mail,
  ChevronRight,
  Clock,
  Target,
  ListChecks,
} from '../ui/icons'

// Public contact channels surfaced on the schools callout, pricing tier,
// and footer. WhatsApp opens the chat directly; the contact form opens
// an in-app modal that writes to the `contactMessages` Firestore collection.
const CONTACT_WHATSAPP_NUMBER = '+260 977 740 465'
const CONTACT_WHATSAPP_HREF = 'https://wa.me/260977740465'
const CONTACT_EMAIL = 'support@zedexams.com'
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`

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

const AUDIENCES = [
  {
    icon: AcademicCapIcon,
    title: 'Learners',
    tag: 'Grades 4–7',
    bullets: [
      'Daily CBC exams and curriculum-mapped quizzes',
      'Lessons, games, and Ask Zed AI study help',
      'Badges, streaks, and friendly leaderboards',
    ],
    cta: { label: 'Start learning free', to: '/register' },
  },
  {
    icon: Users,
    title: 'Teachers',
    tag: 'AI co-pilot',
    bullets: [
      'Generate lesson plans, worksheets, flashcards, and schemes of work',
      'Build rubrics aligned to the CBC syllabus in seconds',
      'Export everything to DOCX or PDF — print and go',
    ],
    cta: { label: 'Start free', to: '/register' },
  },
]

const PRICING = [
  {
    title: 'Learners',
    price: 'Free demo',
    note: 'No card needed to start',
    bullets: ['Try daily exams & quizzes', 'Play selected games', 'Upgrade for full access'],
    upgradeIncludes: 'Upgrade unlocks every daily exam, the full quiz & lesson library, all games, leaderboards, and unlimited Ask Zed.',
    cta: { label: 'Create account', to: '/register' },
    primary: true,
  },
  {
    title: 'Teachers',
    price: 'Free, then K79/mo',
    note: 'Pro · 10 generations a day',
    bullets: ['AI lesson plans', 'Worksheets & rubrics', 'DOCX / PDF export'],
    cta: { label: 'See teacher plans', to: '/pricing' },
    primary: false,
  },
  {
    title: 'Schools',
    price: 'Custom',
    note: 'Talk to us',
    bullets: ['Learner monitoring', 'Teacher verification', 'Private CBC KB'],
    cta: { label: 'Open contact form', kind: 'contact' },
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
    a: 'Full access to all daily exams, every quiz and lesson, all curriculum games and leaderboards, plus unlimited Ask Zed AI study help across subjects.',
  },
  {
    q: 'How much does it cost?',
    a: "Learners start with a free demo. The Grade 7 ECZ exam pack is K75/month (or K200 for a full term), with more grade packs on the way. Teachers get the AI toolset free — 2 generations a day — with Pro at K79/month for 10 a day and Max at K199/month for heavy users. Pay with Airtel Money or MTN MoMo, confirm on WhatsApp, and you're live within 30 minutes.",
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
    a: 'Yes. Pages are light, there is a data-saver mode in your profile, and most things still work on slower 3G. We test on common Zambian network conditions.',
  },
  {
    q: 'Can I print worksheets and lesson plans?',
    a: 'Every teacher generation downloads as DOCX (editable in Word) or PDF (ready to print). No copying-and-pasting from a chat window.',
  },
  {
    q: 'What grades are supported?',
    a: "Today: Grades 4 through 7 with full CBC alignment. Earlier and later grades are on the roadmap — WhatsApp us if you'd like to be notified when your grade is ready.",
  },
]

const TRUST = [
  {
    icon: AcademicCapIcon,
    title: 'Built in Zambia',
    body: 'Made for Zambian classrooms — not borrowed from another curriculum.',
  },
  {
    icon: BookOpen,
    title: 'CBC-aligned',
    body: 'Every exam, lesson, and generator is mapped to the official CBC syllabus.',
  },
  {
    icon: ShieldCheck,
    title: 'Verified teachers',
    body: 'Teachers are reviewed before they can publish content to learners.',
  },
  {
    icon: Lock,
    title: 'Privacy-first',
    body: 'Learner accounts are protected and never sold. Schools control their own data.',
  },
]

function Section({ children, className = '' }) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>
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
    listPapersWithQuiz({ limit: 12 })
      .then((rows) => { if (!cancelled) setPapers(rows.slice(0, 4)) })
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

function HeroStat({ value, label }) {
  return (
    <div className="marketing-hero-stat">
      <span>{value}</span>
      <p>{label}</p>
    </div>
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

// Mock teacher worksheet output — proves the "DOCX/PDF in seconds" claim.
function WorksheetPreview() {
  return (
    <Card variant="elevated" size="lg" className="overflow-hidden">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
          >
            <Icon as={FileText} size="md" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wider theme-text-muted">
              Generated in 6 seconds
            </p>
            <h3 className="font-display font-black text-lg leading-tight">
              Grade 9 Maths · Percentages &amp; Money worksheet
            </h3>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider theme-accent-text">
          <Icon as={Sparkles} size="xs" /> AI-drafted
        </span>
      </div>

      <div className="rounded-2xl border theme-border bg-[color:var(--bg-subtle)] p-5 sm:p-6 space-y-4 font-body text-sm">
        <p className="font-black theme-text">Name: ____________________   Date: __________</p>
        <ol className="list-decimal pl-5 space-y-2.5 theme-text">
          <li>
            A shop marks up a bag of mealie-meal that costs{' '}
            <span className="font-bold">K180</span> by <span className="font-bold">25%</span>.
            Find the selling price.
          </li>
          <li>
            Mwila deposits <span className="font-bold">K2 500</span> at{' '}
            <span className="font-bold">8%</span> simple interest per year. How much interest
            does she earn after 3 years?
          </li>
          <li>
            A phone costs <span className="font-bold">K3 200</span> cash, or a{' '}
            <span className="font-bold">K400</span> deposit plus 8 monthly payments of{' '}
            <span className="font-bold">K380</span>. How much more is the hire-purchase price?
          </li>
          <li>Chanda scored 45 out of 60 in a test. Express this as a percentage.</li>
          <li>
            The price of a chitenge rose from <span className="font-bold">K90</span> to{' '}
            <span className="font-bold">K117</span>. Calculate the percentage increase.
          </li>
        </ol>
        <p className="theme-text-help text-xs italic">…3 more questions on the printable page</p>
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

// Mock teacher lesson-plan output — mirrors WorksheetPreview to prove the
// CBC lesson plan generator drafts a full, structured plan in seconds.
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

      <div className="rounded-2xl border theme-border bg-[color:var(--bg-subtle)] p-5 sm:p-6 space-y-4 font-body text-sm">
        <div className="flex flex-wrap gap-3 text-xs theme-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon as={Clock} size="xs" /> 80 minutes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon as={Target} size="xs" /> 2 outcomes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon as={ListChecks} size="xs" /> Assessed
          </span>
        </div>

        <div>
          <p className="font-black theme-text mb-1">Learning outcomes</p>
          <ul className="list-disc pl-5 space-y-1 theme-text">
            <li>Describe how water moves through evaporation, condensation and precipitation.</li>
            <li>Relate the water cycle to rainfall and rivers in Zambia.</li>
          </ul>
        </div>

        <div>
          <p className="font-black theme-text mb-1">Lesson development</p>
          <ol className="list-decimal pl-5 space-y-1.5 theme-text">
            <li>
              <span className="font-bold">Introduction (10 min):</span> ask where the water in the
              Zambezi comes from to surface prior ideas.
            </li>
            <li>
              <span className="font-bold">Development (45 min):</span> demonstrate evaporation with a
              kettle, then map each stage of the cycle on the board.
            </li>
            <li>
              <span className="font-bold">Conclusion (15 min):</span> learners draw and label their
              own water cycle in their books.
            </li>
          </ol>
        </div>

        <p className="theme-text-help text-xs italic">
          …materials, assessment and homework on the printable page
        </p>
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
  return (
    <div className="marketing-page min-h-screen theme-bg theme-text font-body">
      <SeoHelmet
        title="Zambian CBC exam prep that fits the classroom"
        description="Daily CBC exams, quizzes, lessons, games and AI study help for Grade 4–7 learners. Printable lesson tools for Zambian teachers, all in one place."
        path="/"
      />
      {/* Top nav */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
        <Section className="flex items-center justify-between py-3">
          <Link to="/" aria-label="ZedExams home" className="flex items-center">
            <Logo size="sm" />
          </Link>
          <nav className="flex min-w-0 items-center gap-1 sm:gap-3">
            <Button as={Link} to="/login" variant="ghost" size="sm" className="max-[420px]:hidden">
              Sign in
            </Button>
            <Button as={Link} to="/register" variant="primary" size="sm" className="shrink-0">
              Get started
            </Button>
          </nav>
        </Section>
      </header>

      {/* Hero */}
      <section className="marketing-hero">
        <img
          src="/images/characters/zed-zara-reading.webp?v=2"
          alt=""
          className="marketing-hero-art"
          aria-hidden="true"
          width="1402"
          height="1122"
          fetchPriority="high"
          loading="eager"
          decoding="async"
        />
        <Section className="relative z-10 pt-12 pb-16 sm:pt-16 sm:pb-20 lg:pt-20 lg:pb-24">
          <div className="max-w-3xl">
            <div className="marketing-kicker">
              <span aria-hidden="true" />
              Built in Zambia, for the Zambian CBC
            </div>
            <h1 className="marketing-hero-title">
              Zambian CBC exam prep
            </h1>
            <p className="marketing-hero-copy">
              Daily exams, topic quizzes, lessons, games, and AI study help for Grade 4-7
              learners, with printable tools for teachers who need classroom-ready material.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button as={Link} to="/register" variant="primary" size="lg">
                Create a free account
              </Button>
              <Button as={Link} to="/login" variant="secondary" size="lg">
                I already have an account
              </Button>
            </div>
            <div className="marketing-hero-stats" aria-label="ZedExams highlights">
              <HeroStat value="4-7" label="Grades supported now" />
              <HeroStat value="CBC" label="Mapped to the syllabus" />
              <HeroStat value="0" label="Card needed to start" />
            </div>
          </div>
        </Section>
      </section>

      <Section className="relative z-10 -mt-8 pb-8 sm:-mt-10 sm:pb-10">
        <DailyExamPreview />
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

        {/* Schools demoted to a small inline callout */}
        <div className="mt-6">
          <Card variant="flat" size="md">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
                  style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
                >
                  <Icon as={ShieldCheck} size="md" />
                </div>
                <div>
                  <p className="font-display font-black text-lg leading-tight">
                    Running a school?
                  </p>
                  <p className="theme-text-muted text-sm">
                    We work with admins on monitoring, content approvals, and a private CBC
                    knowledge base.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  as="a"
                  href={CONTACT_WHATSAPP_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="primary"
                  size="md"
                  leadingIcon={<WhatsAppIcon size={16} />}
                >
                  WhatsApp
                </Button>
                <Button
                  type="button"
                  onClick={() => openContact('schools-callout')}
                  variant="secondary"
                  size="md"
                  trailingIcon={<Icon as={ChevronRight} size="sm" />}
                >
                  Contact form
                </Button>
                <Button
                  as="a"
                  href={CONTACT_EMAIL_HREF}
                  variant="secondary"
                  size="md"
                  leadingIcon={<Icon as={Mail} size="sm" />}
                >
                  Email
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      {/* Teacher proof — realistic worksheet output preview */}
      <Section className="py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 items-center">
          <div className="lg:col-span-5">
            <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
              For teachers
            </p>
            <h2 className="font-display font-black text-3xl sm:text-4xl mb-4">
              Generate a worksheet in seconds.
            </h2>
            <p className="theme-text-muted text-lg mb-6">
              Tell ZedExams the grade, subject, and topic. Get a CBC-aligned document drafted by
              AI, ready to edit in Word — same lesson, less prep.
            </p>
            <ul className="space-y-2.5 theme-text-muted mb-7">
              {[
                'Lesson plans, schemes of work, weekly forecasts, worksheets, term tests, flashcards and rubrics',
                'Mark schedules that rank the class and turn into per-pupil report cards',
                'Locally relevant examples (kwacha, Zambian names, local context)',
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
            <WorksheetPreview />
          </div>
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
            Schools work with us on a custom plan.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
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
              <p className="font-display font-black text-3xl mb-1">{tier.price}</p>
              <p className="theme-text-muted text-sm mb-5">{tier.note}</p>
              <ul className="space-y-2.5 mb-4 theme-text-muted text-sm">
                {tier.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5">
                    <Icon as={CheckCircleIcon} size="sm" className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              {tier.upgradeIncludes && (
                <p className="mb-5 text-xs leading-relaxed theme-text-muted italic border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
                  {tier.upgradeIncludes}
                </p>
              )}
              <div className="mt-auto">
                {tier.cta.to ? (
                  <Button as={Link} to={tier.cta.to} variant={tier.primary ? 'primary' : 'secondary'} fullWidth>
                    {tier.cta.label}
                  </Button>
                ) : tier.cta.kind === 'contact' ? (
                  <Button
                    type="button"
                    onClick={() => openContact(`pricing-${tier.title.toLowerCase()}`)}
                    variant="secondary"
                    fullWidth
                  >
                    {tier.cta.label}
                  </Button>
                ) : (
                  <Button
                    as="a"
                    href={tier.cta.href}
                    target={tier.cta.external ? '_blank' : undefined}
                    rel={tier.cta.external ? 'noopener noreferrer' : undefined}
                    variant="secondary"
                    fullWidth
                    leadingIcon={tier.cta.href === CONTACT_WHATSAPP_HREF ? <WhatsAppIcon size={16} /> : null}
                  >
                    {tier.cta.label}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* Trust section */}
      <Section className="py-16 sm:py-20">
        <div className="text-center mb-12">
          <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
            Why parents and schools choose ZedExams
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl">
            Built for trust, not for hype.
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map(({ icon, title, body }) => (
            <Card key={title} variant="flat" size="md">
              <div
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl mb-4"
                style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
              >
                <Icon as={icon} size="md" />
              </div>
              <h3 className="font-display font-black text-lg mb-1.5">{title}</h3>
              <p className="theme-text-muted text-sm leading-relaxed">{body}</p>
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
          {FAQ.map(({ q, a }) => (
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
                CBC exam prep and AI teacher tools, built in Zambia for Zambian Grade 4–7
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
                <li className="theme-text-muted">
                  <span className="inline-flex items-center gap-2">
                    <Icon as={ShieldCheck} size="sm" />
                    Schools & admins welcome
                  </span>
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
