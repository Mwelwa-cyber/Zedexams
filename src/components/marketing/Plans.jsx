import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ensureProFonts } from '../../utils/proFonts'
import SeoHelmet from '../seo/SeoHelmet'

const UpgradeModal = lazy(() => import('../subscription/UpgradeModal'))

const PLAN_PRICES = {
  free:  { monthly: 0,   annual: 0 },
  pro:   { monthly: 79,  annual: 65 },
  max:   { monthly: 199, annual: 165 },
}

const FAQ = [
  {
    q: 'What happens when I hit my monthly limit?',
    a: "Your plan keeps everything you've already made — nothing gets locked. You can either wait for the reset on the 1st of next month, upgrade for instant unlock, or pay K5 for one extra generation if you only need one more.",
  },
  {
    q: 'Can I pay with Mobile Money?',
    a: "Yes — MTN MoMo and Airtel Money are first-class. Subscriptions auto-renew via your wallet, and you'll get an SMS receipt every month. Cards work too.",
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Anytime. No phone calls, no forms. Cancel from your dashboard and you keep Pro access until the end of your billing period. After that you fall back to Free — your saved work stays.',
  },
  {
    q: 'Is there a school plan?',
    a: 'Yes — coming soon. School plans bundle 10+ teacher seats with HoD oversight, shared schemes of work, and one consolidated invoice. Email schools@zedexams.com to be the first in line.',
  },
  {
    q: 'Why daily limits — even on Max?',
    a: "Honestly? Each generation costs us real money in AI compute. Daily caps stop runaway scripts and shared accounts from breaking the maths for everyone else. Max's 30/day is well above what any single teacher will ever hit.",
  },
  {
    q: "What's the difference between Standard and Premium model?",
    a: 'Free uses a faster, lighter AI model — great for drafts. Pro and Max use our premium model, which writes longer, more curriculum-aligned content with better worked examples and richer assessments.',
  },
]

function Price({ planKey, billing }) {
  const value = PLAN_PRICES[planKey][billing]
  return (
    <div className="zpl-price-row">
      <span className="zpl-currency">K</span>
      <span className="zpl-price">{value}</span>
      <span className="zpl-per">/ month</span>
    </div>
  )
}

export default function Plans() {
  const { currentUser, isTeacher } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [billing, setBilling] = useState('monthly')
  const [showUpgrade, setShowUpgrade] = useState(null) // 'pro' | 'max' | null

  useEffect(() => { ensureProFonts() }, [])

  function handleFreeCta() {
    navigate(currentUser ? '/' : '/register')
  }

  function handlePaidCta(tier) {
    if (!currentUser) {
      navigate(`/register?intent=upgrade&tier=${tier}`)
      return
    }
    setShowUpgrade(tier)
  }

  const upgradePlanIds = showUpgrade
    ? [`${showUpgrade}_monthly`, `${showUpgrade}_yearly`]
    : []
  const upgradeDefaultId = showUpgrade
    ? `${showUpgrade}_${billing === 'annual' ? 'yearly' : 'monthly'}`
    : null

  return (
    <>
      <SeoHelmet
        title="Pricing — Free, Pro and Max plans"
        description="ZedExams Pro and Max plans for Zambian teachers and learners. Pay with MTN MoMo or Airtel Money. Cancel anytime."
        path={pathname === '/plans' ? '/plans' : '/pricing'}
      />
      <style>{styles}</style>
      <div className="zpl-page">
        <div className="zpl-wrap">
          <nav className="zpl-top">
            <Link to="/" className="zpl-brand">
              <div className="zpl-logo">Z</div>
              <div className="zpl-brand-text">
                <strong>ZedExams</strong>
                <small>Lesson Plan Studio</small>
              </div>
            </Link>
            <div className="zpl-nav-links">
              <Link to="/teacher">Studios</Link>
              <Link to="/teacher/library">Library</Link>
              <Link to="/pricing" className="zpl-nav-current">Plans</Link>
              {currentUser ? (
                <Link to={isTeacher ? '/teacher' : '/'} className="zpl-btn-ghost">Dashboard</Link>
              ) : (
                <Link to="/login" className="zpl-btn-ghost">Sign in</Link>
              )}
            </div>
          </nav>

          <section className="zpl-hero">
            <span className="zpl-pill">✦ Plans</span>
            <h1>
              Plans that grow<br />with your <em>classroom</em>.
            </h1>
            <p className="zpl-lede">
              Start free. Upgrade when your week gets busy. Cancel anytime — no card needed to begin, and we accept MTN MoMo, Airtel Money, and cards.
            </p>
          </section>

          <div className="zpl-toggle-row">
            <div className="zpl-toggle" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={billing === 'monthly'}
                className={billing === 'monthly' ? 'zpl-toggle-active' : ''}
                onClick={() => setBilling('monthly')}
              >Monthly</button>
              <button
                type="button"
                role="tab"
                aria-selected={billing === 'annual'}
                className={billing === 'annual' ? 'zpl-toggle-active' : ''}
                onClick={() => setBilling('annual')}
              >Annual <span className="zpl-save-tag">Save 17%</span></button>
            </div>
          </div>

          <section className="zpl-plans">
            <div className="zpl-plan">
              <div className="zpl-mascot" aria-hidden="true">🐢</div>
              <div className="zpl-plan-name">Free</div>
              <div className="zpl-meta">For trying things out</div>
              <Price planKey="free" billing={billing} />
              <div className="zpl-annual-note">No card required.</div>
              <button type="button" className="zpl-cta" onClick={handleFreeCta}>Start free</button>
              <div className="zpl-feats">
                <Feat><strong>5</strong> lesson plans / month</Feat>
                <Feat><strong>3</strong> worksheets / month</Feat>
                <Feat><strong>3</strong> teacher notes / month</Feat>
                <Feat>Daily cap of <strong>2</strong> generations</Feat>
                <Feat>HTML export only</Feat>
                <Feat>Library kept for 7 days</Feat>
                <Feat>Full syllabi access</Feat>
              </div>
            </div>

            <div className="zpl-plan zpl-plan-popular">
              <span className="zpl-badge-pop">Most popular</span>
              <div className="zpl-mascot" aria-hidden="true">🦊</div>
              <div className="zpl-plan-name">Pro</div>
              <div className="zpl-meta">For the everyday teacher</div>
              <Price planKey="pro" billing={billing} />
              <div className="zpl-annual-note">Or K790 / year — two months free.</div>
              <button type="button" className="zpl-cta zpl-cta-primary" onClick={() => handlePaidCta('pro')}>Go Pro</button>
              <div className="zpl-feats">
                <Feat><strong>40</strong> lesson plans / month</Feat>
                <Feat><strong>25</strong> worksheets &amp; teacher notes</Feat>
                <Feat><strong>8</strong> assessments / month</Feat>
                <Feat><strong>2</strong> schemes of work / term</Feat>
                <Feat>Daily cap of <strong>10</strong> generations</Feat>
                <Feat>DOCX + PDF export</Feat>
                <Feat>Library kept forever</Feat>
                <Feat>Premium model quality</Feat>
              </div>
            </div>

            <div className="zpl-plan">
              <div className="zpl-mascot" aria-hidden="true">🦅</div>
              <div className="zpl-plan-name">Max</div>
              <div className="zpl-meta">For HoDs &amp; heavy users</div>
              <Price planKey="max" billing={billing} />
              <div className="zpl-annual-note">Or K1,990 / year — two months free.</div>
              <button type="button" className="zpl-cta" onClick={() => handlePaidCta('max')}>Go Max</button>
              <div className="zpl-feats">
                <Feat><strong>Unlimited</strong> plans, notes &amp; worksheets*</Feat>
                <Feat><strong>Unlimited</strong> assessments &amp; schemes</Feat>
                <Feat>Daily cap of <strong>30</strong> generations</Feat>
                <Feat>Bulk export (whole term in one click)</Feat>
                <Feat>Priority queue when servers are busy</Feat>
                <Feat>Early access to new studios</Feat>
                <Feat>Email support, 24h reply</Feat>
                <Feat><em>*Fair use ~200/month</em></Feat>
              </div>
            </div>
          </section>

          <section className="zpl-compare">
            <div className="zpl-section-tag"><span>Compare</span></div>
            <h2 className="zpl-section-h">Every feature, side by side.</h2>
            <div className="zpl-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Free</th>
                    <th className="zpl-th-popular">Pro</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="zpl-divider"><td colSpan={4}>Generations / month</td></tr>
                  <Row label="Lesson plans" cells={['5', '40', 'Unlimited']} />
                  <Row label="Worksheets" cells={['3', '25', 'Unlimited']} />
                  <Row label="Teacher notes" cells={['3', '25', 'Unlimited']} />
                  <Row label="Assessments" cells={[null, '8', 'Unlimited']} />
                  <Row label="Schemes of work" cells={[null, '2 / term', 'Unlimited']} />

                  <tr className="zpl-divider"><td colSpan={4}>Limits &amp; quality</td></tr>
                  <Row label="Daily generation cap" cells={['2', '10', '30']} />
                  <Row label="Model quality" cells={['Standard', 'Premium', 'Premium']} />
                  <Row label="Priority queue" cells={[null, null, true]} />

                  <tr className="zpl-divider"><td colSpan={4}>Export &amp; library</td></tr>
                  <Row label="HTML export" cells={[true, true, true]} />
                  <Row label="DOCX + PDF export" cells={[null, true, true]} />
                  <Row label="Bulk export" cells={[null, null, true]} />
                  <Row label="Library retention" cells={['7 days', 'Forever', 'Forever']} />

                  <tr className="zpl-divider"><td colSpan={4}>Support</td></tr>
                  <Row label="Help centre" cells={[true, true, true]} />
                  <Row label="Email support" cells={[null, '48h', '24h']} />
                  <Row label="Early access to new studios" cells={[null, null, true]} />
                </tbody>
              </table>
            </div>
          </section>

          <div className="zpl-pay-row">
            <span>We accept</span>
            <span className="zpl-pay-chip zpl-pay-momo"><span className="zpl-swatch" />MTN MoMo</span>
            <span className="zpl-pay-chip zpl-pay-airtel"><span className="zpl-swatch" />Airtel Money</span>
            <span className="zpl-pay-chip zpl-pay-visa"><span className="zpl-swatch" />Visa</span>
            <span className="zpl-pay-chip zpl-pay-mc"><span className="zpl-swatch" />Mastercard</span>
          </div>

          <section>
            <div className="zpl-section-tag"><span>FAQ</span></div>
            <h2 className="zpl-section-h">The honest answers.</h2>
            <div className="zpl-faq">
              {FAQ.map((item) => (
                <details key={item.q} className="zpl-q">
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="zpl-footer-cta">
            <h3>Still on the fence?</h3>
            <p>Free forever, no card needed. You can plan your first lesson in under a minute.</p>
            <button type="button" className="zpl-btn-primary" onClick={handleFreeCta}>▶ Start with Free</button>
          </section>

          <footer className="zpl-site">
            <span>© 2026 ZedExams · Made in Lusaka 🇿🇲</span>
            <span>
              <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
            </span>
          </footer>
        </div>
      </div>
      {showUpgrade && (
        <Suspense fallback={null}>
          <UpgradeModal
            portal="teacher"
            planIds={upgradePlanIds}
            defaultPlanId={upgradeDefaultId}
            onClose={() => setShowUpgrade(null)}
          />
        </Suspense>
      )}
    </>
  )
}

function Feat({ children }) {
  return (
    <div className="zpl-feat">
      <span className="zpl-feat-dot">✓</span>
      <span>{children}</span>
    </div>
  )
}

function Row({ label, cells }) {
  return (
    <tr>
      <td>{label}</td>
      {cells.map((cell, i) => (
        <td key={i} className="zpl-td-center">
          {cell === true ? <span className="zpl-check">✓</span>
           : cell === null ? <span className="zpl-no">—</span>
           : cell}
        </td>
      ))}
    </tr>
  )
}

const styles = `
.zpl-page{
  --cream:#F4EFE3;--cream-2:#EDE6D3;--ink:#0F1B1B;--ink-2:#234141;--teal:#0E3838;--teal-2:#0A2828;
  --orange:#F36A2A;--orange-soft:#FBE4D5;--line:#E2D8C0;--muted:#6B7775;--green:#2F7D5F;--good:#E6F1EA;
  background:
    radial-gradient(900px 500px at 90% -10%, rgba(243,106,42,.08), transparent 60%),
    radial-gradient(800px 600px at -10% 30%, rgba(14,56,56,.06), transparent 60%),
    var(--cream);
  color:var(--ink);
  font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:16px;line-height:1.55;
  -webkit-font-smoothing:antialiased;min-height:100vh;
}
.zpl-page *{box-sizing:border-box}
.zpl-page h1,.zpl-page h2,.zpl-page h3,.zpl-page h4{font-family:'Fraunces',serif;font-weight:500;letter-spacing:-0.02em;line-height:1.05;margin:0}
.zpl-page a{color:inherit;text-decoration:none}
.zpl-wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.zpl-top{display:flex;align-items:center;justify-content:space-between;padding:22px 0}
.zpl-brand{display:flex;align-items:center;gap:12px}
.zpl-logo{width:42px;height:42px;border-radius:50%;background:#fff;display:grid;place-items:center;border:1px solid var(--line);font-family:'Fraunces',serif;font-weight:700;color:var(--teal);font-size:20px;box-shadow:0 1px 0 rgba(15,27,27,.04)}
.zpl-brand-text small{display:block;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-top:2px}
.zpl-brand-text strong{font-family:'Fraunces',serif;font-weight:600;font-size:18px}
.zpl-nav-links{display:flex;gap:28px;align-items:center}
.zpl-nav-links a{font-size:14px;color:var(--ink-2);position:relative}
.zpl-nav-links a:hover{color:var(--orange)}
.zpl-nav-current{color:var(--orange) !important;font-weight:600}
.zpl-btn-ghost{padding:9px 16px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:14px;font-weight:500}
.zpl-btn-primary{padding:11px 20px;border-radius:999px;background:var(--orange);color:#fff;font-size:14px;font-weight:600;border:none;cursor:pointer;box-shadow:0 1px 0 rgba(0,0,0,.06),0 6px 18px rgba(243,106,42,.28);transition:transform .15s ease, box-shadow .15s ease;font-family:inherit}
.zpl-btn-primary:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(0,0,0,.06),0 10px 22px rgba(243,106,42,.34)}
.zpl-hero{margin:32px 0 56px;background:var(--teal);color:#fff;border-radius:28px;padding:56px 48px;position:relative;overflow:hidden}
.zpl-hero::after{content:"";position:absolute;right:-80px;bottom:-80px;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle at 30% 30%, rgba(243,106,42,.18), transparent 60%);pointer-events:none}
.zpl-pill{display:inline-flex;align-items:center;gap:6px;background:var(--orange);color:#fff;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;padding:7px 14px;border-radius:999px}
.zpl-hero h1{font-size:clamp(40px,6vw,68px);margin:18px 0 14px;max-width:720px;letter-spacing:-0.025em}
.zpl-hero h1 em{font-style:italic;color:#F2C49B;font-weight:400}
.zpl-hero p.zpl-lede{font-size:17px;color:#D8E2E0;max-width:560px}
.zpl-toggle-row{display:flex;justify-content:center;margin:-20px 0 36px;position:relative;z-index:2}
.zpl-toggle{background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px;display:inline-flex;gap:4px;box-shadow:0 8px 24px rgba(15,27,27,.06)}
.zpl-toggle button{border:none;background:transparent;padding:9px 22px;border-radius:999px;font-family:inherit;font-size:14px;font-weight:500;cursor:pointer;color:var(--ink-2);display:inline-flex;align-items:center;gap:8px}
.zpl-toggle button.zpl-toggle-active{background:var(--ink);color:#fff}
.zpl-save-tag{font-size:10px;letter-spacing:.1em;text-transform:uppercase;background:var(--orange-soft);color:var(--orange);padding:2px 7px;border-radius:6px;font-weight:600}
.zpl-toggle button.zpl-toggle-active .zpl-save-tag{background:rgba(255,255,255,.15);color:#FBE4D5}
.zpl-plans{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:80px}
.zpl-plan{background:#fff;border:1px solid var(--line);border-radius:24px;padding:32px 28px;display:flex;flex-direction:column;position:relative;transition:transform .2s ease, box-shadow .2s ease}
.zpl-plan:hover{transform:translateY(-3px);box-shadow:0 18px 40px rgba(15,27,27,.08)}
.zpl-plan-popular{background:var(--ink);color:#fff;border-color:var(--ink);box-shadow:0 20px 50px rgba(15,27,27,.18)}
.zpl-plan-popular .zpl-feat{color:#D8E2E0}
.zpl-plan-popular .zpl-feat-dot{background:var(--orange);color:#fff}
.zpl-plan-popular .zpl-currency,.zpl-plan-popular .zpl-per{color:#9DB1AE}
.zpl-plan-popular .zpl-meta{color:#9DB1AE}
.zpl-badge-pop{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--orange);color:#fff;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;padding:6px 12px;border-radius:999px}
.zpl-mascot{width:54px;height:54px;border-radius:14px;display:grid;place-items:center;font-size:28px;background:var(--cream-2)}
.zpl-plan-popular .zpl-mascot{background:rgba(243,106,42,.15)}
.zpl-plan-name{font-family:'Fraunces',serif;font-size:24px;font-weight:600;margin-top:14px}
.zpl-meta{font-size:13px;color:var(--muted);margin-top:4px;margin-bottom:20px}
.zpl-price-row{display:flex;align-items:baseline;gap:4px;margin-bottom:6px}
.zpl-currency{font-size:16px;color:var(--muted);font-weight:500}
.zpl-price{font-family:'Fraunces',serif;font-size:54px;font-weight:500;letter-spacing:-0.03em}
.zpl-per{font-size:14px;color:var(--muted)}
.zpl-annual-note{font-size:12px;color:var(--muted);margin-bottom:24px;min-height:18px}
.zpl-plan-popular .zpl-annual-note{color:#9DB1AE}
.zpl-cta{width:100%;padding:13px;border-radius:14px;font-family:inherit;font-weight:600;font-size:14px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;transition:all .15s ease}
.zpl-cta:hover{border-color:var(--ink);transform:translateY(-1px)}
.zpl-cta-primary{background:var(--orange);color:#fff;border-color:var(--orange);box-shadow:0 6px 16px rgba(243,106,42,.28)}
.zpl-cta-primary:hover{background:#E55E22}
.zpl-plan-popular .zpl-cta{background:var(--orange);color:#fff;border-color:var(--orange)}
.zpl-feats{margin-top:24px;padding-top:24px;border-top:1px dashed var(--line);display:flex;flex-direction:column;gap:11px}
.zpl-plan-popular .zpl-feats{border-top-color:rgba(255,255,255,.14)}
.zpl-feat{display:flex;gap:10px;font-size:14px;line-height:1.45;color:var(--ink-2)}
.zpl-feat-dot{flex-shrink:0;width:18px;height:18px;border-radius:50%;background:var(--good);display:grid;place-items:center;color:var(--green);margin-top:2px;font-size:11px;font-weight:700}
.zpl-feat strong{color:inherit;font-weight:600}
.zpl-section-tag{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.zpl-section-tag::before{content:"";width:24px;height:2px;background:var(--orange)}
.zpl-section-tag span{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.zpl-section-h{font-size:clamp(32px,4vw,46px);margin-bottom:36px;letter-spacing:-0.02em;max-width:680px}
.zpl-compare{margin-bottom:80px}
.zpl-table-wrap{background:#fff;border:1px solid var(--line);border-radius:20px;overflow:hidden}
.zpl-page table{width:100%;border-collapse:collapse}
.zpl-page thead th{background:var(--cream-2);padding:18px 20px;text-align:left;font-family:'Fraunces',serif;font-weight:500;font-size:18px;border-bottom:1px solid var(--line)}
.zpl-page thead th:first-child{font-size:13px;font-family:'Bricolage Grotesque',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
.zpl-page thead th.zpl-th-popular{background:var(--ink);color:#fff;position:relative}
.zpl-page tbody td{padding:15px 20px;border-bottom:1px solid var(--line);font-size:14px}
.zpl-page tbody tr:last-child td{border-bottom:none}
.zpl-page tbody td:first-child{color:var(--ink-2);font-weight:500}
.zpl-td-center{text-align:left;color:var(--ink-2)}
.zpl-no{color:var(--muted)}
.zpl-check{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--good);color:var(--green);font-size:12px}
.zpl-page tbody tr.zpl-divider td{background:var(--cream);font-family:'Fraunces',serif;font-weight:600;color:var(--teal);font-size:13px;letter-spacing:.06em;text-transform:uppercase;padding:10px 20px}
.zpl-pay-row{display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap;margin-bottom:64px}
.zpl-pay-row span{font-size:13px;color:var(--muted)}
.zpl-pay-chip{background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 14px;font-size:13px;display:inline-flex;align-items:center;gap:8px;font-weight:500}
.zpl-pay-chip .zpl-swatch{width:18px;height:18px;border-radius:4px;display:inline-block}
.zpl-pay-momo .zpl-swatch{background:#FFCC00}
.zpl-pay-airtel .zpl-swatch{background:#E60012}
.zpl-pay-visa .zpl-swatch{background:linear-gradient(135deg,#1A1F71,#3057A4)}
.zpl-pay-mc .zpl-swatch{background:linear-gradient(90deg,#EB001B 50%, #F79E1B 50%)}
.zpl-faq{margin-bottom:90px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
details.zpl-q{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px 22px;cursor:pointer;transition:border-color .15s ease}
details.zpl-q[open]{border-color:var(--ink)}
details.zpl-q summary{list-style:none;font-family:'Fraunces',serif;font-size:18px;font-weight:500;display:flex;justify-content:space-between;align-items:center;gap:14px}
details.zpl-q summary::-webkit-details-marker{display:none}
details.zpl-q summary::after{content:"+";font-family:'Bricolage Grotesque',sans-serif;font-size:22px;color:var(--muted);transition:transform .2s ease}
details.zpl-q[open] summary::after{content:"–";color:var(--orange)}
details.zpl-q p{margin-top:12px;font-size:14px;color:var(--ink-2);line-height:1.6}
.zpl-footer-cta{background:var(--teal);color:#fff;border-radius:24px;padding:48px;text-align:center;margin-bottom:48px;position:relative;overflow:hidden}
.zpl-footer-cta::before{content:"";position:absolute;left:-60px;top:-60px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle, rgba(243,106,42,.15), transparent 60%)}
.zpl-footer-cta h3{font-size:36px;margin-bottom:10px;position:relative}
.zpl-footer-cta p{color:#9DB1AE;margin-bottom:24px;position:relative}
.zpl-footer-cta .zpl-btn-primary{position:relative}
.zpl-site{display:flex;justify-content:space-between;padding:28px 0;color:var(--muted);font-size:13px;border-top:1px solid var(--line)}
@media (max-width:880px){
  .zpl-plans{grid-template-columns:1fr;gap:16px}
  .zpl-hero{padding:40px 28px}
  .zpl-faq{grid-template-columns:1fr}
  .zpl-nav-links a:not(.zpl-btn-ghost):not(.zpl-btn-primary){display:none}
  .zpl-page table{font-size:13px}
  .zpl-page thead th{font-size:15px;padding:14px 14px}
  .zpl-page tbody td{padding:12px 14px}
  .zpl-footer-cta{padding:36px 24px}
}
`
