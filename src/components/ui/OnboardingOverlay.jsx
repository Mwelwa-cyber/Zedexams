/**
 * OnboardingOverlay
 *
 * Shows a brief welcome tour the very first time a user opens the dashboard.
 * Steps are stored and dismissed via localStorage key 'examprep:onboarded'.
 *
 * Usage:
 *   <OnboardingOverlay />   (place anywhere inside the dashboard component tree)
 */
import { useState, useEffect } from 'react'

const LS_KEY = 'examprep:onboarded'

const STEPS = [
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

export default function OnboardingOverlay() {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(LS_KEY)) setVisible(true)
    } catch { /* localStorage unavailable */ }
  }, [])

  function dismiss() {
    try { localStorage.setItem(LS_KEY, 'true') } catch { }
    setVisible(false)
  }

  function next() {
    if (step < STEPS.length - 1) setStep(s => s + 1)
    else dismiss()
  }

  if (!visible) return null

  const current = STEPS[step]

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="theme-card rounded-3xl shadow-2xl border theme-border w-full max-w-sm p-6 animate-slide-up">
        {/* Step indicator dots */}
        <div className="flex justify-center gap-1.5 mb-4">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`rounded-full transition-all ${i === step ? 'w-5 h-2 bg-indigo-600' : 'w-2 h-2 bg-gray-200'}`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="text-5xl text-center mb-3">{current.icon}</div>

        {/* Content */}
        <h2 className="font-black theme-text text-lg text-center mb-2">{current.title}</h2>
        <p className="theme-text-muted text-sm text-center leading-relaxed mb-6">{current.body}</p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={dismiss}
            className="flex-1 font-bold text-sm py-2.5 rounded-2xl border theme-border theme-text hover:theme-bg-subtle transition-colors min-h-0"
          >
            Skip tour
          </button>
          <button
            onClick={next}
            className="flex-1 font-black text-sm py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-colors min-h-0"
          >
            {step < STEPS.length - 1 ? 'Next →' : "Let's go! 🚀"}
          </button>
        </div>
      </div>
    </div>
  )
}
