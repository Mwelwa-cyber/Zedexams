// src/features/notes/lib/noteImportCore.js
//
// Pure, dependency-free helpers for the notes document importer. Kept separate
// from noteImport.js (which imports firebase/pdfjs/aiAssistant) so these can be
// unit-tested under plain node.

export const IMAGE_MARKER_RE = /\[\[IMAGE:([A-Za-z0-9_-]+)\]\]/

/** Build the document text the AI sees: each block's text followed by an
 *  [[IMAGE:id]] marker for every asset on that block, in document order. */
export function buildDocumentTextWithMarkers(blocks) {
  const parts = []
  for (const b of blocks || []) {
    if (b?.text) parts.push(String(b.text))
    for (const a of b?.assets || []) {
      if (a?.id) parts.push(`[[IMAGE:${a.id}]]`)
    }
  }
  return parts.join('\n\n')
}

/** Replace each image block's assetRef with the uploaded url; drop unresolved. */
export function resolveImageBlocks(blocks, urlById) {
  const out = []
  for (const b of blocks || []) {
    if (b?.type === 'image') {
      const url = b.assetRef ? urlById.get(b.assetRef) : (b.url || '')
      if (!url) continue
      const next = { ...b, url }
      delete next.assetRef
      out.push(next)
    } else {
      out.push(b)
    }
  }
  return out
}
