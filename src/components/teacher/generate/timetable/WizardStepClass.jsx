/**
 * Wizard Step 1 · Class — how the week starts (generate / upload / blank),
 * then the class details and teaching days. Presentational: state and
 * handlers stay in ClassTimetableStudio.
 */

import { Grid3x3, Download, Plus } from 'lucide-react'
import { DAYS_OF_WEEK } from '../../../../utils/classTimetable'
import { CURRICULA } from '../../../../utils/curriculumFramework'
import { FieldWrapper } from '../studioFields'
import TimetableUploadPanel from '../TimetableUploadPanel'

const ENTRY_MODES = [
  {
    id: 'generate',
    title: 'Generate from curriculum',
    hint: 'Recommended — official subjects, weekly periods and double-period rules.',
    icon: Grid3x3,
  },
  {
    id: 'upload',
    title: 'Upload existing',
    hint: 'PDF · Word · Excel · photo',
    icon: Download,
  },
  {
    id: 'blank',
    title: 'Start blank',
    hint: 'Build the week yourself, cell by cell.',
    icon: Plus,
  },
]

export default function WizardStepClass({
  entryMode,
  onEntryModeChange,
  header,
  setH,
  curriculumId,
  requestSwitch,
  gradeStages,
  days,
  toggleDay,
  onUploadExtracted,
}) {
  return (
    <section className="studio-card space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="m-0 text-base font-black">How do you want to start?</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ENTRY_MODES.map((m) => {
            const on = entryMode === m.id
            const ModeIcon = m.icon
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onEntryModeChange(m.id)}
                aria-pressed={on}
                className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                  on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border bg-white'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-black">
                  <ModeIcon size={15} aria-hidden="true" />
                  {m.title}
                </div>
                <div className={`mt-0.5 text-[10px] ${on ? 'opacity-80' : 'theme-text-secondary'}`}>{m.hint}</div>
              </button>
            )
          })}
        </div>
      </div>

      {entryMode === 'upload' && (
        <TimetableUploadPanel grade={header.grade} days={days} onExtracted={onUploadExtracted} />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <FieldWrapper label="School">
          <input type="text" value={header.school} maxLength={120}
            onChange={(e) => setH('school', e.target.value)}
            placeholder="School name" className="studio-input" />
        </FieldWrapper>
        <FieldWrapper label="Curriculum">
          <select value={curriculumId} onChange={(e) => requestSwitch('curriculum', e.target.value)} className="studio-input">
            {CURRICULA.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FieldWrapper>
        <FieldWrapper label="Grade / Form">
          <select value={header.grade} onChange={(e) => requestSwitch('grade', e.target.value)} className="studio-input">
            <option value="">Select a grade…</option>
            {gradeStages.map((stage) => (
              <optgroup key={stage.id} label={stage.label}>
                {stage.grades.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </FieldWrapper>
        <FieldWrapper label="Class / stream (optional)">
          <input type="text" value={header.className} maxLength={40}
            onChange={(e) => setH('className', e.target.value)}
            placeholder="e.g. Grade 5 Blue" className="studio-input" />
        </FieldWrapper>
        <FieldWrapper label="Term (optional)">
          <select value={String(header.term)} onChange={(e) => setH('term', e.target.value)} className="studio-input">
            <option value="">No term</option>
            {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
          </select>
        </FieldWrapper>
        <FieldWrapper label="Year">
          <input type="text" value={header.year} maxLength={4}
            onChange={(e) => setH('year', e.target.value.replace(/[^\d]/g, ''))}
            className="studio-input" />
        </FieldWrapper>
        <FieldWrapper label="Class teacher">
          <input type="text" value={header.teacherName} maxLength={80}
            onChange={(e) => setH('teacherName', e.target.value)}
            placeholder="Mr / Mrs ..." className="studio-input" />
        </FieldWrapper>
        <FieldWrapper label="Prepared by (optional)">
          <input type="text" value={header.preparedBy} maxLength={80}
            onChange={(e) => setH('preparedBy', e.target.value)}
            className="studio-input" />
        </FieldWrapper>
        <FieldWrapper label="Approved by (optional)">
          <input type="text" value={header.approvedBy} maxLength={80}
            onChange={(e) => setH('approvedBy', e.target.value)}
            className="studio-input" />
        </FieldWrapper>
      </div>

      <FieldWrapper label="Teaching days">
        <div className="flex flex-wrap gap-2">
          {DAYS_OF_WEEK.map((day) => {
            const on = days.includes(day)
            return (
              <button key={day} type="button" onClick={() => toggleDay(day)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1.5 text-xs font-black transition-all ${
                  on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border theme-text-muted bg-white hover:theme-text'
                }`}>
                {day}
              </button>
            )
          })}
        </div>
      </FieldWrapper>
    </section>
  )
}
