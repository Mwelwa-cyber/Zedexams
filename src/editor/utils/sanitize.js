import DOMPurify from 'dompurify'

/* ────────────────────────────────────────────────────────────────────────────
 * Editor (Tiptap) output
 *
 * Used by:
 *   • src/editor/utils/safeRender.js
 *   • src/editor/utils/migration.js
 *
 * Produces content with `data-math-latex` on inline math nodes.
 * ──────────────────────────────────────────────────────────────────────────── */

const EDITOR_ALLOWED_TAGS = [
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3',
  'blockquote',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'span', 'sup', 'sub', 'code',
]

const EDITOR_ALLOWED_ATTR = [
  'colspan', 'rowspan',
  'data-math-latex',
  'class',
]

export function sanitizeHTML(html) {
  if (!html || typeof html !== 'string') return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: EDITOR_ALLOWED_TAGS,
    ALLOWED_ATTR: EDITOR_ALLOWED_ATTR,
    KEEP_CONTENT: true,
    FORCE_BODY: false,
  })
}

export function sanitizePastedHTML(html) {
  return sanitizeHTML(html)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Quiz rich-text output
 *
 * Used by:
 *   • src/utils/quizRichText.js — the renderer for quiz questions, passages,
 *     and answer options. Runs AFTER the module's own `normalizeSanitizedHtml`
 *     pass, which has already canonicalised tag aliases (B→strong, etc.),
 *     locked classes down to `.mnode` / `.etable`, and whitelisted the style
 *     attribute to `text-align`, `color`, `background-color`. DOMPurify is
 *     the final defensive pass: if anything upstream ever leaks a tag or
 *     attribute we didn't expect, DOMPurify catches it.
 *
 * Content shapes we need to keep intact
 *   • Inline math:  <span class="mnode" data-latex="…" data-display="…">…</span>
 *   • Tables:       <table class="etable">…<td colspan rowspan>…</table>
 *   • Paragraph align: style="text-align:left|center|right"
 *   • Color/background: style="color:…; background-color:…"
 * ──────────────────────────────────────────────────────────────────────────── */

const QUIZ_RICH_ALLOWED_TAGS = [
  'p', 'div', 'br',
  'strong', 'em', 'u', 's',
  'sub', 'sup',
  'ul', 'ol', 'li',
  'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

const QUIZ_RICH_ALLOWED_ATTR = [
  'class',
  'style',           // already narrowed upstream to text-align / color / background-color
  'data-latex',
  'data-display',
  'colspan', 'rowspan',
]

export function sanitizeQuizRichHTML(html) {
  if (!html || typeof html !== 'string') return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: QUIZ_RICH_ALLOWED_TAGS,
    ALLOWED_ATTR: QUIZ_RICH_ALLOWED_ATTR,
    // Only allow the two data-* attributes listed above, not every data-* key.
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
    FORCE_BODY: false,
  })
}
