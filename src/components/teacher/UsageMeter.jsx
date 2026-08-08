import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherUsage, TOOL_TO_FEATURE, FEATURE_LABELS } from '../../hooks/useTeacherUsage'
import { paywall } from '../../utils/paywall'
import { topup } from '../../utils/topup'
import { recoverMyPendingPayments } from '../../utils/lenco'
import { isNativePlatform } from '../../utils/runtime'
import { MAX_ONLY_TOOLS } from '../../utils/teacherPlans'
import { ensureProFonts } from '../../utils/proFonts'
import useStudioAvailability from '../../hooks/useStudioAvailability'
import { useEffect, useState } from 'react'

// One row per metered studio the teacher can reach. Keys map 1:1 to
// TOOL_TO_FEATURE in useTeacherUsage.js so each bar reads the right counter.
//
// "Can reach" is the operative word: a row deep-links into its studio, so a
// studio that is no longer offered must not have one. Rubrics is gone with its
// studio; Worksheets is filtered at render because its studio is behind a flag
// (`visibleFeatures` below). The COUNTERS are untouched either way — a
// teacher's historical worksheet usage still counts against the month.
const FEATURES = [
  { key: 'plans',        label: 'Lesson plans',    icon: '🦊' },
  { key: 'worksheets',   label: 'Worksheets',      icon: '🐢' },
  { key: 'flashcards',   label: 'Flashcards',      icon: '🦒' },
  { key: 'notes',        label: 'Teacher notes',   icon: '🦉' },
  { key: 'homework',     label: 'Homework',        icon: '🦝' },
  { key: 'assessments',  label: 'Test papers',     icon: '🦅' },
  { key: 'exams',        label: 'Exam papers',     icon: '🦬' },
  { key: 'schemes',      label: 'Schemes of work', icon: '🦁' },
  { key: 'sba',          label: 'SBA tasks',       icon: '🦓' },
]

// Feature key → the studio route where the credit is actually spent. Lets the
// "credit ready" banner deep-link straight to Generate instead of leaving a
// teacher on the dashboard wondering why paying "did nothing". Mirrors the
// dashboard tiles in TeacherDashboard.jsx.
const FEATURE_ROUTE = {
  plans: '/teacher/lesson-plans/new',
  worksheets: '/teacher/generate/worksheet',
  flashcards: '/teacher/generate/flashcards',
  notes: '/teacher/generate/notes',
  homework: '/teacher/generate/homework',
  // Tests and examinations are one merged Assessment Paper Studio now — both
  // feature keys deep-link into the same "Generate" entry point.
  assessments: '/teacher/assessment-papers/new',
  exams: '/teacher/assessment-papers/new',
  schemes: '/teacher/generate/scheme-of-work',
  sba: '/teacher/generate/sba',
}

// Feature keys whose studio is Max-only — hitting their cap routes to the
// "Upgrade to Max" paywall, not the generic Pro upsell. Derived from the
// canonical MAX_ONLY_TOOLS so it can't drift from the server gate.
const MAX_ONLY_FEATURE_KEYS = new Set(
  MAX_ONLY_TOOLS.map((tool) => TOOL_TO_FEATURE[tool]).filter(Boolean)
)

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
  const { isRouteAvailable } = useStudioAvailability()
  const visibleFeatures = FEATURES.filter((f) => isRouteAvailable(FEATURE_ROUTE[f.key]))
  // Android shell: hide the K25 Lenco one-off + mobile-money recovery link
  // (Play policy — in-app purchases go through Google Play Billing only).
  const native = isNativePlatform()
  const { loading, data } = useTeacherUsage(currentUser?.uid)
  const [recovering, setRecovering] = useState(false)
  const [recoverMsg, setRecoverMsg] = useState('')

  useEffect(() => { ensureProFonts() }, [])

  // "I already paid — restore my credit." Re-runs the server-side payment
  // reconciliation for THIS user on demand, so a paid-but-stuck top-up (closed
  // poll + delayed/dropped webhook) doesn't wait up to an hour for the cron
  // sweep. On success the credit lands via the profile snapshot and the banner
  // swaps itself to the "credit ready" state — no reload needed.
  async function handleRecover() {
    if (recovering) return
    setRecovering(true)
    setRecoverMsg('')
    try {
      const res = await recoverMyPendingPayments()
      if (Number(res?.recovered || 0) > 0) {
        setRecoverMsg('Payment found — your credit has been restored. 🎉')
      } else if (Number(res?.stillPending || 0) > 0) {
        setRecoverMsg("We can see a payment that hasn't completed yet. If you just paid, give it a minute and tap again.")
      } else {
        setRecoverMsg('No pending payment found on your account. If you were charged, contact support with your transaction reference.')
      }
    } catch {
      setRecoverMsg('Could not check just now — please try again in a moment.')
    } finally {
      setRecovering(false)
    }
  }

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

  const cappedFeature = visibleFeatures.find(
    (f) => data.caps[f.key] > 0 && data.used[f.key] >= data.caps[f.key]
  )

  function openPricing() {
    navigate('/pricing')
  }

  function openMonthlyLimit(featureKey) {
    // Max-only studios (test papers, exam papers) can't be unlocked by Pro —
    // their monthly-taster ceiling routes to the "Upgrade to Max" paywall.
    if (MAX_ONLY_FEATURE_KEYS.has(featureKey) && data.plan !== 'max') {
      paywall.show('max-feature', { feature: FEATURE_LABELS[featureKey] })
      return
    }
    paywall.show('monthly-limit', {
      feature: FEATURE_LABELS[featureKey],
      resetDays: data.resetDays,
    })
  }

  function openLockedFeature(featureKey) {
    paywall.show('feature-locked', {
      feature: FEATURE_LABELS[featureKey].replace(/^./, (c) => c.toUpperCase()),
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
          {visibleFeatures.map((f) => (
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

        {/* A purchased K25 top-up lands as users/{uid}.generationCredits and
            reaches this widget live via the profile snapshot. Acknowledge it
            here — otherwise the "Pay K25" banner below would persist unchanged
            after payment (used still ≥ cap), so a teacher who just paid sees no
            effect and reports "paid K25 but nothing happened". The credit is
            only spent inside a studio on the next Generate, so the copy points
            there. Shown whenever a credit is banked, capped or not. */}
        {data.credits > 0 && (
          <div className="zum-credit-banner">
            <span className="zum-credit-emoji" aria-hidden="true">🎟️</span>
            <div className="zum-credit-body">
              <div className="zum-limit-msg">
                <strong>You have {data.credits} extra generation{data.credits === 1 ? '' : 's'} ready.</strong><br />
                {cappedFeature
                  ? <>Open the {FEATURE_LABELS[cappedFeature.key]} studio and press <strong>Generate</strong> — your {native ? '' : 'K25 '}credit is applied automatically.</>
                  : <>Open any studio and press <strong>Generate</strong> — your {native ? '' : 'K25 '}credit is applied automatically, on any tool.</>}
              </div>
              {cappedFeature && FEATURE_ROUTE[cappedFeature.key] && (
                <button type="button" className="zum-credit-go"
                  onClick={() => navigate(FEATURE_ROUTE[cappedFeature.key])}>
                  Open {FEATURE_LABELS[cappedFeature.key]} →
                </button>
              )}
            </div>
          </div>
        )}

        {cappedFeature && data.credits === 0 && (
          <div className="zum-limit-banner">
            <div className="zum-limit-msg">
              <strong>You've hit your {FEATURE_LABELS[cappedFeature.key]} limit for this month.</strong><br />
              {native
                ? 'Upgrade to keep working.'
                : 'Upgrade to keep working, or pay K25 for one extra now.'}
            </div>
            <div className="zum-limit-actions">
              {/* Android: no K25 one-off — it's a Lenco mobile-money product.
                  Upgrades run through Google Play Billing instead. */}
              {!native && (
                <button type="button" className="zum-limit-pay"
                  onClick={() => topup.show({ feature: FEATURE_LABELS[cappedFeature.key] })}>
                  Pay K25
                </button>
              )}
              <button type="button" onClick={() => openMonthlyLimit(cappedFeature.key)}>
                Upgrade
              </button>
            </div>
            {!native && (
              <div className="zum-recover">
                <button type="button" className="zum-recover-link" onClick={handleRecover} disabled={recovering}>
                  {recovering ? 'Checking your payment…' : 'Already paid? Restore my credit'}
                </button>
                {recoverMsg && <p className="zum-recover-msg">{recoverMsg}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

const styles = `
.zum-card{
  --cream:#F4EFE3;--cream-2:#EDE6D3;--ink:#0F1B1B;--ink-2:#234141;--teal:#0E3838;
  --orange:#CF6B51;--orange-soft:#F5E5DE;--line:#E2D8C0;--muted:#6B7775;
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
.zum-link:hover{color:#C5613F}
.zum-bar{grid-column:1 / -1;height:8px;background:var(--cream-2);border-radius:999px;overflow:hidden;position:relative}
.zum-fill{height:100%;border-radius:999px;background:var(--green);transition:width .6s cubic-bezier(.4,0,.2,1)}
.zum-bar-warn .zum-fill{background:var(--warn)}
.zum-bar-danger .zum-fill{background:var(--danger)}
.zum-bar-full .zum-fill{background:var(--ink)}
.zum-daily{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:18px;border-top:1px dashed var(--line);font-size:13px;color:var(--ink-2)}
.zum-daily-bar{flex:1;height:6px;background:var(--cream-2);border-radius:999px;overflow:hidden;max-width:240px}
.zum-daily-fill{height:100%;background:var(--teal);border-radius:999px;transition:width .6s ease}
.zum-limit-banner{margin-top:18px;background:#FFF6EE;border:1px solid #F1D8CD;border-radius:14px;padding:14px 16px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between}
.zum-limit-msg{font-size:13px;color:var(--ink-2);line-height:1.5}
.zum-limit-msg strong{color:var(--ink);font-weight:600}
.zum-limit-actions{display:flex;gap:8px;align-items:center}
.zum-limit-banner button{background:var(--orange);color:#fff;border:none;border-radius:10px;padding:9px 14px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(207,107,81,.24)}
.zum-limit-banner button:hover{background:#C5613F}
.zum-limit-banner button.zum-limit-pay{background:#fff;color:var(--orange);border:1.5px solid var(--orange);box-shadow:none}
.zum-limit-banner button.zum-limit-pay:hover{background:var(--orange-soft);color:#C5613F}
.zum-recover{flex-basis:100%;margin-top:4px}
.zum-recover-link{background:none!important;border:none!important;box-shadow:none!important;color:var(--ink-2)!important;font-family:inherit;font-size:12px;font-weight:600;text-decoration:underline;cursor:pointer;padding:0!important}
.zum-recover-link:hover:not(:disabled){color:var(--orange)!important}
.zum-recover-link:disabled{opacity:.6;cursor:default}
.zum-recover-msg{margin:6px 0 0;font-size:12px;color:var(--ink-2)}
.zum-credit-banner{margin-top:18px;background:#EAF7EF;border:1px solid #BFE6CE;border-radius:14px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.zum-credit-banner .zum-credit-emoji{font-size:18px;line-height:1.4}
.zum-credit-body{display:flex;flex-direction:column;gap:10px;flex:1}
.zum-credit-banner .zum-limit-msg{color:var(--ink-2)}
.zum-credit-banner .zum-limit-msg strong{color:var(--green)}
.zum-credit-go{align-self:flex-start;background:var(--green);color:#fff;border:none;border-radius:10px;padding:9px 14px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(47,125,95,.22)}
.zum-credit-go:hover{background:#27664D}
@media (max-width:560px){
  .zum-head{flex-direction:column;align-items:flex-start}
  .zum-limit-banner{flex-direction:column;align-items:flex-start}
  .zum-daily{flex-direction:column;align-items:flex-start}
  .zum-daily-bar{max-width:100%;width:100%}
}
`
