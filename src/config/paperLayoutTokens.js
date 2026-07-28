/**
 * The layout vocabulary every renderer of an assessment paper draws from.
 *
 * ## Why this exists
 *
 * A paper is drawn four times — the studio's paginated preview, the print
 * window, the PDF that comes out of it, and the Word export — and until this
 * module each of those carried its own numbers. The print stylesheet declared
 * 11.5pt body text; the preview CSS declared 12.5px; `assessmentToDocx` declared
 * 23 half-points. Three numbers for one decision, and nothing in the repo said
 * they were the same decision, so they drifted the way numbers do: silently, and
 * only visible once a teacher put the preview and the download side by side.
 *
 * So the paper's geometry and typography are declared ONCE, here, in
 * millimetres and points, and every renderer converts to the unit it happens to
 * speak. `assessmentDocument.js` resolves a token set per document and carries
 * it on the document, so a renderer never reads a literal.
 *
 * ## Millimetres are canonical, and that is not arbitrary
 *
 * Page size is a physical fact (A4 is 210×297mm), and the two consumers that
 * cannot be fudged — the `@page` rule and Word's section properties — both take
 * absolute units. CSS pixels are a rendering convenience derived from mm at
 * 96dpi, never the other way round. Deriving mm from px is where a third of a
 * millimetre goes missing per conversion, which is invisible per block and a
 * moved page boundary by the foot of a sheet.
 *
 * ## Back-compatibility with paperPageGeometry.js
 *
 * `paperPageGeometry.js` still owns the FOOTER's relationship to the page —
 * why the bottom margin is what it is, and why the reservation is split between
 * the `@page` rule and a running `<tfoot>`. That reasoning is load-bearing and
 * measured; it is not repeated here. This module imports those numbers as the
 * A4-portrait default so there is still one answer, and adds the axes the
 * geometry module never had: other page sizes, landscape, margin presets and
 * typography.
 */

import {
  PAGE_MM as A4_MM,
  PAGE_MARGINS_MM as DEFAULT_MARGINS_MM,
  PAGE_MARGIN_BOTTOM_MM,
  FOOTER_RESERVE_MM,
  RESERVED_BOTTOM_MM,
} from './paperPageGeometry.js'

/* ── Units ───────────────────────────────────────────────────────────────── */

/** CSS pixels per millimetre at the 96dpi the print stylesheet is authored in. */
export const PX_PER_MM = 96 / 25.4
/** PostScript points per millimetre. What `@page`, Word and PDF all speak. */
export const PT_PER_MM = 72 / 25.4
/** Twentieths of a point per millimetre — Word's internal unit. */
export const TWIP_PER_MM = 1440 / 25.4
/** English Metric Units per millimetre — what OOXML sizes drawings in. */
export const EMU_PER_MM = 36000

export const mmToPx = (mm) => (Number(mm) || 0) * PX_PER_MM
export const pxToMm = (px) => (Number(px) || 0) / PX_PER_MM
export const mmToPt = (mm) => (Number(mm) || 0) * PT_PER_MM
export const ptToMm = (pt) => (Number(pt) || 0) / PT_PER_MM
export const mmToTwip = (mm) => Math.round((Number(mm) || 0) * TWIP_PER_MM)
export const mmToEmu = (mm) => Math.round((Number(mm) || 0) * EMU_PER_MM)

/* ── Paper sizes ─────────────────────────────────────────────────────────── */

/**
 * The sheet sizes a Zambian school actually feeds a photocopier, in PORTRAIT
 * millimetres. Landscape is the same sheet turned, never a separate entry —
 * storing both would let a document declare "A4 landscape" in one field and
 * "A4" in another and be believed twice.
 */
export const PAGE_SIZES = Object.freeze({
  a4: Object.freeze({ id: 'a4', label: 'A4', width: A4_MM.width, height: A4_MM.height, cssSize: 'A4' }),
  a5: Object.freeze({ id: 'a5', label: 'A5', width: 148, height: 210, cssSize: 'A5' }),
  letter: Object.freeze({ id: 'letter', label: 'Letter', width: 215.9, height: 279.4, cssSize: 'Letter' }),
  legal: Object.freeze({ id: 'legal', label: 'Legal', width: 215.9, height: 355.6, cssSize: 'Legal' }),
})

export const DEFAULT_PAGE_SIZE = 'a4'
export const ORIENTATIONS = Object.freeze(['portrait', 'landscape'])
export const DEFAULT_ORIENTATION = 'portrait'

export function normalizePageSize(value) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '')
  return PAGE_SIZES[key] ? key : DEFAULT_PAGE_SIZE
}

export function normalizeOrientation(value) {
  const v = String(value || '').trim().toLowerCase()
  return v === 'landscape' ? 'landscape' : DEFAULT_ORIENTATION
}

/**
 * The sheet's dimensions once orientation is applied.
 *
 * Landscape swaps width and height; it does not scale anything. A renderer that
 * "handles landscape" by scaling a portrait layout produces a paper whose
 * typography is a different size from every other paper the school prints.
 */
export function pageDimensionsMm(pageSize = DEFAULT_PAGE_SIZE, orientation = DEFAULT_ORIENTATION) {
  const size = PAGE_SIZES[normalizePageSize(pageSize)]
  const landscape = normalizeOrientation(orientation) === 'landscape'
  return {
    width: landscape ? size.height : size.width,
    height: landscape ? size.width : size.height,
    label: size.label,
    cssSize: `${size.cssSize}${landscape ? ' landscape' : ''}`,
  }
}

/* ── Margins ─────────────────────────────────────────────────────────────── */

/**
 * Margin presets, in millimetres.
 *
 * `bottom` is deliberately absent from every preset: the page's bottom margin is
 * the footer's offset and nothing else, a relationship paperPageGeometry.js
 * derives and explains. A preset that declared its own bottom margin would be
 * the second answer to a question that already has one.
 */
export const MARGIN_PRESETS = Object.freeze({
  normal: Object.freeze({ id: 'normal', label: 'Normal', top: DEFAULT_MARGINS_MM.top, right: DEFAULT_MARGINS_MM.right, left: DEFAULT_MARGINS_MM.left }),
  narrow: Object.freeze({ id: 'narrow', label: 'Narrow', top: 12, right: 12, left: 12 }),
  wide: Object.freeze({ id: 'wide', label: 'Wide', top: 25, right: 25, left: 25 }),
})

export const DEFAULT_MARGIN_PRESET = 'normal'

/** The smallest margin a school photocopier reliably prints inside. */
export const MIN_MARGIN_MM = 8
/** Beyond this the column is too narrow to set a question in. */
export const MAX_MARGIN_MM = 40

const clampMargin = (value, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_MARGIN_MM, Math.max(MIN_MARGIN_MM, n))
}

/**
 * Resolve the margin set for a document.
 *
 * A preset name, or `custom` with explicit top/right/left. Anything out of range
 * is clamped rather than refused — a margin is a preference, and refusing to
 * render a saved paper because it carries 4mm would lose the teacher their work.
 */
export function resolveMarginsMm(margins) {
  if (margins && typeof margins === 'object' && !Array.isArray(margins)) {
    const preset = MARGIN_PRESETS[String(margins.preset || '').toLowerCase()]
    if (preset && margins.preset !== 'custom') {
      return { preset: preset.id, top: preset.top, right: preset.right, left: preset.left, bottom: PAGE_MARGIN_BOTTOM_MM }
    }
    const base = preset || MARGIN_PRESETS[DEFAULT_MARGIN_PRESET]
    return {
      preset: 'custom',
      top: clampMargin(margins.top, base.top),
      right: clampMargin(margins.right, base.right),
      left: clampMargin(margins.left, base.left),
      bottom: PAGE_MARGIN_BOTTOM_MM,
    }
  }
  const preset = MARGIN_PRESETS[String(margins || '').toLowerCase()] || MARGIN_PRESETS[DEFAULT_MARGIN_PRESET]
  return { preset: preset.id, top: preset.top, right: preset.right, left: preset.left, bottom: PAGE_MARGIN_BOTTOM_MM }
}

/* ── Typography ──────────────────────────────────────────────────────────── */

/**
 * The fonts a paper may be set in.
 *
 * Each entry names the CSS stack AND the single Word family, because Word does
 * not take a stack — it takes one name and substitutes silently if the machine
 * lacks it. Listing the Liberation metric-compatible clone in the CSS stack is
 * what keeps a Linux-rendered PDF the same length as a Windows-rendered one; the
 * Word family is the name Word will find on a Zambian school computer.
 */
export const FONT_FAMILIES = Object.freeze({
  serif: Object.freeze({
    id: 'serif',
    label: 'Times New Roman (serif)',
    css: "'Times New Roman', 'Liberation Serif', 'Nimbus Roman', serif",
    word: 'Times New Roman',
  }),
  sans: Object.freeze({
    id: 'sans',
    label: 'Arial (sans-serif)',
    css: "Arial, 'Liberation Sans', Helvetica, sans-serif",
    word: 'Arial',
  }),
  humanist: Object.freeze({
    id: 'humanist',
    label: 'Calibri',
    css: "Calibri, 'Carlito', 'Liberation Sans', sans-serif",
    word: 'Calibri',
  }),
})

export const DEFAULT_BODY_FONT = 'serif'
/** Headings are set in the sans face on every paper the studio has ever drawn. */
export const DEFAULT_HEADING_FONT = 'sans'

export function normalizeFontFamily(value, fallback = DEFAULT_BODY_FONT) {
  const key = String(value || '').trim().toLowerCase()
  return FONT_FAMILIES[key] ? key : fallback
}

/**
 * Named body sizes in points.
 *
 * Points, not pixels: this is the number that reaches `@page`-relative CSS, the
 * PDF and Word, and it is the number a teacher recognises from Word's own
 * toolbar. A "size 12 paper" means 12pt in every one of those places.
 */
export const BODY_SIZE_PT = Object.freeze({
  compact: 10.5,
  normal: 11.5,
  comfortable: 12.5,
  large: 14,
})

export const DEFAULT_BODY_SIZE = 'normal'
export const MIN_BODY_SIZE_PT = 8
export const MAX_BODY_SIZE_PT = 18

export function resolveBodySizePt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(MAX_BODY_SIZE_PT, Math.max(MIN_BODY_SIZE_PT, value))
  }
  const key = String(value || '').trim().toLowerCase()
  return BODY_SIZE_PT[key] ?? BODY_SIZE_PT[DEFAULT_BODY_SIZE]
}

/** Line spacing presets, as a multiple of the body size. */
export const LINE_SPACING = Object.freeze({ tight: 1.25, normal: 1.45, relaxed: 1.7, double: 2 })
export const DEFAULT_LINE_SPACING = 'normal'

export function resolveLineSpacing(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(3, Math.max(1, value))
  }
  const key = String(value || '').trim().toLowerCase()
  return LINE_SPACING[key] ?? LINE_SPACING[DEFAULT_LINE_SPACING]
}

/**
 * Vertical rhythm, in points, expressed relative to nothing — these are the
 * gaps the paper has always had, named so a renderer stops guessing them.
 */
export const SPACING_PT = Object.freeze({
  /** Between one question and the next. */
  question: 10,
  /** Between the stem and its first option. */
  stemToOptions: 4,
  /** Between one option and the next. */
  option: 2.5,
  /** Above a section heading. */
  sectionAbove: 16,
  /** Below a section heading, before its first question. */
  sectionBelow: 8,
  /** Around a figure. */
  figure: 8,
})

export const SPACING_SCALE = Object.freeze({ tight: 0.7, normal: 1, relaxed: 1.4 })
export const DEFAULT_SPACING_SCALE = 'normal'

export function resolveSpacingScale(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(2.5, Math.max(0.5, value))
  const key = String(value || '').trim().toLowerCase()
  return SPACING_SCALE[key] ?? SPACING_SCALE[DEFAULT_SPACING_SCALE]
}

/**
 * How far an answer option is indented from the question stem, in millimetres.
 *
 * Millimetres rather than "2em" because Word cannot express an em indent in a
 * paragraph property without also fixing the font size, and the whole point is
 * that the preview, the PDF and Word indent by the same physical distance.
 */
export const OPTION_INDENT_MM = Object.freeze({ none: 0, normal: 7, wide: 12 })
export const DEFAULT_OPTION_INDENT = 'normal'

export function resolveOptionIndentMm(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(30, Math.max(0, value))
  const key = String(value || '').trim().toLowerCase()
  return OPTION_INDENT_MM[key] ?? OPTION_INDENT_MM[DEFAULT_OPTION_INDENT]
}

/**
 * Heading and footer styles, as multiples of the body size.
 *
 * Relative so that a teacher who sets a Grade-2 paper in 14pt gets headings that
 * grow with it. An absolute heading size beside a configurable body size is how
 * a large-print paper ends up with a title smaller than its questions.
 */
export const HEADING_SCALE = Object.freeze({
  school: 1.17,
  title: 0.91,
  subject: 2.17,
  paperName: 0.96,
  section: 1.04,
})

export const FOOTER_STYLE = Object.freeze({
  sizePt: 9.5,
  italic: false,
  align: 'center',
})

/* ── Figures ─────────────────────────────────────────────────────────────── */

/**
 * Figure width presets, in millimetres of PRINTED width.
 *
 * Physical units because the same figure must occupy the same space on the sheet
 * in all three renderers, and only one of them thinks in pixels. `full` is
 * resolved against the live column width rather than fixed here — a "full width"
 * figure on a narrow-margin A5 paper is a different number of millimetres.
 */
export const FIGURE_WIDTH_PRESETS = Object.freeze({
  small: Object.freeze({ id: 'small', label: 'Small', widthMm: 45 }),
  medium: Object.freeze({ id: 'medium', label: 'Medium', widthMm: 75 }),
  large: Object.freeze({ id: 'large', label: 'Large', widthMm: 120 }),
  full: Object.freeze({ id: 'full', label: 'Full width', widthMm: null }),
})

export const DEFAULT_FIGURE_PRESET = 'medium'
/** A figure may never occupy more than this fraction of the page height. */
export const FIGURE_MAX_HEIGHT_FRACTION = 0.45
export const FIGURE_ALIGNMENTS = Object.freeze(['left', 'center', 'right'])

/* ── The resolved token set ──────────────────────────────────────────────── */

/**
 * Resolve every layout decision for one document, once.
 *
 * The result is carried on the AssessmentDocument and read by all four
 * renderers. Everything is present in every unit a renderer needs, computed
 * here, so no renderer converts and none of them can round differently.
 *
 * @param {object} layout the document's stored layout preferences (all optional)
 */
export function resolvePaperLayout(layout = {}) {
  const pageSize = normalizePageSize(layout.pageSize)
  const orientation = normalizeOrientation(layout.orientation)
  const page = pageDimensionsMm(pageSize, orientation)
  const margins = resolveMarginsMm(layout.margins ?? layout.marginPreset)

  const bodyFont = FONT_FAMILIES[normalizeFontFamily(layout.bodyFont, DEFAULT_BODY_FONT)]
  const headingFont = FONT_FAMILIES[normalizeFontFamily(layout.headingFont, DEFAULT_HEADING_FONT)]
  const bodySizePt = resolveBodySizePt(layout.bodySize)
  const lineSpacing = resolveLineSpacing(layout.lineSpacing)
  const spacingScale = resolveSpacingScale(layout.spacing)
  const optionIndentMm = resolveOptionIndentMm(layout.optionIndent)

  const contentWidthMm = page.width - margins.left - margins.right
  // The footer's reservation is subtracted from the usable height, exactly as
  // paperPageGeometry derives it: the running <tfoot> takes that height out of
  // the flow on every page, so body content never reaches it.
  const contentHeightMm = page.height - margins.top - PAGE_MARGIN_BOTTOM_MM - FOOTER_RESERVE_MM

  const spacing = Object.fromEntries(
    Object.entries(SPACING_PT).map(([key, pt]) => [key, Math.round(pt * spacingScale * 100) / 100]),
  )

  return Object.freeze({
    pageSize,
    orientation,
    page: Object.freeze({
      widthMm: page.width,
      heightMm: page.height,
      widthPx: mmToPx(page.width),
      heightPx: mmToPx(page.height),
      label: page.label,
      cssSize: page.cssSize,
    }),
    margins: Object.freeze({
      ...margins,
      topPx: mmToPx(margins.top),
      rightPx: mmToPx(margins.right),
      bottomPx: mmToPx(margins.bottom),
      leftPx: mmToPx(margins.left),
      /** The `@page` shorthand: top / right+left / bottom. */
      cssRule: `${margins.top}mm ${margins.right}mm ${margins.bottom}mm`,
    }),
    content: Object.freeze({
      widthMm: contentWidthMm,
      heightMm: contentHeightMm,
      widthPx: mmToPx(contentWidthMm),
      heightPx: mmToPx(contentHeightMm),
      /** The band at the foot of every sheet body content may not enter. */
      reservedBottomMm: RESERVED_BOTTOM_MM,
      footerReserveMm: FOOTER_RESERVE_MM,
    }),
    typography: Object.freeze({
      bodyFont: bodyFont.id,
      bodyFontCss: bodyFont.css,
      bodyFontWord: bodyFont.word,
      headingFont: headingFont.id,
      headingFontCss: headingFont.css,
      headingFontWord: headingFont.word,
      bodySizePt,
      /** Word measures type in half-points. */
      bodySizeHalfPt: Math.round(bodySizePt * 2),
      lineSpacing,
      /** Word's line rule, in twentieths of a point of a 240-twip line. */
      lineSpacingTwip: Math.round(lineSpacing * 240),
      headingSizePt: Object.freeze(Object.fromEntries(
        Object.entries(HEADING_SCALE).map(([k, scale]) => [k, Math.round(bodySizePt * scale * 10) / 10]),
      )),
      footer: FOOTER_STYLE,
    }),
    spacing: Object.freeze({ ...spacing, scale: spacingScale }),
    optionIndentMm,
    optionIndentPx: mmToPx(optionIndentMm),
    figure: Object.freeze({
      maxHeightMm: Math.round(page.height * FIGURE_MAX_HEIGHT_FRACTION * 10) / 10,
      fullWidthMm: contentWidthMm,
    }),
  })
}

/** The token set a document with no stored preferences gets. */
export const DEFAULT_PAPER_LAYOUT = resolvePaperLayout({})
