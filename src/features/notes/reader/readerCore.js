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
 * Mode placement (Learn / Revise) — "one content source, two views".
 *
 * There is exactly ONE authored note. Learn and Revise are two doorways
 * into it, so a block is never re-authored per mode: the mode only
 * decides WHERE the block lands on the page.
 *
 * Four placements:
 *   'top'      — hoisted above the note body (Revise's key-points card).
 *   'main'     — in the note body, in authored order.
 *   'practice' — folded into Revise's closed "Practice these later"
 *                accordion. Collapsed, NOT deleted: the exercises are
 *                still the same blocks, one tap away.
 *   'hidden'   — not rendered in this mode at all.
 *
 * Learn hides the key-points block (it is the revise summary, and
 * handing it over first would give away the pass the learner is about
 * to make). Revise hoists it instead, hides the end-of-topic quiz and
 * the label-diagram GAME (revision is not assessment), and collapses
 * the practice surfaces. Everything else — paragraphs, tips, examples,
 * tap-to-explore cards, tap-to-reveal cards — reads in both.
 */
export const PLACEMENT = Object.freeze({
  TOP: 'top', MAIN: 'main', PRACTICE: 'practice', HIDDEN: 'hidden',
})

const LEARN_HIDDEN = new Set(['keypoints'])
const REVISE_TOP = new Set(['keypoints'])
// The end-of-topic quiz is assessment and revision mode is not an
// assessment pass — and it LEAVES the note (`/quiz/:id`), which is the
// real reason it has no place in a revision read.
//
// `labeldiagram` used to be hidden here on the same "not assessment"
// reasoning, and that was wrong twice over. It is a PICTURE as much as a
// game: hiding the exercise threw away the labelled figure with it, and
// for a topic the syllabus examines as a labelled diagram, that figure is
// the single most revision-worthy thing on the page. It also cost nothing
// to leave in — unlike the quiz it never navigates away, so a learner who
// only wants to look at it just looks at it. In the Digestive System note
// it was the ONLY block in its section, so hiding it left "4 Label the
// diagram ✏️" as a heading with a gap under it.
const REVISE_HIDDEN = new Set(['quiz'])
// "Practice these later" — collapsed behind a closed accordion.
const REVISE_PRACTICE = new Set(['practice', 'sectioncheck'])

/** Where a block of `type` lands in `mode`. */
export function blockPlacement(type, mode) {
  if (mode === 'revise') {
    if (REVISE_TOP.has(type)) return PLACEMENT.TOP
    if (REVISE_HIDDEN.has(type)) return PLACEMENT.HIDDEN
    if (REVISE_PRACTICE.has(type)) return PLACEMENT.PRACTICE
    return PLACEMENT.MAIN
  }
  return LEARN_HIDDEN.has(type) ? PLACEMENT.HIDDEN : PLACEMENT.MAIN
}

/**
 * True when the block reads as part of the note body in `mode` — i.e.
 * it is on the page without being unfolded first. `reviseMinutes` is
 * counted over exactly these, so the hub's "2 min revise" stays the
 * honest cost of the revision pass rather than of the whole note.
 */
export function blockVisibleInMode(type, mode) {
  const p = blockPlacement(type, mode)
  return p === PLACEMENT.MAIN || p === PLACEMENT.TOP
}

/**
 * The whole render plan for one note in one mode, in a single pure pass:
 * the hoisted blocks, the body, the collapsed practice set, and the
 * Learn-mode reveal steps.
 *
 * Section numbers are assigned over the AUTHORED order of level-2
 * headings, not over what a mode happens to render, so section 3 is
 * section 3 in both doorways.
 *
 * Returns `{ top, main, practice, maxStep }`, each list holding
 * `{ block, index, step, sectionNumber }` entries.
 */
export function planNoteView(blocks, mode = 'learn') {
  const list = Array.isArray(blocks) ? blocks : []
  const { steps, maxStep } = assignRevealSteps(list)
  const top = []
  const main = []
  const practice = []
  let section = 0

  list.forEach((block, index) => {
    if (!block) return
    if (block.type === 'heading' && (block.level ?? 2) === 2) section += 1
    const entry = {
      block,
      index,
      step: steps[index] ?? 0,
      sectionNumber:
        block.type === 'heading' && (block.level ?? 2) === 2 ? section : null,
    }
    switch (blockPlacement(block.type, mode)) {
      case PLACEMENT.TOP: top.push(entry); break
      case PLACEMENT.MAIN: main.push(entry); break
      case PLACEMENT.PRACTICE: practice.push(entry); break
      default: break // hidden
    }
  })

  return { top, main: dropEmptySections(main), practice, maxStep }
}

/**
 * Drop a section heading that this mode left with nothing under it.
 *
 * A mode hides block TYPES, not sections, so a section whose only content
 * is a hidden type keeps its heading and loses its body — the learner gets
 * a numbered heading followed by the next heading. That is what "4 Label
 * the diagram ✏️" was: one `labeldiagram` block, hidden in Revise, so the
 * section rendered as a title and a gap.
 *
 * Section NUMBERS are deliberately not recompacted. They are assigned over
 * the authored order precisely so section 3 is section 3 in both doorways;
 * renumbering here would make the same heading a different number
 * depending on which door the learner came through, which is the thing
 * that rule exists to prevent. A gap in the sequence is the honest signal
 * that a section is not part of this pass.
 */
function dropEmptySections(entries) {
  const isSection = (e) => e.block.type === 'heading' && (e.block.level ?? 2) === 2
  return entries.filter((entry, i) => {
    if (!isSection(entry)) return true
    // Keep the heading only if something that is not itself a section
    // heading follows it before the next one.
    for (let j = i + 1; j < entries.length; j += 1) {
      if (isSection(entries[j])) return false
      return true
    }
    return false
  })
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

/**
 * The one string the Notes hub searches a note by: title + headings +
 * key points, lower-cased.
 *
 * Search has to reach INTO the note (the acceptance check is "find a
 * topic by a word in its key points, across subjects") without loading
 * every note's blocks on the hub. So the field is stamped on write
 * (lib/firestore.js) and this same function recomputes it on read for
 * notes authored before the field existed — one implementation, so a
 * stamped note and a recomputed one are searched identically.
 *
 * Deliberately NOT the full body text: it would be most of the note in
 * a Firestore field, and a match on a passing mention in paragraph
 * eleven is not why anyone searches a revision hub.
 */
export function buildNoteSearchText(note = {}, blocks = []) {
  const parts = [note.title, note.subject, note.topic]
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b) continue
    if (b.type === 'heading') parts.push(plainInline(b.text))
    else if (b.type === 'keypoints') for (const it of b.items || []) parts.push(plainInline(it))
    else if (b.type === 'keyidea') parts.push(plainInline(b.text))
  }
  return parts
    .filter((p) => typeof p === 'string' && p.trim())
    .join(' ')
    .toLowerCase()
    // plainInline unwraps one level of marks; a nested `**[[word]]**`
    // leaves its brackets behind, and a learner searching "conjunction"
    // types no brackets. Strip whatever survived.
    .replace(/[[\]*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Does a note match the hub's search box? Every whitespace-separated
 * term must appear (AND), so "science digestion" narrows rather than
 * widening — the same rule the admin command palette uses.
 */
export function matchesNoteSearch(searchText, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = String(searchText || '')
  return terms.every((t) => hay.includes(t))
}
