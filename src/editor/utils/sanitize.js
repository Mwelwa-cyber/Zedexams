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
  // Accept both attribute names so Tiptap JSON that round-trips through
  // generateHTML survives regardless of which serialiser wrote it.
  'data-latex',
  'data-math-latex',
  'data-display',
  'class',
  // Inline style is narrowed upstream to text-align / color / background-color
  // by cleanStyleAttribute — DOMPurify just has to permit the attribute to
  // reach that stage without being stripped.
  'style',
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
  // Keep in sync with ALLOWED_TAGS in src/utils/quizRichText.js — otherwise
  // headings pass the upstream DOM walker only to be stripped here on the
  // final defensive pass, which is exactly the "past papers flatten after
  // editing" bug.
  'h1', 'h2', 'h3',
  'blockquote',
]

const QUIZ_RICH_ALLOWED_ATTR = [
  'class',
  'style',           // already narrowed upstream to text-align / color / background-color
  'data-latex',
  // Defensive: a math span from the Tiptap editor may still carry
  // `data-math-latex` if it ever skips the normaliser. Upstream logic now
  // rewrites it to `data-latex`, but we keep this on the allow-list so a
  // leaked attribute doesn't drop the entire math node's attributes.
  'data-math-latex',
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

/* ────────────────────────────────────────────────────────────────────────────
 * Notes Studio output (learner-facing renderer)
 *
 * Used by:
 *   • src/features/notes/pages/LearnerNoteRead.jsx
 *
 * Notes share the Tiptap editor pipeline (so the editor allow-list applies)
 * but additionally permit inline `<img>` nodes inserted by the admin via the
 * NoteEditor image-upload toolbar (Tiptap @tiptap/extension-image, configured
 * with allowBase64:false so srcs are always Firebase Storage URLs). Also
 * permits `<hr>` from StarterKit's HorizontalRule.
 * ──────────────────────────────────────────────────────────────────────────── */

const NOTE_ALLOWED_TAGS = [
  ...EDITOR_ALLOWED_TAGS,
  'img',
  'hr',
]

const NOTE_ALLOWED_ATTR = [
  ...EDITOR_ALLOWED_ATTR,
  'src',
  'alt',
]

export function sanitizeNoteHTML(html) {
  if (!html || typeof html !== 'string') return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: NOTE_ALLOWED_TAGS,
    ALLOWED_ATTR: NOTE_ALLOWED_ATTR,
    // DOMPurify defaults reject javascript:, vbscript:, and other unsafe
    // schemes on src/href, so http(s):, mailto:, tel:, and relative URLs
    // are accepted while inline-script vectors are blocked.
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
    FORCE_BODY: false,
  })
}
