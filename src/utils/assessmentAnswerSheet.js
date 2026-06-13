/**
 * Build a printable answer sheet for an assessment.
 *
 * Pure (no React, no DOM) so it's unit-testable. Reuses buildPaperLayout so
 * the question numbering matches the paper exactly, then reduces each question
 * to an answer-sheet row: MCQ → a bubble row (A, B, C…) sized to the number of
 * real options; everything else → a numbered write-in line.
 *
 * Used by the PDF + DOCX answer-sheet exporters.
 */

import { buildPaperLayout, buildPaperTitle } from './assessmentPaperLayout.js'

const MIN_BUBBLES = 2
const MAX_BUBBLES = 8

/**
 * How many answer bubbles an MCQ needs — one per option that actually has
 * content (text OR an image). Falls back sensibly for malformed data and is
 * clamped to 2–8 (A–H).
 */
export function answerSheetOptionCount(block) {
  const opts = Array.isArray(block?.options) ? block.options : []
  const plain = Array.isArray(block?.optionsPlain) ? block.optionsPlain : []
  const media = Array.isArray(block?.optionMedia) ? block.optionMedia : []
  let n = 0
  for (let i = 0; i < opts.length; i += 1) {
    const hasText = String(plain[i] ?? opts[i] ?? '').trim().length > 0
    const hasImg = Boolean(media[i] && media[i].imageUrl)
    if (hasText || hasImg) n += 1
  }
  if (n < MIN_BUBBLES) n = opts.length || 4
  return Math.min(Math.max(n, MIN_BUBBLES), MAX_BUBBLES)
}

/**
 * @returns {{ schoolName, title, subject, name, date, totalMarks, items, mcqCount }}
 *   items: [{ number, kind: 'mcq', optionCount } | { number, kind: 'written' }]
 */
export function buildAnswerSheet(assessment = {}, questions = []) {
  const blocks = buildPaperLayout(assessment, questions, { mode: 'paper' })
  const header = blocks.find((b) => b.kind === 'header') || {}
  const learner = blocks.find((b) => b.kind === 'learnerFields') || {}

  const items = []
  for (const b of blocks) {
    if (b.kind !== 'question') continue
    if (b.type === 'mcq') {
      items.push({ number: b.number, kind: 'mcq', optionCount: answerSheetOptionCount(b) })
    } else {
      items.push({ number: b.number, kind: 'written' })
    }
  }

  return {
    schoolName: header.schoolName || '',
    title: header.title || buildPaperTitle(assessment),
    subject: header.subject || '',
    // learnerFields stores these as booleans (default true unless turned off).
    name: learner.name !== false,
    date: learner.date !== false,
    totalMarks: learner.totalMarks || 0,
    items,
    mcqCount: items.filter((i) => i.kind === 'mcq').length,
  }
}
