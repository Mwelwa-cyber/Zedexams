import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  CircleHelp,
  CreditCard,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { TEACHER_NAV_GROUPS } from './dashboardV2Config'
import { buildActiveMatcher } from './teacherNavActive'

const LOGO_WEBP = '/zedexams-logo.webp?v=2'
const LOGO_PNG = '/zedexams-logo.png?v=5'

/* Every entry navigates somewhere real — no dead menu items. Targets are
   the Teacher Settings panels under /settings/* (SettingsPage routes the
   subpath per role); help goes through support email (no in-app route). */
const ACCOUNT_MENU_ITEMS = [
  { id: 'view-profile', label: 'View profile', icon: UserRound, to: '/settings/profile' },
  { id: 'account-settings', label: 'Account settings', icon: Settings, to: '/settings' },
  { id: 'subscription', label: 'Subscription & billing', icon: CreditCard, to: '/teacher/subscription' },
  { id: 'switch-role', label: 'Switch class or role', icon: UsersRound, to: '/settings/teaching-profile' },
  { id: 'notifications', label: 'Notification preferences', icon: Bell, to: '/settings/notifications' },
  // 'theme' is rendered specially below: it toggles the dashboard theme in
  // place (menu stays open so the switch is instantly visible/reversible).
  { id: 'theme' },
  { id: 'help', label: 'Help & support', icon: CircleHelp, to: '/teacher/help' },
]

function AccountMenu({ teacher, onSelect, onClose, onLogout, menuRef, dark, onToggleTheme }) {
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
        <span className="tdv2-avatar" aria-hidden="true">{teacher.initials}</span>
        <span style={{ minWidth: 0 }}>
          <span className="tdv2-profile-name">{teacher.name}</span>
          <span className="tdv2-menu-email">{teacher.email}</span>
        </span>
      </div>
      {ACCOUNT_MENU_ITEMS.map(({ id, label, icon: ItemIcon, to, href }) => {
        if (id === 'theme') {
          return (
            <button
              key={id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={dark}
              className="tdv2-menu-item"
              onClick={onToggleTheme}
            >
              {dark ? (
                <Sun size={17} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Moon size={17} strokeWidth={1.75} aria-hidden="true" />
              )}
              {dark ? 'Theme: Dark — switch to light' : 'Theme: Light — switch to dark'}
            </button>
          )
        }
        return (
          <button
            key={id}
            type="button"
            role="menuitem"
            className="tdv2-menu-item"
            onClick={() => {
              onClose()
              if (href) window.location.href = href
              else onSelect(to)
            }}
          >
            <ItemIcon size={17} strokeWidth={1.75} aria-hidden="true" />
            {label}
          </button>
        )
      })}
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

export default function Sidebar({
  teacher,
  onRequestLogout,
  dark = false,
  onToggleTheme,
  // One menu for the whole teacher area. TeacherLayout passes the same
  // groups it gives the mobile drawer (plus the admin shortcut), so the
  // desktop panel and the drawer cannot list different things.
  groups = TEACHER_NAV_GROUPS,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // Active state is derived from the route alone (longest match wins), never
  // from click state — so a deep link highlights correctly and nothing stays
  // stuck lit after navigating.
  const isActive = buildActiveMatcher(pathname, groups)

  const closeMenu = useCallback((refocus = true) => {
    setMenuOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

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

      <nav className="tdv2-nav" aria-label="Primary" data-tour="nav">
        {groups.map((group) => (
          <div className="tdv2-nav-group" key={group.id}>
            {group.label ? (
              <div className="tdv2-nav-label" aria-hidden="true">{group.label}</div>
            ) : null}
            {group.items.map(({ id, label, icon: ItemIcon, to, href }) => {
              const active = isActive(to)
              const inner = (
                <>
                  <ItemIcon size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span className="tdv2-nav-text">{label}</span>
                </>
              )
              return href ? (
                <a key={id} href={href} className="tdv2-nav-item">
                  {inner}
                </a>
              ) : (
                <Link
                  key={id}
                  to={to}
                  className={`tdv2-nav-item ${active ? 'is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {inner}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="tdv2-profile-wrap" ref={wrapRef}>
        {menuOpen ? (
          <AccountMenu
            teacher={teacher}
            menuRef={menuRef}
            dark={dark}
            onToggleTheme={onToggleTheme}
            onSelect={(to) => navigate(to)}
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
          <span className="tdv2-avatar" aria-hidden="true">{teacher.initials}</span>
          <span className="tdv2-profile-text" style={{ minWidth: 0 }}>
            <span className="tdv2-profile-name">{teacher.name}</span>
            <br />
            <span className="tdv2-profile-role">{teacher.role}</span>
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
