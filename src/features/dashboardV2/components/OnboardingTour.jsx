import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  ChartNoAxesColumnIncreasing,
  Compass,
  LayoutGrid,
  Lightbulb,
  Sparkles,
} from 'lucide-react'
import {
  placeCard,
  shouldShowTour,
  spotlightRect,
  TOUR_REPLAY_EVENT,
  TOUR_STORAGE_KEY,
} from '../lib/onboardingTourCore'

/**
 * First-run tour for Dashboard V2 — the tdv2-native successor to the classic
 * dashboard's TeacherOnboardingTour. Instead of a generic emoji modal it
 * spotlights the real dashboard: each step dims the page, cuts a copper-ringed
 * window around the element it describes ([data-tour="…"] anchors on the hero,
 * Quick Create, AI recommendations, class performance and the navigation), and
 * docks an explainer card beside it. Steps without a resolvable target fall
 * back to a centred card, so the tour degrades safely if an anchor moves.
 *
 * Shows once per device (TOUR_STORAGE_KEY); replays via /teacher?tour=1
 * (linked from Help & Support) or the TOUR_REPLAY_EVENT window event
 * (preview control panel). Escape or "Skip tour" dismisses for good.
 */

const STEPS = [
  {
    id: 'welcome',
    icon: Sparkles,
    target: null,
    title: 'Welcome to your new dashboard',
    body: 'Here’s a quick tour of where everything lives — it takes under a minute. Skip any time; you can replay it later from Help & Support.',
  },
  {
    id: 'hero',
    icon: BookOpen,
    target: 'hero',
    title: 'Pick up where you left off',
    body: 'Your last-opened document stays one tap away up here — press Continue and you’re straight back into it.',
    titleMobile: 'Your week at a glance',
    bodyMobile:
      'Your school, term progress and the teaching days left in the term live up here — so you always know where the term stands.',
  },
  {
    id: 'quick-create',
    icon: LayoutGrid,
    target: 'quick-create',
    title: 'Create in one tap',
    body: 'Lesson plans, assessment papers, homework, notes and more — every studio starts here, and every document exports to PDF or Word.',
    bodyMobile:
      'Tap the orange plus button any time to start a lesson plan, homework, test paper or weekly focus.',
  },
  {
    id: 'ai-recs',
    icon: Lightbulb,
    target: 'ai-recs',
    title: 'Ideas tuned to your classes',
    body: 'ZedExams reads your Teaching Profile and the school calendar to suggest what to prepare next. Each suggestion generates in one tap.',
  },
  {
    id: 'performance',
    icon: ChartNoAxesColumnIncreasing,
    target: 'performance',
    title: 'Your class at a glance',
    body: 'Once your learners take assigned quizzes, this chart tracks your class against the platform average, week by week.',
  },
  {
    id: 'nav',
    icon: Compass,
    target: 'nav',
    title: 'Find everything else',
    body: 'The sidebar holds the rest — your classes, library, calendar and settings. Help & Support is always one click away.',
    bodyMobile:
      'The dock jumps between Home, your Class Register, Library and Assessments. Settings, help and your profile live behind the menu, top-left.',
  },
]

export default function OnboardingTour({ isMobile = false, loading = false }) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [spot, setSpot] = useState(null)
  const [cardPos, setCardPos] = useState(null)
  const cardRef = useRef(null)
  const nextRef = useRef(null)

  // First-run decision — wait for the skeletons to settle so the anchors we
  // spotlight are the real cards, not loading placeholders.
  useEffect(() => {
    if (loading) return
    let stored = null
    try {
      stored = localStorage.getItem(TOUR_STORAGE_KEY)
    } catch { /* localStorage unavailable — treat as never seen */ }
    if (shouldShowTour({ stored, search })) {
      setStep(0)
      setActive(true)
    }
  }, [loading, search])

  // Imperative replay (preview control panel).
  useEffect(() => {
    const replay = () => {
      setStep(0)
      setActive(true)
    }
    window.addEventListener(TOUR_REPLAY_EVENT, replay)
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, replay)
  }, [])

  const dismiss = useCallback(() => {
    setActive(false)
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, 'done')
    } catch { /* ignore */ }
    // Drop ?tour=1 so a refresh doesn't restart a tour the teacher just closed.
    if (/[?&]tour=/.test(search)) navigate(pathname, { replace: true })
  }, [search, pathname, navigate])

  // Measure the current step's anchor and dock the card next to it. Runs
  // before paint so the spotlight never flashes at a stale position.
  const measure = useCallback(() => {
    const def = STEPS[step]
    const el = def?.target ? document.querySelector(`[data-tour="${def.target}"]`) : null
    if (!el) {
      setSpot(null)
      setCardPos(null)
      return
    }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const s = spotlightRect(el.getBoundingClientRect(), viewport)
    setSpot(s)
    const card = cardRef.current?.getBoundingClientRect()
    setCardPos(
      card ? placeCard({ spot: s, cardWidth: card.width, cardHeight: card.height, viewport }) : null,
    )
  }, [step])

  useLayoutEffect(() => {
    if (!active) return
    const def = STEPS[step]
    if (def?.target) {
      document.querySelector(`[data-tour="${def.target}"]`)?.scrollIntoView?.({ block: 'center' })
    }
    measure()
    nextRef.current?.focus()
  }, [active, step, measure])

  // Track viewport changes while open (rotation, resize, residual scroll).
  useEffect(() => {
    if (!active) return undefined
    let raf = 0
    const onChange = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [active, measure])

  // Escape dismisses; Tab cycles inside the card (same trap as LogoutDialog).
  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismiss()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = Array.from(cardRef.current?.querySelectorAll('button') || [])
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, dismiss])

  if (!active) return null

  const def = STEPS[step]
  const StepIcon = def.icon
  const last = step === STEPS.length - 1
  const body = isMobile && def.bodyMobile ? def.bodyMobile : def.body
  const title = isMobile && def.titleMobile ? def.titleMobile : def.title

  return (
    <div className="tdv2-tour" role="presentation">
      <div className={`tdv2-tour-scrim ${spot ? 'has-spot' : ''}`} aria-hidden="true" />
      {spot ? (
        <div
          className="tdv2-tour-spot"
          aria-hidden="true"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      ) : null}
      <div
        className={`tdv2-tour-card ${cardPos ? '' : 'is-centered'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tdv2-tour-title"
        aria-describedby="tdv2-tour-body"
        ref={cardRef}
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : undefined}
      >
        <div className="tdv2-tour-eyebrow">
          <span className="tdv2-tour-icon" aria-hidden="true">
            <StepIcon size={19} strokeWidth={1.75} />
          </span>
          <span className="tdv2-tour-count">Step {step + 1} of {STEPS.length}</span>
        </div>
        <h2 id="tdv2-tour-title">{title}</h2>
        <p id="tdv2-tour-body">{body}</p>
        <div className="tdv2-tour-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.id} className={`tdv2-tour-dot ${i === step ? 'is-on' : ''}`} />
          ))}
        </div>
        <div className="tdv2-tour-actions">
          <button type="button" className="tdv2-tour-skip" onClick={dismiss}>
            Skip tour
          </button>
          {step > 0 ? (
            <button type="button" className="tdv2-btn-quiet" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="tdv2-btn-copper"
            ref={nextRef}
            onClick={() => (last ? dismiss() : setStep((s) => s + 1))}
          >
            {last ? 'Start teaching' : 'Next'}
            {last ? null : <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}
