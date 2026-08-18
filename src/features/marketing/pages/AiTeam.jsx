import { Link } from 'react-router-dom'
import Logo from '../../../shared/components/Logo'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Button from '../../../shared/components/Button'
import Card from '../../../shared/components/Card'
import Icon from '../../../shared/components/Icon'
import {
  Sparkles,
  ShieldCheck,
  CheckCircleIcon,
  BookOpen,
  Users,
  Target,
  Clock,
  PencilLine,
} from '../../../shared/components/icons'

// Public, finance-free presentation of the ZedExams AI company. Everything
// here is hand-written marketing copy — it never reads the treasury, live
// agent state, or any internal data. (The operational view lives behind
// auth at /admin/company.)

function Section({ children, className = '' }) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  )
}

// How every lesson + quiz is actually made. This chain is the trust story.
const PIPELINE = [
  { icon: PencilLine, name: 'Aria', step: 'Drafts it', body: 'Writes the lesson, notes or quiz from the Zambian CBC syllabus.' },
  { icon: BookOpen, name: 'Cala', step: 'Aligns to CBC', body: 'Checks every draft against the official curriculum and flags anything off-syllabus.' },
  { icon: ShieldCheck, name: 'Reva', step: 'Reviews it', body: 'Reads for teaching quality, tone and the right level for the grade.' },
  { icon: CheckCircleIcon, name: 'A human', step: 'Approves it', body: 'Nothing reaches a learner until a person signs off. No exceptions.' },
  { icon: Target, name: 'Vex', step: 'Checks the quiz', body: 'Scores every quiz for accuracy, grammar and grade-fit before it goes live.' },
]

const TEAM = [
  {
    label: 'The content studio',
    icon: Sparkles,
    members: [
      { name: 'Aria', role: 'Content author', body: 'Drafts lessons, notes, homework and quizzes from the CBC syllabus.' },
      { name: 'Cala', role: 'Curriculum checker', body: 'Checks every draft against the official Zambian CBC curriculum.' },
      { name: 'Reva', role: 'Reviewer', body: 'Reads for teaching quality, tone and the right level for each grade.' },
      { name: 'Pubo', role: 'Publisher', body: 'Publishes only what a human has approved — never anything automatic.' },
    ],
  },
  {
    label: 'Quality & safety',
    icon: ShieldCheck,
    members: [
      { name: 'Vex', role: 'Quiz checker', body: 'Scores every quiz for accuracy, grammar and grade-fit before it can go live.' },
      { name: 'Quill', role: 'Daily QA', body: 'Runs nightly health checks across the whole platform.' },
      { name: 'Vigil', role: 'Site monitor', body: 'Watches the site around the clock and raises the alarm the moment anything breaks.' },
      { name: 'Marshal', role: 'Supervisor', body: 'Makes sure every other agent is doing its job, every single hour.' },
    ],
  },
  {
    label: 'Looking after you',
    icon: Users,
    members: [
      { name: 'Echo', role: 'Support', body: 'Reads every message you send us and drafts a careful reply for our team.' },
      { name: 'Anchor', role: 'Encourager', body: 'Notices when a learner goes quiet and helps us cheer them back.' },
      { name: 'Till', role: 'Payments', body: 'Makes sure every payment is captured and your access is switched on.' },
    ],
  },
]

const TRUST = [
  { icon: BookOpen, title: 'Aligned to the Zambian CBC', body: 'Every draft is checked against the official curriculum — not made up.' },
  { icon: CheckCircleIcon, title: 'A human always approves', body: 'No lesson or quiz reaches a learner on an AI’s say-so alone.' },
  { icon: ShieldCheck, title: 'Every quiz is checked', body: 'Answers, grammar and grade-fit are scored before anything goes live.' },
  { icon: Clock, title: 'Watched 24/7', body: 'Automatic monitors keep the platform healthy day and night.' },
]

export default function AiTeam() {
  return (
    <div className="marketing-page min-h-screen theme-bg theme-text font-body">
      <SeoHelmet
        title="Meet the AI team behind ZedExams"
        description="ZedExams is built by a small team of specialised AI agents — each accountable for one job, with a human approving everything that reaches a learner. See how we keep CBC content accurate, aligned and safe."
        path="/company"
      />

      {/* ── Header ─────────────────────────────────────────── */}
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

      {/* ── Hero ───────────────────────────────────────────── */}
      <Section className="pt-12 pb-10 sm:pt-16 sm:pb-14">
        <div className="max-w-3xl">
          <div className="marketing-kicker">
            <span aria-hidden="true" />
            The team behind your CBC content
          </div>
          <h1 className="marketing-hero-title">
            Meet the AI team that builds — and checks — every ZedExams lesson.
          </h1>
          <p className="marketing-hero-copy">
            ZedExams is built by a small company of specialised AI agents. Each one is
            accountable for a single job, and a human approves everything that reaches a
            learner. Here’s who they are — and how they keep your content accurate,
            CBC-aligned and safe.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button as={Link} to="/register" variant="primary" size="lg">
              Create a free account
            </Button>
            <Button as={Link} to="/pricing" variant="secondary" size="lg">
              See pricing
            </Button>
          </div>
        </div>
      </Section>

      {/* ── The pipeline (trust centrepiece) ───────────────── */}
      <Section className="py-12 sm:py-16">
        <div className="mb-10 text-center">
          <p className="theme-accent-text mb-2 text-sm font-black uppercase tracking-wider">How a lesson is made</p>
          <h2 className="font-display mb-3 text-3xl font-black sm:text-4xl">Five steps, every single time.</h2>
          <p className="theme-text-muted mx-auto max-w-2xl text-lg">
            Every quiz and lesson on ZedExams passes through this chain. Nothing is published
            on an AI’s word alone.
          </p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((s, i) => (
            <li key={s.name}>
              <Card variant="elevated" size="lg" className="flex h-full flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <span
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
                  >
                    <Icon as={s.icon} size="lg" />
                  </span>
                  <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Step {i + 1}</span>
                </div>
                <h3 className="font-display text-lg font-black">{s.step}</h3>
                <p className="theme-accent-text text-sm font-black">{s.name}</p>
                <p className="theme-text-muted mt-1.5 text-sm">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── The team ───────────────────────────────────────── */}
      <Section className="py-12 sm:py-16">
        <div className="mb-10 text-center">
          <p className="theme-accent-text mb-2 text-sm font-black uppercase tracking-wider">The roster</p>
          <h2 className="font-display mb-3 text-3xl font-black sm:text-4xl">A specialist for every job.</h2>
          <p className="theme-text-muted mx-auto max-w-2xl text-lg">
            Each agent does one thing well and hands off to the next — so no single step is
            ever skipped.
          </p>
        </div>
        <div className="space-y-10">
          {TEAM.map((group) => (
            <div key={group.label}>
              <div className="mb-4 flex items-center gap-2.5">
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
                >
                  <Icon as={group.icon} size="md" />
                </span>
                <h3 className="font-display text-xl font-black">{group.label}</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {group.members.map((m) => (
                  <Card key={m.name} variant="flat" size="lg" className="h-full">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="font-display text-lg font-black">{m.name}</h4>
                      <span className="theme-text-muted text-[11px] font-black uppercase tracking-wide">{m.role}</span>
                    </div>
                    <p className="theme-text-muted mt-1.5 text-sm">{m.body}</p>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="theme-text-muted mt-8 text-center text-sm">
          …plus a few more working behind the scenes on code quality, security and deciding
          what to build next.
        </p>
      </Section>

      {/* ── Why it matters ─────────────────────────────────── */}
      <Section className="py-12 sm:py-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((b) => (
            <Card key={b.title} variant="elevated" size="lg" className="h-full">
              <span
                className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl"
                style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
              >
                <Icon as={b.icon} size="lg" />
              </span>
              <h3 className="font-display text-base font-black">{b.title}</h3>
              <p className="theme-text-muted mt-1.5 text-sm">{b.body}</p>
            </Card>
          ))}
        </div>
        <p className="theme-text-muted mx-auto mt-8 max-w-2xl text-center text-sm">
          Our agents are powered by Anthropic’s Claude models and a lot of careful Zambian
          engineering. They do the repetitive work; a human always has the final word.
        </p>
      </Section>

      {/* ── CTA band ───────────────────────────────────────── */}
      <Section className="py-12 sm:py-16">
        <Card variant="hero" size="lg" className="text-center">
          <h2 className="font-display text-2xl font-black text-white sm:text-3xl">Learn with a team that checks its work.</h2>
          <p className="mx-auto mt-2 max-w-xl text-white/85">
            Daily CBC exams, quizzes, lessons and AI study help for Grade 7 — every piece
            of it made and checked by the team above.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button as={Link} to="/register" variant="primary" size="lg">
              Create a free account
            </Button>
            <Button as={Link} to="/teachers" variant="secondary" size="lg">
              I’m a teacher
            </Button>
          </div>
        </Card>
      </Section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t theme-border">
        <Section className="py-10">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Logo size="sm" />
              <p className="theme-text-muted mt-3 max-w-xs text-sm">
                CBC exam prep and AI teacher tools, built in Zambia for Zambian Grade 7
                classrooms.
              </p>
            </div>
            <div>
              <p className="font-display theme-text mb-3 text-sm font-black uppercase tracking-wider">Get started</p>
              <ul className="theme-text-muted space-y-2 text-sm">
                <li><Link to="/register" className="hover:theme-text">Create a free account</Link></li>
                <li><Link to="/login" className="hover:theme-text">Sign in</Link></li>
                <li><Link to="/pricing" className="hover:theme-text">Pricing</Link></li>
                <li><Link to="/papers" className="hover:theme-text">ECZ past papers</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-display theme-text mb-3 text-sm font-black uppercase tracking-wider">Legal</p>
              <ul className="theme-text-muted space-y-2 text-sm">
                <li><Link to="/privacy" className="hover:theme-text">Privacy Policy</Link></li>
                <li><Link to="/terms" className="hover:theme-text">Terms &amp; Conditions</Link></li>
                <li><Link to="/status" className="hover:theme-text">Service Status</Link></li>
              </ul>
            </div>
          </div>
        </Section>
      </footer>
    </div>
  )
}
