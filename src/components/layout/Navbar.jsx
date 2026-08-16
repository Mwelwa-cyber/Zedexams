import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  Home,
  BookOpen,
  FileText,
  Files,
  PencilLine,
  BarChart3,
  GraduationCap,
  Settings,
  ShieldCheck,
  TrophyIcon,
  Menu,
  X,
  LogOut,
  Sparkles,
  Search,
} from '../../shared/components/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../../shared/components/Logo'
import Icon from '../../shared/components/Icon'
import CharacterAvatar from '../../shared/components/CharacterAvatar'
import { NotificationBell } from '../../features/notifications'
import MobileBottomNav from '../../shared/components/MobileBottomNav'
import useHideOnScroll from '../../hooks/useHideOnScroll'

export default function Navbar() {
  const { userProfile, logout, isAdmin, isTeacher } = useAuth()
  const { accessBadge } = useSubscription()
  const [open, setOpen] = useState(false)
  // LinkedIn-style: hide the header on scroll-down for full-screen reading.
  // Keep it pinned while the mobile drawer is open so the menu stays reachable.
  const scrolledHidden = useHideOnScroll()
  const headerHidden = scrolledHidden && !open
  const navigate = useNavigate()
  const homePath = getRoleLandingPath(userProfile)
  // Admins and teachers already see dedicated "Admin"/"Teacher" links below
  // that point to their role home — adding a "Home" link here would duplicate them.
  // Learners get a "Home" link that points to /dashboard.
  // Learner primary nav. Daily Exams is a top-level learner surface
  // (not just a card on the dashboard) so we expose it here too. Admins
  // and teachers see their dedicated portal link below instead of a
  // "Home" item since the homePath would just duplicate that link.
  // Aligned to the prototype-v3 4-tab IA (step 5 — Learn/Practice retired):
  // the four tabs lead, then the destinations this chrome is the only door
  // to on self-chromed pages (quizzes, daily exams, results). "Practise"
  // became "Quizzes" so the retired tab's name doesn't live on here.
  const learnerLinks = [
    { to: homePath,      label: 'Home',     icon: Home },
    { to: '/papers',     label: 'Papers',   icon: Files },
    { to: '/notes',      label: 'Notes',    icon: FileText },
    { to: '/games',      label: 'Games',    icon: Sparkles },
    { to: '/lessons',    label: 'Lessons',  icon: BookOpen },
    { to: '/quizzes',    label: 'Quizzes',  icon: PencilLine },
    { to: '/exams',      label: 'Exams',    icon: TrophyIcon },
    { to: '/my-results', label: 'Results',  icon: BarChart3 },
  ]
  const staffLinks = [
    { to: '/notes',      label: 'Notes',    icon: FileText },
    { to: '/lessons',    label: 'Lessons',  icon: BookOpen },
    { to: '/quizzes',    label: 'Practise', icon: PencilLine },
    { to: '/my-results', label: 'Results',  icon: BarChart3 },
  ]
  const navLinks = (!isAdmin && !isTeacher) ? learnerLinks : staffLinks

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const initials = (userProfile?.displayName || 'U')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const avatarCharacterId = userProfile?.avatarCharacter || null

  // Avatar = chosen character (if any) inside a circular crop, else initials.
  // Sized by the parent's h-/w- classes so all three nav slots stay in sync
  // with the existing layout.
  const renderAvatar = (sizeClasses) => (
    <div
      className={`${sizeClasses} flex-shrink-0 overflow-hidden rounded-full ${
        avatarCharacterId
          ? 'theme-bg-subtle theme-border border'
          : 'theme-accent-fill theme-on-accent flex items-center justify-center text-xs font-black shadow-elev-inner-hl'
      }`}
    >
      {avatarCharacterId
        ? <CharacterAvatar characterId={avatarCharacterId} className="w-full h-full" />
        : initials}
    </div>
  )

  const badgeColors = {
    green:  'theme-accent-bg theme-accent-text theme-border',
    blue:   'theme-accent-bg theme-accent-text theme-border',
    yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    gray:   'theme-bg-subtle theme-text-muted theme-border',
  }
  const badgeClass = badgeColors[accessBadge.color] ?? badgeColors.gray

  // Shared link styles — extracted so desktop and mobile renders stay in sync.
  // Desktop active link gets a 2-px accent underline so the current section
  // reads at a glance without leaning solely on the tinted background.
  // Below xl there isn't room for inline icon+text, but icon-only links left
  // learners guessing what each glyph meant — so the links stack a tiny label
  // under the icon instead of hiding it, and switch to the inline row at xl+.
  const linkClass = ({ isActive }) =>
    `relative flex flex-col xl:flex-row items-center gap-1 xl:gap-1.5 px-1.5 xl:px-2.5 2xl:px-3 py-1.5 rounded-[10px] text-[11px] xl:text-sm font-bold transition-all duration-fast ease-out ${
      isActive
        ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl after:absolute after:left-3 after:right-3 after:-bottom-[2px] after:h-[2px] after:rounded-full after:theme-accent-fill'
        : 'theme-text-muted hover:theme-bg-subtle hover:theme-text'
    }`
  // The label under/next to each desktop link icon — never hidden.
  const linkLabelClass = 'leading-none xl:leading-normal'
  const mobileLinkClass = ({ isActive }) =>
    `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors animate-slide-in-soft ${
      isActive ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl pl-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:theme-accent-fill' : 'theme-text hover:theme-bg-subtle'
    }`

  return (
    <>
    <nav className={`zx-glass-nav safe-top sticky top-0 z-40 zx-nav-autohide ${headerHidden ? 'zx-nav-hidden-top' : ''}`}>
      <div className="max-w-5xl mx-auto px-4 h-20 flex items-center justify-between gap-4">

        {/* Logo (glass pill) */}
        <Link to={homePath} className="zx-logo-pill flex-shrink-0">
          <Logo variant="full" size="md" />
        </Link>

        {/* Desktop nav links. Inline icon+text needs more width than exists
            between lg and xl (logo + links + search/bell/badge/profile/logout
            overflowed the glass bar), but pure icons were unreadable — so on
            those widths each link stacks an 11px label under a 24px icon
            (the 20px icon + 10px label read too small on tablets), and the
            row layout with full-size labels returns at xl+, where the icon
            drops back to 20px so it sits on the text baseline. */}
        <div className="hidden lg:flex items-center gap-1 flex-1 justify-center">
          {navLinks.map(l => (
            <NavLink key={l.to} to={l.to} className={linkClass} title={l.label} aria-label={l.label}>
              <Icon as={l.icon} size="lg" className="xl:h-5 xl:w-5" />
              <span className={linkLabelClass}>{l.label}</span>
            </NavLink>
          ))}
          {(isTeacher && !isAdmin) && (
            <NavLink to="/teacher" className={linkClass} title="Teacher" aria-label="Teacher">
              <Icon as={GraduationCap} size="lg" className="xl:h-5 xl:w-5" />
              <span className={linkLabelClass}>Teacher</span>
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={linkClass} title="Admin" aria-label="Admin">
              <Icon as={ShieldCheck} size="lg" className="xl:h-5 xl:w-5" />
              <span className={linkLabelClass}>Admin</span>
            </NavLink>
          )}
          <NavLink to="/settings" className={linkClass} title="Settings" aria-label="Settings">
            <Icon as={Settings} size="lg" className="xl:h-5 xl:w-5" />
            <span className={linkLabelClass}>Settings</span>
          </NavLink>
        </div>

        {/* Right side — desktop */}
        <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
          {(!isAdmin && !isTeacher) && (
            <Link
              to="/search"
              aria-label="Search quizzes, notes, papers and games"
              title="Search"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg theme-text-muted transition-colors hover:theme-bg-subtle hover:theme-text"
            >
              <Icon as={Search} size="md" strokeWidth={2.1} />
            </Link>
          )}
          {userProfile && <NotificationBell />}
          {/* Access badge */}
          <span className={`inline-flex items-center gap-1 font-black text-xs px-2.5 py-1 rounded-full border ${badgeClass}`}>
            <Icon as={Sparkles} size="xs" strokeWidth={2.1} /> {accessBadge.label}
          </span>

          <div className="flex items-center gap-2 pl-2 border-l theme-border">
            <Link
              to="/profile"
              aria-label="Open your profile"
              className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:theme-bg-subtle"
            >
              {renderAvatar('h-8 w-8')}
              {/* Name + role need ~150px; below 2xl that width tips the bar
                  into overflow, so the avatar (with tooltip) carries identity. */}
              <div className="text-right hidden 2xl:block" title={userProfile?.displayName ?? 'User'}>
                <p className="theme-text font-black text-xs leading-tight truncate max-w-[140px]">
                  {userProfile?.displayName ?? 'User'}
                </p>
                <p className="theme-text-muted text-xs capitalize">{userProfile?.role ?? 'learner'}</p>
              </div>
            </Link>
            <button
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-danger hover:bg-danger-subtle px-3 py-1.5 rounded-lg transition-colors min-h-0"
            >
              <Icon as={LogOut} size="xs" />
              <span className="hidden 2xl:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Mobile right — search + bell + avatar + hamburger */}
        <div className="flex lg:hidden items-center gap-2">
          {(!isAdmin && !isTeacher) && (
            <Link
              to="/search"
              aria-label="Search quizzes, notes, papers and games"
              title="Search"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg theme-text-muted transition-colors hover:theme-bg-subtle"
            >
              <Icon as={Search} size="md" strokeWidth={2.1} />
            </Link>
          )}
          {/* withPanel={false}: the desktop bell above already owns the
              portaled Notification Center — a second mount would stack two
              identical overlays on <body>. */}
          {userProfile && <NotificationBell withPanel={false} />}
          <Link
            to="/profile"
            aria-label="Open your profile"
            className="rounded-full p-0.5 transition-colors hover:theme-bg-subtle"
          >
            {renderAvatar('h-7 w-7')}
          </Link>
          <button
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={open}
            className="w-9 h-9 flex items-center justify-center theme-text-muted hover:theme-bg-subtle rounded-lg transition-colors min-h-0 bg-transparent shadow-none"
          >
            <Icon as={open ? X : Menu} size="md" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden border-t theme-border theme-card shadow-elev-lg animate-slide-up max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain">
          <div className="max-w-5xl mx-auto px-4 py-3 pb-24">
            {/* User info — also a shortcut into the profile page */}
            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 py-3 mb-2 border-b theme-border rounded-xl px-1 transition-colors hover:theme-bg-subtle"
            >
              {renderAvatar('h-10 w-10')}
              <div>
                <p className="font-black theme-text text-sm">{userProfile?.displayName ?? 'User'}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <p className="theme-text-muted text-xs capitalize">{userProfile?.role ?? 'learner'}</p>
                  {userProfile?.grade && <p className="theme-text-muted text-xs">· Grade {userProfile.grade}</p>}
                  <span className={`inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full border ${badgeClass}`}>
                    <Icon as={Sparkles} size="xs" strokeWidth={2.1} /> {accessBadge.label}
                  </span>
                </div>
              </div>
            </Link>

            {/* Nav links — staggered entrance from the .stagger helper in index.css */}
            <div className="space-y-0.5 stagger">
              {navLinks.map(l => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className={mobileLinkClass}
                >
                  <Icon as={l.icon} size="md" className="w-6" />
                  {l.label}
                </NavLink>
              ))}
              {(isTeacher && !isAdmin) && (
                <NavLink to="/teacher" onClick={() => setOpen(false)} className={mobileLinkClass}>
                  <Icon as={GraduationCap} size="md" className="w-6" />
                  Teacher
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin" onClick={() => setOpen(false)} className={mobileLinkClass}>
                  <Icon as={ShieldCheck} size="md" className="w-6" />
                  Admin Panel
                </NavLink>
              )}
              <NavLink to="/settings" onClick={() => setOpen(false)} className={mobileLinkClass}>
                <Icon as={Settings} size="md" className="w-6" />
                Settings
              </NavLink>
            </div>

            <div className="mt-3 pt-3 border-t theme-border">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-danger hover:bg-danger-subtle transition-colors min-h-0"
              >
                <Icon as={LogOut} size="md" className="w-6" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
    <MobileBottomNav />
    </>
  )
}
