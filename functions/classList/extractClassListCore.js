/**
 * extractClassListCore — the pure half of reading a photographed class list.
 *
 * No firebase-functions, no Anthropic client, no Firestore: prompt building
 * and response parsing only, so functions/classList/extractClassList.test.js
 * covers it under plain `node` (the *Core.js split used across this repo).
 *
 * WHAT THIS ASKS THE MODEL FOR, AND WHY IT IS NARROW
 *
 * A Zambian class register page is a ruled grid written by hand, often by
 * several people over a term, frequently with a column the school invented.
 * The model is asked for exactly the five fields the Class List stores and is
 * told, in as many words, to leave a field blank rather than produce a
 * plausible value for it. An invented admission number is worse than a missing
 * one: a missing one is a visible gap a teacher fills in, and an invented one
 * is a wrong identifier that will be printed on a register all year.
 *
 * It is also asked for a per-row confidence. That number NEVER decides
 * anything — importReviewCore treats it as a queue order and nothing more.
 */

const MAX_PAGES_PER_CALL = 6
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const SYSTEM_PROMPT = `You read photographs of school class lists and registers from Zambian schools and transcribe the learners on them.

The pages are usually hand-written in ruled columns. Common column headings include: No., S/N, Adm No., Admission Number, Name, Full Name, Pupil Name, Sex, Gender, M/F, Parent's Phone, Guardian Contact, Date of Admission.

Rules you must follow:

1. Transcribe ONLY what is written. Never invent, complete or correct a value. If a learner's admission number is not written on the page, leave it null — do not derive one from their position in the list.
2. Keep the learners in the order they appear down the page, top to bottom.
3. Copy names exactly as written, including the order the school wrote them in. Do not reorder given names and surnames, do not expand initials, do not fix spellings.
4. Zambian dates are written day-first. Return dates as YYYY-MM-DD, or null when the date is missing or you cannot read it confidently.
5. Gender: return "M", "F", or null. Words like Boy/Girl map to M/F.
6. Phone numbers: copy the digits as written.
7. If a row is crossed out, still transcribe it and set struckThrough to true — a teacher decides what a crossing-out meant, not you.
8. If part of a row is illegible, transcribe what you can read and lower the confidence for that row.
9. Report a header row as a header, not as a learner.

For every learner give a confidence between 0 and 1 describing how clearly YOU could read that row. Be honest and be conservative: 1.0 means printed and unambiguous, 0.5 means you are guessing at part of the name.

Return one entry per learner row, for every page, in page order.`

/**
 * The tool the model must call. A tool schema rather than "return JSON"
 * because the generators in this repo that ask for JSON in prose get JSON with
 * commentary around it often enough to matter, and a class list is parsed
 * once for eighty children.
 */
const EXTRACTION_TOOL = {
  name: 'record_class_list',
  description: 'Record every learner row read from the supplied class-list pages.',
  input_schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        description: 'One entry per page image supplied, in the same order.',
        items: {
          type: 'object',
          properties: {
            pageNumber: { type: 'integer', description: 'The page number given with the image.' },
            readable: {
              type: 'boolean',
              description: 'False when the image is too blurred, dark or cropped to read any learners from.',
            },
            note: {
              type: 'string',
              description: 'A short plain statement of any problem with this page, for the teacher.',
            },
            learners: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  learnerNumber: { type: 'string', description: 'The number in the leftmost column, if written.' },
                  admissionNumber: { type: 'string', description: 'The school admission number, exactly as written. Omit if absent.' },
                  fullName: { type: 'string', description: 'The learner name, exactly as written.' },
                  gender: { type: 'string', enum: ['M', 'F'] },
                  parentPhone: { type: 'string' },
                  admissionDate: { type: 'string', description: 'YYYY-MM-DD.' },
                  struckThrough: { type: 'boolean' },
                  confidence: { type: 'number', description: 'How clearly this row could be read, 0 to 1.' },
                },
                required: ['fullName', 'confidence'],
              },
            },
          },
          required: ['pageNumber', 'readable', 'learners'],
        },
      },
    },
    required: ['pages'],
  },
}

/**
 * Turn the client's page payload into Anthropic content blocks, dropping
 * anything that is not an image we can send.
 *
 * Returns the blocks AND the pages that were REJECTED, with a reason. A page
 * silently dropped here is a page of learners that never reaches the register
 * and that nobody is told about.
 */
function buildImageContent(pages) {
  const content = []
  const accepted = []
  const rejected = []

  for (const page of (Array.isArray(pages) ? pages : []).slice(0, MAX_PAGES_PER_CALL)) {
    const match = String(page?.dataUrl || '')
      .match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
    if (!match) {
      rejected.push({ pageNumber: page?.pageNumber ?? null, reason: 'not_an_image' })
      continue
    }
    const mediaType = match[1].toLowerCase()
    if (!ALLOWED_MIME.has(mediaType)) {
      rejected.push({ pageNumber: page?.pageNumber ?? null, reason: 'unsupported_image_type' })
      continue
    }
    const data = match[2].replace(/\s+/g, '')
    // base64 decodes to about three quarters of its length.
    if (data.length * 0.75 > MAX_IMAGE_BYTES) {
      rejected.push({ pageNumber: page?.pageNumber ?? null, reason: 'image_too_large' })
      continue
    }
    content.push({ type: 'text', text: `Page ${page.pageNumber}` })
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })
    accepted.push(page.pageNumber)
  }

  return { content, accepted, rejected }
}

const clamp01 = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

const cleanString = (v, max) => {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/**
 * Normalise the model's tool input into the row shape the review screen and
 * captureSessionCore expect.
 *
 * A page the model reports as UNREADABLE comes back with status 'failed' and
 * no rows, which is what makes the difference between "this page had no
 * learners on it" and "we could not read this page" survive all the way to
 * the teacher.
 */
function parseExtraction(toolInput, { requestedPages = [] } = {}) {
  const byNumber = new Map()
  for (const page of (toolInput?.pages || [])) {
    const number = Number(page?.pageNumber)
    if (!Number.isInteger(number)) continue
    const readable = page?.readable !== false
    const learners = Array.isArray(page?.learners) ? page.learners : []
    byNumber.set(number, {
      pageNumber: number,
      status: readable && learners.length ? 'extracted' : 'failed',
      note: cleanString(page?.note, 200),
      rows: learners
        .map((row) => {
          const fullName = cleanString(row?.fullName, 120)
          if (!fullName) return null
          return {
            learnerNumber: cleanString(row?.learnerNumber, 20) || '',
            admissionNumber: cleanString(row?.admissionNumber, 40),
            fullName,
            gender: row?.gender === 'M' || row?.gender === 'F' ? row.gender : null,
            parentPhone: cleanString(row?.parentPhone, 40),
            admissionDate: /^\d{4}-\d{2}-\d{2}$/.test(row?.admissionDate || '') ? row.admissionDate : null,
            // A crossed-out row is transcribed and flagged; a teacher decides
            // what the crossing-out meant.
            struckThrough: row?.struckThrough === true,
            confidence: clamp01(row?.confidence),
            source: 'capture',
          }
        })
        .filter(Boolean),
    })
  }

  // Every page that was SENT comes back in the answer, even if the model said
  // nothing about it — an omitted page is a failure, not an empty page.
  const pages = requestedPages.map((number) => byNumber.get(number) || {
    pageNumber: number,
    status: 'failed',
    note: 'This page could not be read.',
    rows: [],
  })

  return {
    pages,
    totalRows: pages.reduce((n, p) => n + p.rows.length, 0),
  }
}

module.exports = {
  SYSTEM_PROMPT,
  EXTRACTION_TOOL,
  MAX_PAGES_PER_CALL,
  buildImageContent,
  parseExtraction,
}
