/**
 * The dashboard's own mobile content — everything BELOW the shell chrome.
 *
 * The mobile information architecture for `/teacher` specifically: the hero
 * card, the weekly checklist, the AI recommendations and the recently-used
 * tools row. A CONTENT decision only; the header, drawer and bottom bar around
 * it belong to `TeacherLayout` at every width and now live in
 * `MobileChrome.jsx`.
 *
 * `NavDrawer`, `MobileHeader` and `MobileBottomNav` used to be exported from
 * here too, so this one file answered for both the shell and the page. They
 * moved to `MobileChrome.jsx` — see that file's note for why the split had to
 * happen before this surface could migrate into a feature.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BellOff, CalendarCheck, CalendarDays, CheckCircle2, ChevronRight, Circle, Crown, LayoutGrid, ListChecks, School, Sparkles, X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { usePressFeedback } from '../../../hooks/useGlassTile'
import BottomSheet from '../../../shared/components/BottomSheet'
import GlassToolTile from '../../../shared/components/GlassToolTile'
import MobileToolsScreen from './MobileToolsScreen'
import { STUDIO_BY_ID } from '../../../shared/constants/teacherStudios'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import { resolveBadge } from '../../../shared/utils/teacherLauncherCore'
import useRecentStudios from '../../../hooks/useRecentStudios'
import { progressFraction } from '../lib/dashboardV2Core'
import heroDesk from '../../../assets/teacher/hero-desk.webp'

/** Default "recently used" row until this device has real visits. */
const DEFAULT_RECENT_IDS = ['assessment-papers', 'lesson-plans', 'worksheet', 'weekly-focus']

function MobileHeroCard({ greeting, hero }) {
  const term = hero?.term
  const plan = hero?.plan
  const weekKnown = Number.isFinite(term?.weekNumber) && Number.isFinite(term?.totalWeeks)
  const fraction = weekKnown ? progressFraction(term.weekNumber, term.totalWeeks) : 0
  const hasInset = Boolean(hero?.schoolName || term || hero?.nextTermOpens)
  return (
    <section className="tdv2m-hero" aria-label="Greeting" data-tour="hero">
      <div className="tdv2m-hero-main">
        <h1 className="tdv2m-hero-name">
          {greeting.label}, {greeting.name}{' '}
          <span aria-hidden="true">👋</span>
        </h1>
        {/* School name and the term/holiday rows sit in a dark-glass inset:
            the hero keeps its own deep-green identity and gradient, and the
            factual rows read as one panel laid on it rather than as loose
            text. The recipe is theme-invariant like the hero itself, so it
            carries no Night override.

            Rendered only when there is something to put in it — an empty
            inset is a visible empty panel, not an invisible no-op. */}
        {hasInset ? (
          <div className="tdv2m-hero-inset glass-dark-inset">
            {hero?.schoolName ? (
              <p className="tdv2m-hero-row tdv2m-hero-school">
                <School size={17} strokeWidth={1.9} aria-hidden="true" />
                <span>{hero.schoolName}</span>
              </p>
            ) : null}
            {term ? (
              <>
                <p className="tdv2m-hero-row tdv2m-hero-term">
                  <CalendarCheck size={17} strokeWidth={1.9} aria-hidden="true" />
                  <span>
                    Term {term.termNumber}
                    {weekKnown ? <> · Week {term.weekNumber} of {term.totalWeeks}</> : null}
                  </span>
                </p>
                {weekKnown ? (
                  <div
                    className="tdv2m-hero-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={term.totalWeeks}
                    aria-valuenow={term.weekNumber}
                    aria-label={`Week ${term.weekNumber} of ${term.totalWeeks}`}
                  >
                    <span style={{ width: `${Math.round(fraction * 100)}%` }} />
                  </div>
                ) : null}
                {Number.isFinite(term.daysLeft) ? (
                  <p className="tdv2m-hero-row tdv2m-hero-days">
                    <CalendarDays size={14} strokeWidth={1.9} aria-hidden="true" />
                    <span>{term.daysLeft} teaching day{term.daysLeft === 1 ? '' : 's'} left</span>
                  </p>
                ) : null}
              </>
            ) : hero?.nextTermOpens ? (
              // Longer than "Term N · Week W of T" and the one fact this row
              // exists to show — see .tdv2m-hero-holiday in dashboardV2.css
              // for why it wraps instead of sharing the term row's ellipsis.
              <p className="tdv2m-hero-row tdv2m-hero-term tdv2m-hero-holiday">
                <CalendarCheck size={17} strokeWidth={1.9} aria-hidden="true" />
                <span>School holiday · next term opens {hero.nextTermOpens}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="tdv2m-hero-side" aria-hidden="true">
        <img className="tdv2m-hero-book" src={heroDesk} alt="" loading="lazy" draggable="false" />
      </div>
      {plan?.label ? (
        <span className={`tdv2m-plan-pill tier-${plan.tier || 'free'}`}>
          {plan.tier === 'max' ? <Crown size={13} strokeWidth={2.2} aria-hidden="true" /> : null}
          {plan.label}
        </span>
      ) : null}
    </section>
  )
}

/**
 * A Link that presses. Feedback comes from the shared glass hook, so its
 * timing matches every other pressable surface on the dashboard, and it
 * lands on the LINK rather than on something inside it — the studio artwork
 * now floats with no tile behind it, so there is no inner surface left to
 * press.
 */
function PressLink({ to, className, children, onClick, ...rest }) {
  const ref = useRef(null)
  usePressFeedback(ref)
  return (
    <Link ref={ref} to={to} className={className} onClick={onClick} {...rest}>
      {children}
    </Link>
  )
}

/**
 * A checklist row that leads somewhere. Only rows with a destination get
 * the press response — a row that goes nowhere would be promising a tap it
 * cannot honour.
 */
function CheckRowLink({ to, children, onNavigate }) {
  return (
    <PressLink to={to} className="tdv2m-check-row is-pressable" onClick={onNavigate}>
      {children}
    </PressLink>
  )
}

/**
 * Compact weekly checklist: overall count, a segmented progress indicator,
 * only the first two incomplete items, and a full-checklist bottom sheet.
 */
function WeeklyChecklistCard({ items = [], loading = false }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const complete = items.filter((i) => (i.done || 0) >= i.total).length
  const incomplete = items.filter((i) => (i.done || 0) < i.total).slice(0, 2)
  return (
    /* The sheet is a SIBLING of the card, not a child: `glass-surface`
       isolates a stacking context, and the sheet is `position: fixed` with
       a z-index meant to beat the page's floating dock. Nested inside, that
       z-index would only rank it within the card. */
    <>
    <section className="tdv2-card tdv2m-check glass-surface" aria-labelledby="tdv2m-check-h">
      <div className="tdv2m-check-head">
        <h2 className="tdv2-eyebrow" id="tdv2m-check-h">
          <ListChecks size={16} strokeWidth={2} aria-hidden="true" />
          This Week’s Checklist
        </h2>
        {items.length > 0 ? (
          <span className="tdv2m-check-count">{complete} of {items.length} complete</span>
        ) : null}
      </div>

      {loading ? (
        <div className="tdv2-empty">Working out your week…</div>
      ) : items.length === 0 ? (
        <div className="tdv2-empty">
          No weekly plan yet — set up your week from a{' '}
          <Link to="/teacher/generate/scheme-of-work" className="tdv2m-check-link">Scheme of Work</Link>.
        </div>
      ) : (
        <>
          <div className="tdv2m-check-segments" aria-hidden="true">
            {items.map((item) => (
              <span key={item.id} className="tdv2m-check-seg">
                <span style={{ width: `${progressFraction(item.done, item.total) * 100}%` }} />
              </span>
            ))}
          </div>

          {incomplete.length === 0 ? (
            <div className="tdv2m-check-row is-done">
              <CheckCircle2 size={20} strokeWidth={2} aria-hidden="true" />
              <span className="tdv2m-check-label">Everything is prepared for this week</span>
            </div>
          ) : (
            incomplete.map((item) => {
              const inner = (
                <>
                  <Circle size={20} strokeWidth={2} className="tdv2m-check-circle" aria-hidden="true" />
                  <span className="tdv2m-check-label">{item.label}</span>
                  <span className="tdv2m-check-meta">{item.done || 0}/{item.total}</span>
                </>
              )
              return item.to ? (
                <CheckRowLink key={item.id} to={item.to}>{inner}</CheckRowLink>
              ) : (
                <div key={item.id} className="tdv2m-check-row">{inner}</div>
              )
            })
          )}

          <button type="button" className="tdv2m-check-more" onClick={() => setSheetOpen(true)}>
            View full checklist
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </>
      )}
    </section>

    <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="This Week’s Checklist">
      <p className="tdv2m-sheet-sub">{complete} of {items.length} complete</p>
      <div className="tdv2m-sheet-list">
        {items.map((item) => {
          const done = (item.done || 0) >= item.total
          const inner = (
            <>
              {done ? (
                <CheckCircle2 size={20} strokeWidth={2} className="tdv2m-check-done" aria-hidden="true" />
              ) : (
                <Circle size={20} strokeWidth={2} className="tdv2m-check-circle" aria-hidden="true" />
              )}
              <span className="tdv2m-check-label">{item.label}</span>
              <span className="tdv2m-check-meta">{item.done || 0}/{item.total}</span>
            </>
          )
          return item.to ? (
            <CheckRowLink key={item.id} to={item.to} onNavigate={() => setSheetOpen(false)}>
              {inner}
            </CheckRowLink>
          ) : (
            <div key={item.id} className="tdv2m-check-row">{inner}</div>
          )
        })}
      </div>
    </BottomSheet>
    </>
  )
}

// Device-local dismiss/snooze state for AI recommendations. Stores only
// stable recommendation ids + timestamps (no content) — same pattern as the
// launcher's recents. Dismissed = forever (until the rec itself changes id);
// snoozed = hidden for 24h.
//
// Keyed per signed-in teacher (…:uid), mirroring useRecentStudios: on a shared
// device recommendation ids (record-behind, worksheet-missing, per-subject
// scheme ids…) repeat across accounts, so a global key would leak one teacher's
// dismissals to another. Falls back to :anon before sign-in.
const REC_HIDDEN_KEY_BASE = 'zedexams:tdv2m-recs-hidden'
const recHiddenKey = (uid) => `${REC_HIDDEN_KEY_BASE}:${uid || 'anon'}`
const SNOOZE_MS = 24 * 60 * 60 * 1000

function loadHiddenRecs(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveHiddenRecs(storageKey, map) {
  try { localStorage.setItem(storageKey, JSON.stringify(map)) } catch { /* non-fatal */ }
}

/**
 * One collapsed AI recommendation. Tapping opens a bottom sheet with the
 * full text and actions (create, dismiss, remind later, next, view all).
 * All recommendations still come from the existing
 * buildProfileRecommendations output — this only changes presentation.
 */
function MobileAiRecommendation({ recommendations = [] }) {
  const { currentUser } = useAuth() || {}
  const storageKey = recHiddenKey(currentUser?.uid)
  const [hidden, setHidden] = useState(() => loadHiddenRecs(storageKey))
  const [index, setIndex] = useState(0)
  const [view, setView] = useState(null) // null | 'detail' | 'all'

  // Re-read from storage when the signed-in teacher changes (sign-in/out on a
  // shared device swaps to that account's dismissals).
  useEffect(() => {
    setHidden(loadHiddenRecs(storageKey))
    setIndex(0)
  }, [storageKey])

  const visible = useMemo(() => {
    const now = Date.now()
    return recommendations.filter((r) => {
      const until = hidden[r.id]
      if (until === 'dismissed') return false
      if (typeof until === 'number' && until > now) return false
      return true
    })
  }, [recommendations, hidden])

  const rec = visible.length ? visible[index % visible.length] : null

  const hide = (id, value) => {
    const next = { ...hidden, [id]: value }
    saveHiddenRecs(storageKey, next)
    setHidden(next)
    setIndex(0)
    if (visible.length <= 1) setView(null)
  }

  if (!rec) {
    return (
      <section className="tdv2-card tdv2m-ai glass-panel glass-panel--ai" aria-labelledby="tdv2m-ai-h" data-tour="ai-recs">
        <div className="tdv2m-ai-top">
          <h2 className="tdv2-eyebrow tdv2m-ai-eyebrow" id="tdv2m-ai-h">
            <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
            AI Recommendation
          </h2>
        </div>
        <p className="tdv2m-ai-title is-quiet">You’re all caught up</p>
        <p className="tdv2m-ai-meta">New suggestions appear as your term progresses.</p>
      </section>
    )
  }

  const metaBits = [rec.context?.grade, rec.context?.subject].filter(Boolean)

  return (
    <>
      <section className="tdv2-card tdv2m-ai glass-panel glass-panel--ai" aria-labelledby="tdv2m-ai-h" data-tour="ai-recs">
        <button
          type="button"
          className="tdv2m-ai-open"
          aria-haspopup="dialog"
          onClick={() => setView('detail')}
        >
          <div className="tdv2m-ai-top">
            <h2 className="tdv2-eyebrow tdv2m-ai-eyebrow" id="tdv2m-ai-h">
              <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
              AI Recommendation
            </h2>
            <span className="tdv2m-ai-count" aria-label={`${visible.length} recommendations`}>
              {visible.length}
            </span>
            <ChevronRight size={18} strokeWidth={2} className="tdv2m-ai-chev" aria-hidden="true" />
          </div>
          <p className="tdv2m-ai-title">{rec.title}</p>
          {metaBits.length ? (
            <p className="tdv2m-ai-meta">{metaBits.join(' · ')}</p>
          ) : null}
        </button>
      </section>

      <BottomSheet
        open={view !== null}
        onClose={() => setView(null)}
        title={view === 'all' ? 'All Recommendations' : 'AI Recommendation'}
      >
        {view === 'all' ? (
          <div className="tdv2m-sheet-list">
            {visible.map((r) => (
              <button
                key={r.id}
                type="button"
                className="tdv2m-recall-row"
                onClick={() => {
                  setIndex(visible.indexOf(r))
                  setView('detail')
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="tdv2m-recall-title">{r.title}</span>
                  <span className="tdv2m-recall-text">{r.text}</span>
                </span>
                <ChevronRight size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <div className="tdv2m-rec-detail">
            <h3 className="tdv2m-rec-title">{rec.title}</h3>
            {metaBits.length ? (
              <div className="tdv2-ai-context">
                {metaBits.map((bit) => (
                  <span key={bit} className="tdv2-ai-chip">{bit}</span>
                ))}
              </div>
            ) : null}
            <p className="tdv2m-rec-text">{rec.text}</p>
            <div className="tdv2m-rec-actions">
              {/* Link, not button — the copper visual survives the .tdv2
                  button reset only on anchors */}
              <Link
                to={rec.to}
                className="tdv2-btn-copper tdv2m-rec-primary"
                onClick={() => setView(null)}
              >
                {rec.actionLabel || 'Open'}
                <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
              <div className="tdv2m-rec-secondary">
                <button type="button" onClick={() => hide(rec.id, Date.now() + SNOOZE_MS)}>
                  <BellOff size={15} strokeWidth={1.9} aria-hidden="true" />
                  Remind me later
                </button>
                <button type="button" onClick={() => hide(rec.id, 'dismissed')}>
                  <X size={15} strokeWidth={2} aria-hidden="true" />
                  Dismiss
                </button>
              </div>
              {visible.length > 1 ? (
                <div className="tdv2m-rec-nav">
                  <button type="button" onClick={() => setIndex((i) => (i + 1) % visible.length)}>
                    Next recommendation
                  </button>
                  <button type="button" onClick={() => setView('all')}>
                    View all ({visible.length})
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  )
}

/** Up to four recently used tools as large app-style icons. */
function RecentlyUsedTools({ savedCounts, warnings = [], onViewAll }) {
  const { recents } = useRecentStudios()
  const { filterEntries } = useStudioAvailability()
  const warningSet = useMemo(() => new Set(warnings), [warnings])
  const studios = useMemo(() => {
    // Real recents are the activity signal. Only fall back to the curated
    // defaults when this device has no visits yet — otherwise a teacher with
    // one or two genuine visits would see unopened studios padded in under
    // "Recently Used", which misreports what they've actually used.
    const ids = recents.length ? recents : DEFAULT_RECENT_IDS
    // A stored visit to a studio that has since been withdrawn is the one way
    // a hidden tool can walk back onto the dashboard — the id is on the
    // device, not in the registry.
    return filterEntries(ids.map((id) => STUDIO_BY_ID[id]).filter(Boolean), 'route').slice(0, 4)
  }, [recents, filterEntries])

  return (
    <section aria-labelledby="tdv2m-recent-h">
      <div className="tdv2m-section-head">
        <h2 className="tdv2-eyebrow" id="tdv2m-recent-h">Recently Used</h2>
        <button type="button" className="tdv2-link-action" onClick={onViewAll}>
          View all
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className="tdv2m-recent-grid">
        {studios.map((studio) => {
          const badge = resolveBadge(studio, savedCounts, { warnings: warningSet })
          return (
            <PressLink
              key={studio.id}
              to={studio.route}
              className="tdv2m-recent-tool"
              aria-label={`${studio.title}${badge ? `, ${badge.label}` : ''}`}
            >
              <GlassToolTile
                studio={studio}
                badge={badge}
                sizeClass="tdv2m-recent-tile"
                iconSize={30}
              />
              <span className="tdv2m-recent-name">{studio.title}</span>
              {badge?.type === 'saved' ? (
                <span className="tdv2m-tool-saved" aria-hidden="true">{badge.count} saved</span>
              ) : null}
            </PressLink>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Dedicated MOBILE information architecture for the dashboard (< 768px) —
 * deep-teal hero with term progress, compact weekly checklist, one collapsed
 * AI recommendation, four recently used tools and an All Teacher Tools
 * launcher. Same props contract as the desktop layout inside DashboardView,
 * so live data and the mock preview both flow through unchanged.
 *
 * CONTENT only. The header, drawer and floating dock that used to be mounted
 * here are exported above and mounted by TeacherLayout instead, for every
 * teacher page — so the dashboard and a studio page cannot show different
 * navigation, and the drawer's state does not live inside one page's tree.
 */
export default function MobileDashboardContent({
  greeting,
  hero = null,
  recommendations,
  savedCounts = null,
  launcherWarnings = [],
  checklist,
  loading = false,
  banner = null,
}) {
  const [toolsOpen, setToolsOpen] = useState(false)
  const closeTools = useCallback(() => setToolsOpen(false), [])

  return (
    <div className="tdv2m">
      <main className="tdv2m-content">
        {banner}

        <MobileHeroCard greeting={greeting} hero={hero} />

        <WeeklyChecklistCard items={checklist} loading={loading} />

        <MobileAiRecommendation recommendations={recommendations} />

        <RecentlyUsedTools
          savedCounts={savedCounts}
          warnings={launcherWarnings}
          onViewAll={() => setToolsOpen(true)}
        />

        <button type="button" className="tdv2-card tdv2m-alltools" onClick={() => setToolsOpen(true)}>
          <span className="tdv2m-alltools-icon" aria-hidden="true">
            <LayoutGrid size={22} strokeWidth={1.9} />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="tdv2m-alltools-title">All Teacher Tools</span>
            <span className="tdv2m-alltools-sub">Explore all studios and resources</span>
          </span>
          <ChevronRight size={19} strokeWidth={2} aria-hidden="true" />
        </button>
      </main>

      {toolsOpen ? (
        <MobileToolsScreen
          onClose={closeTools}
          savedCounts={savedCounts}
          warnings={launcherWarnings}
        />
      ) : null}
    </div>
  )
}
