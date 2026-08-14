/**
 * Provenance, on the surface where it is acted on (§3b).
 *
 * Three states, and the third is why this is a component rather than a
 * conditional badge:
 *
 *   - GROUNDED — "✓ Grounded in Grade 4 Integrated Science syllabus · 6
 *     outcomes", and tapping it lists the outcomes the notes were written
 *     against. A count nobody can expand is a claim; the list is the evidence.
 *   - NOT GROUNDED — the amber notice, in words: no syllabus data was found for
 *     this topic, so the notes came from general curriculum knowledge and want
 *     reviewing. Never a missing chip, which a teacher reads as "fine".
 *   - UNAVAILABLE — the syllabus could not be READ. Distinct from "there is
 *     none", because telling a teacher their curriculum has no data for a topic
 *     it does have data for is telling them something false about their own
 *     syllabus.
 *
 * The scope and voice check results ride alongside, for the same reason: a
 * check that only ever appeared in one render is a check nobody can act on when
 * the document is reopened a week later.
 */

import { useState } from 'react'
import Icon from '../../../shared/components/Icon'
import { AlertTriangle, Check, ChevronDown } from '../../../shared/components/icons'

export default function GroundingChip({ grounding, checks }) {
  const [open, setOpen] = useState(false)
  if (!grounding) return null

  const problems = []
  if (checks && checks.voiceClean === false) {
    problems.push(checks.voiceMessage || 'Some wording still reads as instructions to the teacher.')
  }
  if (checks && checks.scopeClean === false && checks.scopeMessage) {
    problems.push(`Scope check — ${checks.scopeMessage}.`)
  }

  if (!grounding.grounded) {
    return (
      <div className="rounded-xl border-2 px-4 py-3 text-sm"
        style={{ borderColor: '#e0b34a', background: '#fdf6e3', color: '#6b4b12' }}>
        <p className="font-bold flex items-center gap-1.5">
          <Icon as={AlertTriangle} size="sm" />
          {grounding.label}
        </p>
        <p className="mt-0.5 text-xs">{grounding.message}</p>
        {problems.map((p) => <p key={p} className="mt-1 text-xs">{p}</p>)}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
        style={{ border: '1.5px solid #0f766e', color: '#0f766e', background: '#effaf7' }}
      >
        <Icon as={Check} size="xs" />
        {grounding.label}
        <Icon as={ChevronDown} size="xs" />
      </button>
      {open && (
        <ul className="mt-2 space-y-1 rounded-xl border p-3 text-xs theme-border theme-text">
          {grounding.outcomes.map((o) => <li key={o}>• {o}</li>)}
        </ul>
      )}
      {problems.length > 0 && (
        <div className="mt-2 rounded-xl border-2 px-3 py-2 text-xs"
          style={{ borderColor: '#e0b34a', background: '#fdf6e3', color: '#6b4b12' }}>
          {problems.map((p) => <p key={p}>{p}</p>)}
        </div>
      )}
    </div>
  )
}
