// Learner Settings — redesigned, mobile-first settings experience.
//
// A single-page app-like surface (not a form dump): a hero with a live profile
// completion ring, a search box, a sidebar/tab nav that remembers the last
// section, animated section transitions, and a sticky autosave bar with
// Saving / Saved / Undo. Everything is theme-aware (inherits the learner's
// chosen ZedExams theme via the .lset-* / theme custom properties).
//
// Panels are React.lazy so opening Settings only downloads the shell; each
// section's code loads on first visit.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import SeoHelmet from '../../components/seo/SeoHelmet'
import Icon from '../../components/ui/Icon'
import {
  Search,
  XMarkIcon,
  Sparkles,
  ShieldCheck,
} from '../../components/ui/icons'
import CharacterAvatar from '../../components/profile/CharacterAvatar'
import PageLoader from '../../components/ui/PageLoader'
import { SettingsSaveProvider, useSettingsSave } from './components/SaveContext'
import { LEARNER_SETTINGS_SECTIONS, SECTION_IDS, searchSections, getSection } from './sections'
import {
  computeProfileCompletion,
  computeSecurityStrength,
  normalizePersonalisation,
  readLastSection,
  writeLastSection,
} from './lib/learnerPrefs'
import './learnerSettings.css'

const PANELS = {
  profile: lazy(() => import('./panels/ProfilePanel')),
  security: lazy(() => import('./panels/SecurityPanel')),
  notifications: lazy(() => import('./panels/NotificationsPanel')),
  learning: lazy(() => import('./panels/LearningPanel')),
  accessibility: lazy(() => import('./panels/AccessibilityPanel')),
  parent: lazy(() => import('./panels/ParentPanel')),
  account: lazy(() => import('./panels/AccountPanel')),
  dashboard: lazy(() => import('./panels/DashboardPanel')),
  personalisation: lazy(() => import('./panels/PersonalisationPanel')),
  'zed-ai': lazy(() => import('./panels/ZedAiPanel')),
  privacy: lazy(() => import('./panels/PrivacyPanel')),
}

/* ── Hero completion ring ─────────────────────────────────────── */
function CompletionRing({ percent }) {
  const size = 66
  const stroke = 7
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (percent / 100) * c
  return (
    <div className="lset-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="lset-ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="lset-ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="lset-ring__label">
        <div>
          <div className="lset-ring__pct">{percent}%</div>
          <div className="lset-ring__cap">DONE</div>
        </div>
      </div>
    </div>
  )
}

/* ── Sticky autosave status bar ───────────────────────────────── */
function SaveBar() {
  const { status, canUndo, saveNow, undo } = useSettingsSave()
  if (status === 'idle') return null
  const text = {
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: "Couldn't save — check your connection",
  }[status]
  return (
    <div className="lset-savebar" role="status" aria-live="polite">
      <span className={`lset-savebar__status lset-savebar__status--${status}`}>
        <span className={`lset-savedot${status === 'saving' ? ' lset-savedot--spin' : ''}`} />
        {text}
      </span>
      {canUndo && status !== 'saving' && (
        <button type="button" className="lset-btn lset-btn--ghost lset-btn--sm" onClick={undo}>
          Undo
        </button>
      )}
      {(status === 'dirty' || status === 'error') && (
        <button type="button" className="lset-btn lset-btn--sm" onClick={saveNow}>
          {status === 'error' ? 'Retry' : 'Save now'}
        </button>
      )}
    </div>
  )
}

/* ── Nav (sidebar + mobile tabs) ──────────────────────────────── */
function NavItem({ section, active, onClick, kind }) {
  const cls = kind === 'tab'
    ? `lset-tab${active ? ' lset-tab--on' : ''}`
    : `lset-nav__item${active ? ' lset-nav__item--on' : ''}`
  return (
    <button type="button" className={cls} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {kind === 'tab'
        ? <Icon as={section.icon} size="sm" strokeWidth={2.1} />
        : <span className={`lset-badge lset-badge--${section.tone}`}><Icon as={section.icon} size="sm" strokeWidth={2.1} /></span>}
      <span className="lset-nav__label">{section.label}</span>
    </button>
  )
}

/* ── Inner shell (inside the save provider) ───────────────────── */
function LearnerSettingsInner() {
  const { userProfile, currentUser } = useAuth()
  const { tierLabel, isPremium } = useSubscription()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Active section: ?section= → remembered → first.
  const requested = searchParams.get('section')
  const initial = SECTION_IDS.includes(requested)
    ? requested
    : (SECTION_IDS.includes(readLastSection()) ? readLastSection() : SECTION_IDS[0])
  const [active, setActive] = useState(initial)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const contentRef = useRef(null)

  const pushToast = useCallback((kind, message) => {
    setToast({ kind, message, key: Math.random().toString(36).slice(2) })
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const goto = useCallback((id) => {
    setActive(id)
    setQuery('')
    writeLastSection(id)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('section', id)
      return next
    }, { replace: true })
    // Scroll the content into view on mobile where nav is above content.
    if (typeof window !== 'undefined' && window.innerWidth <= 860) {
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [setSearchParams])

  useEffect(() => { writeLastSection(active) }, [active])

  const personalisation = useMemo(
    () => normalizePersonalisation(userProfile?.learnerSettings?.personalisation),
    [userProfile?.learnerSettings?.personalisation],
  )
  const completion = useMemo(() => computeProfileCompletion(userProfile), [userProfile])
  const strength = useMemo(
    () => computeSecurityStrength({
      security: userProfile?.learnerSettings?.security,
      emailVerified: currentUser?.emailVerified,
      hasPassword: true,
    }),
    [userProfile?.learnerSettings?.security, currentUser?.emailVerified],
  )

  const results = useMemo(() => searchSections(query), [query])
  const activeSection = getSection(active)
  const ActivePanel = PANELS[active]

  const name = userProfile?.displayName || 'Learner'
  const initials = name.slice(0, 2).toUpperCase()
  const photoUrl = userProfile?.avatarPhotoUrl
  const avatarChar = userProfile?.avatarCharacter

  return (
    <div
      className="lset"
      data-accent={personalisation.accent}
      data-card-style={personalisation.cardStyle}
      data-nav={personalisation.navStyle}
    >
      <SeoHelmet title="Settings" path="/settings" noIndex />

      {/* Hero */}
      <div className="lset-hero">
        <div className="lset-hero__avatar">
          {photoUrl
            ? <img src={photoUrl} alt="" />
            : avatarChar
              ? <CharacterAvatar characterId={avatarChar} className="w-full h-full" />
              : initials}
        </div>
        <div className="lset-hero__info">
          <h1 className="lset-hero__name">{name}</h1>
          <p className="lset-hero__sub">{currentUser?.email}</p>
          <div className="lset-hero__chips">
            <span className="lset-hero__chip">
              <Icon as={Sparkles} size="xs" strokeWidth={2.2} /> {isPremium ? tierLabel : 'Free plan'}
            </span>
            <span className="lset-hero__chip">
              <Icon as={ShieldCheck} size="xs" strokeWidth={2.2} /> {strength.emoji} {strength.label}
            </span>
            {userProfile?.grade && <span className="lset-hero__chip">Grade {userProfile.grade}</span>}
          </div>
        </div>
        <CompletionRing percent={completion.percent} />
      </div>

      {/* Search */}
      <div className="lset-search">
        <span className="lset-search__icon"><Icon as={Search} size="sm" strokeWidth={2} /></span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings…"
          aria-label="Search settings"
        />
        {query && (
          <button type="button" className="lset-search__clear" onClick={() => setQuery('')} aria-label="Clear search">
            <Icon as={XMarkIcon} size="sm" strokeWidth={2.2} />
          </button>
        )}
      </div>

      {/* Search results (replace the layout while searching) */}
      {query ? (
        <div className="lset-results">
          {results.length === 0 && (
            <div className="lset-results__empty">No settings match “{query}”.</div>
          )}
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              className="lset-nav__item"
              style={{ background: 'var(--card)', border: '1.5px solid var(--border)' }}
              onClick={() => goto(s.id)}
            >
              <span className={`lset-badge lset-badge--${s.tone}`}><Icon as={s.icon} size="sm" strokeWidth={2.1} /></span>
              <span className="lset-nav__label">
                <span style={{ display: 'block', fontWeight: 700 }}>{s.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{s.desc}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="lset-body">
          {/* Mobile tab strip */}
          <div className="lset-tabs" role="tablist" aria-label="Settings sections">
            {LEARNER_SETTINGS_SECTIONS.map((s) => (
              <NavItem key={s.id} section={s} kind="tab" active={active === s.id} onClick={() => goto(s.id)} />
            ))}
          </div>

          {/* Desktop sidebar */}
          <nav className="lset-nav" aria-label="Settings sections">
            {LEARNER_SETTINGS_SECTIONS.map((s) => (
              <NavItem key={s.id} section={s} active={active === s.id} onClick={() => goto(s.id)} />
            ))}
          </nav>

          {/* Content */}
          <div className="lset-content" ref={contentRef}>
            <Suspense fallback={<PageLoader />}>
              {ActivePanel && <ActivePanel key={active} section={activeSection} pushToast={pushToast} navigate={navigate} />}
            </Suspense>
          </div>
        </div>
      )}

      <SaveBar />

      {toast && (
        <div className={`lset-toast lset-toast--${toast.kind}`} role="status">{toast.message}</div>
      )}
    </div>
  )
}

export default function LearnerSettings() {
  return (
    <SettingsSaveProvider>
      <LearnerSettingsInner />
    </SettingsSaveProvider>
  )
}
