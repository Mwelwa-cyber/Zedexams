/**
 * src/editor/extensions/VerticalArithmetic.js
 *
 * Custom Tiptap block node for vertical arithmetic layouts (addition,
 * subtraction, multiplication, division). Renders a column of right-aligned
 * digits with the operator on the left, a rule, then the (optional) answer.
 *
 * Persistence shape (round-trips through sanitiser via data-* attributes):
 *   <div class="vert-arith"
 *        data-vertical-arithmetic="1"
 *        data-operator="-"
 *        data-lines="2376|1154"
 *        data-answer=""
 *        data-working="false"></div>
 *
 * The visual structure is REBUILT from these attributes by a hydrator
 * (see hydrateVerticalArithmetic / hydrateMathBlocks). The stored HTML
 * never contains the inner spans, so it survives every sanitiser the
 * codebase runs without needing wider allow-lists.
 *
 * Lines are joined with `|` so a single attribute survives DOMPurify with
 * minimal special characters. Empty entries are preserved.
 */

import { Node, mergeAttributes } from '@tiptap/core'

export const VERT_OPERATORS = ['+', '−', '×', '÷']
const VERT_OP_SET = new Set(VERT_OPERATORS)

export function encodeLines(lines) {
  if (!Array.isArray(lines)) return ''
  return lines.map((l) => String(l ?? '')).join('|')
}

export function decodeLines(value) {
  if (Array.isArray(value)) return value.map((l) => String(l ?? ''))
  if (value == null) return ['', '']
  const str = String(value)
  if (!str.length) return ['', '']
  return str.split('|')
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build the inner HTML (spans + rule) for a single vertical-arithmetic
 * block. Used by both the NodeView (editor preview) and the safeRender
 * hydrator (learner viewer + PDF export).
 *
 * The layout uses monospace digits, right-aligned, with the operator
 * column sitting on the left of the last operand row.
 */
export function buildVerticalArithmeticInner({ operator, lines, answer, working }) {
  const op = VERT_OP_SET.has(operator) ? operator : '+'
  const safeLines = Array.isArray(lines) && lines.length ? lines : ['', '']
  const allValues = [...safeLines, answer ?? '']
  const width = Math.max(...allValues.map((v) => String(v ?? '').length), 1)

  // Pad with leading spaces so monospace alignment survives inside <span>.
  // The .va-num CSS uses `tabular-nums` + right-alignment so the visible
  // numerals line up by place value regardless of what's printed left of
  // them.
  const pad = (s) => {
    const str = String(s ?? '')
    const need = width - str.length
    return (need > 0 ? ' '.repeat(need) : '') + str
  }

  // Use the HTML &nbsp; entity (not a literal NBSP byte) for the
  // operator-column blanks so the file stays free of irregular
  // whitespace while still rendering visible space.
  const rows = safeLines.map((line, idx) => {
    const isOpRow = idx === safeLines.length - 1
    return `<div class="va-row${isOpRow ? ' va-op-row' : ''}">` +
      `<span class="va-op">${isOpRow ? op : '&nbsp;'}</span>` +
      `<span class="va-num">${escapeHtml(pad(line))}</span>` +
      `</div>`
  }).join('')

  const ruleHtml = `<div class="va-rule" aria-hidden="true"></div>`
  const answerHtml = `<div class="va-row va-answer-row">` +
    `<span class="va-op">&nbsp;</span>` +
    `<span class="va-num">${escapeHtml(pad(answer || ''))}</span>` +
    `</div>`

  const workingHtml = working
    ? `<div class="va-working" aria-label="working space">` +
      `<div class="va-working-line"></div>` +
      `<div class="va-working-line"></div>` +
      `</div>`
    : ''

  return `${rows}${ruleHtml}${answerHtml}${workingHtml}`
}

export const VerticalArithmetic = Node.create({
  name: 'verticalArithmetic',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      operator: {
        default: '+',
        parseHTML: (el) => el.getAttribute('data-operator') || '+',
        renderHTML: (attrs) => ({ 'data-operator': attrs.operator || '+' }),
      },
      lines: {
        default: ['', ''],
        parseHTML: (el) => decodeLines(el.getAttribute('data-lines')),
        renderHTML: (attrs) => ({ 'data-lines': encodeLines(attrs.lines) }),
      },
      answer: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-answer') || '',
        renderHTML: (attrs) => ({ 'data-answer': attrs.answer || '' }),
      },
      working: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-working') === 'true',
        renderHTML: (attrs) => ({ 'data-working': attrs.working ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-vertical-arithmetic]' },
      { tag: 'div.vert-arith' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Emit ONLY the wrapper + data attributes. The visual structure is
    // rebuilt at view time by hydrateVerticalArithmetic. This keeps the
    // serialised HTML minimal and lets us evolve the visual layout
    // without changing stored content.
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'vert-arith',
        'data-vertical-arithmetic': '1',
      }),
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div')
      dom.className = 'vert-arith'
      dom.setAttribute('data-vertical-arithmetic', '1')
      dom.contentEditable = 'false'

      const apply = (attrs) => {
        dom.setAttribute('data-operator', attrs.operator || '+')
        dom.setAttribute('data-lines', encodeLines(attrs.lines))
        dom.setAttribute('data-answer', attrs.answer || '')
        dom.setAttribute('data-working', attrs.working ? 'true' : 'false')
        dom.innerHTML = buildVerticalArithmeticInner(attrs)
      }

      apply(node.attrs)

      dom.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!editor.isEditable) return
        dom.dispatchEvent(
          new CustomEvent('tiptap-vert-arith-click', {
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
          if (updatedNode.type.name !== 'verticalArithmetic') return false
          apply(updatedNode.attrs)
          return true
        },
        destroy() {},
      }
    }
  },

  addCommands() {
    return {
      insertVerticalArithmetic:
        (attrs = {}) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: 'verticalArithmetic',
              attrs: {
                operator: attrs.operator || '+',
                lines: Array.isArray(attrs.lines) && attrs.lines.length ? attrs.lines : ['', ''],
                answer: attrs.answer || '',
                working: Boolean(attrs.working),
              },
            })
            .run(),
    }
  },
})
