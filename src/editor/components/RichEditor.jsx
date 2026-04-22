/**
 * src/editor/components/RichEditor.jsx
 *
 * A single rich-text editor field powered by @tiptap/react.
 *
 * MULTI-EDITOR SAFETY:
 *   Each field (Instructions, Passage, Question, Explanation) is a separate
 *   instance of this component, creating its own independent Tiptap editor.
 *   @tiptap/react's useEditor() hook manages the editor lifecycle correctly:
 *     - Creates the editor once on mount
 *     - Destroys it automatically on unmount (no manual cleanup needed)
 *     - Each instance owns its own ProseMirror state
 *
 *   The CustomEvent listener for math-node-click IS manually cleaned up
 *   because it is added via addEventListener (outside React's lifecycle).
 *
 * UNDO / REDO SAFETY:
 *   All content mutations go through Tiptap's transaction system.
 *   History (built into StarterKit) tracks every transaction.
 *   This means:
 *     - Typing, formatting, math insert/edit/delete, table ops — all undoable
 *     - Ctrl+Z / Ctrl+Y work correctly inside each field independently
 *     - Fields do NOT share undo history (each has its own History stack)
 *
 * CHANGE PROPAGATION:
 *   onChange is called with Tiptap JSON on every editor update.
 *   We store the callback in a ref to avoid re-creating the editor when the
 *   parent re-renders (which would lose cursor position).
 *
 * Props:
 *   label         {string}          Optional field label
 *   badge         {string}          Optional badge text (e.g. "Optional", "Required")
 *   badgeCls      {string}          CSS class for badge (bopt | breq | bafter)
 *   initialContent{object|string}   Tiptap JSON or HTML string (legacy). Pass null for empty.
 *   onChange      {function}        Called with Tiptap JSON on each update
 *   placeholder   {string}          Placeholder text
 *   minHeight     {number}          Min height in px (default 85)
 *   readOnly      {boolean}         Disable editing (for preview)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { buildExtensions } from '../extensions/buildExtensions.js'
import { migrateContent } from '../utils/migration.js'
import { sanitizePastedHTML } from '../utils/sanitize.js'
import EditorToolbar from './EditorToolbar.jsx'
import MathModal from './modals/MathModal.jsx'
import TableModal from './modals/TableModal.jsx'
// KaTeX stylesheet — side-effect import kept at the component level so the
// extensions factory stays pure-JS (importable by Node migration scripts).
import 'katex/dist/katex.min.css'

export default function RichEditor({
  label,
  badge,
  badgeCls = 'bopt',
  initialContent = null,
  onChange,
  placeholder = 'Type here…',
  minHeight = 85,
  readOnly = false,
}) {
  // ── Modals ────────────────────────────────────────────────────
  const [showMath,  setShowMath]  = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [mathEdit,  setMathEdit]  = useState(null)  // { latex, pos } | null

  // ── Stable onChange ref ───────────────────────────────────────
  // Storing onChange in a ref prevents useEditor from re-creating the
  // editor instance every time the parent re-renders.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // ── Migrate initial content ───────────────────────────────────
  // migrateContent() handles: null, Tiptap JSON, HTML strings, plain text.
  // This runs once on component mount. Memoising with useRef prevents
  // re-migration on subsequent parent renders.
  const migratedContent = useRef(migrateContent(initialContent))

  // ── Tiptap editor instance ────────────────────────────────────
  const editor = useEditor({
    extensions: buildExtensions({ placeholder, readOnly }),

    // Accept either Tiptap JSON or an HTML string as initial content.
    // Tiptap handles both natively.
    content: migratedContent.current ?? '<p></p>',

    editable: !readOnly,

    editorProps: {
      // Apply our .editor-area CSS class to the ProseMirror div.
      // This means ALL existing .editor-area CSS selectors apply verbatim.
      attributes: {
        class: 'editor-area',
        'data-placeholder': placeholder,
      },
      // Paste sanitization: strips dangerous HTML from pasted content
      transformPastedHTML: sanitizePastedHTML,
    },

    // Emit Tiptap JSON upward on every content change.
    // Do NOT call editor.getJSON() inside onUpdate — it's passed as the arg.
    onUpdate({ editor: ed }) {
      onChangeRef.current?.(ed.getJSON())
    },
  })

  // ── Math node click-to-edit ───────────────────────────────────
  // The MathInline NodeView dispatches a 'tiptap-math-click' CustomEvent
  // that bubbles up to the editor's DOM container. We intercept it here.
  //
  // Cleanup: the listener is removed when the editor is destroyed (on unmount).
  // useEditor() destroys the editor automatically; we just need to remove
  // the listener before that happens.
  useEffect(() => {
    // Tiptap v3: `editor` can be truthy before its view is mounted
    // (ueberdosis/tiptap#7346). Accessing editor.view then throws
    // "The editor view is not available", which hard-crashes the page
    // on hard-refresh when several editors mount at once.
    if (!editor?.isInitialized) return
    const dom = editor.view.dom

    const handleMathClick = (e) => {
      setMathEdit({ latex: e.detail.latex, pos: e.detail.pos })
      setShowMath(true)
    }

    dom.addEventListener('tiptap-math-click', handleMathClick)
    return () => dom.removeEventListener('tiptap-math-click', handleMathClick)
  }, [editor, editor?.isInitialized])

  // ── Handlers ─────────────────────────────────────────────────
  const handleOpenMath  = useCallback(() => { setMathEdit(null); setShowMath(true) }, [])
  const handleOpenTable = useCallback(() => setShowTable(true), [])
  const handleCloseMath = useCallback(() => { setShowMath(false); setMathEdit(null) }, [])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="qe-field">
      {label && (
        <label className="qe-lbl">
          {label}
          {badge && (
            <span className={`cbadge ${badgeCls}`} style={{ marginLeft: 6, verticalAlign: 'middle' }}>
              {badge}
            </span>
          )}
        </label>
      )}

      <div className="re-wrap">
        {!readOnly && (
          <EditorToolbar
            editor={editor}
            onMath={handleOpenMath}
            onTable={handleOpenTable}
          />
        )}
        {/*
         * EditorContent renders the ProseMirror view into a div.
         * The actual ProseMirror div inside it will have class="editor-area"
         * from editorProps.attributes above.
         */}
        <EditorContent
          editor={editor}
          style={{ minHeight }}
        />
      </div>

      {/* Modals — rendered at this level so they have access to the editor ref */}
      {showMath && (
        <MathModal
          editor={editor}
          editState={mathEdit}
          onClose={handleCloseMath}
        />
      )}
      {showTable && (
        <TableModal
          editor={editor}
          onClose={() => setShowTable(false)}
        />
      )}
    </div>
  )
}
