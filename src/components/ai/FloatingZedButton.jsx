import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const HIDDEN_PATTERNS = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/study(\/|$)/,
  /^\/quiz\/[^/]+/,
  /^\/exam\/[^/]+/,
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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = sessionStorage.getItem('zed-btn-collapsed')
      if (stored !== null) return stored === 'true'
    } catch {}
    return !wide
  })

  useEffect(() => {
    try {
      sessionStorage.setItem('zed-btn-collapsed', String(collapsed))
    } catch {}
  }, [collapsed])

  // Collapse by default on narrow viewports when width changes
  useEffect(() => {
    if (!wide) {
      try {
        if (sessionStorage.getItem('zed-btn-collapsed') === null) setCollapsed(true)
      } catch {
        setCollapsed(true)
      }
    }
  }, [wide])

  if (!currentUser || !userProfile) return null
  if (HIDDEN_PATTERNS.some(re => re.test(location.pathname))) return null

  const isLearnerHome = location.pathname === '/dashboard' || location.pathname === '/'
  const bottom = isLearnerHome ? (wide ? 32 : 80) : (wide ? 32 : 20)
  const right  = wide ? 32 : 16

  // Bot avatar size. Tweak these two numbers to resize everywhere safely.
  const avatarSize        = wide ? 56 : 48   // collapsed floating bot
  const avatarSizeInline  = wide ? 40 : 32   // inline bot in the expanded pill

  const botImg = (size) => (
    <img
      src="/images/characters/zedbot-help.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'block',
        userSelect: 'none',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.25))',
      }}
    />
  )

  return (
    <div
      style={{
        position: 'fixed',
        bottom,
        right,
        zIndex: 9999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
      }}
    >
      {/* Collapse toggle — only visible when expanded */}
      {!collapsed && (
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Collapse Ask Zed button"
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#374151',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            padding: 0,
            zIndex: 1,
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
          }}
        >
          ×
        </button>
      )}

      {collapsed ? (
        /* Icon-only bot */
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Open Ask Zed study assistant"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: avatarSize,
            height: avatarSize,
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            lineHeight: 0,
          }}
        >
          {botImg(avatarSize)}
        </button>
      ) : (
        /* Expanded link */
        <Link
          to="/study"
          aria-label="Ask Zed, the study assistant"
          data-floating-zed="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap:       wide ? 10 : 8,
            padding:   wide ? '10px 20px 10px 10px' : '8px 14px 8px 8px',
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
              width:  avatarSizeInline,
              height: avatarSizeInline,
              flexShrink: 0,
              lineHeight: 0,
            }}
          >
            {botImg(avatarSizeInline)}
          </span>
          <span>Ask Zed</span>
        </Link>
      )}
    </div>
  )
}
