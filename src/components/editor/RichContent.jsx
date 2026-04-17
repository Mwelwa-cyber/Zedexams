import { tiptapToHTML, richEditorExtensions } from './RichEditor'

/**
 * Renders rich text content that may be either a plain string or Tiptap JSON.
 * Used in student-facing views (quiz runner, results).
 */
export default function RichContent({ value, className = '', fallback = null }) {
  if (!value) return fallback

  if (typeof value === 'object' && value.type === 'doc') {
    const html = tiptapToHTML(value)
    if (!html || html === '<p></p>') return fallback
    return (
      <div
        className={`rich-content ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  if (typeof value === 'string') {
    // Try JSON parse (stored as JSON string)
    try {
      const parsed = JSON.parse(value)
      if (parsed && parsed.type === 'doc') {
        const html = tiptapToHTML(parsed)
        if (!html || html === '<p></p>') return fallback
        return (
          <div
            className={`rich-content ${className}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      }
    } catch {
      // plain string
    }
    if (!value.trim()) return fallback
    return <span className={className}>{value}</span>
  }

  return fallback
}

/**
 * Extracts a plain text string from either a plain string or Tiptap JSON.
 * Useful for passing to AI or constructing tip text.
 */
export function getRichPlainText(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && parsed.type === 'doc') return extractText(parsed)
    } catch {
      // plain string
    }
    return value
  }
  if (typeof value === 'object' && value.type === 'doc') return extractText(value)
  return String(value)
}

function extractText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (Array.isArray(node.content)) return node.content.map(extractText).join('')
  return ''
}
