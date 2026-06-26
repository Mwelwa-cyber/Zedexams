/**
 * Deterministic, zero-cost "download guard".
 *
 * Every studio export funnels through saveBlob(blob, filename). A regression in
 * any of the ~25 exporters can quietly produce a junk filename — a bare
 * "download", an exporter's literal fallback default ("worksheet.docx"), or a
 * blob/UUID gibberish name like "5fee66fe-1c3a-4b9d-….docx" (the symptom of the
 * iOS/Android `download`-attribute bug). None of these tell a teacher what the
 * file is once it lands in their Downloads folder.
 *
 * This module is the deterministic, AI-free guard against that. It is a pure
 * module — no React, no firebase, no import.meta.env — so a plain `node` test
 * can import it and so it costs nothing and scales to unlimited downloads.
 *
 *   inspectFilename(filename)         — is this a human-readable name at all?
 *   checkDownload({ tool, filename,   — richer per-studio check: name + title +
 *     output, inputs })                 grade/subject match + not structurally empty.
 *
 * Both are advisory: callers warn/log on a failure, they never block the
 * download.
 */

import { gradeLabel, subjectLabel } from './downloadFilename.js'

// The literal fallback default names the exporters reach for when they have no
// real context. A file actually landing with one of these means the
// human-readable name was lost upstream. Matched case-insensitively, with or
// without an extension.
const GENERIC_DEFAULTS = new Set([
  'download',
  'document',
  'file',
  'untitled',
  'lesson-plan',
  'lesson plan',
  'worksheet',
  'assessment',
  'sba-task',
  'sba task',
  'notes',
  'export',
])

// 8-4-4-4-12 hex UUID (the blob: internal name iOS/Android fall back to).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
// A long unbroken run of hex with no spaces — gibberish, not a real name.
const HEX_GIBBERISH_RE = /^[0-9a-f]{16,}$/i

/** Strip a trailing ".ext" and return the lower-cased base name. */
function baseLower(filename) {
  return String(filename)
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .trim()
    .toLowerCase()
}

/**
 * Cheap structural check on a single filename.
 *
 * Flags it as bad when it is: empty/whitespace; missing an extension; a bare
 * generic default; or UUID/hex gibberish. A good human name has spaces and
 * real words.
 *
 * @param {string} filename
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
export function inspectFilename(filename) {
  const raw = String(filename ?? '').trim()

  if (!raw) {
    return { ok: false, code: 'empty', message: 'Download has no filename.' }
  }

  // Must carry an extension (e.g. ".docx", ".pdf").
  if (!/\.[a-z0-9]{1,5}$/i.test(raw)) {
    return { ok: false, code: 'no-extension', message: `Filename has no extension: "${raw}".` }
  }

  const base = baseLower(raw)

  if (!base) {
    return { ok: false, code: 'empty', message: 'Download has no name before the extension.' }
  }

  if (GENERIC_DEFAULTS.has(base)) {
    return { ok: false, code: 'generic-default', message: `Generic fallback filename "${raw}" — the real name was lost.` }
  }

  if (UUID_RE.test(base)) {
    return { ok: false, code: 'uuid-name', message: `Filename looks like a random UUID: "${raw}".` }
  }

  // A single unbroken hex/gibberish token (no spaces, no real words).
  if (!/\s/.test(base) && HEX_GIBBERISH_RE.test(base.replace(/[-_]/g, ''))) {
    return { ok: false, code: 'gibberish-name', message: `Filename looks like gibberish: "${raw}".` }
  }

  return { ok: true }
}

/** Does `haystack` contain `needle`, case-insensitively? Empty needle → true. */
function includesCI(haystack, needle) {
  if (!needle) return true
  return String(haystack).toLowerCase().includes(String(needle).toLowerCase())
}

/**
 * Pull a non-empty document title out of whichever shape the tool uses. Lesson
 * plans carry the subject as header.topic; worksheets/tasks carry header.title.
 */
function resolveTitle(output) {
  const candidates = [output?.header?.title, output?.title, output?.header?.topic]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return ''
}

/**
 * True when `output.sections` is present AND we can clearly tell it carries no
 * content — i.e. it's `[]`, or every section has no questions. Tools without a
 * `sections` array (e.g. SBA tasks, which use a flat `questions` array) return
 * false so they are never false-flagged.
 */
function isStructurallyEmpty(output) {
  const sections = output?.sections
  if (!Array.isArray(sections)) return false // shape doesn't apply — don't flag
  if (sections.length === 0) return true
  // Empty when no section carries any questions/rows we can see.
  return sections.every((s) => {
    const qs = s?.questions ?? s?.items ?? s?.rows
    return !Array.isArray(qs) || qs.length === 0
  })
}

/**
 * Richer, studio-level download check. Deterministic, AI-free.
 *
 * @param {object} args
 * @param {string} [args.tool]      'lessonPlan' | 'worksheet' | 'sbaTask' (tag for messages).
 * @param {string} args.filename    The filename about to be saved.
 * @param {object} [args.output]    The generated document object.
 * @param {object} [args.inputs]    { grade, subject, topic } the teacher requested.
 * @returns {{ ok: boolean, problems: Array<{ code: string, message: string }> }}
 */
export function checkDownload({ filename, output, inputs } = {}) {
  const problems = []

  // a. Filename is a real human-readable name.
  const nameCheck = inspectFilename(filename)
  if (!nameCheck.ok) {
    problems.push({ code: nameCheck.code || 'bad-filename', message: nameCheck.message || 'Filename looks wrong.' })
  }

  // b. The document carries a title.
  if (output != null && !resolveTitle(output)) {
    problems.push({ code: 'missing-title', message: 'The document has no title.' })
  }

  // c. The filename reflects what was requested (grade + subject).
  const wantGrade = inputs?.grade ? gradeLabel(inputs.grade) : ''
  const wantSubject = inputs?.subject ? subjectLabel(inputs.subject) : ''
  const mismatches = []
  if (wantGrade && !includesCI(filename, wantGrade)) mismatches.push(wantGrade)
  if (wantSubject && !includesCI(filename, wantSubject)) mismatches.push(wantSubject)
  if (mismatches.length) {
    problems.push({
      code: 'name-mismatch',
      message: `Filename "${filename}" is missing ${mismatches.join(' / ')}.`,
    })
  }

  // d. The document isn't structurally empty (only when the shape lets us tell).
  if (isStructurallyEmpty(output)) {
    problems.push({ code: 'empty-document', message: 'The document has no questions.' })
  }

  return { ok: problems.length === 0, problems }
}
