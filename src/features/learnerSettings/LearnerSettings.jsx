// Learner Settings — a premium, mobile-first overview dashboard.
//
// The landing is a single scrolling grid of summary cards (My Account, Learning,
// Progress, Notifications, Appearance, Accessibility, AI, Premium, Security,
// Help). A descriptive left rail scroll-spies the cards and offers search; each
// card drills into a full detail panel (?section=<id>) reachable via its
// "Manage all / More" links. Everything is theme-aware (inherits the learner's
// ZedExams theme + dark mode) with a brand-blue default accent, and every edit
// autosaves through the sticky SaveBar.
//
// Detail panels are React.lazy so the landing only downloads the shell + cards;
// a section's editor loads on first drill-in.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import SeoHelmet from '../../shared/components/SeoHelmet'
import Icon from '../../shared/components/Icon'
import { Search, XMarkIcon, ArrowLeft } from '../../shared/components/icons'
import PageLoader from '../../shared/components/PageLoader'
import { SettingsSaveProvider, useSettingsSave } from './components/SaveContext'
import {
  LEARNER_SETTINGS_SECTIONS, PANEL_SECTION_IDS, SECTION_IDS, searchSections, getSection,
} from './sections'
import {
  computeProfileCompletion,
  normalizePersonalisation,
  readLastSection,
  writeLastSection,
} from './lib/learnerPrefs'
import {
  MyAccountCard, LearningCard, ProgressCard, NotificationsCard, AppearanceCard,
  AccessibilityCard, PremiumCard, SecurityPrivacyCard, HelpCard,
} from './components/DashboardCards'
import './learnerSettings.css'

const PANELS = {
  account: lazy(() => import('./panels/MyAccountPanel')),
  learning: lazy(() => import('./panels/LearningPanel')),
  progress: lazy(() => import('./panels/ProgressPanel')),
  notifications: lazy(() => import('./panels/NotificationsPanel')),
  appearance: lazy(() => import('./panels/PersonalisationPanel')),
  accessibility: lazy(() => import('./panels/AccessibilityPanel')),
  premium: lazy(() => import('./panels/PremiumPanel')),
  security: lazy(() => import('./panels/PrivacySecurityPanel')),
  help: lazy(() => import('./panels/HelpPanel')),
  // Panel-only — no dashboard card. See PANEL_ONLY_SECTIONS.
  parent: lazy(() => import('./panels/ParentPanel')),
}

// Card grid — the mockup arrangement expressed as 12-col spans.
const GRID = [
  { id: 'account', Card: MyAccountCard, span: 12 },
  { id: 'learning', Card: LearningCard, span: 6 },
  { id: 'notifications', Card: NotificationsCard, span: 6 },
  { id: 'progress', Card: ProgressCard, span: 12 },
  { id: 'appearance', Card: AppearanceCard, span: 3 },
  { id: 'accessibility', Card: AccessibilityCard, span: 3 },
  { id: 'premium', Card: PremiumCard, span: 3 },
  { id: 'security', Card: SecurityPrivacyCard, span: 6 },
  { id: 'help', Card: HelpCard, span: 6 },
]

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
        <button type="button" className="lset-btn lset-btn--ghost lset-btn--sm" onClick={undo}>Undo</button>
      )}
      {(status === 'dirty' || status === 'error') && (
        <button type="button" className="lset-btn lset-btn--sm" onClick={saveNow}>
          {status === 'error' ? 'Retry' : 'Save now'}
        </button>
      )}
    </div>
  )
}

/* ── Descriptive rail nav item ────────────────────────────────── */
function NavItem({ section, active, onClick }) {
  return (
    <button
      type="button"
      className={`lset-snav__item${active ? ' lset-snav__item--on' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className={`lset-snav__tile lset-badge lset-badge--${section.tone}`}>
        <Icon as={section.icon} size="sm" strokeWidth={2.1} />
      </span>
      <span className="lset-snav__text">
        <span className="lset-snav__row">
          <span className="lset-snav__label">{section.label}</span>
        </span>
        <span className="lset-snav__desc">{section.desc}</span>
      </span>
    </button>
  )
}

/* ── Inner shell (inside the save provider) ───────────────────── */
function LearnerSettingsInner({ bare = false, forceSection = null }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // `forceSection` is the ROUTE speaking (/settings/security and friends,
  // mounted by LearnerSettingsRoute); `?section=` is the older parameter,
  // still honoured for the dashboard the non-learner roles use. The route
  // wins, because on those paths there is no parameter to read and falling
  // back to one would render the wrong panel at the right URL.
  const requested = forceSection || searchParams.get('section')
  // PANEL_SECTION_IDS, not SECTION_IDS: the Guardian panel has no
  // dashboard card but is a real destination (/settings/guardian).
  const detailId = PANEL_SECTION_IDS.includes(requested) ? requested : null

  const [query, setQuery] = useState('')
  const [spy, setSpy] = useState(detailId || readLastSection() || SECTION_IDS[0])
  const [toast, setToast] = useState(null)

  const pushToast = useCallback((kind, message) => {
    setToast({ kind, message, key: Math.random().toString(36).slice(2) })
  }, [])
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const personalisation = useMemo(
    () => normalizePersonalisation(userProfile?.learnerSettings?.personalisation),
    [userProfile?.learnerSettings?.personalisation],
  )
  const completion = useMemo(() => computeProfileCompletion(userProfile), [userProfile])

  const openDetail = useCallback((id) => {
    if (!SECTION_IDS.includes(id)) return
    writeLastSection(id)
    setQuery('')
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('section', id)
      return next
    }, { replace: false })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setSearchParams])

  const closeDetail = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('section')
      return next
    }, { replace: false })
  }, [setSearchParams])

  const scrollToCard = useCallback((id) => {
    setSpy(id)
    writeLastSection(id)
    const el = typeof document !== 'undefined' && document.getElementById(`sec-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Rail click: switch detail when one is open, else scroll to the card.
  const onNav = useCallback((id) => {
    if (detailId) openDetail(id)
    else scrollToCard(id)
  }, [detailId, openDetail, scrollToCard])

  // Scroll-spy over the cards while on the overview.
  useEffect(() => {
    if (detailId || typeof window === 'undefined') return undefined
    const els = SECTION_IDS.map((id) => document.getElementById(`sec-${id}`)).filter(Boolean)
    if (!els.length || !('IntersectionObserver' in window)) return undefined
    const obs = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) setSpy(visible[0].target.id.replace('sec-', ''))
    }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 })
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [detailId])

  const results = useMemo(() => searchSections(query), [query])
  const activeNav = detailId || spy
  const ActivePanel = detailId ? PANELS[detailId] : null
  const activeSection = detailId ? getSection(detailId) : null

  const onSearchPick = useCallback((id) => {
    setQuery('')
    if (detailId) openDetail(id)
    else requestAnimationFrame(() => scrollToCard(id))
  }, [detailId, openDetail, scrollToCard])

  // Bare: one focused panel inside the learner shell, reached from the
  // prototype-v6 Settings screen. No rail, no card grid, no settings
  // search — that dashboard is not part of the learner mockup.
  if (bare) {
    return (
      <div className="lset lset--bare" data-accent={personalisation.accent} data-card-style={personalisation.cardStyle}>
        <SeoHelmet title={activeSection?.label || 'Settings'} path="/settings" noIndex />
        <div className="lhx-back-row">
          {/* Route-mounted panels have no `?section=` to strip, so closeDetail
              would leave the child exactly where they are. Navigate instead. */}
          <button
            type="button"
            className="lhx-back-btn"
            aria-label="Back to Settings"
            onClick={() => (forceSection ? navigate('/settings') : closeDetail())}
          >‹</button>
          <div className="lhx-back-title">{activeSection?.label || 'Settings'}</div>
        </div>
        <Suspense fallback={<PageLoader />}>
          {ActivePanel && (
            <ActivePanel key={detailId} section={activeSection} pushToast={pushToast} navigate={navigate} />
          )}
        </Suspense>
        <SaveBar />
        {toast && <div className={`lset-toast lset-toast--${toast.kind}`} role="status">{toast.message}</div>}
      </div>
    )
  }

  return (
    <div
      className="lset"
      data-accent={personalisation.accent}
      data-card-style={personalisation.cardStyle}
    >
      <SeoHelmet title="Settings" path="/settings" noIndex />

      <div className="lset-dash">
        {/* Left rail */}
        <aside className="lset-rail">
          <div className="lset-head">
            <h1 className="lset-head__title">Settings</h1>
            <p className="lset-head__sub">
              Manage your account and learning preferences · Profile {completion.percent}% complete
            </p>
          </div>

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

          {query ? (
            <div className="lset-results">
              {results.length === 0 && <div className="lset-results__empty">No settings match “{query}”.</div>}
              {results.map((s) => (
                <button key={s.id} type="button" className="lset-snav__item" onClick={() => onSearchPick(s.id)}>
                  <span className={`lset-snav__tile lset-badge lset-badge--${s.tone}`}>
                    <Icon as={s.icon} size="sm" strokeWidth={2.1} />
                  </span>
                  <span className="lset-snav__text">
                    <span className="lset-snav__label">{s.label}</span>
                    <span className="lset-snav__desc">{s.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <nav className="lset-snav" aria-label="Settings sections">
              {LEARNER_SETTINGS_SECTIONS.map((s) => (
                <NavItem key={s.id} section={s} active={activeNav === s.id} onClick={() => onNav(s.id)} />
              ))}
            </nav>
          )}

          <div className="lset-help-card">
            <p className="lset-help-card__title">Need help?</p>
            <p className="lset-help-card__body">We're here for you.</p>
            <button type="button" className="lset-btn lset-btn--sm lset-btn--full" onClick={() => openDetail('help')}>
              Contact Support
            </button>
          </div>
        </aside>

        {/* Right side: detail panel or the overview grid */}
        <div className="lset-main">
          {detailId ? (
            <div className="lset-detail">
              <button type="button" className="lset-detail__back" onClick={closeDetail}>
                <Icon as={ArrowLeft} size="sm" strokeWidth={2.4} /> All settings
              </button>
              <Suspense fallback={<PageLoader />}>
                {ActivePanel && (
                  <ActivePanel key={detailId} section={activeSection} pushToast={pushToast} navigate={navigate} />
                )}
              </Suspense>
            </div>
          ) : (
            <div className="lset-dashgrid">
              {GRID.map(({ id, Card, span }) => (
                <div key={id} className="lset-cardwrap" data-span={String(span)}>
                  <Card onOpen={openDetail} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SaveBar />

      {toast && <div className={`lset-toast lset-toast--${toast.kind}`} role="status">{toast.message}</div>}
    </div>
  )
}

export default function LearnerSettings({ bare = false, forceSection = null }) {
  return (
    <SettingsSaveProvider>
      <LearnerSettingsInner bare={bare} forceSection={forceSection} />
    </SettingsSaveProvider>
  )
}
