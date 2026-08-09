/**
 * SchemePreviewCard — the smart "before you generate" summary for the Scheme
 * of Work studio. It shows the teacher exactly what will be generated and from
 * which sources, and surfaces the readiness messages (e.g. missing time
 * allocation) so Generate stays disabled until the plan is valid.
 *
 * Presentational only: the studio computes the values + runs
 * schemeReadiness.evaluate() and passes them in.
 */

import { curriculumLabel, templateLabel } from '../../../shared/utils/schemeFormat'

function Row({ label, value, missing }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b" style={{ borderColor: 'var(--zt-line)' }}>
      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>{label}</span>
      <span className="text-sm font-bold text-right" style={{ color: missing ? 'var(--warning-fg)' : 'var(--zt-text)' }}>
        {value || '—'}
      </span>
    </div>
  )
}

export default function SchemePreviewCard({
  curriculum,
  gradeLabel,
  subjectLabel,
  term,
  teachingWeeks,
  weeksSource,
  timePerWeek,
  periodsPerWeek,
  sources = [],
  readiness = { ready: true, messages: [] },
}) {
  const messages = Array.isArray(readiness.messages) ? readiness.messages : []
  return (
    <div className="rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-line)' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="studio-display" style={{ fontSize: 16, margin: 0 }}>Before you generate</h3>
        {/* zx-chip--purple/green carry a light wash + dark ink in the light
            themes and flip to a translucent wash + light ink on Night. */}
        <span
          className={`text-[11px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full ${curriculum === 'obc' ? 'zx-chip--purple' : 'zx-chip--green'}`}
        >
          {templateLabel(curriculum)}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        <Row label="Curriculum" value={curriculum ? `${curriculumLabel(curriculum)} — ${curriculum === 'obc' ? 'Outcome-Based' : 'Competency-Based'}` : ''} missing={!curriculum} />
        <Row label="Grade" value={gradeLabel} missing={!gradeLabel} />
        <Row label="Subject" value={subjectLabel} missing={!subjectLabel} />
        <Row label="Term" value={term ? `Term ${term}` : ''} missing={!term} />
        <Row
          label="Teaching weeks"
          value={teachingWeeks ? `${teachingWeeks} weeks${weeksSource ? ` · ${weeksSource}` : ''}` : ''}
          missing={!teachingWeeks}
        />
        <Row label="Time per week" value={timePerWeek} missing={!timePerWeek} />
        <Row label="Periods per week" value={periodsPerWeek} missing={!periodsPerWeek} />
        <Row label="Template" value={templateLabel(curriculum)} />
      </div>

      <div className="mt-3">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>Sources</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(sources.length ? sources : ['Syllabus Studio', 'Curriculum Framework', 'School Calendar']).map((s) => (
            <span key={s} className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--success-bg)', color: 'var(--success-fg)' }}>
              {s}
            </span>
          ))}
        </div>
      </div>

      {messages.length > 0 && (
        <div className="mt-4 space-y-2">
          {messages.map((m, i) => {
            const err = m.level === 'error'
            return (
              <div
                key={i}
                className="rounded-xl border px-3 py-2 text-sm flex items-start gap-2"
                style={err
                  ? { background: 'var(--warning-bg)', borderColor: 'var(--warning)', color: 'var(--warning-fg)' }
                  : { background: 'var(--info-bg)', borderColor: 'var(--info)', color: 'var(--info-fg)' }}
              >
                <span>{err ? '⚠️' : 'ℹ️'}</span>
                <span>{m.text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
