/**
 * Upload an existing class timetable → editable digital grid.
 *
 * Teachers often already have a timetable on paper, in a Word/Excel document
 * or as a photo. This module reads one and turns it into the same artifact
 * shape the Class Timetable Studio edits, so the rest of the studio (the
 * editable grid, the curriculum validation, the exporters) takes over.
 *
 * Extraction routes by file type:
 *   - image / PDF  → sent to Gemini (Firebase AI Logic) as inline data; the
 *                    model reads the grid directly (handles photos + scans)
 *   - .docx / .xlsx → unzipped to text client-side, then sent to Gemini as
 *                    text (these binary formats aren't vision-readable)
 *
 * Gemini returns a normalised JSON description of the week; normalizeExtracted
 * maps it onto the studio's period grid and snaps the subject names to the
 * grade's curriculum subjects so the curriculum check is meaningful.
 *
 * The heavy/browser-only dependencies (Firebase AI Logic, JSZip) are imported
 * lazily inside the async functions, so the pure mapping helpers below stay
 * importable (and unit-testable) under plain `node`.
 */

import { DAYS_OF_WEEK, buildPeriods } from '../../../utils/classTimetable.js'
import { getFrameworkForGrade } from '../../../utils/curriculumFramework.js'

/** What the file picker accepts. Photos cover the "snap a paper timetable" path. */
export const UPLOAD_ACCEPT = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp,image/*'

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/** Classify an upload by extension. */
export function fileKind(file) {
  const name = String(file?.name || '').toLowerCase()
  const ext = name.slice(name.lastIndexOf('.') + 1)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx') return 'xlsx'
  if (IMAGE_MIME[ext]) return 'image'
  if (String(file?.type || '').startsWith('image/')) return 'image'
  return 'unknown'
}

/* ── Pure mapping helpers (node-testable) ─────────────────────── */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Common abbreviations teachers write on a paper timetable → canonical token.
// Safe aliases only — genuinely different subjects are never merged just
// because their names look similar.
const SUBJECT_ALIASES = [
  [/^maths?$/, 'mathematics'],
  [/^eng(lish)?$/, 'english language'],
  [/^sci$/, 'science'],
  [/^intsci(ence)?$/, 'science'],
  [/^integratedscience$/, 'science'],
  [/^ss$/, 'social studies'],
  [/^soc(ial)?$/, 'social studies'],
  [/^re$/, 'religious education'],
  [/^ict$/, 'technology studies'],
  [/^computers?$/, 'technology studies'],
  [/^tech(nology)?$/, 'technology studies'],
  [/^techstudies$/, 'technology studies'],
  [/^pe$/, 'expressive arts'],
  [/^art$/, 'expressive arts'],
  [/^music$/, 'expressive arts'],
  [/^ea$/, 'expressive arts'],
  [/^home?ec(on(omics)?)?$/, 'home economics'],
  [/^lit$/, 'literacy & language'],
  [/^zam(bian)?(lang(uage)?)?$/, 'zambian language'],
  [/^cts$/, 'creative and technology studies'],
  [/^adl$/, 'activities for daily living'],
]

function expandAlias(raw) {
  const n = norm(raw)
  for (const [re, full] of SUBJECT_ALIASES) {
    if (re.test(n)) return full
  }
  return String(raw || '').trim()
}

/**
 * Snap a free-text subject (often abbreviated) to the closest of the grade's
 * known subjects. Falls back to a tidied version of the raw label so an
 * unrecognised subject still shows in the grid (and gets flagged by the
 * curriculum check).
 */
export function snapSubjectLabel(raw, candidates = []) {
  const cleaned = expandAlias(raw)
  if (!cleaned) return ''
  const target = norm(cleaned)
  if (!candidates.length) return tidy(cleaned)

  // 1. Exact normalised match.
  for (const c of candidates) if (norm(c) === target) return c
  // 2. One contains the other (e.g. "english" ⊂ "english language").
  for (const c of candidates) {
    const nc = norm(c)
    if (nc && target && (nc.includes(target) || target.includes(nc))) return c
  }
  // 3. Best token overlap.
  const targetTokens = new Set(String(cleaned).toLowerCase().split(/\s+/).filter(Boolean))
  let best = null
  let bestScore = 0
  for (const c of candidates) {
    const tokens = String(c).toLowerCase().split(/\s+/).filter(Boolean)
    const score = tokens.reduce((n, t) => n + (targetTokens.has(t) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore > 0 ? best : tidy(cleaned)
}

function tidy(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Canonical day name from any casing/abbreviation, or null. */
function canonicalDay(raw) {
  const n = norm(raw)
  for (const d of DAYS_OF_WEEK) {
    const nd = norm(d)
    if (nd === n || nd.startsWith(n) || n.startsWith(nd.slice(0, 3))) return d
  }
  return null
}

const isHHMM = (s) => /^\d{1,2}:\d{2}$/.test(String(s || ''))
const clamp = (n, lo, hi, dflt) => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Map Gemini's raw extraction object onto the studio's grid model.
 *
 * @param {object} raw - { detectedGrade, days[], startTime, periodMinutes,
 *                         periodCount, lessons:[{day,period,subject}], notes }
 * @param {{candidates?:string[], daysFallback?:string[]}} opts
 * @returns {{days,timing,slots,detectedGrade,detectedSubjects,notes,lessonCount}}
 */
export function normalizeExtracted(raw = {}, opts = {}) {
  const candidates = Array.isArray(opts.candidates) ? opts.candidates : []
  const daysFallback = Array.isArray(opts.daysFallback) && opts.daysFallback.length
    ? opts.daysFallback : DAYS_OF_WEEK.slice(0, 5)

  // Days — canonicalise and keep week order; fall back when none parse.
  const seenDay = new Set()
  const days = []
  for (const d of Array.isArray(raw.days) ? raw.days : []) {
    const cd = canonicalDay(d)
    if (cd && !seenDay.has(cd)) { seenDay.add(cd); days.push(cd) }
  }
  const orderedDays = (days.length ? days : daysFallback)
    .slice().sort((a, b) => DAYS_OF_WEEK.indexOf(a) - DAYS_OF_WEEK.indexOf(b))

  const lessons = Array.isArray(raw.lessons) ? raw.lessons : []
  const maxPeriod = lessons.reduce((m, l) => Math.max(m, Math.round(Number(l?.period) || 0)), 0)
  const lessonPeriods = clamp(raw.periodCount || maxPeriod || 8, 1, 14, 8)

  const timing = {
    startTime: isHHMM(raw.startTime) ? raw.startTime : '07:30',
    periodMinutes: clamp(raw.periodMinutes, 5, 180, 40),
    lessonPeriods,
    // Breaks aren't reliably positioned in an uploaded grid — start with none
    // and let the teacher add assembly/break/lunch/closing as needed.
    breaks: [],
  }

  const periods = buildPeriods(timing)
  const validPids = new Set(periods.filter((p) => p.kind === 'lesson').map((p) => p.id))

  const slots = {}
  const detected = new Set()
  for (const l of lessons) {
    const day = canonicalDay(l?.day)
    const period = Math.round(Number(l?.period) || 0)
    const pid = `p${period}`
    if (!day || !orderedDays.includes(day) || !validPids.has(pid)) continue
    const subject = snapSubjectLabel(l?.subject, candidates)
    if (!subject) continue
    if (!slots[pid]) slots[pid] = {}
    slots[pid][day] = subject
    detected.add(subject)
  }

  // Consecutive repeats of the same subject are CANDIDATE double periods —
  // flagged for the teacher to confirm (never auto-merged). Separated
  // repeats are two singles and are never suggested as a double.
  const possibleDoubles = []
  for (const day of orderedDays) {
    for (let n = 1; n < lessonPeriods; n += 1) {
      const a = slots[`p${n}`]?.[day]
      const b = slots[`p${n + 1}`]?.[day]
      if (a && a === b) possibleDoubles.push({ day, period: n, subject: a })
    }
  }

  return {
    days: orderedDays,
    timing,
    slots,
    possibleDoubles,
    detectedGrade: raw.detectedGrade || null,
    detectedSubjects: [...detected],
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    lessonCount: Object.values(slots).reduce((n, row) => n + Object.keys(row).length, 0),
  }
}

/* ── File → model input (browser) ─────────────────────────────── */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function stripXml(xml) {
  return String(xml || '')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').trim()
}

async function docxToText(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  const doc = zip.file('word/document.xml')
  if (!doc) return ''
  return stripXml(await doc.async('string'))
}

async function xlsxToText(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  // Shared strings table (most cell text lives here).
  const shared = []
  const ssFile = zip.file('xl/sharedStrings.xml')
  if (ssFile) {
    const ss = await ssFile.async('string')
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) {
      const text = (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map((t) => stripXml(t)).join('')
      shared.push(text)
    }
  }
  // First worksheet, row by row.
  const sheetFile = zip.file('xl/worksheets/sheet1.xml')
  if (!sheetFile) return shared.join(' ')
  const sheet = await sheetFile.async('string')
  const lines = []
  for (const row of sheet.match(/<row[\s\S]*?<\/row>/g) || []) {
    const cells = []
    for (const c of row.match(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\/>/g) || []) {
      const isShared = /\bt="s"/.test(c)
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
      const inline = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1]
      let text = ''
      if (isShared && v != null) text = shared[Number(v)] || ''
      else if (inline != null) text = stripXml(inline)
      else if (v != null) text = stripXml(v)
      cells.push(text)
    }
    if (cells.some((x) => x)) lines.push(cells.join(' | '))
  }
  return lines.join('\n')
}

/* ── Prompt ───────────────────────────────────────────────────── */

function instruction(grade, candidates) {
  const subjectLine = candidates.length
    ? `The official subjects for this grade are: ${candidates.join(', ')}. Map abbreviations (e.g. "Maths" → "Mathematics", "SS" → "Social Studies") to these where possible; keep any subject you can't map verbatim.`
    : 'Use the subject names exactly as written.'
  return [
    'You are reading a Zambian primary school CLASS TIMETABLE and extracting it into structured data.',
    grade ? `It is for ${grade}.` : '',
    subjectLine,
    'Return ONLY JSON of this exact shape:',
    '{',
    '  "detectedGrade": string | null,',
    '  "days": string[],                 // teaching days, full names e.g. "Monday"',
    '  "startTime": "HH:MM" | null,      // when the first lesson starts',
    '  "periodMinutes": number | null,   // typical lesson length in minutes',
    '  "periodCount": number,            // number of lesson periods per day',
    '  "lessons": [ { "day": string, "period": number, "subject": string } ],',
    '  "notes": string                   // anything unclear or unreadable',
    '}',
    'Number periods from 1. Ignore break/assembly/lunch/closing rows — list only teaching lessons. Do not invent lessons for blank cells.',
  ].filter(Boolean).join('\n')
}

/* ── Public extractor (browser) ───────────────────────────────── */

const EXTRACT_TIMEOUT_MS = 60000

/**
 * Read an uploaded timetable file and return a normalised result the studio
 * can drop into its editing state. Throws a friendly Error on unsupported
 * files or extraction failure.
 *
 * @param {File} file
 * @param {{grade?:string, days?:string[]}} opts
 */
export async function extractTimetableFromFile(file, opts = {}) {
  if (!file) throw new Error('No file selected.')
  const kind = fileKind(file)
  if (kind === 'unknown') {
    throw new Error('Unsupported file. Upload a PDF, Word (.docx), Excel (.xlsx) or an image/photo.')
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('That file is over 15 MB. Try a smaller photo or a PDF.')
  }

  const framework = getFrameworkForGrade(opts.grade)
  const candidates = framework ? framework.subjects.map((s) => s.label) : []
  const text = instruction(opts.grade, candidates)

  let prompt
  if (kind === 'image' || kind === 'pdf') {
    const data = await fileToBase64(file)
    const mimeType = kind === 'pdf' ? 'application/pdf' : (file.type || 'image/jpeg')
    prompt = { role: 'user', parts: [{ text }, { inlineData: { mimeType, data } }] }
  } else {
    const docText = kind === 'docx' ? await docxToText(file) : await xlsxToText(file)
    if (!docText || docText.length < 20) {
      throw new Error('Could not read any text from that document. A photo or PDF of the timetable usually works better.')
    }
    prompt = `${text}\n\nTIMETABLE CONTENT:\n${docText.slice(0, 12000)}`
  }

  const { generateJSON } = await import('../../../utils/aiLogic.js')
  let raw
  try {
    raw = await generateJSON(prompt, { timeoutMs: EXTRACT_TIMEOUT_MS })
  } catch (err) {
    if (err?.code === 'timeout') throw new Error('Reading the timetable took too long. Try a clearer photo or a smaller file.')
    throw new Error('Could not read the timetable. Try a clearer photo, or upload a PDF / Excel version.')
  }

  const result = normalizeExtracted(raw, { candidates, daysFallback: opts.days })
  if (result.lessonCount === 0) {
    throw new Error('No lessons were found in that file. Make sure the whole timetable is visible and try again.')
  }
  return result
}
