// Syllabus-backed topic/sub-topic suggestions for the Assessment Studio's
// AI tools. Same data source as TopicSubtopicPicker (merged syllabi:
// curriculum-data.json + admin KB overrides — covers both the 2023 CBC
// and the older syllabus rows), but exposed as a hook that returns plain
// option arrays so the studio can feed its own <datalist> inputs.

import { useEffect, useState } from 'react'
import { getMergedSyllabi } from '../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../utils/syllabusMapping'
import { normalizeSubject } from '../../config/curriculum.js'

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

/**
 * Hook: topic + sub-topic suggestion lists for a studio grade/subject.
 * Degrades to empty arrays when the syllabi can't load — callers keep
 * their inputs as plain free text.
 */
export function useSyllabusTopicOptions(grade, subject, topic = '') {
  const [lookup, setLookup] = useState(_lookupCache)
  useEffect(() => {
    if (lookup) return
    let cancelled = false
    loadLookup()
      .then((l) => { if (!cancelled) setLookup(l) })
      .catch(() => { if (!cancelled) setLookup(new Map()) })
    return () => { cancelled = true }
  }, [lookup])

  const key = `${studioGradeToKbGrade(grade)}|${studioSubjectToKey(subject)}`
  const inner = lookup?.get(key)
  const topics = inner ? Array.from(inner.keys()).sort() : []
  const subs = inner?.get(String(topic || '').trim())
  const subtopics = subs ? Array.from(subs).sort() : []
  return { topics, subtopics }
}
