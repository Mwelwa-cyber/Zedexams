import { useState, useEffect } from 'react'
// Plain-text extraction lives in a pure, node-testable module. getRichPlainText
// is re-exported below so existing `import { getRichPlainText } from
// '../../editor/RichContent'` call sites keep working.
import { unwrapNestedTiptapDoc, extractPlainText, getRichPlainText } from './richPlainText.js'

function parseTiptapValue(value) {
  if (!value) return null
  if (typeof value === 'object' && value.type === 'doc') return unwrapNestedTiptapDoc(value)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && parsed.type === 'doc') return unwrapNestedTiptapDoc(parsed)
    } catch { /* not JSON */ }
    return value  // return raw string for legacy rendering
  }
  return null
}

// Re-export so call sites can keep importing from this module.
export { getRichPlainText }

export default function RichContent({ value, className = '', fallback = null }) {
  const [html, setHtml] = useState(null)

  useEffect(() => {
    if (!value) return
    const parsed = parseTiptapValue(value)
    if (!parsed) return

    import('./utils/safeRender.js').then(({ toHTML, hydrateKatex }) => {
      const rendered = toHTML(parsed)
      if (rendered && rendered !== '<p></p>') {
        setHtml(rendered)
        // Hydrate after next paint so the DOM is ready
        setTimeout(() => {
          const container = document.querySelector('[data-rich-content-pending]')
          if (container) {
            container.removeAttribute('data-rich-content-pending')
            hydrateKatex(container)
          }
        }, 0)
      }
    }).catch(() => {})
  }, [value])

  if (!value) return fallback

  if (!html) {
    const plain = extractPlainText(value)
    if (!plain) return fallback
    return <span className={`rich-content ${className}`.trim()}>{plain}</span>
  }

  return (
    <div
      className={`rich-content ${className}`.trim()}
      data-rich-content-pending=""
      dangerouslySetInnerHTML={{ __html: html }}
      ref={(el) => {
        if (el) {
          import('./utils/safeRender.js').then(({ hydrateKatex }) => {
            hydrateKatex(el)
          }).catch(() => {})
        }
      }}
    />
  )
}
