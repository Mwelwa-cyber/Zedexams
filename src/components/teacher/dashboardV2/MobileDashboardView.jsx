import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Bell,
  BookOpen,
  ChevronUp,
  CircleHelp,
  CreditCard,
  FolderOpen,
  Home,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Search,
  Settings,
  Sun,
  Sunset,
  Users,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { useNotifications } from '../../../contexts/NotificationContext'
import NotificationCenter from '../../notifications/NotificationCenter'
import CopperButton from './CopperButton'
import AiRecommendationsCard from './AiRecommendationsCard'
import TeacherAppLauncher from './launcher/TeacherAppLauncher'
import { ChecklistCard, FeedStatusCard, RecentActivityCard } from './InsightCards'
import PerformanceSnapshotCard from './PerformanceSnapshotCard'
import { NAV_GROUPS, QUICK_CREATE_TILES } from './dashboardV2Config'
// Small notebook illustration, upper-right of the hero (hidden < 350px)
import heroDesk from '../../../assets/teacher/hero-desk.webp'

const LOGO_WEBP = '/zedexams-logo.webp?v=2'
const LOGO_PNG = '/zedexams-logo.png?v=5'

const PART_ICON = { morning: Sun, afternoon: Sun, evening: Moon }

const BOTTOM_NAV = [
  { id: 'home', label: 'Home', icon: Home, to: '/teacher' },
  { id: 'classes', label: 'My Class', icon: Users, to: '/teacher/classes' },
  { id: 'library', label: 'Library', icon: FolderOpen, to: '/teacher/library' },
  { id: 'assessments', label: 'Assessments', icon: ListChecks, to: '/teacher/assessment-papers' },
]

const ACCOUNT_ITEMS = [
  { id: 'view-profile', label: 'View profile', icon: UserRound, to: '/settings/profile' },
  { id: 'account-settings', label: 'Account settings', icon: Settings, to: '/settings' },
  { id: 'subscription', label: 'Subscription & billing', icon: CreditCard, to: '/my-subscription' },
  { id: 'switch-role', label: 'Switch class or role', icon: UsersRound, to: '/settings/teaching-profile' },
  { id: 'notifications', label: 'Notification preferences', icon: Bell, to: '/settings/notifications' },
  { id: 'help', label: 'Help & Support', icon: CircleHelp, to: '/teacher/help' },
]

function sublineFor(lastOpened) {
  if (!lastOpened?.subject) return 'Here’s what’s happening with your teaching.'
  const days = lastOpened.agoDays
  if (!Number.isFinite(days)) return 'Here’s what’s happening with your teaching.'
  if (days <= 0) return `You worked on ${lastOpened.subject} today. Keep it up!`
  return `${lastOpened.subject} hasn’t been updated for ${days} day${days === 1 ? '' : 's'}.`
}

/**
 * Slide-out navigation drawer: nav groups, then a profile card whose tap
 * opens the account panel above it (Theme toggle + Log out inside).
 * Closes on X, backdrop tap, Escape, or selecting any destination; the page
 * behind cannot scroll while it is open.
 */
export function NavDrawer({
  open,
  onClose,
  teacher,
  dark,
  onToggleTheme,
  onLogout,
  // Dashboard/help use the curated groups; the studio shell (TeacherLayout)
  // passes STUDIO_NAV_GROUPS for the full teacher map.
  groups = NAV_GROUPS,
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
    onClose()
    navigate(to)
  }

  // `activePrefix` widens matching for items pointing at one page of a route
  // family (mirrors isNavActive in Sidebar.jsx).
  const isActive = (to, activePrefix) => {
    if (activePrefix && (pathname === activePrefix || pathname.startsWith(`${activePrefix}/`))) {
      return true
    }
    const path = to.split('?')[0]
    if (path === '/teacher') {
      return pathname === '/teacher' || pathname === '/teacher/dashboard-preview'
    }
    if (path === '/settings') return pathname === '/settings'
    return pathname === path || pathname.startsWith(`${path}/`)
  }

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
              {group.items.map(({ id, label, icon: ItemIcon, to, href, activePrefix }) => {
                if (href) {
                  return (
                    <a key={id} href={href} className="tdv2-nav-item" onClick={onClose}>
                      <ItemIcon size={20} strokeWidth={1.75} aria-hidden="true" />
                      <span className="tdv2-nav-text">{label}</span>
                    </a>
                  )
                }
                const active = isActive(to, activePrefix)
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

/** Compact mobile header — shared by the dashboard and Help & Support. */
export function MobileHeader({ drawerOpen, onOpenMenu }) {
  const { unreadCount, open: notifOpen, setOpen: setNotifOpen } = useNotifications()
  return (
    <>
      <header className="tdv2m-header">
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
        <Link to="/teacher/help" className="tdv2m-iconbtn tdv2m-help-btn" aria-label="Help and support">
          <MessageSquare size={21} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </header>
      {notifOpen ? <NotificationCenter /> : null}
    </>
  )
}

/** Fixed bottom navigation — shared by the dashboard and Help & Support. */
export function MobileBottomNav({ drawerOpen, onMore }) {
  const { pathname } = useLocation()
  return (
    <nav className="tdv2m-bottomnav" aria-label="Quick navigation" data-tour="nav">
      {BOTTOM_NAV.map(({ id, label, icon: NavIcon, to }) => {
        const active =
          to === '/teacher'
            ? pathname === '/teacher' || pathname === '/teacher/dashboard-preview'
            : pathname === to || pathname.startsWith(`${to}/`)
        return (
          <Link
            key={id}
            to={to}
            className={`tdv2m-bn-item ${active ? 'is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <NavIcon size={22} strokeWidth={1.75} aria-hidden="true" />
            <span className="tdv2m-bn-label">{label}</span>
          </Link>
        )
      })}
      <button
        type="button"
        className="tdv2m-bn-item"
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
        onClick={onMore}
      >
        <MoreHorizontal size={22} strokeWidth={1.75} aria-hidden="true" />
        <span className="tdv2m-bn-label">More</span>
      </button>
    </nav>
  )
}

/**
 * Dedicated MOBILE information architecture for Dashboard V2 (< 768px) —
 * its own header, drawer, single-column sections, and fixed bottom nav.
 * Never renders the desktop sidebar. Same props contract as the desktop
 * layout inside DashboardView, so live data and the mock preview both flow
 * through unchanged.
 */
export default function MobileDashboardView({
  teacher,
  greeting,
  lastOpened,
  ctaState = 'default',
  onContinue,
  recommendations,
  savedCounts = null,
  launcherWarnings = [],
  checklist,
  feed,
  activity,
  series,
  classPerformance = null,
  loading = false,
  onRetryFeed,
  dark = false,
  onToggleTheme,
  onRequestLogout,
  showToast,
  banner = null,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const PartIcon = PART_ICON[greeting.part] || Sunset

  const submitSearch = (e) => {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `/teacher/library?q=${encodeURIComponent(q)}` : '/teacher/library')
  }

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  return (
    <div className="tdv2m">
      <MobileHeader drawerOpen={drawerOpen} onOpenMenu={() => setDrawerOpen(true)} />

      <main className="tdv2m-content">
        {banner}

        <form className="tdv2-search tdv2m-search" onSubmit={submitSearch}>
          <Search size={19} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lessons, notes, tests…"
            aria-label="Search your library"
          />
        </form>

        <section className="tdv2m-hero" aria-label="Greeting" data-tour="hero">
          <img className="tdv2m-hero-art" src={heroDesk} alt="" aria-hidden="true" loading="lazy" />
          <span className="tdv2-hero-eyebrow">
            <span className="tdv2-hero-sun" aria-hidden="true">
              <PartIcon size={16} strokeWidth={2} />
            </span>
            {greeting.label},
          </span>
          <h1 className="tdv2m-hero-name">{greeting.name}</h1>
          <p className="tdv2m-hero-sub">{sublineFor(lastOpened)}</p>

          <div className="tdv2m-inset">
            <div className="tdv2m-inset-row">
              <span className="tdv2-hero-inset-icon" aria-hidden="true">
                <BookOpen size={22} strokeWidth={1.75} />
              </span>
              {lastOpened ? (
                <span style={{ minWidth: 0 }}>
                  <span className="tdv2-hero-inset-label">Last opened</span>
                  <br />
                  <span className="tdv2-hero-inset-title">{lastOpened.subject}</span>
                  <br />
                  <span className="tdv2-hero-inset-meta">
                    {[lastOpened.grade, lastOpened.ago].filter(Boolean).join(' • ')}
                  </span>
                </span>
              ) : (
                <span style={{ minWidth: 0 }}>
                  <span className="tdv2-hero-inset-label">Get started</span>
                  <br />
                  <span className="tdv2-hero-inset-title">Create your first document</span>
                  <br />
                  <span className="tdv2-hero-inset-meta">Plan a lesson in a few minutes</span>
                </span>
              )}
            </div>
            <CopperButton state={ctaState} onClick={onContinue} className="tdv2m-cta">
              {lastOpened ? 'Continue plan' : 'Start planning'}
            </CopperButton>
          </div>
        </section>

        <section aria-labelledby="tdv2m-qc-h" data-tour="quick-create">
          <div className="tdv2m-section-head">
            <h2 className="tdv2-eyebrow" id="tdv2m-qc-h">Quick Create</h2>
            <Link className="tdv2-link-action" to="/teacher/library">
              View all
              <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
          <div className="tdv2m-qc-grid">
            {QUICK_CREATE_TILES.map(({ id, title, description, icon: TileIcon, to, tone }) => (
              <Link key={id} to={to} className="tdv2-tile tdv2m-tile">
                <span className={`tdv2-tile-icon tone-${tone}`} aria-hidden="true">
                  <TileIcon size={22} strokeWidth={1.75} />
                </span>
                <span className="tdv2-tile-title">{title}</span>
                <span className="tdv2-tile-desc">{description}</span>
                <span className="tdv2-tile-arrow" aria-hidden="true">
                  <ArrowRight size={15} strokeWidth={2} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <AiRecommendationsCard recommendations={recommendations} />

        <TeacherAppLauncher savedCounts={savedCounts} warnings={launcherWarnings} loading={loading} />

        <ChecklistCard items={checklist} loading={loading} />
        <FeedStatusCard items={feed} onRetry={() => onRetryFeed?.({ showToast })} />
        <RecentActivityCard items={activity} />
        <PerformanceSnapshotCard series={series} classPerformance={classPerformance} dark={dark} />
      </main>

      <MobileBottomNav drawerOpen={drawerOpen} onMore={() => setDrawerOpen(true)} />

      <NavDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        teacher={teacher}
        dark={dark}
        onToggleTheme={onToggleTheme}
        onLogout={onRequestLogout}
      />
    </div>
  )
}
