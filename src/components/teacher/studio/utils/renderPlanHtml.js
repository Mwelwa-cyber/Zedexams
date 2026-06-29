/**
 * renderPlanHtml — self-contained ES module that converts a parsed lesson-plan
 * JSON object into an HTML string using the same logic as
 * public/studio/06-generate.js (lines 225–700).
 *
 * No browser globals required — stageDiagramsHtml returns '' because the SVG
 * engine (11-diagrams.js) is not available in the React bundle.
 */

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
 * Remove a leading numbered prefix like "1." or "2)" from a string.
 * @param {unknown} s
 * @returns {string}
 */
function stripPrefix(s) {
  return String(s || '').replace(/^\s*\d+[.)]\s*/, '')
}

/**
 * Convert an array of strings (or a single string) to a simple HTML block.
 * Numbered lines get an <ol>; otherwise each line is wrapped in a <div>.
 * @param {unknown} text
 * @returns {string}
 */
function formatProse(text) {
  if (!text) return ''
  const t = String(text).trim()
  const lines = t
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const isNumbered = lines.length > 1 && lines.every((l) => /^\d+[.)]/.test(l))
  if (isNumbered) {
    return (
      '<ol style="padding-left:20px;margin:4px 0">' +
      lines
        .map((l) => '<li>' + esc(l.replace(/^\d+[.)]\s*/, '')) + '</li>')
        .join('') +
      '</ol>'
    )
  }
  return lines.map((l) => '<div style="margin:3px 0">' + esc(l) + '</div>').join('')
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
    ? stages.filter((s) => s && (s.name || s.teacher || s.pupils))
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
    ? stages.filter((s) => s && (s.name || s.teacher || s.pupils || s.content))
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

// ── Header / meta renderers ───────────────────────────────────────────────────

/**
 * Render the school header block.
 * @param {object} meta
 * @param {string} [titleText]
 * @returns {string}
 */
function renderHeader(meta, titleText) {
  let h = '<div class="doc-head">'
  if (meta.headerLine) h += `<div class="header-line">${esc(meta.headerLine)}</div>`
  h += `<div class="school">${esc(meta.school || 'School Name')}</div>`
  if (meta.department) h += `<div class="department">${esc(meta.department)}</div>`
  h += `<div class="lp-title">${esc(titleText || 'Lesson Plan')}</div></div>`
  return h
}

/**
 * Render a full meta table (one row per field).
 * @param {object} meta
 * @returns {string}
 */
function renderMetaTable(meta) {
  const rows = []
  if (meta.teacher) rows.push(['Teacher', esc(meta.teacher) + (meta.tsno ? ' &nbsp;·&nbsp; TS ' + esc(meta.tsno) : '')])
  if (meta.teacherName) rows.push(['Teacher', esc(meta.teacherName)])
  if (meta.date) rows.push(['Date', esc(meta.date)])
  if (meta.time) rows.push(['Time', esc(meta.time)])
  rows.push(['Duration', esc(String(meta.duration || '40')) + ' minutes'])
  rows.push(['Class', esc(meta.klass || meta.grade || '')])
  rows.push(['Subject', esc(meta.subject || '')])
  if (meta.topic) rows.push(['Topic', esc(meta.topic)])
  if (meta.subtopic) rows.push(['Sub-topic', esc(meta.subtopic)])
  if (meta.showEnrolment) rows.push(['Total Enrolment', 'Boys: _____ &nbsp;&nbsp; Girls: _____ &nbsp;&nbsp; Total: _____'])
  if (meta.showAttendance) rows.push(['Total Attendance', 'Boys: _____ &nbsp;&nbsp; Girls: _____ &nbsp;&nbsp; Total: _____'])
  return `<table class="meta-table"><tbody>${rows
    .map((r) => `<tr><td class="k">${r[0]}</td><td class="v">${r[1]}</td></tr>`)
    .join('')}</tbody></table>`
}

/**
 * Render a compact meta row (items as inline key/value pairs).
 * @param {object} meta
 * @returns {string}
 */
function renderMetaCompact(meta) {
  const items = []
  if (meta.teacherName) items.push(["Teacher's name", esc(meta.teacherName)])
  else if (meta.teacher) items.push(["Teacher's name", esc(meta.teacher) + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : '')])
  if (meta.date) items.push(['Date', esc(meta.date)])
  if (meta.time) items.push(['Time', esc(meta.time)])
  items.push(['Subject', esc(meta.subject || '')])
  items.push(['Duration', esc(String(meta.duration || '40')) + ' min'])
  items.push(['Class', esc(meta.klass || meta.grade || '')])
  if (meta.topic) items.push(['Topic', esc(meta.topic)])
  if (meta.subtopic) items.push(['Sub-topic', esc(meta.subtopic)])
  if (meta.showEnrolment) items.push(['Enrolment', 'B: ___ G: ___ T: ___'])
  if (meta.showAttendance) items.push(['Attendance', 'B: ___ G: ___ T: ___'])
  return `<div class="meta-compact">${items
    .map(([k, v]) => `<div class="item"><span class="lbl">${k}:</span><span class="val">${v}</span></div>`)
    .join('')}</div>`
}

/**
 * Dispatch to compact or full meta based on meta.compactMeta.
 * @param {object} meta
 * @returns {string}
 */
function renderMeta(meta) {
  return meta.compactMeta ? renderMetaCompact(meta) : renderMetaTable(meta)
}

/**
 * Official header block for classic formats — tight LABEL: value lines
 * matching the official CDC module appendices.
 * @param {object} meta
 * @returns {string}
 */
function renderOfficialHeader(meta) {
  const pairs = []
  const teacherDisplay = (meta.teacherName || meta.teacher || '') + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : '')
  pairs.push(['NAME OF TEACHER', esc(teacherDisplay), 'wide'])
  pairs.push(['DATE', esc(meta.date || '')])
  pairs.push(['TIME', esc(meta.time || '')])
  pairs.push(['CLASS', esc(meta.klass || meta.grade || '')])
  pairs.push(['DURATION', esc(String(meta.duration || '40')) + ' minutes'])
  if (meta.showEnrolment) pairs.push(['TOTAL ENROLMENT', 'Boys: ______ Girls: ______ Total: ______', 'wide'])
  if (meta.showAttendance) pairs.push(['TOTAL ATTENDANCE', 'Boys: ______ Girls: ______ Total: ______', 'wide'])
  pairs.push(['SUBJECT', esc(meta.subject || ''), 'wide'])
  const line = ([k, v, wide]) => `<div class="om-item${wide ? ' om-wide' : ''}"><strong>${k}:</strong> ${v}</div>`
  return `<div class="official-meta${meta.compactMeta ? ' two-col' : ''}">${pairs.map(line).join('')}</div>`
}

// ── Field line helpers ────────────────────────────────────────────────────────

/**
 * Render the canonical pre-table field lines (classic + classic2 formats).
 * @param {object} data
 * @returns {string}
 */
function renderFieldLines(data) {
  const refs = asList(data.references)
  const refsHtml =
    refs.length > 1
      ? `<div class="field-line"><strong>REFERENCES:</strong></div>` +
        refs.map((r) => `<div class="field-line" style="padding-left:18px">&bull; ${esc(r)}</div>`).join('')
      : `<div class="field-line"><strong>REFERENCES:</strong> ${esc(refs[0] || '')}</div>`

  const mats = asList(data.materials)
  const matsHtml =
    mats.length > 1
      ? `<div class="field-line" style="margin-top:8px"><strong>TEACHING AND LEARNING MATERIALS/RESOURCES:</strong></div>` +
        mats.map((m) => `<div class="field-line" style="padding-left:18px">&bull; ${esc(m)}</div>`).join('')
      : `<div class="field-line" style="margin-top:8px"><strong>TEACHING AND LEARNING MATERIALS/RESOURCES:</strong> ${esc(mats[0] || '')}</div>`

  return `
    <div class="field-line"><strong>TOPIC:</strong> ${esc(data.topic || '')}</div>
    <div class="field-line"><strong>SUB-TOPIC:</strong> ${esc(data.subtopic || '')}</div>
    <div class="field-line"><strong>GENERAL COMPETENCES:</strong> ${esc(joinList(data.generalCompetences, ', '))}</div>
    <div class="field-line"><strong>SPECIFIC COMPETENCE:</strong> ${esc(data.specificCompetence || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>LESSON GOAL:</strong> ${esc(data.lessonGoal || '')}</div>
    <div class="field-line"><strong>RATIONALE:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line"><strong>PRIOR KNOWLEDGE:</strong> ${esc(data.priorKnowledge || '')}</div>
    ${refsHtml}
    <div class="field-line" style="margin-top:8px"><strong>LEARNING ENVIRONMENT:</strong></div>
    <div class="field-line" style="padding-left:18px">I. <strong>Natural:</strong> ${esc(data.learningEnvironment?.natural || '')}</div>
    <div class="field-line" style="padding-left:18px">II. <strong>Artificial:</strong> ${esc(data.learningEnvironment?.artificial || '')}</div>
    <div class="field-line" style="padding-left:18px">III. <strong>Technological:</strong> ${esc(data.learningEnvironment?.technological || '')}</div>
    ${matsHtml}
    <div class="field-line"><strong>EXPECTED STANDARD:</strong> ${esc(data.expectedStandard || data.expectedStandards || '')}</div>`
}

/**
 * Render the lesson evaluation / reflection block.
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderLessonEvaluation(data, meta) {
  const extras = []
  if (data.remedialWork) {
    extras.push(
      `<div class="field-line" style="margin-top:10px"><strong>REMEDIAL WORK:</strong> ${esc(data.remedialWork)}</div>`,
    )
  }
  if (data.extensionActivity) {
    extras.push(
      `<div class="field-line"${data.remedialWork ? '' : ' style="margin-top:10px"'}><strong>EXTENSION ACTIVITY:</strong> ${esc(data.extensionActivity)}</div>`,
    )
  }
  if (!meta.showReflection) return extras.join('')
  const blank = (n) => `<div class="field-line">${'_'.repeat(n)}</div>`
  const prompt = (label, hint) =>
    `<div class="field-line"><strong>${label}</strong> (${hint}): ${'_'.repeat(18)}</div>`
  return `${extras.join('')}
    <div class="field-line" style="margin-top:14px"><strong>LESSON EVALUATION:</strong></div>
    ${prompt('Successes', 'competences achieved')}
    ${blank(58)}
    ${prompt('Challenges', 'competences not achieved and why')}
    ${blank(58)}
    ${prompt('Way forward', 'including remedial work if applicable')}
    ${blank(58)}`
}

// ── New curriculum (2023 ECF / CBC) renderers ─────────────────────────────────

/**
 * "Modern Clean" format — sectioned layout with one mini-table per stage.
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderModern(data, meta) {
  const list = (arr) =>
    asList(arr)
      .map((x) => `<li>${esc(stripPrefix(x))}</li>`)
      .join('')

  const stages = ensureStages(data.stages)
    .map(
      (s) => `
    <div class="stage-block"><table class="stage-table m-stage-table">
      <tr><td colspan="3" class="stage-head">${esc(s.name)}${s.duration ? `<span class="duration">${esc(s.duration)}</span>` : ''}</td></tr>
      <tr><th class="col-head">TEACHER'S ACTIVITIES</th><th class="col-head">LEARNERS' ACTIVITIES</th><th class="col-head">ASSESSMENT CRITERIA</th></tr>
      <tr><td>${formatProse(s.teacher)}</td><td>${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td><td>${formatProse(s.assessment || '')}</td></tr>
    </table></div>`,
    )
    .join('')

  const support =
    data.remedialWork || data.extensionActivity
      ? `
    <h2 class="sec">Remedial Work &amp; Extension</h2>
    ${data.remedialWork ? `<p><strong>Remedial work:</strong> ${esc(data.remedialWork)}</p>` : ''}
    ${data.extensionActivity ? `<p><strong>Extension activity:</strong> ${esc(data.extensionActivity)}</p>` : ''}`
      : ''

  const evaluation = meta.showReflection
    ? `
    <h2 class="sec">Lesson Evaluation</h2>
    <div class="callout-line"><strong>Successes (competences achieved):</strong><span class="blank"></span></div>
    <div class="callout-line"><strong>Challenges (competences not achieved and why):</strong><span class="blank"></span></div>
    <div class="callout-line"><strong>Way forward (including remedial work if applicable):</strong><span class="blank"></span></div>`
    : ''

  return `<div class="plan-official">${renderHeader(meta)}${renderMeta(meta)}
    <h2 class="sec">General Competences</h2><ul>${list(data.generalCompetences)}</ul>
    <h2 class="sec">Specific Competence</h2><p>${esc(data.specificCompetence || '')}</p>
    <h2 class="sec">Lesson Goal</h2><p>${esc(data.lessonGoal || '')}</p>
    <h2 class="sec">Rationale</h2><p>${esc(data.rationale || '')}</p>
    <h2 class="sec">Prior Knowledge</h2><p>${esc(data.priorKnowledge || '')}</p>
    <h2 class="sec">References</h2><ul>${list(data.references)}</ul>
    <h2 class="sec">Learning Environment</h2>
    <p><strong>Natural:</strong> ${esc(data.learningEnvironment?.natural || '')}</p>
    <p><strong>Artificial:</strong> ${esc(data.learningEnvironment?.artificial || '')}</p>
    <p><strong>Technological:</strong> ${esc(data.learningEnvironment?.technological || '')}</p>
    <h2 class="sec">Teaching &amp; Learning Materials</h2><ul>${list(data.materials)}</ul>
    <h2 class="sec">Expected Standard</h2><p>${esc(data.expectedStandard || data.expectedStandards || '')}</p>
    <h2 class="sec">Lesson Progression</h2>${stages}
    ${support}
    ${evaluation}</div>`
}

/**
 * "Classic" format — ONE progression table with four columns.
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderClassic(data, meta) {
  const stagesHtml = ensureStages(data.stages)
    .map(
      (s) => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.assessment || '')}</td></tr>`,
    )
    .join('')

  return `<div class="plan-official">${renderHeader(meta)}${renderOfficialHeader(meta)}
    ${renderFieldLines(data)}
    <div class="progression-title">LESSON PROGRESSION</div>
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%">
      <thead><tr><th style="width:15%;${OFFICIAL_TH}">STAGES</th><th style="width:31%;${OFFICIAL_TH}">TEACHER'S ACTIVITIES</th><th style="width:30%;${OFFICIAL_TH}">LEARNERS' ACTIVITIES</th><th style="width:24%;${OFFICIAL_TH}">ASSESSMENT CRITERIA</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${renderLessonEvaluation(data, meta)}</div>`
}

/**
 * "Official CBC Format" — per-stage tables with Teacher's Role / Learners' Role columns.
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderClassic2(data, meta) {
  const stages = ensureStages(data.stages)
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
        <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
        <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
        <td style="${OFFICIAL_TD}">${formatProse(s.assessment || '')}</td>
      </tr>
    </table></div>`,
    )
    .join('')

  return `<div class="plan-official">${renderHeader(meta)}${renderOfficialHeader(meta)}
    ${renderFieldLines(data)}
    <div class="progression-title">LESSON PROGRESSION</div>${stages}
    ${renderLessonEvaluation(data, meta)}</div>`
}

// ── Old curriculum (2013) renderers ───────────────────────────────────────────

/**
 * Old-curriculum official header block.
 * @param {object} meta
 * @param {object} data
 * @returns {string}
 */
function renderOldHeader(meta, data) {
  const pairs = []
  const teacherDisplay = (meta.teacherName || meta.teacher || '') + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : '')
  pairs.push(['NAME OF TEACHER', esc(teacherDisplay), 'wide'])
  pairs.push(['DATE', esc(meta.date || '')])
  pairs.push(['TIME', esc(meta.time || '')])
  pairs.push(['SUBJECT', esc(meta.subject || '')])
  pairs.push(['DURATION', esc(String(meta.duration || '40')) + ' minutes'])
  pairs.push(['GRADE', esc(meta.klass || meta.grade || '')])
  pairs.push(['TOPIC', esc(data.topic || ''), 'wide'])
  pairs.push(['SUB-TOPIC', esc(data.subtopic || ''), 'wide'])
  if (meta.showEnrolment) pairs.push(['NO. OF PUPILS', 'Boys: ______ Girls: ______ Total: ______', 'wide'])
  if (meta.showAttendance) pairs.push(['ATTENDANCE', 'Boys: ______ Girls: ______ Total: ______', 'wide'])
  pairs.push(['T/L AIDS', esc(joinList(data.tlAids || data.materials, ', ')), 'wide'])
  pairs.push(['REFERENCES', esc(joinList(data.references, '; ')), 'wide'])
  const line = ([k, v, wide]) => `<div class="om-item${wide ? ' om-wide' : ''}"><strong>${k}:</strong> ${v}</div>`
  return `<div class="official-meta${meta.compactMeta ? ' two-col' : ''}">${pairs.map(line).join('')}</div>`
}

/**
 * Old-curriculum field lines: RATIONALE → PRE-REQUISITE → SPECIFIC OUTCOMES.
 * @param {object} data
 * @returns {string}
 */
function renderOldFieldLines(data) {
  const outcomes = asList(data.specificOutcomes)
  const outcomesHtml = outcomes.length
    ? `<div class="field-line" style="margin-top:8px"><strong>SPECIFIC OUTCOMES (LSBAT):</strong> By the end of this lesson, pupils should be able to:</div>` +
      outcomes
        .map((o, i) => `<div class="field-line" style="padding-left:18px">${romanNum(i + 1)}. ${esc(stripPrefix(o))}</div>`)
        .join('')
    : ''
  return `
    <div class="field-line" style="margin-top:8px"><strong>RATIONALE:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line"><strong>PRE-REQUISITE KNOWLEDGE:</strong> ${esc(data.prerequisiteKnowledge || data.priorKnowledge || '')}</div>
    ${outcomesHtml}`
}

/**
 * Old-curriculum homework + evaluation blanks.
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderOldClosing(data, meta) {
  const parts = []
  if (data.homework) {
    parts.push(
      `<div class="field-line" style="margin-top:10px"><strong>HOMEWORK / EXERCISE:</strong> ${esc(data.homework)}</div>`,
    )
  }
  if (!meta.showReflection) return parts.join('')
  const blank = (n) => `<div class="field-line">${'_'.repeat(n)}</div>`
  parts.push(`
    <div class="field-line" style="margin-top:14px"><strong>PUPIL EVALUATION:</strong></div>
    ${blank(58)}
    ${blank(58)}
    <div class="field-line" style="margin-top:10px"><strong>TEACHER EVALUATION:</strong></div>
    ${blank(58)}
    ${blank(58)}`)
  return parts.join('')
}

/**
 * Old-curriculum "Classic" — five-column progression table
 * (STAGE/TIME | CONTENT | TEACHER'S ACTIVITY | PUPILS' ACTIVITY | METHODS).
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderOldClassic(data, meta) {
  const stagesHtml = ensureOldStages(data.stages)
    .map(
      (s) => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.content || '')}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.methods || '')}</td></tr>`,
    )
    .join('')

  return `<div class="plan-official">${renderHeader(meta)}${renderOldHeader(meta, data)}
    ${renderOldFieldLines(data)}
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;margin-top:10px">
      <thead><tr><th style="width:11%;${OFFICIAL_TH}">STAGE/TIME</th><th style="width:30%;${OFFICIAL_TH}">CONTENT</th><th style="width:22%;${OFFICIAL_TH}">TEACHER'S ACTIVITY</th><th style="width:22%;${OFFICIAL_TH}">PUPILS' ACTIVITY</th><th style="width:15%;${OFFICIAL_TH}">METHODS</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${renderOldClosing(data, meta)}</div>`
}

/**
 * Old-curriculum "Classic 2" — four-column table without CONTENT column.
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderOldClassic2(data, meta) {
  const stagesHtml = ensureOldStages(data.stages)
    .map(
      (s) => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.methods || '')}</td></tr>`,
    )
    .join('')

  return `<div class="plan-official">${renderHeader(meta)}${renderOldHeader(meta, data)}
    ${renderOldFieldLines(data)}
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;margin-top:10px">
      <thead><tr><th style="width:14%;${OFFICIAL_TH}">STAGE/TIME</th><th style="width:34%;${OFFICIAL_TH}">TEACHER'S ACTIVITY</th><th style="width:34%;${OFFICIAL_TH}">PUPILS' ACTIVITY</th><th style="width:18%;${OFFICIAL_TH}">METHODS</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${renderOldClosing(data, meta)}</div>`
}

/**
 * Old-curriculum "Modern" — simple primary template with three-column table.
 * @param {object} data
 * @param {object} meta
 * @returns {string}
 */
function renderOldModern(data, meta) {
  const outcomes = asList(data.specificOutcomes)
  const outcomesHtml = outcomes.length
    ? outcomes
        .map((o, i) => `<div class="field-line" style="padding-left:18px">${romanNum(i + 1)}. ${esc(stripPrefix(o))}</div>`)
        .join('')
    : ''

  const headerPairs = [
    ['NAME', esc((meta.teacherName || meta.teacher || '') + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : ''))],
    ['DATE', esc(meta.date || '')],
    ['SUBJECT', esc(meta.subject || '')],
    ['DURATION', esc(String(meta.duration || '40')) + ' minutes'],
    ['TOPIC', esc(data.topic || '')],
    ['NO. OF PUPILS', 'Boys: ______ Girls: ______ Total: ______'],
    ['SUB-TOPIC', esc(data.subtopic || ''), 'wide'],
  ]
  if (meta.showAttendance) headerPairs.push(['ATTENDANCE', 'Boys: ______ Girls: ______ Total: ______', 'wide'])

  const line = ([k, v, wide]) => `<div class="om-item${wide ? ' om-wide' : ''}"><strong>${k}:</strong> ${v}</div>`

  const stagesHtml = ensureOldStages(data.stages)
    .map(
      (s) => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td></tr>`,
    )
    .join('')

  const blank = (n) => `<div class="field-line">${'_'.repeat(n)}</div>`
  const evaluation = meta.showReflection
    ? `
    <div class="field-line" style="margin-top:14px"><strong>EVALUATION:</strong></div>
    ${blank(58)}
    ${blank(58)}
    ${blank(58)}`
    : ''

  return `<div class="plan-official">${renderHeader(meta)}
    <div class="official-meta${meta.compactMeta ? ' two-col' : ''}">${headerPairs.map(line).join('')}</div>
    <div class="field-line"><strong>T/L MATERIALS:</strong> ${esc(joinList(data.tlAids || data.materials, ', '))}</div>
    <div class="field-line"><strong>REFERENCE:</strong> ${esc(joinList(data.references, '; '))}</div>
    <div class="field-line" style="margin-top:8px"><strong>RATIONALE:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>OUTCOMES:</strong> By the end of this lesson, LSBAT;</div>
    ${outcomesHtml}
    <div class="field-line" style="margin-top:8px"><strong>PRE-REQUISITE:</strong> ${esc(data.prerequisiteKnowledge || data.priorKnowledge || '')}</div>
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;margin-top:10px">
      <thead><tr><th style="width:16%;${OFFICIAL_TH}">STAGES/TIME</th><th style="width:42%;${OFFICIAL_TH}">TEACHING ACTIVITIES</th><th style="width:42%;${OFFICIAL_TH}">LEARNING ACTIVITIES</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${data.homework ? `<div class="field-line" style="margin-top:10px"><strong>HOMEWORK:</strong> ${esc(data.homework)}</div>` : ''}
    ${evaluation}</div>`
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Convert a parsed lesson-plan JSON object to an HTML string.
 *
 * @param {object} planJson  - Parsed JSON from the Cloud Function
 * @param {object} meta      - Rendering metadata:
 *   {
 *     format: 'modern' | 'classic' | 'classic2' | 'official-cbc',
 *     showReflection:  boolean,
 *     showEnrolment:   boolean,
 *     showAttendance:  boolean,
 *     compactMeta:     boolean,
 *     teacherName:     string,
 *     school:          string,
 *     date:            string,
 *     time:            string,
 *     lessonNumber:    number,
 *     totalLessons:    number,
 *   }
 * @param {string} curriculumMode - 'cbc' | 'previous'
 * @returns {string} HTML string
 */
export function renderPlanHtml(planJson, meta, curriculumMode) {
  if (!planJson || typeof planJson !== 'object') return ''

  const isOld = curriculumMode === 'previous'

  // Normalise the format key — the Format & Options card emits 'official', the
  // older saved-plan meta used 'official-cbc'; both map to 'classic2' internally.
  const fmt = (meta.format || 'modern').toLowerCase().replace(/^official(-cbc)?$/, 'classic2')

  if (fmt === 'classic') {
    return isOld ? renderOldClassic(planJson, meta) : renderClassic(planJson, meta)
  }
  if (fmt === 'classic2') {
    return isOld ? renderOldClassic2(planJson, meta) : renderClassic2(planJson, meta)
  }
  // Default: modern
  return isOld ? renderOldModern(planJson, meta) : renderModern(planJson, meta)
}
