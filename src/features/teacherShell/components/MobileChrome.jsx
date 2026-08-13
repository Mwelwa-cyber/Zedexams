/**
 * Mobile shell chrome — the teacher app's navigation below 768px.
 *
 * `NavDrawer`, `MobileHeader` and `MobileBottomNav` are SHELL, not dashboard:
 * `TeacherLayout` renders all three on EVERY `/teacher/*` route, whatever page
 * is inside. They lived in `MobileDashboardView.jsx` alongside the dashboard's
 * own mobile content, which made that one file export two layers at once — the
 * shell chrome the layout imports, and the page the router mounts.
 *
 * That is why the standing "a migration is a move" rule was set aside for this
 * area (docs/architecture.md §13): no `git mv` separates two layers that share
 * a file. Splitting them here, in place and before anything moves, is what lets
 * the dashboard PAGE migrate into `src/features/dashboardV2/` while the shell
 * stays next to `TeacherLayout` — so a teacher route does not pull the app
 * launcher, the onboarding tour and Help & Support into its import graph just
 * to draw a bottom bar.
 *
 * The cut was mechanical rather than judged: the two halves referenced NOTHING
 * of each other. `MobileBottomNav -> QuickCreateSheet` is entirely inside this
 * file, and the page half's four components are entirely inside that one.
 *
 * `QuickCreateSheet` stays unexported — `MobileBottomNav` is its only caller,
 * exactly as before.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronUp, CircleHelp, CreditCard, FolderOpen, Home, ListChecks, LogOut, Menu, MessageSquare, Moon, Plus, Settings, Sun, UserRound, UsersRound, X } from 'lucide-react'
import { useNotifications } from '../../../contexts/NotificationContext'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import NotificationCenter from '../../../components/notifications/NotificationCenter'
import BottomSheet from '../../../shared/components/BottomSheet'
import GlassToolTile from '../../../shared/components/GlassToolTile'
import { TEACHER_NAV_GROUPS, canonicalToolLabel } from '../../../shared/constants/dashboardV2Config'
import { buildActiveMatcher } from '../lib/teacherNavActive'
import { confirmShellNavigation } from '../../../shared/utils/shellNavGuardCore'
import { STUDIO_BY_ID } from '../../../shared/constants/teacherStudios'
import useStudioAvailability from '../../../hooks/useStudioAvailability'

const LOGO_WEBP = '/zedexams-logo.webp?v=2'
const LOGO_PNG = '/zedexams-logo.png?v=5'
const BOTTOM_NAV = [
  { id: 'home', label: 'Home', icon: Home, to: '/teacher' },
  // Register opens the Class Register (daily attendance). The studio itself
  // restores the teacher's class — one class opens today's marking directly.
  { id: 'register', label: 'Register', icon: UsersRound, to: '/teacher/attendance' },
  { id: 'library', label: 'Library', icon: FolderOpen, to: '/teacher/library' },
  { id: 'assessments', label: 'Assessments', icon: ListChecks, to: '/teacher/assessment-papers' },
]
/** Quick Create — the four fastest studios; routes are the canonical ones.
    Labels come from CANONICAL_TOOL_LABELS so this sheet cannot call a tool
    something the sidebar doesn't (it used to say "Test Paper").

    Five are declared and four are shown, for the same reason as the desktop
    tiles: Worksheets is withdrawn behind a flag and Homework — the practice
    surface in the meantime — takes the freed slot rather than leaving one. */
const QUICK_CREATE_COUNT = 4
const QUICK_CREATE = [
  { id: 'lesson-plans', to: '/teacher/lesson-plans/new' },
  { id: 'worksheets', to: '/teacher/generate/worksheet' },
  { id: 'assessment-papers', to: '/teacher/assessment-papers/new' },
  { id: 'weekly-focus', to: '/teacher/generate/weekly-forecast' },
  { id: 'homework', to: '/teacher/generate/homework' },
].map((tile) => ({ ...tile, label: canonicalToolLabel(tile.to) }))
const ACCOUNT_ITEMS = [
  { id: 'view-profile', label: 'View profile', icon: UserRound, to: '/settings/profile' },
  { id: 'account-settings', label: 'Account settings', icon: Settings, to: '/settings' },
  { id: 'subscription', label: 'Subscription & billing', icon: CreditCard, to: '/teacher/subscription' },
  { id: 'switch-role', label: 'Switch class or role', icon: UsersRound, to: '/settings/teaching-profile' },
  { id: 'notifications', label: 'Notification preferences', icon: Bell, to: '/settings/notifications' },
  { id: 'help', label: 'Help & Support', icon: CircleHelp, to: '/teacher/help' },
]

export function NavDrawer({
  open,
  onClose,
  teacher,
  dark,
  onToggleTheme,
  onLogout,
  // Same single menu the desktop sidebar renders — TeacherLayout hands both
  // surfaces the identical groups.
  groups = TEACHER_NAV_GROUPS,
}) {
  const [accountOpen, setAccountOpen] = useState(false)
  const panelRef = useRef(null)
  const accountRef = useRef(null)
  const profileRef = useRef(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Scroll-lock the page while the drawer is open.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  useEffect(() => {
    if (!open) {
      setAccountOpen(false)
      return undefined
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (accountOpen) setAccountOpen(false)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, accountOpen, onClose])

  // Account panel closes when tapping elsewhere in the drawer.
  useEffect(() => {
    if (!accountOpen) return undefined
    const onPointer = (e) => {
      if (accountRef.current?.contains(e.target)) return
      if (profileRef.current?.contains(e.target)) return
      setAccountOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [accountOpen])

  const go = (to) => {
    // Same unsaved-marks gate the shell applies to anchor nav; the account items
    // navigate imperatively (buttons), so the capture listener can't see them.
    if (!confirmShellNavigation()) return
    onClose()
    navigate(to)
  }

  // Same resolver the desktop sidebar uses — the drawer used to carry a
  // hand-kept copy of it.
  const isActive = buildActiveMatcher(pathname, groups)

  return (
    <div className={`tdv2m-drawer-root ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="tdv2m-backdrop" onPointerDown={onClose} />
      <div
        className="tdv2m-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        ref={panelRef}
      >
        <div className="tdv2m-drawer-head">
          <span className="tdv2-logo-chip">
            <picture>
              <source type="image/webp" srcSet={LOGO_WEBP} />
              <img src={LOGO_PNG} alt="ZedExams" width={312} height={384} loading="lazy" />
            </picture>
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="tdv2-logo-name">ZedExams</span>
            <br />
            <span className="tdv2-logo-sub">Teacher Dashboard</span>
          </span>
          <button type="button" className="tdv2m-drawer-close" aria-label="Close menu" onClick={onClose}>
            <X size={22} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <nav className="tdv2m-drawer-nav" aria-label="Primary">
          {groups.map((group) => (
            <div key={group.id}>
              {group.label ? (
                <div className="tdv2-nav-label" aria-hidden="true">{group.label}</div>
              ) : null}
              {group.items.map(({ id, label, icon: ItemIcon, to, href }) => {
                if (href) {
                  return (
                    <a key={id} href={href} className="tdv2-nav-item" onClick={onClose}>
                      <ItemIcon size={20} strokeWidth={1.75} aria-hidden="true" />
                      <span className="tdv2-nav-text">{label}</span>
                    </a>
                  )
                }
                const active = isActive(to)
                return (
                  <Link
                    key={id}
                    to={to}
                    onClick={onClose}
                    className={`tdv2-nav-item ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <ItemIcon size={20} strokeWidth={1.75} aria-hidden="true" />
                    <span className="tdv2-nav-text">{label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="tdv2-profile-wrap">
          {accountOpen ? (
            <div className="tdv2-menu tdv2m-account" role="menu" aria-label="Account" ref={accountRef}>
              <div className="tdv2-menu-header">
                <span className="tdv2-avatar" aria-hidden="true">{teacher.initials}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="tdv2-profile-name">{teacher.name}</span>
                  <span className="tdv2-menu-email">{teacher.email}</span>
                </span>
              </div>
              {ACCOUNT_ITEMS.map(({ id, label, icon: ItemIcon, to }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="tdv2-menu-item"
                  onClick={() => go(to)}
                >
                  <ItemIcon size={17} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </button>
              ))}
              <button
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
              <div className="tdv2-menu-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="tdv2-menu-item is-danger"
                onClick={() => {
                  setAccountOpen(false)
                  onClose()
                  onLogout()
                }}
              >
                <LogOut size={17} strokeWidth={1.75} aria-hidden="true" />
                Log out
              </button>
            </div>
          ) : null}
          <button
            type="button"
            ref={profileRef}
            className="tdv2-profile"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((v) => !v)}
          >
            <span className="tdv2-avatar" aria-hidden="true">{teacher.initials}</span>
            <span className="tdv2-profile-text" style={{ minWidth: 0 }}>
              <span className="tdv2-profile-name">{teacher.name}</span>
              <br />
              <span className="tdv2-profile-role">{teacher.role}</span>
            </span>
            <ChevronUp
              size={17}
              strokeWidth={2}
              className="tdv2-profile-chevron"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Compact mobile header — shared by the dashboard, Help & Support and the
 * studio shell. Fully opaque and always visible (sticky): hamburger, logo +
 * wordmark, alerts bell with unread badge, messages shortcut. Content starts
 * below it — it never floats over the page.
 */
export function MobileHeader({ drawerOpen, onOpenMenu }) {
  const { unreadCount, open: notifOpen, setOpen: setNotifOpen } = useNotifications()
  // Auto-hide on scroll, like the learner/runner chrome: slides up on
  // scroll-down, reveals on scroll-up. Stays pinned while the drawer is open.
  const hidden = useHideOnScroll()
  return (
    <>
      <header className={`tdv2m-header tdv2m-autohide ${hidden && !drawerOpen ? 'is-hidden-top' : ''}`}>
        <button
          type="button"
          className="tdv2m-iconbtn"
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={onOpenMenu}
        >
          <Menu size={22} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="tdv2-logo-chip tdv2m-logo">
          <picture>
            <source type="image/webp" srcSet={LOGO_WEBP} />
            <img src={LOGO_PNG} alt="ZedExams" width={312} height={384} />
          </picture>
        </span>
        <span className="tdv2m-title" style={{ minWidth: 0, flex: 1 }}>
          <span className="tdv2m-title-name">ZedExams</span>
          <span className="tdv2m-title-sub">Teacher Dashboard</span>
        </span>
        <button
          type="button"
          className="tdv2m-iconbtn"
          aria-haspopup="dialog"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          onClick={() => setNotifOpen(true)}
        >
          <Bell size={21} strokeWidth={1.75} aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="tdv2-badge-dot" aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
        <Link to="/teacher/help" className="tdv2m-iconbtn tdv2m-help-btn" aria-label="Messages and support">
          <MessageSquare size={21} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </header>
      {notifOpen ? <NotificationCenter /> : null}
    </>
  )
}

/** Quick Create bottom sheet — the four fastest creation flows. */
function QuickCreateSheet({ open, onClose }) {
  const { filterEntries } = useStudioAvailability()
  return (
    <BottomSheet open={open} onClose={onClose} title="Quick Create">
      <div className="tdv2m-qcsheet-grid">
        {filterEntries(QUICK_CREATE).slice(0, QUICK_CREATE_COUNT).map(({ id, label, to }) => {
          const studio = STUDIO_BY_ID[id]
          if (!studio) return null
          return (
            <Link key={id} to={to} className="tdv2m-qcsheet-item" onClick={onClose}>
              {/* No sheen inside the sheet — it remounts on every open, and a
                  sweep replaying each time would break "once per page load".
                  No tile press either: the item card around it already gives
                  the press response, and two nested scales read as jitter. */}
              <GlassToolTile studio={studio} sizeClass="tdv2m-qcsheet-tile" sheen={false} press={false} />
              <span className="tdv2m-qcsheet-label">{label}</span>
            </Link>
          )
        })}
      </div>
    </BottomSheet>
  )
}

/**
 * Floating dock navigation — a dark-teal rounded pill (Home, Register,
 * Library, Assessments) plus a separate circular orange Quick Create
 * button. Shared by the dashboard, Help & Support and the studio shell;
 * < 768px only (the ≥768px CSS rule removes it from layout entirely).
 */
export function MobileBottomNav() {
  const { pathname } = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  // Matches the header: slides down on scroll-down, reveals on scroll-up.
  const hidden = useHideOnScroll()
  return (
    <>
      <div
        className={`tdv2m-dockbar tdv2m-autohide ${hidden && !createOpen ? 'is-hidden-bottom' : ''}`}
        data-tour="nav"
      >
        <nav className="tdv2m-dock" aria-label="Quick navigation">
          {BOTTOM_NAV.map(({ id, label, icon: NavIcon, to }) => {
            const active =
              to === '/teacher'
                ? pathname === '/teacher' || pathname === '/teacher/dashboard-preview'
                : pathname === to || pathname.startsWith(`${to}/`)
            return (
              <Link
                key={id}
                to={to}
                className={`tdv2m-dock-item ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <NavIcon size={22} strokeWidth={1.75} aria-hidden="true" />
                <span className="tdv2m-dock-label">{label}</span>
              </Link>
            )
          })}
        </nav>
        <button
          type="button"
          className="tdv2m-dock-plus"
          aria-label="Quick create"
          aria-haspopup="dialog"
          aria-expanded={createOpen}
          data-tour="quick-create"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={28} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      <QuickCreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}

/**
 * Deep-teal hero: greeting, school, term progress and teaching days left,
 * with the open-book illustration and the subscription badge pinned near
 * its lower-right corner.
 */
