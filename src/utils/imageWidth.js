// Image width presets for inserted question/diagram media.
//
// A teacher can resize an inserted image to one of a few friendly presets
// instead of fiddling with exact pixels. The preset is stored on the
// question as `imageWidth` (a string key) and resolved to a percentage of
// the available content width by the studio preview AND the PDF / DOCX
// exporters, so a resized image looks the same in the editor, the saved
// draft, the printed paper, and the downloaded file.
//
// Pure, dependency-free, and browser-agnostic on purpose: the exporters and
// the Node test suite both import it without pulling in any canvas code.

export const IMAGE_WIDTH_OPTIONS = [
  { key: 'small', label: 'Small', percent: 33 },
  { key: 'medium', label: 'Medium', percent: 50 },
  { key: 'large', label: 'Large', percent: 75 },
  { key: 'full', label: 'Full width', percent: 100 },
]

export const DEFAULT_IMAGE_WIDTH = 'full'

const PERCENT_BY_KEY = IMAGE_WIDTH_OPTIONS.reduce((acc, o) => {
  acc[o.key] = o.percent
  return acc
}, {})

/**
 * Resolve a stored width preset (or a raw percentage) to a percentage of the
 * available width, clamped to 10–100. Unknown / empty values fall back to
 * full width so older drafts (saved before this field existed) render at
 * their original size.
 */
export function resolveImageWidthPercent(value, fallback = DEFAULT_IMAGE_WIDTH) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(100, Math.max(10, Math.round(value)))
  }
  const key = String(value || '').toLowerCase().trim()
  if (key in PERCENT_BY_KEY) return PERCENT_BY_KEY[key]
  if (fallback in PERCENT_BY_KEY) return PERCENT_BY_KEY[fallback]
  return 100
}

/**
 * Normalise an arbitrary value to a known preset key, defaulting to full.
 * Used on save/load so the persisted field is always one of the known keys.
 */
export function normaliseImageWidth(value, fallback = DEFAULT_IMAGE_WIDTH) {
  const key = String(value || '').toLowerCase().trim()
  if (key in PERCENT_BY_KEY) return key
  return fallback
}
