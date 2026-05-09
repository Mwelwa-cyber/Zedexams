/**
 * OnboardingOverlay
 *
 * Generic first-session tour: full-bleed modal with a step-dot
 * indicator and Skip / Next buttons. The default config matches the
 * original learner tour (welcome, quizzes, theme, badges) so the
 * existing `<OnboardingOverlay />` mount on GradeHub keeps working
 * untouched.
 *
 * Audit A8 PR 2 — props are now configurable so the same component
 * can drive a teacher tour, an admin tour, etc. without forking:
 *
 *   <OnboardingOverlay
 *     steps={TEACHER_STEPS}
 *     storageKey="zedexams:teacher-onboarded"
 *   />
 *
 * Persistence:
 *   - Each variant uses its own localStorage key so a learner who
 *     also has a teacher account doesn't suppress the teacher tour
 *     (and vice versa).
 *   - Dismiss = "set the key" → tour never shows again on that
 *     device. Server-side persistence isn't needed for first-session
 *     UX; the friction point is the first 30 seconds, not month-3.
 */

import { useState, useEffect } from 'react'
import Button from './Button'

// Default learner tour — same shape and copy as the original.
const DEFAULT_LEARNER_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to ZedExams! 🎓',
    body: 'This is your learning hub. Select your grade to see your subjects and start practising.',
    icon: '👋',
  },
  {
    id: 'quizzes',
    title: 'Take Quizzes',
    body: 'Hit "Start Quiz" to test your knowledge with CBC-aligned practice questions.',
    icon: '✏️',
  },
  {
    id: 'theme',
    title: 'Change Your Theme',
    body: 'Click the colour swatch in the top bar to switch between 5 beautiful themes.',
    icon: '🎨',
  },
  {
    id: 'badges',
    title: 'Earn Badges',
    body: 'Complete quizzes to unlock achievement badges and track your learning journey.',
    icon: '🏆',
  },
]

const DEFAULT_STORAGE_KEY = 'examprep:onboarded'

export default function OnboardingOverlay({
  steps = DEFAULT_LEARNER_STEPS,
  storageKey = DEFAULT_STORAGE_KEY,
  finishLabel = "Let's go! 🚀",
  skipLabel = 'Skip tour',
} = {}) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(storageKey)) setVisible(true)
    } catch { /* localStorage unavailable — keep tour suppressed */ }
  }, [storageKey])

  function dismiss() {
    try { localStorage.setItem(storageKey, 'true') } catch { /* ignore */ }
    setVisible(false)
  }

  function next() {
    if (step < steps.length - 1) setStep((s) => s + 1)
    else dismiss()
  }

  if (!visible || !steps || steps.length === 0) return null

  const current = steps[step]

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="theme-card rounded-3xl shadow-2xl border theme-border w-full max-w-sm p-6 animate-slide-up">
        {/* Step indicator dots — theme accent for current, subtle bg for the rest */}
        <div className="flex justify-center gap-1.5 mb-4" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`rounded-full transition-all duration-base ease-out ${i === step ? 'w-5 h-2 theme-accent-fill' : 'w-2 h-2 theme-bg-subtle'}`}
            />
          ))}
        </div>

        <div className="text-5xl text-center mb-3" aria-hidden="true">{current.icon}</div>

        <h2 className="text-display-md theme-text text-center mb-2">{current.title}</h2>
        <p className="theme-text-muted text-body-sm text-center mb-6">{current.body}</p>

        <div className="flex gap-3">
          <Button variant="secondary" size="md" fullWidth onClick={dismiss} className="flex-1">
            {skipLabel}
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={next} className="flex-1">
            {step < steps.length - 1 ? 'Next →' : finishLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
