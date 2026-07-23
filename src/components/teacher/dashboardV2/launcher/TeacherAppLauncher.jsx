import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, Bell, LayoutGrid, ListFilter, Star } from 'lucide-react'
import { useAuth } from '../../../../contexts/AuthContext'
import {
  LAUNCHER_CHIPS,
  STUDIO_BY_ID,
  STUDIO_CATEGORIES,
  TEACHER_STUDIOS,
} from './teacherStudios'
import {
  applyChip,
  badgeIsPending,
  columnsForWidth,
  filterStudiosByPermission,
  lastOpenedLabel,
  recentLimitForWidth,
  recentStudios as pickRecentStudios,
  resolveBadge,
  resolvePopoverPlacement,
  searchStudios,
} from './teacherLauncherCore'
import useStudioFavourites from './useStudioFavourites'
import useRecentStudios from './useRecentStudios'
import StudioAppIcon from './StudioAppIcon'
import StudioCategory from './StudioCategory'
import RecentStudios from './RecentStudios'
import StudioInfoPopover from './StudioInfoPopover'
import StudioInfoBottomSheet from './StudioInfoBottomSheet'
import ToolSearch from './ToolSearch'
import './teacherAppLauncher.css'

const POPOVER_SIZE = { width: 304, height: 240 }
const HIDE_DELAY = 140

function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
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
export default function TeacherAppLauncher({ savedCounts = null, loading = false }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isTeacher = true } = useAuth() || {}
  const width = useViewportWidth()

  const { favouriteSet, toggle: toggleFavourite } = useStudioFavourites()
  const { recents, openedAt, record } = useRecentStudios()

  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [catMenuOpen, setCatMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [info, setInfo] = useState(null) // { studio, placement }
  const [sheetStudio, setSheetStudio] = useState(null)
  const hideTimer = useRef(null)
  const catMenuRef = useRef(null)

  const columns = columnsForWidth(width)
  const recentLimit = recentLimitForWidth(width)

  // Studios this teacher may see (permission-filtered) — memoised.
  const permitted = useMemo(
    () => filterStudiosByPermission(TEACHER_STUDIOS, { isTeacher }),
    [isTeacher],
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

  // ── Popover open/close ────────────────────────────────────────────────
  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }
  const showInfo = useCallback((studio, el) => {
    if (!el) return
    cancelHide()
    const rect = el.getBoundingClientRect()
    const placement = resolvePopoverPlacement(
      { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
      POPOVER_SIZE,
    )
    setInfo({ studio, placement })
  }, [])
  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimer.current = setTimeout(() => setInfo(null), HIDE_DELAY)
  }, [])
  useEffect(() => () => cancelHide(), [])

  // Close popover on route change, Escape, or outside click.
  useEffect(() => { setInfo(null); setSheetStudio(null); setCatMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!info) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setInfo(null) }
    const onDown = (e) => {
      if (!e.target.closest?.('.tsl-pop') && !e.target.closest?.('.tsl-app')) setInfo(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [info])

  // Category menu outside-click.
  useEffect(() => {
    if (!catMenuOpen) return undefined
    const onDown = (e) => { if (!catMenuRef.current?.contains(e.target)) setCatMenuOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [catMenuOpen])

  // ── Actions ───────────────────────────────────────────────────────────
  const openStudio = useCallback((studio) => {
    record(studio.id)
    setInfo(null)
    setSheetStudio(null)
    navigate(studio.route)
  }, [navigate, record])

  const viewSaved = useCallback((studio) => {
    setInfo(null)
    setSheetStudio(null)
    // The library is the saved-work destination; the assessment studio keeps
    // its own list. Never a per-icon query.
    navigate(studio.id === 'assessment-papers' ? '/teacher/assessment-papers' : '/teacher/library')
  }, [navigate])

  const toggleCategory = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Shared icon renderer — resolves badge/favourite + wires handlers once.
  const renderIcon = useCallback((studio) => {
    const badge = resolveBadge(studio, savedCounts)
    return (
      <StudioAppIcon
        studio={studio}
        badge={badge}
        pending={loading && badgeIsPending(studio, savedCounts)}
        isFavourite={favouriteSet.has(studio.id)}
        onOpen={() => record(studio.id)}
        onShowInfo={showInfo}
        onHideInfo={scheduleHide}
        onLongPress={setSheetStudio}
      />
    )
  }, [savedCounts, loading, favouriteSet, record, showInfo, scheduleHide])

  const infoBadge = info ? resolveBadge(info.studio, savedCounts) : null
  const sheetBadge = sheetStudio ? resolveBadge(sheetStudio, savedCounts) : null
  const infoCount = info?.studio?.countKey && savedCounts ? savedCounts[info.studio.countKey] : null
  const sheetCount = sheetStudio?.countKey && savedCounts ? savedCounts[sheetStudio.countKey] : null

  const categoriesToShow = searching || categoryFilter !== 'all' || chip !== 'all'
    ? [{ id: 'results', label: searching ? 'Search results' : chip === 'favourites' ? 'Favourites' : chip === 'recent' ? 'Recent' : 'Tools', studios: visible }]
    : STUDIO_CATEGORIES.map((c) => ({ ...c, studios: visible.filter((s) => s.category === c.id) }))

  const catFilterLabel = categoryFilter === 'all'
    ? 'Categories'
    : STUDIO_CATEGORIES.find((c) => c.id === categoryFilter)?.label || 'Categories'

  return (
    <section className="tsl" aria-label="Teacher Workspace">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="tsl-head">
        <div className="tsl-head-titles">
          <h2 className="tsl-title">Teacher Workspace</h2>
          <p className="tsl-subtitle">Everything you need to plan, teach, assess and record</p>
        </div>
        <ToolSearch value={query} onChange={setQuery} resultCount={visible.length} />
      </header>

      {/* ── Controls: chips + category filter ──────────────────────── */}
      <div className="tsl-controls">
        <div className="tsl-chips" role="tablist" aria-label="Filter tools">
          {LAUNCHER_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={chip === c.id && !searching}
              className={`tsl-chip ${chip === c.id && !searching ? 'is-active' : ''}`}
              onClick={() => { setChip(c.id); setQuery('') }}
            >
              {c.id === 'recent' ? <BarChart3 size={14} strokeWidth={2} aria-hidden="true" /> : null}
              {c.id === 'favourites' ? <Star size={14} strokeWidth={2} aria-hidden="true" /> : null}
              {c.id === 'all' ? <LayoutGrid size={14} strokeWidth={2} aria-hidden="true" /> : null}
              {c.label}
            </button>
          ))}
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

      {/* ── Recently used ──────────────────────────────────────────── */}
      {!searching && chip === 'all' && categoryFilter === 'all' ? (
        <RecentStudios studios={recentList} columns={columns} renderIcon={renderIcon} />
      ) : null}

      {/* ── Category sections ──────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div className="tsl-empty">
          <Bell size={22} strokeWidth={1.75} aria-hidden="true" />
          {searching
            ? <p>No tools match “{query.trim()}”. Try another word.</p>
            : chip === 'favourites'
              ? <p>No favourites yet. Open a tool’s info card and choose <strong>Add to favourites</strong>.</p>
              : <p>Nothing to show here yet.</p>}
        </div>
      ) : (
        categoriesToShow.map((c) => (
          <StudioCategory
            key={c.id}
            id={c.id}
            label={c.label}
            studios={c.studios}
            columns={columns}
            collapsed={collapsed.has(c.id)}
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
          onClose={() => setSheetStudio(null)}
        />
      ) : null}
    </section>
  )
}
