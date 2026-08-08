/**
 * Diagram Library projections (Visual Studio v2, spec 1A/1B — pure).
 *
 * A `diagramAssets` doc stores ONE label set (`{ id, word, anchor, box }`,
 * coordinates normalized 0–1); the four printable versions are projections
 * derived here at render time — never four saved images:
 *
 *   • teacher   — the diagram shows the full words.
 *   • learner   — the diagram shows P, Q, R… + an alphabetical word bank.
 *   • answerKey — letters on the diagram + a "P = Stomach" legend.
 *   • picture   — label-free art.
 *
 * Two derivation rules the model depends on:
 *
 *   • Letters are NEVER stored. They come from READING ORDER — sort by
 *     anchor.y, then anchor.x (a small row tolerance keeps two labels at
 *     visually the same height reading left→right) — so adding or deleting a
 *     label can never skip or duplicate a letter.
 *   • The learner word bank is lowercase and ALPHABETICAL — anchor order
 *     would leak the answers.
 *
 * Shares LETTER_SEQUENCE with the v1 editor (Zambian papers start at P).
 * No DOM, no Firebase — tests run under plain `node`.
 */

import { LETTER_SEQUENCE, VERSIONS } from './visualVersions.js'

export { LETTER_SEQUENCE, VERSIONS }

// Two anchors within this vertical distance count as "the same row" and
// letter left→right, so hand-placed labels at visually equal height don't
// swap letters over a sub-pixel y difference.
export const READING_ROW_TOLERANCE = 0.03

/**
 * Labels in reading order: top→bottom, then left→right within a row.
 * Returns a NEW array; input order and objects are untouched.
 */
export function readingOrder(labels = []) {
  return [...labels].sort((a, b) => {
    const ay = a?.anchor?.y ?? 0
    const by = b?.anchor?.y ?? 0
    if (Math.abs(ay - by) > READING_ROW_TOLERANCE) return ay - by
    return (a?.anchor?.x ?? 0) - (b?.anchor?.x ?? 0)
  })
}

/**
 * Derive the exam letter for every label (P, Q, R… in reading order).
 * Returns NEW label objects with a `letter` field; the stored set never
 * carries one. Reading order decides the letter; the returned array keeps
 * the INPUT order so callers can zip it against their own state.
 */
export function letteredLabels(labels = []) {
  const ordered = readingOrder(labels)
  const letterByRef = new Map(ordered.map((l, i) => [l, LETTER_SEQUENCE[i] || `#${i + 1}`]))
  return labels.map((l) => ({ ...l, letter: letterByRef.get(l) }))
}

/**
 * What text a label shows for a version:
 * teacher → the word; learner/answerKey → the letter; picture → nothing.
 */
export function displayTextForVersion(letteredLabel, version) {
  if (!letteredLabel) return ''
  if (version === 'picture') return ''
  if (version === 'teacher') return String(letteredLabel.word || '')
  return String(letteredLabel.letter || '')
}

/**
 * The learner word bank: every labelled word, lowercase, de-duplicated,
 * ALPHABETICAL (anchor order leaks answers). Blank words drop out.
 */
export function wordBank(labels = []) {
  const words = labels
    .map((l) => String(l?.word || '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(words)].sort((a, b) => a.localeCompare(b))
}

/** "P = Stomach" legend lines, in reading (letter) order. Blank words drop. */
export function answerKeyLines(labels = []) {
  const ordered = readingOrder(labels)
  return ordered
    .map((l, i) => ({ letter: LETTER_SEQUENCE[i] || `#${i + 1}`, word: String(l?.word || '').trim() }))
    .filter((l) => l.word)
    .map((l) => `${l.letter} = ${l.word}`)
}

/**
 * One projection object a renderer walks — the single entry point for the
 * in-studio preview, live version thumbnails, exports and consumers.
 *
 * @param {Array} labels stored label set ({ id, word, anchor, box })
 * @param {'teacher'|'learner'|'answerKey'|'picture'} version
 * @returns {{ version, labels, wordBank, answerKey, blankLetters }}
 *   labels — input order, each with derived `letter` + `display` text
 *   wordBank — learner only (else [])
 *   answerKey — answerKey only (else [])
 *   blankLetters — the "P: ____" rows for learner/answerKey sheets
 */
export function projectDiagram(labels = [], version = 'teacher') {
  const v = VERSIONS.includes(version) ? version : 'teacher'
  const lettered = letteredLabels(labels)
  return {
    version: v,
    labels: lettered.map((l) => ({ ...l, display: displayTextForVersion(l, v) })),
    wordBank: v === 'learner' ? wordBank(labels) : [],
    answerKey: v === 'answerKey' ? answerKeyLines(labels) : [],
    blankLetters: (v === 'learner' || v === 'answerKey')
      ? readingOrder(labels).map((_, i) => LETTER_SEQUENCE[i] || `#${i + 1}`)
      : [],
  }
}

/**
 * The learner app's drag-the-label contract (spec 1A consumption): the
 * unlabelled art plus each anchor as a drop zone, with the word as the
 * draggable token. Tokens are served alphabetically (word-bank rule).
 */
export function dragTheLabelZones(labels = []) {
  return {
    zones: readingOrder(labels)
      .filter((l) => String(l?.word || '').trim())
      .map((l) => ({ id: String(l.id || ''), anchor: { ...l.anchor }, word: String(l.word).trim() })),
    tokens: wordBank(labels),
  }
}
