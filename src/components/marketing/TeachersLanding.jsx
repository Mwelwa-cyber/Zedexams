/**
 * /teachers — public landing for the teacher studios.
 *
 * The centrepiece is the sample library: hand-curated artifacts
 * (src/data/teacherSamples.js) rendered through the SAME presenter
 * components the studios use, so visitors see exactly what the tools
 * produce. Prices come from src/config/teacherPlanPricing.js — shared
 * with /pricing so the numbers can't drift.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Card from '../ui/Card'
import SeoHelmet from '../seo/SeoHelmet'
import { PLAN_PRICES } from '../../config/teacherPlanPricing'
import { isNativePlatform } from '../../utils/runtime'
import { TEACHER_SAMPLES } from '../../data/teacherSamples'
import LessonPlanView from '../teacher/views/LessonPlanView'
import LessonPlanOfficialTable from './LessonPlanOfficialTable'
import { WorksheetView } from '../../features/worksheet'
import { SchemeOfWorkView } from '../../features/schemeOfWork'
import { WeeklyForecastView } from '../../features/weeklyForecast'
import RecordOfWorkView from '../teacher/views/RecordOfWorkView'
import TestPaperOfficial from './TestPaperOfficial'
import { MarkScheduleView } from '../../features/markSchedule'
import ReportCardView from '../teacher/views/ReportCardView'
import { buildReportCards } from '../../shared/utils/markSchedule'
import { FlashcardsView } from '../../features/flashcards'
import useStudioAvailability from '../../hooks/useStudioAvailability'

function Section({ children, className = '', id }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  )
}

function SectionTag({ children }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-6 h-0.5 bg-[color:var(--accent)]" aria-hidden="true" />
      <span className="text-xs font-black uppercase tracking-wider theme-text-muted">{children}</span>
    </div>
  )
}

const STEPS = [
  {
    icon: '🎯',
    title: 'Pick your class and topic',
    body: 'Grade, subject and topic dropdowns come straight from the Zambian CBC syllabus library — no typing syllabus codes from memory.',
  },
  {
    icon: '✨',
    title: 'Generate in about a minute',
    body: 'The studio drafts the full document — competences, staged progression, questions with marks — while you watch it stream in.',
  },
  {
    icon: '🖨️',
    title: 'Edit, export, teach',
    body: 'Adjust anything, then export to Word — plus Excel and per-pupil report cards for mark schedules — or print straight from the browser. Your library keeps every document you make.',
  },
]

const TEACHER_FAQ = [
  {
    q: 'Is the content really CBC-aligned?',
    a: 'Yes. The generators read from a verified Zambian syllabus knowledge base — the same topics, competences and expected standards as the CDC documents. Lesson plans follow the official stage progression (Introduction → Lesson Development → Exercise/Assessment → Homework → Conclusion), and the old 2013-format layout is also available for schools that still require it.',
  },
  {
    q: 'Can I change what it produces?',
    a: 'Everything is editable. Generate first, then adjust activities, marks, class details or wording before you export. The samples on this page are shown exactly as the tools produced them.',
  },
  {
    q: 'What does it cost to start?',
    a: 'Nothing — the Free plan needs no card and gives you real generations every day to try the studios properly. Paid plans are activated with Airtel Money or MTN MoMo and confirmed on WhatsApp, usually within 30 minutes.',
  },
]

// Android (Google Play) build: no mobile-money/WhatsApp payment copy (Play
// policy — in-app digital purchases run through Google Play Billing only).
const TEACHER_FAQ_NATIVE = TEACHER_FAQ.map((item) =>
  item.q === 'What does it cost to start?'
    ? {
        ...item,
        a: 'Nothing — the Free plan needs no card and gives you real generations every day to try the studios properly. Paid plans are billed securely through Google Play and unlock instantly.',
      }
    : item
)

function SampleRenderer({ sample, showAnswers, planLayout, testVariant, scheduleMode }) {
  switch (sample.tool) {
    case 'lesson_plan':
      // 'table' mirrors the studio's printed/exported document; 'app' is
      // the in-app library view of the same artifact.
      return planLayout === 'table'
        ? <LessonPlanOfficialTable plan={sample.artifact} />
        : <LessonPlanView plan={sample.artifact} />
    case 'worksheet':
      return <WorksheetView worksheet={sample.artifact} showAnswers={showAnswers} />
    case 'scheme_of_work':
      return <SchemeOfWorkView scheme={sample.artifact} />
    case 'weekly_forecast':
      return <WeeklyForecastView forecast={sample.artifact} />
    case 'record_of_work':
      return <RecordOfWorkView record={sample.artifact} />
    case 'term_test':
      return <TestPaperOfficial paper={sample.artifact[testVariant] || sample.artifact.midterm} />
    case 'mark_schedule': {
      if (scheduleMode !== 'card') {
        return <MarkScheduleView schedule={sample.artifact} mode={scheduleMode} />
      }
      // One printed page per pupil — show the top pupil's card, built
      // live from the same roster the schedule renders.
      const cards = buildReportCards(sample.artifact)
      return (
        <div>
          <ReportCardView card={cards[0]} header={sample.artifact.header} />
          <p className="text-center text-xs theme-text-muted mt-3">
            One page like this prints for each of the {cards.length} pupils — comments already filled in from the schedule.
          </p>
        </div>
      )
    }
    case 'flashcards':
      return <FlashcardsView flashcards={sample.artifact} />
    default:
      return null
  }
}

function SampleLibrary() {
  // The sample library is a promise: a tab here says "this studio exists and
  // produces this". A withdrawn studio must not be advertised on the public
  // page, and restoring the flag restores the tab with the studio.
  const { isAvailable } = useStudioAvailability()
  const samples = useMemo(
    () => TEACHER_SAMPLES.filter((s) => isAvailable(s.tool)),
    [isAvailable],
  )
  const [activeId, setActiveId] = useState(TEACHER_SAMPLES[0].id)
  const [showAnswers, setShowAnswers] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Lesson plan layout: 'table' (the studio's printed document) | 'app'.
  const [planLayout, setPlanLayout] = useState('table')
  // Term-test paper variant: 'midterm' | 'endOfTerm'.
  const [testVariant, setTestVariant] = useState('midterm')
  // Mark schedule view: 'marks' (raw, out of each subject max) | 'percent'.
  const [scheduleMode, setScheduleMode] = useState('marks')
  // Falls back to the first AVAILABLE sample: the flag can turn off under a
  // page that is already open, and `activeId` would then name a missing tab.
  const active = samples.find((s) => s.id === activeId) || samples[0]
  if (!active) return null
  // Flashcards are a compact grid — collapsing them just hides half the fun.
  const collapsible = active.tool !== 'flashcards'
  const isCollapsed = collapsible && !expanded

  function selectSample(id) {
    setActiveId(id)
    setExpanded(false)
    setShowAnswers(false)
    setPlanLayout('table')
    setTestVariant('midterm')
    setScheduleMode('marks')
  }

  return (
    <div>
      {/* Tool tabs */}
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Sample documents by studio"
      >
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`sample-tab-${s.id}`}
            aria-selected={s.id === active.id}
            aria-controls="sample-panel"
            onClick={() => selectSample(s.id)}
            className={`rounded-full px-4 py-2 text-sm font-black transition-all border ${
              s.id === active.id
                ? 'theme-accent-fill theme-on-accent border-transparent shadow-elev-sm'
                : 'theme-card theme-border theme-text-muted hover:theme-text'
            }`}
          >
            <span aria-hidden="true" className="mr-1.5">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Active sample */}
      <div
        id="sample-panel"
        role="tabpanel"
        aria-labelledby={`sample-tab-${active.id}`}
        className="mt-5"
      >
        <Card variant="elevated" size="lg" className="overflow-hidden">
          {/* Meta strip */}
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b theme-border">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {[active.grade, active.subject, active.topic].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-[color:var(--bg-subtle)] border theme-border px-2.5 py-1 text-[11px] font-black theme-text"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <p className="theme-text-muted text-sm mt-2 max-w-xl">{active.blurb}</p>
            </div>
            {active.tool === 'worksheet' && (
              <button
                type="button"
                onClick={() => setShowAnswers(v => !v)}
                aria-pressed={showAnswers}
                className={`shrink-0 rounded-full border px-4 py-2 text-xs font-black transition-all ${
                  showAnswers
                    ? 'theme-accent-fill theme-on-accent border-transparent'
                    : 'theme-card theme-border theme-text-muted hover:theme-text'
                }`}
              >
                {showAnswers ? '✓ Answer key shown' : 'Show answer key'}
              </button>
            )}
            {active.tool === 'lesson_plan' && (
              <div className="shrink-0 inline-flex gap-1 rounded-full theme-card border theme-border p-1" role="group" aria-label="Lesson plan layout">
                {[['table', 'Official table'], ['app', 'App view']].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPlanLayout(key)}
                    aria-pressed={planLayout === key}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-black transition-all ${
                      planLayout === key
                        ? 'theme-accent-fill theme-on-accent'
                        : 'theme-text-muted hover:theme-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {active.tool === 'term_test' && (
              <div className="shrink-0 inline-flex gap-1 rounded-full theme-card border theme-border p-1" role="group" aria-label="Test paper">
                {[['midterm', 'Mid-term'], ['endOfTerm', 'End of term']].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTestVariant(key)}
                    aria-pressed={testVariant === key}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-black transition-all ${
                      testVariant === key
                        ? 'theme-accent-fill theme-on-accent'
                        : 'theme-text-muted hover:theme-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {active.tool === 'mark_schedule' && (
              <div className="shrink-0 inline-flex gap-1 rounded-full theme-card border theme-border p-1" role="group" aria-label="Schedule view">
                {[['marks', 'Raw marks'], ['percent', 'Percentages'], ['card', 'Report card']].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScheduleMode(key)}
                    aria-pressed={scheduleMode === key}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-black transition-all ${
                      scheduleMode === key
                        ? 'theme-accent-fill theme-on-accent'
                        : 'theme-text-muted hover:theme-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Document */}
          <div className="relative mt-4">
            <div className={isCollapsed ? 'max-h-[520px] overflow-hidden' : ''}>
              <SampleRenderer sample={active} showAnswers={showAnswers} planLayout={planLayout} testVariant={testVariant} scheduleMode={scheduleMode} />
            </div>
            {isCollapsed && (
              <div
                className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[color:var(--card)] to-transparent pointer-events-none"
                aria-hidden="true"
              />
            )}
          </div>

          {collapsible && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => setExpanded(v => !v)}>
                {expanded ? 'Collapse' : 'Show the full document'}
              </Button>
            </div>
          )}

          {/* Footer strip */}
          <div className="mt-4 pt-4 border-t border-dashed theme-border flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs theme-text-muted">
              <span aria-hidden="true">{active.icon}</span>{' '}
              {active.comingSoon
                ? <>{active.label} studio coming soon — your documents will look exactly like this</>
                : <>Made with the {active.madeWith || active.label} studio · exports to {active.exports || 'DOCX'}</>}
            </p>
            <Button as={Link} to="/register?role=teacher" variant="primary" size="sm">
              Make one for your class
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

const TIER_BLURBS = {
  free: { name: 'Free', mascot: '🐢', blurb: 'Real generations every day, no card needed. Try every studio properly.' },
  pro:  { name: 'Pro',  mascot: '🦊', blurb: 'For the everyday teacher — full monthly allowances, DOCX + PDF export, premium model.', popular: true },
  max:  { name: 'Max',  mascot: '🦅', blurb: 'For heavy users — effectively unlimited documents and bulk export.' },
}

function PricingStrip() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Object.entries(TIER_BLURBS).map(([key, tier]) => (
        <Card
          key={key}
          variant={tier.popular ? 'hero' : 'elevated'}
          size="md"
          className="relative"
        >
          {tier.popular && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white">
              Most popular
            </span>
          )}
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">{tier.mascot}</span>
            <div>
              <p className={`font-display font-black text-xl ${tier.popular ? '' : 'theme-text'}`}>{tier.name}</p>
              <p className={`text-sm font-black ${tier.popular ? 'text-white/90' : 'theme-text'}`}>
                {/* Android: web ZMW prices stay off — Google Play prices at checkout. */}
                {isNativePlatform()
                  ? (PLAN_PRICES[key].monthly === 0 ? 'Free' : 'Via Google Play')
                  : <>
                      {PLAN_PRICES[key].monthly === 0 ? 'K0' : `K${PLAN_PRICES[key].monthly}`}
                      <span className={`font-bold text-xs ml-1 ${tier.popular ? 'text-white/70' : 'theme-text-muted'}`}>/ month</span>
                    </>}
              </p>
            </div>
          </div>
          <p className={`text-sm mt-3 ${tier.popular ? 'text-white/80' : 'theme-text-muted'}`}>{tier.blurb}</p>
        </Card>
      ))}
    </div>
  )
}

export default function TeachersLanding() {
  const { currentUser, isTeacher } = useAuth()

  return (
    <>
      <SeoHelmet
        title="AI lesson plans, homework & schemes for Zambian teachers"
        description="Generate CBC-aligned lesson plans, homework, term tests, schemes of work, weekly forecasts, records of work and flashcards in about a minute. See real samples, start free — no card required."
        path="/teachers"
      />
      <div className="marketing-page min-h-screen theme-bg theme-text font-body">
        {/* Top nav */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
          <Section className="flex items-center justify-between py-3">
            <Link to="/" aria-label="ZedExams home" className="flex items-center">
              <Logo size="sm" />
            </Link>
            <nav className="flex items-center gap-2 sm:gap-3">
              <Button as={Link} to="/pricing" variant="ghost" size="sm">
                Pricing
              </Button>
              {currentUser ? (
                <Button as={Link} to={isTeacher ? '/teacher' : '/'} variant="ghost" size="sm">
                  Dashboard
                </Button>
              ) : (
                <Button as={Link} to="/login" variant="ghost" size="sm">
                  Sign in
                </Button>
              )}
              <Button as={Link} to="/register?role=teacher" variant="primary" size="sm">
                Start free
              </Button>
            </nav>
          </Section>
        </header>

        {/* Hero */}
        <Section className="pt-10 pb-8 sm:pt-14">
          <Card variant="hero" size="lg" className="relative overflow-hidden px-7 py-12 sm:px-12 sm:py-14">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
              ✦ For Zambian teachers
            </span>
            <h1 className="font-display font-black tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mt-5 mb-4 max-w-2xl">
              Sunday-night planning, done in about a minute.
            </h1>
            <p className="text-lg text-white/80 max-w-xl">
              CBC-aligned lesson plans, homework, term tests, schemes of work, weekly forecasts,
              records of work and flashcards — generated from the official syllabus, edited by you, exported to DOCX or PDF.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button as={Link} to="/register?role=teacher" variant="primary" size="lg"
                className="!bg-[color:var(--hero-cta-bg)] !text-[color:var(--hero-cta-text)] hover:!bg-[color:var(--hero-cta-bg)]">
                Start free
              </Button>
              <Button as="a" href="#samples" variant="ghost" size="lg" className="!text-white hover:!bg-white/10">
                See real samples ↓
              </Button>
            </div>
            <p className="mt-4 text-sm text-white/70">
              {isNativePlatform()
                ? 'No card required · free generations every day · upgrade anytime via Google Play'
                : 'No card required · free generations every day · pay with Airtel Money or MTN MoMo when you upgrade'}
            </p>
          </Card>
        </Section>

        {/* Sample library */}
        <Section id="samples" className="py-10 sm:py-14 scroll-mt-20">
          <SectionTag>Sample library</SectionTag>
          <h2 className="font-display font-black text-3xl sm:text-4xl tracking-tight max-w-2xl">
            Don't take our word for it — read the documents.
          </h2>
          <p className="theme-text-muted mt-3 mb-8 max-w-2xl">
            These samples are shown exactly as the studios render them, structure and all.
            Pick a tool to see what lands in your library.
          </p>
          <SampleLibrary />
        </Section>

        {/* How it works */}
        <Section className="py-10 sm:py-14">
          <SectionTag>How it works</SectionTag>
          <h2 className="font-display font-black text-3xl sm:text-4xl tracking-tight">
            Three steps, no manuals.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            {STEPS.map((step, i) => (
              <Card key={step.title} variant="elevated" size="md">
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center w-11 h-11 rounded-2xl bg-[color:var(--bg-subtle)] text-2xl" aria-hidden="true">
                    {step.icon}
                  </span>
                  <span className="text-xs font-black uppercase tracking-wider theme-text-muted">Step {i + 1}</span>
                </div>
                <h3 className="font-display font-black text-lg mt-4 theme-text">{step.title}</h3>
                <p className="theme-text-muted text-sm mt-2 leading-relaxed">{step.body}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* Pricing strip */}
        <Section className="py-10 sm:py-14">
          <SectionTag>Plans</SectionTag>
          <div className="flex flex-wrap items-end justify-between gap-3 mb-8">
            <h2 className="font-display font-black text-3xl sm:text-4xl tracking-tight">
              Start free. Upgrade when your week gets busy.
            </h2>
            <Link to="/pricing" className="text-sm font-black theme-accent-text hover:underline shrink-0">
              Compare full plans →
            </Link>
          </div>
          <PricingStrip />
        </Section>

        {/* FAQ */}
        <Section className="py-10 sm:py-14">
          <SectionTag>Questions</SectionTag>
          <div className="space-y-3 max-w-3xl">
            {(isNativePlatform() ? TEACHER_FAQ_NATIVE : TEACHER_FAQ).map((item) => (
              <details key={item.q} className="theme-card border theme-border rounded-2xl px-5 py-4 group">
                <summary className="cursor-pointer font-black theme-text text-sm sm:text-base list-none flex items-center justify-between gap-3">
                  {item.q}
                  <span className="theme-text-muted transition-transform group-open:rotate-45 text-lg leading-none" aria-hidden="true">+</span>
                </summary>
                <p className="theme-text-muted text-sm mt-3 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* Final CTA */}
        <Section className="py-10 sm:py-16">
          <Card variant="hero" size="lg" className="text-center px-7 py-12 sm:px-12">
            <h2 className="font-display font-black text-3xl sm:text-4xl tracking-tight">
              Your next lesson plan is a minute away.
            </h2>
            <p className="text-white/80 mt-3 max-w-lg mx-auto">
              Join Zambian teachers who plan with ZedExams. Free to start, no card required.
            </p>
            <div className="mt-7 flex justify-center">
              <Button as={Link} to="/register?role=teacher" variant="primary" size="lg"
                className="!bg-[color:var(--hero-cta-bg)] !text-[color:var(--hero-cta-text)] hover:!bg-[color:var(--hero-cta-bg)]">
                Create your first document
              </Button>
            </div>
          </Card>
        </Section>

        {/* Slim footer */}
        <footer className="border-t theme-border">
          <Section className="py-6 flex flex-wrap items-center justify-between gap-3 text-xs theme-text-muted">
            <span>© {new Date().getFullYear()} ZedExams</span>
            <nav className="flex items-center gap-4">
              <Link to="/pricing" className="hover:theme-text font-bold">Pricing</Link>
              <Link to="/privacy" className="hover:theme-text font-bold">Privacy</Link>
              <Link to="/terms" className="hover:theme-text font-bold">Terms</Link>
            </nav>
          </Section>
        </footer>
      </div>
    </>
  )
}
