// Syllabus-backed subject / topic / sub-topic suggestions for the Assessment
// Studio's AI tools. Same data source as TopicSubtopicPicker (merged syllabi:
// curriculum-data.json + admin KB overrides — covers both the 2023 CBC and
// the older 2013 syllabus rows), exposed as hooks that return plain option
// arrays so the studio can feed its own <select>/<datalist> inputs.

import { useEffect, useState } from 'react'
import { getMergedSyllabi } from '../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../utils/syllabusMapping'
import { extract2013TopicLookup } from '../../utils/syllabus2013Topics'
import { normalizeTopicLookup } from '../../utils/syllabusTopicTree'
import {
  studioGradeToKbGrade, toKbSubjectKey, subjectLabel, getLevelCatalogue, paperLevel,
} from './paperTaxonomy'
import {
  applyFrameworkLevelLabel, levelLabelForFramework,
} from './frameworkLevelLabels'

// Curriculum frameworks the pickers can suggest from. Values match the
// server's normalizeFramework whitelist (resolveCbcContext grounds the
// actual generation on the same value).
export const CURRICULUM_FRAMEWORKS = [
  { value: '2023', label: 'New CBC (2023) — competency-based' },
  { value: '2013', label: 'Previous syllabus (2013) — outcome-based' },
]

/** Coerce any stored/legacy framework value to a valid one ('2023' default). */
export function normalizeStudioFramework(value) {
  return String(value || '') === '2013' ? '2013' : '2023'
}

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
      // Re-derive the real TOPIC → SUB-TOPIC tree from the syllabus numbering
      // before anything reads it, so a sub-topic that lost its parent at a PDF
      // page break can never surface as a sibling topic. A well-formed
      // catalogue passes through unchanged (see syllabusTopicTree.js).
      _lookupCache = normalizeTopicLookup(byKey)
      return _lookupCache
    } catch {
      // Degrade to an empty lookup for THIS caller but do NOT cache it —
      // leaving _lookupCache null lets the next call retry (self-heal) instead
      // of latching an empty lookup for the whole session on a transient blip.
      return new Map()
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
      // Degrade to an empty lookup for THIS caller but do NOT cache it — the
      // next call retries instead of latching an empty 2013 lookup for the
      // session (mirrors loadLookup above).
      return new Map()
    } finally {
      _lookup2013Promise = null
    }
  })()
  return _lookup2013Promise
}

function cachedLookupFor(framework) {
  return framework === '2013' ? _lookup2013Cache : _lookupCache
}

function loadLookupFor(framework) {
  return framework === '2013' ? load2013Lookup() : loadLookup()
}

// Shared loader hook: returns the lookup Map for exactly the chosen framework
// plus a `loading` flag. State is tagged with its framework so switching CBC ↔
// previous curriculum can never expose the old curriculum's cached subjects or
// topics for even one render while the new file is loading.
function useSyllabusLookup(framework = '2023') {
  const fw = normalizeStudioFramework(framework)
  const [state, setState] = useState(() => ({
    framework: fw,
    lookup: cachedLookupFor(fw),
  }))
  const cached = cachedLookupFor(fw)
  const lookup = cached || (state.framework === fw ? state.lookup : null)

  useEffect(() => {
    const ready = cachedLookupFor(fw)
    if (ready) {
      setState({ framework: fw, lookup: ready })
      return undefined
    }
    let cancelled = false
    // Immediately hide the previous framework's options. Without the framework
    // tag React could render one stale CBC/OBC list before this effect settled.
    setState({ framework: fw, lookup: null })
    loadLookupFor(fw)
      .then((l) => { if (!cancelled) setState({ framework: fw, lookup: l }) })
      .catch(() => { if (!cancelled) setState({ framework: fw, lookup: new Map() }) })
    return () => { cancelled = true }
  }, [fw])

  return { lookup, loading: lookup == null }
}

/**
 * Non-hook resolvers for the canonical curriculum catalogue's topic provider
 * (src/config/curriculumCatalog.js). Same merged-syllabi data the hooks use,
 * exposed as plain async functions so the catalogue can serve topics/subtopics
 * to any consumer (not just React). `gradeCode` is a KB grade code (ECE_N / G4),
 * `subjectKey` a canonical subject slug (english / numeracy), `framework`
 * '2023' | '2013'.
 */
export async function resolveSyllabusTopics(gradeCode, subjectKey, framework = '2023') {
  const lookup = await (String(framework) === '2013' ? load2013Lookup() : loadLookup())
  const key = `${String(gradeCode || '').toUpperCase()}|${String(subjectKey || '').toLowerCase()}`
  const inner = lookup?.get(key)
  return inner ? Array.from(inner.keys()).sort() : []
}

export async function resolveSyllabusSubtopics(gradeCode, subjectKey, topic, framework = '2023') {
  const lookup = await (String(framework) === '2013' ? load2013Lookup() : loadLookup())
  const key = `${String(gradeCode || '').toUpperCase()}|${String(subjectKey || '').toLowerCase()}`
  const inner = lookup?.get(key)
  const subs = inner?.get(String(topic || '').trim())
  return subs ? Array.from(subs).sort() : []
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
  // The label is resolved AGAINST THE GRADE, not from the key alone: the
  // combined maths/science area is "Pre-Mathematics and Science" at Nursery /
  // Reception and "Mathematics and Science" from Grade 1, and both are stored
  // under the one `numeracy` slug.
  const subjects = Array.from(keys)
    .map((key) => ({ key, label: subjectLabel(key, g) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return { subjects, loading }
}

/**
 * Hook: the education levels that genuinely have syllabus records for the
 * chosen curriculum framework, as enriched, EDUCATIONALLY-ORDERED options
 * ({ value, label, stage, group, … }).
 *
 * The Syllabi Studio's KB grade code remains the identity. Only the displayed
 * wording changes by framework: the 2013 curriculum shows Grade 1–Grade 12,
 * while CBC shows Nursery, Reception, Grade 1–6 and Form 1–4. This prevents
 * G8–G12 from being incorrectly relabelled as Forms in the 2013 picker.
 *
 * While the syllabus index is still loading `loading` is true and every level
 * reads as available (so the picker is usable immediately and never momentarily
 * empty); once resolved each carries its real `availability` + `message`.
 * `currentValue` is always kept selectable so an existing paper never loses its
 * saved grade — even a legacy one absent from the current data.
 */
export function useSyllabusLevelOptions(framework = '2023', currentValue = '') {
  const fw = normalizeStudioFramework(framework)
  const { lookup, loading } = useSyllabusLookup(fw)
  const curriculumId = fw === '2013' ? 'previous' : 'cbc'

  // Present KB grade codes = the "GRADE|subject" keys' grade halves.
  let gradeCodes = null
  if (lookup) {
    gradeCodes = new Set()
    for (const k of lookup.keys()) {
      const code = String(k).split('|')[0]
      if (code) gradeCodes.add(code)
    }
  }

  // EVERY level of the curriculum, annotated with whether its syllabus is
  // actually on file. The labels are projected from the selected framework:
  // G8 is "Grade 8" in 2013 and "Form 1" in CBC, while the stored value stays G8.
  const levels = getLevelCatalogue({ curriculumId, gradeCodes })
    .map((level) => applyFrameworkLevelLabel(level, fw))

  // Guarantee the paper's own saved level stays pickable (legacy or narrowed
  // out) so switching curriculum/loading never drops a valid current value.
  const current = String(currentValue || '').trim()
  if (current && !levels.some((o) => o.value === current)) {
    const meta = paperLevel(current)
    if (meta) {
      const displayLabel = levelLabelForFramework(meta, fw)
      levels.push({
        value: current,
        label: meta.legacy ? `${displayLabel} (Legacy)` : displayLabel,
        id: meta.id,
        stage: meta.stage,
        order: meta.order,
        group: meta.legacy ? 'Legacy' : 'Other',
        legacy: !!meta.legacy,
        // A paper's own saved level stays selectable whatever the catalogue
        // says — refusing to reopen it would be worse than generating against
        // thin data, and the teacher can change it.
        availability: 'available',
        message: '',
        unavailable: false,
      })
      levels.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    }
  }

  return { levels, loading }
}

/**
 * Hook: subject choices for the studio's OWN <select>s (the paper-header
 * builder + the AI quick-questions slide), as display LABELS — unlike
 * CreatePaperModal, the studio form stores the label ('Integrated Science'),
 * which is what prints on the paper.
 *
 * Subjects come STRICTLY from the live Syllabus Studio for the chosen grade +
 * curriculum — no static fallback. Every level offers exactly the subjects it
 * is actually taught (Grade 10 → Physics/Chemistry/Biology, Grade 1 →
 * Literacy/Numeracy), and CBC vs the previous syllabus never collapse to one
 * identical hardcoded list. While the syllabus is still loading the list is
 * empty (callers surface a loading state via the returned `loading` flag).
 * `currentSubject` is always kept selectable so an existing paper never loses
 * its saved subject when the syllabus list changes under it.
 */
export function useStudioSubjectChoices(grade, framework = '2023', currentSubject = '') {
  const { subjects, loading } = useSyllabusSubjectOptions(grade, normalizeStudioFramework(framework))
  const labels = loading ? [] : subjects.map((s) => s.label)
  const current = String(currentSubject || '').trim()
  const options = current && !labels.includes(current) ? [current, ...labels] : labels
  return { options, loading }
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
