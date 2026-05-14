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

// Touch-safe handler pair for toolbar buttons.
//
// Calling e.preventDefault() inside onMouseDown blocks the subsequent click
// on mobile browsers ("like pictures — not working" symptom). The fix is
// to split the two responsibilities:
//   onMouseDown → prevent editor blur only
//   onClick     → actually run the command (works on mouse AND touch)
//
// Spread the returned object into any <button>:
//   <button {...tap(() => run('addRowBefore'))} />
function tap(fn, disabled = false) {
  return {
    onMouseDown: (e) => e.preventDefault(),
    onClick: (e) => { e.preventDefault(); if (!disabled) fn() },
  }
}

function TBtn({
  editor, cmd, args, title, active = false, disabled = false, children, extraClass = '', onAction,
}) {
  // TOUCH FIX — separate preventDefault from the action.
  //
  // Previous version did `e.preventDefault()` AND the command run inside
  // the same `onMouseDown` handler. On mobile browsers, preventDefault
  // in mousedown BLOCKS the subsequent click from firing. Result: buttons
  // looked right but didn't activate — user described this as "like pictures."
  //
  // Fix: onMouseDown only prevents the editor blur (necessary to keep the
  // selection). onClick runs the command — this fires for both mouse clicks
  // and touch taps reliably across all browsers.

  const preventBlur = (e) => e.preventDefault()

  const handleClick = (e) => {
    if (disabled) return
    e.preventDefault()
    if (onAction) {
      onAction(e)
      return
    }
    runCommand(editor, cmd, args)
  }

  return (
    <button
      type="button"
      className={`tbb${active ? ' on' : ''}${extraClass ? ' ' + extraClass : ''}`}
      title={title}
      onMouseDown={preventBlur}
      onClick={handleClick}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export default function EditorToolbar({
  editor,
  onMath,
  onTable,
  onVerticalArithmetic,
  onFraction,
  onNumberBase,
  // 'full' (default) shows headings, alignment, colour, table, etc.
  // 'compact' is the answer-option variant: Bold/Italic/Underline, sup/sub,
  // and the full Grade-7 math toolset. No headings, no alignment, no table,
  // no colour pickers — those don't make sense inside a short answer choice.
  variant = 'full',
}) {
  const [showTxColor, setShowTxColor] = useState(false)
  const [showHlColor, setShowHlColor] = useState(false)
  // Mobile overflow sheet — shown when the screen is narrow enough that
  // the secondary math buttons would crowd the toolbar.
  const [showMoreMath, setShowMoreMath] = useState(false)
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
          onAction={() => run('undo')}
        >
          <Undo2 size={15} strokeWidth={2.25} />
        </TBtn>
        <TBtn
          editor={editor}
          title="Redo (Ctrl+Y)"
          disabled={!toolbarState.canRedo}
          onAction={() => run('redo')}
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

        {/* Lists / alignment / headings / colour are hidden inside answer
            options (variant === 'compact') — an option row is too narrow,
            and these formats don't apply to a single-line choice anyway. */}
        {variant !== 'compact' && (
          <>
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
          </>
        )}

        {/* Text colour + highlight: also full-only. */}
        {variant !== 'compact' && (<>
        {/* -- Text colour --
            onMouseDown only prevents editor blur; onClick is what actually
            runs (required for touch, see TBtn comment above). */}
        <div className="crel">
          <button
            type="button" className="tbb" title="Text colour"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); setShowHlColor(false); setShowTxColor((v) => !v) }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <span style={{ fontWeight: 900, fontSize: '12px', lineHeight: 1 }}>A</span>
              <span style={{ width: '13px', height: '3px', background: '#dc2626', borderRadius: '2px' }} />
            </span>
          </button>
          {showTxColor && (
            <div className="cpop">
              {TX_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="sw"
                  style={{ background: c }}
                  aria-label={`Set text colour ${c}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
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
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); setShowTxColor(false); setShowHlColor((v) => !v) }}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {/* Highlighter glyph drawn with inline SVG so we don't need
                an emoji that renders inconsistently across OSes. */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d="M9 11l-4 4h4l4-4" />
              <path d="M15 5l4 4-9 9H6v-4l9-9z" />
              <path d="M3 21h18" />
            </svg>
          </button>
          {showHlColor && (
            <div className="cpop" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {HL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="sw"
                  style={{ background: c }}
                  aria-label={`Highlight ${c}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
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
        </>)}

        {/* -- Math toolset --
            Primary Grade-7 math buttons. Wrapped in `.tbb-math-primary`
            so the desktop layout shows them inline; on phones the CSS
            hides them behind the "More Math" sheet below.

            Same touch-safe pattern: blur-prevention on mousedown,
            action on click. */}
        <button
          type="button" className="tbb tbm" title="Insert Math (LaTeX)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.preventDefault(); onMath() }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
        >
          <span style={{ fontWeight: 900, fontSize: '14px', lineHeight: 1 }}>Σ</span>
          Math
        </button>

        <button
          type="button"
          className="tbb tbmath tbb-math-primary"
          title="Insert fraction (proper, improper, or mixed)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.preventDefault(); onFraction && onFraction() }}
          aria-label="Insert fraction"
        >
          <span className="tb-frac-icon" aria-hidden="true">
            <span className="tb-frac-n">a</span>
            <span className="tb-frac-d">b</span>
          </span>
          <span className="tbb-text">Fraction</span>
        </button>

        <button
          type="button"
          className="tbb tbmath tbb-math-secondary"
          title="Vertical addition / subtraction / multiplication / division"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.preventDefault(); onVerticalArithmetic && onVerticalArithmetic() }}
          aria-label="Insert vertical arithmetic"
        >
          <span className="tb-va-icon" aria-hidden="true">⊟</span>
          <span className="tbb-text">Vertical</span>
        </button>

        <TBtn
          editor={editor}
          cmd="toggleSuperscript"
          active={toolbarState.superscript}
          title="Superscript / Power (x²)"
          extraClass="tbb-math-secondary"
        >
          <span style={{ fontWeight: 700, fontSize: '12px', lineHeight: 1 }}>x²</span>
        </TBtn>

        <button
          type="button"
          className="tbb tbb-math-secondary"
          title="Insert number base (e.g. 313₅)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.preventDefault(); onNumberBase && onNumberBase() }}
          aria-label="Insert number base"
        >
          <span style={{ fontWeight: 700, fontSize: '12px', lineHeight: 1 }}>n<sub style={{ fontSize: '9px' }}>b</sub></span>
        </button>

        <button
          type="button"
          className="tbb tbb-math-secondary"
          title="Insert square root"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            editor?.chain().focus().insertMathNode('\\sqrt{}').run()
          }}
          aria-label="Insert square root"
        >
          <span style={{ fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>√</span>
        </button>

        <button
          type="button"
          className="tbb tbb-math-secondary"
          title="Insert brackets ( )"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            editor?.chain().focus().insertContent('()').run()
          }}
          aria-label="Insert brackets"
        >
          <span style={{ fontWeight: 700, fontSize: '13px', lineHeight: 1 }}>( )</span>
        </button>

        {/* Mobile-only "More math" button — opens an overflow sheet with
            buttons that the narrow layout hides. CSS toggles visibility. */}
        <button
          type="button"
          className="tbb tbb-math-more"
          title="More math tools"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.preventDefault(); setShowMoreMath((v) => !v) }}
          aria-expanded={showMoreMath}
          aria-label="More math tools"
        >
          <span style={{ fontWeight: 700, fontSize: '12px', lineHeight: 1 }}>+Math</span>
        </button>

        <div className="tbsep" />

        {/* Table button is hidden in the compact (answer-option) variant —
            an answer choice never wraps a table. */}
        {variant !== 'compact' && (
          <button
            type="button" className="tbb tbt" title="Insert Table"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); onTable() }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <TableIcon size={14} strokeWidth={2.25} />
            Table
          </button>
        )}
      </div>

      {/* Mobile-only "more math" sheet. CSS hides this on desktop; on
          phones it slides under the toolbar with the secondary math
          tools (subscript, vertical, base, sqrt, brackets) for one-tap
          reach without scrolling the toolbar. */}
      {showMoreMath && (
        <div className="more-math-sheet" role="group" aria-label="Math tools">
          <button
            type="button"
            className="tbb tbmath"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); setShowMoreMath(false); onFraction && onFraction() }}
          >
            <span className="tb-frac-icon" aria-hidden="true">
              <span className="tb-frac-n">a</span>
              <span className="tb-frac-d">b</span>
            </span>
            <span>Fraction</span>
          </button>
          <button
            type="button"
            className="tbb tbmath"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); setShowMoreMath(false); onVerticalArithmetic && onVerticalArithmetic() }}
          >
            <span aria-hidden="true">⊟</span>
            <span>Vertical sum</span>
          </button>
          <button
            type="button"
            className={`tbb${toolbarState.superscript ? ' on' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              setShowMoreMath(false)
              runCommand(editor, 'toggleSuperscript')
            }}
          >
            <span>x²</span>
            <span>Power</span>
          </button>
          <button
            type="button"
            className={`tbb${toolbarState.subscript ? ' on' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              setShowMoreMath(false)
              runCommand(editor, 'toggleSubscript')
            }}
          >
            <span>x₂</span>
            <span>Subscript</span>
          </button>
          <button
            type="button"
            className="tbb"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); setShowMoreMath(false); onNumberBase && onNumberBase() }}
          >
            <span>nᵇ</span>
            <span>Number base</span>
          </button>
          <button
            type="button"
            className="tbb"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              setShowMoreMath(false)
              editor?.chain().focus().insertMathNode('\\sqrt{}').run()
            }}
          >
            <span>√</span>
            <span>Square root</span>
          </button>
          <button
            type="button"
            className="tbb"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              setShowMoreMath(false)
              editor?.chain().focus().insertContent('()').run()
            }}
          >
            <span>( )</span>
            <span>Brackets</span>
          </button>
        </div>
      )}

      {/* -- Contextual table controls --
          Every button here uses the touch-safe tap(fn, disabled) helper
          so taps register on mobile. See tap() definition above. */}
      {toolbarState.inTable && (
        <div className="tblstrip">
          <span className="tblslbl">Table:</span>

          <button
            type="button" className="tbb" title="Add row before"
            disabled={!toolbarState.canAddRowBefore}
            {...tap(() => run('addRowBefore'), !toolbarState.canAddRowBefore)}
          >
            +Row↑
          </button>
          <button
            type="button" className="tbb" title="Add row after"
            disabled={!toolbarState.canAddRowAfter}
            {...tap(() => run('addRowAfter'), !toolbarState.canAddRowAfter)}
          >
            +Row↓
          </button>
          <button
            type="button" className="tbb tbd" title="Delete row"
            disabled={!toolbarState.canDeleteRow}
            {...tap(() => run('deleteRow'), !toolbarState.canDeleteRow)}
          >
            −Row
          </button>

          <div className="tbsep" />

          <button
            type="button" className="tbb" title="Add column before"
            disabled={!toolbarState.canAddColumnBefore}
            {...tap(() => run('addColumnBefore'), !toolbarState.canAddColumnBefore)}
          >
            +Col←
          </button>
          <button
            type="button" className="tbb" title="Add column after"
            disabled={!toolbarState.canAddColumnAfter}
            {...tap(() => run('addColumnAfter'), !toolbarState.canAddColumnAfter)}
          >
            +Col→
          </button>
          <button
            type="button" className="tbb tbd" title="Delete column"
            disabled={!toolbarState.canDeleteColumn}
            {...tap(() => run('deleteColumn'), !toolbarState.canDeleteColumn)}
          >
            −Col
          </button>

          <div className="tbsep" />

          <button
            type="button" className="tbb" title="Merge selected cells"
            disabled={!toolbarState.canMergeCells}
            {...tap(() => run('mergeCells'), !toolbarState.canMergeCells)}
          >
            ⊞Merge
          </button>
          <button
            type="button" className="tbb" title="Split merged cell"
            disabled={!toolbarState.canSplitCell}
            {...tap(() => run('splitCell'), !toolbarState.canSplitCell)}
          >
            ⊡Split
          </button>
          <button
            type="button"
            className={`tbb${toolbarState.headerCell ? ' on' : ''}`}
            title="Toggle header row"
            disabled={!toolbarState.canToggleHeaderRow}
            {...tap(() => run('toggleHeaderRow'), !toolbarState.canToggleHeaderRow)}
          >
            Header
          </button>

          <div className="tbsep" />

          <button
            type="button" className="tbb tbd" title="Delete this table"
            disabled={!toolbarState.canDeleteTable}
            {...tap(() => run('deleteTable'), !toolbarState.canDeleteTable)}
          >
            ✕ Table
          </button>
        </div>
      )}
    </>
  )
}
