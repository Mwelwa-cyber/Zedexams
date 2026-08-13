/**
 * Converts a validated lesson-plan JSON object into a Word (.docx) file
 * formatted the way a Zambian head teacher expects: bordered tables for the
 * header, clearly labelled sections, parallel Teacher's / Pupils' Activities
 * columns for each lesson-development phase.
 *
 * Uses `docx` (npm install docx) and `file-saver` (optional — falls back to
 * an anchor-click download if file-saver isn't installed).
 *
 *   npm install docx
 *   (optional) npm install file-saver
 */

import { saveBlob } from '../../utils/saveBlob.js'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { attributionSection } from '../../utils/docxAttribution.js'
import { sanitizeXmlText } from '../../utils/xmlText.js'
import { fetchImageBytes } from '../../utils/fetchImageBytes.js'
import { parseCellBlocks } from '../../utils/lessonPlanBlocks.js'
import { objectNamesInPlan, rasterizeObjectArt } from '../../utils/objectArtRaster.js'
import {
  headerLines,
  resolveEnvironmentLines,
  resolveLessonFormat,
} from '../../utils/lessonPlanFormat.js'

/* ────────────────────────────────────────────────────────────────────
 * Lesson illustration (black-and-white drawing) embedding.
 *
 * The drawing is a Firebase Storage PNG produced by the generateDiagram
 * callable. docx needs the raw bytes (not a URL), and the fetch is async —
 * so `downloadLessonPlanDocx` pre-fetches the bytes and hands them in via
 * `opts.diagramImage`, keeping `buildLessonPlanDocument` synchronous and
 * unit-testable.
 * ─────────────────────────────────────────────────────────────────── */

// docx v9 requires ImageRun.type; sniff it from the leading magic bytes.
// generateDiagram always saves PNG, so png is the safe default.
function detectDocxImageType(bytes) {
  if (!bytes || bytes.length < 4) return 'png'
  const [b0, b1, b2, b3] = bytes
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'png'
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'jpg'
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return 'gif'
  if (b0 === 0x42 && b1 === 0x4d) return 'bmp'
  return 'png'
}

// Aspect-fit the drawing into a printable box (pixels, for the docx
// transformation). Derives the ratio from the generated size string so a
// portrait/landscape diagram isn't squashed.
function illustrationBox(size) {
  const m = /^(\d+)x(\d+)$/.exec(String(size || '1365x1024'))
  const w = m ? Number(m[1]) : 1365
  const h = m ? Number(m[2]) : 1024
  const maxW = 440
  return { width: maxW, height: Math.max(1, Math.round(maxW * (h / w))) }
}

// Fetch the PNG bytes so the (sync) document builder can embed them. Returns
// `{ bytes, type }` on success, `{ failed: true }` so the builder can drop in
// a visible note, or null when there's nothing to embed. The shared
// fetchImageBytes helper applies the CORS-recovery strategies (warm cache →
// reload → same-origin proxy) AND a timeout, so a stuck Storage request can't
// hang the whole download — it falls through to the visible note instead.
async function fetchLessonDiagramImage(diagram) {
  if (!diagram || !diagram.url) return null
  const bytes = await fetchImageBytes(diagram.url)
  if (bytes && bytes.length) return { bytes, type: detectDocxImageType(bytes) }
  return { failed: true }
}

// Paragraphs for the lesson illustration: a CAPS label, the centred image (or
// a red note when the bytes couldn't be read cross-origin), and the prompt as
// an italic caption. Returns [] when the plan has no drawing.
function lessonIllustrationParagraphs(plan, opts) {
  const diagram = plan && plan.lessonDiagram
  if (!diagram || !diagram.url) return []
  const img = opts && opts.diagramImage
  const alt = String(diagram.prompt || '').trim()
  const out = [
    new Paragraph({
      children: [text('TEACHING ILLUSTRATION', { bold: true, size: 20 })],
      spacing: { before: 160, after: 80 },
    }),
  ]
  if (img && img.bytes) {
    const { width, height } = illustrationBox(diagram.size)
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new ImageRun({
        type: img.type || 'png',
        data: img.bytes,
        transformation: { width, height },
        ...(alt ? { altText: { name: alt, title: alt, description: alt } } : {}),
      })],
    }))
    if (alt) {
      out.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [text(alt, { italics: true, size: 16, color: '6b7280' })],
      }))
    }
  } else {
    out.push(new Paragraph({
      spacing: { after: 120 },
      children: [text(
        'Illustration could not be embedded — open the plan in the studio and download again.',
        { italics: true, size: 16, color: 'b91c1c' },
      )],
    }))
  }
  return out
}

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

function text(str, opts = {}) {
  // Sanitize at this single funnel — every run's text passes through here, so
  // stripping XML-illegal control bytes once keeps Word from rejecting the
  // whole download as "unreadable content".
  return new TextRun({ text: sanitizeXmlText(str), ...opts })
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 120 },
    ...opts,
  })
}

function h1(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 32 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  })
}

function h2(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 24, color: '1f2937' })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
  })
}

function labelCell(label, widthPct = 30) {
  return new TableCell({
    children: [para(text(label, { bold: true, size: 20 }))],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
    shading: { fill: 'f3f4f6' },
  })
}

function valueCell(value, widthPct = 70) {
  return new TableCell({
    children: [para(text(value, { size: 20 }))],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
  })
}

function bulletList(items = []) {
  if (!items?.length) return [para(text('—', { italics: true, color: '9ca3af' }))]
  return items.map((line) =>
    new Paragraph({
      children: [text(line, { size: 20 })],
      bullet: { level: 0 },
      spacing: { after: 60 },
    }),
  )
}

function numberedList(items = []) {
  if (!items?.length) return [para(text('—', { italics: true, color: '9ca3af' }))]
  return items.map((line, i) =>
    new Paragraph({
      children: [text(`${i + 1}. `, { bold: true, size: 20 }), text(line, { size: 20 })],
      spacing: { after: 60 },
    }),
  )
}

function headerTable(header = {}) {
  const hasAttendance =
    header.boysPresent != null || header.girlsPresent != null || header.totalPupils != null
  const attendance = hasAttendance
    ? `${header.boysPresent ?? '—'} boys · ${header.girlsPresent ?? '—'} girls · Total: ${header.totalPupils ?? header.numberOfPupils ?? '—'}`
    : header.numberOfPupils
  const rows = [
    ['School', header.school],
    ['Teacher', header.teacherName],
    ['Date', header.date],
    ['Time', header.time],
    ['Duration', header.durationMinutes ? `${header.durationMinutes} minutes` : ''],
    ['Class', header.class],
    ['Subject', header.subject],
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Term & Week', header.termAndWeek],
    ['Attendance', attendance],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [labelCell(k), valueCell(String(v))],
    })),
  })
}

function phaseTableV2(phase, minutes, teacher = [], learners = [], criteria = []) {
  const title = minutes != null ? `${phase} (${minutes} minutes)` : phase
  const titleRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text(title, { bold: true, size: 22 }))],
        columnSpan: 2,
        borders: CELL_BORDER,
        shading: { fill: 'e0e7ff' },
      }),
    ],
  })
  const headersRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text('Teacher Activities', { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: 'f9fafb' },
      }),
      new TableCell({
        children: [para(text('Learner Activities', { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: 'f9fafb' },
      }),
    ],
  })
  const contentRow = new TableRow({
    children: [
      new TableCell({ children: bulletList(teacher), borders: CELL_BORDER }),
      new TableCell({ children: bulletList(learners), borders: CELL_BORDER }),
    ],
  })
  const criteriaRow = criteria && criteria.length > 0 ? new TableRow({
    children: [
      new TableCell({
        children: [
          para(text('Assessment Criteria:', { bold: true, size: 20 })),
          ...bulletList(criteria),
        ],
        columnSpan: 2,
        borders: CELL_BORDER,
        shading: { fill: 'fef3c7' },
      }),
    ],
  }) : null
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: criteriaRow ? [titleRow, headersRow, contentRow, criteriaRow] : [titleRow, headersRow, contentRow],
  })
}

function interdisciplinaryTable(connections = []) {
  if (!connections.length) return null
  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text('Subject', { bold: true, size: 20 }))],
        width: { size: 30, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: 'f3f4f6' },
      }),
      new TableCell({
        children: [para(text('How the concept connects', { bold: true, size: 20 }))],
        width: { size: 70, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: 'f3f4f6' },
      }),
    ],
  })
  const bodyRows = connections.map((c) => new TableRow({
    children: [
      new TableCell({ children: [para(text(c.subject || '', { bold: true, size: 20 }))], borders: CELL_BORDER }),
      new TableCell({ children: [para(text(c.connection || '', { size: 20 }))], borders: CELL_BORDER }),
    ],
  }))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  })
}

function phaseTable(phase, minutes, teacher = [], pupils = []) {
  const title = minutes != null ? `${phase} (${minutes} minutes)` : phase

  const titleRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text(title, { bold: true, size: 22 }))],
        columnSpan: 2,
        borders: CELL_BORDER,
        shading: { fill: 'e0e7ff' },
      }),
    ],
  })

  const headersRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text("Teacher's Activities", { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: 'f9fafb' },
      }),
      new TableCell({
        children: [para(text("Pupils' Activities", { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: 'f9fafb' },
      }),
    ],
  })

  const contentRow = new TableRow({
    children: [
      new TableCell({ children: bulletList(teacher), borders: CELL_BORDER }),
      new TableCell({ children: bulletList(pupils), borders: CELL_BORDER }),
    ],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [titleRow, headersRow, contentRow],
  })
}

function referencesBlock(refs = []) {
  if (!refs.length) return bulletList([])
  return refs.map((r) => new Paragraph({
    children: [
      text(r.title || '', { bold: true, size: 20 }),
      text(r.publisher ? ` — ${r.publisher}` : '', { size: 20 }),
      text(r.pages ? ` (pp. ${r.pages})` : '', { size: 20, italics: true, color: '6b7280' }),
    ],
    bullet: { level: 0 },
    spacing: { after: 60 },
  }))
}

function buildV2Body(plan, opts = {}) {
  const children = []
  children.push(headerTable(plan.header || {}))
  children.push(...lessonIllustrationParagraphs(plan, opts))

  if (plan.lessonGoal) {
    children.push(h2('Lesson Goal (SMART)'))
    children.push(para(text(plan.lessonGoal, { size: 20 })))
  }

  children.push(h2('Competences'))
  if (plan.broadCompetences?.length) {
    children.push(para(text('Broad Competences:', { bold: true, size: 20 })))
    children.push(...bulletList(plan.broadCompetences))
  }
  if (plan.expectedTargetCompetence) {
    children.push(para(text('Expected Target Competence:', { bold: true, size: 20 })))
    children.push(para(text(plan.expectedTargetCompetence, { size: 20 })))
  }
  const lc = plan.lessonCompetencies || {}
  if (lc.competency1 || lc.competency2 || lc.competency3) {
    children.push(para(text('Lesson Competencies:', { bold: true, size: 20 })))
    const lcItems = [
      lc.competency1 && `Higher-order thinking — ${lc.competency1}`,
      lc.competency2 && `Thinking process — ${lc.competency2}`,
      lc.competency3 && `Tangible output — ${lc.competency3}`,
    ].filter(Boolean)
    children.push(...numberedList(lcItems))
  }

  const m = plan.methodology || {}
  if (m.approach || m.strategies?.length) {
    children.push(h2('Methodology and Strategies'))
    if (m.approach) {
      children.push(para([
        text('Approach: ', { bold: true, size: 20 }),
        text(m.approach, { size: 20 }),
      ]))
    }
    if (m.strategies?.length) {
      children.push(para(text('Strategies:', { bold: true, size: 20 })))
      children.push(...bulletList(m.strategies))
    }
  }

  const le = plan.learningEnvironment || {}
  if (le.category || le.specific || le.rationale) {
    children.push(h2('Learning Environment'))
    const catLine = [le.category ? le.category.charAt(0).toUpperCase() + le.category.slice(1) : '', le.specific].filter(Boolean).join(' — ')
    if (catLine) children.push(para(text(catLine, { bold: true, size: 20 })))
    if (le.rationale) children.push(para(text(le.rationale, { size: 20, italics: true, color: '6b7280' })))
  }

  if (plan.teachingLearningMaterials?.length) {
    children.push(h2('Teaching / Learning Materials'))
    children.push(...bulletList(plan.teachingLearningMaterials))
  }
  if (plan.prerequisiteKnowledge?.length) {
    children.push(h2('Prior Knowledge'))
    children.push(...bulletList(plan.prerequisiteKnowledge))
  }
  if (plan.interdisciplinaryConnections?.length) {
    children.push(h2('Interdisciplinary Connections'))
    const tbl = interdisciplinaryTable(plan.interdisciplinaryConnections)
    if (tbl) children.push(tbl)
    children.push(para([]))
  }

  children.push(h2('Lesson Progression (5E)'))
  const lp = plan.lessonProgression || {}
  const phaseSpecs = [
    ['1. Engagement — Introduction', lp.engagement],
    ['2. Exploration — Development', lp.exploration],
    ['3. Explanation — Conceptualization', lp.explanation],
    ['4. Synthesis — Continuity & Extension', lp.synthesis],
    ['5. Evaluation & Reflection — Conclusion', lp.evaluation],
  ]
  for (const [title, phase] of phaseSpecs) {
    const p = phase || {}
    children.push(phaseTableV2(
      title,
      p.durationMinutes,
      p.teacherActivities || [],
      p.learnerActivities || [],
      p.assessmentCriteria || [],
    ))
    children.push(para([]))
  }
  return children
}

function buildV1Body(plan, opts = {}) {
  const children = []
  children.push(headerTable(plan.header || {}))
  children.push(...lessonIllustrationParagraphs(plan, opts))

  children.push(h2('Specific Outcomes'))
  children.push(...numberedList(plan.specificOutcomes))

  children.push(h2('Key Competencies'))
  children.push(...bulletList(plan.keyCompetencies))

  children.push(h2('Values'))
  children.push(...bulletList(plan.values))

  children.push(h2('Prerequisite Knowledge'))
  children.push(...bulletList(plan.prerequisiteKnowledge))

  children.push(h2('Teaching / Learning Materials'))
  children.push(...bulletList(plan.teachingLearningMaterials))

  if (plan.references?.length) {
    children.push(h2('References'))
    children.push(...referencesBlock(plan.references))
  }

  children.push(h2('Lesson Development'))

  const intro = plan.lessonDevelopment?.introduction || {}
  children.push(phaseTable(
    'Introduction',
    intro.durationMinutes,
    intro.teacherActivities,
    intro.pupilActivities,
  ))
  children.push(para([]))

  for (const step of plan.lessonDevelopment?.development || []) {
    children.push(phaseTable(
      `Development — Step ${step.stepNumber}: ${step.title}`,
      step.durationMinutes,
      step.teacherActivities,
      step.pupilActivities,
    ))
    children.push(para([]))
  }

  const concl = plan.lessonDevelopment?.conclusion || {}
  children.push(phaseTable(
    'Conclusion',
    concl.durationMinutes,
    concl.teacherActivities,
    concl.pupilActivities,
  ))
  return children
}

/* ────────────────────────────────────────────────────────────────────
 * v3 — the compact official layout (2026-07).
 *
 * Every rule that decides how much paper a plan uses is read from the
 * resolved format in `src/utils/lessonPlanFormat.js` (opts.lessonFormat) —
 * the same object the studio preview and the print window read. The three
 * renderers used to carry three sets of numbers, which is how a teacher
 * could choose "2 pages", see two on screen, and download four.
 *
 * The Word-specific parts of §4:
 *   - cells carry dash lines, NOT `bullet: { level: 0 }` — a bullet indents
 *     ~0.6 cm inside an already-narrow cell and forces extra wrapping;
 *   - the header row repeats on a page break (`tableHeader: true`) instead of
 *     the whole "LESSON PROGRESSION" block being re-emitted;
 *   - body rows may split (`cantSplit: false`), so a long Development row
 *     wraps across the boundary rather than shunting itself wholesale onto the
 *     next page and leaving a half-blank one behind it.
 * ─────────────────────────────────────────────────────────────────── */

const BLACK_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  left:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  right:  { style: BorderStyle.SINGLE, size: 6, color: '000000' },
}

const NONE_EDGE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = {
  top: NONE_EDGE, bottom: NONE_EDGE, left: NONE_EDGE, right: NONE_EDGE,
  insideHorizontal: NONE_EDGE, insideVertical: NONE_EDGE,
}

// A4 in twips, and the conversion the page geometry is built from.
const A4_WIDTH_TWIPS = 11906
const A4_HEIGHT_TWIPS = 16838
const TWIPS_PER_MM = 56.6929

const mmToTwips = (mm) => Math.round(mm * TWIPS_PER_MM)
const ptToHalfPt = (pt) => Math.max(2, Math.round(pt * 2))
const ptToTwips = (pt) => Math.round(pt * 20)

/** The resolved lesson format for an export, with a safe default. */
function exportFormat(opts) {
  return resolveLessonFormat(opts?.lessonFormat || {})
}

/** Usable text width for a format's margins — what column widths divide up. */
function contentWidthTwips(fmt) {
  return A4_WIDTH_TWIPS - 2 * mmToTwips(fmt.marginMm)
}

/** Percentages → DXA column widths that sum to the real content width. */
function columnWidths(fmt, percentages) {
  const total = contentWidthTwips(fmt)
  return percentages.map((p) => Math.round((total * p) / 100))
}

// The active typography, set once per document build. A module-level value
// rather than a threaded argument because every helper below needs it and
// threading it through fifteen signatures obscured what they actually do.
let FMT = { bodyPt: 11, tablePt: 10, cellPaddingPt: 3, lineHeight: 1.25, cellSpaceAfterPt: 0, sectionGapPt: 4 }

function setTypography(fmt) {
  FMT = fmt.typography
}

/** Line spacing for a paragraph, from the density's line height. */
function lineSpacing(pt) {
  return { line: Math.round(pt * FMT.lineHeight * 20), lineRule: 'atLeast' }
}

/**
 * A section line: underlined bold label, value inline, one line (§4.3, §4.4).
 * Returns null for an empty value so a switched-off or unanswered section
 * prints nothing rather than a label with a blank after it.
 */
function fieldLine(label, value) {
  const v = value == null ? '' : String(value).trim()
  if (!v) return null
  return new Paragraph({
    children: [
      text(`${label}: `, { bold: true, underline: {}, size: ptToHalfPt(FMT.bodyPt) }),
      text(v, { size: ptToHalfPt(FMT.bodyPt) }),
    ],
    spacing: { after: ptToTwips(FMT.sectionGapPt / 2), ...lineSpacing(FMT.bodyPt) },
  })
}

/** A label-only line (a heading for a following block). */
function labelLine(label, extra = {}) {
  return new Paragraph({
    children: [text(label, { bold: true, underline: {}, size: ptToHalfPt(FMT.bodyPt) })],
    spacing: { after: ptToTwips(FMT.sectionGapPt / 2), ...lineSpacing(FMT.bodyPt) },
    ...extra,
  })
}

/**
 * Dash lines inside a table cell (§4.1). Plain paragraphs prefixed "– " with
 * hanging indent zero — the whole point is that no cell width is spent on a
 * list marker.
 */
function dashList(items = []) {
  const lines = (Array.isArray(items) ? items : toLinesLocal(items))
    .map((s) => String(s == null ? '' : s).replace(/^\s*[–—•*-]\s*/, '').trim())
    .filter(Boolean)
  if (lines.length === 0) return [new Paragraph({ children: [], spacing: { after: 0 } })]
  return lines.map((line) => new Paragraph({
    children: [text(`– ${line}`, { size: ptToHalfPt(FMT.tablePt) })],
    spacing: { after: ptToTwips(FMT.cellSpaceAfterPt), ...lineSpacing(FMT.tablePt) },
  }))
}

/* ── §4.7 structured cell content ──────────────────────────────────── */

// The digits of a worked column sum, one place value per cell, so the columns
// line up in Word's proportional font. A monospace <pre> aligns only while the
// font is monospace — which Word's default is not.
function sumTable(node) {
  const cellOf = (runs, { rule = false } = {}) => new TableCell({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: runs,
      spacing: { after: 0, ...lineSpacing(FMT.tablePt) },
    })],
    borders: rule
      ? { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } }
      : NO_BORDERS,
    margins: { top: 0, bottom: 0, left: 20, right: 20 },
  })
  const digitRow = (n, { sign = '', rule = false } = {}) => {
    const digits = String(n).padStart(node.width, ' ').split('')
    return new TableRow({
      cantSplit: true,
      children: [
        cellOf([text(sign, { size: ptToHalfPt(FMT.tablePt) })], { rule }),
        ...digits.map((d) => cellOf(
          [text(d === ' ' ? '' : d, { size: ptToHalfPt(FMT.tablePt) })],
          { rule },
        )),
      ],
    })
  }
  const headRow = new TableRow({
    cantSplit: true,
    children: [
      cellOf([]),
      ...node.headings.map((h) => cellOf([text(h, { size: ptToHalfPt(FMT.tablePt - 1), bold: true })])),
    ],
  })
  return new Table({
    borders: NO_BORDERS,
    rows: [
      headRow,
      ...node.addends.map((a, i) => digitRow(a, {
        sign: i === 0 ? '' : '+',
        rule: i === node.addends.length - 1,
      })),
      digitRow(node.total),
    ],
  })
}

function expandParagraph(node) {
  return new Paragraph({
    children: [text(node.parts.join(' + '), { size: ptToHalfPt(FMT.tablePt) })],
    spacing: { after: ptToTwips(FMT.cellSpaceAfterPt), ...lineSpacing(FMT.tablePt) },
  })
}

/**
 * The early-childhood matching exercise. Each pair is a row: the left object,
 * a dotted gap the learner draws through, and the right object.
 *
 * The line art reaches Word as a real picture only when the caller pre-
 * rasterised it (`opts.objectArt`, built in the browser by
 * `downloadLessonPlanDocx`). Without it the block still prints as a usable
 * matching sheet with the object WORDS in their boxes — the exercise survives,
 * plainer, rather than exporting as an empty grid.
 */
function matchTable(node, art) {
  const objectCell = (name) => {
    const picture = art && art[name]
    const children = []
    if (picture) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [new ImageRun({
          type: picture.type || 'png',
          data: picture.bytes,
          transformation: { width: picture.width, height: picture.height },
          altText: { name, title: name, description: name },
        })],
      }))
    }
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [text(name, { size: ptToHalfPt(FMT.tablePt) })],
      spacing: { after: 0, ...lineSpacing(FMT.tablePt) },
    }))
    return new TableCell({
      children,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
        left: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
        right: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
      },
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
    })
  }
  const gapCell = () => new TableCell({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [text('·   ·   ·', { size: ptToHalfPt(FMT.tablePt), color: '888888' })],
      spacing: { after: 0 },
    })],
    borders: NO_BORDERS,
    verticalAlign: 'center',
  })
  return [
    new Paragraph({
      children: [text('Draw a line to match the objects that are the same:', {
        italics: true, size: ptToHalfPt(FMT.tablePt),
      })],
      spacing: { after: ptToTwips(2), ...lineSpacing(FMT.tablePt) },
    }),
    new Table({
      borders: NO_BORDERS,
      rows: node.pairs.map((p) => new TableRow({
        cantSplit: true,
        children: [objectCell(p.left), gapCell(), objectCell(p.right)],
      })),
    }),
  ]
}

/**
 * A whole progression cell: prose as dash lines, structured blocks as real
 * Word objects, in the order they were written.
 */
function cellChildren(value, opts = {}) {
  const nodes = parseCellBlocks(value)
  if (nodes.length === 0) return dashList([])
  const out = []
  for (const node of nodes) {
    if (node.type === 'text') out.push(...dashList(toLinesLocal(node.text)))
    else if (node.type === 'sum') out.push(sumTable(node), new Paragraph({ children: [], spacing: { after: 0 } }))
    else if (node.type === 'expand') out.push(expandParagraph(node))
    else if (node.type === 'match') out.push(...matchTable(node, opts.objectArt))
  }
  return out.length ? out : dashList([])
}

/* ── Table scaffolding ─────────────────────────────────────────────── */

function progressionHeaderCell(label, width) {
  return new TableCell({
    children: [new Paragraph({
      children: [text(label, { bold: true, size: ptToHalfPt(FMT.tablePt) })],
      spacing: { after: 0, ...lineSpacing(FMT.tablePt) },
    })],
    width: { size: width, type: WidthType.DXA },
    borders: BLACK_BORDER,
    margins: cellMargins(),
  })
}

function cellMargins() {
  const pad = ptToTwips(FMT.cellPaddingPt)
  return { top: pad, bottom: pad, left: pad + 20, right: pad + 20 }
}

function progressionCell(children, width) {
  return new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    borders: BLACK_BORDER,
    margins: cellMargins(),
  })
}

/**
 * The STAGES cell: the name, then the duration on its own line. Word wraps on
 * word boundaries by default, so the mid-word breaks the HTML needed
 * `hyphens:none` for cannot happen here — but the 18% column still matters,
 * because at 15% "ASSESSMENT" alone overflows the measure.
 */
function stageCell(stage, width) {
  const duration = stage.durationMinutes > 0
    ? `${stage.durationMinutes} min`
    : String(stage.duration || '').replace(/[()]/g, '').trim()
  const children = [new Paragraph({
    children: [text(stage.name || '', { bold: true, size: ptToHalfPt(FMT.tablePt) })],
    spacing: { after: 0, ...lineSpacing(FMT.tablePt) },
  })]
  if (duration) {
    children.push(new Paragraph({
      children: [text(`(${duration})`, { italics: true, size: ptToHalfPt(FMT.tablePt - 1) })],
      spacing: { after: 0, ...lineSpacing(FMT.tablePt) },
    }))
  }
  return progressionCell(children, width)
}

/**
 * One ruled line per evaluation field (§4.5).
 *
 * A borderless two-column table: the label in the first cell, an empty
 * bottom-bordered cell filling the rest of the measure. The old rendering was
 * two 60-underscore paragraphs per field — a third of a page for three fields,
 * and a run of underscores is one unbreakable "word" so it wrapped wherever it
 * liked.
 */
function ruledFields(fmt, labels) {
  const total = contentWidthTwips(fmt)
  const labelWidth = Math.round(total * 0.28)
  const ruleWidth = total - labelWidth
  const underlinedCell = () => new TableCell({
    children: [new Paragraph({ children: [], spacing: { after: 0 } })],
    width: { size: ruleWidth, type: WidthType.DXA },
    borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } },
    margins: { top: 60, bottom: 60, left: 60, right: 0 },
  })
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: [labelWidth, ruleWidth],
    borders: NO_BORDERS,
    rows: labels.map((label) => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          children: [new Paragraph({
            children: label
              ? [text(`${label}:`, { bold: true, underline: {}, size: ptToHalfPt(FMT.bodyPt) })]
              : [],
            spacing: { after: 0, ...lineSpacing(FMT.bodyPt) },
          })],
          width: { size: labelWidth, type: WidthType.DXA },
          borders: NO_BORDERS,
          margins: { top: 60, bottom: 60, left: 0, right: 80 },
        }),
        underlinedCell(),
      ],
    })),
  })
}

/* ── Header (§4.3) ─────────────────────────────────────────────────── */

/**
 * The masthead: optional MINISTRY OF EDUCATION, the school, then LESSON PLAN.
 * No horizontal rules anywhere — the two that used to bracket the metadata
 * block cost two lines on every plan and the Ministry-style reference
 * documents do not carry them.
 */
function mastheadParagraphs(h, fmt) {
  const lines = headerLines({
    headerStyle: fmt.headerStyle,
    ministryLine: fmt.ministryLine,
    school: h.school || '',
  })
  const out = []
  if (fmt.headerStyle === 'ministry' && lines.length > 1) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [text(lines[0], { bold: true, size: ptToHalfPt(FMT.bodyPt + 1.5) })],
      spacing: { after: ptToTwips(2) },
    }))
  }
  const school = fmt.headerStyle === 'ministry' ? lines[1] : lines[0]
  if (school) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [text(school, { bold: true, size: ptToHalfPt(FMT.bodyPt + 3) })],
      spacing: { after: ptToTwips(1) },
    }))
  }
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [text('LESSON PLAN', { bold: true, size: ptToHalfPt(FMT.bodyPt + 1) })],
    spacing: { after: ptToTwips(FMT.sectionGapPt) },
  }))
  return out
}

// One borderless cell carrying an underlined "LABEL: value" pair. The label and
// its value live in ONE cell so they can never separate — which is what used to
// drop SUB-TOPIC's value onto the next line.
function metaCell(runs, width) {
  return new TableCell({
    children: [new Paragraph({ children: runs, spacing: { after: 0, ...lineSpacing(FMT.bodyPt) } })],
    width: { size: width, type: WidthType.DXA },
    borders: NO_BORDERS,
    margins: { top: 20, bottom: 20, right: 160 },
  })
}

function lvRuns(label, value) {
  const runs = [text(`${label}: `, { bold: true, underline: {}, size: ptToHalfPt(FMT.bodyPt) })]
  if (value != null && value !== '') runs.push(text(String(value), { size: ptToHalfPt(FMT.bodyPt) }))
  return runs
}

/**
 * The clean, rule-less two-column metadata block. Identity on the left,
 * session on the right; sub-topic (and any other long field) spans the width.
 */
function metaTable(h, fmt, { gradeLabel = 'Class', extraLeft = [], extraWide = [] } = {}) {
  const blank = '______'
  const left = [
    lvRuns('Name of Teacher', h.teacherName || ''),
    lvRuns(gradeLabel, h.class || ''),
    lvRuns('Subject', h.subject || ''),
    lvRuns('Topic', h.topic || ''),
    ...extraLeft.map(([k, v]) => lvRuns(k, v)),
  ]
  const right = [
    lvRuns('Date', h.date || ''),
    lvRuns('Time', h.time || ''),
    lvRuns('Duration', h.durationMinutes ? `${h.durationMinutes} minutes` : ''),
    [
      text('No of pupils: ', { bold: true, underline: {}, size: ptToHalfPt(FMT.bodyPt) }),
      text(`B: ${blank}   G: ${blank}`, { size: ptToHalfPt(FMT.bodyPt) }),
    ],
  ]
  const wide = [
    ['Sub-Topic', h.subtopic || ''],
    ...extraWide,
  ].filter(([, v]) => String(v || '').trim())

  const total = contentWidthTwips(fmt)
  const colA = Math.round(total * 0.54)
  const colB = total - colA
  const rows = []
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    rows.push(new TableRow({
      cantSplit: true,
      children: [metaCell(left[i] || [], colA), metaCell(right[i] || [], colB)],
    }))
  }
  for (const [k, v] of wide) {
    rows.push(new TableRow({
      cantSplit: true,
      children: [new TableCell({
        children: [new Paragraph({ children: lvRuns(k, v), spacing: { after: 0, ...lineSpacing(FMT.bodyPt) } })],
        columnSpan: 2,
        borders: NO_BORDERS,
        margins: { top: 20, bottom: 20 },
      })],
    }))
  }
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: [colA, colB],
    borders: NO_BORDERS,
    rows,
  })
}

/* ── Bodies ────────────────────────────────────────────────────────── */

/**
 * The OBC (Outcomes-Based / 2013) body (§4.6).
 *
 * The outcome-based plan has its OWN vocabulary — Grade not Class, Specific
 * outcomes not competences, Pre-requisite not Prior Knowledge, Learning/T Aids
 * not Materials — and its own table:
 *   STAGE/TIME | TEACHER'S ACTIVITY | LEARNER'S ACTIVITY | LEARNING POINT
 * ending in EVALUATION and LESSON LEARNT. It is not the CBC plan relabelled.
 */
function buildV3PreviousBody(plan, opts = {}, fmt) {
  const h = plan.header || {}
  const children = []
  const aids = (plan.tlAids?.length ? plan.tlAids : plan.materials || []).join(', ')

  children.push(...mastheadParagraphs(h, fmt))
  children.push(metaTable(h, fmt, {
    gradeLabel: 'Grade',
    extraLeft: fmt.sections.references ? [['Reference', (plan.references || []).join('; ')]] : [],
    extraWide: aids ? [['Learning/T Aids', aids]] : [],
  }))
  children.push(new Paragraph({ children: [], spacing: { after: ptToTwips(FMT.sectionGapPt) } }))

  const outcomes = plan.specificOutcomes || []
  if (outcomes.length === 1) {
    children.push(fieldLine('SPECIFIC OUTCOMES', outcomes[0]))
  } else if (outcomes.length > 1) {
    children.push(labelLine('SPECIFIC OUTCOMES'))
    children.push(...dashList(outcomes))
  }
  if (fmt.sections.rationale) children.push(fieldLine('RATIONALE', plan.rationale))
  children.push(fieldLine('PRE-REQUISITE', plan.prerequisiteKnowledge || plan.priorKnowledge))

  children.push(...lessonIllustrationParagraphs(plan, opts))

  children.push(progressionTable(plan, opts, fmt, {
    headings: ['STAGE/TIME', "TEACHER'S ACTIVITY", "LEARNER'S ACTIVITY", 'LEARNING POINT'],
    fourth: (s) => (s.learningPoint ?? s.assessmentCriteria ?? s.methods ?? ''),
  }))

  if (fmt.sections.homework && plan.homework) children.push(fieldLine('HOMEWORK', plan.homework))
  if (fmt.sections.lessonEvaluation) {
    children.push(labelLine('EVALUATION', { spacing: { before: ptToTwips(FMT.sectionGapPt), after: ptToTwips(2) } }))
    children.push(ruledFields(fmt, ['', '']))
    children.push(labelLine('LESSON LEARNT', { spacing: { before: ptToTwips(FMT.sectionGapPt), after: ptToTwips(2) } }))
    children.push(ruledFields(fmt, ['', '']))
  }
  return children.filter(Boolean)
}

// Local string→lines coercion (the docx module is otherwise self-contained;
// avoids importing the studio planShape helper into the exporter).
function toLinesLocal(value) {
  if (Array.isArray(value)) return value.map((x) => String(x == null ? '' : x).trim()).filter(Boolean)
  return String(value == null ? '' : value).split(/\n|;\s*/).map((s) => s.trim()).filter(Boolean)
}

/** True when a stage is the homework row (which §2.4 lets a teacher drop). */
function isHomeworkStage(stage) {
  return /HOMEWORK/i.test(String(stage?.name || ''))
}

/**
 * The one progression table, shared by both curricula. Column widths come from
 * §4.1 (18 / 34 / 26 / 22) resolved against the real content width, so they
 * hold whatever margins the teacher chose.
 */
function progressionTable(plan, opts, fmt, { headings, fourth }) {
  const stages = (plan.stages || []).filter((s) => fmt.sections.homework || !isHomeworkStage(s))
  const widths = columnWidths(fmt, [18, 34, 26, 22])

  const headerRow = new TableRow({
    tableHeader: true,     // §4.1 — repeats at the top of every continuation page
    cantSplit: true,
    children: headings.map((label, i) => progressionHeaderCell(label, widths[i])),
  })
  const stageRows = stages.map((s) => new TableRow({
    // §4.1 — a row MAY split. Forcing a long Development row to stay whole is
    // what pushed it onto a fresh page and left the previous one half blank.
    cantSplit: false,
    children: [
      stageCell(s, widths[0]),
      progressionCell(cellChildren(s.teacherActivities ?? s.teacher, opts), widths[1]),
      progressionCell(cellChildren(s.learnerActivities ?? s.pupils, opts), widths[2]),
      progressionCell(cellChildren(fourth(s), opts), widths[3]),
    ],
  }))

  return new Table({
    width: { size: contentWidthTwips(fmt), type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...stageRows],
  })
}

/** The CBC body. */
function buildV3CbcBody(plan, opts, fmt) {
  const h = plan.header || {}
  const children = []

  children.push(...mastheadParagraphs(h, fmt))
  children.push(metaTable(h, fmt))
  children.push(new Paragraph({ children: [], spacing: { after: ptToTwips(FMT.sectionGapPt) } }))

  // §4.4 — Competences, References and Materials print as ONE line each.
  children.push(fieldLine('GENERAL COMPETENCES', (plan.generalCompetences || []).join(', ')))
  children.push(fieldLine('SPECIFIC COMPETENCE', plan.specificCompetence))
  children.push(fieldLine('LESSON GOAL', plan.lessonGoal))
  if (fmt.sections.rationale) children.push(fieldLine('RATIONALE', plan.rationale))
  if (fmt.sections.priorKnowledge) children.push(fieldLine('PRIOR KNOWLEDGE', plan.priorKnowledge))
  if (fmt.sections.references) children.push(fieldLine('REFERENCES', (plan.references || []).join('; ')))

  // §2.3 — one line, only for the categories the teacher selected, and never
  // the words "Not applicable".
  for (const line of resolveEnvironmentLines({
    environment: plan.learningEnvironment,
    selected: opts.learningEnvironments,
    display: fmt.environmentDisplay,
    place: fmt.environmentPlace,
  })) {
    children.push(fieldLine(line.label.toUpperCase(), line.value))
  }

  children.push(fieldLine('MATERIALS', (plan.materials || []).join(', ')))
  if (fmt.sections.expectedStandard) children.push(fieldLine('EXPECTED STANDARD', plan.expectedStandard))

  children.push(...lessonIllustrationParagraphs(plan, opts))

  children.push(labelLine('LESSON PROGRESSION', {
    alignment: AlignmentType.CENTER,
    spacing: { before: ptToTwips(FMT.sectionGapPt), after: ptToTwips(2) },
  }))
  children.push(progressionTable(plan, opts, fmt, {
    headings: ['STAGES', "TEACHER'S ACTIVITIES", "LEARNERS' ACTIVITIES", 'ASSESSMENT'],
    fourth: (s) => (s.assessmentCriteria ?? s.assessment ?? ''),
  }))

  if (fmt.sections.remedialWork) children.push(fieldLine('REMEDIAL WORK', plan.remedialWork))
  if (fmt.sections.extensionActivity) children.push(fieldLine('EXTENSION ACTIVITY', plan.extensionActivity))
  if (fmt.sections.lessonEvaluation) {
    children.push(labelLine('LESSON EVALUATION', {
      spacing: { before: ptToTwips(FMT.sectionGapPt), after: ptToTwips(2) },
    }))
    children.push(ruledFields(fmt, ['Successes', 'Challenges', 'Way forward']))
  }
  return children.filter(Boolean)
}

function buildV3Body(plan, opts = {}, mode = 'cbc') {
  const fmt = exportFormat(opts)
  setTypography(fmt)
  return mode === 'previous'
    ? buildV3PreviousBody(plan, opts, fmt)
    : buildV3CbcBody(plan, opts, fmt)
}

/** Page geometry for a resolved format — A4 at the teacher's chosen margins. */
function pageProperties(fmt) {
  const m = mmToTwips(fmt.marginMm)
  return {
    page: {
      size: { width: A4_WIDTH_TWIPS, height: A4_HEIGHT_TWIPS },
      margin: { top: m, right: m, bottom: m, left: m },
    },
  }
}

/**
 * Build a docx Document from a lesson plan JSON object.
 * Detects schema version by field presence so older saved plans still export.
 */
export function buildLessonPlanDocument(plan, opts = {}) {
  const isV3 = Array.isArray(plan.stages) || plan.schemaVersion === '3.0'
  if (isV3) {
    const mode = opts.curriculumMode === 'previous' ? 'previous' : 'cbc'
    const fmt = exportFormat(opts)
    // The masthead (Ministry line, school, LESSON PLAN) is part of the body now
    // — §4.3 gave it a header style, and the two rules that used to bracket it
    // are gone, so there is nothing left for a separate head block to do.
    return new Document({
      creator: 'zedexams.com',
      title: sanitizeXmlText(`Lesson Plan — ${plan.header?.subject || ''} — ${plan.header?.topic || ''}`),
      description: 'Generated by ZedExams Teacher Tools',
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: ptToHalfPt(fmt.typography.bodyPt) } },
        },
      },
      sections: [{
        ...attributionSection(opts),
        // Margins are the teacher's Paper Fit choice, not a constant — the
        // preview draws the same sheet, so the two agree on where the text
        // starts. Narrower margins alone recover ~8-10% of every page.
        properties: pageProperties(fmt),
        children: buildV3Body(plan, opts, mode),
      }],
    })
  }
  const isV2 = !!plan.lessonProgression || !!plan.lessonCompetencies || plan.schemaVersion === '2.0'

  const children = []
  children.push(h1('LESSON PLAN'))

  const bodyChildren = isV2 ? buildV2Body(plan, opts) : buildV1Body(plan, opts)
  children.push(...bodyChildren)

  children.push(h2('Assessment'))
  children.push(para(text('Formative:', { bold: true, size: 20 })))
  children.push(...bulletList(plan.assessment?.formative))
  if (plan.assessment?.summative?.description) {
    children.push(para(text('Summative:', { bold: true, size: 20 })))
    children.push(para(text(plan.assessment.summative.description, { size: 20 })))
    if (plan.assessment.summative.successCriteria) {
      children.push(para([
        text('Success criteria: ', { bold: true, size: 20 }),
        text(plan.assessment.summative.successCriteria, { size: 20 }),
      ]))
    }
  }

  children.push(h2('Differentiation'))
  children.push(para(text('For struggling pupils:', { bold: true, size: 20 })))
  children.push(...bulletList(plan.differentiation?.forStruggling))
  children.push(para(text('For advanced pupils:', { bold: true, size: 20 })))
  children.push(...bulletList(plan.differentiation?.forAdvanced))

  if (plan.homework?.description) {
    children.push(h2('Homework'))
    children.push(para(text(plan.homework.description, { size: 20 })))
    if (plan.homework.estimatedMinutes > 0) {
      children.push(para(text(
        `Estimated time: ${plan.homework.estimatedMinutes} minutes`,
        { size: 18, italics: true, color: '6b7280' },
      )))
    }
  }

  // v2-only: Competence Continuity (Section 3 of CBC template)
  if (isV2) {
    const cc = plan.competenceContinuity || {}
    const hasCC = (cc.longTermProjects?.length || 0) + (cc.homeworkExtensions?.length || 0)
      + (cc.upcomingConnections?.length || 0) + (cc.teacherActions?.length || 0) > 0
    if (hasCC) {
      children.push(h2('Competence Continuity and Strategy'))
      if (cc.longTermProjects?.length) {
        children.push(para(text('Long-term projects:', { bold: true, size: 20 })))
        children.push(...bulletList(cc.longTermProjects))
      }
      if (cc.homeworkExtensions?.length) {
        children.push(para(text('Homework extensions:', { bold: true, size: 20 })))
        children.push(...bulletList(cc.homeworkExtensions))
      }
      if (cc.upcomingConnections?.length) {
        children.push(para(text('Upcoming connections:', { bold: true, size: 20 })))
        children.push(...bulletList(cc.upcomingConnections))
      }
      if (cc.teacherActions?.length) {
        children.push(para(text('Teacher actions:', { bold: true, size: 20 })))
        children.push(...bulletList(cc.teacherActions))
      }
    }
    // v2 places References near the bottom as a formal block
    if (plan.references?.length) {
      children.push(h2('References'))
      children.push(...referencesBlock(plan.references))
    }
  }

  children.push(h2("Teacher's Reflection"))
  children.push(para(text('What went well?', { bold: true, size: 20 })))
  children.push(para(text('__________________________________________________', { size: 20 })))
  children.push(para(text('What to improve next time?', { bold: true, size: 20 })))
  children.push(para(text('__________________________________________________', { size: 20 })))
  children.push(para(text('Pupils who need follow-up:', { bold: true, size: 20 })))
  children.push(para(text('__________________________________________________', { size: 20 })))

  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(`Lesson Plan — ${plan.header?.subject || ''} — ${plan.header?.topic || ''}`),
    description: 'Generated by ZedExams Teacher Tools',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20 } },
      },
    },
    sections: [{ ...attributionSection(opts), children }],
  })
}

/**
 * Trigger a browser download of the .docx.
 */
export async function downloadLessonPlanDocx(plan, filename = 'lesson-plan.docx', opts = {}) {
  // Pre-fetch the lesson illustration bytes (async) so the synchronous,
  // unit-tested document builder can embed them. Both the studio and the
  // Library download flow through here, so both get the drawing.
  let buildOpts = opts
  if (plan?.lessonDiagram?.url) {
    buildOpts = { ...opts, diagramImage: await fetchLessonDiagramImage(plan.lessonDiagram) }
  }
  // §4.7 — the matching-block line art is SVG markup; Word needs bytes. This is
  // the same async pre-pass shape as the illustration above, and it fails soft:
  // an empty map means the block prints with the object words in their boxes.
  const objectNames = objectNamesInPlan(plan)
  if (objectNames.length) {
    buildOpts = { ...buildOpts, objectArt: await rasterizeObjectArt(objectNames) }
  }
  const doc = buildLessonPlanDocument(plan, buildOpts)
  const blob = await Packer.toBlob(doc)

  // Try file-saver first (nicer cross-browser UX), fall back to anchor click.
  await saveBlob(blob, filename)
}
