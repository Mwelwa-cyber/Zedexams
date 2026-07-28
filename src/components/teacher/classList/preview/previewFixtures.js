/**
 * previewFixtures — a real Zambian class, for the preview route.
 *
 * Grade 4A at Jemareen Academy: 86 learners, Term 2 of 2026, the term running
 * 11 May to 7 August. Every name is Zambian, every admission number follows a
 * school's own numbering, and the attendance is the shape a real term has —
 * mostly present, a handful of exceptions, one learner who joined in June and
 * one who transferred out in July.
 *
 * No lorem ipsum, and nothing that flatters the design: the fixture
 * deliberately contains the awkward cases the screens have to survive — two
 * learners with the same name, a name long enough to need truncating, learners
 * with no admission number, a day nobody finished marking. A preview built on
 * eighty-six tidy rows proves nothing about the screen that ships.
 */

// Zambian given names and surnames, combined deterministically so the fixture
// is the same on every run — a preview whose content changes between renders
// cannot be compared to the one before it.
const GIVEN = [
  'Alex', 'Bright', 'Naomi', 'Chanda', 'Ruth', 'Kelvin', 'Blessings', 'Samuel',
  'Mary', 'John', 'Grace', 'Peter', 'Esther', 'David', 'Joyce', 'Emmanuel',
  'Mutinta', 'Chipo', 'Lubasi', 'Nsofwa', 'Thandiwe', 'Mwansa', 'Kabwe', 'Temwani',
  'Bupe', 'Chikondi', 'Mapalo', 'Sepo', 'Namakau', 'Wezi', 'Chimwemwe', 'Kondwani',
]
const SURNAME = [
  'Lobela', 'Kapaso', 'Chipeta', 'Mulenga', 'Mwila', 'Banda', 'Phiri', 'Zulu',
  'Tembo', 'Sakala', 'Mwale', 'Nkonde', 'Zimba', 'Musonda', 'Chileshe', 'Daka',
  'Sinkala', 'Mwape', 'Kunda', 'Chanda', 'Nyirenda', 'Simukonda', 'Muyunda', 'Hachipuka',
]

const PHONE_PREFIX = ['097', '096', '095', '076']

function phoneFor(i) {
  return `${PHONE_PREFIX[i % PHONE_PREFIX.length]}7 ${String(100 + (i * 37) % 900)} ${String(1000 + (i * 131) % 9000)}`
}

/** The 86 learners of Grade 4A. */
export const PREVIEW_LEARNERS = Array.from({ length: 86 }, (_, i) => {
  const n = i + 1
  const given = GIVEN[i % GIVEN.length]
  const surname = SURNAME[(i * 7) % SURNAME.length]

  const learner = {
    id: `learner-${n}`,
    learnerId: `lrn_preview_${n}`,
    order: n,
    learnerNumber: String(n),
    admissionNumber: `ADM-${String(n).padStart(3, '0')}`,
    fullName: `${given} ${surname}`,
    gender: n % 2 === 0 ? 'F' : 'M',
    parentPhone: phoneFor(i),
    admissionDate: '2026-01-12',
    joinedClassOn: '2026-01-12',
    leftClassOn: null,
    status: 'active',
    needsReview: false,
    reviewReasons: [],
    source: 'capture',
    updatedAt: Date.UTC(2026, 6, 28, 12, 0) + i * 60000,
  }

  // ── the awkward cases the screens must survive ──

  // A record read from a photograph with no admission number on the page.
  if (n === 3) {
    return {
      ...learner,
      fullName: 'Naomi Chipeta',
      admissionNumber: null,
      needsReview: true,
      reviewReasons: ['missing_admission_number', 'low_confidence'],
    }
  }
  // The same child, written twice — once in full and once with an initial,
  // one of them with no admission number. Everything that IS known about the
  // two agrees, so the class list must offer this as a possible duplicate.
  if (n === 4) return { ...learner, fullName: 'Chanda Mulenga', gender: 'F' }
  if (n === 41) {
    return {
      ...learner,
      fullName: 'Chanda M. Mulenga',
      admissionNumber: null,
      gender: 'F',
      needsReview: true,
      reviewReasons: ['possible_duplicate'],
    }
  }
  // Two REAL namesakes — identical names, two admission numbers. Two unrelated
  // Ruth Mwilas in one Grade 4 is ordinary in a Zambian school, and the class
  // list must leave them alone. The preview carries this case precisely
  // because it is the one a duplicate check gets wrong, and getting it wrong
  // destroys a child's attendance history.
  if (n === 5) return { ...learner, fullName: 'Ruth Mwila', gender: 'F' }
  if (n === 63) {
    return { ...learner, fullName: 'Ruth Mwila', gender: 'F', admissionNumber: 'ADM-063' }
  }
  // A name long enough to need truncating rather than breaking the row.
  if (n === 12) return { ...learner, fullName: 'Mwansa Chileshe-Nyirenda Simukonda' }
  // Gender never recorded — the "missing information" filter must find it.
  if (n === 6) return { ...learner, fullName: 'Kelvin Banda', gender: null }
  // Joined in the middle of the term. Days before this show N/A.
  if (n === 55) return { ...learner, admissionDate: '2026-06-08', joinedClassOn: '2026-06-08' }
  // Transferred out in July. Days after this show N/A; nothing is deleted.
  if (n === 72) {
    return {
      ...learner,
      status: 'transferred',
      leftClassOn: '2026-07-10',
      leavingReason: 'Transferred to another school',
      destinationSchool: 'Kabulonga Primary School',
    }
  }
  // Withdrawn under the retired 'inactive' spelling, to prove a stored legacy
  // value still reads correctly.
  if (n === 80) return { ...learner, status: 'inactive', leftClassOn: '2026-05-29' }

  return learner
})

export const PREVIEW_REGISTER = {
  id: 'preview-grade-4a',
  className: 'Grade 4A',
  grade: '4',
  stream: 'A',
  year: 2026,
  curriculum: 'cbc',
  school: 'Jemareen Academy',
  classTeacherName: 'Mahenga Mwelwa',
  classTeacherUid: 'preview-teacher',
  teacherUid: 'preview-teacher',
  status: 'active',
  learnerCount: PREVIEW_LEARNERS.filter((l) => l.status === 'active').length,
  // Deliberately carried, so the preview shows the migration notice a real
  // pre-split class produces.
  term: 'Term 2',
  subject: 'Mathematics',
}

export const PREVIEW_TERM = {
  termLabel: 'Term 2',
  year: 2026,
  startDate: '2026-05-11',
  endDate: '2026-08-07',
  source: 'moe',
  datasetId: 'moe-2026',
}

export const PREVIEW_TODAY = '2026-07-28'

const ZM_HOLIDAYS = {
  '2026-05-25': 'Africa Freedom Day',
  '2026-07-06': 'Heroes’ Day',
  '2026-07-07': 'Unity Day',
}

function isoRange(from, to) {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/**
 * The term's days, with attendance already recorded up to the day before
 * "today" — the state a teacher's register is actually in when they open it in
 * week eleven, not an empty grid.
 *
 * The pattern is deliberate rather than random: nearly everybody present, one
 * learner absent three days running (which the insights must find), another
 * missing Mondays, a sick learner, a late learner, and one recent day left
 * part-marked so "unmarked is not absent" is visible on screen.
 */
export const PREVIEW_DAYS = isoRange(PREVIEW_TERM.startDate, PREVIEW_TERM.endDate).map((date) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const isWeekend = weekday === 0 || weekday === 6
  const holiday = ZM_HOLIDAYS[date]
  const markable = !isWeekend && !holiday
  const isFuture = date > PREVIEW_TODAY

  const day = {
    date,
    markable,
    isFuture,
    isWeekend,
    holidayName: holiday || null,
    classification: markable ? 'teaching_day' : 'non_teaching_day',
    records: {},
  }
  if (!markable || isFuture) return day

  const dayIndex = isoRange(PREVIEW_TERM.startDate, date).filter((d) => {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
    return wd !== 0 && wd !== 6 && !ZM_HOLIDAYS[d]
  }).length

  for (const learner of PREVIEW_LEARNERS) {
    if (learner.joinedClassOn && date < learner.joinedClassOn) continue
    if (learner.leftClassOn && date > learner.leftClassOn) continue

    // Today is only part-marked — the state a register is in mid-morning.
    if (date === PREVIEW_TODAY && Number(learner.learnerNumber) > 30) continue

    let status = 'present'
    // Naomi Chipeta: three consecutive teaching days, the week just gone.
    if (learner.id === 'learner-3' && ['2026-07-22', '2026-07-23', '2026-07-24'].includes(date)) status = 'absent'
    // Kelvin Banda: Mondays, and almost only Mondays. The threshold in
    // weekdayPattern is deliberately strict — it wants the misses to be MOST
    // of the learner's absences AND at least half of that weekday's occasions,
    // because four missed Mondays out of twelve is four absences, not a
    // pattern. The fixture has to clear that bar to demonstrate the insight.
    else if (learner.id === 'learner-6' && weekday === 1 && dayIndex > 12) status = 'absent'
    // Bright Kapaso: attendance falling away in the second half of the term.
    else if (learner.id === 'learner-2' && dayIndex > 30 && dayIndex % 3 === 0) status = 'absent'
    else if (learner.id === 'learner-5' && dayIndex % 17 === 0) status = 'sick'
    else if (learner.id === 'learner-8' && dayIndex % 11 === 0) status = 'late'
    else if (learner.id === 'learner-9' && dayIndex % 23 === 0) status = 'excused'

    day.records[learner.id] = { status }
  }
  return day
})

/**
 * A stand-in for useClassRegister, for the preview only.
 *
 * It exposes the same shape and NO Firestore. Every mutation is local state,
 * so the preview is genuinely interactive — a reviewer can press Mark all
 * present and watch the totals move — without a project, an account, or a
 * write reaching anything.
 */
export function buildPreviewRegisterHook(overrides = {}) {
  const selectedDate = overrides.selectedDate || PREVIEW_TODAY
  const today = PREVIEW_DAYS.find((d) => d.date === selectedDate)
  return {
    classId: PREVIEW_REGISTER.id,
    roster: PREVIEW_LEARNERS,
    termInfo: PREVIEW_TERM,
    termId: '2026-term-2',
    termState: 'draft',
    termDoc: { policy: {} },
    termDayDocs: [],
    termDocLoaded: true,
    isEceClass: false,
    days: PREVIEW_DAYS,
    daysWithRecords: PREVIEW_DAYS,
    todayIso: PREVIEW_TODAY,
    selectedDate,
    setSelectedDate: () => {},
    displayedRecords: today?.records || {},
    setStatus: () => {},
    setNote: () => {},
    markAllPresent: () => 0,
    undoLast: () => false,
    canUndo: false,
    saveState: 'saved',
    pendingCount: 0,
    pendingLearnerIds: new Set(),
    syncIssues: [],
    retry: () => {},
    saveNow: () => {},
    hydrated: true,
    loadError: false,
    remoteEditNotice: null,
    dismissRemoteEditNotice: () => {},
    resolveConflict: () => {},
    retryRejected: () => {},
    discardRejected: () => {},
    ...overrides,
  }
}

/** Rows as they come off a three-page capture, for the review preview. */
export const PREVIEW_EXTRACTED_ROWS = [
  { fullName: 'Alex Lobela', admissionNumber: 'ADM-001', gender: 'M', parentPhone: '0977 123 456', confidence: 0.98, source: 'capture', sourcePagePosition: 1, sourceRowIndex: 0 },
  { fullName: 'Bright Kapaso', admissionNumber: 'ADM-002', gender: 'M', parentPhone: '0966 987 654', confidence: 0.97, source: 'capture', sourcePagePosition: 1, sourceRowIndex: 1 },
  { fullName: 'Chanda Mulenga', admissionNumber: 'ADM-004', gender: 'F', parentPhone: '0961 112 233', confidence: 0.95, source: 'capture', sourcePagePosition: 1, sourceRowIndex: 2 },
  { fullName: 'Chanda Mulenqa', admissionNumber: null, gender: 'F', confidence: 0.58, source: 'capture', sourcePagePosition: 2, sourceRowIndex: 4 },
  { fullName: 'Ruth Mwila', admissionNumber: 'ADM-005', gender: 'F', parentPhone: '0954 446 677', confidence: 0.94, source: 'capture', sourcePagePosition: 2, sourceRowIndex: 5 },
  { fullName: 'Kelvin Banda', admissionNumber: 'ADM-006', gender: null, confidence: 0.72, source: 'capture', sourcePagePosition: 2, sourceRowIndex: 6 },
  { fullName: 'Blessings Phiri', admissionNumber: 'ADM-007', gender: 'F', parentPhone: '0963 217 788', confidence: 0.96, source: 'capture', sourcePagePosition: 3, sourceRowIndex: 0 },
  { fullName: 'Samuel Zulu', admissionNumber: 'ADM-008', gender: 'M', parentPhone: '0972 229 988', confidence: 0.93, source: 'capture', sourcePagePosition: 3, sourceRowIndex: 1 },
  { fullName: 'Mary Tembo', admissionNumber: null, gender: 'F', confidence: 0.81, struckThrough: true, source: 'capture', sourcePagePosition: 3, sourceRowIndex: 2 },
]

/** The learners already on the list, so the review has something to match. */
export const PREVIEW_EXISTING_FOR_REVIEW = [
  { id: 'existing-1', fullName: 'Alex Lobela', admissionNumber: 'ADM-001', gender: 'M' },
]
