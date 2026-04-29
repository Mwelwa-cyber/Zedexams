import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Icon from '../ui/Icon'
import ContactDialog from './ContactDialog'
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
  ChevronRight,
} from '../ui/icons'

// Public contact channels surfaced on the schools callout, pricing tier,
// and footer. WhatsApp opens the chat directly; the contact form opens
// an in-app modal that writes to the `contactMessages` Firestore collection.
const CONTACT_WHATSAPP_NUMBER = '+260 977 740 465'
const CONTACT_WHATSAPP_HREF = 'https://wa.me/260977740465'

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
    tag: 'Grades 4–6',
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
    cta: { label: 'Try teacher tools', to: '/register' },
  },
]

const PRICING = [
  {
    title: 'Learners',
    price: 'Free',
    note: 'No card needed',
    bullets: ['Daily exams', 'Quizzes & lessons', 'Games & Ask Zed'],
    cta: { label: 'Create account', to: '/register' },
    primary: true,
  },
  {
    title: 'Teachers',
    price: 'Free in beta',
    note: 'Fair-use limits',
    bullets: ['AI lesson plans', 'Worksheets & rubrics', 'DOCX / PDF export'],
    cta: { label: 'Join the beta', to: '/register' },
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

// Mock learner Daily Exam preview — sits beside the hero copy.
function DailyExamPreview() {
  return (
    <Card variant="hero" size="lg" className="relative overflow-hidden">
      <div className="flex items-center justify-between mb-6 text-white/90">
        <span className="text-sm font-black uppercase tracking-wider">Daily exam</span>
        <span className="inline-flex items-center gap-1 text-xs font-bold bg-white/15 rounded-full px-2.5 py-1">
          <Icon as={Sparkles} size="xs" />
          3-day streak
        </span>
      </div>
      <div className="space-y-3">
        {[
          { subject: 'Mathematics',    score: '8 / 10' },
          { subject: 'English',        score: '9 / 10' },
          { subject: 'Science',        score: '7 / 10' },
          { subject: 'Social Studies', score: '10 / 10' },
        ].map((row) => (
          <div
            key={row.subject}
            className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-3 text-white"
          >
            <span className="font-bold">{row.subject}</span>
            <span className="font-black tabular-nums">{row.score}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3 text-white/85 text-sm">
        <Icon as={TrophyIcon} size="sm" />
        <span>Ranked #4 in Grade 5 this week</span>
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
              Grade 5 Maths · Fractions worksheet
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
          <li>Write <span className="font-bold">3/4</span> as a decimal.</li>
          <li>
            Mukuka ate <span className="font-bold">2/8</span> of a pizza and Chola ate{' '}
            <span className="font-bold">3/8</span>. How much pizza is left?
          </li>
          <li>Compare: 5/6 ___ 4/5  (use &lt;, &gt; or =)</li>
          <li>Add: 1/3 + 1/6 = ____</li>
          <li>Bana shared 12 mangoes equally among 4 friends. What fraction did each get?</li>
        </ol>
        <p className="theme-text-muted text-xs italic">…3 more questions on the printable page</p>
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
    <div className="min-h-screen theme-bg theme-text font-body">
      {/* Top nav */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
        <Section className="flex items-center justify-between py-3">
          <Link to="/" aria-label="ZedExams home" className="flex items-center">
            <Logo size="sm" />
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Button as={Link} to="/login" variant="ghost" size="sm">
              Sign in
            </Button>
            <Button as={Link} to="/register" variant="primary" size="sm">
              Get started
            </Button>
          </nav>
        </Section>
      </header>

      {/* Hero */}
      <Section className="pt-12 pb-16 sm:pt-20 sm:pb-24">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border theme-border theme-card px-3 py-1 text-xs font-bold theme-text-muted mb-5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: '#2E7D32' }}
                aria-hidden="true"
              />
              Built in Zambia, for the Zambian CBC
            </div>
            <h1 className="font-display font-black tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mb-5">
              CBC exam prep that actually fits{' '}
              <span style={{ color: '#2E7D32' }}>Zambian classrooms</span>.
            </h1>
            <p className="text-lg sm:text-xl theme-text-muted mb-8 max-w-2xl">
              Daily CBC exams, quizzes, games, and AI study help for Grade 4–6 learners — plus
              printable lesson tools for Zambian teachers.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button as={Link} to="/register" variant="primary" size="lg">
                Create a free account
              </Button>
              <Button as={Link} to="/login" variant="secondary" size="lg">
                I already have an account
              </Button>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm theme-text-muted">
              {[
                'Free for learners',
                'Free for teachers in beta',
                'No credit card needed',
              ].map((line) => (
                <li key={line} className="inline-flex items-center gap-2">
                  <Icon as={CheckCircleIcon} size="sm" className="text-[color:var(--accent)]" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-5">
            <DailyExamPreview />
          </div>
        </div>
      </Section>

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
              </div>
            </div>
          </Card>
        </div>
      </Section>

      {/* Teacher proof — realistic worksheet output preview */}
      <Section className="py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 items-center">
          <div className="lg:col-span-5 order-2 lg:order-1">
            <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
              For teachers
            </p>
            <h2 className="font-display font-black text-3xl sm:text-4xl mb-4">
              Generate a worksheet in seconds.
            </h2>
            <p className="theme-text-muted text-lg mb-6">
              Tell ZedExams the grade, subject, and topic. Get a CBC-aligned worksheet drafted by
              AI, ready to edit in Word or print as PDF — same lesson, less prep.
            </p>
            <ul className="space-y-2.5 theme-text-muted mb-7">
              {[
                'Lesson plans, worksheets, flashcards, schemes of work, rubrics',
                'Locally relevant examples (kwacha, Zambian names, local context)',
                'Editable DOCX so you can tweak before printing',
              ].map((b) => (
                <li key={b} className="flex gap-2.5">
                  <Icon as={CheckCircleIcon} size="sm" className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <Button as={Link} to="/register" variant="primary" size="lg">
              Try teacher tools free
            </Button>
          </div>
          <div className="lg:col-span-7 order-1 lg:order-2">
            <WorksheetPreview />
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
            Free to start. Clear from day one.
          </h2>
          <p className="theme-text-muted text-lg max-w-2xl mx-auto">
            Learners use ZedExams free. Teachers get full AI tools free during the beta.
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
              <ul className="space-y-2.5 mb-6 theme-text-muted text-sm">
                {tier.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5">
                    <Icon as={CheckCircleIcon} size="sm" className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
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
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Logo size="sm" />
              <p className="mt-3 text-sm theme-text-muted max-w-xs">
                CBC exam prep and AI teacher tools, built in Zambia for Zambian Grade 4–6
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
                  <button
                    type="button"
                    onClick={() => openContact('footer')}
                    className="inline-flex items-center gap-2 hover:theme-text"
                  >
                    <Icon as={Send} size="sm" />
                    Contact form
                  </button>
                </li>
                <li className="theme-text-muted/80">
                  <span className="inline-flex items-center gap-2">
                    <Icon as={ShieldCheck} size="sm" />
                    Schools & admins welcome
                  </span>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t theme-border text-xs theme-text-muted flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} ZedExams. All rights reserved.</span>
            <span>Made in Zambia.</span>
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
