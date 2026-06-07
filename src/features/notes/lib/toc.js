// src/features/notes/lib/toc.js
//
// Pure helpers to derive a table-of-contents from a study note's blocks[].
// Sections come from `heading` blocks (level 2 = section, level 3 = sub-section).
// No React, no DOM — unit-tested and shared by the reader + the TOC UI so the
// anchor ids the reader renders always match the ids the TOC links to.

import { stripMd } from './studyBlocks.js'

/** Stable DOM id for a section anchor, derived from its TOC key. */
export function sectionAnchorId(key) {
  return `note-sec-${key}`
}

/**
 * Build a flat TOC from study blocks. Returns
 *   [{ key, id, text, level, index }]
 * in document order — one entry per non-empty `heading` block.
 *   • key   — unique + stable: the block id when present, else `idx-<i>`.
 *   • id    — sectionAnchorId(key); the DOM id the reader puts on the heading.
 *   • level — 2 (section) or 3 (sub-section).
 *   • index — the heading's index in the blocks array (lets the reader map
 *             block index → anchor id without re-deriving uniqueness).
 * Returns [] when there are no headings.
 */
export function buildToc(blocks) {
  if (!Array.isArray(blocks)) return []
  const out = []
  const seen = new Set()
  blocks.forEach((b, i) => {
    if (!b || b.type !== 'heading') return
    const text = stripMd(String(b.text || '')).trim()
    if (!text) return
    let key = b.id != null && b.id !== '' ? String(b.id) : `idx-${i}`
    if (seen.has(key)) key = `${key}-${i}` // guarantee uniqueness on duplicate ids
    seen.add(key)
    const level = b.level === 2 ? 2 : 3
    out.push({ key, id: sectionAnchorId(key), text, level, index: i })
  })
  return out
}
