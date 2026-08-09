/**
 * TimetableLayoutPanel — the old "Timetable layout" section, now a small
 * drawer opened from the workspace overflow menu. Display preference only:
 * switching never moves a lesson, changes times or breaks a double period.
 *
 * On-screen and PRINT orientation are separate on purpose: the editor reads
 * best with days across the top, while both reference documents — and the
 * Ministry format a head of school signs — put days down the left on paper.
 */

import { TIMETABLE_LAYOUTS, PERIOD_LABEL_MODES } from '../../../../utils/classTimetable'
import { PRINT_TEMPLATES, CELL_TEXT_MODES } from '../../../../utils/timetablePrintTemplates'
import { FieldWrapper } from '../../../../components/teacher/generate/studioFields'

function LayoutChoice({ id, label, on, onSelect }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={on}
      className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border bg-white'}`}>
      <div className="text-xs font-black">{label}</div>
      {/* Tiny visual preview of the orientation */}
      <div className="mt-1.5 grid gap-0.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)', width: 90 }}>
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} style={{
            height: 5,
            borderRadius: 1,
            background: on ? 'rgba(255,255,255,0.7)' : '#c9c2ae',
            opacity: id === 'days-as-columns' ? (i % 5 === 0 ? 1 : 0.45) : (i < 5 ? 1 : 0.45),
          }} />
        ))}
      </div>
    </button>
  )
}

export default function TimetableLayoutPanel({ displayPreferences, setPref }) {
  const template = displayPreferences.printTemplate || 'modern'
  const government = template === 'government'
  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
        Presentation only — nothing here moves a lesson, changes a time or breaks a double period.
      </p>

      {/* ── The printed document ── */}
      <section className="space-y-2">
        <span className="studio-label !mb-0">Print &amp; export template</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          {PRINT_TEMPLATES.map((t) => {
            const on = template === t.id
            return (
              <button key={t.id} type="button" onClick={() => setPref('printTemplate', t.id)}
                aria-pressed={on}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border bg-white'}`}>
                <div className="text-xs font-black">{t.label}</div>
                <div className={`mt-0.5 text-[10px] ${on ? 'opacity-80' : 'theme-text-secondary'}`}>{t.description}</div>
              </button>
            )
          })}
        </div>

        {government ? (
          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" style={{ minWidth: 18, minHeight: 18 }}
                checked={displayPreferences.showMinistryHeader !== false}
                onChange={(e) => setPref('showMinistryHeader', e.target.checked)} />
              Print the MINISTRY OF EDUCATION header line
            </label>
            <label className="flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" style={{ minWidth: 18, minHeight: 18 }}
                checked={displayPreferences.spellBands !== false}
                onChange={(e) => setPref('spellBands', e.target.checked)} />
              Spell BREAK / LUNCH down the column
            </label>
            <p className="text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
              The Ministry format always prints days down the left, with no colour fills, signature lines and
              a clear space for the school stamp.
            </p>
          </div>
        ) : (
          <FieldWrapper label="Print orientation">
            <div className="flex flex-col gap-2 sm:flex-row">
              {TIMETABLE_LAYOUTS.map((l) => (
                <LayoutChoice key={l.id} id={l.id} label={l.label}
                  on={(displayPreferences.printLayout || 'days-as-rows') === l.id}
                  onSelect={() => setPref('printLayout', l.id)} />
              ))}
            </div>
          </FieldWrapper>
        )}

        <FieldWrapper label="Cell text">
          <div className="theme-border inline-flex overflow-hidden rounded-xl border text-xs font-black">
            {CELL_TEXT_MODES.map((m) => {
              const on = (displayPreferences.cellText || 'auto') === m.id
              return (
                <button key={m.id} type="button" onClick={() => setPref('cellText', m.id)}
                  aria-pressed={on} title={m.hint}
                  className={`px-3 py-2 transition-all ${on ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted bg-white hover:theme-text'}`}>
                  {m.label}
                </button>
              )
            })}
          </div>
        </FieldWrapper>
        <label className="flex items-center gap-2 text-xs font-bold">
          <input type="checkbox" style={{ minWidth: 18, minHeight: 18 }}
            checked={displayPreferences.showLegend !== false}
            onChange={(e) => setPref('showLegend', e.target.checked)} />
          Print the key when abbreviations are used
        </label>
      </section>

      {/* ── On screen ── */}
      <section className="theme-border space-y-2 border-t pt-3">
        <span className="studio-label !mb-0">On screen (preview &amp; library)</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          {TIMETABLE_LAYOUTS.map((l) => (
            <LayoutChoice key={l.id} id={l.id} label={l.label}
              on={displayPreferences.timetableLayout === l.id}
              onSelect={() => setPref('timetableLayout', l.id)} />
          ))}
        </div>
        <FieldWrapper label="Time &amp; period labels">
          <div className="theme-border inline-flex overflow-hidden rounded-xl border text-xs font-black">
            {PERIOD_LABEL_MODES.map((m) => {
              const on = displayPreferences.periodLabelMode === m.id
              return (
                <button key={m.id} type="button" onClick={() => setPref('periodLabelMode', m.id)}
                  aria-pressed={on}
                  className={`px-3 py-2 transition-all ${on ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted bg-white hover:theme-text'}`}>
                  {m.label}
                </button>
              )
            })}
          </div>
        </FieldWrapper>
      </section>
    </div>
  )
}
