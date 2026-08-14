// src/features/notes/components/NoteInsights.jsx
//
// "AI study help" panel for the note reader: an AI Summary and Key Points,
// generated on demand (cached server-side, so a second learner gets it
// instantly). Collapsed by default; `autoOpen` expands + loads immediately
// (used when a learner taps "AI Summary" on the library card).

import { useState, useCallback, useEffect, useRef } from 'react'
import { Sparkles, ListChecks, Loader2, ChevronDown, AlertCircle } from '../../../shared/components/icons'
import { fetchCachedInsights, generateInsights, insightsErrorMessage } from '../lib/insights'

export function NoteInsights({ noteId, autoOpen = false }) {
  const [open, setOpen] = useState(autoOpen)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const started = useRef(false)

  const load = useCallback(async () => {
    if (!noteId || started.current) return
    started.current = true // single-flight guard, set before any await
    setStatus('loading')
    setError('')
    try {
      const cached = await fetchCachedInsights(noteId)
      const result = cached || (await generateInsights(noteId))
      setData(result)
      setStatus('ready')
    } catch (err) {
      setError(insightsErrorMessage(err))
      setStatus('error')
    }
  }, [noteId])

  // Clear the guard synchronously, then retry (used by the error CTA).
  const retry = useCallback(() => {
    started.current = false
    load()
  }, [load])

  // Expand + load when asked to auto-open (from the card CTA).
  useEffect(() => {
    if (autoOpen) { setOpen(true); load() }
  }, [autoOpen, load])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && status === 'idle') load()
  }

  return (
    <div className="notes-card overflow-hidden my-6">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2.5 p-4 text-left"
        aria-expanded={open}
      >
        <span className="w-9 h-9 rounded-xl grid place-items-center border-2 border-[#0F1B2D] bg-[#EDE9FE] shrink-0" style={{ boxShadow: '0 2px 0 #0F1B2D' }}>
          <Sparkles size={16} className="text-[#6D28D9]" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-[#0F1B2D] leading-tight">AI study help</span>
          <span className="block text-[11px] text-[#4A5A6E]">A quick summary &amp; the key points to remember</span>
        </span>
        <ChevronDown size={18} className={`text-[#4A5A6E] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 -mt-1">
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-[#4A5A6E] py-3">
              <Loader2 size={15} className="animate-spin" /> Thinking…
            </div>
          )}

          {status === 'error' && (
            <div className="py-2">
              <p className="flex items-start gap-2 text-sm text-[#9F1239] mb-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
              </p>
              <button
                type="button"
                onClick={retry}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl border-2 border-[#0F1B2D] bg-white hover:-translate-y-px transition"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'ready' && data && (
            <div className="space-y-4">
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#6D28D9] mb-1.5">
                  <Sparkles size={12} /> Summary
                </h4>
                <p className="text-sm leading-relaxed text-[#262626]">{data.summary}</p>
              </div>
              {data.keyPoints?.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#A3422E] mb-1.5">
                    <ListChecks size={12} /> Key points
                  </h4>
                  <ul className="space-y-1.5">
                    {data.keyPoints.map((pt, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[#262626]">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#D97757] shrink-0" />
                        <span className="leading-relaxed">{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] text-[#9CA3AF] pt-1">AI-generated — double-check against the note.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default NoteInsights
