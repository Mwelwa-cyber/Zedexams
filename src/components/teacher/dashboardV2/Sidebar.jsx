import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Keyboard,
  LogOut,
  Moon,
  Settings,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { NAV_GROUPS, TEACHER } from './mockData'

const LOGO_WEBP = '/zedexams-logo.webp?v=2'
const LOGO_PNG = '/zedexams-logo.png?v=5'

const ACCOUNT_MENU_ITEMS = [
  { id: 'view-profile', label: 'View profile', icon: UserRound },
  { id: 'account-settings', label: 'Account settings', icon: Settings },
  { id: 'subscription', label: 'Subscription & billing', icon: CreditCard },
  { id: 'switch-role', label: 'Switch class or role', icon: UsersRound },
  { id: 'notifications', label: 'Notification preferences', icon: Bell },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
  { id: 'theme', label: 'Theme', icon: Moon },
  { id: 'help', label: 'Help & support', icon: CircleHelp },
]

function AccountMenu({ onClose, onLogout, menuRef }) {
  // Focus the first item on open; arrow keys walk the items (menu pattern).
  useEffect(() => {
    const first = menuRef.current?.querySelector('[role="menuitem"]')
    first?.focus()
  }, [menuRef])

  const onKeyDown = (e) => {
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])
    const idx = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(idx + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(idx - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  return (
    <div
      className="tdv2-menu"
      role="menu"
      aria-label="Account"
      ref={menuRef}
      onKeyDown={onKeyDown}
    >
      <div className="tdv2-menu-header">
        <span className="tdv2-avatar" aria-hidden="true">{TEACHER.initials}</span>
        <span style={{ minWidth: 0 }}>
          <span className="tdv2-profile-name">{TEACHER.name}</span>
          <span className="tdv2-menu-email">{TEACHER.email}</span>
        </span>
      </div>
      {ACCOUNT_MENU_ITEMS.map(({ id, label, icon: ItemIcon }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          className="tdv2-menu-item"
          onClick={onClose}
        >
          <ItemIcon size={17} strokeWidth={1.75} aria-hidden="true" />
          {label}
        </button>
      ))}
      <div className="tdv2-menu-divider" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="tdv2-menu-item is-danger"
        onClick={onLogout}
      >
        <LogOut size={17} strokeWidth={1.75} aria-hidden="true" />
        Log out
      </button>
    </div>
  )
}

export default function Sidebar({ onRequestLogout }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

  const closeMenu = useCallback((refocus = true) => {
    setMenuOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  // Escape closes; click outside closes (without stealing focus back).
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') closeMenu()
    }
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) closeMenu(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [menuOpen, closeMenu])

  return (
    <aside className="tdv2-sidebar" aria-label="Teacher navigation">
      <div className="tdv2-logo">
        <span className="tdv2-logo-chip">
          <picture>
            <source type="image/webp" srcSet={LOGO_WEBP} />
            <img src={LOGO_PNG} alt="ZedExams" width={312} height={384} />
          </picture>
        </span>
        <span className="tdv2-logo-text">
          <span className="tdv2-logo-name">ZedExams</span>
          <br />
          <span className="tdv2-logo-sub">Teacher Dashboard</span>
        </span>
      </div>

      <nav className="tdv2-nav" aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div className="tdv2-nav-group" key={group.id}>
            {group.label ? (
              <div className="tdv2-nav-label" aria-hidden="true">{group.label}</div>
            ) : null}
            {group.items.map(({ id, label, icon: ItemIcon, to, active }) => (
              <Link
                key={id}
                to={to}
                className={`tdv2-nav-item ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <ItemIcon size={20} strokeWidth={1.75} aria-hidden="true" />
                <span className="tdv2-nav-text">{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="tdv2-profile-wrap" ref={wrapRef}>
        {menuOpen ? (
          <AccountMenu
            menuRef={menuRef}
            onClose={() => closeMenu()}
            onLogout={() => {
              closeMenu(false)
              onRequestLogout()
            }}
          />
        ) : null}
        <button
          type="button"
          ref={triggerRef}
          className="tdv2-profile"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="tdv2-avatar" aria-hidden="true">{TEACHER.initials}</span>
          <span className="tdv2-profile-text" style={{ minWidth: 0 }}>
            <span className="tdv2-profile-name">{TEACHER.name}</span>
            <br />
            <span className="tdv2-profile-role">{TEACHER.role}</span>
          </span>
          <ChevronDown
            size={17}
            strokeWidth={2}
            className="tdv2-profile-chevron"
            aria-hidden="true"
          />
        </button>
      </div>
    </aside>
  )
}
