// src/features/notes/components/ReaderPrefsMenu.jsx
//
// The "Aa" reading-settings control shown above a note body. Lets a learner pick
// their text size, body typeface, and page background. State + persistence live
// in ../hooks/useReaderPrefs; this component is just the popover UI and renders
// for both study notes and rich-text notes.

import { useEffect, useRef, useState } from 'react'
import { SIZE_OPTIONS, FONT_OPTIONS, PAGE_OPTIONS } from '../hooks/useReaderPrefs'
import ReadingThemePicker from '../../../components/theme/ReadingThemePicker'

function GroupLabel({ children }) {
  return <div className="text-[11px] font-bold uppercase tracking-wide text-[#4A5A6E] mb-1.5">{children}</div>
}

export function ReaderPrefsMenu({ size, font, page, setSize, setFont, setPage }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on outside-click and on Escape so the popover behaves like a menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="mb-4 flex items-center justify-end gap-2">
      {/* The reading-theme picker sits in this same toolbar because it is the
          same kind of choice — how the page reads — and this is where a
          learner already comes to make it. It is intentionally OUTSIDE
          wrapRef so opening it dismisses this menu rather than leaving two
          popovers stacked. */}
      <ReadingThemePicker surface="reader" />
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label="Reading settings"
          className="notes-chip notes-chip-shadow inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-white text-[#0F1B2D] hover:-translate-y-px transition"
        >
          <span className="text-sm leading-none" aria-hidden>Aa</span> Reading
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-72 z-30 notes-card p-4 space-y-4 text-left">
            {/* Text size */}
            <div>
              <GroupLabel>Text size</GroupLabel>
              <div className="flex items-stretch gap-1">
                {SIZE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSize(opt.value)}
                    aria-pressed={size === opt.value}
                    title={opt.title}
                    className={`flex-1 rounded-lg border-2 border-[#0F1B2D] py-1.5 text-xs font-bold transition ${
                      size === opt.value ? 'bg-[#D97757] text-white' : 'bg-white text-[#0F1B2D] hover:bg-[#FFF3E9]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font */}
            <div>
              <GroupLabel>Font</GroupLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {FONT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFont(opt.value)}
                    aria-pressed={font === opt.value}
                    className={`${opt.className} rounded-lg border-2 border-[#0F1B2D] px-2 py-1.5 text-sm font-semibold transition ${
                      font === opt.value ? 'bg-[#D97757] text-white' : 'bg-white text-[#0F1B2D] hover:bg-[#FFF3E9]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Page */}
            <div>
              <GroupLabel>Page</GroupLabel>
              <div className="grid grid-cols-4 gap-1.5">
                {PAGE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPage(opt.value)}
                    aria-pressed={page === opt.value}
                    title={opt.label}
                    className="flex flex-col items-center gap-1"
                  >
                    <span
                      className={`block w-full h-9 rounded-lg border-2 transition ${
                        page === opt.value ? 'border-[#D97757] ring-2 ring-[#D97757]/40' : 'border-[#0F1B2D]'
                      }`}
                      style={
                        opt.swatch === 'lined'
                          ? {
                              backgroundColor: 'var(--zt-card)',
                              backgroundImage:
                                'repeating-linear-gradient(to bottom, transparent 0, transparent 7px, #C9D8EA 7px, #C9D8EA 8px)',
                            }
                          : { backgroundColor: opt.swatch }
                      }
                      aria-hidden
                    />
                    <span className="text-[10px] font-semibold text-[#4A5A6E]">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ReaderPrefsMenu
