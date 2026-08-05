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
import {
  buildVerticalArithmeticInner,
  VERTICAL_ARITHMETIC_SELECTOR, readVerticalArithmeticAttrs,
} from '../extensions/VerticalArithmetic.js'
import { buildFractionInner, FRACTION_SELECTOR, readFractionAttrs } from '../extensions/MathFraction.js'
import { buildNumberBaseInner, NUMBER_BASE_SELECTOR, readNumberBaseAttrs } from '../extensions/NumberBase.js'
// mhchem — chemistry formula extension for KaTeX. Side-effect import:
// registers \ce{} / \pu{} commands on the global katex instance so a
// Chemistry question with `\ce{H_2SO_4}` or `\ce{2H_2 + O_2 -> 2H_2O}`
// renders correctly. Must be imported before any katex.render() call;
// every renderer (this file, MathInline.js, MathModal.jsx) imports it.
import 'katex/contrib/mhchem'
import { renderExtensions } from '../extensions/buildExtensions.js'
import { sanitizeHTML } from './sanitize.js'
import { isTiptapJSON } from './migration.js'
import { latexToReadableText } from '../../utils/quizRichText.js'
import { latexToSegments } from '../../utils/latexToUnicode.js'
// KaTeX stylesheet — only pulled in inside a browser. Vite intercepts the
// dynamic CSS import at build time and inlines the styles; under a plain
// `node` test runner there's no window, the import never fires, and the
// `.css` file no longer trips Node's ESM loader.
// School notation — the CSS that makes a fraction STACKED rather than two
// numbers side by side, plus vertical arithmetic and number bases. It is
// imported HERE, next to KaTeX, because the stylesheet a renderer needs must
// travel with the renderer: these rules lived in `editor.css`, which only the
// authoring surfaces import, so the learner quiz route emitted
// `.math-frac-num` / `.math-frac-den` markup with nothing to stack it and a
// learner met "6 8". See `mathNotation.css` for the full account.
if (typeof window !== 'undefined') {
  import('katex/dist/katex.min.css').catch(() => {})
  import('../mathNotation.css').catch(() => {})
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
  const blocks = container.querySelectorAll(VERTICAL_ARITHMETIC_SELECTOR)
  blocks.forEach((el) => {
    if (el.querySelector('.va-row')) return
    el.innerHTML = buildVerticalArithmeticInner(readVerticalArithmeticAttrs(el))
  })
}

export function hydrateFractions(container) {
  if (!container) return
  const fracs = container.querySelectorAll(FRACTION_SELECTOR)
  fracs.forEach((el) => {
    if (el.querySelector('.math-frac-stack')) return
    el.innerHTML = buildFractionInner(readFractionAttrs(el))
  })
}

export function hydrateNumberBases(container) {
  if (!container) return
  const items = container.querySelectorAll(NUMBER_BASE_SELECTOR)
  items.forEach((el) => {
    if (el.querySelector('.num-base-sub')) return
    el.innerHTML = buildNumberBaseInner(readNumberBaseAttrs(el))
  })
}

/**
 * Replace KaTeX math nodes (`<span class="mnode" data-latex="…">`) with a
 * readable plain-text/Unicode rendering of their LaTeX.
 *
 * KaTeX needs JavaScript to draw its DOM, so the non-JS export targets — the
 * PDF print window and the DOCX walker — would otherwise render these spans
 * blank (the canonical serialised form carries the LaTeX in `data-latex`, not
 * as text content). Flattening here means every paper export shows "18",
 * "4 ÷ 2 × 3", "(1)/(3)" etc. instead of an empty span.
 */
/**
 * Replace every KaTeX math node with markup the JavaScript-free renderers can
 * actually draw.
 *
 * The print window and the Word export never run KaTeX, so whatever this leaves
 * behind IS the formula on the teacher's paper. It used to leave a single flat
 * text node, which meant a subscript had to be a Unicode character — fine for
 * digits, missing from many fonts for letters, and invisible if the reader's font
 * lacks the glyph.
 *
 * Now the parse (latexToUnicode.js) is emitted as text plus real `<sub>` / `<sup>`
 * elements. Both non-JS renderers already understand those: the print window
 * draws them natively, and assessmentToDocx's walker turns SUP/SUB into Word
 * superscript/subscript runs. So H₂SO₄ is genuine subscript in Word rather than a
 * glyph that may not exist, and no renderer needed a new code path to gain it.
 *
 * The node's own text is still the Unicode form, so anything reading
 * `textContent` (search, plain-text export, the AI verifiers) is unaffected.
 */
function flattenMathNodes(container) {
  if (!container) return
  const doc = container.ownerDocument
  const nodes = container.querySelectorAll('span.mnode, span[data-latex], span[data-math-latex]')
  nodes.forEach((el) => {
    const latex = el.getAttribute('data-latex') || el.getAttribute('data-math-latex') || el.textContent || ''
    const segments = latexToSegments(latex)
    el.textContent = ''
    if (segments.length === 0) {
      el.textContent = latexToReadableText(latex)
    } else {
      for (const segment of segments) {
        if (!segment.script) {
          el.appendChild(doc.createTextNode(segment.text))
          continue
        }
        const wrapper = doc.createElement(segment.script === 'sub' ? 'sub' : 'sup')
        wrapper.textContent = segment.text
        el.appendChild(wrapper)
      }
    }
    el.classList.remove('mnode')
    el.removeAttribute('data-latex')
    el.removeAttribute('data-math-latex')
    // Keep the source LaTeX on the element (§4.2). The visible content above is
    // the linear form the print window needs — but Word can do better than
    // linear, and it can only do so if the structure survives this step. The
    // content model reads this back and the Word export builds a real OMML
    // equation from it; anything that cannot read it still renders the text.
    if (latex) el.setAttribute('data-tex', latex)
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
 * KaTeX math nodes can't be drawn without JS, so instead of leaving an
 * empty `<span class="mnode" data-latex="…">` (which prints blank) they are
 * flattened to a readable plain-text/Unicode rendering of their LaTeX.
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
    flattenMathNodes(doc.body)
    return doc.body.innerHTML
  } catch {
    return baseHtml
  }
}
