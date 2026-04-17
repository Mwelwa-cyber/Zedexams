import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Node, mergeAttributes, generateHTML, generateJSON } from '@tiptap/core'
import katex from 'katex'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'

// ── Math inline node ──────────────────────────────────────────────

const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: el => el.getAttribute('data-math-latex') || '',
        renderHTML: attrs => ({ 'data-math-latex': attrs.latex }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-math-latex]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-math-latex': node.attrs.latex,
        class: 'math-inline-node',
      }),
    ]
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement('span')
      dom.className = 'math-inline-node'
      dom.contentEditable = 'false'
      dom.setAttribute('data-math-latex', node.attrs.latex)

      const render = (latex) => {
        dom.innerHTML = ''
        try {
          katex.render(latex, dom, { throwOnError: false, displayMode: false })
        } catch {
          dom.textContent = latex
        }
      }
      render(node.attrs.latex)

      dom.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        dom.dispatchEvent(new CustomEvent('math-node-click', {
          bubbles: true,
          detail: { latex: node.attrs.latex, pos: typeof getPos === 'function' ? getPos() : null },
        }))
      })

      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'mathInline') return false
          render(updated.attrs.latex)
          dom.setAttribute('data-math-latex', updated.attrs.latex)
          return true
        },
      }
    }
  },

  addCommands() {
    return {
      insertMathNode: (latex) => ({ chain }) =>
        chain().insertContent({ type: 'mathInline', attrs: { latex } }).run(),
    }
  },
})

// ── Shared extension list ─────────────────────────────────────────

export const richEditorExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
  Underline,
  TextStyle,
  Color,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  MathInline,
]

// ── Utilities ─────────────────────────────────────────────────────

function sanitizePasted(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','br','b','strong','i','em','u','s','ul','ol','li','h1','h2','h3',
      'blockquote','hr','table','thead','tbody','tr','td','th','sup','sub','code','span'],
    ALLOWED_ATTR: ['colspan','rowspan','data-math-latex','style','class'],
  })
}

export function migrateToTiptap(value) {
  if (!value) return null
  if (typeof value === 'object' && value.type === 'doc') return value
  if (typeof value !== 'string' || !value.trim()) return null

  // Try parsing as JSON first (already-stored rich content)
  try {
    const parsed = JSON.parse(value)
    if (parsed && parsed.type === 'doc') return parsed
  } catch {
    // not JSON
  }

  let html
  if (/<[a-z][\s\S]*>/i.test(value)) {
    html = sanitizePasted(value)
  } else {
    html = value
      .split(/\n\n+/)
      .map(p => `<p>${p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`)
      .join('') || '<p></p>'
  }

  try {
    return generateJSON(html, richEditorExtensions)
  } catch {
    return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: String(value) }] }] }
  }
}

export function tiptapToHTML(json) {
  if (!json) return ''
  try { return generateHTML(json, richEditorExtensions) } catch { return '' }
}

export function isTiptapEmpty(value) {
  if (!value) return true
  if (typeof value === 'string') return !value.trim()
  if (typeof value === 'object' && value.type === 'doc') {
    const content = value.content || []
    if (content.length === 0) return true
    if (content.length === 1 && content[0].type === 'paragraph') {
      const inner = content[0].content || []
      return inner.length === 0 || (inner.length === 1 && !inner[0].text?.trim())
    }
    return false
  }
  return true
}

// ── Math symbols / templates ──────────────────────────────────────

const MATH_SYMBOLS = [
  { sym:'−', l:'-' }, { sym:'+', l:'+' }, { sym:'×', l:'\\times' }, { sym:'÷', l:'\\div' },
  { sym:'=', l:'=' }, { sym:'≠', l:'\\neq' }, { sym:'≤', l:'\\leq' }, { sym:'≥', l:'\\geq' },
  { sym:'±', l:'\\pm' }, { sym:'π', l:'\\pi' }, { sym:'θ', l:'\\theta' }, { sym:'°', l:'^{\\circ}' },
  { sym:'√', l:'\\sqrt{}' }, { sym:'∞', l:'\\infty' }, { sym:'∑', l:'\\sum' }, { sym:'∫', l:'\\int' },
  { sym:'α', l:'\\alpha' }, { sym:'β', l:'\\beta' }, { sym:'λ', l:'\\lambda' }, { sym:'σ', l:'\\sigma' },
]

const MATH_TEMPLATES = [
  { label:'Fraction',  latex:'\\frac{a}{b}',  preview:'a⁄b' },
  { label:'Power',     latex:'x^{n}',          preview:'xⁿ' },
  { label:'√ Root',    latex:'\\sqrt{x}',      preview:'√x' },
  { label:'x²',        latex:'x^{2}',          preview:'x²' },
  { label:'x³',        latex:'x^{3}',          preview:'x³' },
  { label:'½',         latex:'\\frac{1}{2}',  preview:'½' },
  { label:'¾',         latex:'\\frac{3}{4}',  preview:'¾' },
  { label:'Subscript', latex:'x_{n}',          preview:'xₙ' },
  { label:'Quadratic', latex:'ax^{2}+bx+c=0', preview:'ax²…' },
  { label:'Log',       latex:'\\log_{b}(x)',  preview:'log' },
  { label:'|x|',       latex:'|x|',            preview:'|x|' },
  { label:'ⁿ√ Root',  latex:'\\sqrt[n]{x}',  preview:'ⁿ√x' },
]

// ── Math Modal ────────────────────────────────────────────────────

function MathModal({ editor, editState, onClose }) {
  const [latex, setLatex] = useState(editState?.latex || MATH_TEMPLATES[0].latex)
  const [selTpl, setSelTpl] = useState(editState ? -1 : 0)
  const [previewHTML, setPreviewHTML] = useState('')
  const [previewErr, setPreviewErr] = useState(false)

  const isEditing = editState !== null

  useEffect(() => {
    try {
      const html = katex.renderToString(latex, { throwOnError: true, displayMode: true })
      setPreviewHTML(html)
      setPreviewErr(false)
    } catch {
      setPreviewErr(true)
      setPreviewHTML('')
    }
  }, [latex])

  const handleSave = () => {
    if (previewErr || !latex.trim()) return
    if (isEditing && editState.pos !== null) {
      const { state, view } = editor
      const tr = state.tr
      tr.setNodeMarkup(editState.pos, undefined, { latex })
      view.dispatch(tr)
    } else {
      editor.chain().focus().insertMathNode(latex).run()
    }
    onClose()
  }

  const handleDelete = () => {
    if (!isEditing || editState.pos === null) return
    const { state, view } = editor
    const node = state.doc.nodeAt(editState.pos)
    if (node) {
      const tr = state.tr
      tr.delete(editState.pos, editState.pos + node.nodeSize)
      view.dispatch(tr)
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[560px] max-w-[96vw] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">{isEditing ? 'Edit Math' : '∑ Insert Math'}</h2>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Quick templates</p>
            <div className="grid grid-cols-4 gap-2">
              {MATH_TEMPLATES.map((t, i) => (
                <button key={i} type="button"
                  className={`rounded-lg border-2 px-2 py-2 text-center transition-all ${selTpl === i ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:border-indigo-300'}`}
                  onClick={() => { setSelTpl(i); setLatex(t.latex) }}
                >
                  <div className="text-sm mb-1">{t.preview}</div>
                  <div className="text-[10px] text-gray-500 font-semibold">{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Symbols</p>
            <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
              {MATH_SYMBOLS.map((s, i) => (
                <button key={i} type="button" title={s.l}
                  className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white font-serif text-sm hover:border-indigo-400 hover:bg-indigo-50"
                  onMouseDown={e => { e.preventDefault(); setLatex(prev => prev + s.l) }}
                >
                  {s.sym}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">LaTeX</p>
            <input
              className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
              value={latex}
              spellCheck={false}
              onChange={e => { setLatex(e.target.value); setSelTpl(-1) }}
              placeholder="\frac{a}{b}"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Preview</p>
            <div className="flex min-h-[54px] items-center justify-center rounded-lg border-2 border-gray-200 bg-gray-50 px-4 py-3">
              {previewHTML
                ? <span dangerouslySetInnerHTML={{ __html: previewHTML }} />
                : <span className="text-sm text-red-500">{previewErr ? 'Invalid LaTeX' : '…'}</span>
              }
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
          {isEditing && (
            <button onClick={handleDelete} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
              Delete
            </button>
          )}
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={previewErr || !latex.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {isEditing ? 'Update Math' : 'Insert Math'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Table Modal ───────────────────────────────────────────────────

function TableModal({ editor, onClose }) {
  const [hover, setHover] = useState([0, 0])

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-72 rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-bold text-gray-900">⊞ Insert Table</h2>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">×</button>
        </div>
        <div className="px-5 py-4">
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(8, 28px)' }}>
            {Array.from({ length: 6 }, (_, r) =>
              Array.from({ length: 8 }, (_, c) => (
                <div key={`${r}-${c}`}
                  className={`h-7 w-7 cursor-pointer rounded border transition-all ${r < hover[0] && c < hover[1] ? 'border-indigo-500 bg-indigo-100' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                  onMouseEnter={() => setHover([r + 1, c + 1])}
                  onClick={() => { editor.chain().focus().insertTable({ rows: hover[0], cols: hover[1], withHeaderRow: true }).run(); onClose() }}
                />
              ))
            )}
          </div>
          <p className="mt-3 text-center text-xs font-semibold text-gray-500">
            {hover[0] > 0 ? `${hover[0]} × ${hover[1]}` : 'Hover to pick size'}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────

function Toolbar({ editor, onMath, onTable, focusColor }) {
  const [showTextColor, setShowTextColor] = useState(false)
  const [showHighlight, setShowHighlight] = useState(false)

  if (!editor) return <div className="h-9 border-b border-gray-200 bg-gray-50" />

  const TEXT_COLORS = ['#0f172a','#1e3a8a','#dc2626','#ea580c','#ca8a04','#15803d','#2563eb','#7c3aed']
  const HL_COLORS   = ['#fef08a','#bbf7d0','#bfdbfe','#ddd6fe','#fce7f3','#fee2e2']

  const Btn = ({ title, active, onClick, children, className = '' }) => (
    <button type="button" title={title}
      className={`flex h-6 min-w-[24px] items-center justify-center rounded px-1 text-xs transition-colors
        ${active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-200'} ${className}`}
      onMouseDown={e => { e.preventDefault(); onClick() }}
    >
      {children}
    </button>
  )

  const inTable = editor.isActive('table')

  return (
    <div className={`border-b ${focusColor === 'orange' ? 'border-orange-200' : 'border-gray-200'} bg-gray-50`}>
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
        {/* History */}
        <Btn title="Undo" onClick={() => editor.chain().focus().undo().run()}>↩</Btn>
        <Btn title="Redo" onClick={() => editor.chain().focus().redo().run()}>↪</Btn>
        <div className="mx-1 h-4 w-px bg-gray-300" />

        {/* Text formatting */}
        <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <b style={{ fontWeight: 800 }}>B</b>
        </Btn>
        <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </Btn>
        <Btn title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <u>U</u>
        </Btn>
        <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <s>S</s>
        </Btn>
        <div className="mx-1 h-4 w-px bg-gray-300" />

        {/* Lists */}
        <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1≡</Btn>
        <div className="mx-1 h-4 w-px bg-gray-300" />

        {/* Align */}
        <Btn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>⬅≡</Btn>
        <Btn title="Center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>≡</Btn>
        <Btn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>≡➡</Btn>
        <div className="mx-1 h-4 w-px bg-gray-300" />

        {/* Text color */}
        <div className="relative">
          <Btn title="Text colour" onClick={() => { setShowHighlight(false); setShowTextColor(v => !v) }}>
            <span className="flex flex-col items-center gap-0.5">
              <span className="text-xs font-bold leading-none">A</span>
              <span className="h-0.5 w-3 rounded bg-red-600" />
            </span>
          </Btn>
          {showTextColor && (
            <div className="absolute top-full left-0 z-50 mt-1 grid grid-cols-4 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
              {TEXT_COLORS.map(c => (
                <div key={c} className="h-5 w-5 cursor-pointer rounded border border-black/10 transition-transform hover:scale-125"
                  style={{ background: c }}
                  onMouseDown={e => { e.preventDefault(); editor.chain().focus().setColor(c).run(); setShowTextColor(false) }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Highlight */}
        <div className="relative">
          <Btn title="Highlight" onClick={() => { setShowTextColor(false); setShowHighlight(v => !v) }}>🖌</Btn>
          {showHighlight && (
            <div className="absolute top-full left-0 z-50 mt-1 grid grid-cols-3 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
              {HL_COLORS.map(c => (
                <div key={c} className="h-5 w-5 cursor-pointer rounded border border-black/10 transition-transform hover:scale-125"
                  style={{ background: c }}
                  onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: c }).run(); setShowHighlight(false) }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="mx-1 h-4 w-px bg-gray-300" />

        {/* Headings */}
        <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Btn>
        <Btn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Btn>
        <div className="mx-1 h-4 w-px bg-gray-300" />

        {/* Math & Table */}
        <Btn title="Insert Math" onClick={onMath}
          className="gap-1 border border-indigo-200 bg-indigo-50 px-2 text-indigo-700 hover:bg-indigo-100">
          ∑ Math
        </Btn>
        <Btn title="Insert Table" onClick={onTable}
          className="gap-1 border border-indigo-200 bg-indigo-50 px-2 text-indigo-700 hover:bg-indigo-100">
          ⊞ Table
        </Btn>
      </div>

      {/* Table controls */}
      {inTable && (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-indigo-100 bg-indigo-50/50 px-2 py-1">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600">Table:</span>
          <Btn title="Add row above" onClick={() => editor.chain().focus().addRowBefore().run()}>+Row↑</Btn>
          <Btn title="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}>+Row↓</Btn>
          <Btn title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()} className="text-red-500">−Row</Btn>
          <div className="mx-1 h-4 w-px bg-indigo-200" />
          <Btn title="Add column left" onClick={() => editor.chain().focus().addColumnBefore().run()}>+Col←</Btn>
          <Btn title="Add column right" onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col→</Btn>
          <Btn title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()} className="text-red-500">−Col</Btn>
          <div className="mx-1 h-4 w-px bg-indigo-200" />
          <Btn title="Merge cells" onClick={() => editor.chain().focus().mergeCells().run()}>⊞Merge</Btn>
          <Btn title="Split cell" onClick={() => editor.chain().focus().splitCell().run()}>⊡Split</Btn>
          <Btn title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()} className="text-red-500">✕Table</Btn>
        </div>
      )}
    </div>
  )
}

// ── RichEditor (main export) ──────────────────────────────────────

/**
 * RichEditor — Tiptap-based rich text editor.
 *
 * Props:
 *  value         — string (plain/HTML/JSON-stringified) | Tiptap JSON object | null
 *  onChange      — called with Tiptap JSON object on every update
 *  placeholder   — placeholder text
 *  minHeight     — min height of editable area in px (default 90)
 *  borderClass   — Tailwind border class when unfocused (default 'border-gray-200')
 *  focusClass    — Tailwind border class on focus (default 'border-indigo-500')
 *  focusColor    — 'indigo' | 'orange' | 'green' for theme accents (default 'indigo')
 */
export default function RichEditor({
  value,
  onChange,
  placeholder = 'Type here…',
  minHeight = 90,
  borderClass = 'border-gray-200',
  focusClass = 'focus-within:border-indigo-500',
  focusColor = 'indigo',
}) {
  const [mathModal, setMathModal] = useState(false)
  const [tableModal, setTableModal] = useState(false)
  const [mathEditState, setMathEditState] = useState(null)

  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Migrate initial value once
  const initialContent = useRef(migrateToTiptap(value) || '<p></p>')

  const extensionsWithPlaceholder = [
    ...richEditorExtensions,
    Placeholder.configure({ placeholder }),
  ]

  const editor = useEditor({
    extensions: extensionsWithPlaceholder,
    content: initialContent.current,
    onUpdate({ editor }) {
      onChangeRef.current?.(editor.getJSON())
    },
    editorProps: {
      attributes: { class: 'rich-editor-prose' },
      transformPastedHTML: sanitizePasted,
    },
  })

  // Listen for math-node-click from NodeViews
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const handler = (e) => {
      setMathEditState({ latex: e.detail.latex, pos: e.detail.pos })
      setMathModal(true)
    }
    dom.addEventListener('math-node-click', handler)
    return () => dom.removeEventListener('math-node-click', handler)
  }, [editor])

  const openMathInsert = useCallback(() => { setMathEditState(null); setMathModal(true) }, [])
  const openTable = useCallback(() => setTableModal(true), [])

  const ringColor = focusColor === 'orange' ? 'focus-within:ring-orange-100' : focusColor === 'green' ? 'focus-within:ring-green-100' : 'focus-within:ring-indigo-100'

  return (
    <div className={`overflow-hidden rounded-xl border-2 transition-colors ${borderClass} ${focusClass} focus-within:ring-2 ${ringColor}`}>
      <Toolbar editor={editor} onMath={openMathInsert} onTable={openTable} focusColor={focusColor} />
      <div style={{ minHeight }} className="rich-editor-wrap">
        <EditorContent editor={editor} />
      </div>

      {mathModal && (
        <MathModal
          editor={editor}
          editState={mathEditState}
          onClose={() => { setMathModal(false); setMathEditState(null) }}
        />
      )}
      {tableModal && (
        <TableModal editor={editor} onClose={() => setTableModal(false)} />
      )}
    </div>
  )
}
