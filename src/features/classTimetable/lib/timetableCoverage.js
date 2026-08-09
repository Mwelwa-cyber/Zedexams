/**
 * Curriculum coverage in a school's OWN units — time first, periods second.
 *
 * The official Upper Primary table is 28 hours a week expressed as 42
 * forty-minute periods (English 4h00 = 6, Maths 4h00 = 6, Science 4h00 = 6,
 * Zambian Language 3h20 = 5, Social Studies 3h20 = 5, Technology Studies
 * 4h40 = 7, Expressive Arts OR Home Economics 4h40 = 7). The PERIOD counts
 * are a consequence of the 40-minute lesson, not the requirement — so a
 * private school running 60-minute lessons does not owe "6 periods of
 * English", it owes 4 hours of English, which is 4 lessons. Converting the
 * period count instead of the time is simply wrong, and it is the mistake
 * this module exists to prevent.
 *
 * The second thing it decides is the coverage TARGET. A shift session (see
 * timetableSessions.js) mathematically cannot hold the 28-hour week, so its
 * target is its own capacity and every subject is scaled to fit — with
 * `core-first` (protect English, Mathematics and Science at full official
 * time) as the default, because that is how real shift-school timetables are
 * actually built.
 *
 * Pure and DOM-free so `node` can unit test it
 * (scripts/test-timetable-coverage.mjs).
 */

/* ── Allocation strategies (shift sessions only) ──────────────── */

export const ALLOCATION_STRATEGIES = [
  {
    id: 'core-first',
    label: 'Core-first',
    hint: 'Protect English, Mathematics and Science at their full official time; scale the other subjects down proportionally.',
  },
  {
    id: 'proportional',
    label: 'Proportional',
    hint: 'Every subject keeps the same share of the time the session actually has.',
  },
]

export const DEFAULT_ALLOCATION_STRATEGY = 'core-first'

export function getAllocationStrategy(id) {
  return ALLOCATION_STRATEGIES.find((s) => s.id === id) || ALLOCATION_STRATEGIES[0]
}

/**
 * The three areas a Zambian shift timetable protects first. Matched on the
 * canonical names AND the integrated Lower Primary spellings ("Mathematics
 * and Science", "Literacy and Language — English Language"), so the same
 * rule holds across every band.
 */
export function isCoreSubject(label) {
  const s = String(label || '').toLowerCase()
  return /\bmath|\bscien|\bengl?ish\b|\bliterac/.test(s)
}

/* ── Time formatting ──────────────────────────────────────────── */

/** 1160 → "19h 20m"; 1680 → "28h". Negative/NaN → "0h". */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!m) return `${h}h`
  return h ? `${h}h ${m}m` : `${m}m`
}

/** The framework's own allocation spelling: 240 → "4h00", 200 → "3h20". */
export function formatAllocation(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

/* ── Time → lessons ───────────────────────────────────────────── */

/**
 * A subject's weekly TIME converted into a school's own lessons.
 *
 * Rounds to the nearest whole lesson and reports the remainder in minutes
 * (positive = the lessons run OVER the official time, negative = under), so
 * the studio can show "4 lessons · 20 min over" rather than silently
 * pretending the conversion was exact.
 */
export function convertToLessons(weeklyMinutes, lessonMinutes) {
  const mins = Math.max(0, Math.round(Number(weeklyMinutes) || 0))
  const len = Math.max(1, Math.round(Number(lessonMinutes) || 0))
  if (!mins) return { lessons: 0, remainderMinutes: 0, exact: true }
  const lessons = Math.max(1, Math.round(mins / len))
  const remainderMinutes = lessons * len - mins
  return { lessons, remainderMinutes, exact: remainderMinutes === 0 }
}

/** "English — 4h00/wk → 4 × 60-min lessons" (+ the rounding note). */
export function describeConversion({ label, weeklyMinutes, lessons, remainderMinutes, lessonMinutes }) {
  const base = `${label} — ${formatAllocation(weeklyMinutes)}/wk → ${lessons} × ${lessonMinutes}-min lesson${lessons === 1 ? '' : 's'}`
  if (!remainderMinutes) return base
  const over = remainderMinutes > 0
  return `${base} (${Math.abs(remainderMinutes)} min ${over ? 'over' : 'under'})`
}

/* ── Weekly targets ───────────────────────────────────────────── */

function officialMinutesOf(subject, curriculumPeriodMinutes) {
  const explicit = Number(subject?.weeklyMinutes)
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit)
  const periods = Math.max(0, Math.round(Number(subject?.periodsPerWeek) || 0))
  return periods * Math.max(0, Math.round(Number(curriculumPeriodMinutes) || 0))
}

/**
 * Split `available` lessons across rows in proportion to their target
 * minutes, using largest-remainder so the parts sum to EXACTLY `available`.
 * Every row carrying official time is guaranteed at least one lesson when
 * there are enough to go round — a subject whose target rounds to zero can
 * never reach "✓", which is the whole point of scaling in the first place.
 */
function distributeLessons(rows, available, lessonMinutes) {
  const wanted = rows.map((r) => r.targetMinutes / lessonMinutes)
  const base = wanted.map((x) => Math.floor(x))
  let assigned = base.reduce((a, b) => a + b, 0)
  const order = rows.map((_, i) => i).sort((a, b) => (wanted[b] - base[b]) - (wanted[a] - base[a]))
  for (let k = 0; assigned < available && k < order.length; k += 1) { base[order[k]] += 1; assigned += 1 }
  // Still short after one pass (many tiny fractions) — top up the biggest.
  while (assigned < available) {
    let big = 0
    for (let i = 1; i < base.length; i += 1) if (wanted[i] > wanted[big]) big = i
    base[big] += 1
    assigned += 1
  }
  while (assigned > available) {
    let biggest = -1
    for (let i = 0; i < base.length; i += 1) if (base[i] > 1 && (biggest < 0 || base[i] > base[biggest])) biggest = i
    if (biggest < 0) break
    base[biggest] -= 1
    assigned -= 1
  }
  // Floor of one lesson each, funded by the largest allocations.
  if (available >= rows.length) {
    for (let i = 0; i < base.length; i += 1) {
      if (base[i] > 0) continue
      let donor = -1
      for (let j = 0; j < base.length; j += 1) {
        if (base[j] > 1 && (donor < 0 || base[j] > base[donor])) donor = j
      }
      if (donor < 0) break
      base[donor] -= 1
      base[i] += 1
    }
  }
  return base
}

/**
 * The per-subject weekly targets for THIS school's day.
 *
 * Three things happen here, in order:
 *   1. every curriculum subject's official weekly TIME is read (never its
 *      period count — see the module note),
 *   2. when the session cannot hold the full week, the time is scaled by the
 *      chosen strategy,
 *   3. the resulting time is converted into whole lessons of the school's
 *      own length, summing to exactly the capacity when scaled.
 *
 * School subjects (`schoolSubject: true`) keep the teacher's own lesson
 * count verbatim and never enter curriculum accounting — they simply
 * consume capacity before the curriculum is scaled into what is left.
 *
 * @param {Object}  args
 * @param {Array}   args.subjects            studio subject rows
 * @param {number}  args.lessonMinutes       this school's lesson length
 * @param {number}  args.curriculumPeriodMinutes  the framework's period length
 * @param {number|null} args.capacityLessons the week's total lesson slots
 *                                           (null → no cap, no scaling)
 * @param {string}  args.strategy            'core-first' | 'proportional'
 */
export function resolveSubjectTargets({
  subjects,
  lessonMinutes,
  curriculumPeriodMinutes = 0,
  capacityLessons = null,
  strategy = DEFAULT_ALLOCATION_STRATEGY,
} = {}) {
  const len = Math.max(1, Math.round(Number(lessonMinutes) || 0))
  const list = Array.isArray(subjects) ? subjects : []

  const schoolRows = list.filter((s) => s?.schoolSubject && s.selected !== false)
  const schoolLessons = schoolRows.reduce((n, s) => n + Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)), 0)

  const curriculumRows = list
    .filter((s) => s && !s.schoolSubject && s.selected !== false)
    .map((s) => ({
      id: s.id,
      subjectId: s.subjectId || s.id || null,
      label: s.label,
      officialMinutes: officialMinutesOf(s, curriculumPeriodMinutes),
      core: isCoreSubject(s.label),
    }))
    .filter((r) => r.officialMinutes > 0)

  const officialTotal = curriculumRows.reduce((n, r) => n + r.officialMinutes, 0)
  const availableLessons = capacityLessons == null
    ? null
    : Math.max(0, Math.round(Number(capacityLessons) || 0) - schoolLessons)
  const availableMinutes = availableLessons == null ? null : availableLessons * len
  const scaled = availableMinutes != null && officialTotal > 0 && availableMinutes < officialTotal

  let targets = curriculumRows.map((r) => ({ ...r, targetMinutes: r.officialMinutes }))
  if (scaled) {
    const coreTotal = curriculumRows.filter((r) => r.core).reduce((n, r) => n + r.officialMinutes, 0)
    const restTotal = officialTotal - coreTotal
    const useCoreFirst = strategy === 'core-first' && coreTotal > 0 && coreTotal < availableMinutes && restTotal > 0
    if (useCoreFirst) {
      const forRest = availableMinutes - coreTotal
      targets = curriculumRows.map((r) => ({
        ...r,
        targetMinutes: r.core ? r.officialMinutes : (r.officialMinutes * forRest) / restTotal,
      }))
    } else {
      targets = curriculumRows.map((r) => ({
        ...r,
        targetMinutes: (r.officialMinutes * availableMinutes) / officialTotal,
      }))
    }
  }

  let lessonsByIndex
  if (scaled) {
    lessonsByIndex = distributeLessons(targets, availableLessons, len)
  } else {
    lessonsByIndex = targets.map((r) => convertToLessons(r.officialMinutes, len).lessons)
  }

  const rows = targets.map((r, i) => {
    const lessons = lessonsByIndex[i]
    const minutes = lessons * len
    return {
      id: r.id,
      subjectId: r.subjectId,
      label: r.label,
      core: r.core,
      schoolSubject: false,
      officialMinutes: r.officialMinutes,
      targetMinutes: minutes,
      lessons,
      remainderMinutes: minutes - r.officialMinutes,
      scaled,
    }
  })

  const schoolRowsOut = schoolRows.map((s) => ({
    id: s.id,
    subjectId: s.subjectId || s.id || null,
    label: s.label,
    core: false,
    schoolSubject: true,
    officialMinutes: 0,
    targetMinutes: Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)) * len,
    lessons: Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)),
    remainderMinutes: 0,
    scaled: false,
  }))

  return {
    strategy: scaled ? strategy : null,
    scaled,
    lessonMinutes: len,
    capacityLessons,
    availableLessons,
    rows,
    schoolRows: schoolRowsOut,
    totals: {
      officialMinutes: officialTotal,
      targetMinutes: rows.reduce((n, r) => n + r.targetMinutes, 0),
      targetLessons: rows.reduce((n, r) => n + r.lessons, 0),
      schoolLessons,
    },
  }
}

/* ── The coverage chip ────────────────────────────────────────── */

/**
 * Which units the coverage chip is TRUTHFUL in.
 *
 * Periods only when every lesson really is one curriculum period — same
 * length, uniform across the week. The moment a school runs 60-minute
 * lessons, or types its own period times, "38/42" stops meaning anything
 * and the chip must speak in hours.
 */
export function resolveCoverageUnit({ lessonMinutes, curriculumPeriodMinutes, uniformLessons = true }) {
  if (!uniformLessons) return 'hours'
  if (!curriculumPeriodMinutes) return 'periods'
  return Math.round(Number(lessonMinutes) || 0) === Math.round(Number(curriculumPeriodMinutes) || 0)
    ? 'periods'
    : 'hours'
}

/**
 * The workspace chip text.
 *
 * For a shift session the target IS the session's capacity, so a full
 * session reads "19h 20m of 19h 20m placed ✓" — success is filling the
 * session well, not reaching an impossible 28 hours.
 *
 * @returns {{ text:string, complete:boolean, shortfall:number }}
 */
export function formatCoverage({
  placedLessons = 0, targetLessons = 0,
  placedMinutes = 0, targetMinutes = 0,
  unit = 'periods',
}) {
  const complete = unit === 'hours'
    ? targetMinutes > 0 && placedMinutes >= targetMinutes
    : targetLessons > 0 && placedLessons >= targetLessons
  const text = unit === 'hours'
    ? `${formatDuration(placedMinutes)} of ${formatDuration(targetMinutes)} placed${complete ? ' ✓' : ''}`
    : `${placedLessons}/${targetLessons} placed${complete ? ' ✓' : ''}`
  const shortfall = unit === 'hours'
    ? Math.max(0, targetMinutes - placedMinutes)
    : Math.max(0, targetLessons - placedLessons)
  return { text, complete, shortfall }
}
