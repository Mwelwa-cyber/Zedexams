// src/features/notes/components/StudyNoteEditor.jsx
//
// Block editor for `noteFormat: 'study'` notes. Authors add / reorder / delete
// blocks and fill per-type fields; a live preview (StudyNoteReader) on the right
// shows exactly what learners see. Controlled component: `value` is the blocks
// array, every edit calls `onChange(nextBlocks)`. Stable block ids are used as
// React keys so inputs keep focus across the parent's re-render.
//
// Image blocks upload through Firebase Storage (reusing uploadInlineImage, the
// same path NoteEditor uses), so docs stay small — only the URL is stored.

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2, ChevronUp, ChevronDown } from '../../../components/ui/icons'
import { uploadInlineImage } from '../lib/storage'
import {
  STUDY_BLOCK_LABELS, STUDY_BLOCK_TYPES, newStudyBlock, linesFrom,
} from '../lib/studyBlocks'
import { StudyNoteReader } from './StudyNoteReader'
import { QuizPicker } from './QuizPicker'

const inputCls    = 'w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-900 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20'
const textareaCls = inputCls + ' leading-relaxed resize-y'
const labelCls    = 'block text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1'

function Field({ label, hint, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-neutral-400 mt-1">{hint}</p>}
    </div>
  )
}

function ImageBlockFields({ block, patch, ownerUid, assetBatchId }) {
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
      <Field label="Picture" hint={canUpload ? 'Upload your own diagram or photo. Only the image URL is stored on the note.' : 'Save the note first to enable image uploads.'}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!canUpload || uploading}
            className="text-xs px-2.5 py-1.5 rounded-md border border-neutral-200 hover:bg-neutral-50 transition inline-flex items-center gap-1.5 text-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
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
      {block.url && <img src={block.url} alt="" className="max-h-44 rounded-lg border border-neutral-200" />}
      <Field label="Caption">
        <input className={inputCls} value={block.caption || ''} onChange={e => patch({ caption: e.target.value })} />
      </Field>
    </div>
  )
}

function QuizBlockFields({ block, patch, subject, grade }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const linked = !!(block.quizId && String(block.quizId).trim())
  return (
    <div className="space-y-2">
      {linked ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex items-start gap-2">
            <span aria-hidden>🧪</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-neutral-900 truncate">{block.quizTitle || 'Linked quiz'}</div>
              <div className="text-xs text-neutral-500 truncate">{block.questionCount ? `${block.questionCount} questions · ` : ''}id: {block.quizId}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button type="button" onClick={() => setPickerOpen(true)} className="text-xs px-2.5 py-1.5 rounded-md border border-neutral-200 hover:bg-white text-neutral-700">Change quiz</button>
            <button type="button" onClick={() => patch({ quizId: '', quizTitle: '', questionCount: null })} className="text-xs text-red-600 hover:underline">Unlink</button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setPickerOpen(true)} className="text-sm px-3 py-2 rounded-lg border border-dashed border-neutral-300 hover:border-[var(--accent)] hover:text-[var(--accent)] text-neutral-700 inline-flex items-center gap-1.5">🧪 Link a practice quiz</button>
          <p className="text-[11px] text-neutral-400 mt-1">Pick a published Grade {grade || '?'} {subject || ''} quiz — learners open it from the note.</p>
        </div>
      )}
      <QuizPicker
        open={pickerOpen}
        grade={grade}
        subject={subject}
        currentQuizId={block.quizId}
        onPick={(sel) => { patch(sel); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}

function BlockFields({ block, patch, ownerUid, assetBatchId, subject, grade }) {
  const t = block.type

  if (['objectives', 'bullets', 'numbers', 'summary'].includes(t)) {
    return (
      <Field label="One item per line">
        <textarea className={textareaCls} rows={Math.max(3, (block.items || []).length)}
          value={(block.items || []).join('\n')} onChange={e => patch({ items: linesFrom(e.target.value) })} />
      </Field>
    )
  }
  if (['think', 'note', 'tip'].includes(t)) {
    return (
      <Field label="One line per paragraph">
        <textarea className={textareaCls} rows={3}
          value={(block.lines || []).join('\n')} onChange={e => patch({ lines: linesFrom(e.target.value) })} />
      </Field>
    )
  }
  if (t === 'heading') {
    return (
      <div className="grid grid-cols-[auto_1fr] gap-2 items-end">
        <Field label="Size">
          <select className={inputCls} value={String(block.level)} onChange={e => patch({ level: Number(e.target.value) })}>
            <option value="2">Big (section)</option>
            <option value="3">Small (sub-section)</option>
          </select>
        </Field>
        <Field label="Heading text">
          <input className={inputCls} value={block.text || ''} onChange={e => patch({ text: e.target.value })} />
        </Field>
      </div>
    )
  }
  if (t === 'paragraph' || t === 'keyidea') {
    return (
      <Field label={t === 'keyidea' ? 'Key idea (the one main point)' : 'Text  (use **bold** and *italic*)'}>
        <textarea className={textareaCls} rows={t === 'keyidea' ? 2 : 3}
          value={block.text || ''} onChange={e => patch({ text: e.target.value })} />
      </Field>
    )
  }
  if (t === 'keyterms') {
    const value = (block.rows || []).map(r => `${r.term} :: ${r.def || ''}`).join('\n')
    return (
      <Field label="One per line:  Term :: meaning" hint='Separate the term and its meaning with "::"'>
        <textarea className={textareaCls} rows={Math.max(3, (block.rows || []).length)} value={value}
          onChange={e => patch({
            rows: linesFrom(e.target.value).map(l => {
              const i = l.indexOf('::')
              return i >= 0 ? { term: l.slice(0, i).trim(), def: l.slice(i + 2).trim() } : { term: l.trim(), def: '' }
            }),
          })} />
      </Field>
    )
  }
  if (t === 'table') {
    return (
      <div className="space-y-2">
        <Field label="Column headings (separate with | )">
          <input className={inputCls} value={(block.headers || []).join(' | ')}
            onChange={e => patch({ headers: e.target.value.split('|').map(x => x.trim()) })} />
        </Field>
        <Field label="Rows — one per line, cells separated with |">
          <textarea className={textareaCls} rows={Math.max(3, (block.rows || []).length)}
            value={(block.rows || []).map(r => (r.cells || []).join(' | ')).join('\n')}
            onChange={e => patch({ rows: linesFrom(e.target.value).map(l => ({ cells: l.split('|').map(x => x.trim()) })) })} />
        </Field>
      </div>
    )
  }
  if (t === 'picture') {
    return (
      <div className="space-y-2">
        <Field label="Caption (what the picture shows)">
          <input className={inputCls} value={block.caption || ''} onChange={e => patch({ caption: e.target.value })} />
        </Field>
        <Field label="Description — one line each">
          <textarea className={textareaCls} rows={3} value={(block.lines || []).join('\n')}
            onChange={e => patch({ lines: linesFrom(e.target.value) })} />
        </Field>
      </div>
    )
  }
  if (t === 'image') {
    return <ImageBlockFields block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId} />
  }
  if (t === 'quickcheck') {
    return (
      <div className="space-y-2">
        <Field label="Question"><input className={inputCls} value={block.q || ''} onChange={e => patch({ q: e.target.value })} /></Field>
        <Field label="Answer (hidden until the learner taps Show answer)">
          <textarea className={textareaCls} rows={2} value={block.a || ''} onChange={e => patch({ a: e.target.value })} />
        </Field>
        <Field label="Difficulty">
          <select className={inputCls} value={block.level || ''} onChange={e => patch({ level: e.target.value })}>
            <option value="">No tag</option>
            <option>Easy</option>
            <option>Medium</option>
            <option>Exam Level</option>
          </select>
        </Field>
      </div>
    )
  }
  if (t === 'exam') {
    return (
      <div className="space-y-2">
        <Field label="Exam question"><input className={inputCls} value={block.q || ''} onChange={e => patch({ q: e.target.value })} /></Field>
        <Field label="Model (good) answer">
          <textarea className={textareaCls} rows={2} value={block.a || ''} onChange={e => patch({ a: e.target.value })} />
        </Field>
      </div>
    )
  }
  if (t === 'mistake') {
    return (
      <div className="space-y-2">
        <Field label="Wrong answer"><input className={inputCls} value={block.wrong || ''} onChange={e => patch({ wrong: e.target.value })} /></Field>
        <Field label="Correct answer"><input className={inputCls} value={block.correct || ''} onChange={e => patch({ correct: e.target.value })} /></Field>
      </div>
    )
  }
  if (t === 'quiz') {
    return <QuizBlockFields block={block} patch={patch} subject={subject} grade={grade} />
  }
  return null
}

function BlockCard({ block, idx, total, patch, onMove, onRemove, ownerUid, assetBatchId, subject, grade }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 bg-neutral-50 px-3 py-2 border-b border-neutral-100">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{STUDY_BLOCK_LABELS[block.type] || block.type}</span>
        <span className="flex-1" />
        <button type="button" title="Move up" disabled={idx === 0} onClick={() => onMove(idx, -1)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-white disabled:opacity-30"><ChevronUp size={14} /></button>
        <button type="button" title="Move down" disabled={idx === total - 1} onClick={() => onMove(idx, 1)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-white disabled:opacity-30"><ChevronDown size={14} /></button>
        <button type="button" title="Delete" onClick={() => onRemove(idx)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200"><Trash2 size={13} /></button>
      </div>
      <div className="p-3 space-y-2">
        <BlockFields block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId} subject={subject} grade={grade} />
      </div>
    </div>
  )
}

export function StudyNoteEditor({ value, onChange, ownerUid, assetBatchId, subject, grade }) {
  const blocks = Array.isArray(value) ? value : []

  const patchBlock = (idx, patch) => onChange(blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)))
  const addBlock   = (type) => onChange([...blocks, newStudyBlock(type)])
  const removeBlock = (idx) => onChange(blocks.filter((_, i) => i !== idx))
  const moveBlock  = (idx, dir) => {
    const j = idx + dir
    if (j < 0 || j >= blocks.length) return
    const next = blocks.slice()
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      {/* editor column */}
      <div className="space-y-3">
        {blocks.length === 0 && (
          <p className="text-sm text-neutral-500 rounded-xl border border-dashed border-neutral-300 p-6 text-center">
            No blocks yet. Add one below to start your study note.
          </p>
        )}
        {blocks.map((block, idx) => (
          <BlockCard
            key={block.id || idx}
            block={block} idx={idx} total={blocks.length}
            patch={(p) => patchBlock(idx, p)}
            onMove={moveBlock} onRemove={removeBlock}
            ownerUid={ownerUid} assetBatchId={assetBatchId}
            subject={subject} grade={grade}
          />
        ))}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {STUDY_BLOCK_TYPES.map(type => (
            <button key={type} type="button" onClick={() => addBlock(type)}
              className="text-xs font-semibold rounded-full border border-dashed border-neutral-300 px-3 py-1.5 text-neutral-600 hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/5 transition">
              ＋ {STUDY_BLOCK_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      {/* live preview column */}
      <div className="lg:sticky lg:top-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">Live preview</div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 max-h-[78vh] overflow-auto">
          <StudyNoteReader blocks={blocks} />
        </div>
      </div>
    </div>
  )
}

export default StudyNoteEditor
