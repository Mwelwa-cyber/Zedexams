/**
 * src/editor/extensions/MathInline.js
 *
 * Custom Tiptap inline node for KaTeX math.
 *
 * Design decisions:
 *  - `atom: true`       → treated as a single indivisible unit (like an image)
 *  - `selectable: true` → can be selected and deleted as a unit
 *  - Plain DOM NodeView → no React overhead per math node; KaTeX renders directly
 *  - CustomEvent        → NodeView communicates click-to-edit to RichEditor
 *                         without any prop-drilling or tight coupling
 *  - Undo/redo safety   → all mutations go through Tiptap transactions (tr),
 *                         so History extension tracks them correctly
 *
 * Keyboard behaviour around math nodes:
 *  - Backspace before an atom: custom handler deletes it cleanly
 *  - Arrow keys: ProseMirror handles gap-cursor navigation automatically
 *    when GapCursor is included (it is in StarterKit)
 */

import { Node, mergeAttributes } from '@tiptap/core'
import katex from 'katex'
// Chemistry-formula extension (see safeRender.js for context).
import 'katex/contrib/mhchem'

export const MathInline = Node.create({
  name: 'mathInline',

  // Lives inside a paragraph/heading alongside text
  group: 'inline',
  inline: true,

  // Atom = single unbreakable unit. ProseMirror will not let the cursor
  // enter inside it. Arrow keys jump over it. Backspace deletes the whole node.
  atom: true,

  selectable: true,
  draggable: false,

  // ── Schema ───────────────────────────────────────────────────
  addAttributes() {
    return {
      latex: {
        default: '',
        // Read either attribute name. The legacy QuizRichText editor writes
        // `data-latex`; earlier versions of this extension wrote
        // `data-math-latex`. Accept both so stored content always parses
        // back into a real math node on edit.
        parseHTML: (el) =>
          el.getAttribute('data-latex') ??
          el.getAttribute('data-math-latex') ??
          '',
        // Emit the canonical `data-latex` that the rest of the pipeline uses.
        renderHTML: (attrs) =>
          attrs.latex ? { 'data-latex': attrs.latex } : {},
      },
    }
  },

  parseHTML() {
    // Match every shape a math span could have taken across editor versions.
    return [
      { tag: 'span[data-latex]' },
      { tag: 'span[data-math-latex]' },
      { tag: 'span.mnode' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Static HTML for clipboard, generateHTML(), and server rendering.
    // The live KaTeX render happens in the NodeView; the learner viewer
    // hydrates KaTeX separately via hydrateKatex() / renderMathInElement().
    //
    // Deliberately NO text fallback — if the attribute is ever stripped,
    // empty is strictly better than leaking raw LaTeX (which showed up as
    // "Σ", "\frac{…}", arrows, etc. in question text on reload).
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'mnode' }),
      '',
    ]
  },

  // ── NodeView — live interactive render in the editor ─────────
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span')
      dom.className = 'mnode'
      dom.contentEditable = 'false'

      // Render KaTeX into the node
      const renderMath = (latex) => {
        dom.innerHTML = ''
        dom.setAttribute('data-math-latex', latex)
        try {
          katex.render(latex, dom, { throwOnError: false, displayMode: false })
        } catch {
          // Last resort: show raw LaTeX
          const code = document.createElement('code')
          code.textContent = latex
          dom.appendChild(code)
        }
      }

      renderMath(node.attrs.latex)

      // Click → ask the parent RichEditor to open the edit modal.
      // Using a CustomEvent keeps the extension decoupled from React state.
      dom.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()

        // Only allow editing when the editor itself is editable
        if (!editor.isEditable) return

        dom.dispatchEvent(
          new CustomEvent('tiptap-math-click', {
            bubbles: true,   // bubbles up to the editor DOM container
            cancelable: true,
            detail: {
              latex: node.attrs.latex,
              // getPos() returns the node's current position in the doc.
              // We need this to run tr.setNodeMarkup(pos, ...) on save.
              pos: typeof getPos === 'function' ? getPos() : null,
            },
          })
        )
      })

      return {
        dom,

        // Called by Tiptap when the node's attributes change (e.g. after
        // tr.setNodeMarkup). Re-render KaTeX in place — no DOM replacement.
        update(updatedNode) {
          if (updatedNode.type.name !== 'mathInline') return false
          if (updatedNode.attrs.latex !== node.attrs.latex) {
            renderMath(updatedNode.attrs.latex)
          }
          return true
        },

        // No external subscriptions to clean up in this NodeView,
        // but the hook is here for future use.
        destroy() {},
      }
    }
  },

  // ── Commands ─────────────────────────────────────────────────
  addCommands() {
    return {
      /**
       * Insert a new math node at the current cursor position.
       * Goes through Tiptap's command system → tracked by History.
       *
       * Usage:
       *   editor.chain().focus().insertMathNode('\\frac{a}{b}').run()
       */
      insertMathNode:
        (latex) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: 'mathInline',
              attrs: { latex },
            })
            .run(),
    }
  },

  // ── Keyboard shortcuts ────────────────────────────────────────
  addKeyboardShortcuts() {
    return {
      /**
       * Backspace: if the character immediately before the cursor is a math
       * node, delete it as a unit (not character-by-character).
       * Without this, Backspace at the edge of an atom node can leave
       * orphaned or empty nodes in some edge cases.
       */
      Backspace: () => {
        const { state } = this.editor
        const { selection } = state

        // Only handle collapsed (no-selection) backspace
        if (!selection.empty) return false

        const { $from } = selection
        const nodeBefore = $from.nodeBefore

        if (nodeBefore?.type?.name === 'mathInline') {
          // Delete the math node before cursor via transaction
          return this.editor.chain()
            .command(({ tr }) => {
              tr.delete($from.pos - nodeBefore.nodeSize, $from.pos)
              return true
            })
            .run()
        }
        return false
      },

      /**
       * Delete: same for the node immediately after the cursor.
       */
      Delete: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false

        const { $from } = selection
        const nodeAfter = $from.nodeAfter

        if (nodeAfter?.type?.name === 'mathInline') {
          return this.editor.chain()
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
