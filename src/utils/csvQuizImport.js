/**
 * src/utils/csvQuizImport.js
 *
 * CSV → question bulk-import primitives. Pure module — no React, no
 * Firebase. Two responsibilities:
 *
 *   1. Define the canonical CSV format teachers download as a template.
 *   2. Parse + validate uploaded CSV text into shape-checked question
 *      objects that the existing normalizeQuestionPayload can persist.
 *
 * Design rationale
 * ----------------
 * The audit identified the import flow as a top sellability blocker:
 * teachers can't onboard 50 questions at once, and the current DOCX/PDF
 * importer writes optimistically to Firestore without a human-verify
 * step. This module is the first half of the fix — a canonical CSV
 * format with a strict per-row validator. The UI (AdminCsvImport.jsx)
 * is the second half — preview, edit, publish.
 *
 * Question types covered in the MVP
 * ---------------------------------
 *   - mcq          (4 options, correctAnswer = index 1–4 OR letter A–D)
 *   - tf           (correctAnswer = "True" or "False")
 *   - short_answer (correctAnswer = expected text)
 *   - numeric      (correctAnswer = number, optional tolerance)
 *
 * Hotspot is intentionally NOT in the CSV — it needs an image picker
 * that doesn't translate to a spreadsheet column. Diagram + fill stay
 * with the existing editor surfaces.
 *
 * Lives in its own pure module so the unit tests in scripts/ can import
 * it without dragging in Firebase or React.
 */

// ── Canonical CSV schema ─────────────────────────────────────────

export const CSV_HEADERS = [
  'type',
  'text',
  'optionA', 'optionB', 'optionC', 'optionD',
  'correctAnswer',
  'tolerance',
  'topic',
  'marks',
  'difficulty',
  'explanation',
  'imageUrl',
]

const TEMPLATE_EXAMPLE_ROWS = [
  ['mcq',
    'Which planet is closest to the Sun?',
    'Mercury', 'Venus', 'Earth', 'Mars',
    'A',
    '',
    'Solar System',
    '1',
    'easy',
    'Mercury is the innermost planet.',
    ''],
  ['tf',
    'Water boils at 100 degrees Celsius at sea level.',
    '', '', '', '',
    'True',
    '',
    'States of matter',
    '1',
    'easy',
    'At standard atmospheric pressure, yes.',
    ''],
  ['numeric',
    'What is the value of pi rounded to 2 decimal places?',
    '', '', '', '',
    '3.14',
    '0.01',
    'Geometry',
    '2',
    'medium',
    'pi is approximately 3.14159...',
    ''],
  ['short_answer',
    'What is the capital city of Zambia?',
    '', '', '', '',
    'Lusaka',
    '',
    'Zambian Geography',
    '1',
    'easy',
    'Lusaka has been the capital since 1935.',
    ''],
]

/**
 * Returns a CSV string ready to be served as a download. Includes the
 * header row plus the example rows above so a teacher can see the
 * expected format for every supported question type.
 */
export function buildCsvTemplate() {
  const rows = [CSV_HEADERS, ...TEMPLATE_EXAMPLE_ROWS]
  return rows.map(encodeCsvRow).join('\n') + '\n'
}

// ── CSV parsing (no external dependency) ─────────────────────────

/**
 * Encode a single row of values as a CSV line. Fields containing commas,
 * quotes, or newlines are wrapped in double quotes; internal quotes are
 * doubled per RFC 4180.
 */
function encodeCsvRow(values) {
  return values.map(v => {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }).join(',')
}

/**
 * Parse a CSV string into an array of string arrays. RFC 4180 subset:
 *   - comma separator
 *   - optional double-quote wrap
 *   - "" escapes a literal " inside a quoted field
 *   - CRLF or LF line endings
 *
 * Returns `[ ['header1', 'header2', ...], ['row1col1', ...], ... ]`.
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let i = 0
  let inQuotes = false

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      // Filter out fully-empty rows (a trailing newline at the end of the
      // file produces one). A row that contains nothing but commas is
      // preserved because the teacher might have left a row blank
      // deliberately.
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      field = ''
      // Skip the second char of a CRLF pair.
      if (ch === '\r' && text[i + 1] === '\n') i += 2
      else i += 1
      continue
    }
    field += ch
    i += 1
  }

  // Final field on the last line (no trailing newline).
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }

  return rows
}

// ── Row → question conversion + validation ───────────────────────

const TYPE_ALIASES = {
  'mcq': 'mcq',
  'multiple-choice': 'mcq',
  'multiple choice': 'mcq',
  'tf': 'tf',
  'truefalse': 'tf',
  'true/false': 'tf',
  'true_false': 'tf',
  'short_answer': 'short_answer',
  'short-answer': 'short_answer',
  'short': 'short_answer',
  'numeric': 'numeric',
  'number': 'numeric',
}

function normaliseType(raw) {
  const key = String(raw ?? '').trim().toLowerCase()
  return TYPE_ALIASES[key] || null
}

const DIFFICULTY_ALIASES = {
  'easy': 'easy',
  'e': 'easy',
  'medium': 'medium',
  'm': 'medium',
  'hard': 'hard',
  'h': 'hard',
  '': null,
}

function normaliseDifficulty(raw) {
  const key = String(raw ?? '').trim().toLowerCase()
  if (key in DIFFICULTY_ALIASES) return DIFFICULTY_ALIASES[key]
  // Unknown value — leave it null so the row validator can warn.
  return null
}

/**
 * Translate the CSV's correctAnswer cell into the right shape for the
 * given question type. Returns { value, error } — error is a
 * user-facing string when the cell is unusable, null otherwise.
 */
function parseCorrectAnswer(type, raw, options) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return { value: null, error: 'correctAnswer is required' }

  if (type === 'mcq') {
    // Accept either an index (1–4) or a letter (A–D, case-insensitive).
    const asInt = Number(trimmed)
    if (Number.isInteger(asInt) && asInt >= 1 && asInt <= options.length) {
      return { value: asInt - 1, error: null }
    }
    const letterIndex = 'ABCD'.indexOf(trimmed.toUpperCase())
    if (letterIndex >= 0 && letterIndex < options.length) {
      return { value: letterIndex, error: null }
    }
    return { value: null, error: `correctAnswer must be 1–${options.length} or A–${'ABCD'[options.length - 1]}` }
  }

  if (type === 'tf') {
    const lc = trimmed.toLowerCase()
    if (lc === 'true' || lc === 't' || lc === '1') return { value: 0, error: null }
    if (lc === 'false' || lc === 'f' || lc === '0') return { value: 1, error: null }
    return { value: null, error: 'correctAnswer must be True or False' }
  }

  if (type === 'numeric') {
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return { value: null, error: 'correctAnswer must be a number for numeric questions' }
    return { value: n, error: null }
  }

  // short_answer — keep the text as-is.
  return { value: trimmed, error: null }
}

/**
 * Convert one parsed CSV row (string[] aligned with CSV_HEADERS) into a
 * preview entry. Never throws; collects per-cell errors and warnings so
 * the UI can surface them inline.
 *
 * Returns:
 *   {
 *     question: { type, text, options, correctAnswer, tolerance, topic,
 *                 marks, difficulty, explanation, imageUrl } | null,
 *     status: 'ok' | 'warning' | 'error',
 *     errors:   string[],
 *     warnings: string[],
 *   }
 */
export function rowToQuestion(cells) {
  const errors = []
  const warnings = []

  // Pad the row to header length so accessing a missing cell is `''`
  // rather than `undefined`.
  const padded = CSV_HEADERS.map((_, i) => cells[i] ?? '')
  const cellByHeader = Object.fromEntries(CSV_HEADERS.map((h, i) => [h, String(padded[i] ?? '').trim()]))

  const type = normaliseType(cellByHeader.type)
  if (!type) {
    errors.push(`Unknown question type "${cellByHeader.type}". Accepted: mcq, tf, short_answer, numeric.`)
    return { question: null, status: 'error', errors, warnings }
  }

  const text = cellByHeader.text
  if (!text) errors.push('text (the question itself) is required')

  let options = []
  if (type === 'mcq') {
    options = [cellByHeader.optionA, cellByHeader.optionB, cellByHeader.optionC, cellByHeader.optionD]
      .map(o => String(o ?? '').trim())
      .filter(Boolean)
    if (options.length < 2) errors.push('mcq needs at least 2 options (optionA + optionB)')
    if (options.length < 4) warnings.push(`mcq has only ${options.length} options; the editor expects 4`)
  } else if (type === 'tf') {
    options = ['True', 'False']
    // Ignore optionC/D for tf without warning — leaving them blank is normal.
  }

  const { value: correctAnswer, error: correctErr } = parseCorrectAnswer(type, cellByHeader.correctAnswer, options)
  if (correctErr) errors.push(correctErr)

  let tolerance = null
  if (type === 'numeric') {
    if (cellByHeader.tolerance) {
      const t = Number(cellByHeader.tolerance)
      if (!Number.isFinite(t) || t < 0) errors.push('tolerance must be a non-negative number')
      else tolerance = t
    } else {
      // No tolerance → exact match. Warn so the teacher knows.
      warnings.push('tolerance is blank — answer must match exactly')
      tolerance = 0
    }
  }

  const marksRaw = cellByHeader.marks
  let marks = 1
  if (marksRaw) {
    const m = Number(marksRaw)
    if (!Number.isInteger(m) || m < 1 || m > 10) errors.push('marks must be an integer 1–10')
    else marks = m
  }

  const difficulty = normaliseDifficulty(cellByHeader.difficulty)
  if (cellByHeader.difficulty && difficulty === null) {
    warnings.push(`unknown difficulty "${cellByHeader.difficulty}" — leaving blank`)
  }

  const question = {
    type,
    text,
    options,
    correctAnswer,
    tolerance,
    topic: cellByHeader.topic,
    marks,
    difficulty,
    explanation: cellByHeader.explanation,
    imageUrl: cellByHeader.imageUrl || null,
  }

  const status = errors.length ? 'error' : (warnings.length ? 'warning' : 'ok')
  return { question, status, errors, warnings }
}

/**
 * Parse an uploaded CSV text into a preview-ready array of rows. The
 * first row is treated as the header and verified against CSV_HEADERS;
 * a mismatch is reported as a single top-level error rather than per-row
 * errors so the UI can show one banner.
 *
 * Returns:
 *   {
 *     headerError: string | null,
 *     rows: Array<{ index, raw, ...rowToQuestion result }>,
 *     summary: { total, ok, warning, error },
 *   }
 */
export function parseCsvImport(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    return {
      headerError: rows.length === 0
        ? 'The CSV is empty.'
        : 'The CSV only has a header row — add at least one question.',
      rows: [],
      summary: { total: 0, ok: 0, warning: 0, error: 0 },
    }
  }

  const header = rows[0].map(s => String(s ?? '').trim().toLowerCase())
  const expected = CSV_HEADERS.map(s => s.toLowerCase())
  // Strict order match — the template ships with this order and teachers
  // shouldn't reorder columns. A reordered upload would silently misread
  // (e.g. options swapping into the correctAnswer column).
  const headerMismatch = header.length < expected.length
    || expected.some((h, i) => header[i] !== h)
  if (headerMismatch) {
    return {
      headerError: `Header row doesn't match the template. Expected: ${CSV_HEADERS.join(', ')}`,
      rows: [],
      summary: { total: 0, ok: 0, warning: 0, error: 0 },
    }
  }

  const dataRows = rows.slice(1)
  const out = dataRows.map((cells, idx) => ({
    index: idx + 2, // line number in the file (1-based + skip header)
    raw: cells,
    ...rowToQuestion(cells),
  }))

  const summary = { total: out.length, ok: 0, warning: 0, error: 0 }
  out.forEach(r => { summary[r.status] += 1 })

  return { headerError: null, rows: out, summary }
}

/**
 * Shape a row's `question` field for the existing
 * normalizeQuestionPayload helper in src/hooks/useFirestore.js. Returns
 * an object with the fields the editor's "create question manually" UI
 * would produce, so the persist path stays single-source.
 */
export function previewQuestionToEditorShape(q) {
  return {
    type: q.type,
    text: q.text,
    options: q.options,
    correctAnswer: q.correctAnswer,
    tolerance: q.tolerance,
    topic: q.topic,
    marks: q.marks,
    difficulty: q.difficulty,
    explanation: q.explanation,
    imageUrl: q.imageUrl,
    // Sensible defaults for fields the editor surfaces but a CSV row
    // wouldn't carry.
    sharedInstruction: '',
    passageId: null,
    requiresReview: false,
    reviewNotes: [],
    importWarnings: [],
    sourcePage: null,
  }
}
