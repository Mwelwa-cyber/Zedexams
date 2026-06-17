import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherUsage } from '../../hooks/useTeacherUsage'
import { paywall } from '../../utils/paywall'
import { ensureProFonts } from '../../utils/proFonts'
import { useEffect } from 'react'

const FEATURES = [
  { key: 'plans',       label: 'Lesson plans',    icon: '🦊' },
  { key: 'worksheets',  label: 'Worksheets',      icon: '🐢' },
  { key: 'notes',       label: 'Teacher notes',   icon: '🦉' },
  { key: 'assessments', label: 'Assessments',     icon: '🦅' },
  { key: 'schemes',     label: 'Schemes of work', icon: '🦁' },
  { key: 'sba',         label: 'SBA tasks',       icon: '🦓' },
]

const FEATURE_LABEL = {
  plans: 'lesson plans',
  worksheets: 'worksheets',
  notes: 'teacher notes',
  assessments: 'assessments',
  schemes: 'schemes of work',
  sba: 'SBA tasks',
}

function barClassFor(pct) {
  if (pct >= 100) return 'zum-bar zum-bar-full'
  if (pct >= 85) return 'zum-bar zum-bar-danger'
  if (pct >= 70) return 'zum-bar zum-bar-warn'
  return 'zum-bar'
}

function MeterRow({ feature, used, cap, plan, onUnlockClick }) {
  if (cap === 0) {
    return (
      <div className="zum-meter zum-meter-locked">
        <div className="zum-meter-label">
          <span className="zum-icon" aria-hidden="true">{feature.icon}</span>{feature.label}
        </div>
        <div className="zum-meter-count">
          Not on {plan === 'free' ? 'Free' : 'this plan'} ·{' '}
          <button type="button" className="zum-link" onClick={onUnlockClick}>unlock</button>
        </div>
      </div>
    )
  }

  const isUnlimited = plan === 'max'
  const pct = isUnlimited ? Math.min(50, Math.round((used / cap) * 100)) : Math.min(100, Math.round((used / cap) * 100))

  return (
    <div className="zum-meter">
      <div className="zum-meter-label">
        <span className="zum-icon" aria-hidden="true">{feature.icon}</span>{feature.label}
      </div>
      <div className="zum-meter-count">
        {isUnlimited ? <><strong>{used}</strong> used</> : <><strong>{used}</strong> of {cap}</>}
      </div>
      <div className={barClassFor(pct)}>
        <div className="zum-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function UsageMeter() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const { loading, data } = useTeacherUsage(currentUser?.uid)

  useEffect(() => { ensureProFonts() }, [])

  if (loading || !data) {
    return (
      <>
        <style>{styles}</style>
        <div className="zum-card zum-card-skeleton" aria-hidden="true" />
      </>
    )
  }

  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long' })
  const planChipClass = `zum-plan-chip zum-plan-${data.plan}`
  const upgradeLabel = data.plan === 'free' ? 'Go Pro →' : 'Upgrade →'
  const showUpgrade = data.plan !== 'max'

  const cappedFeature = FEATURES.find(
    (f) => data.caps[f.key] > 0 && data.used[f.key] >= data.caps[f.key]
  )

  function openPricing() {
    navigate('/pricing')
  }

  function openMonthlyLimit(featureKey) {
    paywall.show('monthly-limit', {
      feature: FEATURE_LABEL[featureKey],
      resetDays: data.resetDays,
    })
  }

  function openLockedFeature(featureKey) {
    paywall.show('feature-locked', {
      feature: FEATURE_LABEL[featureKey].replace(/^./, (c) => c.toUpperCase()),
    })
  }

  return (
    <>
      <style>{styles}</style>
      <div className="zum-card">
        <div className="zum-head">
          <div className="zum-head-left">
            <div>
              <div className="zum-head-title">Your monthly usage</div>
              <div className="zum-head-sub">{monthName} · resets in {data.resetDays} day{data.resetDays === 1 ? '' : 's'}</div>
            </div>
            <span className={planChipClass}>
              <span className="zum-dot" />{data.planLabel}
            </span>
          </div>
          {showUpgrade && (
            <button type="button" className="zum-upgrade-btn" onClick={openPricing}>
              {upgradeLabel}
            </button>
          )}
        </div>

        <div className="zum-reset-banner">
          <span>Counts reset on the <strong>1st of every month</strong>. Saved work stays forever.</span>
        </div>

        <div className="zum-meter-list">
          {FEATURES.map((f) => (
            <MeterRow
              key={f.key}
              feature={f}
              used={data.used[f.key] || 0}
              cap={data.caps[f.key] || 0}
              plan={data.plan}
              onUnlockClick={() => openLockedFeature(f.key)}
            />
          ))}
        </div>

        <div className="zum-daily">
          <span>
            Today: <strong>{data.today}</strong> of <strong>{data.daily}</strong> generations
          </span>
          <div className="zum-daily-bar">
            <div className="zum-daily-fill" style={{ width: `${data.daily > 0 ? Math.min(100, (data.today / data.daily) * 100) : 0}%` }} />
          </div>
        </div>

        {cappedFeature && (
          <div className="zum-limit-banner">
            <div className="zum-limit-msg">
              <strong>You've hit your {FEATURE_LABEL[cappedFeature.key]} limit for this month.</strong><br />
              Upgrade to keep working, or pay K5 for one extra now.
            </div>
            <button type="button" onClick={() => openMonthlyLimit(cappedFeature.key)}>
              Upgrade
            </button>
          </div>
        )}
      </div>
    </>
  )
}

const styles = `
.zum-card{
  --cream:#F4EFE3;--cream-2:#EDE6D3;--ink:#0F1B1B;--ink-2:#234141;--teal:#0E3838;
  --orange:#F36A2A;--orange-soft:#FBE4D5;--line:#E2D8C0;--muted:#6B7775;
  --green:#2F7D5F;--warn:#D08200;--danger:#C0392B;
  background:#fff;border:1px solid var(--line);border-radius:22px;padding:24px 26px;
  box-shadow:0 1px 0 rgba(15,27,27,.02), 0 8px 24px rgba(15,27,27,.04);
  margin-bottom:22px;
  font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:15px;line-height:1.5;color:var(--ink);
}
.zum-card *{box-sizing:border-box}
.zum-card-skeleton{min-height:240px;background:var(--cream-2);animation:zum-pulse 1.4s ease-in-out infinite}
@keyframes zum-pulse{0%,100%{opacity:.4}50%{opacity:.7}}
.zum-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}
.zum-head-left{display:flex;gap:14px;align-items:center}
.zum-head-title{font-family:'Fraunces',serif;font-size:20px;font-weight:600;color:var(--ink)}
.zum-head-sub{font-size:13px;color:var(--muted);margin-top:2px}
.zum-plan-chip{display:inline-flex;align-items:center;gap:7px;background:var(--cream-2);border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;color:var(--ink-2)}
.zum-plan-chip .zum-dot{width:6px;height:6px;border-radius:50%;background:var(--orange)}
.zum-plan-free .zum-dot{background:#9E9E9E}
.zum-plan-max .zum-dot{background:#1F4D8F}
.zum-upgrade-btn{font-size:13px;color:var(--orange);font-weight:600;white-space:nowrap;border:1px solid var(--orange-soft);background:var(--orange-soft);padding:7px 12px;border-radius:8px;cursor:pointer;transition:all .15s ease;font-family:inherit}
.zum-upgrade-btn:hover{background:var(--orange);color:#fff;border-color:var(--orange)}
.zum-reset-banner{display:flex;align-items:center;gap:10px;background:var(--cream-2);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--ink-2);margin-bottom:18px}
.zum-reset-banner::before{content:"⏱";font-size:14px}
.zum-reset-banner strong{font-weight:600}
.zum-meter-list{display:flex;flex-direction:column;gap:14px}
.zum-meter{display:grid;grid-template-columns:1fr auto;gap:6px 12px}
.zum-meter-locked{opacity:.55}
.zum-meter-label{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:500;color:var(--ink-2)}
.zum-meter-label .zum-icon{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font-size:15px;background:var(--cream-2)}
.zum-meter-count{font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:500;white-space:nowrap}
.zum-meter-count strong{color:var(--ink);font-weight:600}
.zum-link{background:none;border:none;color:var(--orange);font-weight:600;font-size:13px;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline}
.zum-link:hover{color:#E55E22}
.zum-bar{grid-column:1 / -1;height:8px;background:var(--cream-2);border-radius:999px;overflow:hidden;position:relative}
.zum-fill{height:100%;border-radius:999px;background:var(--green);transition:width .6s cubic-bezier(.4,0,.2,1)}
.zum-bar-warn .zum-fill{background:var(--warn)}
.zum-bar-danger .zum-fill{background:var(--danger)}
.zum-bar-full .zum-fill{background:var(--ink)}
.zum-daily{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:18px;border-top:1px dashed var(--line);font-size:13px;color:var(--ink-2)}
.zum-daily-bar{flex:1;height:6px;background:var(--cream-2);border-radius:999px;overflow:hidden;max-width:240px}
.zum-daily-fill{height:100%;background:var(--teal);border-radius:999px;transition:width .6s ease}
.zum-limit-banner{margin-top:18px;background:#FFF6EE;border:1px solid #FBD9C0;border-radius:14px;padding:14px 16px;display:flex;gap:14px;align-items:center;justify-content:space-between}
.zum-limit-msg{font-size:13px;color:var(--ink-2);line-height:1.5}
.zum-limit-msg strong{color:var(--ink);font-weight:600}
.zum-limit-banner button{background:var(--orange);color:#fff;border:none;border-radius:10px;padding:9px 14px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(243,106,42,.24)}
.zum-limit-banner button:hover{background:#E55E22}
@media (max-width:560px){
  .zum-head{flex-direction:column;align-items:flex-start}
  .zum-limit-banner{flex-direction:column;align-items:flex-start}
  .zum-daily{flex-direction:column;align-items:flex-start}
  .zum-daily-bar{max-width:100%;width:100%}
}
`
