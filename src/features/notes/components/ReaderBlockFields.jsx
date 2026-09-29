// src/features/notes/components/ReaderBlockFields.jsx
//
// Editors for the reader-engine blocks — glossary, start/end, flow, tap-to-
// explore, label-the-diagram, practice and section check. Until now these eight
// types showed an EMPTY card in the admin editor (BlockFields returned null for
// them), so the only way to change a diagram label or a glossary meaning was to
// regenerate the note. Every field the learner sees is editable here.
//
// `patch` accepts an object OR a function of the current block (see
// StudyNoteEditor.patchBlock) so an async image upload finishing mid-edit merges
// into the author's newest text instead of overwriting it.

import { useRef, useState } from 'react'
import { Trash2 } from '../../../shared/components/icons'
import { missingGlossaryWords } from '../lib/studyBlocks'
import { labelDiagramIssues, nextItemKey, nudge, pointToFraction } from '../lib/labelEditorCore'
import {
  Field, AutoTextarea, ParsedTextarea, BlockIssues, ListRow, AddRowButton,
  ImageUploadField, listPatcher, inputCls, linesToText, textToLines,
} from './studyEditorParts'

/* ───────────────────────── glossary ───────────────────────── */

function GlossaryFields({ block, patch, allBlocks }) {
  const entries = block.entries || []
  const list = listPatcher(patch, 'entries')
  const missing = missingGlossaryWords(allBlocks || [])
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-neutral-500">
        Mark a word in any paragraph as <code>[[word]]</code> and learners can tap it for the meaning you write here.
      </p>
      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="font-semibold mb-1">Marked in the note but not explained yet — tap to add:</div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((w) => (
              <button key={w} type="button"
                onClick={() => list.add({ word: w, meaning: '', how: '', examples: [] })}
                className="rounded-full border border-amber-400 bg-white px-2.5 py-0.5 font-semibold hover:bg-amber-100">
                ＋ {w}
              </button>
            ))}
          </div>
        </div>
      )}
      {entries.map((e, i) => (
        <ListRow key={i} index={i} total={entries.length} title={e.word || `Word ${i + 1}`}
          onMove={list.move} onRemove={list.remove}>
          <Field label="Word">
            <input className={inputCls} value={e.word || ''} onChange={(ev) => list.set(i, { word: ev.target.value })} />
          </Field>
          <Field label="Meaning (simple words)">
            <AutoTextarea value={e.meaning || ''} onChange={(ev) => list.set(i, { meaning: ev.target.value })} />
          </Field>
          <Field label="How to use it (optional)">
            <AutoTextarea value={e.how || ''} onChange={(ev) => list.set(i, { how: ev.target.value })} />
          </Field>
          <Field label="Examples — one per line (optional)">
            <ParsedTextarea model={e.examples || []} toText={linesToText} fromText={textToLines}
              onModel={(examples) => list.set(i, { examples })} minRows={2} />
          </Field>
        </ListRow>
      ))}
      <AddRowButton onClick={() => list.add({ word: '', meaning: '', how: '', examples: [] })}>Add a word</AddRowButton>
    </div>
  )
}

/* ───────────────────────── start / end ───────────────────────── */

function StartEndFields({ block, patch }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      <Field label="Left label"><input className={inputCls} value={block.startLabel || ''} onChange={(e) => patch({ startLabel: e.target.value })} /></Field>
      <Field label="Right label"><input className={inputCls} value={block.endLabel || ''} onChange={(e) => patch({ endLabel: e.target.value })} /></Field>
      <Field label="Starts in"><input className={inputCls} value={block.start || ''} onChange={(e) => patch({ start: e.target.value })} /></Field>
      <Field label="Ends in"><input className={inputCls} value={block.end || ''} onChange={(e) => patch({ end: e.target.value })} /></Field>
    </div>
  )
}

/* ───────────────────────── flow ───────────────────────── */

function FlowFields({ block, patch }) {
  const steps = block.steps || []
  const list = listPatcher(patch, 'steps')
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <ListRow key={i} index={i} total={steps.length} title={`Step ${i + 1}`}
          onMove={list.move} onRemove={list.remove} canDelete={steps.length > 2}>
          <Field label="What happens">
            <input className={inputCls} value={s.text || ''} onChange={(e) => list.set(i, { text: e.target.value })} />
          </Field>
          <Field label="Extra note (optional)">
            <input className={inputCls} value={s.note || ''} onChange={(e) => list.set(i, { note: e.target.value })} />
          </Field>
        </ListRow>
      ))}
      <AddRowButton onClick={() => list.add({ text: '', note: '' })}>Add a step</AddRowButton>
    </div>
  )
}

/* ───────────────────────── tap to explore ───────────────────────── */

function TapExploreFields({ block, patch, ownerUid, assetBatchId }) {
  const items = block.items || []
  const list = listPatcher(patch, 'items')
  return (
    <div className="space-y-2">
      <Field label="Instruction above the cards">
        <input className={inputCls} value={block.prompt || ''} onChange={(e) => patch({ prompt: e.target.value })} />
      </Field>
      {items.map((it, i) => (
        <ListRow key={it.key || i} index={i} total={items.length} title={it.name || `Part ${i + 1}`}
          onMove={list.move} onRemove={list.remove} canDelete={items.length > 2}>
          <Field label="Name">
            <input className={inputCls} value={it.name || ''} onChange={(e) => list.set(i, { name: e.target.value })} />
          </Field>
          <Field label="What it does">
            <AutoTextarea value={it.role || ''} onChange={(e) => list.set(i, { role: e.target.value })} />
          </Field>
          <Field label="Extra paragraph, e.g. its parts (optional)">
            <AutoTextarea value={it.parts || ''} onChange={(e) => list.set(i, { parts: e.target.value })} />
          </Field>
          <ImageUploadField block={it} patch={(p) => list.set(i, p)} ownerUid={ownerUid} assetBatchId={assetBatchId}
            label="Picture (optional)" previewClass="max-h-32" />
        </ListRow>
      ))}
      <AddRowButton onClick={() => patch((b) => {
        const cur = b.items || []
        return { items: [...cur, { key: nextItemKey(cur, 'part-'), name: '', url: '', role: '', parts: '' }] }
      })}>Add a part</AddRowButton>
    </div>
  )
}

/* ───────────────────────── label the diagram ───────────────────────── */

function LabelDiagramFields({ block, patch, ownerUid, assetBatchId }) {
  const items = block.items || []
  const list = listPatcher(patch, 'items')
  const boxRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const issues = labelDiagramIssues(block)

  const place = (i, x, y) => list.set(i, { x, y })

  const addAt = (e) => {
    if (e.target.closest && e.target.closest('[data-pin]')) return
    const pt = pointToFraction(boxRef.current?.getBoundingClientRect(), e.clientX, e.clientY)
    if (!pt) return
    patch((b) => {
      const cur = b.items || []
      return { items: [...cur, { key: nextItemKey(cur), label: `Label ${cur.length + 1}`, x: pt.x, y: pt.y }] }
    })
    setSelected(items.length)
  }

  const startDrag = (e, i) => {
    e.stopPropagation()
    setSelected(i)
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* not supported — drag still works via bubbling */ }
    const move = (ev) => {
      const pt = pointToFraction(boxRef.current?.getBoundingClientRect(), ev.clientX, ev.clientY)
      if (pt) place(i, pt.x, pt.y)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onPinKey = (e, i) => {
    const step = e.shiftKey ? 0.05 : 0.01
    const it = items[i]
    if (!it) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); place(i, nudge(it.x, -step), it.y) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); place(i, nudge(it.x, step), it.y) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); place(i, it.x, nudge(it.y, -step)) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); place(i, it.x, nudge(it.y, step)) }
  }

  return (
    <div className="space-y-3">
      <ImageUploadField block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId}
        label="Diagram picture" hint="Upload the picture first, then click on it to drop a label box." previewClass="hidden" />
      <Field label="Instructions for the learner">
        <input className={inputCls} value={block.instructions || ''} onChange={(e) => patch({ instructions: e.target.value })} />
      </Field>
      <Field label="Picture description (for screen readers)">
        <input className={inputCls} value={block.alt || ''} onChange={(e) => patch({ alt: e.target.value })} />
      </Field>

      {block.url ? (
        <div>
          <div className="text-[11px] text-neutral-500 mb-1">
            Click the picture to add a numbered box · drag a box to move it · arrow keys nudge the selected box (Shift = bigger steps).
          </div>
          <div ref={boxRef} onClick={addAt}
            className="relative inline-block max-w-full select-none cursor-crosshair rounded-lg border border-neutral-300 overflow-hidden touch-none">
            <img src={block.url} alt="" draggable={false} className="block max-w-full h-auto" />
            {items.map((it, i) => (
              <button key={it.key || i} type="button" data-pin
                title={it.label || `Box ${i + 1}`}
                onPointerDown={(e) => startDrag(e, i)}
                onKeyDown={(e) => onPinKey(e, i)}
                onFocus={() => setSelected(i)}
                style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-xs font-bold text-white shadow ring-2 cursor-grab active:cursor-grabbing ${
                  selected === i ? 'bg-[var(--accent)] ring-white' : 'bg-neutral-800/80 ring-white/70'}`}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {items.map((it, i) => (
          <ListRow key={it.key || i} index={i} total={items.length} title={`Box ${i + 1}`}
            onMove={list.move} onRemove={(idx) => { list.remove(idx); setSelected(null) }} canDelete={items.length > 2}>
            <Field label="Word to place here (the correct answer)">
              <input className={inputCls} value={it.label || ''}
                onFocus={() => setSelected(i)}
                onChange={(e) => list.set(i, { label: e.target.value })} />
            </Field>
          </ListRow>
        ))}
        {!block.url && (
          <AddRowButton onClick={() => patch((b) => {
            const cur = b.items || []
            return { items: [...cur, { key: nextItemKey(cur), label: '', x: 0.5, y: 0.5 }] }
          })}>Add a label</AddRowButton>
        )}
      </div>
      <BlockIssues issues={issues} />
    </div>
  )
}

/* ───────────────────────── practice / section check ───────────────────────── */

function OptionsEditor({ options, onChange, label = 'Answer choices — pick the correct one' }) {
  const opts = options || []
  const set = (i, p) => onChange(opts.map((o, j) => (j === i ? { ...o, ...p } : o)))
  const setCorrect = (i) => onChange(opts.map((o, j) => ({ ...o, correct: j === i })))
  const correctCount = opts.filter((o) => o.correct).length
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
      {opts.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="radio" aria-label={`Option ${i + 1} is correct`} checked={!!o.correct} onChange={() => setCorrect(i)}
            className="accent-[var(--accent)]" />
          <input className={inputCls} value={o.text || ''} onChange={(e) => set(i, { text: e.target.value })} />
          <button type="button" title={opts.length > 2 ? 'Delete choice' : 'Needs at least two choices'}
            disabled={opts.length <= 2} onClick={() => onChange(opts.filter((_, j) => j !== i))}
            className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <AddRowButton onClick={() => onChange([...opts, { text: '', correct: false }])}>Add a choice</AddRowButton>
      {correctCount !== 1 && (
        <BlockIssues issues={[correctCount === 0 ? 'Tick the radio button beside the correct answer.' : 'Only one choice can be correct.']} />
      )}
    </div>
  )
}

function PracticeFields({ block, patch }) {
  return (
    <div className="space-y-2">
      <Field label="Question"><AutoTextarea value={block.q || ''} onChange={(e) => patch({ q: e.target.value })} /></Field>
      <OptionsEditor options={block.options} onChange={(options) => patch({ options })} />
      <Field label="Feedback when correct (optional)">
        <AutoTextarea value={block.correctNote || ''} onChange={(e) => patch({ correctNote: e.target.value })} />
      </Field>
    </div>
  )
}

function SectionCheckFields({ block, patch }) {
  const rem = block.remediation || {}
  const setRem = (p) => patch((b) => ({ remediation: { ...(b.remediation || {}), ...p } }))
  return (
    <div className="space-y-2">
      <Field label="Heading (optional)"><input className={inputCls} value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} /></Field>
      <Field label="Question"><AutoTextarea value={block.q || ''} onChange={(e) => patch({ q: e.target.value })} /></Field>
      <OptionsEditor options={block.options} onChange={(options) => patch({ options })} />
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-2.5 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">If the learner gets it wrong — "Let's look at it again"</div>
        <Field label="Explanation"><AutoTextarea value={rem.explain || ''} onChange={(e) => setRem({ explain: e.target.value })} /></Field>
        <Field label="Worked example (optional)"><AutoTextarea value={rem.example || ''} onChange={(e) => setRem({ example: e.target.value })} /></Field>
        <Field label="Try-again question"><AutoTextarea value={rem.retryQ || ''} onChange={(e) => setRem({ retryQ: e.target.value })} /></Field>
        <OptionsEditor label="Try-again choices — pick the correct one" options={rem.retryOptions}
          onChange={(retryOptions) => setRem({ retryOptions })} />
        <Field label="Hint (optional)"><input className={inputCls} value={rem.retryHint || ''} onChange={(e) => setRem({ retryHint: e.target.value })} /></Field>
      </div>
    </div>
  )
}

/* ───────────────────────── entry point ───────────────────────── */

export const READER_EDITABLE_TYPES = ['glossary', 'startend', 'flow', 'tapexplore', 'labeldiagram', 'practice', 'sectioncheck']

export default function ReaderBlockFields({ block, patch, ownerUid, assetBatchId, allBlocks }) {
  switch (block.type) {
    case 'glossary': return <GlossaryFields block={block} patch={patch} allBlocks={allBlocks} />
    case 'startend': return <StartEndFields block={block} patch={patch} />
    case 'flow': return <FlowFields block={block} patch={patch} />
    case 'tapexplore': return <TapExploreFields block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId} />
    case 'labeldiagram': return <LabelDiagramFields block={block} patch={patch} ownerUid={ownerUid} assetBatchId={assetBatchId} />
    case 'practice': return <PracticeFields block={block} patch={patch} />
    case 'sectioncheck': return <SectionCheckFields block={block} patch={patch} />
    default: return null
  }
}

