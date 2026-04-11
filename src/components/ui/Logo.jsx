/**
 * ExamPrep Zambia Logo component
 * size: 'sm' | 'md' | 'lg' | 'xl'
 * variant: 'full' (icon + text) | 'icon' (icon only) | 'text' (text only)
 * dark: false = green bg context, true = light bg context
 */
export default function Logo({ size = 'md', variant = 'full', dark = false }) {
  const iconSizes = { sm: 28, md: 36, lg: 48, xl: 64 }
  const px = iconSizes[size] ?? 36

  const textScale = { sm: 'text-sm',  md: 'text-base', lg: 'text-xl', xl: 'text-3xl' }
  const subScale  = { sm: 'text-[9px]', md: 'text-[10px]', lg: 'text-xs', xl: 'text-sm' }
  const tagScale  = { sm: 'hidden', md: 'hidden', lg: 'text-[9px]', xl: 'text-xs' }

  const Icon = () => (
    <svg width={px} height={px} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
      {/* Shield */}
      <path d="M32 3 L57 14 L57 34 C57 49 44 59 32 63 C20 59 7 49 7 34 L7 14 Z"
            fill="#16a34a"/>
      <path d="M32 7 L53 17 L53 34 C53 46 42 55 32 59 C22 55 11 46 11 34 L11 17 Z"
            fill="#15803d"/>

      {/* Open book — bottom teal page */}
      <path d="M10 44 Q32 38 54 44 L54 52 Q32 46 10 52 Z" fill="#0d9488"/>
      {/* Open book — top orange page */}
      <path d="M10 40 Q32 46 54 40 L54 48 Q32 42 10 48 Z" fill="#f97316"/>
      {/* Book spine highlight */}
      <line x1="32" y1="40" x2="32" y2="52" stroke="white" strokeWidth="1" opacity="0.4"/>

      {/* Graduation cap board */}
      <polygon points="32,20 48,28 32,34 16,28" fill="#111827"/>
      {/* Cap top */}
      <rect x="26" y="28" width="12" height="9" rx="1.5" fill="#1f2937"/>
      {/* Tassel string */}
      <line x1="48" y1="28" x2="48" y2="37" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
      {/* Tassel end */}
      <circle cx="48" cy="39" r="2.5" fill="#fbbf24"/>

      {/* White checkmark overlay */}
      <path d="M20 38 L27 45 L44 26"
            stroke="white" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round"
            fill="none" opacity="0.85"/>
    </svg>
  )

  if (variant === 'icon') return <Icon />

  if (variant === 'text') return (
    <div className="leading-none">
      <div className={`font-black leading-none tracking-tight ${textScale[size]}`}>
        <span style={{ color: '#ea580c' }}>EXAMS </span>
        <span style={{ color: '#16a34a' }}>PREP</span>
      </div>
      <div className={`font-black tracking-widest ${dark ? 'text-gray-600' : 'text-white/70'} ${subScale[size]}`}>
        — ZAMBIA —
      </div>
    </div>
  )

  // 'full' variant — icon + text
  return (
    <div className="flex items-center gap-2">
      <Icon />
      <div className="leading-none">
        <div className={`font-black leading-none tracking-tight ${textScale[size]}`}>
          <span style={{ color: dark ? '#ea580c' : '#fed7aa' }}>EXAMS </span>
          <span style={{ color: dark ? '#16a34a' : '#bbf7d0' }}>PREP</span>
        </div>
        <div className={`font-black tracking-widest mt-0.5 ${dark ? 'text-gray-500' : 'text-white/60'} ${subScale[size]}`}>
          — ZAMBIA —
        </div>
        {size === 'xl' || size === 'lg' ? (
          <div className={`italic font-bold mt-0.5 ${dark ? 'text-green-600' : 'text-green-200'} ${tagScale[size]}`}>
            Practice Smart. Pass Confidently.
          </div>
        ) : null}
      </div>
    </div>
  )
}
