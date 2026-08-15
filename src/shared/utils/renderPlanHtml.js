/**
 * renderPlanHtml — converts a parsed lesson-plan JSON object into the HTML the
 * studio preview, the print window and (through the same rules) the exporters
 * put on paper.
 *
 * The governing constraint is paper. A generated plan used to run four A4 sides
 * where the teacher's handwritten equivalent runs two, and paper costs money in
 * a Zambian school. So the layout rules here are compactness rules, and the
 * ones that decide how much paper a plan uses live in `src/utils/lessonPlanFormat.js`
 * — imported, not re-declared, because the Word and PDF exporters read the same
 * module and a second copy is how the preview and the download start disagreeing.
 *
 * Three things in here are load-bearing and easy to undo by accident:
 *
 *   - **Cells carry dash lines, never bullet lists.** A bulleted list inside an
 *     already-narrow table cell spends ~0.6 cm of the cell's width on indent,
 *     which forces extra wrapping on every line. `– ` with a hanging indent of
 *     zero prints identically to how a teacher writes and recovers the width.
 *   - **The STAGES column never breaks mid-word.** "INTRODU CTION" is a layout
 *     bug a reader blames on the app. The column is 18% wide with hyphenation
 *     off, and stage names break on their own separators (a slash, an em dash).
 *   - **An unselected learning environment prints nothing.** Not "Not
 *     applicable" — nothing. `resolveEnvironmentLines` is the only thing that
 *     decides what that section says.
 *
 * No browser globals required — stageDiagramsHtml returns '' when a plan has no
 * figures, so the module stays a pure string builder and is unit-testable under
 * plain `node`.
 */

import { cellToHtml } from '../../utils/lessonPlanBlocks.js'
import {
  headerLines,
  resolveEnvironmentLines,
  resolveLessonFormat,
} from '../../utils/lessonPlanFormat.js'

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * XSS-safe HTML escape.
 * @param {unknown} str
 * @returns {string}
 */
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Normalise strings/arrays to a trimmed, non-empty string array.
 * Tolerates arrays, newline-separated strings, or semicolon-separated strings.
 * @param {unknown} v
 * @returns {string[]}
 */
function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean)
  return String(v || '')
    .split(/\n|;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Join an array-or-string value with a separator.
 * @param {unknown} v
 * @param {string} [sep]
 * @returns {string}
 */
function joinList(v, sep) {
  return asList(v).join(sep || '; ')
}

/**
 * Remove a leading numbered prefix like "1." or "2)" from a string, and any
 * dash the model already added — the renderer supplies its own dash so every
 * line starts the same way whether or not the model bulleted it.
 * @param {unknown} s
 * @returns {string}
 */
function stripPrefix(s) {
  return String(s || '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/^\s*[–—•*-]\s*/, '')
    .trim()
}

/**
 * A table cell's prose: one dash line per fragment, hanging indent zero.
 *
 * This replaces the in-cell <ul>/<ol> the plans used to carry. It is the single
 * largest width saving in the progression table and the reason a Development
 * cell now wraps to three lines where it used to wrap to five.
 * @param {unknown} text
 * @returns {string}
 */
function dashLines(text) {
  const lines = asList(text).map(stripPrefix).filter(Boolean)
  if (lines.length === 0) return ''
  return lines.map((l) => `<div class="li">&ndash; ${esc(l)}</div>`).join('')
}

/**
 * A cell of a progression table: prose as dash lines, plus any structured
 * blocks (worked place-value sums, matching exercises — §4.7) in the order they
 * were written.
 * @param {unknown} value
 * @returns {string}
 */
function cellHtml(value) {
  return cellToHtml(value, dashLines)
}

/**
 * Read one activity cell off a stage, accepting EITHER field-name family.
 *
 * `planShape.normalizePlanShape` gives a studio-generated plan both — the
 * renderer's `teacher`/`pupils`/`assessment` strings and the exporters'
 * `teacherActivities`/`learnerActivities`/`assessmentCriteria` arrays — but a
 * plan reaching this renderer from the library or from an export shape may
 * carry only the arrays. Reading one family and silently rendering an empty
 * cell for the other is the exact failure planShape exists to prevent, so the
 * fallback lives here rather than depending on every caller normalising first.
 *
 * @param {object} stage
 * @param {string} key  'teacher' | 'pupils' | 'assessment' | 'learningPoint'
 * @returns {unknown}
 */
function stageCellValue(stage, key) {
  const s = stage || {}
  switch (key) {
    case 'teacher':
      return s.teacher ?? s.teacherActivities ?? ''
    case 'pupils':
      return s.pupils ?? s.learnerActivities ?? s.learners ?? s.pupilActivities ?? ''
    case 'assessment':
      return s.assessment ?? s.assessmentCriteria ?? ''
    case 'learningPoint':
      // OBC's fourth column. A plan generated before LEARNING POINT existed
      // carries the same content under the CBC name or the old METHODS column.
      return s.learningPoint ?? s.assessment ?? s.assessmentCriteria ?? s.methods ?? ''
    default:
      return ''
  }
}

// The official five stage names used when the model under-delivers.
const OFFICIAL_STAGES = [
  'INTRODUCTION',
  'LESSON DEVELOPMENT',
  'EXERCISE / ASSESSMENT',
  'HOMEWORK',
  'CONCLUSION',
]

/**
 * Normalise the stages array.
 * If empty or absent, returns five blank rows using the official stage names.
 * @param {unknown} stages
 * @returns {object[]}
 */
function ensureStages(stages) {
  const list = Array.isArray(stages)
    ? stages.filter((s) => s && (s.name || stageCellValue(s, 'teacher') || stageCellValue(s, 'pupils')))
    : []
  if (list.length > 0) return list
  return OFFICIAL_STAGES.map((name) => ({
    name,
    duration: '',
    teacher: '',
    pupils: '',
    assessment: '',
  }))
}

// The official three old stage names for the 2013 curriculum.
const OLD_STAGES = ['INTRODUCTION', 'DEVELOPMENT', 'CONCLUSION']

/**
 * Normalise old-curriculum stages.
 * @param {unknown} stages
 * @returns {object[]}
 */
function ensureOldStages(stages) {
  const list = Array.isArray(stages)
    ? stages.filter((s) => s && (s.name || stageCellValue(s, 'teacher') || stageCellValue(s, 'pupils') || s.content))
    : []
  if (list.length > 0) return list
  return OLD_STAGES.map((name) => ({
    name,
    duration: '',
    content: '',
    teacher: '',
    pupils: '',
    methods: '',
  }))
}

/** True when a stage is the homework row (which §2.4 lets a teacher drop). */
function isHomeworkStage(stage) {
  return /HOMEWORK/i.test(String(stage?.name || ''))
}

/**
 * Drop the stages a teacher switched off. Only the homework row is optional —
 * the other four are what makes the document a lesson plan.
 * @param {object[]} stages
 * @param {object} fmt
 * @returns {object[]}
 */
function applyStageToggles(stages, fmt) {
  return fmt.sections.homework ? stages : stages.filter((s) => !isHomeworkStage(s))
}

/**
 * Normalise a stage name for loose matching (case/punctuation-insensitive).
 * @param {unknown} s
 * @returns {string}
 */
function normStage(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/**
 * True when a diagram tagged for `diagramStage` belongs under `stageName`.
 * Matching is forgiving — exact, or either name contains the other — because
 * the model's stage labels ("Lesson Development") and the official names
 * ("LESSON DEVELOPMENT") don't always agree verbatim.
 * @param {string} stageName
 * @param {string} diagramStage
 * @returns {boolean}
 */
function stageMatches(stageName, diagramStage) {
  const a = normStage(stageName)
  const b = normStage(diagramStage)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Render the AI-generated illustration figures attached to a given stage.
 *
 * `diagrams` is an array of `{ stage, url, caption }` produced client-side by
 * the Lesson Plan Studio (via the generateDiagram callable) and threaded onto
 * the plan object before rendering. Each figure renders as an <img> with
 * inline styles so it survives the Word/PDF exporters. Returns '' when there
 * are no diagrams for this stage — so plans without illustrations are byte-for-
 * byte unchanged.
 *
 * @param {string} stageName
 * @param {Array<{stage?:string, url?:string, caption?:string}>} [diagrams]
 * @returns {string}
 */
function stageDiagramsHtml(stageName, diagrams) {
  if (!Array.isArray(diagrams) || diagrams.length === 0) return ''
  const here = diagrams.filter((d) => d && d.url && stageMatches(stageName, d.stage))
  if (here.length === 0) return ''
  return here
    .map(
      (d) =>
        `<figure class="lp-figure" style="margin:8px auto;text-align:center;max-width:420px">` +
        `<img src="${esc(d.url)}" alt="${esc(d.caption || 'Lesson illustration')}" ` +
        `style="max-width:100%;height:auto;border:1px solid #ccc;border-radius:4px" />` +
        (d.caption
          ? `<figcaption style="font-size:11px;color:#555;margin-top:3px">${esc(d.caption)}</figcaption>`
          : '') +
        `</figure>`,
    )
    .join('')
}

/**
 * The standalone TEACHING ILLUSTRATION block.
 *
 * A plan can carry figures two ways: `diagrams[]`, tagged to a stage and drawn
 * inside that stage's cell, and a single `lessonDiagram` for the whole lesson.
 * Only the first was rendered here, so a plan with a `lessonDiagram` previewed
 * and printed without its drawing while the Word export embedded it — the
 * exporters disagreeing about the document again.
 *
 * Skipped when the same image is already attached to a stage, so a studio plan
 * whose `lessonDiagram` was derived from `diagrams[0]` does not print twice.
 *
 * @param {object} data
 * @returns {string}
 */
function lessonDiagramHtml(data) {
  const diagram = data && data.lessonDiagram
  if (!diagram || !diagram.url) return ''
  const attached = Array.isArray(data.diagrams) ? data.diagrams : []
  if (attached.some((d) => d && d.url === diagram.url)) return ''
  const caption = String(diagram.prompt || diagram.caption || '').trim()
  return (
    '<div class="field-line"><b>TEACHING ILLUSTRATION:</b></div>' +
    '<figure class="lp-figure" style="margin:2mm auto;text-align:center;max-width:420px">' +
    `<img src="${esc(diagram.url)}" alt="${esc(caption || 'Teaching illustration')}" ` +
    'style="max-width:100%;height:auto;border:1px solid #000" />' +
    (caption
      ? `<figcaption style="font-size:.85em;font-style:italic;margin-top:1mm">${esc(caption)}</figcaption>`
      : '') +
    '</figure>'
  )
}

/**
 * Roman numeral for small indices (1–10).
 * @param {number} n
 * @returns {string}
 */
function romanNum(n) {
  const map = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']
  return `(${map[n - 1] || n})`
}

// ── Inline border style constants (survive Word export) ───────────────────────

const OFFICIAL_TD = 'border:1px solid #000;padding:5px 7px;vertical-align:top;text-align:left'
const OFFICIAL_TH = OFFICIAL_TD + ';font-weight:700'

/**
 * The STAGES cell carries its no-break rules INLINE as well as in lesson.css.
 * The stylesheet covers the studio preview, but the same HTML is also rendered
 * by the library's saved-plan frame and pasted into the print window, and
 * "INTRODU CTION" in a printed plan is a bug a teacher blames on the app —
 * so the rule travels with the markup rather than depending on a stylesheet
 * reaching every consumer.
 */
const STAGE_TD = OFFICIAL_TD + ';font-weight:700;hyphens:none;-webkit-hyphens:none;overflow-wrap:normal;word-break:normal'

/**
 * Progression-table column widths (§4.1). Fixed layout in every renderer, so a
 * long Teacher's Activities cell can never steal width from the STAGES column
 * and start breaking its heading mid-word.
 */
export const PROGRESSION_WIDTHS = { stage: 18, teacher: 34, learner: 26, assessment: 22 }

/**
 * Stage names break on their OWN separators — the slash in "EXERCISE /
 * ASSESSMENT", the em dash in "LESSON DEVELOPMENT — Activity 1" — and nowhere
 * else. The `hyphens:none; overflow-wrap:normal` on `.lp-table .stage` in
 * lesson.css is the other half of this; without both, an 18% column still
 * chops "HOMEWORK" into "HOMEWO RK".
 * @param {string} name
 * @returns {string}
 */
function stageNameHtml(name) {
  return esc(name)
    .replace(/\s*\/\s*/g, ' /<br>')
    .replace(/\s*(&mdash;|—|--)\s*/g, '<br>')
}

/**
 * One STAGES cell: the name, then the duration on its own line.
 * @param {object} stage
 * @returns {string}
 */
function stageCellHtml(stage) {
  const duration = String(stage.duration || '').trim()
  return (
    stageNameHtml(stage.name || '') +
    (duration ? `<span class="t">(${esc(duration)})</span>` : '')
  )
}

// ── Header / meta renderers ───────────────────────────────────────────────────

/**
 * The masthead: an optional MINISTRY OF EDUCATION line for government teachers,
 * the school name, then LESSON PLAN. No horizontal rules — §4.3 removed the two
 * that used to bracket the metadata block, because they cost two lines and the
 * Ministry-style reference plans do not have them.
 * @param {object} meta
 * @param {object} fmt
 * @param {string} [titleText]
 * @returns {string}
 */
function renderHeader(meta, fmt, titleText) {
  const lines = headerLines({
    headerStyle: fmt.headerStyle,
    ministryLine: fmt.ministryLine,
    school: meta.school || 'School Name',
  })
  let h = '<div class="doc-head clean">'
  if (fmt.headerStyle === 'ministry' && lines.length > 1) {
    h += `<div class="ministry">${esc(lines[0])}</div>`
    h += `<div class="school">${esc(lines[1])}</div>`
  } else {
    h += `<div class="school">${esc(lines[0] || '')}</div>`
  }
  if (meta.department) h += `<div class="department">${esc(meta.department)}</div>`
  h += `<div class="lp-title">${esc(titleText || 'Lesson Plan')}</div></div>`
  return h
}

/**
 * One `Label: value` cell of the metadata block. Label underlined, value not.
 *
 * A table CELL, not a grid item, and that is not a style preference: the PDF
 * download rasterises with html2canvas, which lays out `display:grid`
 * unreliably. A borderless table renders identically in the browser, in the
 * rasteriser and in Word — so all three renderers can share this structure.
 */
function metaItem(label, value, { wide = false } = {}) {
  return (
    `<td class="item${wide ? ' span2' : ''}"${wide ? ' colspan="2"' : ''}>` +
    `<b>${esc(label)}:</b> <span class="val">${value}</span></td>`
  )
}

/**
 * The clean, rule-less two-column metadata block (§4.3).
 *
 * Identity fields on the left, session fields on the right, each label and its
 * value inside ONE cell so they can never separate — which is what used to drop
 * "SUB-TOPIC:"'s value onto the next line and misalign the GIRLS/BOYS blanks
 * from their labels. Sub-topic spans both columns because it is the one field
 * that is routinely too long for half a line.
 *
 * @param {object} meta
 * @param {object} data
 * @param {object} fmt
 * @param {object} [opts]  { gradeLabel, extraLeft, extraRight, extraWide }
 * @returns {string}
 */
function renderMetaBlock(meta, data = {}, fmt, opts = {}) {
  const gradeLabel = opts.gradeLabel || 'Class'
  const teacherDisplay = meta.teacherName
    ? esc(meta.teacherName)
    : meta.teacher
      ? esc(meta.teacher) + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : '')
      : ''

  const pupils = [
    meta.showEnrolment || meta.showAttendance
      ? 'B: ______ &nbsp; G: ______ &nbsp; Total: ______'
      : 'B: ______ &nbsp; G: ______',
  ][0]

  const left = [
    ['Name of Teacher', teacherDisplay],
    [gradeLabel, esc(meta.klass || meta.grade || '')],
    ['Subject', esc(meta.subject || '')],
    ['Topic', esc(data.topic || meta.topic || '')],
    ...(opts.extraLeft || []),
  ]
  const right = [
    ['Date', esc(meta.date || '')],
    ['Time', esc(meta.time || '')],
    ['Duration', esc(String(meta.duration || '40')) + ' minutes'],
    ['No of pupils', pupils],
    ...(opts.extraRight || []),
  ]
  const wide = [
    ['Sub-Topic', esc(data.subtopic || meta.subtopic || '')],
    ...(opts.extraWide || []),
  ].filter(([, v]) => String(v).trim())

  const table = (rowsHtml, extraClass = '') =>
    `<table class="meta${extraClass}"><tbody>${rowsHtml}</tbody></table>`

  // Compact metadata keeps the two columns (≤ 6 lines). With it off, every field
  // takes its own full-width row — more legible, three lines longer.
  if (!fmt.compactMeta) {
    return table(
      [...left, ...right, ...wide]
        .map(([k, v]) => `<tr>${metaItem(k, v, { wide: true })}</tr>`)
        .join(''),
      ' one-col',
    )
  }

  const rows = []
  const count = Math.max(left.length, right.length)
  for (let i = 0; i < count; i += 1) {
    const a = left[i] ? metaItem(left[i][0], left[i][1]) : '<td class="item"></td>'
    const b = right[i] ? metaItem(right[i][0], right[i][1]) : '<td class="item"></td>'
    rows.push(`<tr>${a}${b}</tr>`)
  }
  for (const [k, v] of wide) rows.push(`<tr>${metaItem(k, v, { wide: true })}</tr>`)
  return table(rows.join(''))
}

// ── Field line helpers ────────────────────────────────────────────────────────

/**
 * A single-line section (§4.4). Materials, References and Competences print as
 * one wrapped, comma-separated line each rather than a bullet list — a list of
 * three items costs a heading plus three indented lines where the line costs
 * one.
 * @param {string} label
 * @param {string} value
 * @returns {string}
 */
function sectionLine(label, value) {
  const v = String(value || '').trim()
  if (!v) return ''
  return `<div class="field-line"><b>${esc(label)}:</b> ${esc(v)}</div>`
}

/**
 * The LEARNING ENVIRONMENT section — one line, and only for the categories the
 * teacher actually selected (§2.3). There is deliberately no branch that emits
 * a heading with nothing under it.
 * @param {object} data
 * @param {object} meta
 * @param {object} fmt
 * @returns {string}
 */
function environmentHtml(data, meta, fmt) {
  const lines = resolveEnvironmentLines({
    environment: data.learningEnvironment,
    selected: meta.learningEnvironments,
    display: fmt.environmentDisplay,
    place: fmt.environmentPlace,
  })
  return lines.map((l) => sectionLine(l.label.toUpperCase(), l.value)).join('')
}

/**
 * Render the canonical pre-table field lines (CBC classic + classic2 formats).
 * Every optional section is gated on the teacher's own toggle, so a plan that
 * says nothing about remedial work has no empty REMEDIAL WORK line either.
 * @param {object} data
 * @param {object} meta
 * @param {object} fmt
 * @returns {string}
 */
function renderFieldLines(data, meta, fmt) {
  const out = [
    sectionLine('GENERAL COMPETENCES', joinList(data.generalCompetences, ', ')),
    sectionLine('SPECIFIC COMPETENCE', data.specificCompetence),
    sectionLine('LESSON GOAL', data.lessonGoal),
  ]
  if (fmt.sections.rationale) out.push(sectionLine('RATIONALE', data.rationale))
  if (fmt.sections.priorKnowledge) out.push(sectionLine('PRIOR KNOWLEDGE', data.priorKnowledge))
  if (fmt.sections.references) out.push(sectionLine('REFERENCES', joinList(data.references, '; ')))
  out.push(environmentHtml(data, meta, fmt))
  out.push(sectionLine('MATERIALS', joinList(data.materials, ', ')))
  if (fmt.sections.expectedStandard) {
    out.push(sectionLine('EXPECTED STANDARD', data.expectedStandard || data.expectedStandards))
  }
  return out.filter(Boolean).join('')
}

/**
 * One ruled line per evaluation field (§4.5).
 *
 * The old rendering was two rows of ~58 underscore characters per field — about
 * a third of a page for three fields, and it wrapped unpredictably because a
 * run of underscores is one unbreakable "word". A bottom-bordered empty span is
 * one line, always exactly the width of the page, and the teacher writes on it.
 * @param {string} label
 * @returns {string}
 */
function ruledField(label) {
  return `<div class="eval-field"><b>${esc(label)}:</b><span class="rule"></span></div>`
}

/**
 * Render the lesson evaluation / reflection block.
 * @param {object} data
 * @param {object} meta
 * @param {object} fmt
 * @returns {string}
 */
function renderLessonEvaluation(data, meta, fmt) {
  const extras = []
  if (fmt.sections.remedialWork && data.remedialWork) {
    extras.push(sectionLine('REMEDIAL WORK', data.remedialWork))
  }
  if (fmt.sections.extensionActivity && data.extensionActivity) {
    extras.push(sectionLine('EXTENSION ACTIVITY', data.extensionActivity))
  }
  if (!fmt.sections.lessonEvaluation) return extras.join('')
  return (
    extras.join('') +
    '<div class="eval">' +
    '<div class="field-line"><b>LESSON EVALUATION:</b></div>' +
    ruledField('Successes') +
    ruledField('Challenges') +
    ruledField('Way forward') +
    '</div>'
  )
}

// ── New curriculum (2023 ECF / CBC) renderers ─────────────────────────────────

/**
 * "Modern Clean" format — sectioned layout with one mini-table per stage.
 * @param {object} data
 * @param {object} meta
 * @param {object} fmt
 * @returns {string}
 */
function renderModern(data, meta, fmt) {
  const stages = applyStageToggles(ensureStages(data.stages), fmt)
    .map(
      (s) => `
    <div class="stage-block"><table class="stage-table m-stage-table">
      <tr><td colspan="3" class="stage-head">${esc(s.name)}${s.duration ? `<span class="duration">${esc(s.duration)}</span>` : ''}</td></tr>
      <tr><th class="col-head">TEACHER'S ACTIVITIES</th><th class="col-head">LEARNERS' ACTIVITIES</th><th class="col-head">ASSESSMENT CRITERIA</th></tr>
      <tr><td>${cellHtml(stageCellValue(s, 'teacher'))}</td><td>${cellHtml(stageCellValue(s, 'pupils'))}${stageDiagramsHtml(s.name, data.diagrams)}</td><td>${cellHtml(stageCellValue(s, 'assessment'))}</td></tr>
    </table></div>`,
    )
    .join('')

  return `<div class="plan-official plan-compact">${renderHeader(meta, fmt)}${renderMetaBlock(meta, data, fmt)}
    ${renderFieldLines(data, meta, fmt)}${lessonDiagramHtml(data)}
    <div class="progression-title">LESSON PROGRESSION</div>${stages}
    ${renderLessonEvaluation(data, meta, fmt)}</div>`
}

/**
 * "Classic" format — ONE progression table with four columns. This is the
 * layout the compactness work targets: it is what a Zambian head teacher
 * expects to see, and it is the cheapest in paper.
 * @param {object} data
 * @param {object} meta
 * @param {object} fmt
 * @returns {string}
 */
function renderClassic(data, meta, fmt) {
  const stagesHtml = applyStageToggles(ensureStages(data.stages), fmt)
    .map(
      (s) => `<tr>
    <td class="stage" style="${STAGE_TD}">${stageCellHtml(s)}</td>
    <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'teacher'))}</td>
    <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'pupils'))}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'assessment'))}</td></tr>`,
    )
    .join('')

  const w = PROGRESSION_WIDTHS
  return `<div class="plan-official plan-compact">${renderHeader(meta, fmt)}${renderMetaBlock(meta, data, fmt)}
    ${renderFieldLines(data, meta, fmt)}${lessonDiagramHtml(data)}
    <div class="progression-title">LESSON PROGRESSION</div>
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;table-layout:fixed">
      <thead><tr><th style="width:${w.stage}%;${OFFICIAL_TH}">STAGES</th><th style="width:${w.teacher}%;${OFFICIAL_TH}">TEACHER'S ACTIVITIES</th><th style="width:${w.learner}%;${OFFICIAL_TH}">LEARNERS' ACTIVITIES</th><th style="width:${w.assessment}%;${OFFICIAL_TH}">ASSESSMENT</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${renderLessonEvaluation(data, meta, fmt)}</div>`
}

/**
 * "Official CBC Format" — per-stage tables with Teacher's Role / Learners' Role columns.
 * @param {object} data
 * @param {object} meta
 * @param {object} fmt
 * @returns {string}
 */
function renderClassic2(data, meta, fmt) {
  const stages = applyStageToggles(ensureStages(data.stages), fmt)
    .map(
      (s) => `
    <div class="stage-block"><table class="stage-table c2-stage-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%">
      <tr><td colspan="3" class="stage-head" style="${OFFICIAL_TH}">${esc(s.name)}${s.duration ? `<span class="duration">${esc(s.duration)}</span>` : ''}</td></tr>
      <tr>
        <th class="col-head" style="width:33%;${OFFICIAL_TH}">TEACHER'S ROLE</th>
        <th class="col-head" style="width:33%;${OFFICIAL_TH}">LEARNERS' ROLE</th>
        <th class="col-head" style="width:34%;${OFFICIAL_TH}">ASSESSMENT CRITERIA</th>
      </tr>
      <tr>
        <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'teacher'))}</td>
        <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'pupils'))}${stageDiagramsHtml(s.name, data.diagrams)}</td>
        <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'assessment'))}</td>
      </tr>
    </table></div>`,
    )
    .join('')

  return `<div class="plan-official plan-compact">${renderHeader(meta, fmt)}${renderMetaBlock(meta, data, fmt)}
    ${renderFieldLines(data, meta, fmt)}${lessonDiagramHtml(data)}
    <div class="progression-title">LESSON PROGRESSION</div>${stages}
    ${renderLessonEvaluation(data, meta, fmt)}</div>`
}

// ── Old curriculum (2013 OBC) renderers ───────────────────────────────────────

/**
 * OBC field lines (§4.6). The outcome-based plan has its OWN vocabulary — it is
 * not the CBC plan with relabelled fields. Specific outcomes, not competences;
 * Pre-requisite, not Prior Knowledge; Learning/T Aids, not Materials; and no
 * General Competences, Specific Competence or Expected Standard at all.
 * @param {object} data
 * @param {object} fmt
 * @returns {string}
 */
function renderOldFieldLines(data, fmt) {
  const outcomes = asList(data.specificOutcomes)
  const out = []
  if (outcomes.length === 1) {
    out.push(sectionLine('SPECIFIC OUTCOMES', stripPrefix(outcomes[0])))
  } else if (outcomes.length > 1) {
    out.push(
      '<div class="field-line"><b>SPECIFIC OUTCOMES:</b> By the end of this lesson, pupils should be able to:</div>' +
        outcomes
          .map((o, i) => `<div class="li outcome">${romanNum(i + 1)} ${esc(stripPrefix(o))}</div>`)
          .join(''),
    )
  }
  if (fmt.sections.rationale) out.push(sectionLine('RATIONALE', data.rationale))
  out.push(sectionLine('PRE-REQUISITE', data.prerequisiteKnowledge || data.priorKnowledge))
  return out.filter(Boolean).join('')
}

/**
 * OBC metadata block. Same clean two-column grid as CBC, with the OBC field set:
 * Grade rather than Class, plus Reference and Learning/T Aids.
 * @param {object} meta
 * @param {object} data
 * @param {object} fmt
 * @returns {string}
 */
function renderOldMeta(meta, data, fmt) {
  const extraLeft = fmt.sections.references
    ? [['Reference', esc(joinList(data.references, '; '))]]
    : []
  const aids = joinList(data.tlAids || data.materials, ', ')
  return renderMetaBlock(meta, data, fmt, {
    gradeLabel: 'Grade',
    extraLeft,
    extraWide: aids ? [['Learning/T Aids', esc(aids)]] : [],
  })
}

/**
 * OBC closing block (§4.6): EVALUATION and LESSON LEARNT as ruled lines the
 * teacher completes after teaching. CBC's "Successes / Challenges / Way forward"
 * prompts are a CBC convention and do not belong on an OBC plan.
 * @param {object} data
 * @param {object} fmt
 * @returns {string}
 */
function renderOldClosing(data, fmt) {
  const parts = []
  if (fmt.sections.homework && data.homework) {
    parts.push(sectionLine('HOMEWORK', data.homework))
  }
  if (!fmt.sections.lessonEvaluation) return parts.join('')
  parts.push(
    '<div class="eval">' +
      '<div class="field-line"><b>EVALUATION:</b></div>' +
      '<div class="eval-field"><span class="rule"></span></div>' +
      '<div class="eval-field"><span class="rule"></span></div>' +
      '<div class="field-line"><b>LESSON LEARNT:</b></div>' +
      '<div class="eval-field"><span class="rule"></span></div>' +
      '<div class="eval-field"><span class="rule"></span></div>' +
      '</div>',
  )
  return parts.join('')
}

/**
 * The OBC progression table (§4.6):
 *   STAGE/TIME | TEACHER'S ACTIVITY | LEARNER'S ACTIVITY | LEARNING POINT
 *
 * LEARNING POINT is the OBC column — it replaces CBC's ASSESSMENT CRITERIA and
 * carries what the stage teaches, not how it is judged. Stage and time share
 * the first column, which is why the heading reads STAGE/TIME.
 * @param {object} data
 * @param {object} fmt
 * @returns {string}
 */
function renderOldTable(data, fmt) {
  const stages = applyStageToggles(ensureOldStages(data.stages), fmt)
  const w = PROGRESSION_WIDTHS
  const stagesHtml = stages
    .map(
      (s) => `<tr>
    <td class="stage" style="${STAGE_TD}">${stageCellHtml(s)}</td>
    <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'teacher'))}</td>
    <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'pupils'))}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${cellHtml(stageCellValue(s, 'learningPoint'))}</td></tr>`,
    )
    .join('')

  return `<table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;table-layout:fixed">
      <thead><tr><th style="width:${w.stage}%;${OFFICIAL_TH}">STAGE/TIME</th><th style="width:${w.teacher}%;${OFFICIAL_TH}">TEACHER'S ACTIVITY</th><th style="width:${w.learner}%;${OFFICIAL_TH}">LEARNER'S ACTIVITY</th><th style="width:${w.assessment}%;${OFFICIAL_TH}">LEARNING POINT</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>`
}

/**
 * The OBC plan. All three "format" choices render the same document — the
 * outcome-based layout is a Ministry convention, not a style preference, and
 * offering three variants of it is how the CBC/OBC vocabularies got mixed in
 * the first place.
 * @param {object} data
 * @param {object} meta
 * @param {object} fmt
 * @returns {string}
 */
function renderOld(data, meta, fmt) {
  return `<div class="plan-official plan-compact plan-obc">${renderHeader(meta, fmt)}${renderOldMeta(meta, data, fmt)}
    ${renderOldFieldLines(data, fmt)}${lessonDiagramHtml(data)}
    <div class="progression-title">LESSON PROGRESSION</div>
    ${renderOldTable(data, fmt)}
    ${renderOldClosing(data, fmt)}</div>`
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Read the paper-fit choices out of the render meta.
 *
 * `meta.lessonFormat` is the resolved format the studio built; everything else
 * is the pre-2026-07 meta shape, kept working so a plan saved before Page Budget
 * existed still opens (and still honours the toggles it was saved with).
 * @param {object} meta
 * @returns {object}
 */
export function formatFromMeta(meta = {}) {
  const base = resolveLessonFormat(meta.lessonFormat || {})
  // Legacy meta flags still win where they were explicitly set, so reopening an
  // old plan does not silently switch its sections on or off.
  const sections = { ...base.sections }
  if (typeof meta.showReflection === 'boolean') sections.lessonEvaluation = meta.showReflection
  return {
    ...base,
    sections,
    compactMeta: meta.compactMeta !== false,
  }
}

/**
 * Convert a parsed lesson-plan JSON object to an HTML string.
 *
 * @param {object} planJson  - Parsed JSON from the Cloud Function
 * @param {object} meta      - Rendering metadata:
 *   {
 *     format: 'modern' | 'classic' | 'classic2' | 'official-cbc',
 *     lessonFormat:    object   resolved src/utils/lessonPlanFormat.js format
 *     learningEnvironments: string[]  categories the teacher selected
 *     showReflection:  boolean
 *     showEnrolment:   boolean
 *     showAttendance:  boolean
 *     compactMeta:     boolean
 *     teacherName:     string
 *     school:          string
 *     date:            string
 *     time:            string
 *     lessonNumber:    number
 *     totalLessons:    number
 *   }
 * @param {string} curriculumMode - 'cbc' | 'previous'
 * @returns {string} HTML string
 */
export function renderPlanHtml(planJson, meta, curriculumMode) {
  if (!planJson || typeof planJson !== 'object') return ''

  const m = meta && typeof meta === 'object' ? meta : {}
  const fmt = formatFromMeta(m)
  const isOld = curriculumMode === 'previous'

  if (isOld) return renderOld(planJson, m, fmt)

  // Normalise the format key — the Format & Options card emits 'official', the
  // older saved-plan meta used 'official-cbc'; both map to 'classic2' internally.
  const layout = (m.format || 'modern').toLowerCase().replace(/^official(-cbc)?$/, 'classic2')

  if (layout === 'classic') return renderClassic(planJson, m, fmt)
  if (layout === 'classic2') return renderClassic2(planJson, m, fmt)
  return renderModern(planJson, m, fmt)
}
