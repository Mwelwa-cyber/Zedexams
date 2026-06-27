import { useState } from 'react'
import { FormatCard } from '../cards/FormatCard'

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCAL_LANGUAGES = new Set(['Bemba', 'Nyanja', 'Tonga', 'Lozi', 'Kaonde', 'Luvale'])

const DETAIL_OPTIONS = [
  { value: 'simplified', label: 'Simplified', description: 'Key points only, concise' },
  { value: 'standard',   label: 'Standard',   description: 'Balanced detail and clarity' },
  { value: 'detailed',   label: 'Detailed',   description: 'Comprehensive coverage' },
]

const WRITING_STYLE_OPTIONS = [
  { value: 'simple',       label: 'Simple' },
  { value: 'standard',     label: 'Standard' },
  { value: 'professional', label: 'Professional' },
]

const FORMAT_OPTIONS = [
  { formatId: 'modern',   label: 'Modern Clean',  previewSrc: '/studio/previews/modern-preview.png' },
  { formatId: 'classic',  label: 'Classic',        previewSrc: '/studio/previews/classic-preview.png' },
  { formatId: 'official', label: 'Official CBC',   previewSrc: '/studio/previews/official-preview.png' },
]

const ILLUSTRATION_OPTIONS = [
  { value: 'none',     label: 'None' },
  { value: 'automatic', label: 'Automatic' },
  { value: 'manual',   label: 'Add Manually' },
]

const ADVANCED_TOGGLES = [
  { field: 'compactMetadata',          label: 'Compact Metadata Layout' },
  { field: 'includeEnrolment',         label: 'Include Enrolment Row' },
  { field: 'includeAttendance',        label: 'Include Attendance Row' },
  { field: 'includeLessonEvaluation',  label: 'Include Lesson Evaluation' },
  { field: 'includeKeyVocabulary',     label: 'Include Key Vocabulary' },
  { field: 'autoIllustrations',        label: 'Auto-add AI Illustrations' },
  { field: 'localLanguage',            label: 'Write in Local Language' },
]

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
 *     detail: 'simplified' | 'standard' | 'detailed',
 *     writingStyle: 'simple' | 'standard' | 'professional',
 *     format: 'modern' | 'classic' | 'official',
 *     illustrations: 'none' | 'automatic' | 'manual',
 *     advanced: {
 *       compactMetadata: boolean,
 *       includeEnrolment: boolean,
 *       includeAttendance: boolean,
 *       includeLessonEvaluation: boolean,
 *       includeKeyVocabulary: boolean,
 *       autoIllustrations: boolean,
 *       localLanguage: boolean
 *     }
 *   }
 *   onUpdateFormat: (field: string, value: any) => void
 *   onUpdateAdvanced: (field: string, value: boolean) => void
 *   lessonMedium: string
 */
export function FormatOptionsForm({ formatOptions, onUpdateFormat, onUpdateAdvanced, lessonMedium }) {
  const [open, setOpen] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const localLanguageEnabled = LOCAL_LANGUAGES.has(lessonMedium)

  return (
    <div className="border-b border-[#e5ddd0]">
      {/* ── Section header ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          {/* Settings icon — no status dot for this section */}
          <span aria-hidden="true" className="text-[#a39d8e]">⚙</span>
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

      {/* ── Collapsible body ── */}
      {open && (
        <div className="px-4 pb-4 space-y-5">

          {/* 1. Lesson Plan Detail */}
          <div>
            <SubLabel>Lesson Plan Detail</SubLabel>
            <div className="space-y-2">
              {DETAIL_OPTIONS.map((opt) => {
                const selected = formatOptions.detail === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateFormat('detail', opt.value)}
                    aria-pressed={selected}
                    className={[
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-[#d9cfbe] bg-white hover:bg-[#f9f5ef]',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'block text-[12px] font-semibold',
                        selected ? 'text-blue-700' : 'text-[#3d3529]',
                      ].join(' ')}
                    >
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-[#7a6d5d] mt-0.5">
                      {opt.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Writing Style */}
          <div>
            <SubLabel>Writing Style</SubLabel>
            <div className="flex gap-2">
              {WRITING_STYLE_OPTIONS.map((opt) => {
                const selected = formatOptions.writingStyle === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateFormat('writingStyle', opt.value)}
                    aria-pressed={selected}
                    className={[
                      'flex-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
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
          </div>

          {/* 3. Lesson Plan Format */}
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
                />
              ))}
            </div>
          </div>

          {/* 4. Illustrations */}
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

          {/* 5. Advanced Options */}
          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between rounded-lg border border-[#d9cfbe] bg-white px-3 py-2 text-[11px] font-semibold text-[#3d3529] hover:bg-[#f9f5ef] transition-colors"
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
                {ADVANCED_TOGGLES.map(({ field, label }) => {
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
    </div>
  )
}
