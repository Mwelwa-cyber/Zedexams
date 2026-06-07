// src/features/notes/lib/highlight.js
//
// Pure helpers to render study-note prose with **bold**/*italic* AND a <mark>
// around sentences that contain an AI-chosen important excerpt. Used by
// StudyNoteReader when the learner has highlights ON. No React, no DOM.

import { mdInline } from './studyBlocks.js'

const MIN = 8
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?'")\]]+$/g, '').trim()

/** Split text into sentences, keeping each sentence's trailing punctuation/space. */
export function splitSentences(text) {
  const parts = String(text || '').match(/[^.!?]+[.!?]*\s*/g)
  return parts && parts.length ? parts : (text ? [String(text)] : [])
}

/**
 * True if `sentence` contains any excerpt (normalized internally, min length).
 * Accepts raw excerpts — normalizes each internally so callers need not pre-normalize.
 */
export function isHighlighted(sentence, excerpts) {
  const list = Array.isArray(excerpts) ? excerpts : []
  const n = norm(sentence)
  if (n.length < MIN) return false
  return list.some(e => {
    const ne = norm(e)
    return ne.length >= MIN && n.includes(ne)
  })
}

/** Safe HTML: mdInline per sentence, matched sentences wrapped in <mark>. */
export function mdInlineHighlighted(text, excerpts) {
  const normExcerpts = (excerpts || []).map(norm).filter(e => e.length >= MIN)
  if (!normExcerpts.length) return mdInline(text)
  return splitSentences(text).map(s => {
    const html = mdInline(s)
    return isHighlighted(s, normExcerpts) ? `<mark class="note-hl">${html}</mark>` : html
  }).join('')
}
