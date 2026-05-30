// src/features/notes/lib/studyBlocks.js
//
// Block model + pure helpers for `noteFormat: 'study'` notes — the structured,
// interactive "study note" type (objectives, key words, callouts, quick-checks,
// exam tips, a practice-quiz card, …). Ported from the standalone Notes Studio
// and adapted to the app:
//   • image blocks carry a Storage `url` (not a base64 data URL)
//   • quiz blocks carry a `quizId` linking to a real ZedExams quiz (not a URL)
//
// This module is pure (no React, no Firestore) so it can be unit-tested and
// imported by both the reader and the editor.

// A short unique id for blocks. Uses crypto.randomUUID when available (matches
// the asset-batch id pattern in AdminNoteEditor), with a timestamp fallback.
function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 12)
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Ordered list of block types the author can add, with their menu labels.
export const STUDY_BLOCK_LABELS = {
  objectives: '🎯 Objectives',
  think:      '💭 Think first',
  keyterms:   '🔑 Key words',
  heading:    'Heading',
  paragraph:  'Paragraph',
  bullets:    'Bulleted list',
  numbers:    'Numbered list',
  table:      'Table',
  keyidea:    '⚡ Key idea',
  note:       '🧠 Remember',
  tip:        '💡 Study tip',
  picture:    '🖼 Picture description',
  image:      'Image',
  quickcheck: '❓ Quick check',
  exam:       '📝 Exam tip',
  mistake:    '⚠️ Common mistake',
  summary:    '✅ Summary',
  quiz:       '🧪 Practice quiz',
}

export const STUDY_BLOCK_TYPES = Object.keys(STUDY_BLOCK_LABELS)

// ─── tiny text helpers ────────────────────────────────────────────────

/** HTML-escape a string for safe insertion. */
export function escapeHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Lightweight inline markup → safe HTML string: escapes first, then turns
 * **bold** and *italic* into <strong>/<em>. Used with dangerouslySetInnerHTML
 * (input is fully escaped before any tags are introduced, so it cannot inject).
 */
export function mdInline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>')
}

/** Strip bold/italic markers — used for read-aloud plain text. */
export function stripMd(s) {
  return (s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
}

/** Split a textarea value into trimmed, non-empty lines. */
export function linesFrom(text) {
  return (text || '').split('\n').map(x => x.trim()).filter(Boolean)
}

// ─── block factory ────────────────────────────────────────────────────

/** A fresh block of the given type with sensible placeholder content. */
export function newStudyBlock(type) {
  switch (type) {
    case 'objectives': return { id: uid(), type, items: ['First objective', 'Second objective'] }
    case 'think':      return { id: uid(), type, lines: ['Ask a real-life question here.', 'What do you already know about this?'] }
    case 'keyterms':   return { id: uid(), type, rows: [{ term: 'Key word', def: 'Its meaning' }] }
    case 'heading':    return { id: uid(), type, level: 3, text: 'New heading' }
    case 'paragraph':  return { id: uid(), type, text: 'New paragraph. Use **bold** for key terms.' }
    case 'bullets':    return { id: uid(), type, items: ['Point one', 'Point two'] }
    case 'numbers':    return { id: uid(), type, items: ['Step one', 'Step two'] }
    case 'table':      return { id: uid(), type, headers: ['Column 1', 'Column 2'], rows: [{ cells: ['', ''] }] }
    case 'keyidea':    return { id: uid(), type, text: 'The one key idea of this section.' }
    case 'note':       return { id: uid(), type, lines: ['Important note.'] }
    case 'tip':        return { id: uid(), type, lines: ['A short study tip.'] }
    case 'picture':    return { id: uid(), type, caption: 'What the picture shows', lines: ['Describe the diagram here.'] }
    case 'image':      return { id: uid(), type, url: '', caption: '' }
    case 'quickcheck': return { id: uid(), type, q: 'Ask a question here.', a: 'Write the answer here.', level: '' }
    case 'exam':       return { id: uid(), type, q: 'State one …', a: 'A good exam answer …' }
    case 'mistake':    return { id: uid(), type, wrong: 'A common wrong answer.', correct: 'The correct answer.' }
    case 'summary':    return { id: uid(), type, items: ['Key point one', 'Key point two'] }
    case 'quiz':       return { id: uid(), type, quizId: '', quizTitle: '', questionCount: null }
    default:           return { id: uid(), type: 'paragraph', text: '' }
  }
}

/** The default block set for a brand-new study note (recommended teaching order). */
export function blankStudyBlocks() {
  return [
    { id: uid(), type: 'objectives', items: ['First objective', 'Second objective'] },
    { id: uid(), type: 'think', lines: ['Ask a real-life question here.', 'What do you already know about this?'] },
    { id: uid(), type: 'keyterms', rows: [{ term: 'Key word', def: 'Its meaning' }] },
    { id: uid(), type: 'heading', level: 3, text: 'Main idea' },
    { id: uid(), type: 'paragraph', text: 'Write the explanation here. Use **bold** for key words.' },
    { id: uid(), type: 'quickcheck', q: 'Ask a quick question.', a: 'Give the answer.', level: 'Easy' },
    { id: uid(), type: 'mistake', wrong: 'A common wrong answer.', correct: 'The correct answer.' },
    { id: uid(), type: 'exam', q: 'State …', a: 'A good exam-style answer …' },
    { id: uid(), type: 'summary', items: ['Key point one', 'Key point two'] },
    { id: uid(), type: 'quiz', quizId: '', quizTitle: '', questionCount: null },
  ]
}

// ─── derived values ───────────────────────────────────────────────────

const WORDS_RE = /\s+/

function collectText(blocks, fn) {
  for (const b of blocks || []) {
    if (b.text) fn(b.text)
    if (b.items) b.items.forEach(fn)
    if (b.lines) b.lines.forEach(fn)
    if (b.rows) b.rows.forEach(r => {
      if (Array.isArray(r)) r.forEach(fn)                 // legacy [term, def]
      else if (r && typeof r === 'object') {
        if (r.term != null) fn(r.term)
        if (r.def != null) fn(r.def)
        if (Array.isArray(r.cells)) r.cells.forEach(fn)
      }
    })
    if (b.headers) b.headers.forEach(fn)
    if (b.q) fn(b.q)
    if (b.a) fn(b.a)
    if (b.wrong) fn(b.wrong)
    if (b.correct) fn(b.correct)
    if (b.caption) fn(b.caption)
  }
}

/** Up to ~160 chars of plain text from the first prose-ish block — for list cards. */
export function buildStudyExcerpt(blocks, maxLen = 160) {
  const first = (blocks || []).find(b =>
    (b.type === 'paragraph' && b.text) ||
    (b.type === 'keyidea' && b.text) ||
    (b.type === 'objectives' && b.items?.length) ||
    (b.type === 'think' && b.lines?.length),
  )
  let text = ''
  if (first) {
    if (first.text) text = first.text
    else if (first.items) text = first.items.join('. ')
    else if (first.lines) text = first.lines.join(' ')
  }
  text = stripMd(text).replace(WORDS_RE, ' ').trim()
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '…'
}

/** Estimated reading time in minutes (≈200 wpm, min 1). */
export function studyReadingTime(blocks) {
  let words = 0
  collectText(blocks, t => { words += String(t || '').trim().split(WORDS_RE).filter(Boolean).length })
  return Math.max(1, Math.round(words / 200))
}

/** Count the "major" sections — used for the reader progress label. */
export function studySectionCount(blocks) {
  const major = new Set(['heading', 'objectives', 'think', 'keyterms', 'summary', 'quickcheck', 'exam', 'mistake', 'quiz'])
  return Math.max(1, (blocks || []).filter(b => major.has(b.type)).length)
}

/** Flatten a study note into a single string for text-to-speech. */
export function studySpeechText(blocks, title = '') {
  const parts = [title]
  for (const b of blocks || []) {
    if (b.type === 'paragraph' || b.type === 'keyidea' || b.type === 'heading') parts.push(stripMd(b.text))
    else if (['objectives', 'bullets', 'numbers', 'summary'].includes(b.type)) parts.push((b.items || []).map(stripMd).join('. '))
    else if (['note', 'tip', 'think'].includes(b.type)) parts.push((b.lines || []).map(stripMd).join('. '))
    else if (b.type === 'keyterms') parts.push('Key words. ' + (b.rows || []).map(r => stripMd(r.term) + ': ' + stripMd(r.def || '')).join('. '))
    else if (b.type === 'quickcheck') parts.push('Quick check. ' + stripMd(b.q) + '. Answer: ' + stripMd(b.a))
    else if (b.type === 'exam') parts.push('Exam tip. Question: ' + stripMd(b.q) + '. Good answer: ' + stripMd(b.a))
    else if (b.type === 'mistake') parts.push('Common mistake. Wrong: ' + stripMd(b.wrong) + '. Correct: ' + stripMd(b.correct))
    else if (b.type === 'picture') parts.push('Picture. ' + stripMd(b.caption) + '. ' + (b.lines || []).map(stripMd).join('. '))
    else if (b.type === 'table') parts.push((b.rows || []).map(r => (r.cells || []).map(stripMd).join(', ')).join('. '))
  }
  return parts.filter(Boolean).join('. ')
}
