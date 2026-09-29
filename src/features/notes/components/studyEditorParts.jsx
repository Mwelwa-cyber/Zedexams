// src/features/notes/components/studyEditorParts.jsx
//
// The small building blocks every block editor is made of — a labelled field,
// the "upload an image to Storage" control, and two textarea variants.
// Split out of StudyNoteEditor so the reader-engine editors
// (ReaderBlockFields.jsx) can share them without importing the editor that
// imports them.

import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2, ChevronUp, ChevronDown, Plus, AlertTriangle } from '../../../shared/components/icons'
import { uploadInlineImage } from '../lib/storage'
import { moveInList } from '../lib/labelEditorCore'

// `bg-white text-neutral-900` are explicit on purpose. These fields sit on a
// white card, but a browser (or a reading theme) in dark mode restyles a bare
// <textarea> to a dark ground with pale ink — which is how the note editor
// came to show near-black boxes on the cream admin page. Naming both colours
// makes the field look the same whatever the visitor's theme is doing.
export const inputCls    = 'w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20'
export const textareaCls = inputCls + ' leading-relaxed resize-y'
export const labelCls    = 'block text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1'
export const smallBtnCls = 'text-xs px-2.5 py-1.5 rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 transition inline-flex items-center gap-1.5 text-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed'

export function Field({ label, hint, children }) {
  return (
    <div>
      {label && <label className={labelCls}>{label}</label>}
      {children}
      {hint && <p className="text-[11px] text-neutral-400 mt-1">{hint}</p>}
    </div>
  )
}

/**
 * A textarea that grows to fit what is in it. The old fixed-row boxes cut a
 * long paragraph off after three lines, so half of it was simply out of sight
 * and had to be scrolled inside a tiny box to be edited.
 */
export function AutoTextarea({ value, onChange, minRows = 2, className = textareaCls, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    if (el.scrollHeight) el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={onChange}
      className={`${className} overflow-hidden`}
      {...rest}
    />
  )
}

/**
 * A textarea over a STRUCTURED value (a list of lines, a list of
 * "term :: meaning" rows, table rows …).
 *
 * The old editors wrote `value={items.join('\n')}` and parsed every keystroke
 * back with `linesFrom`, which throws away blank lines — so pressing Enter to
 * start a new line was undone instantly, and the only way to add an item at the
 * end was to paste it. This keeps the text the author is typing in its own
 * state and only pushes the PARSED value up; it takes the parent's value back
 * only when that value stopped matching what the text parses to (i.e. the block
 * was changed from somewhere else).
 */
export function ParsedTextarea({ model, toText, fromText, onModel, minRows = 3, className, ...rest }) {
  const [text, setText] = useState(() => toText(model))
  const lastEmitted = useRef(model)

  useEffect(() => {
    // The model changed under us (undo, another editor, a resync) — take it,
    // unless it is just the echo of what we emitted a moment ago.
    if (model === lastEmitted.current) return
    if (toText(model) !== toText(fromText(text))) setText(toText(model))
    lastEmitted.current = model
    // toText/fromText are stable module-level functions at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  return (
    <AutoTextarea
      value={text}
      minRows={minRows}
      className={className}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        const parsed = fromText(next)
        lastEmitted.current = parsed
        onModel(parsed)
      }}
      {...rest}
    />
  )
}

// Text ⇄ list helpers used by ParsedTextarea call sites.
export const linesToText = (lines) => (lines || []).join('\n')
export const textToLines = (text) => (text || '').split('\n').map((x) => x.trim()).filter(Boolean)

/** A red/amber note under a block: what is wrong and how to fix it. */
export function BlockIssues({ issues }) {
  if (!issues || issues.length === 0) return null
  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex gap-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <ul className="space-y-0.5">
        {issues.map((m) => <li key={m}>{m}</li>)}
      </ul>
    </div>
  )
}

/**
 * One row of a repeating list (an option, a step, a part …): a numbered header
 * with move up / move down / delete, and the row's own fields below. `canDelete`
 * is false at the minimum length so an author cannot delete a list below what
 * the write schema accepts — a block under its minimum is dropped on save.
 */
export function ListRow({ index, total, title, onMove, onRemove, canDelete = true, children }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/60">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-neutral-100">
        <span className="text-[11px] font-semibold text-neutral-500 truncate">{title || `Item ${index + 1}`}</span>
        <span className="flex-1" />
        <button type="button" title="Move up" disabled={index === 0} onClick={() => onMove(index, -1)}
          className="w-6 h-6 inline-flex items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 disabled:opacity-30"><ChevronUp size={12} /></button>
        <button type="button" title="Move down" disabled={index === total - 1} onClick={() => onMove(index, 1)}
          className="w-6 h-6 inline-flex items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 disabled:opacity-30"><ChevronDown size={12} /></button>
        <button type="button" title={canDelete ? 'Delete' : 'Needs at least this many'} disabled={!canDelete} onClick={() => onRemove(index)}
          className="w-6 h-6 inline-flex items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-neutral-500"><Trash2 size={11} /></button>
      </div>
      <div className="p-2.5 space-y-2">{children}</div>
    </div>
  )
}

/** "＋ Add …" button that closes a repeating list. */
export function AddRowButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="text-xs font-semibold rounded-md border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-neutral-600 hover:border-[var(--accent)] hover:text-[var(--accent)] inline-flex items-center gap-1.5">
      <Plus size={12} /> {children}
    </button>
  )
}

/**
 * Edits an ordered list held on a block. `patch` may be handed a function so
 * every change is computed against the block AS IT IS NOW rather than against
 * the render that created the handler — an image upload finishing after the
 * author typed elsewhere must merge into their newest edits, not overwrite them.
 */
export function listPatcher(patch, key) {
  return {
    set: (i, p) => patch((b) => ({ [key]: (b[key] || []).map((x, j) => (j === i ? { ...x, ...p } : x)) })),
    replace: (i, next) => patch((b) => ({ [key]: (b[key] || []).map((x, j) => (j === i ? next : x)) })),
    add: (item) => patch((b) => ({ [key]: [...(b[key] || []), item] })),
    remove: (i) => patch((b) => ({ [key]: (b[key] || []).filter((_, j) => j !== i) })),
    move: (i, dir) => patch((b) => ({ [key]: moveInList(b[key] || [], i, dir) })),
  }
}

// Shared "upload an image to Firebase Storage and store its url on the block"
// control. Used by the 'image' block, the optional picture on a 'picture'
// block, the label-the-diagram picture and every tap-to-explore part.
// Uploads are disabled until the note is saved (it needs ownerUid +
// assetBatchId to scope the Storage path).
export function ImageUploadField({ block, patch, ownerUid, assetBatchId, label = 'Picture', hint, previewClass = 'max-h-44' }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const canUpload = !!ownerUid && !!assetBatchId

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setErr(null)
    try {
      const url = await uploadInlineImage({ ownerUid, assetBatchId, file })
      patch({ url })
    } catch (e2) {
      setErr(e2.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Field label={label} hint={canUpload ? hint : 'Save the note first to enable image uploads.'}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!canUpload || uploading} className={smallBtnCls}>
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
            {block.url ? 'Replace image' : 'Choose image'}
          </button>
          {block.url && (
            <button type="button" onClick={() => patch({ url: '' })} className="text-xs text-red-600 hover:underline">Remove</button>
          )}
          {err && <span className="text-xs text-red-600 truncate" title={err}>{err}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPick} />
      </Field>
      {block.url && <img src={block.url} alt="" className={`${previewClass} rounded-lg border border-neutral-200`} />}
    </div>
  )
}
