/**
 * Client wrapper for the `reviseLessonSection` Cloud Function.
 *
 * AI-edits ONE part of a generated lesson plan (used by the Lesson Plan Studio
 * editor). Returns the revised content in the same shape it was asked for:
 *   - kind 'text' → { text }
 *   - kind 'list' → { items }
 *
 * Usage:
 *   const { text } = await reviseLessonSection({
 *     sectionLabel: 'Rationale', kind: 'text', curriculumMode: 'cbc',
 *     current: plan.rationale, modifier: 'simpler',
 *     context: { grade, subject, topic, subtopic },
 *   })
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const callable = httpsCallable(functions, 'reviseLessonSection', { timeout: 60_000 })

/** Turn a Functions error into a teacher-friendly message. */
export function messageFromReviseError(error) {
  const code = error?.code || ''
  const msg = error?.message || ''
  if (code.includes('failed-precondition') && /limit|quota|cap/i.test(msg)) {
    // Pass the quota copy through verbatim — it names the plan + reset.
    return msg
  }
  if (code.includes('permission-denied')) {
    return 'AI editing is available to approved teachers only.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in again to use AI editing.'
  }
  if (code.includes('invalid-argument')) {
    return msg || 'Tell the AI what to change, then try again.'
  }
  return 'The AI edit failed. Please try again.'
}

/**
 * @param {object} args
 *   sectionLabel {string}  human-readable section name (e.g. "Lesson Goal")
 *   kind {'text'|'list'}
 *   curriculumMode {'cbc'|'previous'}
 *   current {string|string[]}  current content
 *   modifier {string|null}  one of simpler/detailed/shorter/polish/rewrite
 *   instruction {string}  free-text instruction (optional)
 *   context {{grade,subject,topic,subtopic}}
 * @returns {Promise<{text?:string, items?:string[], model:string}>}
 */
export async function reviseLessonSection(args = {}) {
  const payload = {
    sectionLabel: String(args.sectionLabel || ''),
    kind: args.kind === 'list' ? 'list' : 'text',
    curriculumMode: args.curriculumMode === 'previous' ? 'previous' : 'cbc',
    current: args.current ?? (args.kind === 'list' ? [] : ''),
    modifier: args.modifier || null,
    instruction: String(args.instruction || ''),
    context: {
      grade: String(args.context?.grade || ''),
      subject: String(args.context?.subject || ''),
      topic: String(args.context?.topic || ''),
      subtopic: String(args.context?.subtopic || ''),
    },
    // Collapses a double-click to one provider call + charge; the server refuses
    // a keyless call.
    idempotencyKey: args.idempotencyKey,
  }
  const result = await callable(payload)
  const data = result.data || {}
  // The server already has this exact request in flight (a retry / another tab).
  if (data.status === 'processing') return { status: 'processing' }
  return data
}
