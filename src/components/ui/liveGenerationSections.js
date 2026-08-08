/**
 * Live Generation Canvas — pure sectioning + timeline logic.
 *
 * The Live Generation Canvas turns a finished (or in-flight) AI generation into
 * a cinematic, section-by-section reveal instead of a spinner-then-dump. This
 * module holds the framework-free, side-effect-free pieces so they unit-test
 * under plain `node` (see scripts/test-live-generation-sections.mjs):
 *
 *   1. `buildSections(result, config)` — turn a generated document object into an
 *      ordered list of display sections `{ id, title, icon, value, kind }`. The
 *      canvas renders each `value` generically (string / list / cards / fields),
 *      so a single renderer serves every studio and adding a tool is just a
 *      config entry, not a bespoke component.
 *   2. `buildTimeline(sectionTitles, config)` — the friendly "what's happening"
 *      steps shown with checkmarks: the fixed prep steps (reading teacher
 *      details → reading curriculum → checking grade/subject/topic) then one
 *      step per content section, then a final "formatting" step.
 *   3. `TOOL_SECTION_CONFIG` — per-tool ordering / labels / icons / skip lists so
 *      the same generic machinery reads well for notes, worksheets, lesson
 *      plans, rubrics, schemes, flashcards, homework, exams and weekly focus.
 *
 * The canvas never invents content: it only ever reveals what the model already
 * returned. The reveal is paced client-side (the generators return the whole
 * document at once, or stream token counts), so "section by section" is an
 * honest, staged unveiling of the real result — not fabricated streaming.
 */

/* ── key → friendly title ──────────────────────────────────────── */

/**
 * Turn an object key (`keyConcepts`, `mark_scheme`, `learningOutcomes`) into a
 * teacher-friendly Title Case label. camelCase and snake_case both split.
 *
 * @param {string} key
 * @returns {string}
 */
export function humanizeKey(key) {
  if (!key) return ''
  return String(key)
    // camelCase / PascalCase → space before capitals and digit runs
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    // snake_case / kebab-case → spaces
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    // Title Case each word, but keep short all-caps words (e.g. "SMART") as-is
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/**
 * Classify a value so the canvas knows how to render it:
 *   • 'empty'  — null/undefined/'' /[] — dropped, never shown.
 *   • 'text'   — a string or number (rendered as a paragraph).
 *   • 'list'   — an array of strings/numbers (rendered as a bullet list).
 *   • 'cards'  — an array of objects (rendered as a stack of labelled cards).
 *   • 'fields' — a plain object (rendered as label/value rows, recursing).
 *
 * @param {*} value
 * @returns {'empty'|'text'|'list'|'cards'|'fields'}
 */
export function classifyValue(value) {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'string') return value.trim() ? 'text' : 'empty'
  if (typeof value === 'number' || typeof value === 'boolean') return 'text'
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined && v !== '')
    if (items.length === 0) return 'empty'
    return items.every((v) => typeof v === 'object') ? 'cards' : 'list'
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => classifyValue(value[k]) !== 'empty')
    return keys.length ? 'fields' : 'empty'
  }
  return 'empty'
}

/* ── result → ordered display sections ─────────────────────────── */

/**
 * Default keys skipped in every studio: identity / plumbing that isn't a
 * document section a teacher wants to watch appear.
 */
const ALWAYS_SKIP = new Set([
  'header', 'meta', 'metadata', 'id', 'generationId', 'version',
  'schemaVersion',
  'title', 'schoolName', 'school', 'answerKey', 'answers',
])

/**
 * Build the ordered list of display sections from a generated document.
 *
 * @param {object} result — the tool's result object (e.g. `notes`, `worksheet`).
 * @param {object} [config]
 * @param {string[]} [config.order]  — preferred key order; unlisted keys follow
 *                                      in their natural object order.
 * @param {string[]} [config.skip]   — extra keys to omit (merged with ALWAYS_SKIP).
 * @param {Object<string,string>} [config.labels] — key → friendly title override.
 * @param {Object<string,string>} [config.icons]  — key → emoji override.
 * @param {boolean} [config.keepAnswerKey] — when true, do NOT skip answerKey/answers.
 * @returns {Array<{id:string,title:string,icon:string,value:*,kind:string}>}
 */
export function buildSections(result, config = {}) {
  if (!result || typeof result !== 'object') return []
  const order = config.order || []
  const skip = new Set([...ALWAYS_SKIP, ...(config.skip || [])])
  if (config.keepAnswerKey) { skip.delete('answerKey'); skip.delete('answers') }
  const labels = config.labels || {}
  const icons = config.icons || {}

  const keys = Object.keys(result)
  const ordered = [
    ...order.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !order.includes(k)),
  ]

  const sections = []
  for (const key of ordered) {
    if (skip.has(key)) continue
    const value = result[key]
    const kind = classifyValue(value)
    if (kind === 'empty') continue
    sections.push({
      id: key,
      title: labels[key] || humanizeKey(key),
      icon: icons[key] || defaultIconFor(key),
      value,
      kind,
    })
  }
  return sections
}

/**
 * A gentle default emoji when a tool config doesn't override one. Keyword-based
 * so most sections get something better than a generic dot.
 */
function defaultIconFor(key) {
  const k = String(key).toLowerCase()
  if (/intro|opener|hook|overview|starter/.test(k)) return '🚀'
  if (/objective|outcome|goal|aim|competenc/.test(k)) return '🎯'
  if (/activit|task|practice|exercise|step/.test(k)) return '✏️'
  if (/question|quiz|item/.test(k)) return '❓'
  if (/assess|mark|rubric|grad|criteri/.test(k)) return '✅'
  if (/concept|content|note|explanation|key/.test(k)) return '📘'
  if (/example|worked|model/.test(k)) return '💡'
  if (/glossary|vocab|term|word/.test(k)) return '📖'
  if (/reference|resource|material|source/.test(k)) return '🔖'
  if (/misconception|watch|caution|warn/.test(k)) return '⚠️'
  if (/discussion|prompt|reflect/.test(k)) return '💬'
  if (/summary|conclusion|closure|wrap/.test(k)) return '🏁'
  if (/week|day|schedule|plan|timeline|scheme/.test(k)) return '🗓️'
  if (/card|flash/.test(k)) return '🃏'
  if (/homework|assignment/.test(k)) return '🏠'
  return '📄'
}

/* ── friendly timeline (the checkmark steps) ───────────────────── */

/**
 * The fixed prep steps every generation opens with, in teacher-plain language.
 * These run while the model is still working (before any section is ready).
 */
export const PREP_STEPS = [
  { id: 'read-details',    label: 'Reading your teacher details',        icon: '👩🏽‍🏫' },
  { id: 'read-curriculum', label: 'Reading the Zambian CBC curriculum',  icon: '📚' },
  { id: 'check-topic',     label: 'Checking grade, subject & topic',     icon: '🔎' },
]

/**
 * The prep steps a LEARNER-notes generation opens with.
 *
 * Same three plus one, and the extra one is not decoration: "Writing to your
 * learners" is the studio telling the teacher which document it is producing,
 * on the surface where they are waiting to find out. The learner/teaching split
 * is the whole point of the studio, so it says so while it works.
 */
export const LEARNER_PREP_STEPS = [
  ...PREP_STEPS,
  { id: 'learner-voice', label: 'Writing to your learners', icon: '✍🏽' },
]

/** The closing step shown once every section has been revealed. */
export const FINALISE_STEP = { id: 'finalise', label: 'Formatting your document', icon: '🎁' }

/**
 * Compose the full timeline: prep steps → one step per content section → the
 * finalise step. Each section step reuses the section's own icon and a friendly
 * "Adding <title>" phrasing.
 *
 * @param {Array<{id,title,icon}>} sections
 * @param {object} [config]
 * @param {string} [config.firstSectionVerb='Writing'] — verb for the very first
 *   content step (e.g. "Creating the title & introduction").
 * @param {Array} [config.prepSteps=PREP_STEPS] — the opening steps, so a tool
 *   whose generation does something extra can say so (learner notes).
 * @returns {Array<{id,label,icon,sectionId?:string}>}
 */
export function buildTimeline(sections = [], config = {}) {
  const verb = config.sectionVerb || 'Adding'
  const steps = [...(config.prepSteps || PREP_STEPS).map((s) => ({ ...s }))]
  sections.forEach((s, i) => {
    steps.push({
      id: `section-${s.id}`,
      sectionId: s.id,
      icon: s.icon,
      label: i === 0 ? `Creating the ${lower(s.title)}` : `${verb} ${lower(s.title)}`,
    })
  })
  steps.push({ ...FINALISE_STEP })
  return steps
}

function lower(title) {
  // Keep acronyms, lowercase ordinary leading words so "Adding Key Concepts"
  // reads "Adding key concepts".
  if (!title) return 'section'
  return title.replace(/\b([A-Z][a-z]+)/g, (m) => m.toLowerCase())
}

/**
 * Given the reveal state, mark each timeline step done / active / pending.
 *
 * Model:
 *   • preparing (no sections revealed yet, still running) → prep steps walk on a
 *     timer via `prepIndex`; content + finalise stay pending.
 *   • revealing → prep all done; the first `revealedCount` section steps are
 *     done, the next is active; finalise pending.
 *   • complete → everything done.
 *   • errored → the current active step shows 'error', earlier stay done.
 *
 * @param {object} args
 * @param {Array} args.timeline
 * @param {number} args.prepIndex       — which prep step is active while preparing.
 * @param {number} args.revealedCount   — how many content sections are shown.
 * @param {number} args.totalSections
 * @param {boolean} args.complete
 * @param {boolean} args.errored
 * @returns {Array<{...step, status:'done'|'active'|'pending'|'error'}>}
 */
export function computeTimelineStatus({
  timeline = [],
  prepIndex = 0,
  revealedCount = 0,
  totalSections = 0,
  complete = false,
  errored = false,
}) {
  const prepCount = PREP_STEPS.length
  // Index of the single "active" step in the flat timeline.
  let activeIdx
  if (complete) {
    activeIdx = timeline.length // all done
  } else if (totalSections === 0 || revealedCount === 0) {
    // Still preparing — walk the prep steps.
    activeIdx = Math.min(prepIndex, prepCount - 1)
  } else {
    // Revealing — prep done, active is the next unrevealed section step.
    activeIdx = Math.min(prepCount + revealedCount, timeline.length - 1)
  }

  return timeline.map((step, i) => {
    let status
    if (i < activeIdx) status = 'done'
    else if (i === activeIdx) status = errored ? 'error' : 'active'
    else status = 'pending'
    return { ...step, status }
  })
}

/* ── per-tool section configuration ────────────────────────────── */

/**
 * Ordering / labels / icons / skips per studio. The canvas passes the matching
 * entry to `buildSections`. Unlisted keys still render (in natural order with a
 * humanized label) so a schema addition never silently disappears.
 */
export const TOOL_SECTION_CONFIG = {
  // Teaching notes — the delivery document. Keyed `notes` because that is the
  // tool id; the learner document is a different SHAPE with different section
  // names, so it gets its own config below rather than a shared order list
  // padded with keys one of them never has.
  notes: {
    order: [
      'introduction', 'keyConcepts', 'workedExamples', 'studentQuestions',
      'misconceptions', 'discussionPrompts', 'quickChecks', 'glossary', 'references',
    ],
    labels: {
      introduction: 'Lesson Opener',
      keyConcepts: 'Key Concepts',
      workedExamples: 'Worked Examples',
      studentQuestions: 'Common Student Questions',
      misconceptions: 'Misconceptions to Watch For',
      quickChecks: 'Quick Checks',
    },
  },
  // Learner notes. `answerKey` stays skipped (ALWAYS_SKIP) — the reveal is the
  // learner's document, and the answers are a separate file.
  learnerNotes: {
    prepSteps: LEARNER_PREP_STEPS,
    order: [
      'learningOutcomes', 'sections', 'workedExamples', 'dontMixThese',
      'learnerQuestions', 'rememberBox', 'exercise',
    ],
    skip: ['grounding', 'checks', 'diagrams', 'audience', 'format', 'detail',
      'length', 'englishLevel', 'paperSize', 'coveredContent'],
    labels: {
      learningOutcomes: 'What you will learn',
      sections: 'Your notes',
      workedExamples: "Let's work one out together",
      dontMixThese: "Don't mix these up!",
      learnerQuestions: 'Questions learners ask',
      rememberBox: 'Remember!',
      exercise: 'Exercise',
    },
  },
  worksheet: {
    order: ['instructions', 'passage', 'sections', 'questions'],
    labels: { questions: 'Practice Questions', passage: 'Reading Passage' },
    icons: { questions: '❓', passage: '📖' },
  },
  homework: {
    order: ['instructions', 'warmUp', 'questions', 'challenge', 'parentNote'],
    labels: { questions: 'Homework Tasks', warmUp: 'Warm-up', parentNote: 'Note for Parents' },
  },
  lessonPlan: {
    order: [
      'objectives', 'learningOutcomes', 'introduction', 'priorKnowledge',
      'lessonDevelopment', 'activities', 'teachingSteps', 'assessment',
      'conclusion', 'homework', 'resources', 'reflection',
    ],
    labels: {
      objectives: 'Learning Objectives',
      lessonDevelopment: 'Lesson Development',
      teachingSteps: 'Teaching Steps',
    },
  },
  assessment: {
    // validateAssessment returns { schemaVersion, header, sections,
    // markingScheme } — schemaVersion/header are plumbing (ALWAYS_SKIP), the
    // paper reveals section-by-section and closes on the marking scheme.
    order: ['instructions', 'sections', 'blocks', 'questions', 'markingScheme'],
    labels: {
      blocks: 'Paper Sections', sections: 'Paper Sections',
      questions: 'Questions', markingScheme: 'Marking Scheme',
    },
    icons: { blocks: '📝', sections: '📝', questions: '❓', markingScheme: '🗝️' },
  },
  rubric: {
    order: ['taskSummary', 'criteria', 'levels', 'performanceLevels', 'notes'],
    labels: { criteria: 'Assessment Criteria', performanceLevels: 'Performance Levels' },
  },
  flashcards: {
    order: ['cards', 'tips'],
    labels: { cards: 'Flashcards' },
    icons: { cards: '🃏' },
  },
  scheme: {
    order: ['overview', 'weeks', 'rows', 'entries'],
    labels: { weeks: 'Weekly Breakdown', rows: 'Scheme Rows', entries: 'Scheme Entries' },
    icons: { weeks: '🗓️', rows: '🗓️', entries: '🗓️' },
  },
  weeklyForecast: {
    order: ['focus', 'days', 'lessons', 'assessment', 'notes'],
    labels: { days: 'Daily Focus', lessons: 'Planned Lessons' },
    icons: { days: '🗓️', focus: '🎯' },
  },
  sba: {
    // The learner-facing paper reveals first (instructions → stimulus →
    // questions), then the teacher-only administration + marking scheme. The
    // stimulus diagram is a `{libraryKey}` reference, not something to reveal.
    order: ['instructions', 'stimulus', 'questions', 'administration', 'markingScheme'],
    skip: ['stimulusDiagram'],
    labels: {
      instructions: 'Task Instructions',
      stimulus: 'Stimulus / Source',
      questions: 'Task Questions',
      administration: 'Teacher Administration',
      markingScheme: 'Marking Scheme',
    },
    icons: {
      instructions: '📋', stimulus: '📖', questions: '❓',
      administration: '🧑🏽‍🏫', markingScheme: '🗝️',
    },
  },
}
