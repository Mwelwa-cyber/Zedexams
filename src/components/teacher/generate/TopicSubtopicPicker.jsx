import { useEffect, useMemo, useRef, useState } from 'react'
import { getMergedSyllabi } from '../../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../../utils/syllabusMapping'
import { extract2013TopicLookup } from '../../../utils/syllabus2013Topics'
import { studioGradeToKbGrade, toKbSubjectKey } from '../paperTaxonomy'
import { createAsyncCache } from '../../../utils/requestDeduplication.js'
import { useAbortableRequest } from '../../../hooks/useAbortableRequest.js'

/**
 * Topic + sub-topic picker for the teacher generation studios.
 *
 * Each field has a "From syllabus / Write my own" toggle:
 *   • From syllabus → a <select> drop-down of the merged-syllabi topics
 *     (curriculum-data.json + admin overrides) for the chosen grade/subject.
 *   • Write my own  → a free-text input (still with <datalist> suggestions)
 *     for topics not yet in the syllabus.
 *
 * The field defaults to the drop-down, and falls back to "Write my own"
 * automatically when that grade/subject has no syllabus rows on file (or a
 * value is already set that the syllabus doesn't know about). Generators
 * that need to handle off-syllabus topics keep working unchanged.
 *
 * If the syllabi load fails for any reason (offline / unauthenticated /
 * unexpected shape), the drop-downs are empty and every field degrades to
 * a plain free-text input. No error, no behaviour change.
 *
 * API mirrors the local FieldText components each studio uses so the
 * swap is mechanical:
 *
 *   <FieldText label="Topic *" value={form.topic} ... />
 *   <FieldText label="Sub-topic (optional)" value={form.subtopic} ... />
 *
 * becomes
 *
 *   <TopicSubtopicPicker
 *     grade={form.grade} subject={form.subject}
 *     topic={form.topic} subtopic={form.subtopic}
 *     onChangeTopic={(v) => set('topic', v)}
 *     onChangeSubtopic={(v) => set('subtopic', v)} />
 */

// Cache keyed by curriculum framework ('2023' new CBC / '2013' old OBC), so
// flipping between studios doesn't re-fetch the syllabi every mount and the
// two frameworks don't trample each other. Shared `createAsyncCache` (see
// requestDeduplication.js) replaces the previous hand-rolled
// `_cacheByFw`/`_promiseByFw` module globals — same "load once, dedupe
// concurrent mounts" behaviour, just not reimplemented per file.
const lookupCache = createAsyncCache(loadFrameworkLookup, { name: 'topic-subtopic-lookup' })

// Grades still on the 2013 OBC syllabus. Zambia is rolling out the 2023 CBC
// gradually — currently live on CBC: ECE, G1, G2, G4, G8 (Form 1), G9 (Form 2).
// The rest remain on OBC until their grade is transitioned.
const GRADES_2013 = new Set(['G3', 'G5', 'G6', 'G7', 'G10', 'G11', 'G12'])

function resolveFramework(grade, frameworkProp) {
  // Normalize to KB grade code first so bare numbers ('7') and G-prefixed
  // values ('G7') both hit the GRADES_2013 set correctly.
  if (grade && GRADES_2013.has(studioGradeToKbGrade(grade))) return '2013'
  return frameworkProp || '2023'
}

async function build2023Lookup() {
  const merged = await getMergedSyllabi()
  const topics = syllabiToKbTopics(merged)
  const byKey = new Map() // key = "grade|subject" → Map<topic, Set<subtopic>>
  for (const t of topics) {
    const k = `${t.grade}|${t.subject}`
    let inner = byKey.get(k)
    if (!inner) { inner = new Map(); byKey.set(k, inner) }
    let subs = inner.get(t.topic)
    if (!subs) { subs = new Set(); inner.set(t.topic, subs) }
    for (const s of t.subtopics || []) {
      const name = typeof s === 'string' ? s : s?.name
      if (name) subs.add(String(name))
    }
  }
  return byKey
}

// 2013 OBC topics live in a static file next to the 2023 one, parsed by the
// shared extractor so the picker agrees with the server's 2013 grounding.
async function build2013Lookup() {
  const response = await fetch('/syllabi/curriculum-data-2013.json')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return extract2013TopicLookup(await response.json())
}

// The RAW builder is what the cache runs: it rejects on failure so
// createAsyncCache (which only stores a RESOLVED value) never caches an empty
// fallback. That is what lets the lookup self-heal — a syllabi load that fails
// once is retried on the next mount instead of latching "no rows on file" for
// the whole session.
function loadFrameworkLookup(framework) {
  return framework === '2013' ? build2013Lookup() : build2023Lookup()
}

// A failed load degrades to an empty Map for THIS caller (every field falls
// back to free text, no surfaced error) WITHOUT caching it — the rejection was
// never stored, so the next mount re-reads the syllabi.
function loadLookup(framework = '2023', options) {
  return lookupCache.get(framework, options).catch((err) => {
    console.warn('TopicSubtopicPicker: syllabi load failed', err)
    return new Map()
  })
}

export default function TopicSubtopicPicker({
  grade, subject,
  topic, subtopic,
  onChangeTopic, onChangeSubtopic,
  // Curriculum framework hint. '2023' new CBC (default) or '2013' old OBC.
  // Grade 7 and Grades 10-12 always use '2013' regardless of this prop —
  // those syllabuses have not yet been revised under the new CBC.
  framework = '2023',
  topicLabel = 'Topic *',
  subtopicLabel = 'Sub-topic (optional)',
  topicPlaceholder = 'e.g. Fractions',
  subtopicPlaceholder = 'e.g. Adding Fractions',
  topicMaxLength = 120,
  subtopicMaxLength = 160,
  // Themable hooks. Defaults match the studio-card style used by the
  // generation studios; callers in non-studio surfaces (the agent brief
  // form, etc.) override to keep visual consistency with the host page.
  inputClassName = 'studio-input',
  labelClassName = 'studio-label',
  hintClassName = 'text-xs text-slate-500 mt-1',
  warnClassName = 'text-xs text-amber-700 mt-1',
  fieldWrapperClassName = '',
}) {
  const effectiveFramework = resolveFramework(grade, framework)

  const [lookup, setLookup] = useState(() => lookupCache.peek(effectiveFramework) || null)
  // 'pick' = choose from the syllabus drop-down, 'write' = free text.
  const [topicMode, setTopicMode] = useState('pick')
  const [subtopicMode, setSubtopicMode] = useState('pick')
  const { run, cancel } = useAbortableRequest()

  useEffect(() => {
    const cached = lookupCache.peek(effectiveFramework)
    if (cached) { setLookup(cached); return undefined }
    setLookup(null)
    run(({ signal }) => loadLookup(effectiveFramework, { signal })).then((result) => {
      if (result.status === 'success') setLookup(result.data)
      // 'stale'/'aborted' — a newer framework switch already owns this.
      // loadLookup() catches its own failure and resolves with an empty Map, so
      // a real load failure arrives as a 'success' with no rows (free-text
      // fallback); since that empty Map was never cached, the next mount retries.
    }).catch(() => {}) // run() resolves a status object and never rejects; guards regardless
    return cancel
  }, [effectiveFramework, run, cancel])

  // null until the merged syllabi resolve — lets us tell "still loading"
  // apart from "genuinely no rows" so a drop-down can wait rather than
  // prematurely dropping to free text.
  const loading = lookup == null

  // Normalize grade and subject to KB-shape keys before building the lookup
  // key. This matches how syllabusTopicOptions.js (useSyllabusTopicOptions)
  // builds its key, so the two are consistent:
  //   • studioGradeToKbGrade('4') → 'G4'; 'G4' → 'G4' (idempotent)
  //   • toKbSubjectKey('cinyanja') → 'zambian_language' (teacher-taxonomy
  //     slug → canonical KB slug); 'mathematics' → 'mathematics' (idempotent)
  // Without this, selecting a teacher subject like 'cinyanja' builds a key
  // 'G4|cinyanja' that never matches the lookup's 'G4|zambian_language' entry,
  // so the syllabus dropdown silently shows empty.
  const normGrade = studioGradeToKbGrade(grade)
  const normSubject = toKbSubjectKey(subject)
  const innerKey = `${normGrade}|${normSubject}`
  const innerMap = useMemo(() => {
    if (!lookup) return null
    return lookup.get(innerKey) || null
  }, [lookup, innerKey])

  const topicOptions = useMemo(() => {
    if (!innerMap) return []
    return Array.from(innerMap.keys()).sort(byNaturalOrder)
  }, [innerMap])

  const subtopicOptions = useMemo(() => {
    if (!innerMap) return []
    // If the teacher's chosen topic matches one we know about, narrow the
    // sub-topic suggestions to that topic's children. Otherwise offer
    // every sub-topic for the grade+subject so they still get something
    // useful while entering a custom topic.
    const exact = innerMap.get(topic) ||
      Array.from(innerMap.entries())
        .find(([t]) => t.toLowerCase() === String(topic || '').toLowerCase())?.[1]
    if (exact) return Array.from(exact).sort(byNaturalOrder)
    const all = new Set()
    for (const subs of innerMap.values()) for (const s of subs) all.add(s)
    return Array.from(all).sort(byNaturalOrder)
  }, [innerMap, topic])

  const topicPickEmpty = !loading && topicOptions.length === 0

  // React to the grade/subject changing underneath the picker.
  //
  // A genuine change AFTER mount means any topic/sub-topic chosen for the
  // PREVIOUS grade/subject no longer belongs here — so clear it. Without this,
  // a topic picked for (say) Grade 4 Mathematics stayed in form state and was
  // submitted after the teacher switched to Grade 1 Numeracy, stamping an
  // off-grade topic ("Grade 4 ... Fractions") onto the wrong paper. This
  // mirrors the Assessment modal (CreatePaperModal.setMeta), which already
  // clears its topics on every grade/subject/framework change. Reset to the
  // drop-down for the new selection (the topicPickEmpty effect drops back to
  // free text when the new selection has no syllabus rows).
  //
  // On the FIRST evaluation (initial mount / deep-link / restored draft) we
  // keep whatever value was passed in and only surface an off-syllabus value
  // in "Write my own" — clearing a deep-linked topic on mount would be wrong.
  const lastEvalKey = useRef(null)
  useEffect(() => {
    if (loading || lastEvalKey.current === innerKey) return
    const isRealChange = lastEvalKey.current !== null
    lastEvalKey.current = innerKey
    if (isRealChange) {
      if (topic) onChangeTopic('')
      if (subtopic) onChangeSubtopic('')
      setTopicMode('pick')
      setSubtopicMode('pick')
      return
    }
    if (topic && !topicOptions.includes(topic)) setTopicMode('write')
    if (subtopic && !subtopicOptions.includes(subtopic)) setSubtopicMode('write')
  }, [loading, innerKey, topic, subtopic, topicOptions, subtopicOptions,
    onChangeTopic, onChangeSubtopic])

  // No syllabus rows at all → the drop-down would be a dead end.
  useEffect(() => {
    if (topicPickEmpty && topicMode === 'pick') setTopicMode('write')
  }, [topicPickEmpty, topicMode])

  // Switching to the drop-down drops a value the syllabus doesn't list, so
  // what's shown is what's sent (a stale custom value won't hide behind the
  // placeholder).
  function changeTopicMode(mode) {
    if (mode === 'pick' && topic && !topicOptions.includes(topic)) onChangeTopic('')
    setTopicMode(mode)
  }
  function changeSubtopicMode(mode) {
    if (mode === 'pick' && subtopic && !subtopicOptions.includes(subtopic)) onChangeSubtopic('')
    setSubtopicMode(mode)
  }

  const topicListId = `tp-topic-${innerKey.replace(/\W/g, '-')}`
  const subtopicListId = `tp-subtopic-${innerKey.replace(/\W/g, '-')}`
  const hasSyllabusMatch = innerMap !== null
  const syllabusCount = topicOptions.length

  return (
    <>
      <div className={fieldWrapperClassName}>
        <div style={pickerLabelRow}>
          <label className={labelClassName} style={{ marginBottom: 0 }}>{topicLabel}</label>
          <ModeToggle value={topicMode} onChange={changeTopicMode} pickDisabled={topicPickEmpty} />
        </div>
        {topicMode === 'pick' ? (
          <select
            className={inputClassName}
            value={topicOptions.includes(topic) ? topic : ''}
            disabled={loading}
            onChange={(e) => onChangeTopic(e.target.value)}>
            <option value="">
              {loading ? 'Loading syllabus topics…' : 'Choose a topic from the syllabus…'}
            </option>
            {topicOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <>
            <input
              type="text"
              value={topic || ''}
              onChange={(e) => onChangeTopic(e.target.value)}
              placeholder={topicPlaceholder}
              maxLength={topicMaxLength}
              className={inputClassName}
              list={topicListId}
              autoComplete="off"
            />
            {topicOptions.length > 0 && (
              <datalist id={topicListId}>
                {topicOptions.map((t) => <option key={t} value={t} />)}
              </datalist>
            )}
          </>
        )}
        {hasSyllabusMatch && syllabusCount > 0 && topicMode === 'write' && (
          <p className={hintClassName}>
            {syllabusCount} topic{syllabusCount === 1 ? '' : 's'} from the
            verified syllabus for {grade} {formatSubject(subject)} — start
            typing to filter, or switch to the drop-down.
          </p>
        )}
        {hasSyllabusMatch && syllabusCount === 0 && (
          <p className={warnClassName}>
            No syllabus entries on file for {grade} {formatSubject(subject)} yet.
            Type the topic — the AI will fall back to general CBC knowledge.
          </p>
        )}
      </div>

      <div className={fieldWrapperClassName}>
        <div style={pickerLabelRow}>
          <label className={labelClassName} style={{ marginBottom: 0 }}>{subtopicLabel}</label>
          <ModeToggle value={subtopicMode} onChange={changeSubtopicMode} />
        </div>
        {subtopicMode === 'pick' ? (
          <select
            className={inputClassName}
            value={subtopicOptions.includes(subtopic) ? subtopic : ''}
            disabled={loading}
            onChange={(e) => onChangeSubtopic(e.target.value)}>
            <option value="">
              {loading ? 'Loading…' : 'No specific sub-topic'}
            </option>
            {subtopicOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <>
            <input
              type="text"
              value={subtopic || ''}
              onChange={(e) => onChangeSubtopic(e.target.value)}
              placeholder={subtopicPlaceholder}
              maxLength={subtopicMaxLength}
              className={inputClassName}
              list={subtopicListId}
              autoComplete="off"
            />
            {subtopicOptions.length > 0 && (
              <datalist id={subtopicListId}>
                {subtopicOptions.map((s) => <option key={s} value={s} />)}
              </datalist>
            )}
          </>
        )}
      </div>
    </>
  )
}

const pickerLabelRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 8, marginBottom: 4,
}

// "From syllabus / Write my own" segmented toggle shown beside each label.
function ModeToggle({ value, onChange, pickLabel = 'From syllabus', writeLabel = 'Write my own', pickDisabled = false }) {
  const baseBtn = {
    border: 'none', background: 'none', fontSize: 11, fontWeight: 700,
    padding: '3px 9px', borderRadius: 999, lineHeight: 1.6, color: 'var(--zt-text-muted)',
    cursor: 'pointer',
  }
  const onStyle = { background: 'var(--zt-card)', color: 'var(--zt-text)', boxShadow: 'inset 0 0 0 1.5px #d88962' }
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 999, background: '#f1f5f9' }}>
      <button type="button"
        onClick={() => !pickDisabled && onChange('pick')}
        disabled={pickDisabled}
        title={pickDisabled ? 'No syllabus topics on file for this selection yet' : undefined}
        style={{ ...baseBtn, ...(value === 'pick' ? onStyle : null), opacity: pickDisabled ? 0.45 : 1, cursor: pickDisabled ? 'not-allowed' : 'pointer' }}>
        {pickLabel}
      </button>
      <button type="button"
        onClick={() => onChange('write')}
        style={{ ...baseBtn, ...(value === 'write' ? onStyle : null) }}>
        {writeLabel}
      </button>
    </div>
  )
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Numbered syllabus codes ("1.1", "1.2", …, "1.10") must order by their
// numeric parts, not lexically — a plain localeCompare puts "1.10" before
// "1.2". The `numeric` collation compares embedded numbers as numbers, so
// "1.2 Etiquette" sorts before "1.10 Sentences" while un-numbered topics
// still fall back to a sensible alphabetical order.
function byNaturalOrder(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
