// src/features/notes/lib/labelEditorCore.js
//
// Pure helpers behind the label-the-diagram editor (click the picture to drop
// a label box, drag it to move it). No React, no DOM — the component hands in
// the numbers it read off the DOM and gets numbers back, so the geometry that
// decides where a learner's answer box lands is testable under plain node.
//
// Positions are stored as 0–1 fractions of the rendered image, the same unit
// the learner's LabelDiagram reads (`left: x*100%`, `top: y*100%`), so a box
// placed here lands on the same spot at every screen width.

/** Clamp to 0–1 and round to 3 decimals (0.1% of the image ≈ 1px on a phone). */
export function clamp01(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
}

/**
 * Turn a pointer position into an {x, y} fraction of the image box.
 * `rect` is the image wrapper's getBoundingClientRect(). A zero-sized rect
 * (image not laid out yet) returns null rather than NaN, so a stray event
 * during load cannot write NaN into a block that then fails validation.
 */
export function pointToFraction(rect, clientX, clientY) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  }
}

/**
 * A slot key no other item uses. LabelDiagram scores placements by
 * `labelSlotKey(item)` = key || label, so two items sharing a key would share
 * one answer box on the learner's screen.
 */
export function nextItemKey(items, prefix = 'p') {
  const used = new Set((items || []).map((it) => it && it.key).filter(Boolean))
  let n = (items || []).length + 1
  while (used.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

/** Move a box by a fraction, staying inside the image. */
export function nudge(value, delta) {
  return clamp01(Number(value) + delta)
}

/**
 * What is wrong with a label-the-diagram block, in plain words. Empty when the
 * block is fine. The learner-side needs at least two boxes (a one-box exercise
 * is not an exercise, and the write schema drops the block below two), a
 * picture to put them on, and distinct label texts (the word bank is built
 * from the labels, so two identical words are indistinguishable chips).
 */
export function labelDiagramIssues(block) {
  const issues = []
  const items = Array.isArray(block?.items) ? block.items : []
  if (!block?.url) issues.push('Upload the picture first — the boxes sit on top of it.')
  if (items.length < 2) issues.push('Add at least two labels.')
  const seen = new Set()
  for (const it of items) {
    const text = String(it?.label || '').trim().toLowerCase()
    if (!text) { issues.push('Every box needs a word.'); break }
  }
  for (const it of items) {
    const text = String(it?.label || '').trim().toLowerCase()
    if (!text) continue
    if (seen.has(text)) { issues.push(`"${it.label}" is used twice — each word must be different.`); break }
    seen.add(text)
  }
  issues.push(...labelPlacementIssues(items))
  return issues
}

/**
 * The learner's box size, as fractions of the picture — mirrors `.lhx-lbl-slot`
 * in features/notes/reader/reader.css (`width: 22%; min-height: 5.6%`, centred
 * on the anchor by `translate(-50%, -50%)`). Change one, change the other.
 */
export const LEARNER_BOX = { w: 0.22, h: 0.056 }

/**
 * Where a box would land wrong for the learner. `pointToFraction` clamps a drag
 * that leaves the picture to the edge, so a box dropped just past it is saved
 * at x = 1 — and, being centred there, half of it hangs off the picture and it
 * can sit on top of a neighbour while pointing at nothing. That is how the
 * Grade 7 digestive-system diagram came to show "Rectum" on top of
 * "Pancreas". Advisory, like every message here: it names the box to move.
 */
export function labelPlacementIssues(items) {
  const issues = []
  const list = (Array.isArray(items) ? items : []).filter((it) =>
    Number.isFinite(Number(it?.x)) && Number.isFinite(Number(it?.y)))
  const name = (it) => String(it?.label || '').trim() || 'A box'
  const halfW = LEARNER_BOX.w / 2
  const halfH = LEARNER_BOX.h / 2
  const gap = (p, q) => Math.round(Math.abs(Number(p) - Number(q)) * 1000) / 1000
  for (const it of list) {
    const x = Number(it.x)
    const y = Number(it.y)
    if (x < halfW || x > 1 - halfW || y < halfH || y > 1 - halfH) {
      issues.push(`"${name(it)}" hangs off the edge of the picture — drag it back onto its line.`)
    }
  }
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]
      const b = list[j]
      // Anchors are stored to 3 decimals (clamp01), so compare at that grain
      // — 0.72 − 0.5 is 0.21999… in floating point, not 0.22.
      if (gap(a.x, b.x) < LEARNER_BOX.w && gap(a.y, b.y) < LEARNER_BOX.h) {
        issues.push(`"${name(a)}" and "${name(b)}" overlap — learners will not be able to tell them apart.`)
      }
    }
  }
  return issues
}

/** Reorder helper shared by every list editor: move item `i` by `dir` (−1/+1). */
export function moveInList(list, i, dir) {
  const j = i + dir
  if (!Array.isArray(list) || i < 0 || j < 0 || i >= list.length || j >= list.length) return list
  const next = list.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
