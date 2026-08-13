// Mathematics-aware editing inside the normal question-building flow.
//
// Assessment Studio's inline cards edited every field through a plain
// <textarea> (question text) or <input type="text"> (answer options). Both
// hold strings, so a teacher could never CREATE a stacked fraction where they
// were working — the tools existed only behind "Edit in detail" — and content
// that arrived with mathematics (from that detailed editor, from AI, from an
// import) had to be shown read-only to avoid a quick edit silently flattening
// it. Everything below the studio already carried structured mathematics:
// serializeOptions/hydrateOptions round-trip Tiptap options, and
// assessmentPaperLayout runs both stems and options through
// richTextToPaperHtml. This component closes the top layer onto that.
//
// PERFORMANCE (§14). A paper can hold many questions, and Tiptap is not cheap.
// Exactly ONE editor instance is mounted at a time across the whole paper:
// MathsEditingProvider tracks which field currently owns it, and every other
// field renders as static HTML. That static HTML is produced by
// richTextToPaperHtml — the same function the PDF and Word exports consume — so
// an unfocused card is not an approximation of the paper, it is the paper.
//
// The activation gesture is deliberately a real <button>: a div with an onClick
// would be unreachable by keyboard, and §13 requires a teacher to get into and
// out of every mathematics affordance without a mouse.

import { createContext, useContext, useState, useMemo, useCallback, useRef, useEffect } from 'react'
import RichEditor from '../../../editor/components/RichEditor.jsx'
import { richTextToPaperHtml } from '../../../editor/utils/safeRender.js'
import { richTextToPlainText, richTextHasFormatting } from '../../../utils/quizRichText.js'

/* ------------------------------------------------------------------ *
 * Which field owns the one mounted editor
 * ------------------------------------------------------------------ */

const MathsEditingContext = createContext(null)

/**
 * Wrap the question list in this so only one Tiptap instance exists at a time.
 *
 * Without a provider the fields still work — each falls back to owning its own
 * editor once activated — so a surface that forgets to wrap is degraded rather
 * than broken. That fallback is why `useMathsFieldState` never assumes context.
 */
export function MathsEditingProvider({ children }) {
  const [activeFieldId, setActiveFieldId] = useState(null)
  const value = useMemo(() => ({ activeFieldId, setActiveFieldId }), [activeFieldId])
  return <MathsEditingContext.Provider value={value}>{children}</MathsEditingContext.Provider>
}

function useMathsFieldState(fieldId) {
  const shared = useContext(MathsEditingContext)
  const [localActive, setLocalActive] = useState(false)
  const isActive = shared ? shared.activeFieldId === fieldId : localActive
  const activate = useCallback(() => {
    if (shared) shared.setActiveFieldId(fieldId)
    else setLocalActive(true)
  }, [shared, fieldId])
  return { isActive, activate }
}

/* ------------------------------------------------------------------ *
 * The canonical contract, applied on the way OUT of the editor
 * ------------------------------------------------------------------ */

/**
 * RichEditor emits a Tiptap doc for every keystroke, including plain prose. If
 * that went straight to storage, opening a maths paper and fixing a typo would
 * promote an ordinary question to a rich document it never needed — and §7's
 * "existing plain strings remain readable" would quietly become "everything
 * becomes JSON eventually".
 *
 * So a doc carrying no formatting is handed back as the plain text it is, and
 * only genuinely structured content is stored as a document. This is the same
 * rule `richTextHasFormatting` already uses to decide whether a textarea is
 * safe, applied in the other direction — one rule, two directions, so the two
 * can't disagree about what "plain" means.
 */
export function normalizeMathsFieldValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (!richTextHasFormatting(value)) return richTextToPlainText(value)
  return value
}

/** Is there anything at all in this field? Used only to pick a placeholder. */
function isEmptyValue(value) {
  if (value == null || value === '') return true
  if (typeof value === 'string') return value.trim() === ''
  return richTextToPlainText(value).trim() === ''
}

/* ------------------------------------------------------------------ *
 * The inactive rendering
 * ------------------------------------------------------------------ */

/**
 * A field that is not being edited, drawn as the paper will draw it.
 *
 * The HTML is `richTextToPaperHtml`'s output: sanitised by `toHTML` and already
 * hydrated, so the stacked fractions, vertical sums and number bases have their
 * inner structure baked in and KaTeX nodes are flattened to readable text. No
 * hydration step is needed here, and nothing can render differently from the
 * export because it is literally the export's input.
 */
function MathsFieldPreview({ value, placeholder, ariaLabel, onActivate }) {
  const html = useMemo(() => {
    try { return richTextToPaperHtml(value) || '' } catch { return '' }
  }, [value])
  const empty = isEmptyValue(value)

  return (
    <button
      type="button"
      className={`sv-maths-preview${empty ? ' empty' : ''}`}
      onClick={onActivate}
      onFocus={onActivate}
      aria-label={ariaLabel}
    >
      {empty
        ? <span className="sv-maths-placeholder">{placeholder}</span>
        : <span className="sv-maths-preview-body" dangerouslySetInnerHTML={{ __html: html }} />}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * The field
 * ------------------------------------------------------------------ */

/**
 * One mathematics-aware field.
 *
 * @param {string}   fieldId      Unique within the paper; owns the single editor
 * @param {*}        value        Plain string, HTML, or Tiptap doc
 * @param {function} onChange     Called with a plain string OR a Tiptap doc
 * @param {string}   placeholder  Shown when the field is empty
 * @param {string}   ariaLabel    Accessible name (§13 — every affordance named)
 * @param {'full'|'compact'} toolbarVariant  'compact' for answer options
 * @param {number}   minHeight    Editor min height in px
 * @param {boolean}  autoFocus    Focus the editor as soon as it mounts
 * @param {string}   grade        Paper grade — orders the maths tools only (§6)
 */
export default function MathsRichField({
  fieldId,
  value,
  onChange,
  placeholder = 'Type here…',
  ariaLabel,
  toolbarVariant = 'full',
  minHeight = 72,
  autoFocus = true,
  grade,
}) {
  const { isActive, activate } = useMathsFieldState(fieldId)

  // The value the editor was seeded with. RichEditor reads `initialContent`
  // once by design (re-reading it would fight the cursor on every keystroke),
  // so the seed is captured at activation and deliberately not tracked after.
  const seedRef = useRef(value)
  if (!isActive) seedRef.current = value

  const handleChange = useCallback((json) => {
    onChange?.(normalizeMathsFieldValue(json))
  }, [onChange])

  const wrapRef = useRef(null)
  useEffect(() => {
    if (!isActive || !autoFocus || !wrapRef.current) return
    // Focus the editable area itself rather than the wrapper, so the caret
    // lands in the text the teacher just clicked on instead of the toolbar.
    const area = wrapRef.current.querySelector('.editor-area')
    if (area && typeof area.focus === 'function') area.focus()
  }, [isActive, autoFocus])

  if (!isActive) {
    return (
      <MathsFieldPreview
        value={value}
        placeholder={placeholder}
        ariaLabel={ariaLabel || placeholder}
        onActivate={activate}
      />
    )
  }

  return (
    <div className="sv-maths-editor" ref={wrapRef} aria-label={ariaLabel}>
      <RichEditor
        initialContent={seedRef.current ?? ''}
        onChange={handleChange}
        placeholder={placeholder}
        minHeight={minHeight}
        toolbarVariant={toolbarVariant}
        grade={grade}
      />
    </div>
  )
}
