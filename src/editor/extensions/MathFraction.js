/**
 * src/editor/extensions/MathFraction.js
 *
 * Custom Tiptap inline node for proper fractions, improper fractions, and
 * mixed numbers — displayed with the numerator stacked above the
 * denominator (real fraction look, not "1/3" inline text).
 *
 * Persistence shape (round-trips through sanitiser):
 *   <span class="math-frac"
 *         data-math-fraction="1"
 *         data-whole="1"
 *         data-num="1"
 *         data-den="3"></span>
 *
 * Examples it can render:
 *   - proper:    3/4              → whole="" num="3" den="4"
 *   - improper:  7/4              → whole="" num="7" den="4"
 *   - mixed:     1 1/3            → whole="1" num="1" den="3"
 */

import { Node, mergeAttributes } from '@tiptap/core'

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build the inner HTML for a fraction span. Used by the NodeView and the
 * safeRender hydrator. CSS handles the stacking (.math-frac-num /
 * .math-frac-den), so the resulting DOM is plain and printable.
 */
/**
 * How a fraction is recognised in stored HTML, and what its attributes are
 * called. Exported because THREE readers need to agree: this extension, the
 * print hydrator in safeRender.js, and the content model in
 * paperContentModel.js. They disagreed until 2026-07 — the hydrator accepted
 * both the class and the data-attribute spelling while the content model
 * matched only the class, so a fraction in the other spelling reached Word as
 * the bare digits "12" instead of one half. A shared selector is the fix that
 * keeps them from drifting apart again.
 *
 * Deliberately not tag-qualified. What identifies a fraction is the marker it
 * carries, not the element it happens to be on — a reader that ignored one
 * because it arrived on a different tag would be the same silent-miss bug in a
 * new disguise.
 */
export const FRACTION_SELECTOR = '[data-math-fraction], .math-frac'

/** Read a fraction's parts from either attribute spelling. */
export function readFractionAttrs(el) {
  return {
    whole: el.getAttribute('data-whole') || '',
    num: el.getAttribute('data-num') || el.getAttribute('data-numerator') || '',
    den: el.getAttribute('data-den') || el.getAttribute('data-denominator') || '',
  }
}

export function buildFractionInner({ whole, num, den }) {
  const w = String(whole ?? '').trim()
  const n = String(num ?? '').trim()
  const d = String(den ?? '').trim()

  // Render as: optional whole + stacked num/den. Falls back to a flat "n/d"
  // text if either part is empty (so a half-typed fraction still reads).
  if (!n && !d) return w ? escapeHtml(w) : ''

  const wholeHtml = w ? `<span class="math-frac-whole">${escapeHtml(w)}</span>` : ''
  return `${wholeHtml}` +
    `<span class="math-frac-stack">` +
    `<span class="math-frac-num">${escapeHtml(n)}</span>` +
    `<span class="math-frac-den">${escapeHtml(d)}</span>` +
    `</span>`
}

export const MathFraction = Node.create({
  name: 'mathFraction',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      whole: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-whole') || '',
        renderHTML: (attrs) => ({ 'data-whole': attrs.whole || '' }),
      },
      num: {
        default: '',
        parseHTML: (el) =>
          el.getAttribute('data-num') ?? el.getAttribute('data-numerator') ?? '',
        renderHTML: (attrs) => ({ 'data-num': attrs.num || '' }),
      },
      den: {
        default: '',
        parseHTML: (el) =>
          el.getAttribute('data-den') ?? el.getAttribute('data-denominator') ?? '',
        renderHTML: (attrs) => ({ 'data-den': attrs.den || '' }),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-math-fraction]' },
      { tag: 'span.math-frac' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'math-frac',
        'data-math-fraction': '1',
      }),
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span')
      dom.className = 'math-frac'
      dom.setAttribute('data-math-fraction', '1')
      dom.contentEditable = 'false'

      const apply = (attrs) => {
        dom.setAttribute('data-whole', attrs.whole || '')
        dom.setAttribute('data-num', attrs.num || '')
        dom.setAttribute('data-den', attrs.den || '')
        dom.innerHTML = buildFractionInner(attrs)
      }

      apply(node.attrs)

      dom.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!editor.isEditable) return
        dom.dispatchEvent(
          new CustomEvent('tiptap-fraction-click', {
            bubbles: true,
            cancelable: true,
            detail: {
              attrs: { ...node.attrs },
              pos: typeof getPos === 'function' ? getPos() : null,
            },
          })
        )
      })

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'mathFraction') return false
          apply(updatedNode.attrs)
          return true
        },
        destroy() {},
      }
    }
  },

  addCommands() {
    return {
      insertMathFraction:
        (attrs = {}) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: 'mathFraction',
              attrs: {
                whole: attrs.whole || '',
                num: attrs.num || '',
                den: attrs.den || '',
              },
            })
            .run(),
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        const nodeBefore = $from.nodeBefore
        if (nodeBefore?.type?.name === 'mathFraction') {
          return this.editor.chain()
            .command(({ tr }) => {
              tr.delete($from.pos - nodeBefore.nodeSize, $from.pos)
              return true
            })
            .run()
        }
        return false
      },
    }
  },
})
