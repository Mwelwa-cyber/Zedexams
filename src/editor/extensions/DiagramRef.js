/**
 * src/editor/extensions/DiagramRef.js
 *
 * Custom Tiptap block node for a library-diagram reference.
 *
 * Design mirrors MathInline.js:
 *   - `atom: true`       → single indivisible unit; cursor cannot enter
 *   - `selectable: true` → click selects, Backspace/Delete removes
 *   - `group: 'block'`   → diagrams take their own line (SVGs are 200–500px wide
 *                          and would break paragraph flow if inline)
 *   - Plain DOM NodeView → no React overhead per diagram; SVG rendered directly
 *   - CustomEvent        → NodeView signals click-to-edit to RichEditor without
 *                          prop-drilling or tight coupling
 *   - Undo/redo safety   → all mutations go through Tiptap transactions, so
 *                          History extension tracks them correctly
 *
 * Stored shape on disk (Tiptap JSON):
 *   { type: 'diagramRef', attrs: { libraryKey: 'cylinder', params: { r: 'r', h: 'h' } } }
 *
 * Stored shape in HTML (after generateHTML + DOMPurify):
 *   <div class="zx-diagram-ref" data-diagram-key="cylinder" data-diagram-params='{"r":"r","h":"h"}'></div>
 *
 * The empty placeholder is hydrated to inline SVG client-side by
 * hydrateDiagrams() — same approach as hydrateKatex for math. We deliberately
 * do NOT serialise the SVG into the stored HTML: it would bloat the doc
 * (hundreds of bytes per diagram), and freezing a snapshot of catalog markup
 * means catalog improvements (fixed strokes, better fonts) wouldn't reach
 * already-saved content.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { getDiagram, renderDiagramSvg } from '../../components/diagrams/diagramCatalog.js'

export const DiagramRef = Node.create({
  name: 'diagramRef',

  group: 'block',
  inline: false,
  atom: true,
  selectable: true,
  draggable: false,

  // ── Schema ───────────────────────────────────────────────────
  addAttributes() {
    return {
      libraryKey: {
        default: '',
        parseHTML: el => el.getAttribute('data-diagram-key') ?? '',
        renderHTML: attrs =>
          attrs.libraryKey ? { 'data-diagram-key': attrs.libraryKey } : {},
      },
      params: {
        default: {},
        // Params live as a JSON-stringified attribute. Parser falls back to {}
        // if the attribute is missing or malformed — the renderer treats that
        // as "use catalog defaults" rather than rejecting the node, so a
        // damaged document still partially renders.
        parseHTML: el => {
          const raw = el.getAttribute('data-diagram-params')
          if (!raw) return {}
          try {
            const parsed = JSON.parse(raw)
            return parsed && typeof parsed === 'object' ? parsed : {}
          } catch {
            return {}
          }
        },
        renderHTML: attrs => {
          if (!attrs.params || typeof attrs.params !== 'object') return {}
          return { 'data-diagram-params': JSON.stringify(attrs.params) }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-diagram-key]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // Empty placeholder. Hydration replaces innerHTML with the SVG after
    // mount, the same way KaTeX math is hydrated. We deliberately emit no
    // text fallback — if the attribute is somehow stripped, an empty div
    // is strictly better than leaking raw JSON.
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'zx-diagram-ref' }),
      '',
    ]
  },

  // ── NodeView — live interactive render inside the editor ─────
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div')
      dom.className = 'zx-diagram-ref'
      dom.contentEditable = 'false'
      // CSS handles the visual frame — block layout, light bg, hover ring.
      // Inline styles here keep the editor presentable even before editor.css
      // catches up (e.g. an SSR render before stylesheets attach).
      dom.style.display = 'block'
      dom.style.cursor = editor.isEditable ? 'pointer' : 'default'
      dom.style.margin = '0.5em 0'

      const renderInto = (libraryKey, params) => {
        const svg = renderDiagramSvg(libraryKey, params)
        if (svg) {
          dom.innerHTML = svg
        } else {
          // Unknown key — show a clear placeholder so the teacher can swap.
          dom.innerHTML = `<div style="border:2px dashed #f59e0b;background:#fef3c7;color:#92400e;padding:6px 10px;font-size:12px;font-weight:700;border-radius:8px">Unknown diagram: ${escapeAttr(libraryKey)}</div>`
        }
        // Reflect the attrs on the live DOM too so a serialised round-trip
        // through editor.getHTML() (Tiptap v3 reads serialised HTML from the
        // NodeView, not just renderHTML) preserves them.
        if (libraryKey) dom.setAttribute('data-diagram-key', libraryKey)
        if (params && typeof params === 'object') {
          dom.setAttribute('data-diagram-params', JSON.stringify(params))
        }
      }

      renderInto(node.attrs.libraryKey, node.attrs.params)

      // Click → ask the parent RichEditor to open the picker pre-populated.
      // CustomEvent + bubbles keeps the extension decoupled from React state,
      // same pattern as MathInline.
      dom.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        if (!editor.isEditable) return
        dom.dispatchEvent(
          new CustomEvent('tiptap-diagram-click', {
            bubbles: true,
            cancelable: true,
            detail: {
              libraryKey: node.attrs.libraryKey,
              params: node.attrs.params,
              pos: typeof getPos === 'function' ? getPos() : null,
            },
          })
        )
      })

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'diagramRef') return false
          renderInto(updatedNode.attrs.libraryKey, updatedNode.attrs.params)
          return true
        },
        destroy() {},
      }
    }
  },

  // ── Commands ─────────────────────────────────────────────────
  addCommands() {
    return {
      /**
       * Insert a new diagram node at the current selection.
       *
       * Usage:
       *   editor.chain().focus().insertDiagramRef({
       *     libraryKey: 'cylinder',
       *     params: { r: 'r', h: 'h' },
       *   }).run()
       *
       * Reject inserts with an unknown libraryKey at the boundary — keeps
       * garbage out of the doc rather than silently inserting an unrenderable
       * placeholder.
       */
      insertDiagramRef:
        ({ libraryKey, params }) =>
        ({ chain }) => {
          if (!libraryKey || !getDiagram(libraryKey)) return false
          return chain()
            .insertContent({
              type: 'diagramRef',
              attrs: {
                libraryKey,
                params: params && typeof params === 'object' ? params : {},
              },
            })
            .run()
        },

      /**
       * Update an existing diagram node in place (called from the click-to-edit
       * flow). The pos comes from getPos() inside the NodeView's click handler.
       */
      updateDiagramRefAt:
        (pos, { libraryKey, params }) =>
        ({ tr, state, dispatch }) => {
          if (typeof pos !== 'number') return false
          const node = state.doc.nodeAt(pos)
          if (!node || node.type.name !== 'diagramRef') return false
          if (!libraryKey || !getDiagram(libraryKey)) return false
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, {
              libraryKey,
              params: params && typeof params === 'object' ? params : {},
            })
          }
          return true
        },
    }
  },

  // ── Keyboard shortcuts ────────────────────────────────────────
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        const nodeBefore = $from.nodeBefore
        if (nodeBefore?.type?.name === 'diagramRef') {
          return this.editor
            .chain()
            .command(({ tr }) => {
              tr.delete($from.pos - nodeBefore.nodeSize, $from.pos)
              return true
            })
            .run()
        }
        return false
      },
      Delete: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        const nodeAfter = $from.nodeAfter
        if (nodeAfter?.type?.name === 'diagramRef') {
          return this.editor
            .chain()
            .command(({ tr }) => {
              tr.delete($from.pos, $from.pos + nodeAfter.nodeSize)
              return true
            })
            .run()
        }
        return false
      },
    }
  },
})

// Tiny HTML-attr escaper for the unknown-key placeholder above. We can't reuse
// the catalog's `esc()` because that one targets SVG text nodes (a slightly
// different escape set). DOMPurify also runs over the output upstream — this
// is just defence in depth.
function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
