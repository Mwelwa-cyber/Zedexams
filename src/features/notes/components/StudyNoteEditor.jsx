// src/features/notes/components/StudyNoteEditor.jsx
//
// Block editor for `noteFormat: 'study'` notes. Authors add / reorder / delete
// blocks and fill per-type fields; a live preview (StudyNoteReader) on the right
// shows exactly what learners see. Controlled component: `value` is the blocks
// array, every edit calls `onChange(nextBlocks)`. Stable block ids are used as
// React keys so inputs keep focus across the parent's re-render.
//
// Image blocks — and the optional picture on a 'picture' block — upload through
// Firebase Storage (reusing uploadInlineImage, the same path NoteEditor uses),
// so docs stay small — only the URL is stored.

import { useRef, useState } from 'react'
import { Trash2, ChevronUp, ChevronDown, Copy } from '../../../shared/components/icons'
import {
  STUDY_BLOCK_LABELS, STUDY_BLOCK_TYPES, studyBlockLabel, newStudyBlock,
} from '../lib/studyBlocks'
import { coerceStudyBlocks, isValidStudyBlock } from '../lib/studySchema'
import { StudyNoteReader } from './StudyNoteReader'
import BlocksPreview from '../reader/BlocksPreview'
import { isReaderNote } from '../reader/readerCore'
import { QuizPicker } from './QuizPicker'
import ReaderBlockFields, { READER_EDITABLE_TYPES } from './ReaderBlockFields'
import {
  Field, AutoTextarea, ParsedTextarea, BlockIssues, ImageUploadField,
  inputCls, linesToText, textToLines,
} from './studyEditorParts'

const rowsToText = (rows) => (rows || []).map(r => `${r.term} :: ${r.def || ''}`).join('\n')
const textToRows = (text) => textToLines(text).map(l => {
  const i = l.indexOf('::')
  return i >= 0 ? { term: l.slice(0, i).trim(), def: l.slice(i + 2).trim() } : { term: l.trim(), def: '' }
})
const tableRowsToText = (rows) => (rows || []).map(r => (r.cells || []).join(' | ')).join('\n')
const textToTableRows = (text) => textToLines(text).map(l => ({ cells: l.split('|').map(x => x.trim()) }))
const headersToText = (h) => (h || []).join(' | ')
const textToHeaders = (t) => t.split('|').map(x => x.trim())

function ImageBlockFields({ block, patch, ownerUid, assetBatchId }) {
  return (
    <div className="space-y-2">
      <ImageUploadField
        block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId}
        hint="Upload your own diagram or photo. Only the image URL is stored on the note."
      />
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

function BlockFields({ block, patch, ownerUid, assetBatchId, subject, grade, allBlocks }) {
  const t = block.type

  if (['objectives', 'bullets', 'numbers', 'summary', 'keypoints'].includes(t)) {
    return (
      <Field label="One item per line" hint="Press Enter to start a new item.">
        <ParsedTextarea model={block.items || []} toText={linesToText} fromText={textToLines}
          onModel={items => patch({ items })} minRows={3} />
      </Field>
    )
  }
  if (['think', 'note', 'tip'].includes(t)) {
    return (
      <Field label="One line per paragraph">
        <ParsedTextarea model={block.lines || []} toText={linesToText} fromText={textToLines}
          onModel={lines => patch({ lines })} minRows={3} />
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
      <Field label={t === 'keyidea' ? 'Key idea (the one main point)' : 'Text'}
        hint={t === 'keyidea' ? undefined : 'Use **bold**, *italic*, and [[word]] to make a word tappable (explain it in the Glossary block).'}>
        <AutoTextarea minRows={t === 'keyidea' ? 2 : 4} value={block.text || ''} onChange={e => patch({ text: e.target.value })} />
      </Field>
    )
  }
  if (t === 'keyterms') {
    return (
      <Field label="One per line:  Term :: meaning" hint='Separate the term and its meaning with "::"'>
        <ParsedTextarea model={block.rows || []} toText={rowsToText} fromText={textToRows}
          onModel={rows => patch({ rows })} minRows={3} />
      </Field>
    )
  }
  if (t === 'table') {
    return (
      <div className="space-y-2">
        <Field label="Column headings (separate with | )">
          <ParsedTextarea model={block.headers || []} toText={headersToText} fromText={textToHeaders}
            onModel={headers => patch({ headers })} minRows={1} />
        </Field>
        <Field label="Rows — one per line, cells separated with |">
          <ParsedTextarea model={block.rows || []} toText={tableRowsToText} fromText={textToTableRows}
            onModel={rows => patch({ rows })} minRows={3} />
        </Field>
      </div>
    )
  }
  if (t === 'picture') {
    return (
      <div className="space-y-2">
        <ImageUploadField
          block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId}
          hint="Upload a real picture for this spot. If you leave it empty, the description below is shown as a placeholder instead."
        />
        <Field label="Caption (what the picture shows)">
          <input className={inputCls} value={block.caption || ''} onChange={e => patch({ caption: e.target.value })} />
        </Field>
        <Field label="Description — one line each" hint="Shown only when no picture is uploaded.">
          <ParsedTextarea model={block.lines || []} toText={linesToText} fromText={textToLines}
            onModel={lines => patch({ lines })} minRows={3} />
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
        <Field label="Question"><AutoTextarea minRows={1} value={block.q || ''} onChange={e => patch({ q: e.target.value })} /></Field>
        <Field label="Answer (hidden until the learner taps Show answer)">
          <AutoTextarea value={block.a || ''} onChange={e => patch({ a: e.target.value })} />
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
        <Field label="Exam question"><AutoTextarea minRows={1} value={block.q || ''} onChange={e => patch({ q: e.target.value })} /></Field>
        <Field label="Model (good) answer">
          <AutoTextarea value={block.a || ''} onChange={e => patch({ a: e.target.value })} />
        </Field>
      </div>
    )
  }
  if (t === 'mistake') {
    return (
      <div className="space-y-2">
        <Field label="Wrong answer"><AutoTextarea minRows={1} value={block.wrong || ''} onChange={e => patch({ wrong: e.target.value })} /></Field>
        <Field label="Correct answer"><AutoTextarea minRows={1} value={block.correct || ''} onChange={e => patch({ correct: e.target.value })} /></Field>
      </div>
    )
  }
  if (t === 'quiz') {
    return <QuizBlockFields block={block} patch={patch} subject={subject} grade={grade} />
  }
  if (READER_EDITABLE_TYPES.includes(t)) {
    return <ReaderBlockFields block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId} allBlocks={allBlocks} />
  }
  return <p className="text-xs text-neutral-500">This block type ("{t}") has no editor.</p>
}

function BlockCard({ block, idx, total, patch, onMove, onRemove, onDuplicate, ownerUid, assetBatchId, subject, grade, allBlocks }) {
  const valid = isValidStudyBlock(block)
  // Types with their own inline explanation of what is missing.
  const explained = block.type === 'labeldiagram'
  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${valid ? 'border-neutral-200' : 'border-amber-400'}`}>
      <div className="flex items-center gap-2 bg-neutral-50 px-3 py-2 border-b border-neutral-100">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{studyBlockLabel(block.type)}</span>
        <span className="flex-1" />
        <button type="button" title="Duplicate" onClick={() => onDuplicate(idx)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-white"><Copy size={13} /></button>
        <button type="button" title="Move up" disabled={idx === 0} onClick={() => onMove(idx, -1)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-white disabled:opacity-30"><ChevronUp size={14} /></button>
        <button type="button" title="Move down" disabled={idx === total - 1} onClick={() => onMove(idx, 1)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-white disabled:opacity-30"><ChevronDown size={14} /></button>
        <button type="button" title="Delete" onClick={() => onRemove(idx)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200"><Trash2 size={13} /></button>
      </div>
      <div className="p-3 space-y-2">
        {!valid && !explained && (
          <BlockIssues issues={['This block is incomplete, so it will NOT be saved yet. Fill in every field (lists need at least two items).']} />
        )}
        <BlockFields block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId} subject={subject} grade={grade} allBlocks={allBlocks} />
      </div>
    </div>
  )
}

export function StudyNoteEditor({ value, onChange, ownerUid, assetBatchId, subject, grade }) {
  const blocks = Array.isArray(value) ? value : []
  const reader = isReaderNote(blocks)

  // Patches resolve against the LATEST blocks, not the render closure that
  // created the handler. An image/picture upload is async: if the author edits
  // the same block's caption/description while it's uploading, the awaited
  // patch({ url }) must merge into their newest edits rather than overwrite
  // them with a stale snapshot.
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  // `patch` is an object, or a function of the block's CURRENT state that
  // returns one — list editors use the function form so two quick edits
  // (or an upload landing mid-typing) compose instead of overwriting.
  const patchBlock = (idx, patch) => onChange(blocksRef.current.map((b, i) => {
    if (i !== idx) return b
    return { ...b, ...(typeof patch === 'function' ? patch(b) : patch) }
  }))
  const duplicateBlock = (idx) => {
    const cur = blocksRef.current
    const copy = { ...structuredClone(cur[idx]), id: `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }
    onChange([...cur.slice(0, idx + 1), copy, ...cur.slice(idx + 1)])
  }
  const incomplete = blocks.length - coerceStudyBlocks(blocks).length
  const addBlock   = (type) => onChange([...blocksRef.current, newStudyBlock(type)])
  const removeBlock = (idx) => onChange(blocksRef.current.filter((_, i) => i !== idx))
  const moveBlock  = (idx, dir) => {
    const cur = blocksRef.current
    const j = idx + dir
    if (j < 0 || j >= cur.length) return
    const next = cur.slice()
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      {/* editor column */}
      <div className="space-y-3" style={{ colorScheme: 'light' }}>
        {incomplete > 0 && (
          <div role="alert" className="rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>{incomplete} block{incomplete === 1 ? ' is' : 's are'} incomplete</strong> and will not be saved until finished
            (look for the amber border).
          </div>
        )}
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
            onMove={moveBlock} onRemove={removeBlock} onDuplicate={duplicateBlock}
            allBlocks={blocks}
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

      {/* Live preview column.
          A reader note previews through the LEARNER's own renderer
          (BlocksPreview → ReaderBlock). The legacy StudyNoteReader has no
          case for the reader-engine blocks — tap-to-explore grids, the
          label-the-diagram figure, start/end and flow — so previewing a
          reader note through it silently dropped them, pictures included.
          Notes still on the old vocabulary keep the old preview. */}
      <div className="lg:sticky lg:top-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">Live preview</div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 max-h-[78vh] overflow-auto">
          {reader ? <BlocksPreview blocks={blocks} /> : <StudyNoteReader blocks={blocks} />}
        </div>
        {reader && (
          <p className="text-[11px] text-neutral-400 mt-2">
            Every block you have written, in the order you wrote them. Learn and Revise are two
            doorways into this one note — they decide where a block lands, never what it says.
          </p>
        )}
      </div>
    </div>
  )
}

export default StudyNoteEditor
