import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { PLANS, getActivePlan } from '../../utils/subscriptionConfig'
import { ensureProFonts } from '../../utils/proFonts'
import SeoHelmet from '../seo/SeoHelmet'

const CONFETTI_COLORS = ['#F36A2A', '#FBE4D5', '#F2C49B', '#FFFFFF', '#9DB1AE']

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(date) {
  const d = formatDate(date)
  const t = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${d} · ${t}`
}

function maskMomoNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length < 4) return '+260 9•• ••• ••••'
  const last3 = digits.slice(-3)
  const prefix = digits.startsWith('260') ? digits.slice(3, 4) : digits.slice(0, 1)
  return `+260 ${prefix}•• ••• ${last3}`
}

export default function WelcomeToPro() {
  const { userProfile } = useAuth()
  const confettiRef = useRef(null)

  useEffect(() => {
    const wrap = confettiRef.current
    if (!wrap) return
    wrap.replaceChildren()
    for (let i = 0; i < 24; i += 1) {
      const span = document.createElement('span')
      span.style.left = `${Math.random() * 100}%`
      span.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
      span.style.animationDuration = `${(2.4 + Math.random() * 2.4).toFixed(2)}s`
      span.style.animationDelay = `${(Math.random() * 1.6).toFixed(2)}s`
      span.style.transform = `rotate(${Math.random() * 360}deg)`
      wrap.appendChild(span)
    }
  }, [])

  useEffect(() => { ensureProFonts() }, [])

  // Fall back to the monthly plan template — `getActivePlan` returns the free
  // tier (priceZMW: 0) until refreshProfile lands the new subscription, which
  // would render a misleading "K0.00" receipt total on this celebration page.
  const activePlan = getActivePlan(userProfile)
  const plan = activePlan?.priceZMW ? activePlan : (PLANS.pro_monthly || PLANS.monthly)
  const today = useMemo(() => new Date(), [])
  const renew = useMemo(() => {
    const expiry = userProfile?.subscriptionExpiry
    if (expiry?.toDate) return expiry.toDate()
    if (expiry) {
      const parsed = new Date(expiry)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    const fallback = new Date(today)
    fallback.setDate(fallback.getDate() + (plan?.durationDays || 30))
    return fallback
  }, [userProfile?.subscriptionExpiry, today, plan])

  const txnId = userProfile?.lastPaymentId || userProfile?.momoTransactionId || 'MOMO-7HK3Q-9B82F'
  const momoNumber = maskMomoNumber(userProfile?.momoNumber || userProfile?.phoneNumber)
  const planLabel = plan?.name ? `Pro · ${plan.name.toLowerCase()}` : 'Pro · monthly'
  const planTotal = plan?.priceZMW != null ? `K${plan.priceZMW}.00` : 'K79.00'

  return (
    <>
      <SeoHelmet title="Welcome to Pro" noIndex />
      <style>{styles}</style>
      <div className="zwp-page">
        <div className="zwp-wrap">
          <div className="zwp-brand">
            <div className="zwp-logo">Z</div>
            <div className="zwp-brand-text">
              <strong>ZedExams</strong>
              <small>Lesson Plan Studio</small>
            </div>
          </div>

          <section className="zwp-hero">
            <div className="zwp-confetti" ref={confettiRef} aria-hidden="true" />
            <span className="zwp-pill">✦ Welcome to Pro</span>
            <h1>
              You're <em>in</em>.<br />Let's plan something good.
            </h1>
            <p className="zwp-lede">
              Payment received — your account has been upgraded. Every studio is unlocked, and your daily cap just jumped from 2 to 10.
            </p>
            <div className="zwp-mascot" aria-hidden="true">🦊</div>
          </section>

          <div className="zwp-section-tag"><span>What just unlocked</span></div>
          <h2 className="zwp-section-h">Five new doors are open.</h2>

          <div className="zwp-unlocks">
            <div className="zwp-unlock">
              <div className="zwp-unlock-icon" aria-hidden="true">🦊</div>
              <div className="zwp-unlock-text">
                <strong>Lesson plans · 40/month</strong>
                <span>Up from 5. Plus Premium model quality and DOCX export.</span>
                <span className="zwp-unlock-badge">+8×</span>
              </div>
            </div>
            <div className="zwp-unlock">
              <div className="zwp-unlock-icon" aria-hidden="true">🐢</div>
              <div className="zwp-unlock-text">
                <strong>Worksheets · 25/month</strong>
                <span>Print-ready practice with full marking keys.</span>
                <span className="zwp-unlock-badge">+8×</span>
              </div>
            </div>
            <div className="zwp-unlock">
              <div className="zwp-unlock-icon" aria-hidden="true">🦅</div>
              <div className="zwp-unlock-text">
                <strong>Assessments · unlocked</strong>
                <span>Weekly tests, mid-term &amp; end-of-term papers — teacher-private.</span>
                <span className="zwp-unlock-badge">New</span>
              </div>
            </div>
            <div className="zwp-unlock">
              <div className="zwp-unlock-icon" aria-hidden="true">🦁</div>
              <div className="zwp-unlock-text">
                <strong>Schemes of Work · 2/term</strong>
                <span>Plan your whole term in a single printable doc.</span>
                <span className="zwp-unlock-badge">New</span>
              </div>
            </div>
          </div>

          <div className="zwp-section-tag"><span>Receipt</span></div>
          <h2 className="zwp-section-h">For your records.</h2>

          <div className="zwp-receipt">
            <div className="zwp-receipt-head">
              <strong>ZedExams Pro · {plan?.name || 'Monthly'}</strong>
              <span>{formatDateTime(today)}</span>
            </div>
            <div className="zwp-receipt-row"><span>Plan</span><span>{planLabel}</span></div>
            <div className="zwp-receipt-row"><span>Paid via</span><span>MTN MoMo · {momoNumber}</span></div>
            <div className="zwp-receipt-row"><span>Transaction ID</span><code>{txnId}</code></div>
            <div className="zwp-receipt-row"><span className="zwp-muted">Next renewal</span><span className="zwp-muted">{formatDate(renew)}</span></div>
            <div className="zwp-receipt-row zwp-total"><span>Total</span><span>{planTotal}</span></div>
          </div>

          <div className="zwp-ctas">
            <Link to="/teacher/generate/lesson-plan" className="zwp-cta zwp-cta-primary">▶ Plan your first lesson</Link>
            <Link to="/teacher" className="zwp-cta zwp-cta-secondary">Back to dashboard</Link>
          </div>

          <p className="zwp-small-print">
            A receipt has been sent to your email.<br />
            Manage or cancel anytime in <Link to="/teacher">Billing</Link>.
          </p>
        </div>
      </div>
    </>
  )
}

const styles = `
.zwp-page{
  --cream:#F4EFE3;--cream-2:#EDE6D3;--ink:#0F1B1B;--ink-2:#234141;--teal:#0E3838;
  --orange:#F36A2A;--orange-soft:#FBE4D5;--line:#E2D8C0;--muted:#6B7775;--muted-2:#9DB1AE;
  --green:#2F7D5F;--good:#E6F1EA;
  background:
    radial-gradient(900px 500px at 90% -10%, rgba(243,106,42,.10), transparent 60%),
    radial-gradient(800px 600px at -10% 30%, rgba(14,56,56,.06), transparent 60%),
    var(--cream);
  color:var(--ink);
  font-family:'Bricolage Grotesque',system-ui,sans-serif;
  font-size:16px;line-height:1.55;
  -webkit-font-smoothing:antialiased;
  min-height:100vh;overflow-x:hidden;
}
.zwp-page *{box-sizing:border-box}
.zwp-page h1,.zwp-page h2,.zwp-page h3{font-family:'Fraunces',serif;font-weight:500;letter-spacing:-0.02em;line-height:1.1;margin:0}
.zwp-page a{color:inherit;text-decoration:none}
.zwp-wrap{max-width:760px;margin:0 auto;padding:24px}
.zwp-brand{display:flex;align-items:center;gap:12px;padding:8px 0 32px}
.zwp-logo{width:42px;height:42px;border-radius:50%;background:#fff;display:grid;place-items:center;border:1px solid var(--line);font-family:'Fraunces',serif;font-weight:700;color:var(--teal);font-size:20px}
.zwp-brand-text small{display:block;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-top:2px}
.zwp-brand-text strong{font-family:'Fraunces',serif;font-weight:600;font-size:18px}
.zwp-hero{background:var(--teal);color:#fff;border-radius:28px;padding:44px 40px 40px;position:relative;overflow:hidden;box-shadow:0 30px 80px rgba(10,40,40,.20)}
.zwp-hero::after{content:"";position:absolute;right:-100px;top:-100px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle at 30% 30%, rgba(243,106,42,.20), transparent 60%);pointer-events:none}
.zwp-pill{display:inline-flex;align-items:center;gap:6px;background:var(--orange);color:#fff;font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;padding:7px 14px;border-radius:999px;position:relative;z-index:2}
.zwp-hero h1{font-size:clamp(40px,7vw,60px);margin:18px 0 12px;max-width:520px;letter-spacing:-0.025em;position:relative;z-index:2}
.zwp-hero h1 em{font-style:italic;color:#F2C49B;font-weight:400}
.zwp-hero p.zwp-lede{font-size:16px;color:var(--muted-2);max-width:420px;position:relative;z-index:2}
.zwp-mascot{position:absolute;right:32px;bottom:32px;width:120px;height:120px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:64px;box-shadow:0 10px 30px rgba(0,0,0,.18);z-index:2;animation:zwp-bob 3s ease-in-out infinite}
@keyframes zwp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.zwp-confetti{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1}
.zwp-confetti span{position:absolute;width:8px;height:14px;border-radius:1px;animation:zwp-fall linear infinite;opacity:.85}
@keyframes zwp-fall{0%{transform:translateY(-40px) rotate(0deg);opacity:0}10%{opacity:.85}100%{transform:translateY(560px) rotate(720deg);opacity:0}}
.zwp-section-tag{display:flex;align-items:center;gap:10px;margin:48px 0 14px}
.zwp-section-tag::before{content:"";width:24px;height:2px;background:var(--orange)}
.zwp-section-tag span{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.zwp-section-h{font-size:32px;margin-bottom:24px;letter-spacing:-0.02em}
.zwp-unlocks{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:36px}
.zwp-unlock{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px;display:flex;gap:14px;align-items:flex-start;opacity:0;transform:translateY(8px);animation:zwp-rise .6s cubic-bezier(.2,.9,.3,1.2) forwards}
.zwp-unlock:nth-child(1){animation-delay:.2s}
.zwp-unlock:nth-child(2){animation-delay:.3s}
.zwp-unlock:nth-child(3){animation-delay:.4s}
.zwp-unlock:nth-child(4){animation-delay:.5s}
@keyframes zwp-rise{to{opacity:1;transform:translateY(0)}}
.zwp-unlock-icon{width:40px;height:40px;border-radius:10px;background:var(--cream-2);display:grid;place-items:center;font-size:20px;flex-shrink:0}
.zwp-unlock-text strong{font-family:'Fraunces',serif;font-size:17px;font-weight:600;display:block;margin-bottom:2px}
.zwp-unlock-text span{font-size:13px;color:var(--muted);line-height:1.45}
.zwp-unlock-badge{display:inline-block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;background:var(--good);color:var(--green);font-weight:700;padding:2px 7px;border-radius:6px;margin-top:6px}
.zwp-receipt{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 24px;margin-bottom:28px}
.zwp-receipt-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px dashed var(--line);padding-bottom:14px;margin-bottom:14px}
.zwp-receipt-head strong{font-family:'Fraunces',serif;font-size:17px;font-weight:600}
.zwp-receipt-head span{font-size:12px;color:var(--muted)}
.zwp-receipt-row{display:flex;justify-content:space-between;font-size:14px;padding:5px 0;color:var(--ink-2)}
.zwp-receipt-row.zwp-total{border-top:1px solid var(--line);margin-top:10px;padding-top:12px;font-weight:600;color:var(--ink);font-size:15px}
.zwp-receipt-row .zwp-muted{color:var(--muted)}
.zwp-receipt-row code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--cream);padding:2px 6px;border-radius:4px;color:var(--ink-2)}
.zwp-ctas{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px}
.zwp-cta{padding:16px;border-radius:14px;font-family:inherit;font-weight:600;font-size:15px;border:1px solid transparent;cursor:pointer;text-align:center;display:block;transition:all .15s ease}
.zwp-cta-primary{background:var(--orange);color:#fff;box-shadow:0 8px 22px rgba(243,106,42,.28)}
.zwp-cta-primary:hover{background:#E55E22;transform:translateY(-1px)}
.zwp-cta-secondary{background:#fff;border-color:var(--line);color:var(--ink)}
.zwp-cta-secondary:hover{border-color:var(--ink)}
.zwp-small-print{text-align:center;font-size:13px;color:var(--muted);padding:0 20px 40px}
.zwp-small-print a{color:var(--orange);font-weight:600}
@media (max-width:560px){
  .zwp-hero{padding:36px 24px 32px}
  .zwp-mascot{width:80px;height:80px;font-size:42px;right:18px;bottom:18px}
  .zwp-hero h1{font-size:36px}
  .zwp-unlocks{grid-template-columns:1fr}
  .zwp-ctas{grid-template-columns:1fr}
  .zwp-section-h{font-size:26px}
}
`
