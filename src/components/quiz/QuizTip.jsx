/**
 * QuizTip — Professor Pako's after-question teaching tip.
 *
 * Shown after a learner selects an answer in practice mode.
 * Slides in from the bottom, auto-dismisses or can be manually closed.
 *
 * Props:
 *   isCorrect   — boolean | null (null = not yet answered)
 *   tipText     — string (tip to display; uses explanation if available)
 *   onDismiss   — called when tip is closed
 *   visible     — boolean
 */
import { useEffect, useState } from 'react'
import { useDataSaver } from '../../contexts/DataSaverContext'

const MOOD_CONFIG = {
  correct: {
    mood:        'happy',
    bg:          'bg-green-50 border-green-200',
    header:      'text-green-700',
    text:        'text-green-800',
    badge:       'bg-green-100 text-green-700',
    badgeLabel:  '🌟 Correct!',
    headerText:  'Well done! Here\'s what you should know:',
  },
  wrong: {
    mood:        'tip',
    bg:          'bg-orange-50 border-orange-200',
    header:      'text-orange-700',
    text:        'text-orange-800',
    badge:       'bg-orange-100 text-orange-700',
    badgeLabel:  '💡 Keep going!',
    headerText:  'Don\'t worry — here\'s a helpful tip:',
  },
  tip: {
    mood:        'normal',
    bg:          'theme-accent-bg theme-border',
    header:      'theme-accent-text',
    text:        'theme-text',
    badge:       'theme-card theme-border theme-accent-text',
    badgeLabel:  '🦉 Pako\'s Tip',
    headerText:  'Quick tip from Professor Pako:',
  },
}

// Inline mini Pako avatar (lightweight — just head + cap)
function PakoAvatar({ mood = 'normal' }) {
  const eyeColor = mood === 'happy' ? '#15803D' : mood === 'wrong' ? '#EA580C' : '#1E40AF'
  return (
    <svg viewBox="0 0 60 70" width="44" height="44" xmlns="http://www.w3.org/2000/svg">
      {/* Cap */}
      <ellipse cx="30" cy="12" rx="14" ry="5" fill="#111827" />
      <rect x="17" y="8" width="26" height="5" rx="0.5" fill="#111827" />
      <circle cx="30" cy="8" r="2" fill="#4B5563" />
      <path d="M43 10 Q50 7 48 20" stroke="#F59E0B" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="48" cy="19" r="2" fill="#FBBF24" />
      {/* Head */}
      <circle cx="30" cy="35" r="20" fill="#B45309" />
      {/* Glasses */}
      <circle cx="22" cy="35" r="8" fill="white" fillOpacity="0.9" />
      <circle cx="22" cy="35" r="8" stroke="#374151" strokeWidth="1.5" fill="none" />
      <circle cx="38" cy="35" r="8" fill="white" fillOpacity="0.9" />
      <circle cx="38" cy="35" r="8" stroke="#374151" strokeWidth="1.5" fill="none" />
      <path d="M30 35 L30 35" stroke="#374151" strokeWidth="1.5" />
      {/* Eyes */}
      <circle cx="22" cy="35" r="5" fill={eyeColor} />
      <circle cx="22" cy="35" r="3" fill="#0F172A" />
      <circle cx="23.5" cy="33" r="1.5" fill="white" />
      <circle cx="38" cy="35" r="5" fill={eyeColor} />
      <circle cx="38" cy="35" r="3" fill="#0F172A" />
      <circle cx="39.5" cy="33" r="1.5" fill="white" />
      {/* Beak */}
      {mood === 'happy'
        ? <path d="M25 44 Q30 50 35 44" stroke="#FBBF24" strokeWidth="2" fill="none" strokeLinecap="round" />
        : <path d="M26 44 L34 44 L30 50Z" fill="#FBBF24" />
      }
    </svg>
  )
}

export default function QuizTip({ isCorrect, tipText, onDismiss, visible }) {
  const { dataSaver } = useDataSaver()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (visible) {
      setShown(true)
      // Auto-dismiss after 8 seconds
      const t = setTimeout(() => {
        setShown(false)
        setTimeout(onDismiss, 300)
      }, 8000)
      return () => clearTimeout(t)
    }
  }, [visible, onDismiss])

  if (!visible && !shown) return null

  const variant = isCorrect === true ? 'correct' : isCorrect === false ? 'wrong' : 'tip'
  const cfg     = MOOD_CONFIG[variant]

  function dismiss() {
    setShown(false)
    setTimeout(onDismiss, 300)
  }

  return (
    <div
      className={`transition-all duration-300 ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
    >
      <div className={`border-2 rounded-2xl p-4 mt-3 ${cfg.bg}`}>
        <div className="flex items-start gap-3">
          {/* Pako mini avatar */}
          {!dataSaver && <PakoAvatar mood={variant === 'correct' ? 'happy' : variant} />}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-black px-2 py-0.5 rounded-full ${cfg.badge}`}>
                  {cfg.badgeLabel}
                </span>
                <p className={`text-xs font-bold ${cfg.header}`}>{cfg.headerText}</p>
              </div>
              <button
                onClick={dismiss}
                className={`text-xs font-bold ${cfg.header} hover:opacity-70 min-h-0 bg-transparent shadow-none p-1`}
              >
                ✕
              </button>
            </div>
            <p className={`text-sm leading-relaxed font-medium ${cfg.text}`}>
              {tipText || 'Keep practising — every question makes you stronger!'}
            </p>
          </div>
        </div>

        {/* Auto-dismiss progress bar */}
        {!dataSaver && shown && (
          <div className="mt-2.5 w-full bg-black/10 rounded-full h-1">
            <div
              className="h-1 rounded-full opacity-50 animate-[shrink_8s_linear_forwards]"
              style={{
                background: isCorrect ? '#15803D' : isCorrect === false ? '#EA580C' : 'var(--accent)',
                animation: 'shrink 8s linear forwards',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
