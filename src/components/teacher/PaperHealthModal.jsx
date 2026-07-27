/**
 * PaperHealthModal — the single "paper health" gate the Assessment Studio
 * shows before a teacher saves or exports.
 *
 * It folds the three quality surfaces (blocking validation, advisory smart
 * warnings, and the live paper stats) into one panel, and offers the AI
 * quality check (Vex) as one more tap — so the teacher sees the whole picture
 * in one place instead of a checklist modal here, a banner there, and a
 * separate verify button. The verdict itself comes from computePaperHealth();
 * this component is presentation + actions only.
 *
 * Styled with the studio's own sv-* design system (warm paper, burgundy / sage
 * / gold accents) rather than generic Tailwind, so it matches the studio's
 * premium-paper finish.
 */

import { useEffect } from 'react'
import Icon from './studio/studioIcons'
import { HEALTH_STATUS, paperHealthHeadline } from '../../utils/paperHealth'

const STATUS_META = {
  [HEALTH_STATUS.READY]: { label: 'Ready', tone: 'ready', icon: 'checkCircle' },
  [HEALTH_STATUS.ATTENTION]: { label: 'Worth a look', tone: 'attention', icon: 'warn' },
  [HEALTH_STATUS.BLOCKED]: { label: 'Needs fixing', tone: 'blocked', icon: 'warn' },
}

function HealthStat({ icon, value, label }) {
  return (
    <div className="sv-health-stat">
      <Icon name={icon} size={15} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export default function PaperHealthModal({
  open,
  health,
  onClose,
  onVerify,
  primaryAction,
  title = 'Paper health',
}) {
  // Escape closes — standard dialog affordance, mounted only while open.
  useEffect(() => {
    if (!open) return undefined
    function handleKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open || !health) return null

  const meta = STATUS_META[health.status] || STATUS_META[HEALTH_STATUS.READY]
  const stats = health.stats || {}
  const { blockers = [], advisories = [], checks = [] } = health

  return (
    <div
      className="sv-scrim open sv-health-scrim"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="sv-health-modal" role="dialog" aria-modal="true" aria-label="Paper health">
        <header className="sv-health-head">
          <div className="sv-health-head-text">
            <span className={`sv-health-badge ${meta.tone}`}>
              <Icon name={meta.icon} size={13} /> {meta.label}
            </span>
            <h3 className="serif">{title}</h3>
            <p>{paperHealthHeadline(health)}</p>
          </div>
          <button type="button" className="sv-icon-btn" onClick={onClose} aria-label="Close paper health">
            <Icon name="remove" size={18} />
          </button>
        </header>

        <div className="sv-health-body">
          <div className="sv-health-stats">
            <HealthStat icon="questions" value={stats.questionCount ?? 0} label={`question${stats.questionCount === 1 ? '' : 's'}`} />
            <HealthStat icon="marks" value={stats.totalMarks ?? 0} label="marks" />
            {stats.sectionCount > 0 && (
              <HealthStat icon="sections" value={stats.sectionCount} label={`section${stats.sectionCount === 1 ? '' : 's'}`} />
            )}
            {stats.printPdfPages > 0 && (
              <HealthStat icon="pages" value={stats.printPdfPages} label={`Print/PDF page${stats.printPdfPages === 1 ? '' : 's'}`} />
            )}
            {stats.estimatedMinutes > 0 && (
              <HealthStat icon="time" value={`~${stats.estimatedMinutes}`} label="min" />
            )}
          </div>

          {blockers.length > 0 && (
            <section className="sv-health-group blocked">
              <h4><Icon name="warn" size={14} /> Fix before saving ({blockers.length})</h4>
              <ul>
                {blockers.map((b) => (
                  <li key={b.id}><span className="sv-health-dot" aria-hidden="true" />{b.label}</li>
                ))}
              </ul>
            </section>
          )}

          {advisories.length > 0 && (
            <section className="sv-health-group attention">
              <h4><Icon name="warn" size={14} /> Worth checking ({advisories.length})</h4>
              <ul>
                {advisories.map((a) => (
                  <li key={a.id}><span className="sv-health-dot" aria-hidden="true" />{a.label}</li>
                ))}
              </ul>
            </section>
          )}

          {checks.length > 0 && (
            <section className="sv-health-group checks">
              <h4>Checklist</h4>
              <ul>
                {checks.map((c) => (
                  <li key={c.id} className={c.ok ? 'ok' : 'missing'}>
                    <Icon name={c.ok ? 'check' : 'remove'} size={14} className="sv-health-check-ic" />
                    {c.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {blockers.length === 0 && advisories.length === 0 && (
            <div className="sv-health-allclear">
              <Icon name="checkCircle" size={18} />
              Everything checks out. This paper is ready to save and export.
            </div>
          )}
        </div>

        <footer className="sv-health-foot">
          {onVerify && (
            <button type="button" className="sv-btn sv-btn-gold sv-btn-sm" onClick={onVerify}>
              <Icon name="verify" size={15} /> Run AI quality check
            </button>
          )}
          <div className="sv-health-foot-right">
            <button type="button" className="sv-btn sv-btn-outline sv-btn-sm" onClick={onClose}>Close</button>
            {primaryAction && (
              <button
                type="button"
                className="sv-btn sv-btn-primary sv-btn-sm"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled || primaryAction.busy}
                title={primaryAction.title}
              >
                <Icon name={primaryAction.busy ? 'spinner' : (primaryAction.icon || 'save')} size={15} spin={primaryAction.busy} />
                {primaryAction.busy ? (primaryAction.busyLabel || 'Working…') : primaryAction.label}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
