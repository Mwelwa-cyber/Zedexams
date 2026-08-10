import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock, Hand, LayoutGrid, ListFilter, SearchX, Star, X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  LAUNCHER_CHIPS,
  STUDIO_BY_ID,
  STUDIO_CATEGORIES,
  TEACHER_STUDIOS,
} from '../../../components/teacher/dashboardV2/launcher/teacherStudios'
import {
  applyChip,
  badgeIsPending,
  columnsForWidth,
  favouriteStudios as pickFavouriteStudios,
  filterStudiosByPermission,
  lastOpenedLabel,
  recentLimitForWidth,
  recentStudios as pickRecentStudios,
  resolveBadge,
  resolvePopoverPlacement,
  searchStudios,
} from '../../../components/teacher/dashboardV2/launcher/teacherLauncherCore'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import useStudioFavourites from './useStudioFavourites'
import useRecentStudios from '../../../components/teacher/dashboardV2/launcher/useRecentStudios'
import StudioAppIcon from './StudioAppIcon'
import StudioCategory from './StudioCategory'
import RecentStudios from './RecentStudios'
import FavouriteStudios from './FavouriteStudios'
import StudioInfoPopover from './StudioInfoPopover'
import StudioInfoBottomSheet from './StudioInfoBottomSheet'
import ToolSearch from './ToolSearch'
import './teacherAppLauncher.css'

const POPOVER_SIZE = { width: 304, height: 280 }
const HOVER_INTENT_MS = 160 // hover pause before the popover opens
const HIDE_DELAY = 140      // grace period to travel icon → popover
const HINT_KEY = 'zedexams:tsl-hint-dismissed'
const COLLAPSE_KEY = 'zedexams:tsl-collapsed'

const CHIP_ICONS = { recent: Clock, favourites: Star, all: LayoutGrid }

/**
 * Viewport → { columns, recentLimit }, updating ONLY when a breakpoint is
 * crossed — dragging a desktop window edge re-renders the grid a handful of
 * times instead of once per pixel.
 */
function useLauncherBreakpoint() {
  const compute = () => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280
    return { columns: columnsForWidth(w), recentLimit: recentLimitForWidth(w) }
  }
  const [bp, setBp] = useState(compute)
  useEffect(() => {
    const onResize = () => {
      const next = compute()
      setBp((cur) => (
        cur.columns === next.columns && cur.recentLimit === next.recentLimit ? cur : next
      ))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return bp
}

/**
 * The Teacher Workspace app launcher — the premium, installed-app-style
 * home for every teacher studio. Presents each studio as a compact icon
 * (StudioAppIcon) organised into collapsible categories, with search,
 * Recent / Favourites / All chips, a "Recently used" row, desktop hover
 * popovers and a touch bottom sheet.
 *
 * It changes NO routes, permissions, counts or studio behaviour — it is a
 * presentation + interaction layer over the canonical registry in
 * teacherStudios.js. Saved counts come in via the `savedCounts` prop (the
 * dashboard's existing aggregate); this component never queries per-icon.
 */
export default function TeacherAppLauncher({ savedCounts = null, loading = false, warnings = [] }) {
  const navigate = useNavigate()
  const location = useLocation()
  // The live dashboard sits behind ProtectedRoute(requiredRole="teacher");
  // the only signed-out visitor is the mock-data preview page, which should
  // still show the full registry (mirrors MobileToolsScreen). Signed-in
  // non-teachers keep the permission filter.
  const auth = useAuth() || {}
  const isTeacher = auth.currentUser ? auth.isTeacher : true
  const { filterEntries } = useStudioAvailability()
  const { columns, recentLimit } = useLauncherBreakpoint()

  const { favourites, favouriteSet, toggle: toggleFavourite } = useStudioFavourites()
  const { recents, openedAt, record } = useRecentStudios()

  // Studios needing attention (e.g. draft papers) — drives the warning-dot
  // badge; derived upstream from data the dashboard already fetched.
  const warningSet = useMemo(() => new Set(warnings), [warnings])

  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [catMenuOpen, setCatMenuOpen] = useState(false)
  const [info, setInfo] = useState(null) // { studio, placement, anchor }
  const [sheetStudio, setSheetStudio] = useState(null)
  const catMenuRef = useRef(null)

  // Collapsed categories persist per device (real category ids only — the
  // transient search/filter results section is never collapsible).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY)
      const ids = raw ? JSON.parse(raw) : []
      return new Set(ids.filter((id) => STUDIO_CATEGORIES.some((c) => c.id === id)))
    } catch {
      return new Set()
    }
  })
  const toggleCategory = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])) } catch { /* non-fatal */ }
      return next
    })
  }, [])

  // One-time touch hint: press-and-hold is invisible until taught. Shown
  // only on coarse pointers, dismissed by hand or by the first sheet open.
  const [hintVisible, setHintVisible] = useState(() => {
    try {
      if (localStorage.getItem(HINT_KEY)) return false
    } catch { /* ignore */ }
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches
  })
  const dismissHint = useCallback(() => {
    setHintVisible(false)
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* non-fatal */ }
  }, [])

  // Studios this teacher may see — memoised. Two filters, and they answer
  // different questions: `filterStudiosByPermission` asks whether THIS teacher
  // may open the studio, `filterEntries` whether the studio is offered at all
  // (Worksheet Studio is withdrawn behind a flag). Both feed `permitted`, so
  // search, the chips, recents and favourites all narrow from the same list —
  // a studio that is not offered must not reappear because it is pinned.
  const permitted = useMemo(
    () => filterEntries(filterStudiosByPermission(TEACHER_STUDIOS, { isTeacher }), 'route'),
    [isTeacher, filterEntries],
  )

  // Search + chip + category filter, composed. Search wins (a query ignores
  // chips so you can always find any tool).
  const searching = query.trim().length > 0
  const visible = useMemo(() => {
    let list = permitted
    if (searching) return searchStudios(list, query)
    list = applyChip(list, { chip, favourites: [...favouriteSet], recents, byId: STUDIO_BY_ID })
    if (categoryFilter !== 'all') list = list.filter((s) => s.category === categoryFilter)
    return list
  }, [permitted, searching, query, chip, favouriteSet, recents, categoryFilter])

  const recentList = useMemo(
    () => pickRecentStudios(recents, STUDIO_BY_ID, recentLimit)
      .filter((s) => permitted.some((p) => p.id === s.id)),
    [recents, recentLimit, permitted],
  )

  // Pinned favourites row (default view) — the teacher's own pin order.
  const favouriteList = useMemo(
    () => pickFavouriteStudios(favourites, STUDIO_BY_ID)
      .filter((s) => permitted.some((p) => p.id === s.id)),
    [favourites, permitted],
  )

  // ── Popover open/close (hover intent + travel grace) ─────────────────
  const openTimer = useRef(null)
  const hideTimer = useRef(null)
  const measuredSize = useRef(POPOVER_SIZE)
  const cancelOpen = () => { clearTimeout(openTimer.current); openTimer.current = null }
  const cancelHide = () => { clearTimeout(hideTimer.current); hideTimer.current = null }

  const openInfoNow = useCallback((studio, el) => {
    const rect = el.getBoundingClientRect()
    const anchor = {
      top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    }
    const placement = resolvePopoverPlacement(
      anchor,
      { width: window.innerWidth, height: window.innerHeight },
      measuredSize.current,
    )
    setInfo({ studio, placement, anchor })
  }, [])

  // Focus opens immediately (keyboard users shouldn't wait); hover waits a
  // beat so sweeping the cursor across the grid doesn't strobe popovers.
  const showInfo = useCallback((studio, el, { immediate = false } = {}) => {
    if (!el) return
    cancelHide()
    cancelOpen()
    if (immediate) {
      openInfoNow(studio, el)
      return
    }
    openTimer.current = setTimeout(() => openInfoNow(studio, el), HOVER_INTENT_MS)
  }, [openInfoNow])

  const scheduleHide = useCallback(() => {
    cancelOpen()
    cancelHide()
    hideTimer.current = setTimeout(() => setInfo(null), HIDE_DELAY)
  }, [])
  useEffect(() => () => { cancelOpen(); cancelHide() }, [])

  // The estimate can undershoot the real card height; re-clamp once the
  // popover reports its rendered size (also remembered for future opens).
  const handlePopMeasure = useCallback((size) => {
    measuredSize.current = size
    setInfo((cur) => {
      if (!cur?.anchor) return cur
      const placement = resolvePopoverPlacement(
        cur.anchor,
        { width: window.innerWidth, height: window.innerHeight },
        size,
      )
      if (
        placement.top === cur.placement.top
        && placement.left === cur.placement.left
        && placement.side === cur.placement.side
      ) return cur
      return { ...cur, placement }
    })
  }, [])

  // Close popover on route change, Escape, outside click, scroll or resize
  // (fixed-position coords go stale the moment the page moves).
  useEffect(() => { setInfo(null); setSheetStudio(null); setCatMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!info) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setInfo(null) }
    const onDown = (e) => {
      if (!e.target.closest?.('.tsl-pop') && !e.target.closest?.('.tsl-app')) setInfo(null)
    }
    const onMove = () => setInfo(null)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onMove, { capture: true, passive: true })
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onMove, { capture: true })
      window.removeEventListener('resize', onMove)
    }
  }, [info])

  // Category menu outside-click.
  useEffect(() => {
    if (!catMenuOpen) return undefined
    const onDown = (e) => { if (!catMenuRef.current?.contains(e.target)) setCatMenuOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [catMenuOpen])

  // ── Sheet open/close with focus restore ───────────────────────────────
  const sheetReturnFocus = useRef(null)
  const openSheet = useCallback((studio) => {
    sheetReturnFocus.current = document.activeElement
    cancelOpen()
    setInfo(null)
    setSheetStudio(studio)
    dismissHint()
  }, [dismissHint])
  const closeSheet = useCallback(() => {
    setSheetStudio(null)
    const el = sheetReturnFocus.current
    if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────
  const openStudio = useCallback((studio) => {
    record(studio.id)
    setInfo(null)
    setSheetStudio(null)
    navigate(studio.route)
  }, [navigate, record])

  const viewSaved = useCallback((studio) => {
    if (!studio.savedWorkTo) return
    setInfo(null)
    setSheetStudio(null)
    navigate(studio.savedWorkTo)
  }, [navigate])

  const openFirstResult = useCallback(() => {
    if (searching && visible.length > 0) openStudio(visible[0])
  }, [searching, visible, openStudio])

  // Stable per-icon handlers so memo(StudioAppIcon) actually skips.
  const handleIconOpen = useCallback((studio) => record(studio.id), [record])

  const renderIcon = useCallback((studio) => {
    const badge = resolveBadge(studio, savedCounts, { warnings: warningSet })
    return (
      <StudioAppIcon
        studio={studio}
        badge={badge}
        pending={loading && badgeIsPending(studio, savedCounts)}
        isFavourite={favouriteSet.has(studio.id)}
        onOpen={handleIconOpen}
        onShowInfo={showInfo}
        onHideInfo={scheduleHide}
        onLongPress={openSheet}
      />
    )
  }, [savedCounts, loading, favouriteSet, warningSet, handleIconOpen, showInfo, scheduleHide, openSheet])

  const infoBadge = info ? resolveBadge(info.studio, savedCounts, { warnings: warningSet }) : null
  const sheetBadge = sheetStudio ? resolveBadge(sheetStudio, savedCounts, { warnings: warningSet }) : null
  const infoCount = info?.studio?.countKey && savedCounts ? savedCounts[info.studio.countKey] : null
  const sheetCount = sheetStudio?.countKey && savedCounts ? savedCounts[sheetStudio.countKey] : null

  const filtered = searching || chip !== 'all' || categoryFilter !== 'all'
  const categoriesToShow = filtered
    ? [{
      id: 'results',
      label: searching ? 'Search results' : chip === 'favourites' ? 'Favourites' : chip === 'recent' ? 'Recently used' : 'Tools',
      studios: visible,
    }]
    : STUDIO_CATEGORIES.map((c) => ({ ...c, studios: visible.filter((s) => s.category === c.id) }))

  const catFilterLabel = categoryFilter === 'all'
    ? 'Categories'
    : STUDIO_CATEGORIES.find((c) => c.id === categoryFilter)?.label || 'Categories'

  // Context-specific empty state — never a filter that silently un-filters.
  const emptyState = searching
    ? { icon: SearchX, body: <p>No tools match “{query.trim()}”. Try another word.</p> }
    : chip === 'favourites'
      ? { icon: Star, body: <p>No favourites yet. Press and hold a tool (or open its info card) and choose <strong>Add to favourites</strong>.</p> }
      : chip === 'recent'
        ? { icon: Clock, body: <p>No recently used tools yet — tools you open appear here.</p> }
        : { icon: LayoutGrid, body: <p>Nothing to show here yet.</p> }
  const EmptyIcon = emptyState.icon

  return (
    <section className="tsl" aria-label="Teacher Workspace">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="tsl-head">
        <div className="tsl-head-titles">
          <h2 className="tsl-title">Teacher Workspace</h2>
          <p className="tsl-subtitle">Everything you need to plan, teach, assess and record</p>
        </div>
        <ToolSearch
          value={query}
          onChange={setQuery}
          onSubmit={openFirstResult}
          resultCount={visible.length}
        />
      </header>

      {/* ── Controls: chips + category filter ──────────────────────── */}
      <div className="tsl-controls">
        <div className="tsl-chips" role="tablist" aria-label="Filter tools">
          {LAUNCHER_CHIPS.map((c) => {
            const ChipIcon = CHIP_ICONS[c.id]
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={chip === c.id && !searching}
                className={`tsl-chip ${chip === c.id && !searching ? 'is-active' : ''}`}
                onClick={() => { setChip(c.id); setQuery('') }}
              >
                {ChipIcon ? <ChipIcon size={14} strokeWidth={2} aria-hidden="true" /> : null}
                {c.label}
              </button>
            )
          })}
        </div>

        <div className="tsl-catfilter" ref={catMenuRef}>
          <button
            type="button"
            className={`tsl-catfilter-btn ${categoryFilter !== 'all' ? 'is-active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={catMenuOpen}
            onClick={() => setCatMenuOpen((v) => !v)}
          >
            <ListFilter size={15} strokeWidth={2} aria-hidden="true" />
            {catFilterLabel}
          </button>
          {catMenuOpen ? (
            <div className="tsl-catmenu" role="menu" aria-label="Filter by category">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={categoryFilter === 'all'}
                className="tsl-catmenu-item"
                onClick={() => { setCategoryFilter('all'); setCatMenuOpen(false) }}
              >
                All categories
              </button>
              {STUDIO_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={categoryFilter === c.id}
                  className="tsl-catmenu-item"
                  onClick={() => { setCategoryFilter(c.id); setChip('all'); setQuery(''); setCatMenuOpen(false) }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── One-time touch hint ────────────────────────────────────── */}
      {hintVisible ? (
        <div className="tsl-hint" role="note">
          <Hand size={15} strokeWidth={2} aria-hidden="true" />
          <span>Tap a tool to open it. Press and hold for details and favourites.</span>
          <button type="button" className="tsl-hint-close" aria-label="Dismiss tip" onClick={dismissHint}>
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* ── Favourites + Recently used (default view only) ─────────── */}
      {!filtered ? (
        <FavouriteStudios studios={favouriteList} columns={columns} renderIcon={renderIcon} />
      ) : null}
      {!filtered ? (
        <RecentStudios studios={recentList} columns={columns} renderIcon={renderIcon} />
      ) : null}

      {/* ── Category sections ──────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div className="tsl-empty">
          <EmptyIcon size={22} strokeWidth={1.75} aria-hidden="true" />
          {emptyState.body}
        </div>
      ) : (
        categoriesToShow.map((c) => (
          <StudioCategory
            key={c.id}
            id={c.id}
            label={c.label}
            studios={c.studios}
            columns={columns}
            collapsible={!filtered}
            collapsed={!filtered && collapsed.has(c.id)}
            onToggle={toggleCategory}
            renderIcon={renderIcon}
          />
        ))
      )}

      {/* ── Desktop popover ────────────────────────────────────────── */}
      {info ? (
        <StudioInfoPopover
          studio={info.studio}
          badge={infoBadge}
          savedCount={typeof infoCount === 'number' ? infoCount : null}
          lastOpened={lastOpenedLabel(openedAt[info.studio.id])}
          isFavourite={favouriteSet.has(info.studio.id)}
          placement={info.placement}
          onMeasure={handlePopMeasure}
          onOpenStudio={openStudio}
          onViewSaved={viewSaved}
          onToggleFavourite={(s) => toggleFavourite(s.id)}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      ) : null}

      {/* ── Mobile bottom sheet ────────────────────────────────────── */}
      {sheetStudio ? (
        <StudioInfoBottomSheet
          studio={sheetStudio}
          badge={sheetBadge}
          savedCount={typeof sheetCount === 'number' ? sheetCount : null}
          lastOpened={lastOpenedLabel(openedAt[sheetStudio.id])}
          isFavourite={favouriteSet.has(sheetStudio.id)}
          onOpenStudio={openStudio}
          onViewSaved={viewSaved}
          onToggleFavourite={(s) => toggleFavourite(s.id)}
          onClose={closeSheet}
        />
      ) : null}
    </section>
  )
}
