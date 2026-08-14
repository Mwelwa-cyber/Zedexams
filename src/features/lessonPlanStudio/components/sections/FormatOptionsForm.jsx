import { useState } from 'react'
import { Settings, AlignLeft, FileText, Layers } from '../../../../shared/components/icons'
import { FormatCard } from '../cards/FormatCard'
import { FormatPreviewModal } from '../modals/FormatPreviewModal'
import {
  ENVIRONMENT_DISPLAYS,
  HEADER_STYLES,
  MARGIN_MAX_MM,
  MARGIN_MIN_MM,
  MARGIN_PRESETS,
  OPTIONAL_SECTIONS,
  OPTIONAL_SECTION_LABELS,
  PAGE_BUDGETS,
  PAGE_BUDGET_LABELS,
  WRITING_STYLE_LABELS,
  defaultSections,
  marginWarning,
} from '../../../../utils/lessonPlanFormat'

// Decorative icon per page-budget option (keyed by value).
const BUDGET_ICONS = {
  1: AlignLeft,
  2: FileText,
  none: Layers,
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCAL_LANGUAGES = new Set(['Bemba', 'Nyanja', 'Tonga', 'Lozi', 'Kaonde', 'Lunda', 'Luvale'])

// Languages of instruction. English is the default; the rest live behind the
// Advanced Options drawer so the form isn't cluttered for the common case.
const MEDIUM_OPTIONS = ['English', 'Bemba', 'Nyanja', 'Tonga', 'Lozi', 'Kaonde', 'Lunda', 'Luvale']

// §2.1 — Page Budget replaced Detail Level, which changed TONE and called it
// length. What a teacher actually cares about is how much paper the plan costs,
// so that is what the primary control asks.
const BUDGET_DESCRIPTIONS = {
  1: 'Tightest wording, optional sections off',
  2: 'Point form, all standard sections',
  none: 'Comprehensive notes, no page limit',
}

const WRITING_STYLE_OPTIONS = ['point', 'simple', 'standard', 'professional']

const MARGIN_OPTIONS = [
  { value: 'normal',  label: 'Normal',  mm: MARGIN_PRESETS.normal },
  { value: 'narrow',  label: 'Narrow',  mm: MARGIN_PRESETS.narrow },
  { value: 'minimum', label: 'Minimum', mm: MARGIN_PRESETS.minimum },
]

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact',     label: 'Compact' },
]

const ENVIRONMENT_OPTIONS = {
  simple: { label: 'Simple', hint: 'Prints one line: “Learning Environment: Classroom”' },
  detailed: { label: 'Detailed', hint: 'Prints the category and its description' },
}

const HEADER_STYLE_OPTIONS = {
  school: { label: 'School', hint: 'School name, then LESSON PLAN' },
  ministry: { label: 'Ministry + School', hint: 'MINISTRY OF EDUCATION above the school name' },
}

// Format preview thumbnails. These were previously <img src="/studio/previews/
// *.png"> pointing at PNG files that were never committed, so every card
// rendered a broken-image icon in production. They're now self-contained
// inline SVGs (data URIs) that depict each layout style — no external asset,
// so they can never 404. 3:4 aspect to match FormatCard's frame.
const svgUri = (body) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" width="120" height="160">${body}</svg>`,
  )}`

// Modern Clean — airy white card with a blue accent header and spaced lines.
const MODERN_PREVIEW = svgUri(
  `<rect width="120" height="160" rx="6" fill="#ffffff"/>` +
  `<rect x="0" y="0" width="120" height="22" rx="6" fill="#2563eb"/>` +
  `<rect x="10" y="8" width="64" height="6" rx="3" fill="#ffffff" opacity="0.95"/>` +
  `<rect x="10" y="34" width="80" height="5" rx="2.5" fill="#1f2937"/>` +
  `<rect x="10" y="48" width="100" height="3.5" rx="1.75" fill="#cbd5e1"/>` +
  `<rect x="10" y="58" width="92" height="3.5" rx="1.75" fill="#cbd5e1"/>` +
  `<rect x="10" y="68" width="98" height="3.5" rx="1.75" fill="#cbd5e1"/>` +
  `<rect x="10" y="84" width="44" height="5" rx="2.5" fill="#2563eb" opacity="0.7"/>` +
  `<rect x="10" y="98" width="100" height="3.5" rx="1.75" fill="#cbd5e1"/>` +
  `<rect x="10" y="108" width="86" height="3.5" rx="1.75" fill="#cbd5e1"/>` +
  `<rect x="10" y="124" width="44" height="5" rx="2.5" fill="#2563eb" opacity="0.7"/>` +
  `<rect x="10" y="138" width="100" height="3.5" rx="1.75" fill="#cbd5e1"/>` +
  `<rect x="10" y="148" width="74" height="3.5" rx="1.75" fill="#cbd5e1"/>`,
)

// Classic — bordered document with a ruled table grid.
const CLASSIC_PREVIEW = svgUri(
  `<rect width="120" height="160" fill="#ffffff"/>` +
  `<rect x="6" y="6" width="108" height="148" fill="none" stroke="#374151" stroke-width="1.5"/>` +
  `<rect x="30" y="14" width="60" height="5" rx="1" fill="#111827"/>` +
  `<rect x="14" y="26" width="92" height="4" rx="1" fill="#9ca3af"/>` +
  `<rect x="14" y="40" width="92" height="40" fill="none" stroke="#6b7280" stroke-width="1"/>` +
  `<line x1="14" y1="53" x2="106" y2="53" stroke="#6b7280" stroke-width="1"/>` +
  `<line x1="14" y1="66" x2="106" y2="66" stroke="#6b7280" stroke-width="1"/>` +
  `<line x1="44" y1="40" x2="44" y2="80" stroke="#6b7280" stroke-width="1"/>` +
  `<rect x="14" y="90" width="92" height="3.5" rx="1" fill="#9ca3af"/>` +
  `<rect x="14" y="100" width="80" height="3.5" rx="1" fill="#9ca3af"/>` +
  `<rect x="14" y="110" width="92" height="3.5" rx="1" fill="#9ca3af"/>` +
  `<rect x="14" y="120" width="70" height="3.5" rx="1" fill="#9ca3af"/>` +
  `<rect x="14" y="134" width="92" height="3.5" rx="1" fill="#9ca3af"/>`,
)

// Official CBC — formal centred title block over a table with a shaded header.
const OFFICIAL_PREVIEW = svgUri(
  `<rect width="120" height="160" fill="#ffffff"/>` +
  `<rect x="5" y="5" width="110" height="150" fill="none" stroke="#1f2937" stroke-width="1.5"/>` +
  `<rect x="34" y="12" width="52" height="4" rx="1" fill="#111827"/>` +
  `<rect x="42" y="20" width="36" height="3" rx="1" fill="#6b7280"/>` +
  `<rect x="12" y="32" width="96" height="96" fill="none" stroke="#1f2937" stroke-width="1"/>` +
  `<rect x="12" y="32" width="96" height="14" fill="#e5e7eb"/>` +
  `<line x1="12" y1="46" x2="108" y2="46" stroke="#1f2937" stroke-width="1"/>` +
  `<line x1="12" y1="64" x2="108" y2="64" stroke="#9ca3af" stroke-width="1"/>` +
  `<line x1="12" y1="82" x2="108" y2="82" stroke="#9ca3af" stroke-width="1"/>` +
  `<line x1="12" y1="100" x2="108" y2="100" stroke="#9ca3af" stroke-width="1"/>` +
  `<line x1="12" y1="118" x2="108" y2="118" stroke="#9ca3af" stroke-width="1"/>` +
  `<line x1="48" y1="32" x2="48" y2="128" stroke="#1f2937" stroke-width="1"/>` +
  `<rect x="14" y="137" width="64" height="3.5" rx="1" fill="#9ca3af"/>` +
  `<rect x="14" y="146" width="48" height="3.5" rx="1" fill="#9ca3af"/>`,
)

const FORMAT_OPTIONS = [
  { formatId: 'modern',   label: 'Modern Clean',  previewSrc: MODERN_PREVIEW },
  { formatId: 'classic',  label: 'Classic',        previewSrc: CLASSIC_PREVIEW },
  { formatId: 'official', label: 'Official CBC',   previewSrc: OFFICIAL_PREVIEW },
]

const ILLUSTRATION_OPTIONS = [
  { value: 'none',     label: 'None' },
  { value: 'automatic', label: 'Automatic' },
  { value: 'manual',   label: 'Add Manually' },
]

// Illustrations are temporarily hidden from the Lesson Plan Studio while the
// feature is being reworked. Flip this back to `true` to re-surface the
// Illustrations bar (section 4) and the "Auto-add AI Illustrations" advanced
// toggle. The underlying generation pipeline is left untouched — only the
// controls are hidden, and useStudioState defaults `illustrations` to 'none'
// so nothing fires while the bar is gone.
const SHOW_ILLUSTRATIONS = false

const ADVANCED_TOGGLES = [
  { field: 'compactMetadata',   label: 'Compact Metadata Layout' },
  { field: 'includeEnrolment',  label: 'Include Enrolment Row' },
  { field: 'includeAttendance', label: 'Include Attendance Row' },
  { field: 'autoIllustrations', label: 'Auto-add AI Illustrations' },
  { field: 'localLanguage',     label: 'Write in Local Language' },
]

// A small segmented control — the shape used for every either/or choice below.
function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="flex gap-2" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className={[
              'flex-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all',
              selected
                ? 'border-blue-500 lps-brand-gradient text-white shadow-sm'
                : 'border-[#d9cfbe] bg-white text-[#3d3529] hover:bg-[#f9f5ef]',
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Sub-section label ─────────────────────────────────────────────────────────

function SubLabel({ children }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-[#a39d8e] mb-2">
      {children}
    </p>
  )
}

// ── FormatOptionsForm ─────────────────────────────────────────────────────────

/**
 * FormatOptionsForm — collapsible sidebar section for lesson plan format and
 * style options.
 *
 * Props:
 *   formatOptions: {
 *     pageBudget: '1' | '2' | 'none',       // §2.1 — the primary control
 *     writingStyle: 'point' | 'simple' | 'standard' | 'professional',
 *     format: 'modern' | 'classic' | 'official',
 *     illustrations: 'none' | 'automatic' | 'manual',
 *     environmentDisplay: 'simple' | 'detailed',   // §2.3
 *     headerStyle: 'school' | 'ministry',          // §4.3
 *     ministryLine: string,
 *     marginMm: number,                            // §2.5 Paper Fit
 *     density: 'comfortable' | 'compact',
 *     sections: Record<string, boolean>,           // §2.4
 *     advanced: {
 *       compactMetadata: boolean,
 *       includeEnrolment: boolean,
 *       includeAttendance: boolean,
 *       autoIllustrations: boolean,
 *       localLanguage: boolean
 *     }
 *   }
 *   onUpdateFormat: (field: string, value: any) => void
 *   onUpdateAdvanced: (field: string, value: boolean) => void
 *   onUpdateMedium: (value: string) => void
 *   lessonMedium: string
 *   curriculumMode: 'cbc' | 'previous'
 *   embedded: boolean — wizard mode: body only, no collapsible section chrome
 */
export function FormatOptionsForm({ formatOptions, onUpdateFormat, onUpdateAdvanced, onUpdateSection, onUpdateMedium, lessonMedium, curriculumMode = 'cbc', embedded = false }) {
  const [open, setOpen] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [previewFormat, setPreviewFormat] = useState(null)

  const localLanguageEnabled = LOCAL_LANGUAGES.has(lessonMedium)

  const pageBudget = formatOptions.pageBudget ?? '2'
  const environmentDisplay = formatOptions.environmentDisplay ?? 'simple'
  const headerStyle = formatOptions.headerStyle ?? 'school'
  const density = formatOptions.density ?? 'compact'
  const marginMm = formatOptions.marginMm ?? MARGIN_PRESETS.normal
  const margin = marginWarning(marginMm)
  const sections = formatOptions.sections ?? defaultSections(pageBudget)

  // Changing the budget re-applies that budget's DEFAULTS for the things it
  // governs — margins, density and which optional sections are on. Leaving the
  // old values in place is how a teacher picks "1 page" and gets a plan that
  // still carries every section at 15 mm margins, i.e. two.
  function handleBudgetChange(value) {
    onUpdateFormat('pageBudget', value)
  }

  return (
    <div className={embedded ? '' : 'border-b border-[#e5ddd0]'}>
      {/* ── Section header (hidden in embedded wizard mode) ── */}
      {!embedded && (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          {/* Settings icon — no status dot for this section */}
          <Settings size={15} className="text-[#a99e8b]" aria-hidden="true" />
          Format &amp; Options
        </span>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'text-[#a39d8e] transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      )}

      {/* ── Collapsible body ── */}
      {(open || embedded) && (
        <div className={embedded ? 'space-y-5' : 'lps-section-enter px-4 pb-4 space-y-5'}>

          {/* 1. Page Budget (§2.1) — how much paper, not how much prose. */}
          <div>
            <SubLabel>Page Budget</SubLabel>
            <div className="space-y-2">
              {PAGE_BUDGETS.map((value) => {
                const opt = { value, label: PAGE_BUDGET_LABELS[value], description: BUDGET_DESCRIPTIONS[value] }
                const selected = pageBudget === opt.value
                const DetailIcon = BUDGET_ICONS[opt.value] ?? FileText
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleBudgetChange(opt.value)}
                    aria-pressed={selected}
                    className={[
                      'lps-lift flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                      selected
                        ? 'border-blue-500 bg-blue-50 lps-card-glow'
                        : 'border-[#e0d7c8] bg-white hover:border-[#cfc3ae] hover:bg-[#f9f5ef]',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg',
                        selected ? 'bg-blue-100 text-blue-600' : 'bg-[#f5efe1] text-[#a99e8b]',
                      ].join(' ')}
                      aria-hidden="true"
                    >
                      <DetailIcon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={[
                          'block text-[12px] font-semibold',
                          selected ? 'text-blue-700' : 'text-[#3d3529]',
                        ].join(' ')}
                      >
                        {opt.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[#7a6d5d]">
                        {opt.description}
                      </span>
                    </span>
                    {selected && (
                      <span
                        className="ml-auto grid h-5 w-5 flex-shrink-0 place-items-center self-center rounded-full bg-blue-600 text-white"
                        aria-hidden="true"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Writing Style (§2.2) — Point form is what a teacher's plan book
              actually contains, and it is the only style that changes LENGTH
              rather than tone. It is the default at any limited page budget. */}
          <div>
            <SubLabel>Writing Style</SubLabel>
            <div className="grid grid-cols-2 gap-2">
              {WRITING_STYLE_OPTIONS.map((value) => {
                const selected = formatOptions.writingStyle === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onUpdateFormat('writingStyle', value)}
                    aria-pressed={selected}
                    className={[
                      'rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all',
                      selected
                        ? 'border-blue-500 lps-brand-gradient text-white shadow-sm'
                        : 'border-[#d9cfbe] bg-white text-[#3d3529] hover:bg-[#f9f5ef]',
                    ].join(' ')}
                  >
                    {WRITING_STYLE_LABELS[value]}
                  </button>
                )
              })}
            </div>
            {formatOptions.writingStyle === 'point' && (
              <p className="mt-1.5 text-[11px] italic text-[#7a6d5d]">
                Sentence fragments, as teachers write in a plan book.
              </p>
            )}
          </div>

          {/* 3. Learning Environment display (§2.3) — CBC only; the OBC plan has
              no learning-environment section to display. */}
          {curriculumMode !== 'previous' && (
            <div>
              <SubLabel>Learning Environment</SubLabel>
              <Segmented
                ariaLabel="Learning environment display"
                options={ENVIRONMENT_DISPLAYS.map((v) => ({ value: v, label: ENVIRONMENT_OPTIONS[v].label }))}
                value={environmentDisplay}
                onChange={(v) => onUpdateFormat('environmentDisplay', v)}
              />
              <p className="mt-1.5 text-[11px] italic text-[#7a6d5d]">
                {ENVIRONMENT_OPTIONS[environmentDisplay].hint}
              </p>
            </div>
          )}

          {/* 4. Header style (§4.3) */}
          <div>
            <SubLabel>Header</SubLabel>
            <Segmented
              ariaLabel="Header style"
              options={HEADER_STYLES.map((v) => ({ value: v, label: HEADER_STYLE_OPTIONS[v].label }))}
              value={headerStyle}
              onChange={(v) => onUpdateFormat('headerStyle', v)}
            />
            <p className="mt-1.5 text-[11px] italic text-[#7a6d5d]">
              {HEADER_STYLE_OPTIONS[headerStyle].hint}
            </p>
            {headerStyle === 'ministry' && (
              <input
                type="text"
                value={formatOptions.ministryLine ?? ''}
                onChange={(e) => onUpdateFormat('ministryLine', e.target.value)}
                placeholder="Ministry of Education"
                aria-label="Ministry line"
                className="mt-2 w-full rounded-lg border border-[#d9cfbe] bg-white px-2.5 py-1.5 text-[12px] text-[#3d3529] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            )}
          </div>

          {/* 5. Paper Fit (§2.5) — margins and density, the two levers that
              change how much of the sheet the plan actually uses. */}
          <div>
            <SubLabel>Paper Fit</SubLabel>
            <Segmented
              ariaLabel="Margins"
              options={MARGIN_OPTIONS.map((o) => ({ value: String(o.mm), label: o.label }))}
              value={String(marginMm)}
              onChange={(v) => onUpdateFormat('marginMm', Number(v))}
            />
            <label className="mt-2 flex items-center gap-2 text-[11px] text-[#7a6d5d]">
              <span className="flex-shrink-0">Margin</span>
              <input
                type="range"
                min={MARGIN_MIN_MM}
                max={MARGIN_MAX_MM}
                step={1}
                value={marginMm}
                onChange={(e) => onUpdateFormat('marginMm', Number(e.target.value))}
                aria-label="Margin in millimetres"
                className="flex-1 accent-blue-600"
              />
              <span className="w-10 flex-shrink-0 text-right font-semibold text-[#3d3529]">{marginMm} mm</span>
            </label>
            {/* Never a block — teachers know their own printers. */}
            {margin.level !== 'none' && (
              <p
                data-testid="margin-safe-warning"
                className={[
                  'mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug',
                  margin.level === 'red' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900',
                ].join(' ')}
              >
                {margin.message}
              </p>
            )}
            <div className="mt-2">
              <Segmented
                ariaLabel="Density"
                options={DENSITY_OPTIONS}
                value={density}
                onChange={(v) => onUpdateFormat('density', v)}
              />
            </div>
          </div>

          {/* 6. Lesson Plan Format */}
          <div>
            <SubLabel>Lesson Plan Format</SubLabel>
            <div className="grid grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map((opt) => (
                <FormatCard
                  key={opt.formatId}
                  formatId={opt.formatId}
                  label={opt.label}
                  previewSrc={opt.previewSrc}
                  selected={formatOptions.format === opt.formatId}
                  onSelect={() => onUpdateFormat('format', opt.formatId)}
                  onPreview={() => setPreviewFormat(opt.formatId)}
                />
              ))}
            </div>
          </div>

          {/* 7. Illustrations — temporarily hidden (see SHOW_ILLUSTRATIONS) */}
          {SHOW_ILLUSTRATIONS && (
            <div>
              <SubLabel>Illustrations</SubLabel>
              <div className="flex gap-2">
                {ILLUSTRATION_OPTIONS.map((opt) => {
                  const selected = formatOptions.illustrations === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onUpdateFormat('illustrations', opt.value)}
                      aria-pressed={selected}
                      className={[
                        'flex-1 rounded-full border px-2 py-1.5 text-[11px] font-semibold transition-colors',
                        selected
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-[#d9cfbe] bg-white text-[#3d3529] hover:bg-[#f9f5ef]',
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              {formatOptions.illustrations === 'manual' && (
                <p className="mt-1.5 text-[11px] text-[#7a6d5d] italic">
                  Use the Add Diagram button in the preview
                </p>
              )}
            </div>
          )}

          {/* 8. Advanced Options */}
          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between rounded-xl border border-[#e0d7c8] bg-white px-3 py-2.5 text-[11px] font-semibold text-[#3d3529] hover:border-[#cfc3ae] hover:bg-[#f9f5ef] transition-colors"
            >
              <span>Advanced Options</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={[
                  'text-[#a39d8e] transition-transform',
                  advancedOpen ? 'rotate-180' : '',
                ].join(' ')}
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {advancedOpen && (
              <div className="mt-2 space-y-2">
                {/* Medium of instruction — defaults to English, surfaced here
                    so teachers only change it deliberately. */}
                <div className="rounded-lg border border-[#e5ddd0] px-3 py-2">
                  <label htmlFor="fof-medium" className="block text-[11px] font-semibold text-[#7a6d5d] mb-1">
                    Medium of Instruction
                  </label>
                  <select
                    id="fof-medium"
                    value={lessonMedium}
                    onChange={(e) => onUpdateMedium(e.target.value)}
                    className="w-full rounded-lg border border-[#d9cfbe] bg-white px-2.5 py-1.5 text-[13px] text-[#3d3529] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {MEDIUM_OPTIONS.map((lang) => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>

                {/* §2.4 — one checkbox per optional section, so the teacher
                    composes the plan they actually submit. */}
                <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-[#a39d8e]">
                  Sections to include
                </p>
                {OPTIONAL_SECTIONS.map((field) => {
                  const checked = sections[field] !== false
                  return (
                    <label
                      key={field}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-[#e5ddd0] px-3 py-2"
                    >
                      <span className="text-[12px] text-[#3d3529]">{OPTIONAL_SECTION_LABELS[field]}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onUpdateSection?.(field, !checked)}
                        className="h-4 w-4 rounded border-[#d9cfbe] text-blue-600 focus:ring-blue-400"
                      />
                    </label>
                  )
                })}

                <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-[#a39d8e]">
                  Layout
                </p>
                {ADVANCED_TOGGLES
                  .filter(({ field }) => SHOW_ILLUSTRATIONS || field !== 'autoIllustrations')
                  .map(({ field, label }) => {
                  const isLocalLanguage = field === 'localLanguage'
                  const disabled = isLocalLanguage && !localLanguageEnabled
                  const checked = Boolean(formatOptions.advanced[field])

                  return (
                    <label
                      key={field}
                      className={[
                        'flex items-center justify-between gap-2 rounded-lg border border-[#e5ddd0] px-3 py-2',
                        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                      ].join(' ')}
                    >
                      <span className="text-[12px] text-[#3d3529]">{label}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => onUpdateAdvanced(field, !checked)}
                        className="h-4 w-4 rounded border-[#d9cfbe] text-blue-600 focus:ring-blue-400"
                      />
                    </label>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Full sample preview of the chosen format — honours the live Advanced
          Options toggles so the teacher sees what they'll actually get. */}
      <FormatPreviewModal
        format={previewFormat}
        curriculumMode={curriculumMode}
        advanced={formatOptions.advanced}
        formatOptions={formatOptions}
        onClose={() => setPreviewFormat(null)}
      />
    </div>
  )
}
