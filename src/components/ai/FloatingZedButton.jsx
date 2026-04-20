import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const HIDDEN_PATTERNS = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/study(\/|$)/,
  /^\/quiz\/[^/]+/,
  /^\/exam\/[^/]+/,
  /^\/teachers(\/|$)/,
]

function useIsWide() {
  const [wide, setWide] = useState(
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e) => setWide(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return wide
}

export default function FloatingZedButton() {
  const location = useLocation()
  const { currentUser, userProfile } = useAuth()
  const wide = useIsWide()

  if (!currentUser || !userProfile) return null
  if (HIDDEN_PATTERNS.some(re => re.test(location.pathname))) return null

  const isLearnerHome = location.pathname === '/dashboard' || location.pathname === '/'

  return (
    <Link
      to="/study"
      aria-label="Ask Zed, the study assistant"
      data-floating-zed="true"
      style={{
        position: 'fixed',
        bottom: isLearnerHome ? (wide ? 32 : 80) : (wide ? 32 : 20),
        right:  wide ? 32 : 20,
        zIndex: 9999,
        display: 'inline-flex',
        alignItems: 'center',
        gap:       wide ? 12 : 8,
        padding:   wide ? '16px 26px' : '12px 18px',
        borderRadius: 9999,
        background: '#10B981',
        color: '#ffffff',
        fontWeight: 800,
        fontSize:   wide ? 16 : 14,
        textDecoration: 'none',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width:    wide ? 36 : 28,
          height:   wide ? 36 : 28,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.95)',
          color: '#10B981',
          flexShrink: 0,
          fontSize: wide ? 20 : 16,
          fontWeight: 900,
        }}
      >
        Z
      </span>
      <span>Ask Zed</span>
    </Link>
  )
}
