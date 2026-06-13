import { useEffect, useMemo, useRef, useState } from 'react'
import { getMergedSyllabi } from '../../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../../utils/syllabusMapping'

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

// Module-scope cache so flipping between studios doesn't re-fetch the
// merged syllabi every mount. getMergedSyllabi() also caches internally,
// but this layer skips the recomputation of the lookup index too.
let _lookupCache = null
let _lookupPromise = null

async function loadLookup() {
  if (_lookupCache) return _lookupCache
  if (_lookupPromise) return _lookupPromise
  _lookupPromise = (async () => {
    try {
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
      _lookupCache = byKey
      return byKey
    } catch (err) {
      console.warn('TopicSubtopicPicker: syllabi load failed', err)
      _lookupCache = new Map()
      return _lookupCache
    } finally {
      _lookupPromise = null
    }
  })()
  return _lookupPromise
}

export default function TopicSubtopicPicker({
  grade, subject,
  topic, subtopic,
  onChangeTopic, onChangeSubtopic,
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
  const [lookup, setLookup] = useState(_lookupCache)
  // 'pick' = choose from the syllabus drop-down, 'write' = free text.
  const [topicMode, setTopicMode] = useState('pick')
  const [subtopicMode, setSubtopicMode] = useState('pick')

  useEffect(() => {
    if (_lookupCache) { setLookup(_lookupCache); return undefined }
    let cancelled = false
    loadLookup()
      .then((v) => { if (!cancelled) setLookup(v) })
      .catch(() => { /* loadLookup already swallows + logs; setLookup stays null */ })
    return () => { cancelled = true }
  }, [])

  // null until the merged syllabi resolve — lets us tell "still loading"
  // apart from "genuinely no rows" so a drop-down can wait rather than
  // prematurely dropping to free text.
  const loading = lookup == null

  const innerKey = `${grade || ''}|${subject || ''}`
  const innerMap = useMemo(() => {
    if (!lookup) return null
    return lookup.get(innerKey) || null
  }, [lookup, innerKey])

  const topicOptions = useMemo(() => {
    if (!innerMap) return []
    return Array.from(innerMap.keys()).sort((a, b) => a.localeCompare(b))
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
    if (exact) return Array.from(exact).sort((a, b) => a.localeCompare(b))
    const all = new Set()
    for (const subs of innerMap.values()) for (const s of subs) all.add(s)
    return Array.from(all).sort((a, b) => a.localeCompare(b))
  }, [innerMap, topic])

  const topicPickEmpty = !loading && topicOptions.length === 0

  // On first settle, start in "write" for any value the syllabus doesn't
  // know — so a pre-filled custom topic/sub-topic shows instead of looking
  // blank in the drop-down. Only runs once, before the teacher interacts.
  const autoModeApplied = useRef(false)
  useEffect(() => {
    if (loading || autoModeApplied.current) return
    autoModeApplied.current = true
    if (topic && !topicOptions.includes(topic)) setTopicMode('write')
    if (subtopic && !subtopicOptions.includes(subtopic)) setSubtopicMode('write')
  }, [loading, topic, subtopic, topicOptions, subtopicOptions])

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
    padding: '3px 9px', borderRadius: 999, lineHeight: 1.6, color: '#64748b',
    cursor: 'pointer',
  }
  const onStyle = { background: '#fff', color: '#0f172a', boxShadow: 'inset 0 0 0 1.5px #fb923c' }
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
