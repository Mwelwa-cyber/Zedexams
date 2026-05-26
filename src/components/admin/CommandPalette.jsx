import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../ui/Icon'
import { Search, ChevronRight, X } from '../ui/icons'

// Flatten the grouped nav into a single searchable command list.
function buildCommands(sections) {
  const list = []
  for (const section of sections) {
    for (const item of section.items) {
      list.push({
        section: section.label,
        label: item.label,
        to: item.to,
        external: !!item.external,
        keywords: [section.label, item.label].join(' ').toLowerCase(),
      })
    }
  }
  return list
}

export default function CommandPalette({ open, onClose, sections }) {
  const [q, setQ] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  const commands = useMemo(() => buildCommands(sections), [sections])
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return commands.slice(0, 12)
    return commands.filter(c => c.keywords.includes(term)).slice(0, 30)
  }, [q, commands])

  useEffect(() => { setHighlight(0) }, [q, open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(filtered.length - 1, h + 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[highlight]
        if (!cmd) return
        if (cmd.external) {
          window.open(cmd.to, '_blank', 'noopener')
        } else {
          navigate(cmd.to)
        }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, highlight, navigate, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
      <div
        role="dialog"
        aria-label="Command palette"
        className="relative w-full max-w-xl theme-card border theme-border rounded-2xl shadow-elev-xl overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b theme-border">
          <Icon as={Search} size="sm" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search admin pages, users, content…"
            className="flex-1 bg-transparent outline-none text-sm font-bold theme-text"
          />
          <button onClick={onClose} aria-label="Close palette" className="theme-text-muted hover:theme-text">
            <Icon as={X} size="sm" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm theme-text-muted">No matches. Try a different search.</p>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.to}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => {
                  // External entries (Preview section) leave admin chrome
                  // — open in a new tab so the admin keeps their place.
                  if (cmd.external) {
                    window.open(cmd.to, '_blank', 'noopener')
                  } else {
                    navigate(cmd.to)
                  }
                  onClose()
                }}
                className={`w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm font-bold transition-colors ${
                  i === highlight ? 'theme-accent-bg theme-accent-text' : 'theme-text hover:theme-bg-subtle'
                }`}
              >
                <span className="text-[10px] uppercase tracking-wider opacity-70 w-20 shrink-0">{cmd.section}</span>
                <span className="flex-1 truncate">{cmd.label}</span>
                {cmd.external && <span className="text-[10px] theme-text-muted">↗</span>}
                <Icon as={ChevronRight} size="xs" />
              </button>
            ))
          )}
        </div>
        <div className="theme-border border-t px-4 py-2 text-[10px] theme-text-muted flex items-center justify-between">
          <span>↑/↓ navigate · Enter open · Esc close</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  )
}
