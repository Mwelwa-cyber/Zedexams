import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { paywall } from '../../utils/paywall'
import { ensureProFonts } from '../../utils/proFonts'

const UpgradeModal = lazy(() => import('./UpgradeModal'))

const SCENARIOS = {
  'feature-locked': {
    tag: '✦ Pro feature',
    title: (ctx) => `${ctx.feature || 'Assessments'} is a Pro feature`,
    sub: () => 'Upgrade to unlock weekly tests, mid-term & end-of-term papers — with a private marking scheme.',
    mascot: '🦅',
    primary: 'Upgrade to Pro · K79/mo',
    primaryAction: 'upgrade',
    compare: 'free-vs-pro',
  },
  'monthly-limit': {
    tag: '⏱ Limit reached',
    title: (ctx) => `You've used all your free ${ctx.feature || 'lesson plans'} this month`,
    sub: (ctx) => `Upgrade to keep planning — or wait ${ctx.resetDays || 9} days for the reset on the 1st.`,
    mascot: '🦊',
    primary: 'Upgrade to Pro · K79/mo',
    primaryAction: 'upgrade',
    secondary: 'Just one more · K5',
    secondaryAction: 'one-off',
    compare: 'free-vs-pro',
  },
  'daily-cap': {
    tag: '⏱ Daily cap',
    title: () => "You've hit today's generation cap",
    sub: () => 'Free is capped at 2 generations per day to keep things fair. Come back tomorrow, or upgrade for 10/day.',
    mascot: '🐢',
    primary: 'Upgrade to Pro · K79/mo',
    primaryAction: 'upgrade',
    compare: 'free-vs-pro',
  },
  'quiz-preview-limit': {
    tag: '🔒 Free preview ended',
    title: (ctx) => `You've previewed ${ctx.limit || 30} questions on ${ctx.paperTitle || 'this paper'}`,
    sub: () => 'Upgrade to keep going on this paper and unlock every past-paper quiz, the full library, daily exams, and Ask Zed AI study help.',
    mascot: '🐢',
    primary: 'Upgrade to Pro · K79/mo',
    primaryAction: 'upgrade',
    compare: 'free-vs-pro',
  },
  'coming-soon': {
    tag: '✨ Coming soon',
    title: (ctx) => `${ctx.feature || 'Schemes of Work'} is launching soon`,
    sub: () => "Be first in line. Upgrade to Pro and we'll unlock it the moment it ships — no extra charge.",
    mascot: '🦁',
    primary: 'Upgrade & get early access',
    primaryAction: 'upgrade',
    secondary: 'Just notify me',
    secondaryAction: 'notify',
    compare: 'free-vs-pro',
  },
}

const COMPARE = {
  'free-vs-pro': {
    left: {
      name: 'Free',
      priceLabel: "You're here",
      price: 'K0',
      feats: [
        { ok: true, text: '5 plans / 3 worksheets / month' },
        { ok: true, text: '2 generations per day' },
        { ok: false, text: 'No assessments or schemes' },
        { ok: false, text: 'HTML export only' },
      ],
    },
    right: {
      name: 'Pro',
      priceLabel: '/ month',
      price: 'K79',
      recommended: true,
      feats: [
        { ok: true, text: '40 plans + 25 worksheets + 25 notes' },
        { ok: true, text: '10 generations per day' },
        { ok: true, text: 'Assessments + schemes of work' },
        { ok: true, text: 'DOCX + PDF export' },
      ],
    },
  },
}

function CompareCol({ data, recommended }) {
  return (
    <div className={`pwh-col${recommended ? ' pwh-col-rec' : ''}`}>
      <div className="pwh-col-head">
        <span className="pwh-col-name">{data.name}</span>
        <span className="pwh-col-price">
          <strong>{data.price}</strong> {data.priceLabel}
        </span>
      </div>
      {data.feats.map((f, i) => (
        <div key={i} className={`pwh-col-feat${f.ok ? '' : ' pwh-col-feat-muted'}`}>{f.text}</div>
      ))}
    </div>
  )
}

export default function PaywallHost() {
  const [state, setState] = useState(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  // Reason of the scenario that triggered the upgrade modal — captured
  // before state is cleared so we can route to the correct portal copy
  // (learner Grade-7 pack vs teacher Pro).
  const [upgradeReason, setUpgradeReason] = useState(null)
  const lastFocusRef = useRef(null)
  const primaryBtnRef = useRef(null)

  useEffect(() => paywall.subscribe(setState), [])

  // Body scroll lock + focus management
  useEffect(() => {
    if (!state) return
    ensureProFonts()
    lastFocusRef.current = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => primaryBtnRef.current?.focus(), 100)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
      lastFocusRef.current?.focus?.()
    }
  }, [state])

  // Esc to close
  useEffect(() => {
    if (!state) return
    function onKey(e) {
      if (e.key === 'Escape') paywall.hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state])

  const scenario = state ? SCENARIOS[state.reason] : null
  const ctx = state?.ctx || {}

  function handlePrimary() {
    if (scenario?.primaryAction === 'upgrade') {
      setUpgradeReason(state?.reason || null)
      paywall.hide()
      setShowUpgrade(true)
    }
  }

  function handleSecondary() {
    const action = scenario?.secondaryAction
    if (action === 'one-off') {
      // K5 one-off credit purchase isn't wired yet — fall through to upgrade.
      setUpgradeReason(state?.reason || null)
      paywall.hide()
      setShowUpgrade(true)
    } else if (action === 'notify') {
      paywall.hide()
    }
  }

  return (
    <>
      <style>{styles}</style>
      {scenario && (
        <>
          <div
            className="pwh-backdrop"
            onClick={() => paywall.hide()}
            aria-hidden="true"
          />
          <div className="pwh-modal" role="dialog" aria-modal="true" aria-labelledby="pwh-title">
            <div className="pwh-hero">
              <button className="pwh-close" onClick={() => paywall.hide()} aria-label="Close">✕</button>
              <span className="pwh-tag">{scenario.tag}</span>
              <h2 className="pwh-title" id="pwh-title">{scenario.title(ctx)}</h2>
              <p className="pwh-sub">{scenario.sub(ctx)}</p>
              <div className="pwh-mascot" aria-hidden="true">{scenario.mascot}</div>
            </div>
            <div className="pwh-body">
              <div className="pwh-compare">
                {COMPARE[scenario.compare] && (
                  <>
                    <CompareCol data={COMPARE[scenario.compare].left} />
                    <CompareCol data={COMPARE[scenario.compare].right} recommended />
                  </>
                )}
              </div>
            </div>
            <div className="pwh-actions">
              <button ref={primaryBtnRef} className="pwh-btn pwh-btn-primary" onClick={handlePrimary}>
                {scenario.primary}
              </button>
              {scenario.secondary && (
                <button className="pwh-btn pwh-btn-secondary" onClick={handleSecondary}>
                  {scenario.secondary}
                </button>
              )}
              <button className="pwh-btn pwh-btn-ghost" onClick={() => paywall.hide()}>Maybe later</button>
            </div>
            <div className="pwh-foot">
              <span>Cancel anytime · No card needed for Free</span>
              <div className="pwh-trust">
                <span><span className="pwh-swatch pwh-swatch-momo" />MoMo</span>
                <span><span className="pwh-swatch pwh-swatch-airtel" />Airtel</span>
              </div>
            </div>
          </div>
        </>
      )}
      {showUpgrade && (
        <Suspense fallback={null}>
          {upgradeReason === 'quiz-preview-limit' ? (
            <UpgradeModal
              portal="learner"
              planIds={['grade7_monthly', 'grade7_termly']}
              defaultPlanId="grade7_monthly"
              onClose={() => { setShowUpgrade(false); setUpgradeReason(null) }}
            />
          ) : (
            <UpgradeModal
              portal="teacher"
              planIds={['pro_monthly', 'pro_yearly']}
              defaultPlanId="pro_monthly"
              onClose={() => { setShowUpgrade(false); setUpgradeReason(null) }}
            />
          )}
        </Suspense>
      )}
    </>
  )
}

const styles = `
@keyframes pwh-fade{from{opacity:0}to{opacity:1}}
@keyframes pwh-pop{from{opacity:0;transform:translate(-50%,-46%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.pwh-backdrop{position:fixed;inset:0;z-index:9998;background:rgba(10,40,40,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:pwh-fade .22s ease both}
.pwh-modal{
  --cream:#F4EFE3;--ink:#0F1B1B;--ink-2:#234141;--teal:#0E3838;--orange:#F36A2A;
  --line:#E2D8C0;--line-dark:rgba(255,255,255,.14);--muted:#6B7775;--muted-2:#9DB1AE;--green:#2F7D5F;
  position:fixed;z-index:9999;top:50%;left:50%;
  width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow-y:auto;
  background:#fff;border-radius:24px;box-shadow:0 30px 80px rgba(10,40,40,.45),0 1px 0 rgba(255,255,255,.6) inset;
  animation:pwh-pop .25s cubic-bezier(.2,.9,.3,1.2) both;
  font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:15px;line-height:1.5;color:var(--ink);
  -webkit-font-smoothing:antialiased;
}
.pwh-modal *{box-sizing:border-box}
.pwh-modal h2,.pwh-modal h3{font-family:'Fraunces',serif;font-weight:500;letter-spacing:-0.02em;line-height:1.1;margin:0}
.pwh-hero{background:var(--teal);color:#fff;padding:32px 32px 28px;position:relative;overflow:hidden;border-top-left-radius:24px;border-top-right-radius:24px}
.pwh-hero::after{content:"";position:absolute;right:-60px;top:-40px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle at 30% 30%, rgba(243,106,42,.22), transparent 60%);pointer-events:none}
.pwh-close{position:absolute;top:16px;right:16px;z-index:2;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#fff;cursor:pointer;font-size:16px;line-height:1;display:grid;place-items:center;transition:background .15s ease;font-family:inherit;padding:0}
.pwh-close:hover{background:rgba(255,255,255,.2)}
.pwh-tag{display:inline-flex;align-items:center;gap:6px;background:var(--orange);color:#fff;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;padding:5px 11px;border-radius:999px;margin-bottom:14px;position:relative;z-index:1}
.pwh-mascot{position:absolute;right:24px;bottom:18px;width:80px;height:80px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:42px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:1}
.pwh-title{font-size:26px;font-weight:600;max-width:360px;letter-spacing:-0.02em;position:relative;z-index:1;line-height:1.15}
.pwh-sub{font-size:14px;color:var(--muted-2);margin:8px 0 0;max-width:380px;position:relative;z-index:1}
.pwh-body{padding:24px 32px 8px}
.pwh-compare{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}
.pwh-col{border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:6px}
.pwh-col-rec{background:var(--ink);color:#fff;border-color:var(--ink);box-shadow:0 8px 20px rgba(15,27,27,.18);position:relative}
.pwh-col-rec::before{content:"Recommended";position:absolute;top:-9px;right:12px;background:var(--orange);color:#fff;font-size:9px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;padding:3px 8px;border-radius:999px}
.pwh-col-head{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:6px;border-bottom:1px dashed var(--line);margin-bottom:6px}
.pwh-col-rec .pwh-col-head{border-bottom-color:var(--line-dark)}
.pwh-col-name{font-family:'Fraunces',serif;font-size:18px;font-weight:600}
.pwh-col-price{font-size:13px;color:var(--muted)}
.pwh-col-rec .pwh-col-price{color:var(--muted-2)}
.pwh-col-price strong{font-family:'Fraunces',serif;font-size:20px;color:var(--ink);font-weight:600}
.pwh-col-rec .pwh-col-price strong{color:#fff}
.pwh-col-feat{font-size:12.5px;display:flex;gap:7px;line-height:1.4;color:var(--ink-2)}
.pwh-col-rec .pwh-col-feat{color:#D8E2E0}
.pwh-col-feat::before{content:"✓";color:var(--green);font-weight:700;flex-shrink:0}
.pwh-col-rec .pwh-col-feat::before{color:var(--orange)}
.pwh-col-feat-muted{color:var(--muted)}
.pwh-col-feat-muted::before{content:"–";color:var(--muted)}
.pwh-actions{padding:0 32px 24px;display:flex;flex-direction:column;gap:10px}
.pwh-btn{width:100%;padding:14px;border-radius:14px;font-family:inherit;font-weight:600;font-size:15px;border:1px solid transparent;cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.pwh-btn-primary{background:var(--orange);color:#fff;box-shadow:0 6px 18px rgba(243,106,42,.28)}
.pwh-btn-primary:hover{background:#E55E22;transform:translateY(-1px);box-shadow:0 10px 22px rgba(243,106,42,.34)}
.pwh-btn-secondary{background:#fff;color:var(--ink);border-color:var(--line)}
.pwh-btn-secondary:hover{border-color:var(--ink)}
.pwh-btn-ghost{background:transparent;color:var(--muted);font-size:13px;font-weight:500;padding:8px}
.pwh-btn-ghost:hover{color:var(--ink)}
.pwh-foot{padding:16px 32px 24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);flex-wrap:wrap;gap:10px}
.pwh-trust{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.pwh-trust span{display:inline-flex;align-items:center;gap:5px}
.pwh-swatch{display:inline-block;width:14px;height:10px;border-radius:2px}
.pwh-swatch-momo{background:#FFCC00}
.pwh-swatch-airtel{background:#E60012}
@media (max-width:520px){
  .pwh-hero{padding:28px 22px 24px}
  .pwh-body{padding:20px 22px 4px}
  .pwh-actions{padding:0 22px 20px}
  .pwh-foot{padding:14px 22px 20px}
  .pwh-compare{grid-template-columns:1fr}
  .pwh-mascot{width:64px;height:64px;font-size:32px;right:16px;bottom:14px}
  .pwh-title{font-size:22px;max-width:240px}
}
`
