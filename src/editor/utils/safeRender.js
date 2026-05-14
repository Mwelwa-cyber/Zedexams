/**
 * src/editor/utils/safeRender.js
 *
 * Safe HTML generation from Tiptap JSON for the learner view.
 *
 * NEVER use dangerouslySetInnerHTML with raw DB content.
 * ALWAYS go through this module.
 *
 * Pipeline:
 *   1. Accept Tiptap JSON (preferred) or legacy string (backward compat)
 *   2. generateHTML(json, extensions) → controlled HTML output
 *      (only tags allowed by the extension list can appear)
 *   3. DOMPurify.sanitize() → defence-in-depth XSS protection
 *   4. Return safe HTML string → pass to dangerouslySetInnerHTML
 *
 * Additionally, this module exports hydrateKatex() which must be called
 * after the HTML is mounted in the DOM to render math nodes visually.
 */

import { generateHTML } from '@tiptap/core'
import katex from 'katex'
import { buildVerticalArithmeticInner, decodeLines } from '../extensions/VerticalArithmetic.js'
import { buildFractionInner } from '../extensions/MathFraction.js'
import { buildNumberBaseInner } from '../extensions/NumberBase.js'
// mhchem — chemistry formula extension for KaTeX. Side-effect import:
// registers \ce{} / \pu{} commands on the global katex instance so a
// Chemistry question with `\ce{H_2SO_4}` or `\ce{2H_2 + O_2 -> 2H_2O}`
// renders correctly. Must be imported before any katex.render() call;
// every renderer (this file, MathInline.js, MathModal.jsx) imports it.
import 'katex/contrib/mhchem'
import { renderExtensions } from '../extensions/buildExtensions.js'
import { sanitizeHTML } from './sanitize.js'
import { isTiptapJSON } from './migration.js'
// KaTeX stylesheet — only pulled in inside a browser. Vite intercepts the
// dynamic CSS import at build time and inlines the styles; under a plain
// `node` test runner there's no window, the import never fires, and the
// `.css` file no longer trips Node's ESM loader.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line promise/catch-or-return -- fire-and-forget
  import('katex/dist/katex.min.css').catch(() => {})
}

/**
 * Convert Tiptap JSON (or legacy HTML/text string) to a safe HTML string.
 *
 * Use the return value in:
 *   <div dangerouslySetInnerHTML={{ __html: toHTML(json) }} />
 *
 * Then call hydrateKatex(containerRef.current) after the DOM mounts
 * to render the math visually.
 *
 * @param {object|string|null} content  Tiptap JSON object or legacy string
 * @returns {string}                    Safe HTML string, or '' if empty
 */
export function toHTML(content) {
  if (!content) return ''

  // Legacy string content (old records not yet migrated)
  if (typeof content === 'string') {
    return sanitizeHTML(content)
  }

  // Tiptap JSON
  if (isTiptapJSON(content)) {
    try {
      const raw = generateHTML(content, renderExtensions)
      return sanitizeHTML(raw)
    } catch (err) {
      console.error('[safeRender] generateHTML failed:', err)
      return ''
    }
  }

  // Unknown format — stringify and sanitize
  console.warn('[safeRender] Unknown content format:', typeof content)
  return sanitizeHTML(String(content))
}

/**
 * Hydrate all math nodes inside a mounted DOM container.
 *
 * After toHTML() produces HTML and you render it into the DOM, the
 * math nodes are plain <span data-math-latex="..."> elements with text
 * fallback. Call this to render them visually with KaTeX.
 *
 * Usage (React):
 *   const containerRef = useRef(null)
 *   useEffect(() => {
 *     if (containerRef.current) hydrateKatex(containerRef.current)
 *   }, [html])
 *
 *   <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />
 *
 * @param {HTMLElement} container  The DOM element containing the HTML
 */
export function hydrateKatex(container) {
  if (!container) return
  // Match every shape a math span could have in stored HTML:
  //   - Canonical: <span class="mnode" data-latex="…">
  //   - Legacy Tiptap: <span class="mnode" data-math-latex="…">
  //   - Class-only fallback (some old imports dropped the attribute)
  const nodes = container.querySelectorAll(
    'span[data-latex], span[data-math-latex], span.mnode'
  )
  nodes.forEach((span) => {
    // Skip if already hydrated (has a .katex child)
    if (span.querySelector('.katex')) return
    const latex =
      span.getAttribute('data-latex') ||
      span.getAttribute('data-math-latex') ||
      ''
    if (!latex) return
    try {
      katex.render(latex, span, { throwOnError: false, displayMode: false })
    } catch {
      // Leave the span empty rather than leaking raw LaTeX as visible text.
      span.textContent = ''
    }
  })

  // Hydrate Grade-7 math blocks. These stored as empty wrappers with
  // data-* attributes only — the inner DOM is rebuilt here so the
  // serialised HTML stays minimal and exports never drift.
  hydrateVerticalArithmetic(container)
  hydrateFractions(container)
  hydrateNumberBases(container)
}

export function hydrateVerticalArithmetic(container) {
  if (!container) return
  const blocks = container.querySelectorAll(
    'div[data-vertical-arithmetic], div.vert-arith'
  )
  blocks.forEach((el) => {
    if (el.querySelector('.va-row')) return
    const attrs = {
      operator: el.getAttribute('data-operator') || '+',
      lines: decodeLines(el.getAttribute('data-lines')),
      answer: el.getAttribute('data-answer') || '',
      working: el.getAttribute('data-working') === 'true',
    }
    el.innerHTML = buildVerticalArithmeticInner(attrs)
  })
}

export function hydrateFractions(container) {
  if (!container) return
  const fracs = container.querySelectorAll(
    'span[data-math-fraction], span.math-frac'
  )
  fracs.forEach((el) => {
    if (el.querySelector('.math-frac-stack')) return
    const attrs = {
      whole: el.getAttribute('data-whole') || '',
      num: el.getAttribute('data-num') || el.getAttribute('data-numerator') || '',
      den: el.getAttribute('data-den') || el.getAttribute('data-denominator') || '',
    }
    el.innerHTML = buildFractionInner(attrs)
  })
}

export function hydrateNumberBases(container) {
  if (!container) return
  const items = container.querySelectorAll(
    'span[data-number-base], span.num-base'
  )
  items.forEach((el) => {
    if (el.querySelector('.num-base-sub')) return
    const attrs = {
      number: el.getAttribute('data-number') || '',
      base: el.getAttribute('data-base') || '',
    }
    el.innerHTML = buildNumberBaseInner(attrs)
  })
}

/**
 * Convenience: hydrate KaTeX + every Grade-7 math block in one call.
 * Use this wherever sanitised HTML is mounted (learner viewer, PDF
 * print window, RichContent component) so the same rebuild runs in
 * every renderer.
 */
export function hydrateMathContent(container) {
  hydrateKatex(container)
}

/**
 * Convert any rich-text value (Tiptap JSON, JSON-string, or HTML) into
 * "paper HTML" — sanitised HTML with the inner structure of every
 * Grade-7 math block already baked in.
 *
 * This is what the PDF and DOCX exports consume: the print window
 * doesn't run JS, so the vertical-arithmetic columns, stacked
 * fractions, and number-base subscripts must be in the HTML before it
 * lands in the printable document.
 *
 * KaTeX math nodes are NOT pre-rendered here (KaTeX itself needs JS to
 * produce its DOM). They appear as `<span class="mnode" data-latex="…">`
 * exactly as today.
 *
 * @param {object|string|null} value  Tiptap JSON, JSON-string, or HTML
 * @returns {string}                  Hydrated HTML, or '' if empty
 */
export function richTextToPaperHtml(value) {
  if (!value) return ''

  // Normalise to HTML via the existing pipeline.
  const baseHtml = (() => {
    if (typeof value === 'object' && value && value.type === 'doc') {
      return toHTML(value)
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed?.type === 'doc') return toHTML(parsed)
        } catch { /* fall through */ }
      }
      return toHTML(value)
    }
    return ''
  })()

  if (!baseHtml) return ''

  // Inflate the Grade-7 math wrappers. Browser-only: every export
  // pipeline that calls this runs in the browser (window.print,
  // docx library), so DOMParser is always available.
  if (typeof DOMParser === 'undefined') return baseHtml

  try {
    const doc = new DOMParser().parseFromString(`<body>${baseHtml}</body>`, 'text/html')
    hydrateVerticalArithmetic(doc.body)
    hydrateFractions(doc.body)
    hydrateNumberBases(doc.body)
    return doc.body.innerHTML
  } catch {
    return baseHtml
  }
}
