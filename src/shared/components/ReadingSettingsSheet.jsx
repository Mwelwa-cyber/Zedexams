import { useEffect, useRef, useState } from 'react'
import {
  TEXT_SIZES,
  LINE_SPACING,
  QUIZ_THEMES,
  HIGHLIGHT_COLOURS,
  UNDERLINE_STYLES,
} from '../../utils/quizDisplayPrefs'
import ThemePreview from './ThemePreview'

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'text', label: 'Text Style' },
  { id: 'colours', label: 'Colours' },
  { id: 'layout', label: 'Layout' },
]

/* ── Small building blocks ─────────────────────────────────────────────── */

function SegRow({ legend, options, value, onChange }) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`min-h-[44px] rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function SwatchRow({ legend, options, value, onChange }) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              aria-label={opt.label}
              title={opt.label}
              className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                active ? 'border-orange-500 text-orange-700' : 'border-slate-300 text-slate-600 hover:border-slate-400'
              }`}
            >
              <span
                className="h-5 w-8 rounded-md border border-slate-300"
                style={{ background: opt.swatch || 'repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 4px,#cbd5e1 4px,#cbd5e1 8px)' }}
              />
              {opt.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-400" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

/* ── Sheet ─────────────────────────────────────────────────────────────── */

export default function ReadingSettingsSheet({ open, onClose, prefs, setPref, resetPrefs, saving = false }) {
  const [tab, setTab] = useState('appearance')
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Move focus into the dialog for keyboard + screen-reader users.
    const t = setTimeout(() => closeRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-settings-title"
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl motion-safe:animate-slide-up sm:max-h-[88vh] sm:rounded-3xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="reading-settings-title" className="text-lg font-black text-slate-900">
              Reading Settings
            </h2>
            <p className="text-sm text-slate-500">Choose how your quiz looks and feels.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close reading settings"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-slate-600 hover:bg-slate-100"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Tab nav */}
          <nav
            aria-label="Settings sections"
            className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2 md:w-44 md:flex-col md:border-b-0 md:border-r md:py-3"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  tab === t.id ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Body: controls + live preview */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[1fr_18rem]">
            <div>
              {tab === 'appearance' && (
                <>
                  <SwatchRow
                    legend="Highlight style"
                    options={HIGHLIGHT_COLOURS}
                    value={prefs.highlightColour}
                    onChange={(v) => setPref('highlightColour', v)}
                  />
                  <SegRow
                    legend="Underline style"
                    options={UNDERLINE_STYLES}
                    value={prefs.underlineStyle}
                    onChange={(v) => setPref('underlineStyle', v)}
                  />
                  <SegRow
                    legend="Font size"
                    options={TEXT_SIZES}
                    value={prefs.textSize}
                    onChange={(v) => setPref('textSize', v)}
                  />
                  <SegRow
                    legend="Theme"
                    options={QUIZ_THEMES}
                    value={prefs.theme}
                    onChange={(v) => setPref('theme', v)}
                  />
                </>
              )}

              {tab === 'text' && (
                <>
                  <SegRow
                    legend="Line spacing"
                    options={LINE_SPACING}
                    value={prefs.lineSpacing}
                    onChange={(v) => setPref('lineSpacing', v)}
                  />
                  <Toggle
                    label="Dyslexia-friendly font"
                    hint="Wider letters and spacing that are easier to read."
                    checked={prefs.dyslexiaFont}
                    onChange={(v) => setPref('dyslexiaFont', v)}
                  />
                  <Toggle
                    label="Larger answer letters"
                    hint="Bigger A / B / C / D circles."
                    checked={prefs.largerAnswerLetters}
                    onChange={(v) => setPref('largerAnswerLetters', v)}
                  />
                  <Toggle
                    label="Read aloud"
                    hint="Show a speaker button on questions, passages and answers."
                    checked={prefs.readAloud}
                    onChange={(v) => setPref('readAloud', v)}
                  />
                </>
              )}

              {tab === 'colours' && (
                <>
                  <SwatchRow
                    legend="Highlight colour"
                    options={HIGHLIGHT_COLOURS}
                    value={prefs.highlightColour}
                    onChange={(v) => setPref('highlightColour', v)}
                  />
                  <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                    Correct (green) and incorrect (red) answer colours are set by the
                    system so your results are always clear — they can’t be changed.
                  </p>
                </>
              )}

              {tab === 'layout' && (
                <>
                  <Toggle
                    label="Wider answer spacing"
                    hint="More space between answer options."
                    checked={prefs.widerAnswerSpacing}
                    onChange={(v) => setPref('widerAnswerSpacing', v)}
                  />
                  <Toggle
                    label="Reduce animations"
                    checked={prefs.reduceAnimations}
                    onChange={(v) => setPref('reduceAnimations', v)}
                  />
                  <Toggle
                    label="Keep passage open"
                    hint="Don’t collapse the reading passage automatically."
                    checked={prefs.keepPassageOpen}
                    onChange={(v) => setPref('keepPassageOpen', v)}
                  />
                  <Toggle
                    label="Show line numbers in passages"
                    checked={prefs.showPassageLineNumbers}
                    onChange={(v) => setPref('showPassageLineNumbers', v)}
                  />
                </>
              )}
            </div>

            {/* Live preview */}
            <div className="lg:sticky lg:top-0">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Preview</p>
              <ThemePreview prefs={prefs} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={resetPrefs}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            {saving ? <span className="text-xs text-slate-400">Saving…</span> : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-[0_2px_0_#a3422e] transition-transform active:translate-y-0.5"
            >
              Apply settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
