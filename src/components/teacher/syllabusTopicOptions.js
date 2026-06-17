// Syllabus-backed subject / topic / sub-topic suggestions for the Assessment
// Studio's AI tools. Same data source as TopicSubtopicPicker (merged syllabi:
// curriculum-data.json + admin KB overrides — covers both the 2023 CBC and
// the older 2013 syllabus rows), exposed as hooks that return plain option
// arrays so the studio can feed its own <select>/<datalist> inputs.

import { useEffect, useState } from 'react'
import { getMergedSyllabi } from '../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../utils/syllabusMapping'
import { extract2013TopicLookup } from '../../utils/syllabus2013Topics'
import {
  studioGradeToKbGrade, toKbSubjectKey, subjectLabel,
} from './paperTaxonomy'

// Curriculum frameworks the pickers can suggest from. Values match the
// server's normalizeFramework whitelist (resolveCbcContext grounds the
// actual generation on the same value).
export const CURRICULUM_FRAMEWORKS = [
  { value: '2023', label: 'New CBC (2023)' },
  { value: '2013', label: 'Old syllabus (2013)' },
]

// Re-exported from the pure taxonomy module so existing importers
// (AssessmentStudio, GeneratePanel) keep working unchanged.
export { studioGradeToKbGrade }

// Back-compat alias: callers historically imported `studioSubjectToKey` from
// here. It now delegates to the shared, idempotent canonical-key resolver.
export function studioSubjectToKey(subject) {
  return toKbSubjectKey(subject)
}

let _lookupCache = null
let _lookupPromise = null

async function loadLookup() {
  if (_lookupCache) return _lookupCache
  if (_lookupPromise) return _lookupPromise
  _lookupPromise = (async () => {
    try {
      const merged = await getMergedSyllabi()
      const topics = syllabiToKbTopics(merged)
      const byKey = new Map() // "GRADE|subject" → Map<topic, Set<subtopic>>
      for (const t of topics) {
        const grade = String(t.grade || '').toUpperCase()
        const subject = String(t.subject || '').toLowerCase()
        const topic = String(t.topic || '').trim()
        if (!grade || !subject || !topic) continue
        const k = `${grade}|${subject}`
        let inner = byKey.get(k)
        if (!inner) { inner = new Map(); byKey.set(k, inner) }
        let subs = inner.get(topic)
        if (!subs) { subs = new Set(); inner.set(topic, subs) }
        for (const s of (Array.isArray(t.subtopics) ? t.subtopics : [])) {
          const name = typeof s === 'string' ? s : (s && s.name) || ''
          if (String(name).trim()) subs.add(String(name).trim())
        }
      }
      _lookupCache = byKey
      return byKey
    } catch {
      _lookupCache = new Map()
      return _lookupCache
    } finally {
      _lookupPromise = null
    }
  })()
  return _lookupPromise
}

// Old-syllabus (2013) lookup — served as a static JSON next to the 2023
// file; parsed by the shared extractor so the server and client agree.
let _lookup2013Cache = null
let _lookup2013Promise = null

async function load2013Lookup() {
  if (_lookup2013Cache) return _lookup2013Cache
  if (_lookup2013Promise) return _lookup2013Promise
  _lookup2013Promise = (async () => {
    try {
      const response = await fetch('/syllabi/curriculum-data-2013.json')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const raw = await response.json()
      _lookup2013Cache = extract2013TopicLookup(raw)
      return _lookup2013Cache
    } catch {
      _lookup2013Cache = new Map()
      return _lookup2013Cache
    } finally {
      _lookup2013Promise = null
    }
  })()
  return _lookup2013Promise
}

// Shared loader hook: returns the merged lookup Map for the chosen framework
// plus a `loading` flag. Both the subject and topic hooks build on it.
function useSyllabusLookup(framework = '2023') {
  const is2013 = framework === '2013'
  const [lookup, setLookup] = useState(is2013 ? _lookup2013Cache : _lookupCache)
  useEffect(() => {
    const cached = is2013 ? _lookup2013Cache : _lookupCache
    if (cached) { setLookup(cached); return undefined }
    let cancelled = false
    setLookup(null)
    ;(is2013 ? load2013Lookup() : loadLookup())
      .then((l) => { if (!cancelled) setLookup(l) })
      .catch(() => { if (!cancelled) setLookup(new Map()) })
    return () => { cancelled = true }
  }, [is2013])
  return { lookup, loading: lookup == null }
}

/**
 * Hook: the subjects that actually have syllabus rows for a grade in the
 * chosen framework, as { key, label } pairs. This is what fixes "Grade 1 has
 * no syllabus" — lower-primary/ECE bundle their subjects under keys
 * (numeracy, zambian_language, creative_and_technology_studies) that a fixed
 * upper-grade subject list never matched. Returns `loading` so callers can
 * fall back to a static list only after the fetch settles.
 */
export function useSyllabusSubjectOptions(grade, framework = '2023') {
  const { lookup, loading } = useSyllabusLookup(framework)
  const g = studioGradeToKbGrade(grade)
  const prefix = `${g}|`
  const keys = new Set()
  if (lookup && g) {
    for (const k of lookup.keys()) {
      if (k.startsWith(prefix)) keys.add(k.slice(prefix.length))
    }
  }
  const subjects = Array.from(keys)
    .map((key) => ({ key, label: subjectLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return { subjects, loading }
}

/**
 * Hook: topic + sub-topic suggestion lists for a studio grade/subject from
 * the chosen curriculum framework ('2023' new CBC default, '2013' old
 * syllabus). `topic` may be a single topic string or an array of topics —
 * sub-topics are the UNION across all of them (so a multi-topic monthly test
 * can pick sub-topics from every topic it covers). Degrades to empty arrays
 * when the syllabi can't load — callers keep their inputs as plain free text.
 */
export function useSyllabusTopicOptions(grade, subject, topic = '', framework = '2023') {
  const { lookup, loading } = useSyllabusLookup(framework)

  const key = `${studioGradeToKbGrade(grade)}|${toKbSubjectKey(subject)}`
  const inner = lookup?.get(key)
  const topics = inner ? Array.from(inner.keys()).sort() : []

  const requested = (Array.isArray(topic) ? topic : [topic])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
  const subSet = new Set()
  if (inner) {
    for (const t of requested) {
      const subs = inner.get(t)
      if (subs) for (const s of subs) subSet.add(s)
    }
  }
  const subtopics = Array.from(subSet).sort()

  // `loading` lets callers distinguish "syllabi still fetching" (empty for
  // now) from "genuinely no rows for this grade/subject" so a drop-down can
  // wait rather than prematurely falling back to free text.
  return { topics, subtopics, loading }
}
