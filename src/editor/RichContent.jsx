import { useState, useEffect } from 'react'

// Recursively peel off layers of stringified Tiptap docs that earlier save
// bugs left in Firestore (a doc whose only paragraph holds a single text node
// containing another stringified doc). Bounded so we never loop on adversarial
// data, and the start-of-text sniff keeps legitimate user content intact.
function unwrapNestedTiptapDoc(doc, depth = 0) {
  if (depth > 8) return doc
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return doc
  if (!Array.isArray(doc.content) || doc.content.length !== 1) return doc
  const para = doc.content[0]
  if (!para || para.type !== 'paragraph' || !Array.isArray(para.content) || para.content.length !== 1) return doc
  const textNode = para.content[0]
  if (!textNode || textNode.type !== 'text' || typeof textNode.text !== 'string') return doc
  const trimmed = textNode.text.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes('"type"')) return doc
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return unwrapNestedTiptapDoc(parsed, depth + 1)
    }
  } catch { /* not JSON, leave as-is */ }
  return doc
}

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

function extractPlainText(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed?.type === 'doc') return extractFromDoc(unwrapNestedTiptapDoc(parsed))
    } catch { /* not JSON */ }
    return value
  }
  if (typeof value === 'object' && value.type === 'doc') return extractFromDoc(unwrapNestedTiptapDoc(value))
  return ''
}

function extractFromDoc(doc) {
  if (!doc?.content) return ''
  return doc.content.map(extractFromNode).join(' ').trim()
}

function extractFromNode(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'mathInline') return node.attrs?.latex || ''
  if (node.content) return node.content.map(extractFromNode).join('')
  return ''
}

export function getRichPlainText(value) {
  return extractPlainText(value)
}

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
    return <span className={className}>{plain}</span>
  }

  return (
    <div
      className={className}
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
