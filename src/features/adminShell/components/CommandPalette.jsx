import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../../../shared/components/Icon'
import { Search, ChevronRight, X } from '../../../shared/components/icons'
import { flattenAdminCommands } from '../lib/adminNav'
import { moveHighlight, searchAdminCommands } from '../lib/adminNavSearch'

/**
 * The admin ⌘K palette.
 *
 * Ranking and matching live in `adminNavSearch.js` (pure, node-tested); this
 * component owns the presentation, the keyboard wiring and the focus
 * contract. Three things it is responsible for that a search function cannot
 * be:
 *
 *   • Focus goes back where it came from on close. Without that, dismissing
 *     the palette with Esc drops focus onto <body> and the next Tab restarts
 *     from the top of the page — which for a keyboard user is worse than not
 *     having the shortcut.
 *   • The highlighted row is scrolled into view. The list holds every admin
 *     destination, so an empty-query ArrowUp lands on a row well below the
 *     fold; highlighting a row nobody can see reads as the keys being dead.
 *   • Actions are dispatched, not navigated. "Sign out" has no route, so it
 *     carries a `command` the shell resolves.
 */
export default function CommandPalette({ open, onClose, sections, badges = {}, onCommand }) {
  const [q, setQ] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  // The element that had focus when the palette opened, so Esc can hand it back.
  const restoreFocusRef = useRef(null)
  const navigate = useNavigate()

  const commands = useMemo(() => flattenAdminCommands(sections), [sections])
  const filtered = useMemo(() => searchAdminCommands(commands, q), [q, commands])

  useEffect(() => { setHighlight(0) }, [q, open])

  // Clear the query on close rather than on open: leaving it until the next
  // open means the stale results flash for a frame before the reset lands.
  useEffect(() => { if (!open) setQ('') }, [open])

  useEffect(() => {
    if (!open) return undefined
    restoreFocusRef.current = document.activeElement
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      clearTimeout(t)
      const target = restoreFocusRef.current
      restoreFocusRef.current = null
      // Only restore to something still in the document — the trigger may
      // have unmounted if the palette navigated away.
      if (target && typeof target.focus === 'function' && document.contains(target)) {
        target.focus()
      }
    }
  }, [open])

  const runCommand = useCallback((cmd) => {
    if (!cmd) return
    if (cmd.command) {
      onCommand?.(cmd.command)
    } else if (cmd.external) {
      // External entries leave admin chrome — a new tab keeps the admin's place.
      window.open(cmd.to, '_blank', 'noopener')
    } else {
      navigate(cmd.to)
    }
    onClose()
  }, [navigate, onClose, onCommand])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => moveHighlight(h, 1, filtered.length)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => moveHighlight(h, -1, filtered.length)) }
      else if (e.key === 'Enter') {
        // Enter belongs to whatever is focused. This listener is on window so
        // the arrows work from anywhere in the dialog, but a focused button
        // must be allowed to activate itself: preventDefault() here also
        // suppresses the button's click, so a keyboard user who tabbed to
        // Close got the highlighted command run instead — and if that command
        // was Sign out, reaching for Close signed them out.
        //
        // The option rows are buttons too, so Enter on a focused row activates
        // that row through its own onClick, which is the behaviour anyone
        // tabbing into the list expects.
        // Narrow on purpose: bail only for a DIFFERENT focused control. When
        // nothing interactive holds focus (the open animation, a click on the
        // dialog chrome), Enter still opens the highlighted row.
        const target = e.target
        const onOtherControl = target !== inputRef.current
          && typeof target?.closest === 'function'
          && target.closest('button, a, [role="option"]')
        if (onOtherControl) return
        e.preventDefault()
        runCommand(filtered[highlight])
      }
      // Home/End are deliberately NOT bound: the search field is a text input,
      // where those keys move the caret. The arrows wrap, so the last item is
      // one ArrowUp away regardless.
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, highlight, onClose, runCommand])

  // Keep the highlighted row visible as the arrows walk past the fold.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector('[data-highlighted="true"]')
    // Feature-detected: scrollIntoView is absent in jsdom and in some older
    // engines, and this is a nicety — it must never take the palette down.
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [highlight, open])

  if (!open) return null

  const activeId = filtered[highlight] ? `admin-cmd-${filtered[highlight].id}` : undefined

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
      <div
        role="dialog"
        aria-modal="true"
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
            placeholder="Search admin pages and actions…"
            aria-label="Search admin pages and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-command-list"
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck="false"
            className="flex-1 bg-transparent outline-none text-sm font-bold theme-text"
          />
          <button onClick={onClose} aria-label="Close palette" className="theme-text-muted hover:theme-text">
            <Icon as={X} size="sm" />
          </button>
        </div>
        <div ref={listRef} id="admin-command-list" role="listbox" aria-label="Admin destinations" className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm theme-text-muted">No matches. Try a different search.</p>
          ) : (
            filtered.map((cmd, i) => {
              const count = cmd.badgeKey ? badges[cmd.badgeKey] : 0
              const isActive = i === highlight
              return (
                <button
                  key={cmd.id}
                  id={`admin-cmd-${cmd.id}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-highlighted={isActive ? 'true' : 'false'}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => runCommand(cmd)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm font-bold transition-colors ${
                    isActive ? 'theme-accent-bg theme-accent-text' : 'theme-text hover:theme-bg-subtle'
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wider opacity-70 w-20 shrink-0 truncate">{cmd.section}</span>
                  <span className={`flex-1 truncate ${cmd.danger && !isActive ? 'text-danger' : ''}`}>{cmd.label}</span>
                  {/* Pending counts follow the destination into the palette —
                      an admin jumping to "Content queue" should see there are
                      twelve waiting without opening it first. */}
                  {count > 0 && (
                    <span
                      className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[10px] font-black"
                      style={{ background: '#D97757', color: '#fff', border: '2px solid #0F1B2D' }}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                  {cmd.external && <span className="text-[10px] theme-text-muted">↗</span>}
                  <Icon as={ChevronRight} size="xs" />
                </button>
              )
            })
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
