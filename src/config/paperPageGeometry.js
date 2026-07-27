/**
 * The printed page's geometry — margins, the band the footer lives in, and the
 * band body content is allowed to reach.
 *
 * This exists because a bare CSS literal cost a sheet of paper per learner, and
 * then because fixing that left a second, quieter defect behind.
 *
 * ## First defect: the paper code cost a page
 *
 * The page rule said `margin: 20mm 18mm 16mm` and the paper code sat in normal
 * flow with an 18pt top margin, so on a paper that filled the page the code —
 * and nothing else — was pushed onto a second sheet. Measured on vr-005: 21.7mm
 * free below the last ink, 16mm of it bottom margin, leaving 5.7mm usable
 * against the ~10.4mm the footer wanted. It missed by 4.7mm and cost a whole
 * page. Taking the footer out of flow fixed it: out of flow it cannot lengthen
 * the document, and because a fixed element repeats in paged media the code now
 * prints on every sheet, which is what a paper code is for.
 *
 * ## Second defect: nothing kept the body out of the footer's box
 *
 * Out of flow is not the same as out of the way. A fixed element's containing
 * block in paged media is the PAGE AREA — the box inside the margins — which is
 * the same box body text flows through. So the footer stopped creating pages and
 * started being printed on: vr-006 page 3 carried 0.09311 ink in the footer band
 * against 0.03154 on every other page, an answer line straight through the paper
 * code. A learner's answer line, question text or diagram must never occupy the
 * paper-code box.
 *
 * Two placements were measured and rejected before the one below:
 *
 *  - a NEGATIVE offset, to reach the margin band beneath the page area.
 *    Chromium treats the overflow as content and grows the document — vr-005
 *    went straight back to two pages and the footer vanished from every sheet.
 *  - `body { display: table }` with a `table-footer-group` spacer. It reserves
 *    on the LAST page only: body ink reached 287mm with the footer at 289mm.
 *
 * What works is a real `<tfoot>` on a real table wrapping the paper. Chromium
 * repeats it on every page and RESERVES its height in the flow, so the body
 * physically cannot enter the strip below it.
 *
 * ## The relationship is stated, not assumed
 *
 *     complete reserved zone = footer offset + footer line height + clearance
 *
 * and it is split between the two mechanisms that can each enforce their half:
 *
 *     @page margin-bottom  = footer offset                  (the sheet's margin)
 *     in-flow reservation  = footer line height + clearance (the <tfoot> row)
 *
 * Every one of those is a number here rather than a constant in a stylesheet,
 * because the reservation and the position have to move together. Reserve less
 * than the footer occupies and body text prints on top of the paper code; more,
 * and every paper wastes space at the foot of every page.
 *
 * The complete zone is still 16mm — the same total the page rule reserved
 * before — so the body's usable bottom is unchanged and papers paginate exactly
 * as they did. What changed is that the strip is now physically empty rather
 * than merely intended to be.
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
 * The page's own bottom margin — and nothing more.
 *
 * Only the footer's offset belongs here. The page margin is the one part of the
 * reservation a fixed footer must NOT be pushed out of: it is positioned against
 * the page area, so whatever the margin excludes, the footer is excluded from
 * too. Everything above the footer line is reserved by the other mechanism.
 */
export const PAGE_MARGIN_BOTTOM_MM = FOOTER_MM.offset

/**
 * What must be reserved IN THE FLOW, on every page, by the running `<tfoot>`.
 *
 * The footer's own line plus the clearance above it. This is the half of the
 * reservation the page margin cannot express, because the footer has to be
 * inside the page area to be drawn at all.
 */
export const FOOTER_RESERVE_MM = FOOTER_MM.lineHeight + FOOTER_MM.clearance

/**
 * The complete zone at the foot of every sheet that body content may not enter.
 *
 * Derived, so a change to the footer cannot silently stop being accounted for,
 * and equal to the two halves above added back together.
 */
export const RESERVED_BOTTOM_MM = PAGE_MARGIN_BOTTOM_MM + FOOTER_RESERVE_MM

/** The full margin set, with the derived bottom. */
export const PAGE_MARGINS_WITH_FOOTER_MM = Object.freeze({
  ...PAGE_MARGINS_MM,
  bottom: PAGE_MARGIN_BOTTOM_MM,
})

/** The `@page` margin shorthand, top / right+left / bottom. */
export function pageMarginRule() {
  const m = PAGE_MARGINS_WITH_FOOTER_MM
  return `${m.top}mm ${m.right}mm ${m.bottom}mm`
}

/**
 * The band the footer draws in, as a fraction of the page height from the top.
 *
 * Returned as fractions because the renderers measure in device pixels at
 * whatever dpi they were given, and the one thing they agree on is the page.
 */
export function footerBand({ pageHeightMm = PAGE_MM.height } = {}) {
  // The footer's bottom edge sits `offset` above the sheet's bottom edge, which
  // is also the bottom of the page area — the box a fixed element is positioned
  // against. Those two coincide by construction: the page's bottom margin IS the
  // offset, which is what makes `bottom: 0` land the footer where it is declared
  // to be rather than wherever the margin happened to leave it.
  const bottom = pageHeightMm - PAGE_MARGIN_BOTTOM_MM
  return {
    top: (bottom - FOOTER_MM.lineHeight) / pageHeightMm,
    bottom: bottom / pageHeightMm,
  }
}

/**
 * The band body content may draw in.
 *
 * This is a GUARANTEE now, not a target, and the difference is the whole point
 * of the change that introduced the running reservation. Previously the footer
 * shared the page area with the body and the clearance was something the layout
 * hoped for; a full page simply printed through it. The `<tfoot>` reserves its
 * height on every page, so the body's last possible line ends here.
 *
 * Still verified rather than trusted — `footerBand.test.js` measures real
 * renders — because a CSS rule that stops being honoured looks exactly like one
 * that is.
 */
export function bodyBand({ pageHeightMm = PAGE_MM.height } = {}) {
  return {
    top: 0,
    bottom: (pageHeightMm - RESERVED_BOTTOM_MM) / pageHeightMm,
  }
}
