import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DIAGRAM_CATALOG,
  getCategories,
  getDiagram,
  getDiagramsByCategory,
  renderDiagramSvg,
} from './diagramCatalog.js'

/**
 * Two-pane diagram picker modal.
 *
 *   gallery  → pick a shape from a category grid
 *   config   → edit each parameter; live SVG preview on the right
 *
 * Emits `onConfirm({ libraryKey, params })` when the teacher saves. The host
 * is responsible for clearing any conflicting image upload on that slot.
 *
 * `initial` re-opens the editor on an already-saved diagram (so the teacher
 * can tweak labels later). When provided we jump straight to the config pane
 * for that key.
 */
export default function DiagramPicker({ open, initial, onConfirm, onClose, accentColor }) {
  const categories = useMemo(() => ['All', ...getCategories()], [])
  const [activeCat, setActiveCat] = useState('All')
  const [activeKey, setActiveKey] = useState(null)
  const [draftParams, setDraftParams] = useState({})

  // Reset state every time the modal opens. If the teacher re-opens an
  // existing diagram (initial = {libraryKey, params}), jump to its config
  // view with the saved params pre-loaded.
  useEffect(() => {
    if (!open) return
    if (initial?.libraryKey && getDiagram(initial.libraryKey)) {
      const entry = getDiagram(initial.libraryKey)
      setActiveCat(entry.cat)
      setActiveKey(initial.libraryKey)
      setDraftParams({ ...entry.defaults, ...(initial.params || {}) })
    } else {
      setActiveCat('All')
      setActiveKey(null)
      setDraftParams({})
    }
  }, [open, initial])

  // Close on Escape — matches ConfirmDialog convention.
  useEffect(() => {
    if (!open) return
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const color = accentColor || (typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c2d12'
    : '#7c2d12')

  const visibleEntries = getDiagramsByCategory(activeCat)
  const activeEntry = activeKey ? DIAGRAM_CATALOG[activeKey] : null

  function pick(key) {
    const entry = DIAGRAM_CATALOG[key]
    if (!entry) return
    setActiveKey(key)
    setDraftParams({ ...entry.defaults })
  }

  function updateField(fieldKey, value) {
    setDraftParams(current => ({ ...current, [fieldKey]: value }))
  }

  function confirm() {
    if (!activeEntry) return
    onConfirm({ libraryKey: activeKey, params: { ...draftParams } })
  }

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a diagram"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-3 py-6"
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="theme-card theme-border flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border-2 shadow-xl">
        <div className="theme-border flex items-center justify-between gap-3 border-b-2 px-5 py-3">
          <div>
            <p className="theme-text text-sm font-black uppercase tracking-wide">Diagram library</p>
            <p className="theme-text-muted text-xs font-bold">
              {activeEntry ? `Editing ${activeEntry.name}` : 'Pick a shape, graph or organiser to drop in'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="theme-text-muted hover:theme-text min-h-0 rounded-lg bg-transparent px-2 py-1 text-lg shadow-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!activeEntry ? (
          <>
            <div className="theme-border flex flex-wrap gap-1.5 border-b px-5 py-3">
              {categories.map(cat => (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setActiveCat(cat)}
                  className={`min-h-0 rounded-full border px-3 py-1 text-xs font-black transition-colors ${
                    activeCat === cat
                      ? 'theme-accent-fill theme-on-accent border-transparent'
                      : 'theme-border theme-text bg-transparent hover:theme-bg-subtle'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {visibleEntries.map(entry => (
                  <button
                    type="button"
                    key={entry.key}
                    onClick={() => pick(entry.key)}
                    className="theme-card theme-border group min-h-0 rounded-xl border-2 p-3 text-left transition-all hover:-translate-y-px hover:border-[var(--accent)]"
                  >
                    <div
                      className="theme-bg-subtle mb-2 flex h-32 items-center justify-center overflow-hidden rounded-lg p-2"
                      dangerouslySetInnerHTML={{ __html: renderDiagramSvg(entry.key, entry.defaults, color) || '' }}
                    />
                    <p className="theme-text text-xs font-black">{entry.name}</p>
                    <p className="theme-text-muted text-[10px] font-bold">{entry.cat}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="theme-border border-b px-5 py-3">
              <button
                type="button"
                onClick={() => setActiveKey(null)}
                className="theme-text-muted hover:theme-text min-h-0 bg-transparent px-0 text-xs font-black uppercase tracking-wide shadow-none"
              >
                ← Back to gallery
              </button>
            </div>

            <div className="grid flex-1 gap-4 overflow-y-auto px-5 py-4 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="theme-text text-base font-black">{activeEntry.name}</h3>
                {activeEntry.fields.map(([fieldKey, label]) => (
                  <label key={fieldKey} className="block">
                    <span className="theme-text-muted mb-1 block text-xs font-black uppercase tracking-wide">{label}</span>
                    <input
                      type="text"
                      value={draftParams[fieldKey] ?? ''}
                      onChange={event => updateField(fieldKey, event.target.value)}
                      className="theme-input w-full rounded-lg border-2 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                <p className="theme-text-muted text-xs font-black uppercase tracking-wide">Preview</p>
                <div
                  className="theme-bg-subtle theme-border flex items-center justify-center overflow-hidden rounded-xl border-2 p-3"
                  dangerouslySetInnerHTML={{ __html: renderDiagramSvg(activeKey, draftParams, color) || '' }}
                />
              </div>
            </div>

            <div className="theme-border flex justify-end gap-2 border-t-2 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="theme-border theme-text min-h-0 rounded-lg border bg-transparent px-4 py-2 text-sm font-black shadow-none hover:theme-bg-subtle"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                className="theme-accent-fill theme-on-accent min-h-0 rounded-lg px-4 py-2 text-sm font-black hover:opacity-90"
              >
                Insert diagram
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
