import { useState, useMemo, useRef, useEffect } from 'react'
import { stagesForEditing, writeStage, toLines } from '../lib/planShape'
import { reviseLessonSection, messageFromReviseError } from '../../../utils/reviseLessonSection'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'

/**
 * LessonPlanEditor — manual + AI-assisted editor for a generated lesson plan.
 *
 * Renders the plan body as editable cards (prose fields, list fields, and a
 * per-stage editor). Every section can be edited by hand AND has an "Edit with
 * AI" control that rewrites just that section via the reviseLessonSection
 * callable. Edits flow up through onChange(nextPlanJson) — the parent keeps the
 * preview HTML and the Word/PDF exports in sync.
 *
 * Props:
 *   planJson       — object  the (shape-normalised) plan JSON
 *   curriculumMode — 'cbc' | 'previous'
 *   context        — { grade, subject, topic, subtopic } for AI grounding
 *   onChange       — (nextPlanJson) => void
 */

const QUICK_ACTIONS = [
  { key: 'simpler', label: 'Simpler' },
  { key: 'detailed', label: 'More detail' },
  { key: 'shorter', label: 'Shorter' },
  { key: 'polish', label: 'Polish' },
  { key: 'rewrite', label: 'Rewrite' },
]

// ── Shared bits ───────────────────────────────────────────────────────────────

const cardCls =
  'rounded-xl border border-[#e5ddd0] bg-white shadow-sm p-4 mb-3'
const labelCls =
  'text-[11px] font-bold uppercase tracking-wide text-[#9e8e7e]'
const inputCls =
  'w-full rounded-lg border border-[#d9cfc3] bg-[#fbf9f5] px-3 py-2 text-[14px] ' +
  'text-[#3d3530] leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400/60 ' +
  'focus:border-blue-400 resize-y'

function AiSparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  )
}

/**
 * The AI control attached to every section: a button that opens a small panel
 * with quick-action chips and a free-text instruction box. On success it calls
 * onResult(value) with the revised content (string for text, string[] for list).
 */
function AiEditControl({ kind, sectionLabel, current, curriculumMode, context, onResult }) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Idempotency lock: one intentional edit → one provider call + charge, even
  // across a double-click / rapid tap / refresh / second tab. The callable now
  // refuses a keyless call, so the key travels with every request.
  const { run: runLocked } = useAiOperationLock('lesson-section:revise')

  async function run(modifier) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const payload = {
        sectionLabel, kind, curriculumMode, current,
        modifier: modifier || null,
        instruction: modifier ? '' : instruction,
        context,
      }
      const lockResult = await runLocked({
        fingerprint: stableFingerprint(payload),
        action: (idempotencyKey) => reviseLessonSection({ ...payload, idempotencyKey }),
      })
      if (lockResult.reason === 'locked') return
      if (!lockResult.ok) throw (lockResult.error || new Error('AI edit failed.'))
      const res = lockResult.data
      if (res?.status === 'processing') return
      const value = kind === 'list' ? (res.items || []) : (res.text || '')
      const empty = kind === 'list' ? value.length === 0 : !value
      if (empty) {
        setError('The AI returned nothing. Try again.')
      } else {
        onResult(value)
        setOpen(false)
        setInstruction('')
      }
    } catch (err) {
      setError(messageFromReviseError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[12px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
      >
        <AiSparkIcon />
        Edit with AI
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.key}
                type="button"
                disabled={busy}
                onClick={() => run(a.key)}
                className="rounded-full border border-blue-300 bg-white px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-start gap-2">
            <textarea
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Or tell the AI what to change (e.g. use a local-market example)…"
              className="flex-1 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-[13px] text-[#3d3530] focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
            />
            <button
              type="button"
              disabled={busy || !instruction.trim()}
              onClick={() => run(null)}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          {busy && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-blue-700">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
              Rewriting…
            </p>
          )}
          {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── Field editors ──────────────────────────────────────────────────────────────

function TextField({ label, sectionLabel, value, rows = 3, curriculumMode, context, onChange }) {
  return (
    <div className={cardCls}>
      <label className={labelCls}>{label}</label>
      <textarea
        rows={rows}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} mt-1.5`}
      />
      <AiEditControl
        kind="text"
        sectionLabel={sectionLabel || label}
        current={value || ''}
        curriculumMode={curriculumMode}
        context={context}
        onResult={(text) => onChange(text)}
      />
    </div>
  )
}

function ListField({ label, sectionLabel, items, curriculumMode, context, onChange, placeholder }) {
  const list = Array.isArray(items) ? items : toLines(items)

  function update(i, val) {
    const next = list.slice()
    next[i] = val
    onChange(next)
  }
  function remove(i) {
    onChange(list.filter((_, idx) => idx !== i))
  }
  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const next = list.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  function add() {
    onChange([...list, ''])
  }

  return (
    <div className={cardCls}>
      <label className={labelCls}>{label}</label>
      <div className="mt-1.5 space-y-2">
        {list.length === 0 && (
          <p className="text-[13px] italic text-[#9e8e7e]">No items yet — add one or ask the AI to draft them.</p>
        )}
        {list.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-2 select-none text-[12px] font-semibold text-[#bcae9c]">{i + 1}.</span>
            <textarea
              rows={1}
              value={item}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              className={`${inputCls} min-h-[38px]`}
            />
            <div className="flex flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                title="Move up"
                className="rounded p-0.5 text-[#9e8e7e] hover:bg-[#f0ebe4] disabled:opacity-30">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1}
                title="Move down"
                className="rounded p-0.5 text-[#9e8e7e] hover:bg-[#f0ebe4] disabled:opacity-30">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </div>
            <button type="button" onClick={() => remove(i)} title="Remove"
              className="mt-0.5 rounded p-1 text-[#c0796f] hover:bg-red-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={add}
          className="inline-flex items-center gap-1 rounded-lg border border-[#d9cfc3] bg-[#f5f0ea] px-2.5 py-1 text-[12px] font-medium text-[#5c4a3a] hover:bg-[#ede7df]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add item
        </button>
      </div>
      <AiEditControl
        kind="list"
        sectionLabel={sectionLabel || label}
        current={list}
        curriculumMode={curriculumMode}
        context={context}
        onResult={(arr) => onChange(arr)}
      />
    </div>
  )
}

function StageEditor({ stage, index, total, stageName, curriculumMode, context, onChange, onMove, onRemove }) {
  const learnerLabel = curriculumMode === 'previous' ? "Pupils' Activities" : "Learners' Activities"
  function set(field, value) {
    onChange({ ...stage, [field]: value })
  }
  return (
    <div className="rounded-xl border border-[#e0d6c8] bg-[#fbf9f5] p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#5c4a3a] text-[12px] font-bold text-white">{index + 1}</span>
        <input
          type="text"
          value={stage.name || ''}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Stage name (e.g. INTRODUCTION)"
          className="flex-1 rounded-lg border border-[#d9cfc3] bg-white px-2.5 py-1.5 text-[14px] font-bold text-[#3d3530] uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-400/60"
        />
        <div className="flex items-center gap-1 rounded-lg border border-[#d9cfc3] bg-white px-2 py-1">
          <input
            type="number"
            min="0"
            value={stage.durationMinutes || ''}
            onChange={(e) => set('durationMinutes', Math.max(0, Number(e.target.value) || 0))}
            className="w-12 bg-transparent text-right text-[13px] text-[#3d3530] focus:outline-none"
          />
          <span className="text-[12px] text-[#9e8e7e]">min</span>
        </div>
        <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} title="Move stage up"
          className="rounded p-1 text-[#9e8e7e] hover:bg-[#f0ebe4] disabled:opacity-30">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
        <button type="button" onClick={() => onMove(index, 1)} disabled={index === total - 1} title="Move stage down"
          className="rounded p-1 text-[#9e8e7e] hover:bg-[#f0ebe4] disabled:opacity-30">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <button type="button" onClick={() => onRemove(index)} title="Remove stage"
          className="rounded p-1 text-[#c0796f] hover:bg-red-50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
      </div>

      <ListField
        label="Teacher's Activities"
        sectionLabel={`${stageName} — Teacher's Activities`}
        items={stage.teacherActivities}
        curriculumMode={curriculumMode}
        context={context}
        placeholder="Ask learners to…"
        onChange={(v) => set('teacherActivities', v)}
      />
      <ListField
        label={learnerLabel}
        sectionLabel={`${stageName} — ${learnerLabel}`}
        items={stage.learnerActivities}
        curriculumMode={curriculumMode}
        context={context}
        placeholder="Discuss…"
        onChange={(v) => set('learnerActivities', v)}
      />
      <ListField
        label="Assessment Criteria"
        sectionLabel={`${stageName} — Assessment Criteria`}
        items={stage.assessmentCriteria}
        curriculumMode={curriculumMode}
        context={context}
        placeholder="Learner correctly…"
        onChange={(v) => set('assessmentCriteria', v)}
      />
    </div>
  )
}

// ── Root editor ─────────────────────────────────────────────────────────────

export default function LessonPlanEditor({ planJson, curriculumMode = 'cbc', context = {}, onChange }) {
  // Keep a ref to the latest plan so the per-field setters always merge into
  // current state even if several edits land in the same tick.
  const planRef = useRef(planJson)
  useEffect(() => { planRef.current = planJson }, [planJson])

  const plan = useMemo(() => planJson || {}, [planJson])
  const has = (key) => Object.prototype.hasOwnProperty.call(plan, key)

  function setField(key, value) {
    onChange({ ...planRef.current, [key]: value })
  }
  function setEnv(sub, value) {
    const env = { ...(planRef.current.learningEnvironment || {}), [sub]: value }
    onChange({ ...planRef.current, learningEnvironment: env })
  }

  // Stage operations work on the canonical (readStage) shape and write back
  // through writeStage so both field families stay populated.
  const stages = useMemo(() => stagesForEditing(plan), [plan])
  function commitStages(nextCanonical) {
    const original = Array.isArray(planRef.current.stages) ? planRef.current.stages : []
    const nextStages = nextCanonical.map((c, i) => writeStage(c, original[i] || {}))
    onChange({ ...planRef.current, stages: nextStages })
  }
  function setStage(index, canonical) {
    commitStages(stages.map((s, i) => (i === index ? canonical : s)))
  }
  function moveStage(index, dir) {
    const j = index + dir
    if (j < 0 || j >= stages.length) return
    const next = stages.slice()
    ;[next[index], next[j]] = [next[j], next[index]]
    commitStages(next)
  }
  function removeStage(index) {
    commitStages(stages.filter((_, i) => i !== index))
  }
  function addStage() {
    commitStages([
      ...stages,
      { name: '', durationMinutes: 0, teacherActivities: [], learnerActivities: [], assessmentCriteria: [] },
    ])
  }

  const env = plan.learningEnvironment || {}

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
        Editing changes the plan everywhere — the preview, Print and Word export all use your edits. Lesson details
        (teacher, school, date, format) stay in the sidebar on the left.
      </div>

      {has('generalCompetences') && (
        <ListField label="General Competences" items={plan.generalCompetences}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('generalCompetences', v)} placeholder="e.g. Critical Thinking" />
      )}
      {has('specificCompetence') && (
        <TextField label="Specific Competence" value={plan.specificCompetence} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('specificCompetence', v)} />
      )}
      {has('specificOutcome') && (
        <TextField label="Specific Outcome" value={plan.specificOutcome} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('specificOutcome', v)} />
      )}
      {has('specificOutcomes') && (
        <ListField label="Specific Outcomes" items={plan.specificOutcomes}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('specificOutcomes', v)} placeholder="By the end, pupils can…" />
      )}

      <TextField label="Lesson Goal" value={plan.lessonGoal} rows={2}
        curriculumMode={curriculumMode} context={context}
        onChange={(v) => setField('lessonGoal', v)} />

      {has('rationale') && (
        <TextField label="Rationale" value={plan.rationale} rows={4}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('rationale', v)} />
      )}
      {has('priorKnowledge') && (
        <TextField label="Prior Knowledge" value={plan.priorKnowledge} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('priorKnowledge', v)} />
      )}
      {has('prerequisiteKnowledge') && (
        <TextField label="Pre-requisite Knowledge" value={plan.prerequisiteKnowledge} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('prerequisiteKnowledge', v)} />
      )}
      {has('references') && (
        <ListField label="References" items={plan.references}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('references', v)} placeholder="Syllabus p. …" />
      )}

      {has('learningEnvironment') && (
        <div className={cardCls}>
          <label className={labelCls}>Learning Environment</label>
          <div className="mt-1.5 space-y-2">
            {['natural', 'artificial', 'technological'].map((sub) => (
              <div key={sub}>
                <span className="text-[12px] font-semibold capitalize text-[#7a6d5d]">{sub}</span>
                <input type="text" value={env[sub] || ''} onChange={(e) => setEnv(sub, e.target.value)}
                  className={`${inputCls} mt-0.5`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {has('materials') && (
        <ListField label="Teaching & Learning Materials" items={plan.materials}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('materials', v)} placeholder="e.g. counters, chart" />
      )}
      {has('tlAids') && !has('materials') && (
        <ListField label="Teaching & Learning Aids" items={plan.tlAids}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('tlAids', v)} placeholder="e.g. counters, chart" />
      )}
      {has('expectedStandard') && (
        <TextField label="Expected Standard" value={plan.expectedStandard} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('expectedStandard', v)} />
      )}
      {/* ── Lesson progression (stages) ── */}
      <div className="mt-5 mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-[#5c4a3a]">Lesson Progression</h3>
        <button type="button" onClick={addStage}
          className="inline-flex items-center gap-1 rounded-lg border border-[#d9cfc3] bg-[#f5f0ea] px-2.5 py-1 text-[12px] font-medium text-[#5c4a3a] hover:bg-[#ede7df]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add stage
        </button>
      </div>
      {stages.map((stage, i) => (
        <StageEditor
          key={i}
          stage={stage}
          index={i}
          total={stages.length}
          stageName={stage.name || `Stage ${i + 1}`}
          curriculumMode={curriculumMode}
          context={context}
          onChange={(s) => setStage(i, s)}
          onMove={moveStage}
          onRemove={removeStage}
        />
      ))}

      {has('homework') && (
        <TextField label="Homework" value={plan.homework} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('homework', v)} />
      )}
      {has('remedialWork') && (
        <TextField label="Remedial Work" value={plan.remedialWork} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('remedialWork', v)} />
      )}
      {has('extensionActivity') && (
        <TextField label="Extension Activity" value={plan.extensionActivity} rows={2}
          curriculumMode={curriculumMode} context={context}
          onChange={(v) => setField('extensionActivity', v)} />
      )}
    </div>
  )
}
