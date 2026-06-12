// Syllabus-backed topic/sub-topic suggestions for the Assessment Studio's
// AI tools. Same data source as TopicSubtopicPicker (merged syllabi:
// curriculum-data.json + admin KB overrides — covers both the 2023 CBC
// and the older syllabus rows), but exposed as a hook that returns plain
// option arrays so the studio can feed its own <datalist> inputs.

import { useEffect, useState } from 'react'
import { getMergedSyllabi } from '../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../utils/syllabusMapping'
import { extract2013TopicLookup } from '../../utils/syllabus2013Topics'
import { normalizeSubject } from '../../config/curriculum.js'

// Curriculum frameworks the pickers can suggest from. Values match the
// server's normalizeFramework whitelist (resolveCbcContext grounds the
// actual generation on the same value).
export const CURRICULUM_FRAMEWORKS = [
  { value: '2023', label: 'New CBC (2023)' },
  { value: '2013', label: 'Old syllabus (2013)' },
]

// Studio form values → KB keys. The studio stores grade as '4' and
// subject as a display label ('Integrated Science').
export function studioGradeToKbGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (!g) return ''
  return g.startsWith('G') || g.startsWith('F') || g === 'ECE' ? g : `G${g}`
}

const SUBJECT_FIXES = {
  expressive_art: 'expressive_arts',
  science: 'integrated_science',
}

export function studioSubjectToKey(subject) {
  const norm = normalizeSubject(String(subject || ''))
  const key = String(norm || subject || '')
    .toLowerCase().trim().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')
  return SUBJECT_FIXES[key] || key
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

/**
 * Hook: topic + sub-topic suggestion lists for a studio grade/subject from
 * the chosen curriculum framework ('2023' new CBC default, '2013' old
 * syllabus). Degrades to empty arrays when the syllabi can't load —
 * callers keep their inputs as plain free text.
 */
export function useSyllabusTopicOptions(grade, subject, topic = '', framework = '2023') {
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

  const key = `${studioGradeToKbGrade(grade)}|${studioSubjectToKey(subject)}`
  const inner = lookup?.get(key)
  const topics = inner ? Array.from(inner.keys()).sort() : []
  const subs = inner?.get(String(topic || '').trim())
  const subtopics = subs ? Array.from(subs).sort() : []
  return { topics, subtopics }
}
