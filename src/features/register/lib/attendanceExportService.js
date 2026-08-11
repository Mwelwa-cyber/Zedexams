/**
 * attendanceExportService — print + export for the Class Register Studio.
 *
 * One shared EXPORT MODEL (buildRegisterExportModel) feeds every output —
 * official A4-landscape register, term summary, individual learner report,
 * CSV, Excel and Word — and all totals in it come from attendanceCalculator,
 * so a printed percentage can never disagree with the screen.
 *
 * The on-screen PAPER PREVIEW (buildPaperPreview) is not a second renderer:
 * it emits the very same page markup and the same BASE_PRINT_CSS the printer
 * gets, on a sheet sized to A4 instead of a `@page` box. A preview and its
 * printout cannot drift because there is only one builder per document.
 *
 * The model + HTML builders are pure string/JSON functions (tested under
 * plain node by scripts/test-attendance-export.mjs); the download/print
 * helpers at the bottom are browser-only and lazy-load their heavy deps.
 */

import {
  computeLearnerTotals,
  computeClassSummary,
  formatPercent,
  isLearnerEligibleOn as isEligible,
  monthLabel,
} from '../../../utils/attendanceCalculator.js'
import {
  registerDays,
  groupDaysByMonth,
  groupDaysByWeek,
  formatDateLong,
} from '../../../utils/attendanceCalendarResolver.js'
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_ORDER } from '../../../utils/attendanceConstants.js'

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function symbolCell(record, eligible) {
  if (!eligible) return { text: '–', color: '#9ca3af' }
  const cfg = record?.status ? ATTENDANCE_STATUSES[record.status] : null
  if (!cfg) return { text: '', color: '#111827' }
  return { text: cfg.symbol, color: cfg.printColor }
}

/**
 * The shared export model. `range` ({ from, to } ISO dates, both optional)
 * narrows to a month or custom window; future dates never export.
 */
export function buildRegisterExportModel({
  register,
  school,
  teacherName,
  termInfo,
  daysWithRecords,
  roster,
  policy,
  range,
  printedOn,
}) {
  const termWindow = { startDate: termInfo?.startDate, endDate: termInfo?.endDate }
  let days = registerDays(daysWithRecords || []).filter((d) => !d.isFuture)
  if (range?.from) days = days.filter((d) => d.date >= range.from)
  if (range?.to) days = days.filter((d) => d.date <= range.to)

  const learners = [...(roster || [])]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((learner, i) => ({
      learner,
      position: i + 1,
      totals: computeLearnerTotals({ learner, days, term: termWindow, policy }),
    }))

  const summary = computeClassSummary({
    learners: roster || [],
    days,
    term: termWindow,
    policy,
    todayIso: printedOn || null,
  })

  const months = groupDaysByMonth(days).map((month) => ({
    ...month,
    weeks: groupDaysByWeek(month.days, termInfo?.startDate),
  }))

  return {
    school: {
      name: school?.schoolName || register?.school || 'School',
      address: school?.address || '',
      logoUrl: school?.schoolLogoUrl || '',
      motto: school?.motto || '',
    },
    className: register?.className || '',
    grade: register?.grade || '',
    teacherName: teacherName || '',
    academicYear: termInfo?.year ?? register?.year ?? '',
    termLabel: termInfo?.termLabel || register?.term || '',
    termWindow,
    printedOn: printedOn || '',
    days,
    months,
    learners,
    summary,
  }
}

const BASE_PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
  .page { page-break-after: always; padding: 24px 28px; position: relative; min-height: 96vh; }
  .page:last-child { page-break-after: auto; }
  header.reg { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 10px; }
  header.reg img { height: 52px; width: 52px; object-fit: contain; }
  header.reg h1 { font-size: 16px; letter-spacing: 0.5px; }
  header.reg .sub { font-size: 11px; color: #374151; }
  .meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; margin-bottom: 8px; }
  .meta b { font-weight: 700; }
  table.reg { border-collapse: collapse; width: 100%; }
  table.reg th, table.reg td { border: 1px solid #6b7280; font-size: 9px; padding: 2px 3px; text-align: center; }
  table.reg th { background: #f3f4f6; font-weight: 700; }
  table.reg td.name, table.reg th.name { text-align: left; white-space: nowrap; max-width: 150px; overflow: hidden; }
  .legend { font-size: 10px; margin-top: 8px; }
  .legend span { margin-right: 12px; }
  .signatures { display: flex; gap: 40px; margin-top: 26px; font-size: 11px; }
  .signatures .line { border-top: 1px solid #111827; padding-top: 3px; min-width: 200px; }
  .pagefoot { position: absolute; bottom: 10px; left: 28px; right: 28px; display: flex; justify-content: space-between; font-size: 9px; color: #6b7280; }
`

function headerHtml(model, title) {
  return `<header class="reg">
    ${model.school.logoUrl ? `<img src="${esc(model.school.logoUrl)}" alt="" />` : ''}
    <div>
      <h1>${esc(model.school.name).toUpperCase()}</h1>
      <div class="sub">${esc(model.school.address)}</div>
      <div class="sub"><b>${esc(title)}</b></div>
    </div>
  </header>
  <div class="meta">
    <span><b>Academic year:</b> ${esc(model.academicYear)}</span>
    <span><b>Term:</b> ${esc(model.termLabel)}</span>
    <span><b>Class:</b> ${esc(model.className)}</span>
    <span><b>Class teacher:</b> ${esc(model.teacherName)}</span>
  </div>`
}

function legendHtml() {
  return `<p class="legend">${ATTENDANCE_STATUS_ORDER.map((s) => {
    const cfg = ATTENDANCE_STATUSES[s]
    return `<span><b style="color:${cfg.printColor}">${cfg.symbol}</b> = ${cfg.label}</span>`
  }).join('')}</p>`
}

function signaturesHtml(model) {
  return `<div class="signatures">
    <div class="line">Class teacher signature</div>
    <div class="line">Headteacher signature</div>
    <div class="line">Date printed: ${esc(model.printedOn ? formatDateLong(model.printedOn) : '')}</div>
  </div>`
}

function pageFootHtml(model, page, pages) {
  return `<div class="pagefoot"><span>${esc(model.school.name)} — ${esc(model.className)} class register</span><span>Page ${page} of ${pages}</span></div>`
}

const TOTAL_HEADERS = ['P', 'A', 'S', 'L', 'E', 'Elig', '%']

function totalsCells(totals) {
  return `<td>${totals.presentDays}</td><td>${totals.absentDays}</td><td>${totals.sickDays}</td>
    <td>${totals.lateDays}</td><td>${totals.excusedDays}</td><td>${totals.eligibleDays}</td>
    <td>${formatPercent(totals.attendancePercentage)}</td>`
}

const EMPTY_MONTH = { key: null, label: 'No register days', weeks: [], days: [] }

/** Wraps page sections in a document. `pageCss` sets the sheet geometry. */
function documentHtml({ title, pageCss, extraCss = '', body }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${esc(title)}</title>
    <style>${pageCss} ${BASE_PRINT_CSS}${extraCss}</style></head><body>${body}</body></html>`
}

/**
 * ONE month page of the official register — the single source of that page's
 * markup, used by both the printed document and the on-screen preview.
 */
function registerMonthPageHtml(model, month, { page, pages, signatures }) {
  const monthDays = month.weeks.flatMap((w) => w.days)
  const weekHead = month.weeks.map((w) =>
    `<th colspan="${w.days.length}">Week ${w.weekNumber}</th>`).join('')
  const dayHead = monthDays.map((d) =>
    `<th title="${esc(d.holidayName || '')}">${Number(d.date.slice(8, 10))}</th>`).join('')
  const rows = model.learners.map(({ learner, position, totals }) => {
    const cells = monthDays.map((day) => {
      const eligible = isEligible(learner, day.date, model.termWindow)
      const { text, color } = symbolCell(day.records?.[learner.id], eligible)
      return `<td style="color:${color}">${text}</td>`
    }).join('')
    return `<tr>
          <td>${position}</td>
          <td>${esc(learner.learnerNumber)}</td>
          <td class="name">${esc(learner.fullName)}</td>
          ${cells}
          ${totalsCells(totals)}
        </tr>`
  }).join('')
  const classTotals = monthDays.map((day) => {
    let attended = 0
    for (const { learner } of model.learners) {
      const s = day.records?.[learner.id]?.status
      if (s === 'present' || s === 'late') attended += 1
    }
    return `<td><b>${attended}</b></td>`
  }).join('')
  return `<section class="page">
        ${headerHtml(model, `CLASS REGISTER — ${month.label}`)}
        <table class="reg">
          <thead>
            <tr><th rowspan="2">No.</th><th rowspan="2">Adm No.</th><th rowspan="2" class="name">Learner name</th>${weekHead}<th colspan="7">Term totals</th></tr>
            <tr>${dayHead}${TOTAL_HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows}
            <tr><td colspan="3" class="name"><b>Present + late per day</b></td>${classTotals}<td colspan="7"></td></tr>
          </tbody>
        </table>
        ${legendHtml()}
        ${signatures ? signaturesHtml(model) : ''}
        ${pageFootHtml(model, page, pages)}
      </section>`
}

/** The single page of the term attendance summary. */
function termSummaryPageHtml(model) {
  const rows = model.learners.map(({ learner, position, totals }) => `<tr>
    <td>${position}</td>
    <td>${esc(learner.learnerNumber)}</td>
    <td class="name">${esc(learner.fullName)}</td>
    <td>${esc(learner.gender || '')}</td>
    <td>${totals.eligibleDays}</td>
    <td>${totals.presentDays}</td>
    <td>${totals.absentDays}</td>
    <td>${totals.sickDays}</td>
    <td>${totals.lateDays}</td>
    <td>${totals.excusedDays}</td>
    <td>${totals.unmarkedDays}</td>
    <td><b>${formatPercent(totals.attendancePercentage)}</b></td>
  </tr>`).join('')
  const s = model.summary
  return `<section class="page">
    ${headerHtml(model, 'TERM ATTENDANCE SUMMARY')}
    <table class="reg">
      <thead><tr>
        <th>No.</th><th>Adm No.</th><th class="name">Learner name</th><th>Gender</th>
        <th>Eligible days</th><th>Present</th><th>Absent</th><th>Sick</th><th>Late</th><th>Excused</th><th>Unmarked</th><th>Attendance %</th>
      </tr></thead>
      <tbody>${rows}
        <tr><td colspan="4" class="name"><b>CLASS TOTALS</b></td>
          <td><b>${s.possibleAttendance}</b></td>
          <td colspan="6" class="name">Actual attendance: <b>${s.actualAttendance}</b> · Absences: <b>${s.totalAbsences}</b> · Sick days: <b>${s.totalSickDays}</b></td>
          <td><b>${formatPercent(s.averageAttendancePercentage)}</b></td></tr>
      </tbody>
    </table>
    ${legendHtml()}
    ${signaturesHtml(model)}
    ${pageFootHtml(model, 1, 1)}
  </section>`
}

const SUMMARY_CSS = `
      table.reg th, table.reg td { font-size: 11px; padding: 3px 6px; }
    `

/**
 * Official class register — A4 landscape, ONE PAGE PER MONTH so a long term
 * stays readable; learner-identification columns and date headers repeat on
 * every page. Month pages show the month's marks + whole-term totals.
 */
export function buildOfficialRegisterHtml(model) {
  const months = model.months.length ? model.months : [EMPTY_MONTH]
  const body = months
    .map((month, mi) => registerMonthPageHtml(model, month, {
      page: mi + 1,
      pages: months.length,
      signatures: mi === months.length - 1,
    }))
    .join('')
  return documentHtml({
    title: `Class register — ${model.className}`,
    pageCss: '@page { size: A4 landscape; margin: 8mm; }',
    body,
  })
}

/** Term attendance summary — A4 landscape, one learner per row, all totals. */
export function buildTermSummaryHtml(model) {
  return documentHtml({
    title: `Term attendance summary — ${model.className}`,
    pageCss: '@page { size: A4 landscape; margin: 10mm; }',
    extraCss: SUMMARY_CSS,
    body: termSummaryPageHtml(model),
  })
}

// ── on-screen paper preview ─────────────────────────────────────

const MM_TO_PX = 96 / 25.4
const A4_LONG_MM = 297
const A4_SHORT_MM = 210

/** A4 sheet dimensions in mm and CSS px (96dpi) for a given orientation. */
export function paperGeometry(orientation = 'landscape') {
  const widthMm = orientation === 'portrait' ? A4_SHORT_MM : A4_LONG_MM
  const heightMm = orientation === 'portrait' ? A4_LONG_MM : A4_SHORT_MM
  return {
    orientation,
    widthMm,
    heightMm,
    widthPx: Math.round(widthMm * MM_TO_PX),
    heightPx: Math.round(heightMm * MM_TO_PX),
  }
}

/**
 * Sheet CSS for the preview. A `@page` box means nothing on screen, so its
 * margin is folded into the sheet padding (and the footer offsets) to
 * reproduce the printed content box exactly. The sheet keeps its A4 width and
 * grows downwards; a guide line is drawn every sheet-height so a class that
 * spills onto a second physical page shows where the break falls instead of
 * silently hiding the learners past the fold.
 */
function previewSheetCss(geo, marginMm) {
  return `
  html { background: transparent; }
  body { width: ${geo.widthMm}mm; }
  .page {
    width: ${geo.widthMm}mm;
    min-height: ${geo.heightMm}mm;
    padding: calc(${marginMm}mm + 24px) calc(${marginMm}mm + 28px);
    background-color: #fff;
    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(${geo.heightMm}mm - 2px), #94a3b8 calc(${geo.heightMm}mm - 2px), #94a3b8 ${geo.heightMm}mm);
    page-break-after: auto;
  }
  .pagefoot { bottom: calc(${marginMm}mm + 10px); left: calc(${marginMm}mm + 28px); right: calc(${marginMm}mm + 28px); }
`
}

export const PREVIEW_DOCUMENTS = [
  { key: 'register', label: 'Class register' },
  { key: 'summary', label: 'Term attendance summary' },
]

/**
 * One sheet of a register document, laid out for the screen.
 *
 * `doc` picks the document ('register' | 'summary'); for the register,
 * `monthKey` picks which month's page to show (defaults to the first).
 * Returns the page's own geometry and its position in the full document so
 * the caller can scale the sheet and say "Page 2 of 3" without re-deriving
 * anything the builder already knows.
 */
export function buildPaperPreview(model, { doc = 'register', monthKey = null } = {}) {
  const geo = paperGeometry('landscape')
  if (doc === 'summary') {
    return {
      doc,
      html: documentHtml({
        title: `Term attendance summary — ${model.className}`,
        pageCss: previewSheetCss(geo, 10),
        extraCss: SUMMARY_CSS,
        body: termSummaryPageHtml(model),
      }),
      geometry: geo,
      page: 1,
      pages: 1,
      monthKey: null,
      label: 'Term attendance summary',
    }
  }
  const months = model.months.length ? model.months : [EMPTY_MONTH]
  const index = Math.max(0, months.findIndex((m) => m.key === monthKey))
  const month = months[index]
  return {
    doc: 'register',
    html: documentHtml({
      title: `Class register — ${model.className}`,
      pageCss: previewSheetCss(geo, 8),
      body: registerMonthPageHtml(model, month, {
        page: index + 1,
        pages: months.length,
        signatures: index === months.length - 1,
      }),
    }),
    geometry: geo,
    page: index + 1,
    pages: months.length,
    monthKey: month.key,
    label: month.label,
  }
}

/** Individual learner report — A4 portrait: info, monthly breakdown, trend, comment. */
export function buildLearnerReportHtml(model, learnerId, { comment = '' } = {}) {
  const row = model.learners.find((l) => l.learner.id === learnerId)
  if (!row) return null
  const { learner, totals } = row
  const monthly = model.months.map((month) => {
    const monthTotals = computeLearnerTotals({
      learner,
      days: month.days,
      term: model.termWindow,
      policy: undefined,
    })
    return { key: month.key, label: month.label, totals: monthTotals }
  })
  const monthRows = monthly.map((m) => `<tr>
    <td class="name">${esc(m.label)}</td>
    <td>${m.totals.eligibleDays}</td><td>${m.totals.presentDays}</td><td>${m.totals.absentDays}</td>
    <td>${m.totals.sickDays}</td><td>${m.totals.lateDays}</td><td>${m.totals.excusedDays}</td>
    <td>${formatPercent(m.totals.attendancePercentage)}</td>
  </tr>`).join('')
  const trend = monthly.map((m) => {
    const pct = m.totals.attendancePercentage
    return `<div style="display:inline-block;width:52px;text-align:center;margin-right:8px;">
      <div style="font-size:9px;">${pct == null ? '—' : formatPercent(pct)}</div>
      <div style="height:${Math.max(3, (pct || 0) * 0.6)}px;background:#2563eb;border-radius:2px 2px 0 0;"></div>
      <div style="font-size:9px;border-top:1px solid #111827;">${esc(monthLabel(m.key))}</div>
    </div>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Attendance report — ${esc(learner.fullName)}</title>
    <style>@page { size: A4 portrait; margin: 14mm; } ${BASE_PRINT_CSS}
      table.reg th, table.reg td { font-size: 11px; padding: 3px 6px; }
      .block { margin-bottom: 14px; }
    </style></head><body><section class="page">
    ${headerHtml(model, 'LEARNER ATTENDANCE REPORT')}
    <div class="block meta">
      <span><b>Learner:</b> ${esc(learner.fullName)}</span>
      <span><b>Admission no.:</b> ${esc(learner.learnerNumber || '—')}</span>
      <span><b>Gender:</b> ${esc(learner.gender || '—')}</span>
    </div>
    <div class="block">
      <table class="reg">
        <thead><tr><th class="name">Month</th><th>Eligible</th><th>Present</th><th>Absent</th><th>Sick</th><th>Late</th><th>Excused</th><th>%</th></tr></thead>
        <tbody>${monthRows}
          <tr><td class="name"><b>Term total</b></td>
            <td><b>${totals.eligibleDays}</b></td><td><b>${totals.presentDays}</b></td><td><b>${totals.absentDays}</b></td>
            <td><b>${totals.sickDays}</b></td><td><b>${totals.lateDays}</b></td><td><b>${totals.excusedDays}</b></td>
            <td><b>${formatPercent(totals.attendancePercentage)}</b></td></tr>
        </tbody>
      </table>
    </div>
    <div class="block"><b style="font-size:11px;">Attendance trend</b><div style="margin-top:6px;">${trend}</div></div>
    <div class="block" style="font-size:11px;"><b>Teacher comment</b><div style="border:1px solid #6b7280;min-height:60px;padding:6px;margin-top:4px;">${esc(comment)}</div></div>
    ${signaturesHtml(model)}
    ${pageFootHtml(model, 1, 1)}
  </section></body></html>`
}

// ── tabular exports (CSV / Excel share these rows) ───────────────

/** Register matrix: one row per learner, one column per date + totals. */
export function registerMatrixRows(model) {
  return model.learners.map(({ learner, position, totals }) => {
    const row = {
      'No.': position,
      'Admission No.': learner.learnerNumber || '',
      'Learner Name': learner.fullName,
      Gender: learner.gender || '',
    }
    for (const day of model.days) {
      const eligible = isEligible(learner, day.date, model.termWindow)
      row[day.date] = eligible ? (day.records?.[learner.id]?.status
        ? ATTENDANCE_STATUSES[day.records[learner.id].status].symbol
        : '') : '–'
    }
    row.Present = totals.presentDays
    row.Absent = totals.absentDays
    row.Sick = totals.sickDays
    row.Late = totals.lateDays
    row.Excused = totals.excusedDays
    row['Eligible Days'] = totals.eligibleDays
    row['Attendance %'] = totals.attendancePercentage == null
      ? '' : (Math.round(totals.attendancePercentage * 10) / 10)
    return row
  })
}

/** One row per learner, totals only (the term summary sheet). */
export function termSummaryRows(model) {
  return model.learners.map(({ learner, position, totals }) => ({
    'No.': position,
    'Admission No.': learner.learnerNumber || '',
    'Learner Name': learner.fullName,
    Gender: learner.gender || '',
    'Eligible Days': totals.eligibleDays,
    Present: totals.presentDays,
    Absent: totals.absentDays,
    Sick: totals.sickDays,
    Late: totals.lateDays,
    Excused: totals.excusedDays,
    Unmarked: totals.unmarkedDays,
    'Attendance %': totals.attendancePercentage == null
      ? '' : (Math.round(totals.attendancePercentage * 10) / 10),
  }))
}

// ── browser-only download/print helpers ─────────────────────────

/**
 * Print via a dedicated window (never the app screen).
 *
 * NOTE: must NOT pass `noopener`/`noreferrer` in the features string — either
 * one makes `window.open` open the window but return `null`, severing the
 * handle the register is written into, so the teacher gets a blank tab and a
 * "pop-ups blocked" error they cannot fix by allowing pop-ups. Enforced by
 * scripts/test-pdf-export-window.test.js.
 */
export function printAttendanceHtml(html) {
  const win = window.open('', '_blank', 'width=1100,height=800')
  if (!win) throw new Error('The print window was blocked. Allow pop-ups and try again.')
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  // Give the window a beat to lay out before the dialog opens.
  setTimeout(() => { try { win.print() } catch { /* window closed */ } }, 400)
}

export async function downloadAttendancePdf(html, filename, { orientation = 'landscape' } = {}) {
  const { downloadHtmlAsPdf } = await import('../../../utils/htmlToPdf.js')
  return downloadHtmlAsPdf(html, filename, {
    orientation,
    onFallback: () => printAttendanceHtml(html),
  })
}

export async function downloadAttendanceCsv(rows, filename) {
  const { downloadCSV } = await import('../../../utils/csvExport.js')
  return downloadCSV(filename, rows)
}

/**
 * Minimal .xlsx: one worksheet built as OOXML and zipped with jszip (already
 * in the tree via the roster importer) — same approach as classTimetableToXlsx.
 */
export async function downloadAttendanceXlsx(rows, filename, sheetName = 'Attendance') {
  if (!rows.length) throw new Error('Nothing to export.')
  const { default: JSZip } = await import('jszip')
  const headers = Object.keys(rows[0])
  const escXml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const cellXml = (value, ref) => {
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`
  }
  const colLetter = (i) => {
    let n = i + 1
    let s = ''
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
    return s
  }
  const rowXml = (values, rowIndex) =>
    `<row r="${rowIndex}">${values.map((v, c) => cellXml(v, `${colLetter(c)}${rowIndex}`)).join('')}</row>`
  const sheetRows = [rowXml(headers, 1), ...rows.map((r, i) => rowXml(headers.map((h) => r[h]), i + 2))].join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', sheet)
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const { saveBlob } = await import('../../../utils/saveBlob.js')
  return saveBlob(blob, filename)
}
