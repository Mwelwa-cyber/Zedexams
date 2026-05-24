import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Card from '../ui/Card'
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
    a: "Yes — Airtel Money and MTN MoMo both work. You send the amount to our number, then confirm on WhatsApp using your email as the reference. We activate your account within 30 minutes, 7 days a week. There's no auto-renewal — you only pay for the period you choose.",
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

const PAYMENT_METHODS = [
  { label: 'Airtel Money', swatch: '#E60012' },
  { label: 'MTN MoMo',     swatch: '#FFCC00' },
  { label: 'WhatsApp confirm', swatch: '#25D366' },
]

function Section({ children, className = '' }) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  )
}

function Price({ planKey, billing, onDark }) {
  const value = PLAN_PRICES[planKey][billing]
  const muted = onDark ? 'text-white/70' : 'theme-text-muted'
  return (
    <div className="flex items-baseline gap-1.5 mb-1.5">
      <span className={`text-base font-bold ${muted}`}>K</span>
      <span className="font-display font-black text-5xl tracking-tight leading-none">{value}</span>
      <span className={`text-sm ${muted}`}>/ month</span>
    </div>
  )
}

function Feat({ children, onDark }) {
  return (
    <div className={`flex gap-2.5 text-sm leading-snug ${onDark ? 'text-white/85' : 'theme-text'}`}>
      <span
        className={`flex-shrink-0 grid place-items-center w-[18px] h-[18px] rounded-full mt-0.5 text-[11px] font-black ${
          onDark
            ? 'bg-white/20 text-white'
            : 'bg-[color:var(--accent-bg)] theme-accent-text'
        }`}
        aria-hidden="true"
      >✓</span>
      <span>{children}</span>
    </div>
  )
}

function Row({ label, cells }) {
  return (
    <tr className="border-b theme-border last:border-b-0">
      <td className="px-5 py-3.5 text-sm font-bold theme-text">{label}</td>
      {cells.map((cell, i) => (
        <td key={i} className="px-5 py-3.5 text-sm text-center theme-text-muted">
          {cell === true ? (
            <span className="inline-grid place-items-center w-5 h-5 rounded-full bg-[color:var(--accent-bg)] theme-accent-text text-xs">✓</span>
          ) : cell === null ? (
            <span className="theme-text-muted">—</span>
          ) : (
            cell
          )}
        </td>
      ))}
    </tr>
  )
}

function PlanCard({ plan, billing, popular = false, onCta }) {
  return (
    <Card
      variant={popular ? 'hero' : 'elevated'}
      size="lg"
      className={`relative flex flex-col ${popular ? '' : 'theme-text'}`}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white">
          Most popular
        </span>
      )}
      <div
        className={`grid place-items-center w-14 h-14 rounded-2xl text-3xl ${
          popular ? 'bg-white/15' : 'bg-[color:var(--bg-subtle)]'
        }`}
        aria-hidden="true"
      >{plan.mascot}</div>
      <div className="font-display font-black text-2xl mt-4">{plan.name}</div>
      <div className={`text-sm mt-1 mb-5 ${popular ? 'text-white/70' : 'theme-text-muted'}`}>{plan.meta}</div>
      <Price planKey={plan.key} billing={billing} onDark={popular} />
      <div className={`text-xs mb-6 min-h-[18px] ${popular ? 'text-white/70' : 'theme-text-muted'}`}>{plan.note}</div>
      <Button
        variant={popular ? 'primary' : 'secondary'}
        size="lg"
        fullWidth
        onClick={onCta}
        className={popular ? 'bg-white !text-[color:var(--accent-fg)] hover:bg-white' : ''}
      >
        {plan.cta}
      </Button>
      <div
        className={`mt-6 pt-6 border-t border-dashed flex flex-col gap-3 ${
          popular ? 'border-white/20' : 'theme-border'
        }`}
      >
        {plan.feats.map((f, i) => (
          <Feat key={i} onDark={popular}>{f}</Feat>
        ))}
      </div>
    </Card>
  )
}

const PLANS = [
  {
    key: 'free', name: 'Free', mascot: '🐢', meta: 'For trying things out',
    note: 'No card required.', cta: 'Start free',
    feats: [
      <><strong>5</strong> lesson plans / month</>,
      <><strong>3</strong> worksheets / month</>,
      <><strong>3</strong> teacher notes / month</>,
      <>Daily cap of <strong>2</strong> generations</>,
      'HTML export only',
      'Library kept for 7 days',
      'Full syllabi access',
    ],
  },
  {
    key: 'pro', name: 'Pro', mascot: '🦊', meta: 'For the everyday teacher',
    note: 'Or K790 / year — two months free.', cta: 'Go Pro', popular: true,
    feats: [
      <><strong>40</strong> lesson plans / month</>,
      <><strong>25</strong> worksheets &amp; teacher notes</>,
      <><strong>8</strong> assessments / month</>,
      <><strong>2</strong> schemes of work / term</>,
      <>Daily cap of <strong>10</strong> generations</>,
      'DOCX + PDF export',
      'Library kept forever',
      'Premium model quality',
    ],
  },
  {
    key: 'max', name: 'Max', mascot: '🦅', meta: 'For HoDs & heavy users',
    note: 'Or K1,990 / year — two months free.', cta: 'Go Max',
    feats: [
      <><strong>Unlimited</strong> plans, notes &amp; worksheets*</>,
      <><strong>Unlimited</strong> assessments &amp; schemes</>,
      <>Daily cap of <strong>30</strong> generations</>,
      'Bulk export (whole term in one click)',
      'Priority queue when servers are busy',
      'Early access to new studios',
      'Email support, 24h reply',
      <><em>*Fair use ~200/month</em></>,
    ],
  },
]

function SectionTag({ children }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-6 h-0.5 bg-[color:var(--accent)]" aria-hidden="true" />
      <span className="text-xs font-black uppercase tracking-wider theme-text-muted">{children}</span>
    </div>
  )
}

export default function Plans() {
  const { currentUser, isTeacher } = useAuth()
  const navigate = useNavigate()
  const [billing, setBilling] = useState('monthly')
  const [showUpgrade, setShowUpgrade] = useState(null) // 'pro' | 'max' | null

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

  function ctaFor(key) {
    return key === 'free' ? handleFreeCta : () => handlePaidCta(key)
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
        description="ZedExams Pro and Max plans for Zambian teachers and learners. Pay with Airtel Money or MTN MoMo, confirm on WhatsApp."
        path="/pricing"
      />
      <div className="min-h-screen theme-bg theme-text font-body">
        {/* Top nav */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
          <Section className="flex items-center justify-between py-3">
            <Link to="/" aria-label="ZedExams home" className="flex items-center">
              <Logo size="sm" />
            </Link>
            <nav className="flex items-center gap-2 sm:gap-3">
              {currentUser ? (
                <Button as={Link} to={isTeacher ? '/teacher' : '/'} variant="ghost" size="sm">
                  Dashboard
                </Button>
              ) : (
                <Button as={Link} to="/login" variant="ghost" size="sm">
                  Sign in
                </Button>
              )}
              <Button as={Link} to="/register" variant="primary" size="sm">
                Get started
              </Button>
            </nav>
          </Section>
        </header>

        {/* Hero */}
        <Section className="pt-10 pb-8 sm:pt-14">
          <Card variant="hero" size="lg" className="relative overflow-hidden px-7 py-12 sm:px-12 sm:py-14">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
              ✦ Plans
            </span>
            <h1 className="font-display font-black tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mt-5 mb-4 max-w-2xl">
              Plans that grow with your classroom.
            </h1>
            <p className="text-lg text-white/80 max-w-xl">
              Start free. Upgrade when your week gets busy. Pay with Airtel Money or MTN MoMo, confirm on WhatsApp, and you're live within 30 minutes.
            </p>
          </Card>
        </Section>

        {/* Billing toggle */}
        <Section className="flex justify-center pb-8">
          <div className="inline-flex gap-1 rounded-full theme-card border theme-border p-1.5 shadow-elev-sm" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={billing === 'monthly'}
              onClick={() => setBilling('monthly')}
              className={`rounded-full px-5 py-2 text-sm font-black transition-all ${
                billing === 'monthly' ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted hover:theme-text'
              }`}
            >Monthly</button>
            <button
              type="button"
              role="tab"
              aria-selected={billing === 'annual'}
              onClick={() => setBilling('annual')}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-black transition-all ${
                billing === 'annual' ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted hover:theme-text'
              }`}
            >
              Annual
              <span
                className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-black ${
                  billing === 'annual' ? 'bg-white/20 text-white' : 'bg-[color:var(--accent-bg)] theme-accent-text'
                }`}
              >Save 17%</span>
            </button>
          </div>
        </Section>

        {/* Plan cards */}
        <Section className="pb-16 sm:pb-20">
          <div className="grid gap-5 md:grid-cols-3 items-start">
            {PLANS.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                billing={billing}
                popular={plan.popular}
                onCta={ctaFor(plan.key)}
              />
            ))}
          </div>
        </Section>

        {/* Comparison */}
        <Section className="pb-16 sm:pb-20">
          <SectionTag>Compare</SectionTag>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-9 max-w-xl">
            Every feature, side by side.
          </h2>
          <Card variant="flat" size="md" className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[color:var(--bg-subtle)]">
                    <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider theme-text-muted">Feature</th>
                    <th className="px-5 py-4 text-center font-display font-black text-base theme-text">Free</th>
                    <th className="px-5 py-4 text-center font-display font-black text-base theme-accent-text">Pro</th>
                    <th className="px-5 py-4 text-center font-display font-black text-base theme-text">Max</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={4} className="px-5 py-2.5 bg-[color:var(--bg-subtle)] text-xs font-black uppercase tracking-wider theme-accent-text">Generations / month</td></tr>
                  <Row label="Lesson plans" cells={['5', '40', 'Unlimited']} />
                  <Row label="Worksheets" cells={['3', '25', 'Unlimited']} />
                  <Row label="Teacher notes" cells={['3', '25', 'Unlimited']} />
                  <Row label="Assessments" cells={[null, '8', 'Unlimited']} />
                  <Row label="Schemes of work" cells={[null, '2 / term', 'Unlimited']} />

                  <tr><td colSpan={4} className="px-5 py-2.5 bg-[color:var(--bg-subtle)] text-xs font-black uppercase tracking-wider theme-accent-text">Limits &amp; quality</td></tr>
                  <Row label="Daily generation cap" cells={['2', '10', '30']} />
                  <Row label="Model quality" cells={['Standard', 'Premium', 'Premium']} />
                  <Row label="Priority queue" cells={[null, null, true]} />

                  <tr><td colSpan={4} className="px-5 py-2.5 bg-[color:var(--bg-subtle)] text-xs font-black uppercase tracking-wider theme-accent-text">Export &amp; library</td></tr>
                  <Row label="HTML export" cells={[true, true, true]} />
                  <Row label="DOCX + PDF export" cells={[null, true, true]} />
                  <Row label="Bulk export" cells={[null, null, true]} />
                  <Row label="Library retention" cells={['7 days', 'Forever', 'Forever']} />

                  <tr><td colSpan={4} className="px-5 py-2.5 bg-[color:var(--bg-subtle)] text-xs font-black uppercase tracking-wider theme-accent-text">Support</td></tr>
                  <Row label="Help centre" cells={[true, true, true]} />
                  <Row label="Email support" cells={[null, '48h', '24h']} />
                  <Row label="Early access to new studios" cells={[null, null, true]} />
                </tbody>
              </table>
            </div>
          </Card>
        </Section>

        {/* Payment methods */}
        <Section className="pb-16">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <span className="text-sm theme-text-muted">We accept</span>
            {PAYMENT_METHODS.map((m) => (
              <span
                key={m.label}
                className="inline-flex items-center gap-2 rounded-xl theme-card border theme-border px-3.5 py-2 text-sm font-bold theme-text"
              >
                <span
                  className="inline-block w-[18px] h-[18px] rounded"
                  style={{ background: m.swatch }}
                  aria-hidden="true"
                />
                {m.label}
              </span>
            ))}
          </div>
        </Section>

        {/* FAQ */}
        <Section className="pb-16 sm:pb-20">
          <SectionTag>FAQ</SectionTag>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-9 max-w-xl">
            The honest answers.
          </h2>
          <div className="grid gap-3.5 md:grid-cols-2">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group theme-card border theme-border rounded-2xl px-5 py-5 [&[open]]:border-[color:var(--accent)] transition-colors"
              >
                <summary className="flex items-center justify-between gap-3.5 cursor-pointer list-none font-display font-bold text-lg [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span className="text-2xl theme-text-muted group-open:theme-accent-text leading-none">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">–</span>
                  </span>
                </summary>
                <p className="mt-3 text-sm theme-text-muted leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* Footer CTA */}
        <Section className="pb-14">
          <Card variant="hero" size="lg" className="relative overflow-hidden text-center px-7 py-12 sm:px-12">
            <h3 className="font-display font-black text-3xl sm:text-4xl mb-3">Still on the fence?</h3>
            <p className="text-white/80 mb-7 max-w-md mx-auto">
              Free forever, no card needed. You can plan your first lesson in under a minute.
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={handleFreeCta}
              className="bg-white !text-[color:var(--accent-fg)] hover:bg-white"
            >
              ▶ Start with Free
            </Button>
          </Card>
        </Section>

        {/* Footer */}
        <footer className="border-t theme-border">
          <Section className="py-6 text-xs theme-text-muted flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <span>© 2026 ZedExams · Made in Lusaka 🇿🇲</span>
            <span className="flex items-center gap-4">
              <Link to="/terms" className="hover:theme-text">Terms</Link>
              <Link to="/privacy" className="hover:theme-text">Privacy</Link>
              <Link to="/" className="hover:theme-text">Home</Link>
            </span>
          </Section>
        </footer>
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
