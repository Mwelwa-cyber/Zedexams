import { useEffect, useMemo, useState } from 'react'
import { getMergedSyllabi } from '../../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../../utils/syllabusMapping'

/**
 * Topic + sub-topic picker for the teacher generation studios.
 *
 * Visually two regular text inputs (studio-input class to match the rest
 * of the form), but each is wired to an HTML5 <datalist> populated from
 * the merged syllabi source (curriculum-data.json + admin overrides).
 * The teacher can still type anything they want — datalist is suggestion
 * UX, not a constraint — so generators that need to handle topics not
 * yet in the KB continue to work unchanged.
 *
 * If the syllabi load fails for any reason (offline / unauthenticated /
 * unexpected shape), the datalists are empty and the inputs degrade to
 * plain free-text fields. No spinner, no error, no behaviour change.
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

  useEffect(() => {
    if (_lookupCache) { setLookup(_lookupCache); return undefined }
    let cancelled = false
    loadLookup()
      .then((v) => { if (!cancelled) setLookup(v) })
      .catch(() => { /* loadLookup already swallows + logs; setLookup stays null */ })
    return () => { cancelled = true }
  }, [])

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
    // If the teacher's typed topic matches one we know about, narrow the
    // sub-topic suggestions to that topic's children. Otherwise offer
    // every sub-topic for the grade+subject so they still get something
    // useful while typing a custom topic.
    const exact = innerMap.get(topic) ||
      Array.from(innerMap.entries())
        .find(([t]) => t.toLowerCase() === String(topic || '').toLowerCase())?.[1]
    if (exact) return Array.from(exact).sort((a, b) => a.localeCompare(b))
    const all = new Set()
    for (const subs of innerMap.values()) for (const s of subs) all.add(s)
    return Array.from(all).sort((a, b) => a.localeCompare(b))
  }, [innerMap, topic])

  const topicListId = `tp-topic-${innerKey.replace(/\W/g, '-')}`
  const subtopicListId = `tp-subtopic-${innerKey.replace(/\W/g, '-')}`
  const hasSyllabusMatch = innerMap !== null
  const syllabusCount = topicOptions.length

  return (
    <>
      <div className={fieldWrapperClassName}>
        <label className={labelClassName}>{topicLabel}</label>
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
        {hasSyllabusMatch && syllabusCount > 0 && (
          <p className={hintClassName}>
            {syllabusCount} topic{syllabusCount === 1 ? '' : 's'} from the
            verified syllabus for {grade} {formatSubject(subject)} — start
            typing to filter, or enter your own.
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
        <label className={labelClassName}>{subtopicLabel}</label>
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
      </div>
    </>
  )
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
