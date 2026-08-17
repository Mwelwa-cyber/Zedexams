/**
 * readerCore — pure logic for the prototype-v3 note reader engine.
 * No React, no Firestore, no DOM: everything here runs under plain
 * `node` (scripts/test-note-reader-core.mjs).
 *
 * The engine renders `noteFormat: 'study'` blocks (lib/studySchema.js).
 * A study note is routed into the new reader when it carries any of the
 * interactive reader block types — that per-note gate is what lets the
 * pipeline retire old notes subject-by-subject, never in one sweep.
 */

// Block types that only exist in the reader engine's vocabulary.
// `tapexplore`, `flow` and `startend` joined when the Digestive System
// note was authored to the mockup's depth. They belong here for the same
// reason the others do: a note carrying one could not have come from the
// old flat authoring path, so its presence is proof the note is a reader
// note. All three are CONTENT rather than practice, so mode visibility
// leaves them in both Learn and Revise.
export const READER_BLOCK_TYPES = [
  'keypoints', 'glossary', 'practice', 'sectioncheck', 'labeldiagram',
  'tapexplore', 'flow', 'startend',
]

/** True when a study note should render through the new ReaderEngine. */
export function isReaderNote(blocks) {
  return Array.isArray(blocks) && blocks.some((b) => b && READER_BLOCK_TYPES.includes(b.type))
}

/**
 * Mode visibility (prototype Learn / Revise):
 *  - Learn hides the key-points blocks (they are the revise summary);
 *  - Revise hides the practice surfaces (reveal cards, your-turn,
 *    section checks, the label diagram) and shows key points instead.
 * Everything else renders in both modes.
 */
const LEARN_HIDDEN = new Set(['keypoints'])
const REVISE_HIDDEN = new Set(['practice', 'sectioncheck', 'quickcheck', 'labeldiagram'])

export function blockVisibleInMode(type, mode) {
  if (mode === 'revise') return !REVISE_HIDDEN.has(type)
  return !LEARN_HIDDEN.has(type)
}

/**
 * Collect the keyword glossary from the blocks. Keys are normalised
 * (lower-cased, "…" spacing collapsed) so `[[Either … or]]` in a
 * paragraph finds the `either … or` entry.
 */
export function normalizeKeyword(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\s*…\s*/g, ' … ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildGlossary(blocks) {
  const map = new Map()
  for (const b of blocks || []) {
    if (!b || b.type !== 'glossary') continue
    for (const e of b.entries || []) {
      if (e && e.word) map.set(normalizeKeyword(e.word), e)
    }
  }
  return map
}

/**
 * Inline text → tokens. Supports the study notes' existing `**bold**`
 * plus the reader's `[[keyword]]` marks. Returns
 *   [{ t: 'text' | 'bold' | 'kw', v: string }]
 * Rendering stays in React (no innerHTML), so this needs no escaping.
 */
export function tokenizeInline(text) {
  const out = []
  const s = String(text ?? '')
  const re = /\*\*(.+?)\*\*|\[\[(.+?)\]\]/g
  let last = 0
  let m
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'bold', v: m[1] })
    else out.push({ t: 'kw', v: m[2] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

/** Inline text with all marks stripped (for meta lines, aria labels). */
export function plainInline(text) {
  return tokenizeInline(text).map((tk) => tk.v).join('')
}

/**
 * Paced reveal (Learn mode). Sections break at level-2 headings: step 0
 * is everything before the first heading, each heading starts the next
 * step. Returns per-block step indices plus the total step count.
 */
export function assignRevealSteps(blocks) {
  let step = 0
  const steps = (blocks || []).map((b) => {
    if (b && b.type === 'heading' && (b.level ?? 2) === 2) step += 1
    return step
  })
  return { steps, maxStep: step }
}

/** Blocks visible at reveal step `shown` (revise mode shows everything). */
export function visibleAtStep(blocks, steps, shown) {
  return (blocks || []).filter((_, i) => (steps[i] ?? 0) <= shown)
}

/**
 * Reading time estimate — the prototype's "7 min read · 3 sections"
 * meta line, derived from real content (≈180 wpm plus a fixed cost per
 * interactive card) rather than invented.
 */
export function readerMeta(blocks) {
  let words = 0
  let interactive = 0
  let sections = 0
  for (const b of blocks || []) {
    if (!b) continue
    if (b.type === 'heading' && (b.level ?? 2) === 2) sections += 1
    if (['practice', 'sectioncheck', 'labeldiagram', 'quickcheck'].includes(b.type)) interactive += 1
    const texts = [b.text, b.q, b.caption, ...(b.items || []), ...(b.lines || [])]
    for (const t of texts) if (typeof t === 'string') words += t.split(/\s+/).filter(Boolean).length
  }
  const minutes = Math.max(1, Math.round(words / 180 + interactive * 0.5))
  return { minutes, sections: Math.max(sections, 1) }
}

/**
 * Revision time estimate — the Notes hub's "2 min revise" line (the v4
 * prototype's revision hub). Counted over the blocks Revise mode
 * actually shows (blockVisibleInMode), so it is the honest cost of the
 * key-points pass rather than a fraction of the full read.
 */
export function reviseMinutes(blocks) {
  let words = 0
  for (const b of blocks || []) {
    if (!b || !blockVisibleInMode(b.type, 'revise')) continue
    const texts = [b.text, b.q, b.caption, ...(b.items || []), ...(b.lines || [])]
    for (const t of texts) if (typeof t === 'string') words += t.split(/\s+/).filter(Boolean).length
  }
  return Math.max(1, Math.round(words / 180))
}

/**
 * Label-diagram scoring. `items` are the authored slots; `placed` maps
 * slot key → placed label. Only placed slots are judged (the prototype
 * reports "You got N of M. Fix the red boxes"). Matching is by label
 * text, since the bank chips ARE the labels.
 */
export function scoreLabelPlacement(items, placed) {
  let placedCount = 0
  let correct = 0
  const verdicts = {}
  for (const it of items || []) {
    const key = labelSlotKey(it)
    const label = placed?.[key]
    if (!label) continue
    placedCount += 1
    const ok = label === it.label
    verdicts[key] = ok
    if (ok) correct += 1
  }
  return {
    placed: placedCount,
    correct,
    total: (items || []).length,
    perfect: correct === (items || []).length,
    verdicts,
  }
}

/** Stable slot key for a label item (authored key, else the label). */
export function labelSlotKey(item) {
  return (item && item.key) || (item && item.label) || ''
}

/**
 * The word bank order: alphabetical, NOT slot order — reading-order
 * chips would leak the answers (the same rule diagramProjections applies
 * to learner word banks).
 */
export function labelBankOrder(items) {
  return (items || [])
    .map((it) => it.label)
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
}

/** Scroll progress 0–100 for the top progress bar. */
export function scrollProgress(scrollY, maxScroll) {
  if (!Number.isFinite(scrollY) || !Number.isFinite(maxScroll) || maxScroll <= 0) return 0
  return Math.min(100, Math.max(0, (scrollY / maxScroll) * 100))
}
