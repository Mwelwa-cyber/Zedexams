/**
 * TeachingProfileMigrationCard — shown in the Teaching Profile empty state to an
 * EXISTING teacher (no profile yet) whose past work suggests which classes they
 * teach. It only SUGGESTS: the teacher ticks the ones to keep and confirms;
 * nothing is saved until they click "Add selected & continue", and no existing
 * document is touched. "Start from scratch" skips straight to the blank wizard.
 */

import { assignmentKey, gradeLabel, subjectLabel, curriculumTypeLabel } from '../../../../utils/teachingProfileCore'

export default function TeachingProfileMigrationCard({
  suggestions = [],
  selectedKeys,
  onToggle,
  onApply,
  onSkip,
  applying = false,
  error = '',
}) {
  if (!suggestions.length) return null
  const selectedCount = suggestions.filter((s) => selectedKeys.has(assignmentKey(s))).length

  return (
    <div className="tset-card" role="group" aria-label="Teaching assignments found from your existing work">
      <p className="tset-tp-empty__title">We found these possible teaching assignments from your recent work</p>
      <p className="tset-tp-empty__desc">
        Based on your recent lesson plans, schemes and other documents — not everything you teach. Tick the
        ones you teach; you can edit or add more in the next step. Nothing is saved until you continue.
      </p>

      <ul className="tset-tp-migrate__list" style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gap: 8 }}>
        {suggestions.map((s) => {
          const key = assignmentKey(s)
          const checked = selectedKeys.has(key)
          const bits = [gradeLabel(s.grade), subjectLabel(s.subject)]
          if (s.className) bits.push(s.className)
          return (
            <li key={key}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(key)} />
                <span>
                  <b>{bits.join(' · ')}</b>
                  <span style={{ opacity: 0.7 }}>
                    {' '}· {curriculumTypeLabel(s.curriculumType)}
                    {s.count ? ` · from ${s.count} document${s.count === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {error && <p className="tset-savebar__status tset-savebar__status--error" role="alert">{error}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="tset-btn" onClick={onApply} disabled={applying || selectedCount === 0}>
          {applying ? 'Adding…' : `Add ${selectedCount} & continue`}
        </button>
        <button type="button" className="tset-btn tset-btn--ghost" onClick={onSkip} disabled={applying}>
          Start from scratch
        </button>
      </div>
    </div>
  )
}
