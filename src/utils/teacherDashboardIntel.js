/**
 * Teacher dashboard intelligence — pure, side-effect-free helpers that turn a
 * teacher's saved resources + usage snapshot into the personalised copy the
 * redesigned dashboard renders (time greeting, the single "most useful" AI
 * message, rotating insights, activity stat cards with trends, and milestone
 * celebrations).
 *
 * Everything here is deliberately framework-free and takes an explicit `now`
 * (ms) so it runs under plain `node` in teacherDashboardIntel.test.js. The
 * caller (TeacherDashboard.jsx) normalises generations + test papers into the
 * `resource` shape below before handing them in; titles/routes are computed
 * there (they need titleForGeneration which pulls in Firestore), so this file
 * never imports anything.
 *
 * Normalised resource shape:
 *   { id, kind:'generation'|'assessment', tool, subject, grade, topic,
 *     createdAt (ms), title, to, status:'draft'|'ready' }
 */

const DAY = 24 * 60 * 60 * 1000

function cleanSubject(s) {
  return String(s || '').replace(/_/g, ' ').trim()
}

/* ── Greeting ─────────────────────────────────────────────────────────── */

// Pure on the hour so it's deterministic in tests; getTimeGreeting reads the
// device clock and delegates here.
export function greetingForHour(hour, name) {
  const safeName = (name && String(name).trim()) || 'there'
  let emoji = '☀️'
  let label = 'Good afternoon'
  if (hour < 12) {
    emoji = '🌅'
    label = 'Good morning'
  } else if (hour >= 17) {
    emoji = '🌙'
    label = 'Good evening'
  }
  // 'morning' | 'afternoon' | 'evening' also drives the hero illustration.
  const part = hour < 12 ? 'morning' : hour >= 17 ? 'evening' : 'afternoon'
  return { emoji, label, part, text: `${label}, ${safeName}` }
}

export function getTimeGreeting(now = Date.now(), name) {
  return greetingForHour(new Date(now).getHours(), name)
}

/* ── Activity windows ─────────────────────────────────────────────────── */

function inWindow(resource, now, fromDaysAgo, toDaysAgo = 0) {
  const age = now - (resource.createdAt || 0)
  return age >= toDaysAgo * DAY && age < fromDaysAgo * DAY
}

function countWhere(resources, fn) {
  let n = 0
  for (const r of resources) if (fn(r)) n++
  return n
}

function lastNDays(resources, now, days) {
  return countWhere(resources, (r) => inWindow(r, now, days))
}

// Subjects the teacher actually uses, ranked by how many resources reference
// them. Drives the "favourite subject" recommendation + several insights.
function subjectCounts(resources) {
  const map = new Map()
  for (const r of resources) {
    const s = cleanSubject(r.subject)
    if (!s) continue
    map.set(s, (map.get(s) || 0) + 1)
  }
  return map
}

export function favouriteSubject(resources = []) {
  let best = null
  let bestN = 0
  for (const [subject, n] of subjectCounts(resources)) {
    if (n > bestN) {
      best = subject
      bestN = n
    }
  }
  return best
}

// The subject a teacher leans on but hasn't touched in a while — "Integrated
// Science hasn't been updated for 5 days." Only fires for subjects with at
// least two resources so a single old item doesn't nag.
function staleSubject(resources, now, minDays = 5) {
  let pick = null
  for (const [subject, n] of subjectCounts(resources)) {
    if (n < 2) continue
    let newest = 0
    for (const r of resources) {
      if (cleanSubject(r.subject) === subject) newest = Math.max(newest, r.createdAt || 0)
    }
    const days = Math.floor((now - newest) / DAY)
    if (days >= minDays && (!pick || n > pick.count)) {
      pick = { subject, days, count: n }
    }
  }
  return pick
}

/* ── The single "most useful" AI message ──────────────────────────────── */

export function buildAiMessage({ resources = [], usage = null, now = Date.now() } = {}) {
  const drafts = resources.filter((r) => r.status === 'draft')
  const thisWeek = lastNDays(resources, now, 7)
  const remaining = usage ? Math.max(0, (usage.daily || 0) - (usage.today || 0)) : null

  // 1. Out of daily generations — the most blocking state.
  if (usage && usage.daily > 0 && remaining === 0) {
    return "You've used all of today's AI generations. They reset at midnight."
  }

  // 2. Unfinished work waiting (drafts).
  if (drafts.length === 1) {
    return `Your ${drafts[0].title || 'draft test paper'} is waiting to be finished.`
  }
  if (drafts.length > 1) {
    return `You have ${drafts.length} unpublished test papers waiting.`
  }

  // 3. A trusted subject has gone quiet.
  const stale = staleSubject(resources, now)
  if (stale) {
    return `${stale.subject} hasn't been updated for ${stale.days} days.`
  }

  // 4. Busy, productive week — celebrate the momentum.
  if (thisWeek >= 5) {
    return `You've created ${thisWeek} resources this week — great momentum.`
  }

  // 5. Plenty of headroom today — nudge them to use it.
  if (usage && remaining > 0) {
    return `You have ${remaining} AI generation${remaining === 1 ? '' : 's'} remaining today.`
  }

  // 6. Fallbacks.
  return resources.length
    ? "Welcome back — let's continue where you left off."
    : "Welcome! Let's create your first lesson."
}

/* ── Rotating AI insights ─────────────────────────────────────────────── */

export function buildInsights({ resources = [], usage = null, now = Date.now() } = {}) {
  const out = []
  const plansMonth = countWhere(resources, (r) => r.tool === 'lesson_plan' && inWindow(r, now, 30))
  const thisWeek = lastNDays(resources, now, 7)
  const drafts = resources.filter((r) => r.status === 'draft')
  const subjects = subjectCounts(resources)
  const fav = favouriteSubject(resources)
  const hasScheme = new Set(
    resources.filter((r) => r.tool === 'scheme_of_work').map((r) => cleanSubject(r.subject)),
  )
  const hasSba = countWhere(resources, (r) => r.tool === 'sba_task' && inWindow(r, now, 30)) > 0

  if (plansMonth > 0) {
    out.push({ id: 'plans-month', icon: '📌', text: `You created ${plansMonth} lesson plan${plansMonth === 1 ? '' : 's'} this month.` })
  }

  // A subject with lessons but no scheme of work is a real planning gap.
  for (const [subject, n] of subjects) {
    if (n >= 2 && !hasScheme.has(subject)) {
      out.push({ id: `scheme-${subject}`, icon: '📌', text: `${subject} has no Scheme of Work yet.` })
      break
    }
  }

  if (fav) {
    out.push({ id: 'favourite', icon: '📌', text: `Your ${fav} resources are your most used.` })
  }

  if (drafts.length > 0) {
    out.push({ id: 'drafts', icon: '📌', text: `${drafts.length} test paper${drafts.length === 1 ? ' is' : 's are'} waiting to be published.` })
  }

  if (!hasSba && resources.length >= 3) {
    out.push({ id: 'no-sba', icon: '📌', text: "You haven't created any SBA tasks this month." })
  }

  if (thisWeek > 0) {
    out.push({ id: 'week', icon: '📌', text: `You added ${thisWeek} new resource${thisWeek === 1 ? '' : 's'} this week.` })
  }

  if (resources.length > 0) {
    out.push({ id: 'library', icon: '📌', text: `Your library holds ${resources.length} saved resource${resources.length === 1 ? '' : 's'}.` })
  }

  if (usage && usage.daily > 0) {
    const remaining = Math.max(0, (usage.daily || 0) - (usage.today || 0))
    out.push({ id: 'usage', icon: '📌', text: `You have ${remaining} AI generation${remaining === 1 ? '' : 's'} left today.` })
  }

  if (out.length === 0) {
    out.push({ id: 'start', icon: '📌', text: 'Generate your first CBC-aligned resource to unlock insights.' })
  }
  return out
}

// Rotate through the insight list so the dashboard surfaces a fresh 2–3 each
// time without any timers — the slot advances roughly every 30 minutes.
export function rotateInsights(insights, now = Date.now(), take = 3) {
  if (insights.length <= take) return insights
  const step = Math.floor(now / (30 * 60 * 1000)) % insights.length
  const out = []
  for (let i = 0; i < take; i++) out.push(insights[(step + i) % insights.length])
  return out
}

/* ── Activity stat cards with trends ──────────────────────────────────── */

function trend(cur, prev) {
  if (prev === 0) return cur > 0 ? { dir: 'up', pct: 100 } : { dir: 'flat', pct: 0 }
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct > 0) return { dir: 'up', pct }
  if (pct < 0) return { dir: 'down', pct: Math.abs(pct) }
  return { dir: 'flat', pct: 0 }
}

export function buildActivityStats({ resources = [], now = Date.now(), range = 'month' } = {}) {
  const totalOf = (fn) => countWhere(resources, fn)
  const win = (fn, from, to) => countWhere(resources, (r) => fn(r) && inWindow(r, now, from, to))

  const isPlan = (r) => r.tool === 'lesson_plan'
  const isNote = (r) => r.tool === 'notes'
  const isTest = (r) => r.kind === 'quiz' || r.kind === 'assessment' || r.tool === 'assessment'

  // 'week' compares the last 7 days to the 7 before; 'month' the last 30 to the
  // 30 before. The basis string is the human label the cards print verbatim.
  const span = range === 'week' ? 7 : 30
  const basis = range === 'week' ? 'vs last week' : 'vs last month'
  const t = (fn) => ({ ...trend(win(fn, span, 0), win(fn, span * 2, span)), basis })

  return [
    { key: 'plans', label: 'Lesson plans', total: totalOf(isPlan), trend: t(isPlan) },
    { key: 'notes', label: 'Notes', total: totalOf(isNote), trend: t(isNote) },
    { key: 'tests', label: 'Test papers', total: totalOf(isTest), trend: t(isTest) },
    { key: 'library', label: 'Total in library', total: resources.length, trend: t(() => true) },
    {
      key: 'week',
      label: range === 'week' ? 'New this week' : 'New this month',
      total: win(() => true, span, 0),
      trend: t(() => true),
    },
  ]
}

/* ── Milestone celebrations ───────────────────────────────────────────── */

const RESOURCE_MILESTONES = {
  1: { emoji: '🎉', text: 'Your first resource is saved — welcome aboard!' },
  50: { emoji: '👏', text: 'Library milestone — 50 resources created.' },
  100: { emoji: '🏅', text: '100 resources in your library. Incredible.' },
  250: { emoji: '🌟', text: '250 resources — you are a power planner.' },
  500: { emoji: '📚', text: 'Library reached 500 resources!' },
  1000: { emoji: '🚀', text: '1,000 resources created. Legendary.' },
}

const PLAN_MILESTONES = {
  1: { emoji: '🎉', text: 'First lesson plan created.' },
  25: { emoji: '⭐', text: '25 lesson plans planned and saved.' },
  100: { emoji: '🏆', text: '100 lesson plans completed.' },
}

// Fires only when a count lands *exactly* on a milestone, so the banner shows
// right after the teacher crosses it and clears on their next creation —
// never a banner that lingers every visit.
export function buildCelebrations({ resources = [] } = {}) {
  const out = []
  const total = resources.length
  const plans = countWhere(resources, (r) => r.tool === 'lesson_plan')

  if (PLAN_MILESTONES[plans]) {
    out.push({ id: `plan-${plans}`, ...PLAN_MILESTONES[plans] })
  }
  if (RESOURCE_MILESTONES[total] && total !== 1) {
    out.push({ id: `lib-${total}`, ...RESOURCE_MILESTONES[total] })
  } else if (total === 1 && plans !== 1) {
    out.push({ id: 'lib-1', ...RESOURCE_MILESTONES[1] })
  }
  return out
}
