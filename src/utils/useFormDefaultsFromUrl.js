/**
 * Read URL query params and produce form-default overrides for the
 * teacher-tool generators. Used so that clicking "Generate similar" on a
 * library item or following a shared deep-link pre-fills the form.
 *
 * Usage:
 *   const [form, setForm] = useState(() => ({ ...DEFAULTS, ...useDefaultsFromUrl() }))
 *
 * Safe on server-side render (window check). Only whitelisted param names
 * are read, so random junk on the URL can't pollute form state.
 */

import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

const STRING_KEYS = [
  'grade', 'subject', 'topic', 'subtopic',
  'teacherName', 'school', 'language',
  'difficulty', 'instructions',
  'lessonPlanId', 'learningEnvironment',
]

const NUMBER_KEYS = [
  'durationMinutes', 'numberOfPupils', 'count',
  'term', 'numberOfWeeks',
  'lessonNumber', 'totalLessons',
]

const BOOL_KEYS = [
  'includeAnswerKey',
]

export function useFormDefaultsFromUrl() {
  const [params] = useSearchParams()

  return useMemo(() => {
    const out = {}
    for (const key of STRING_KEYS) {
      const v = params.get(key)
      if (v != null && v !== '') out[key] = v
    }
    for (const key of NUMBER_KEYS) {
      const v = params.get(key)
      if (v != null && v !== '') {
        const n = Number(v)
        if (Number.isFinite(n)) out[key] = n
      }
    }
    for (const key of BOOL_KEYS) {
      const v = params.get(key)
      if (v === 'true') out[key] = true
      if (v === 'false') out[key] = false
    }
    return out
  }, [params])
}

/**
 * Build a query string from an inputs object — the inverse operation.
 * Used by "Generate similar" to serialise a library item into a URL.
 */
export function buildGeneratorQueryString(inputs = {}) {
  const params = new URLSearchParams()
  for (const key of [...STRING_KEYS, ...NUMBER_KEYS, ...BOOL_KEYS]) {
    const v = inputs[key]
    if (v != null && v !== '') {
      params.set(key, String(v))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}
