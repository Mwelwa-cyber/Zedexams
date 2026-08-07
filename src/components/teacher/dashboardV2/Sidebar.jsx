import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  CircleHelp,
  CreditCard,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { TEACHER_NAV_GROUPS } from './dashboardV2Config'
import { buildActiveMatcher } from './teacherNavActive'
import { confirmShellNavigation } from '../register/shellNavGuardCore'

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
  // Collapsed = the icon rail. Owned by TeacherLayout (useSidebarCollapsed)
  // because the shell column has to shrink with the panel; the sidebar itself
  // stays presentational about it.
  collapsed = false,
  onToggleCollapse,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  // The collapsed rail's hover/focus tooltip. One at a time, positioned from
  // the hovered item's own rect: .tdv2-nav scrolls, so a tooltip parented to
  // the item would be clipped by its overflow — this one is position:fixed.
  const [tip, setTip] = useState(null)
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

  const hideTip = useCallback(() => setTip(null), [])
  const showTip = useCallback((el, label) => {
    const rect = el?.getBoundingClientRect?.()
    if (!rect) return
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 })
  }, [])

  // Expanding must not leave a rail tooltip painted over the labels it was
  // standing in for.
  useEffect(() => { setTip(null) }, [collapsed])

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

  // Hover/focus handlers only exist on the rail: expanded items already show
  // their name, and a tooltip repeating a visible label is noise.
  const tipHandlers = (label) => (collapsed
    ? {
      onMouseEnter: (e) => showTip(e.currentTarget, label),
      onMouseLeave: hideTip,
      onFocus: (e) => showTip(e.currentTarget, label),
      onBlur: hideTip,
    }
    : null)

  return (
    <aside
      className={`tdv2-sidebar ${collapsed ? 'is-collapsed' : 'is-expanded'}`}
      aria-label="Teacher navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
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
        {onToggleCollapse ? (
          <button
            type="button"
            className="tdv2-sidebar-toggle"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-controls="tdv2-primary-nav"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      <nav
        className="tdv2-nav"
        id="tdv2-primary-nav"
        aria-label="Primary"
        data-tour="nav"
        // The tooltip is placed from a rect read at hover time, so a scroll
        // underneath it would leave it pointing at the wrong item.
        onScroll={collapsed ? hideTip : undefined}
      >
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
                  {/* Collapsed, this span is visually hidden rather than
                      removed — an icon-only link still has to have a name in
                      the accessibility tree. */}
                  <span className="tdv2-nav-text">{label}</span>
                </>
              )
              return href ? (
                <a key={id} href={href} className="tdv2-nav-item" {...tipHandlers(label)}>
                  {inner}
                </a>
              ) : (
                <Link
                  key={id}
                  to={to}
                  className={`tdv2-nav-item ${active ? 'is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  {...tipHandlers(label)}
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
            onSelect={(to) => { if (confirmShellNavigation()) navigate(to) }}
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
          aria-label={collapsed ? `${teacher.name} — account menu` : undefined}
          onClick={() => setMenuOpen((v) => !v)}
          {...tipHandlers(teacher.name)}
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

      {/* Purely visual: the item it names is already reachable by its own
          accessible name, so announcing it twice would only add noise. */}
      {collapsed && tip ? (
        <div
          className="tdv2-nav-tip"
          aria-hidden="true"
          style={{ top: `${tip.top}px`, left: `${tip.left}px` }}
        >
          {tip.label}
        </div>
      ) : null}
    </aside>
  )
}
