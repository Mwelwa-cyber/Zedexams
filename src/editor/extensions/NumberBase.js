/**
 * src/editor/extensions/NumberBase.js
 *
 * Custom Tiptap inline node for number-base notation (e.g. 313₅, 142₅).
 * The base appears as a small subscript on the right of the number,
 * the way examiners write number-base questions in Zambian Grade 7
 * exam papers.
 *
 * Persistence shape (round-trips through sanitiser):
 *   <span class="num-base"
 *         data-number-base="1"
 *         data-number="313"
 *         data-base="5"></span>
 *
 * We model this as its own node (rather than reusing the Subscript mark)
 * so the renderer can guarantee no line-break between the number and the
 * base, and so the entire token is one selectable / deletable unit in
 * the editor — much friendlier for teachers building exam papers.
 */

import { Node, mergeAttributes } from '@tiptap/core'

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildNumberBaseInner({ number, base }) {
  const n = String(number ?? '').trim()
  const b = String(base ?? '').trim()
  if (!n && !b) return ''
  return `<span class="num-base-num">${escapeHtml(n)}</span>` +
    `<sub class="num-base-sub">${escapeHtml(b)}</sub>`
}

export const NumberBase = Node.create({
  name: 'numberBase',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      number: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-number') || '',
        renderHTML: (attrs) => ({ 'data-number': attrs.number || '' }),
      },
      base: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-base') || '',
        renderHTML: (attrs) => ({ 'data-base': attrs.base || '' }),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-number-base]' },
      { tag: 'span.num-base' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'num-base',
        'data-number-base': '1',
      }),
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span')
      dom.className = 'num-base'
      dom.setAttribute('data-number-base', '1')
      dom.contentEditable = 'false'

      const apply = (attrs) => {
        dom.setAttribute('data-number', attrs.number || '')
        dom.setAttribute('data-base', attrs.base || '')
        dom.innerHTML = buildNumberBaseInner(attrs)
      }

      apply(node.attrs)

      dom.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!editor.isEditable) return
        dom.dispatchEvent(
          new CustomEvent('tiptap-number-base-click', {
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
          if (updatedNode.type.name !== 'numberBase') return false
          apply(updatedNode.attrs)
          return true
        },
        destroy() {},
      }
    }
  },

  addCommands() {
    return {
      insertNumberBase:
        (attrs = {}) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: 'numberBase',
              attrs: {
                number: attrs.number || '',
                base: attrs.base || '',
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
        if (nodeBefore?.type?.name === 'numberBase') {
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
