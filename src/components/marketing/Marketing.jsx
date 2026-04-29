import { Link } from 'react-router-dom'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Icon from '../ui/Icon'
import {
  AcademicCapIcon,
  Sparkles,
  TrophyIcon,
  ShieldCheck,
  Download,
  Gamepad2,
  BookOpen,
  Users,
  ChartBarIcon,
  Bot,
  CheckCircleIcon,
  Signal,
} from '../ui/icons'

const AUDIENCES = [
  {
    icon: AcademicCapIcon,
    title: 'Learners',
    tag: 'Grades 4–6',
    bullets: [
      'Daily exams aligned to the Zambian CBC syllabus',
      'Quizzes, lessons, and curriculum-mapped games',
      'Ask Zed — your AI study buddy, anytime',
      'Badges, streaks, and leaderboards to keep you going',
    ],
    cta: { label: 'Start learning free', to: '/register' },
  },
  {
    icon: Users,
    title: 'Teachers',
    tag: 'AI co-pilot',
    bullets: [
      'Generate lesson plans, worksheets, and flashcards in seconds',
      'Build schemes of work and rubrics with one click',
      'Export everything to DOCX or PDF — print and go',
      'Manage your own classes and content library',
    ],
    cta: { label: 'Try teacher tools', to: '/register' },
  },
  {
    icon: ShieldCheck,
    title: 'Schools & admins',
    tag: 'Oversight',
    bullets: [
      'Monitor learner progress across grades and subjects',
      'Approve teacher applications and shared content',
      'Edit the CBC knowledge base used by AI generators',
      'See generation logs and platform activity at a glance',
    ],
    cta: { label: 'Talk to us', to: '/login' },
  },
]

const FEATURES = [
  {
    icon: BookOpen,
    title: 'CBC-aligned content',
    body: 'Built around the Zambian Competency-Based Curriculum, not borrowed from elsewhere.',
  },
  {
    icon: Bot,
    title: 'Ask Zed AI',
    body: 'A friendly study assistant that explains concepts in clear English, ready 24/7.',
  },
  {
    icon: Download,
    title: 'Exportable docs',
    body: 'Every teacher generation downloads as DOCX or PDF — usable in any classroom.',
  },
  {
    icon: TrophyIcon,
    title: 'Leaderboards & badges',
    body: 'Daily exam streaks, subject badges, and friendly competition that motivates.',
  },
  {
    icon: Gamepad2,
    title: 'Curriculum games',
    body: 'Quick, focused mini-games for every grade and subject — learning that feels like play.',
  },
  {
    icon: Signal,
    title: 'Works on slow networks',
    body: 'Light pages and a data-saver mode designed for real Zambian internet conditions.',
  },
]

function Section({ children, className = '' }) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  )
}

export default function Marketing() {
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
              ZedExams gives Grade 4–6 learners daily exams, quizzes, games, and an AI study
              buddy — and gives teachers AI-powered lesson plans, worksheets, and rubrics they
              can print and use the same day.
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
                'No credit card needed',
                'Works on phones and slow networks',
                'Used by learners, teachers, and schools',
              ].map((line) => (
                <li key={line} className="inline-flex items-center gap-2">
                  <Icon as={CheckCircleIcon} size="sm" className="text-[color:var(--accent)]" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          {/* Hero illustration block */}
          <div className="lg:col-span-5">
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
                  { subject: 'Mathematics', score: '8 / 10' },
                  { subject: 'English',     score: '9 / 10' },
                  { subject: 'Science',     score: '7 / 10' },
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
          </div>
        </div>
      </Section>

      {/* Audience tracks */}
      <Section className="py-16 sm:py-20">
        <div className="text-center mb-12">
          <p className="text-sm font-black uppercase tracking-wider theme-accent-text mb-2">
            One platform, three roles
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3">
            Pick the track that fits you.
          </h2>
          <p className="theme-text-muted text-lg max-w-2xl mx-auto">
            Whether you're studying for the next exam, planning tomorrow's lesson, or running a
            whole school — ZedExams has tools made for you.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
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

      {/* Feature highlights */}
      <Section className="py-16 sm:py-20">
        <div className="text-center mb-12">
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3">
            Everything you need in one place.
          </h2>
          <p className="theme-text-muted text-lg max-w-2xl mx-auto">
            ZedExams was built for the way Zambian learners and teachers actually work — clear
            content, fast tools, and exports that print cleanly.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon, title, body }) => (
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

      {/* Trust strip */}
      <Section className="py-12">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-center theme-text-muted text-sm font-bold">
          <span className="inline-flex items-center gap-2">
            <Icon as={AcademicCapIcon} size="sm" />
            Grades 4 – 6
          </span>
          <span className="hidden sm:inline" aria-hidden="true">•</span>
          <span className="inline-flex items-center gap-2">
            <Icon as={ChartBarIcon} size="sm" />
            CBC-aligned content
          </span>
          <span className="hidden sm:inline" aria-hidden="true">•</span>
          <span className="inline-flex items-center gap-2">
            <Icon as={ShieldCheck} size="sm" />
            Teacher verification
          </span>
        </div>
      </Section>

      {/* Final CTA banner */}
      <Section className="pb-20">
        <Card variant="hero" size="lg" className="text-center">
          <h2 className="font-display font-black text-3xl sm:text-4xl text-white mb-3">
            Ready to start studying smarter?
          </h2>
          <p className="text-white/90 text-lg max-w-xl mx-auto mb-7">
            Create a free ZedExams account and jump straight into today's daily exam.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              as={Link}
              to="/register"
              variant="primary"
              size="lg"
              className="bg-white !text-[color:var(--accent-fg)] hover:bg-white"
            >
              Create a free account
            </Button>
            <Button
              as={Link}
              to="/login"
              variant="ghost"
              size="lg"
              className="text-white hover:bg-white/10 hover:text-white"
            >
              Sign in
            </Button>
          </div>
        </Card>
      </Section>

      {/* Footer */}
      <footer className="border-t theme-border">
        <Section className="py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm theme-text-muted">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <span>© {new Date().getFullYear()} ZedExams</span>
          </div>
          <nav className="flex items-center gap-5">
            <Link to="/login" className="hover:theme-text">Sign in</Link>
            <Link to="/register" className="hover:theme-text">Create account</Link>
          </nav>
        </Section>
      </footer>
    </div>
  )
}
