/**
 * src/editor/richPlainText.js
 *
 * Pure (no React, no DOM) plain-text extraction for rich-text values that may
 * be Tiptap JSON, a *stringified* Tiptap doc, legacy HTML, or a plain string.
 *
 * Lives in its own module — separate from RichContent.jsx — so it can be unit
 * tested under the plain `node` runner (a .jsx file can't be imported there)
 * and reused anywhere a readable string is needed. RichContent re-exports
 * getRichPlainText from here, so existing imports keep working unchanged.
 *
 * The important guarantee these functions give: a stringified Tiptap doc like
 *   '{"type":"doc","content":[{"type":"paragraph","content":[
 *      {"type":"mathFraction","attrs":{"num":"1","den":"32"}}]}]}'
 * extracts to readable "1/32" — it NEVER passes the raw JSON through as text.
 * That is exactly the "answer options showing raw JSON" bug this guards.
 */

// Recursively peel off layers of stringified Tiptap docs that earlier save
// bugs left in Firestore (a doc whose only paragraph holds a single text node
// containing another stringified doc). Bounded so we never loop on adversarial
// data, and the start-of-text sniff keeps legitimate user content intact.
export function unwrapNestedTiptapDoc(doc, depth = 0) {
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

function extractFromNode(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'mathInline') return node.attrs?.latex || ''
  if (node.type === 'mathFraction') {
    const w = node.attrs?.whole || ''
    const n = node.attrs?.num || ''
    const d = node.attrs?.den || ''
    return `${w ? `${w} ` : ''}${n}/${d}`.trim()
  }
  if (node.type === 'numberBase') {
    const n = node.attrs?.number || ''
    const b = node.attrs?.base || ''
    return b ? `${n}_${b}` : n
  }
  if (node.type === 'verticalArithmetic') {
    const op = node.attrs?.operator || '+'
    const lines = Array.isArray(node.attrs?.lines) ? node.attrs.lines : []
    const ans = node.attrs?.answer || ''
    return `${lines.join(` ${op} `)} = ${ans || '___'}`
  }
  if (node.content) return node.content.map(extractFromNode).join('')
  return ''
}

function extractFromDoc(doc) {
  if (!doc?.content) return ''
  return doc.content.map(extractFromNode).join(' ').trim()
}

export function extractPlainText(value) {
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

export function getRichPlainText(value) {
  return extractPlainText(value)
}
