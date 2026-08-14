/**
 * matchLibraryShape — map a detected figure (from the paper importer) onto a
 * ZedExams Diagram Library shape so it can become a TRUE editable vector object
 * ({ libraryKey, params }) rendered by DiagramSvg, rather than a photo.
 *
 * This backs the "Convert to editable SVG" diagram-handling option. It is
 * deliberately conservative: it only claims a match when the detected figure's
 * kind/caption clearly names a catalogue shape (triangle, cylinder, number line,
 * clock, …). Anything it can't confidently place returns null, and the caller
 * falls back to keeping/redrawing the original — we never fake a vector shape
 * that misrepresents the paper.
 *
 * Pure + dependency-light (only reads DIAGRAM_CATALOG keys) so it unit-tests
 * under plain `node`.
 */

import { DIAGRAM_CATALOG } from '../../../curriculum/diagrams/diagramCatalog.js'

// Keyword → libraryKey. Ordered longest/most-specific first at match time.
// Only keys present in DIAGRAM_CATALOG are used (guarded below).
const KEYWORD_TO_KEY = [
  ['right angled triangle', 'righttriangle'],
  ['right-angled triangle', 'righttriangle'],
  ['right triangle', 'righttriangle'],
  ['number line', 'numberline'],
  ['coordinate grid', 'coordgrid'],
  ['coordinate plane', 'coordgrid'],
  ['cartesian', 'coordgrid'],
  ['fraction bar', 'fractionbar'],
  ['fraction wall', 'fractionbar'],
  ['clock face', 'clockface'],
  ['clock', 'clockface'],
  ['protractor', 'protractor'],
  ['parallelogram', 'parallelogram'],
  ['trapezium', 'trapezium'],
  ['trapezoid', 'trapezium'],
  ['rectangle', 'rectangle'],
  ['triangle', 'triangle'],
  ['square', 'square'],
  ['rhombus', 'rhombus'],
  ['pentagon', 'pentagon'],
  ['hexagon', 'hexagon'],
  ['circle', 'circle'],
  ['angle', 'angle'],
  ['cuboid', 'cuboid'],
  ['cube', 'cube'],
  ['cylinder', 'cylinder'],
  ['cone', 'cone'],
  ['sphere', 'sphere'],
]

// Detected `kind` values (from the vision taxonomy) that map straight to a key.
const KIND_TO_KEY = {
  number_line: 'numberline',
}

function haystack(detected = {}) {
  const parts = [
    detected.kind,
    detected.caption,
    ...(Array.isArray(detected.labels)
      ? detected.labels.map((l) => (l && typeof l === 'object' ? l.text : l))
      : []),
    ...(Array.isArray(detected.elements) ? detected.elements : []),
  ]
  return parts
    .map((p) => String(p == null ? '' : p).toLowerCase())
    .join(' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Return { libraryKey, params } for a detected figure that clearly names a
 * catalogue shape, or null when it doesn't. `params` is left empty so the
 * renderer uses the shape's sensible defaults; the teacher edits labels in the
 * studio afterwards.
 *
 * @param {object} detected { kind, caption, labels, elements }
 */
export function matchLibraryShape(detected = {}) {
  const kind = String(detected.kind || '').toLowerCase().replace(/[\s-]+/g, '_')
  // Only "simple"/shape-like figures are candidates — a labelled science
  // drawing or a map must never be replaced by a generic vector shape.
  if (KIND_TO_KEY[kind] && DIAGRAM_CATALOG[KIND_TO_KEY[kind]]) {
    return { libraryKey: KIND_TO_KEY[kind], params: {} }
  }

  const text = haystack(detected)
  if (!text) return null
  for (const [word, key] of KEYWORD_TO_KEY) {
    if (text.includes(word) && DIAGRAM_CATALOG[key]) {
      return { libraryKey: key, params: {} }
    }
  }
  return null
}

/** True when a detected figure can be converted to an editable library shape. */
export function canConvertToSvg(detected) {
  return matchLibraryShape(detected) != null
}
