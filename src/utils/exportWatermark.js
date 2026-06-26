/**
 * Diagonal "free plan" watermark for the HTML-based PDF exports
 * (lesson plan, class timetable). Mirrors the DOCX watermark in
 * docxAttribution.js so a free-plan teacher's downloads carry the same
 * ZedExams attribution whichever format they pick.
 *
 * The watermark is a tiled, semi-transparent SVG painted as a repeating
 * body background-image. A tiled background survives both render paths:
 *   - the real-PDF path (htmlToPdf.js → html2canvas), where the tall body
 *     canvas is sliced into A4 pages — every slice keeps its share of the
 *     tiles, so the mark lands on every page; and
 *   - the print fallback (window.print), which honours the same CSS.
 * Painting it as background-image (not the `background` shorthand) keeps the
 * page's white background-color, so the mark shows through the gaps behind
 * the body text rather than over an opaque fill.
 *
 * Pure string helpers, no DOM — safe to unit-test under plain node.
 */

// Shared brand text; matches WATERMARK_TEXT in docxAttribution.js.
export const WATERMARK_TEXT = 'ZedExams.com'

const escapeXml = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * One diagonal watermark tile as an SVG data URI. Pale gray text rotated
 * -30°, faint enough not to fight the content but plainly visible.
 */
export function buildWatermarkSvgDataUri(text = WATERMARK_TEXT) {
  const label = escapeXml(text)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">` +
    `<text x="160" y="100" transform="rotate(-30 160 100)" text-anchor="middle" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" ` +
    `fill="#000000" fill-opacity="0.07">${label}</text></svg>`
  // encodeURIComponent keeps the data URI valid inside a CSS url("...") with
  // no quoting surprises across browsers and html2canvas.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * The CSS that paints the repeating watermark on the page body. Wins over an
 * earlier `background:#fff` because it sets only `background-image` (the white
 * background-color stays) and is injected after the document's own styles.
 */
export function watermarkBodyCss(text = WATERMARK_TEXT) {
  return (
    `body{background-image:url("${buildWatermarkSvgDataUri(text)}");` +
    `background-repeat:repeat;background-position:top left;}`
  )
}

/**
 * Inject the watermark style into a full HTML document string. No-op when
 * `text` is falsy, so callers can pass the free-plan flag straight through.
 * The <style> is placed last (before </head>, else at the start of <body>,
 * else appended) so it overrides the document's own body background.
 */
export function injectHtmlWatermark(html, text = WATERMARK_TEXT) {
  if (!text || typeof html !== 'string') return html
  const style = `<style>${watermarkBodyCss(text)}</style>`
  if (html.includes('</head>')) return html.replace('</head>', `${style}</head>`)
  if (/<body[^>]*>/i.test(html)) return html.replace(/(<body[^>]*>)/i, `$1${style}`)
  return html + style
}
