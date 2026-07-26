/**
 * The printed page's geometry — margins, and the band the footer lives in.
 *
 * This exists because a bare CSS literal cost a sheet of paper per learner. The
 * page rule said `margin: 20mm 18mm 16mm` and the paper code sat in normal flow
 * with an 18pt top margin, so on a paper that filled the page the code — and
 * nothing else — was pushed onto a second sheet. Measured on vr-005: 21.7mm free
 * below the last ink, 16mm of it bottom margin, leaving 5.7mm usable against the
 * ~10.4mm the footer wanted. It missed by 4.7mm and cost a whole page.
 *
 * Trimming the margin would have bought about 6mm and left 0.3mm of headroom,
 * which is not a fix — it is the same failure waiting for a paper one line
 * longer. So the footer is taken OUT of flow in print, into a band reserved for
 * it, and it can no longer create a page under any content length.
 *
 * ## The relationship is stated, not assumed
 *
 *     reserved bottom margin = footer offset + footer line height + clearance
 *
 * Every one of those is a number here rather than a constant in a stylesheet,
 * because the reservation and the position have to move together. Reserve less
 * than the footer occupies and body text prints on top of the paper code; more,
 * and every paper wastes space at the foot of every page.
 *
 * `RESERVED_BOTTOM_MM` deliberately equals the bottom margin the page rule
 * already used, so the body's usable area does not change: the space vr-005
 * needed is recovered purely by the footer leaving the flow, and other papers
 * paginate exactly as they did.
 */

/** A4, in millimetres. */
export const PAGE_MM = Object.freeze({ width: 210, height: 297 })

/** Body margins. `bottom` is derived below, so it is not written here. */
export const PAGE_MARGINS_MM = Object.freeze({ top: 20, right: 18, left: 18 })

/**
 * The footer band.
 *
 * `offset` is from the sheet's bottom edge to the bottom of the footer line;
 * `lineHeight` is the line itself at 9.5pt; `clearance` is the minimum gap
 * between the last body content and the top of the footer, so the two can never
 * touch even when the body fills its column exactly.
 */
export const FOOTER_MM = Object.freeze({
  offset: 5,
  lineHeight: 4,
  clearance: 7,
})

/**
 * What the page rule must reserve at the bottom.
 *
 * Derived, so a change to the footer cannot silently stop being accounted for.
 */
export const RESERVED_BOTTOM_MM = FOOTER_MM.offset + FOOTER_MM.lineHeight + FOOTER_MM.clearance

/** The full margin set, with the derived bottom. */
export const PAGE_MARGINS_WITH_FOOTER_MM = Object.freeze({
  ...PAGE_MARGINS_MM,
  bottom: RESERVED_BOTTOM_MM,
})

/** The `@page` margin shorthand, top / right+left / bottom. */
export function pageMarginRule() {
  const m = PAGE_MARGINS_WITH_FOOTER_MM
  return `${m.top}mm ${m.right}mm ${m.bottom}mm`
}

/**
 * The band a footer may draw in, as a fraction of the page height from the top.
 *
 * Returned as fractions because the renderers measure in device pixels at
 * whatever dpi they were given, and the one thing they agree on is the page.
 */
export function footerBand({ pageHeightMm = PAGE_MM.height } = {}) {
  // The footer's bottom edge sits at the PAGE AREA's bottom, not the sheet's.
  //
  // A fixed element in paged media is positioned against the page area — the box
  // inside the margins. Trying to reach the margin band with a negative offset
  // was measured and rejected: Chromium treats the overflow as content and grows
  // the document, which produced the very extra page this fix removes.
  const areaBottom = pageHeightMm - RESERVED_BOTTOM_MM
  return {
    top: (areaBottom - FOOTER_MM.lineHeight) / pageHeightMm,
    bottom: areaBottom / pageHeightMm,
  }
}

/**
 * The band body content may draw in.
 *
 * `clearance` is a TARGET, not a guarantee, and the difference is worth stating
 * because it was measured rather than assumed. Chromium has no @page margin
 * boxes, and a fixed element positioned past the page area makes it grow the
 * document by a page — so the footer must live inside the page area, which is
 * the same box the body flows through. Body content therefore CAN enter the
 * clearance strip, and on a full page it does.
 *
 * What is guaranteed is what matters: the footer is out of flow, so it can never
 * lengthen the document, and nothing prints below it. The clearance is verified
 * by the gate (footerBand.test.js) rather than enforced by CSS — a real
 * intrusion into the footer's own box shows up as that page's footer band
 * carrying more ink than every other page's.
 */
export function bodyBand({ pageHeightMm = PAGE_MM.height } = {}) {
  const footer = footerBand({ pageHeightMm })
  return {
    top: 0,
    // Stops a full clearance above the footer, so the two can never touch.
    bottom: footer.top - (FOOTER_MM.clearance / pageHeightMm),
  }
}
