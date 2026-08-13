/**
 * lessonRevealSteps — pure, framework-free logic that turns a finished
 * lesson-plan JSON (plus its render `meta`) into an ordered list of *partial*
 * snapshots. Feeding each snapshot to renderPlanHtml() in turn produces a
 * document that visibly builds itself — header first, then each field, then the
 * progression table one stage at a time — instead of a spinner-then-dump.
 *
 * The reveal is an honest, client-paced unveiling of the REAL result: every
 * snapshot is a subset of the plan the model actually returned, and the final
 * snapshot is the complete plan verbatim. Nothing is invented.
 *
 * Two builders:
 *   • buildMetaRevealSteps(meta)  — progressive `meta` objects so the document
 *     header fills in field by field (school → teacher → class → subject →
 *     topic → sub-topic → date → time → duration). Rendered with an empty body
 *     while the model is still working.
 *   • buildBodyRevealSteps(plan, curriculumMode) — `{ id, label, plan }` steps
 *     that reveal the plan body: each top-level field, then the progression
 *     stages one at a time (unrevealed stages stay as empty, named rows so the
 *     table is present from the first frame), then the complete plan.
 *
 * No React / browser deps → unit-testable under plain `node`
 * (see lessonRevealSteps.test.js).
 */

// The official stage names renderPlanHtml falls back to when a plan has no
// stages yet. Mirrors OFFICIAL_STAGES / OLD_STAGES in renderPlanHtml.js — kept
// here so the skeleton table shows the right rows before the model replies.
const NEW_STAGE_NAMES = [
  'INTRODUCTION',
  'LESSON DEVELOPMENT',
  'EXERCISE / ASSESSMENT',
  'HOMEWORK',
  'CONCLUSION',
]
const OLD_STAGE_NAMES = ['INTRODUCTION', 'DEVELOPMENT', 'CONCLUSION']

// Body-field reveal order per curriculum. Only fields actually present (and
// non-empty) in the plan are stepped through; anything unlisted still lands in
// the final complete-plan snapshot, so a schema addition never disappears.
const CBC_FIELD_ORDER = [
  'generalCompetences',
  'specificCompetence',
  'lessonGoal',
  'rationale',
  'priorKnowledge',
  'references',
  'learningEnvironment',
  'materials',
  'expectedStandard',
]
const PREV_FIELD_ORDER = [
  'rationale',
  'prerequisiteKnowledge',
  'priorKnowledge',
  'specificOutcomes',
  'tlAids',
  'materials',
  'references',
]

// Friendly labels for the "now writing…" status pill during the reveal.
const FIELD_LABELS = {
  generalCompetences: 'general competences',
  specificCompetence: 'specific competence',
  lessonGoal: 'lesson goal',
  rationale: 'rationale',
  priorKnowledge: 'prior knowledge',
  prerequisiteKnowledge: 'prior knowledge',
  references: 'references',
  learningEnvironment: 'learning environment',
  materials: 'teaching & learning materials',
  tlAids: 'teaching & learning aids',
  expectedStandard: 'expected standard',
  specificOutcomes: 'specific outcomes',
}

/** The identity/scheduling fields the header animates through, in order. */
const META_FIELD_ORDER = [
  'school',
  'teacherName',
  'grade',
  'subject',
  'topic',
  'subtopic',
  'date',
  'time',
  'duration',
]

// Meta keys blanked before the fill-in animation begins. Both the display key
// and its renderPlanHtml alias (grade↔klass, teacherName↔teacher) are cleared
// so a value only appears when its step is reached.
const META_BLANKS = {
  school: '',
  teacherName: '',
  teacher: '',
  grade: '',
  klass: '',
  subject: '',
  topic: '',
  subtopic: '',
  date: '',
  time: '',
  duration: '',
}

function hasContent(v) {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.some((x) => hasContent(x))
  if (typeof v === 'object') return Object.keys(v).some((k) => hasContent(v[k]))
  return true
}

function metaHas(meta, key) {
  if (key === 'grade') return hasContent(meta.grade) || hasContent(meta.klass)
  if (key === 'teacherName') return hasContent(meta.teacherName) || hasContent(meta.teacher)
  if (key === 'duration') return true // always animate duration (defaults to 40)
  return hasContent(meta[key])
}

function applyMetaField(target, meta, key) {
  if (key === 'grade') {
    target.grade = meta.grade || ''
    target.klass = meta.klass || ''
  } else if (key === 'teacherName') {
    target.teacherName = meta.teacherName || ''
    target.teacher = meta.teacher || ''
  } else {
    target[key] = meta[key] != null ? meta[key] : ''
  }
}

/**
 * Progressive header snapshots — each fills in one more identity/scheduling
 * field so the document header types itself in. Empty fields are skipped so the
 * animation never pauses on a blank. Returns at least one snapshot.
 *
 * @param {object} meta
 * @returns {object[]} meta snapshots (cumulative)
 */
export function buildMetaRevealSteps(meta = {}) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const present = META_FIELD_ORDER.filter((k) => metaHas(m, k))
  const filled = { ...m, ...META_BLANKS }
  const steps = []
  for (const key of present) {
    applyMetaField(filled, m, key)
    steps.push({ ...filled })
  }
  if (steps.length === 0) steps.push({ ...m })
  return steps
}

/**
 * Ordered body-reveal steps. Each step's `plan` is a partial plan object safe to
 * pass straight to renderPlanHtml(); the sequence grows the document until the
 * final step, which is the complete plan verbatim.
 *
 * @param {object} planJson
 * @param {'cbc'|'previous'} curriculumMode
 * @returns {Array<{id:string,label:string,plan:object}>}
 */
export function buildBodyRevealSteps(planJson, curriculumMode) {
  if (!planJson || typeof planJson !== 'object') return []
  const isOld = curriculumMode === 'previous'

  const realStages = Array.isArray(planJson.stages)
    ? planJson.stages.filter((s) => s && typeof s === 'object')
    : []
  const stageNames = realStages.length
    ? realStages.map((s) => s.name || '')
    : (isOld ? OLD_STAGE_NAMES : NEW_STAGE_NAMES)
  const emptyStages = stageNames.map((name) => ({ name }))

  const fieldOrder = isOld ? PREV_FIELD_ORDER : CBC_FIELD_ORDER
  const presentFields = fieldOrder.filter((k) => hasContent(planJson[k]))

  const steps = []
  const acc = {}

  // 1. Reveal each header field, one per step, with the stage table already
  //    present (empty, named rows) so the document keeps its final shape.
  for (const key of presentFields) {
    acc[key] = planJson[key]
    steps.push({
      id: `field-${key}`,
      label: `Adding ${FIELD_LABELS[key] || key}`,
      plan: { ...acc, stages: emptyStages },
    })
  }
  if (steps.length === 0) {
    steps.push({ id: 'scaffold', label: 'Laying out the plan', plan: { ...acc, stages: emptyStages } })
  }

  // 2. Reveal the progression stages one at a time — filled up to k, the rest
  //    still empty named rows.
  for (let k = 0; k < realStages.length; k++) {
    const revealed = realStages.slice(0, k + 1)
    const pending = emptyStages.slice(k + 1)
    steps.push({
      id: `stage-${k}`,
      label: `Writing ${stageDisplay(stageNames[k])}`,
      plan: { ...acc, stages: [...revealed, ...pending] },
    })
  }

  // 3. The complete plan verbatim — picks up homework, remedial/extension,
  //    evaluation and any field not in the reveal order.
  steps.push({ id: 'complete', label: 'Formatting your document', plan: { ...planJson } })
  return steps
}

/** Turn a stage name ("LESSON DEVELOPMENT") into a readable pill ("lesson development"). */
function stageDisplay(name) {
  const s = String(name || '').trim()
  if (!s) return 'the next stage'
  return s.toLowerCase()
}

export const __private = {
  NEW_STAGE_NAMES,
  OLD_STAGE_NAMES,
  CBC_FIELD_ORDER,
  PREV_FIELD_ORDER,
  hasContent,
}
