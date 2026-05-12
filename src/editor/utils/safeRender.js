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
import { renderExtensions } from '../extensions/buildExtensions.js'
import { sanitizeHTML } from './sanitize.js'
import { isTiptapJSON } from './migration.js'
import { renderDiagramSvg } from '../../components/diagrams/diagramCatalog.js'
// KaTeX stylesheet — side-effect import at the render layer so the Tiptap
// extensions factory can be imported by Node scripts without a CSS loader.
import 'katex/dist/katex.min.css'

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
/**
 * Hydrate diagram-reference placeholders inside a mounted DOM container.
 *
 * The DiagramRef Tiptap extension serialises to an empty
 *   <div class="zx-diagram-ref" data-diagram-key="…" data-diagram-params='…'></div>
 * placeholder (we deliberately don't store the SVG in HTML — it would bloat
 * the doc and freeze catalog markup at write time). Call this after the HTML
 * mounts to swap each placeholder's innerHTML for the rendered SVG.
 *
 * Usage mirrors hydrateKatex:
 *   const containerRef = useRef(null)
 *   useEffect(() => {
 *     if (containerRef.current) hydrateDiagrams(containerRef.current)
 *   }, [html])
 *
 * @param {HTMLElement} container  The DOM element containing the HTML
 */
export function hydrateDiagrams(container) {
  if (!container) return
  const nodes = container.querySelectorAll('div[data-diagram-key]')
  nodes.forEach(div => {
    // Skip if already hydrated (carries an <svg> child).
    if (div.querySelector('svg')) return
    const libraryKey = div.getAttribute('data-diagram-key') || ''
    if (!libraryKey) return
    let params = {}
    const raw = div.getAttribute('data-diagram-params')
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') params = parsed
      } catch {
        // Bad JSON → fall back to catalog defaults rather than rejecting.
      }
    }
    const svg = renderDiagramSvg(libraryKey, params)
    if (svg) {
      div.innerHTML = svg
    } else {
      // Unknown key — show a clear placeholder so the teacher can replace it.
      div.innerHTML = '<div style="border:2px dashed #f59e0b;background:#fef3c7;color:#92400e;padding:6px 10px;font-size:12px;font-weight:700;border-radius:8px">Unknown diagram</div>'
    }
  })
}

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
