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
}
