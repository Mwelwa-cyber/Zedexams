// readAloudText — pure helpers that turn quiz rich-text values into a clean
// spoken string for text-to-speech. No React, no DOM — unit-testable under
// plain `node`.
//
// getRichPlainText handles Tiptap JSON / stringified docs / plain strings, but
// a *legacy HTML* value passes through with its tags intact. Speaking "<p>"
// aloud is nonsense, so we additionally strip any residual HTML tags and decode
// the handful of entities that survive, then normalise whitespace.

import { getRichPlainText } from '../editor/richPlainText.js'

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

const DEFAULT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/** Convert a single rich-text value (string / HTML / Tiptap doc) to spoken text. */
export function toSpokenText(value) {
  const base = getRichPlainText(value)
  if (!base) return ''
  return String(base)
    .replace(/<[^>]+>/g, ' ') // drop residual HTML tags from legacy content
    .replace(/&#?\w+;/g, (m) => (ENTITIES[m] !== undefined ? ENTITIES[m] : ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// Join spoken fragments with a period between them, but never double up
// punctuation when a fragment already ends with . ! or ?.
function joinSentences(parts) {
  const clean = parts.map((p) => (p || '').trim()).filter(Boolean)
  return clean
    .map((p, i) => {
      if (i === clean.length - 1) return p // leave the last one's punctuation as-is
      return /[.!?]$/.test(p) ? p : `${p}.`
    })
    .join(' ')
}

/** "Option A: …. Option B: …" for reading an MCQ's choices in order. */
export function optionsToReadAloudText(options, labels = DEFAULT_LABELS) {
  if (!Array.isArray(options)) return ''
  const items = options
    .map((opt, i) => {
      const clean = toSpokenText(opt)
      if (!clean) return ''
      return `Option ${labels[i] || i + 1}: ${clean}`
    })
    .filter(Boolean)
  return joinSentences(items)
}

/** The question stem, optionally prefixed by its shared instruction. */
export function questionToReadAloudText(question) {
  return joinSentences([toSpokenText(question?.sharedInstruction), toSpokenText(question?.text)])
}
