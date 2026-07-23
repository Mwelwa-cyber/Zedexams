/**
 * Pure, framework-free logic for the Teacher App Launcher.
 *
 * No React / Firebase / DOM imports so it runs under plain `node` — see
 * teacherLauncherCore.test.js (npm run test:launcher-core). Everything that
 * decides WHAT to show (search, badges, favourites, recents, responsive
 * columns, popover placement) lives here; the components only render.
 */

/* ── Permissions ─────────────────────────────────────────────────────── */

/**
 * Filter studios by the viewer's role flags. Every current studio requires
 * 'teacher' (super-admins are teachers too); the shape supports future
 * per-tool gating without touching the components.
 */
export function filterStudiosByPermission(studios = [], { isTeacher = true } = {}) {
  return studios.filter((s) => {
    if (s.permission === 'teacher') return isTeacher
    return true
  })
}

/* ── Search ──────────────────────────────────────────────────────────── */

function normalize(text) {
  return String(text || '').toLowerCase().trim()
}

/**
 * Search studios by title, description and keywords. Case-insensitive,
 * whitespace-tolerant; title/prefix matches rank above description/keyword
 * matches. An empty query returns the list unchanged.
 */
export function searchStudios(studios = [], query = '') {
  const q = normalize(query)
  if (!q) return studios
  const scored = []
  for (const s of studios) {
    const title = normalize(s.title)
    const desc = normalize(s.description)
    const keywords = (s.keywords || []).map(normalize)
    let score = 0
    if (title === q) score = 100
    else if (title.startsWith(q)) score = 80
    else if (title.includes(q)) score = 60
    else if (keywords.some((k) => k.includes(q))) score = 40
    else if (desc.includes(q)) score = 20
    if (score > 0) scored.push({ s, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title))
    .map((x) => x.s)
}

/* ── Badges ──────────────────────────────────────────────────────────── */

/**
 * Resolve the single badge to render on a studio icon. Priority:
 *   1. a live saved count > 0        → { type: 'saved', label: 'N saved', count }
 *   2. a static 'new' flag           → { type: 'new', label: 'New' }
 *   3. an explicit setup/warning flag
 * `counts` is a { countKey: number } map (or null while loading).
 * Returns null when there is nothing to show.
 */
export function resolveBadge(studio, counts) {
  if (!studio) return null
  if (studio.countKey && counts && typeof counts[studio.countKey] === 'number') {
    const n = counts[studio.countKey]
    if (n > 0) return { type: 'saved', label: `${n} saved`, count: n }
  }
  if (studio.badge === 'new') return { type: 'new', label: 'New' }
  if (studio.badge === 'setup') return { type: 'setup', label: 'Setup required' }
  if (studio.badge === 'warning') return { type: 'warning', label: 'Attention' }
  return null
}

/** True while counts are still loading AND the studio would show a count. */
export function badgeIsPending(studio, counts) {
  return Boolean(studio?.countKey) && counts == null
}

/* ── Favourites ──────────────────────────────────────────────────────── */

/** Toggle a studio id in the favourites list (add to front / remove). */
export function toggleFavourite(favourites = [], id) {
  if (!id) return favourites
  if (favourites.includes(id)) return favourites.filter((f) => f !== id)
  return [id, ...favourites]
}

/** Keep only ids that still map to a real studio, in stored order. */
export function sanitizeIds(ids = [], byId = {}) {
  const seen = new Set()
  const out = []
  for (const id of ids) {
    if (byId[id] && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** The favourite studios, in stored order. */
export function favouriteStudios(favourites = [], byId = {}) {
  return sanitizeIds(favourites, byId).map((id) => byId[id])
}

/* ── Recents ─────────────────────────────────────────────────────────── */

/**
 * Push a studio id to the front of the recents list (most-recent-first),
 * de-duplicating and capping to `cap`. Pure — returns a new array.
 */
export function pushRecent(recents = [], id, cap = 12) {
  if (!id) return recents
  const next = [id, ...recents.filter((r) => r !== id)]
  return next.slice(0, Math.max(0, cap))
}

/** Recent studios (newest first), capped to `limit`. */
export function recentStudios(recents = [], byId = {}, limit = 8) {
  return sanitizeIds(recents, byId).slice(0, Math.max(0, limit)).map((id) => byId[id])
}

/* ── Chip filtering ──────────────────────────────────────────────────── */

/**
 * Apply the active chip to the studio list.
 *   recent     → recent studios (falls back to all when no history yet)
 *   favourites → favourite studios (empty allowed — the UI shows a prompt)
 *   all        → the list unchanged
 */
export function applyChip(studios = [], { chip = 'all', favourites = [], recents = [], byId = {} } = {}) {
  if (chip === 'favourites') {
    return favouriteStudios(favourites, byId).filter((s) => studios.some((x) => x.id === s.id))
  }
  if (chip === 'recent') {
    const list = recentStudios(recents, byId, studios.length).filter((s) => studios.some((x) => x.id === s.id))
    return list.length ? list : studios
  }
  return studios
}

/* ── Responsive ──────────────────────────────────────────────────────── */

/**
 * App-icon columns for a viewport width, per the design brief:
 *   < 480  → 4  |  480–639 → 5  |  640–1023 → 6  |  1024–1439 → 7  |  ≥1440 → 8
 */
export function columnsForWidth(width = 1024) {
  if (width < 480) return 4
  if (width < 640) return 5
  if (width < 1024) return 6
  if (width < 1440) return 7
  return 8
}

/** How many recent studios to surface at a viewport width (4/6/8). */
export function recentLimitForWidth(width = 1024) {
  if (width < 768) return 4
  if (width < 1024) return 6
  return 8
}

/* ── Popover placement ───────────────────────────────────────────────── */

/**
 * Choose where a hover/focus popover sits relative to its anchor, kept fully
 * inside the viewport and auto-flipping near edges.
 *
 * @param anchor   {top,left,right,bottom,width,height} in viewport coords
 * @param viewport {width,height}
 * @param size     {width,height} of the popover
 * @param gap      px between anchor and popover (default 10)
 * @returns { side: 'right'|'left'|'top'|'bottom', top, left }
 */
export function resolvePopoverPlacement(anchor, viewport, size, gap = 10) {
  const spaceRight = viewport.width - anchor.right
  const spaceLeft = anchor.left
  const spaceBelow = viewport.height - anchor.bottom
  const spaceAbove = anchor.top

  let side
  if (spaceRight >= size.width + gap) side = 'right'
  else if (spaceLeft >= size.width + gap) side = 'left'
  else if (spaceBelow >= size.height + gap) side = 'bottom'
  else if (spaceAbove >= size.height + gap) side = 'top'
  else side = spaceRight >= spaceLeft ? 'right' : 'left'

  const clamp = (v, min, max) => Math.max(min, Math.min(v, max))
  const M = 8 // viewport margin

  let top
  let left
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? anchor.right + gap : anchor.left - gap - size.width
    // Vertically centre on the anchor, then clamp inside the viewport.
    top = anchor.top + anchor.height / 2 - size.height / 2
    top = clamp(top, M, Math.max(M, viewport.height - size.height - M))
    left = clamp(left, M, Math.max(M, viewport.width - size.width - M))
  } else {
    top = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - size.height
    left = anchor.left + anchor.width / 2 - size.width / 2
    left = clamp(left, M, Math.max(M, viewport.width - size.width - M))
    top = clamp(top, M, Math.max(M, viewport.height - size.height - M))
  }

  return { side, top: Math.round(top), left: Math.round(left) }
}

/** Human "Last opened" phrase from a timestamp (ms), or null. */
export function lastOpenedLabel(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const day = 24 * 60 * 60 * 1000
  const days = Math.floor((now - ms) / day)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days <= 14) return `${days} days ago`
  const d = new Date(ms)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()} ${months[d.getMonth()]}`
}
