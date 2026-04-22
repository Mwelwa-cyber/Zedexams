/**
 * src/editor/components/EditorToolbar.jsx
 *
 * Full editor toolbar + contextual table strip.
 * Visual design: identical to the working demo.
 * Commands: all Tiptap chain commands - zero execCommand.
 *
 * Props:
 *   editor    {object|null}   The Tiptap editor instance from useEditor()
 *   onMath    {function}      Open the math modal
 *   onTable   {function}      Open the table modal
 *
 * Re-renders automatically through useEditorState subscriptions.
 */

import { useEditorState } from '@tiptap/react'
import { useState } from 'react'
// Real icons (Heroicons via the shared wrapper) instead of Unicode glyphs.
// Unicode characters were rendering as literal text in many browsers
// ("↩↪ BIUS • ≡ 1.≡ ⬅≡≡≡➡ H1H2") — which looked like toolbar bleed even
// though it was just the button labels. Icons here, styled text for H1/H2.
import {
  Undo2, Redo2,
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
  TableIcon,
} from '../../components/ui/icons'

const TX_COLORS = [
  '#1a1523', '#1e3a8a', '#dc2626', '#ea580c', '#ca8a04',
  '#15803d', '#2563eb', '#7c3aed', '#be185d', '#64748b',
]
const HL_COLORS = [
  '#fef08a', '#bbf7d0', '#bfdbfe', '#ddd6fe',
  '#fce7f3', '#fee2e2', '#fed7aa', '#e0f2fe',
]

const EMPTY_TOOLBAR_STATE = {
  inTable: false,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  bulletList: false,
  orderedList: false,
  alignLeft: false,
  alignCenter: false,
  alignRight: false,
  heading1: false,
  heading2: false,
  headerCell: false,
  canUndo: false,
  canRedo: false,
  canAddRowBefore: false,
  canAddRowAfter: false,
  canDeleteRow: false,
  canAddColumnBefore: false,
  canAddColumnAfter: false,
  canDeleteColumn: false,
  canMergeCells: false,
  canSplitCell: false,
  canToggleHeaderRow: false,
  canDeleteTable: false,
}

function safeIsActive(editor, ...args) {
  try {
    return Boolean(editor?.isActive?.(...args))
  } catch {
    return false
  }
}

function canRun(editor, cmd, args) {
  if (!editor || !cmd) return false

  try {
    const chain = editor.can().chain().focus()
    return args === undefined
      ? chain[cmd]().run()
      : chain[cmd](args).run()
  } catch {
    return false
  }
}

function runCommand(editor, cmd, args) {
  if (!editor || !cmd) return

  try {
    const chain = editor.chain().focus()
    if (args === undefined) chain[cmd]().run()
    else chain[cmd](args).run()
  } catch {
    // Ignore invalid commands for the current selection.
  }
}

function TBtn({
  editor, cmd, args, title, active = false, disabled = false, children, extraClass = '', onMouseDown,
}) {
  const handleMouseDown = (e) => {
    e.preventDefault()
    if (disabled) return
    if (onMouseDown) {
      onMouseDown(e)
      return
    }
    runCommand(editor, cmd, args)
  }

  return (
    <button
      type="button"
      className={`tbb${active ? ' on' : ''}${extraClass ? ' ' + extraClass : ''}`}
      title={title}
      onMouseDown={handleMouseDown}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export default function EditorToolbar({ editor, onMath, onTable }) {
  const [showTxColor, setShowTxColor] = useState(false)
  const [showHlColor, setShowHlColor] = useState(false)
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      // Tiptap v3 can run this selector against an editor whose view
      // hasn't mounted yet (ueberdosis/tiptap#7346). Calling isActive /
      // editor.can() in that state throws "The editor view is not
      // available" and unmounts the whole page on hard refresh.
      if (!currentEditor?.isInitialized) return EMPTY_TOOLBAR_STATE

      return {
        inTable: safeIsActive(currentEditor, 'table'),
        bold: safeIsActive(currentEditor, 'bold'),
        italic: safeIsActive(currentEditor, 'italic'),
        underline: safeIsActive(currentEditor, 'underline'),
        strike: safeIsActive(currentEditor, 'strike'),
        superscript: safeIsActive(currentEditor, 'superscript'),
        subscript: safeIsActive(currentEditor, 'subscript'),
        bulletList: safeIsActive(currentEditor, 'bulletList'),
        orderedList: safeIsActive(currentEditor, 'orderedList'),
        alignLeft: safeIsActive(currentEditor, { textAlign: 'left' }),
        alignCenter: safeIsActive(currentEditor, { textAlign: 'center' }),
        alignRight: safeIsActive(currentEditor, { textAlign: 'right' }),
        heading1: safeIsActive(currentEditor, 'heading', { level: 1 }),
        heading2: safeIsActive(currentEditor, 'heading', { level: 2 }),
        headerCell: safeIsActive(currentEditor, 'tableHeader'),
        canUndo: canRun(currentEditor, 'undo'),
        canRedo: canRun(currentEditor, 'redo'),
        canAddRowBefore: canRun(currentEditor, 'addRowBefore'),
        canAddRowAfter: canRun(currentEditor, 'addRowAfter'),
        canDeleteRow: canRun(currentEditor, 'deleteRow'),
        canAddColumnBefore: canRun(currentEditor, 'addColumnBefore'),
        canAddColumnAfter: canRun(currentEditor, 'addColumnAfter'),
        canDeleteColumn: canRun(currentEditor, 'deleteColumn'),
        canMergeCells: canRun(currentEditor, 'mergeCells'),
        canSplitCell: canRun(currentEditor, 'splitCell'),
        canToggleHeaderRow: canRun(currentEditor, 'toggleHeaderRow'),
        canDeleteTable: canRun(currentEditor, 'deleteTable'),
      }
    },
  }) || EMPTY_TOOLBAR_STATE

  if (!editor?.isInitialized) return <div className="toolbar" />

  const run = (cmd, args) => runCommand(editor, cmd, args)

  return (
    <>
      <div className="toolbar">

        {/* -- History -- */}
        <TBtn
          editor={editor}
          title="Undo (Ctrl+Z)"
          disabled={!toolbarState.canUndo}
          onMouseDown={(e) => { e.preventDefault(); run('undo') }}
        >
          <Undo2 size={15} strokeWidth={2.25} />
        </TBtn>
        <TBtn
          editor={editor}
          title="Redo (Ctrl+Y)"
          disabled={!toolbarState.canRedo}
          onMouseDown={(e) => { e.preventDefault(); run('redo') }}
        >
          <Redo2 size={15} strokeWidth={2.25} />
        </TBtn>
        <div className="tbsep" />

        {/* -- Text format -- */}
        <TBtn editor={editor} cmd="toggleBold" active={toolbarState.bold} title="Bold (Ctrl+B)">
          <Bold size={15} strokeWidth={2.5} />
        </TBtn>
        <TBtn editor={editor} cmd="toggleItalic" active={toolbarState.italic} title="Italic (Ctrl+I)">
          <Italic size={15} strokeWidth={2.5} />
        </TBtn>
        <TBtn editor={editor} cmd="toggleUnderline" active={toolbarState.underline} title="Underline (Ctrl+U)">
          <Underline size={15} strokeWidth={2.5} />
        </TBtn>
        <TBtn editor={editor} cmd="toggleStrike" active={toolbarState.strike} title="Strikethrough">
          <Strikethrough size={15} strokeWidth={2.5} />
        </TBtn>
        <div className="tbsep" />

        {/* -- Super / Sub --
            Text labels x² / x₂ are the standard across Word, Docs, and most
            web editors — clearer than any available icon in the Heroicons
            set (Superscript/Subscript in icons.js are mis-mapped to H1/H2). */}
        <TBtn editor={editor} cmd="toggleSuperscript" active={toolbarState.superscript} title="Superscript">
          <span style={{ fontWeight: 700, fontSize: '12px', lineHeight: 1 }}>x²</span>
        </TBtn>
        <TBtn editor={editor} cmd="toggleSubscript" active={toolbarState.subscript} title="Subscript">
          <span style={{ fontWeight: 700, fontSize: '12px', lineHeight: 1 }}>x₂</span>
        </TBtn>
        <div className="tbsep" />

        {/* -- Lists -- */}
        <TBtn editor={editor} cmd="toggleBulletList" active={toolbarState.bulletList} title="Bullet list">
          <List size={15} strokeWidth={2.25} />
        </TBtn>
        <TBtn editor={editor} cmd="toggleOrderedList" active={toolbarState.orderedList} title="Numbered list">
          <ListOrdered size={15} strokeWidth={2.25} />
        </TBtn>
        <div className="tbsep" />

        {/* -- Alignment -- */}
        <TBtn editor={editor} cmd="setTextAlign" args="left" active={toolbarState.alignLeft} title="Align left">
          <AlignLeft size={15} strokeWidth={2.25} />
        </TBtn>
        <TBtn editor={editor} cmd="setTextAlign" args="center" active={toolbarState.alignCenter} title="Centre">
          <AlignCenter size={15} strokeWidth={2.25} />
        </TBtn>
        <TBtn editor={editor} cmd="setTextAlign" args="right" active={toolbarState.alignRight} title="Align right">
          <AlignRight size={15} strokeWidth={2.25} />
        </TBtn>
        <div className="tbsep" />

        {/* -- Headings --
            No H1/H2 icons in the set. Styled text labels ARE the standard
            for heading buttons in Word / Docs / every rich-text UI. */}
        <TBtn editor={editor} cmd="toggleHeading" args={{ level: 1 }} active={toolbarState.heading1} title="Heading 1">
          <span style={{ fontWeight: 800, fontSize: '12px', lineHeight: 1 }}>H1</span>
        </TBtn>
        <TBtn editor={editor} cmd="toggleHeading" args={{ level: 2 }} active={toolbarState.heading2} title="Heading 2">
          <span style={{ fontWeight: 800, fontSize: '12px', lineHeight: 1 }}>H2</span>
        </TBtn>
        <div className="tbsep" />

        {/* -- Text colour -- */}
        <div className="crel">
          <button
            type="button" className="tbb" title="Text colour"
            onMouseDown={(e) => { e.preventDefault(); setShowHlColor(false); setShowTxColor((v) => !v) }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <span style={{ fontWeight: 900, fontSize: '12px', lineHeight: 1 }}>A</span>
              <span style={{ width: '13px', height: '3px', background: '#dc2626', borderRadius: '2px' }} />
            </span>
          </button>
          {showTxColor && (
            <div className="cpop">
              {TX_COLORS.map((c) => (
                <div
                  key={c} className="sw" style={{ background: c }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.chain().focus().setColor(c).run()
                    setShowTxColor(false)
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* -- Highlight -- */}
        <div className="crel">
          <button
            type="button" className="tbb" title="Highlight"
            onMouseDown={(e) => { e.preventDefault(); setShowTxColor(false); setShowHlColor((v) => !v) }}
          >
            🖌
          </button>
          {showHlColor && (
            <div className="cpop" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {HL_COLORS.map((c) => (
                <div
                  key={c} className="sw" style={{ background: c }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.chain().focus().toggleHighlight({ color: c }).run()
                    setShowHlColor(false)
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="tbsep" />

        {/* -- Math + Table -- */}
        <button
          type="button" className="tbb tbm" title="Insert Math"
          onMouseDown={(e) => { e.preventDefault(); onMath() }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
        >
          <span style={{ fontWeight: 900, fontSize: '14px', lineHeight: 1 }}>Σ</span>
          Math
        </button>
        <button
          type="button" className="tbb tbt" title="Insert Table"
          onMouseDown={(e) => { e.preventDefault(); onTable() }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
        >
          <TableIcon size={14} strokeWidth={2.25} />
          Table
        </button>
      </div>

      {/* -- Contextual table controls -- */}
      {toolbarState.inTable && (
        <div className="tblstrip">
          <span className="tblslbl">Table:</span>

          <button
            type="button"
            className="tbb"
            disabled={!toolbarState.canAddRowBefore}
            onMouseDown={(e) => { e.preventDefault(); run('addRowBefore') }}
            title="Add row before"
          >
            +Row↑
          </button>
          <button
            type="button"
            className="tbb"
            disabled={!toolbarState.canAddRowAfter}
            onMouseDown={(e) => { e.preventDefault(); run('addRowAfter') }}
            title="Add row after"
          >
            +Row↓
          </button>
          <button
            type="button"
            className="tbb tbd"
            disabled={!toolbarState.canDeleteRow}
            onMouseDown={(e) => { e.preventDefault(); run('deleteRow') }}
            title="Delete row"
          >
            −Row
          </button>

          <div className="tbsep" />

          <button
            type="button"
            className="tbb"
            disabled={!toolbarState.canAddColumnBefore}
            onMouseDown={(e) => { e.preventDefault(); run('addColumnBefore') }}
            title="Add column before"
          >
            +Col←
          </button>
          <button
            type="button"
            className="tbb"
            disabled={!toolbarState.canAddColumnAfter}
            onMouseDown={(e) => { e.preventDefault(); run('addColumnAfter') }}
            title="Add column after"
          >
            +Col→
          </button>
          <button
            type="button"
            className="tbb tbd"
            disabled={!toolbarState.canDeleteColumn}
            onMouseDown={(e) => { e.preventDefault(); run('deleteColumn') }}
            title="Delete column"
          >
            −Col
          </button>

          <div className="tbsep" />

          <button
            type="button"
            className="tbb"
            disabled={!toolbarState.canMergeCells}
            onMouseDown={(e) => { e.preventDefault(); run('mergeCells') }}
            title="Merge selected cells"
          >
            ⊞Merge
          </button>
          <button
            type="button"
            className="tbb"
            disabled={!toolbarState.canSplitCell}
            onMouseDown={(e) => { e.preventDefault(); run('splitCell') }}
            title="Split merged cell"
          >
            ⊡Split
          </button>
          <button
            type="button"
            className={`tbb${toolbarState.headerCell ? ' on' : ''}`}
            disabled={!toolbarState.canToggleHeaderRow}
            onMouseDown={(e) => { e.preventDefault(); run('toggleHeaderRow') }}
            title="Toggle header row"
          >
            Header
          </button>

          <div className="tbsep" />

          <button
            type="button"
            className="tbb tbd"
            disabled={!toolbarState.canDeleteTable}
            onMouseDown={(e) => { e.preventDefault(); run('deleteTable') }}
            title="Delete this table"
          >
            ✕ Table
          </button>
        </div>
      )}
    </>
  )
}
