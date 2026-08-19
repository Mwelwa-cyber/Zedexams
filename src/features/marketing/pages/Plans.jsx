import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import Logo from '../../../shared/components/Logo'
import Button from '../../../shared/components/Button'
import Card from '../../../shared/components/Card'
import SeoHelmet from '../../../shared/components/SeoHelmet'
// Prices live in src/config/teacherPlanPricing.js so /pricing and the
// /teachers landing can never drift apart on the numbers.
import { PLAN_PRICES } from '../../../config/teacherPlanPricing'
// Learner prices come from the LADDER (src/config/plans.js) rather than being
// typed again here. That module is joined to the checkout catalogue by
// `checkoutPlanId`, so a rung this page advertises is provably one Lenco can
// charge for — a hard-coded "K15" on a marketing page is a number nobody
// reconciles until a learner taps it and pays the wrong amount.
import { getPlan } from '../../../config/plans'
// The age band, from the SAME resolver every gate in the app uses. Not a
// re-derived `profile.isMinor` check: `resolveAgeBand` is where the
// fail-closed rule lives (a learner is under-18 unless `isMinor === false`
// positively says otherwise), and a second copy of that default is exactly
// how a surface ends up disagreeing with the rest of the product about
// whether it is talking to a child. planState.js is pure — no React, no
// Firebase — so this costs the marketing chunk nothing but the function.
import { resolveAgeBand, AGE_BAND } from '../../../services/entitlements/planState'
import GuardianPricingNotice from '../components/GuardianPricingNotice'
import { isNativePlatform } from '../../../utils/runtime'

const UpgradeModal = lazy(() => import('../../subscription').then(m => ({ default: m.UpgradeModal })))

const FAQ = [
  {
    q: 'What happens when I hit my monthly limit?',
    a: "Your plan keeps everything you've already made — nothing gets locked. You can either wait for the reset on the 1st of next month, upgrade for instant unlock, or pay K25 for one extra generation if you only need one more.",
  },
  {
    q: 'Can I pay with Mobile Money?',
    a: "Yes — Airtel Money, MTN MoMo and cards all work, right inside the app. Choose your plan, pay securely through our checkout, and your account unlocks instantly — no sending money to a number, no waiting. There's no auto-renewal either: you only pay for the period you choose.",
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

// Android (Google Play) build: billing runs through Google Play only, so the
// mobile-money/K25 answers are swapped for Play equivalents. Play policy —
// the app must not describe or point at alternative payment methods.
const FAQ_NATIVE = FAQ.map((item) => {
  if (item.q === 'What happens when I hit my monthly limit?') {
    return {
      ...item,
      a: "Your plan keeps everything you've already made — nothing gets locked. You can either wait for the reset on the 1st of next month, or upgrade for instant unlock.",
    }
  }
  if (item.q === 'Can I pay with Mobile Money?') {
    return {
      q: 'How do I pay in the app?',
      a: 'Subscriptions in the Android app are billed securely through Google Play. Choose a plan, confirm in the Google Play purchase sheet, and your account unlocks instantly.',
    }
  }
  if (item.q === 'Can I cancel anytime?') {
    return {
      ...item,
      a: 'Anytime. Manage or cancel from the Play Store and you keep Pro access until the end of your billing period. After that you fall back to Free — your saved work stays.',
    }
  }
  return item
})

function Section({ children, className = '' }) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  )
}

function Price({ planKey, billing, onDark, native }) {
  const value = PLAN_PRICES[planKey][billing]
  const muted = onDark ? 'text-white/70' : 'theme-text-muted'
  // Android: ZMW web prices stay off-screen — Google Play's purchase sheet
  // shows the authoritative localized price for the paid tiers.
  if (native) {
    return (
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="font-display font-black text-3xl tracking-tight leading-none">
          {value > 0 ? 'Via Google Play' : 'Free'}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-baseline gap-1.5 mb-1.5">
      <span className={`text-base font-bold ${muted}`}>K</span>
      <span className="font-display font-black text-5xl tracking-tight leading-none">{value}</span>
      <span className={`text-sm ${muted}`}>
        {billing === 'annual' && value > 0 ? '/ month, billed yearly' : '/ month'}
      </span>
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

function PlanCard({ plan, billing, popular = false, onCta, native }) {
  // Native: the "Or K590 / year" style notes carry ZMW literals.
  const note = native ? String(plan.note || '').replace(/Or K[\d,]+ \/ year/, 'Yearly plan available') : plan.note
  return (
    <Card
      variant={popular ? 'hero' : 'elevated'}
      size="lg"
      className={`relative flex flex-col ${popular ? '' : 'theme-text'}`}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-[color:var(--hero-cta-bg)] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[color:var(--hero-cta-text)] shadow-elev-sm ring-1 ring-black/5">
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
      <Price planKey={plan.key} billing={billing} onDark={popular} native={native} />
      <div className={`text-xs mb-6 min-h-[18px] ${popular ? 'text-white/70' : 'theme-text-muted'}`}>{note}</div>
      <Button
        variant={popular ? 'primary' : 'secondary'}
        size="lg"
        fullWidth
        onClick={onCta}
        className={popular ? '!bg-[color:var(--hero-cta-bg)] !text-[color:var(--hero-cta-text)] hover:!bg-[color:var(--hero-cta-bg)]' : ''}
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
      <><strong>2</strong> lesson plans / month</>,
      <>Preview a <strong>sample</strong> of every other studio</>,
      <>Daily cap of <strong>2</strong> generations</>,
      'HTML export only',
      'Library kept for 7 days',
      'Full syllabi access',
    ],
  },
  {
    key: 'pro', name: 'Pro', mascot: '🦊', meta: 'For the everyday teacher',
    note: 'Or K590 / year — two months free.', cta: 'Go Pro', popular: true,
    feats: [
      <><strong>40</strong> lesson plans / month</>,
      <><strong>30</strong> homework activities</>,
      <><strong>25</strong> teacher notes</>,
      <><strong>2</strong> schemes of work / month</>,
      <><strong>1</strong> free assessment + exam paper to try</>,
      <>Daily cap of <strong>10</strong> generations</>,
      'DOCX + PDF export',
      'Library kept forever',
      'Premium model quality',
    ],
  },
  {
    key: 'max', name: 'Max', mascot: '🦅', meta: 'For heavy users',
    note: 'Or K1,490 / year — two months free.', cta: 'Go Max',
    feats: [
      <><strong>Unlimited</strong> assessments &amp; exam papers</>,
      <>The Assessment &amp; Exam Paper studios — <strong>Max only</strong></>,
      <><strong>Unlimited</strong> plans, notes &amp; homework*</>,
      <>Daily cap of <strong>30</strong> generations</>,
      'Bulk export (whole term in one click)',
      'Priority queue + early access to new studios',
      'Email support, 24h reply',
      <><em>*Fair use ~200/month</em></>,
    ],
  },
]

// The two learner rungs /pricing advertises. `week` and `month` are ladder
// ids; their prices and the checkout products behind them live in
// src/config/plans.js, which is why nothing below states a figure.
//
// Deliberately the weekly + monthly pair and not the whole five-rung ladder:
// the day pass and the seasonal Exam Pass are contextual offers made at a
// lock, and a marketing page that lists all five turns a clear choice into a
// price list.
const LEARNER_RUNGS = [
  {
    ladderId: 'week',
    mascot: '⚡',
    meta: 'For this week\u2019s test',
    feats: [
      'Unlimited quizzes',
      'Exam mode (timed practice)',
      'Weakness analysis after every attempt',
      'Every past paper for your grade',
    ],
  },
  {
    ladderId: 'month',
    mascot: '\u2b50',
    meta: 'For keeping the habit',
    popular: true,
    feats: [
      'Everything in Weekly',
      'Auto-marking with topic breakdowns',
      'Offline downloads',
      'Priority support',
    ],
  },
]

function LearnerPlanCard({ rung, onCta, native }) {
  const plan = getPlan(rung.ladderId)
  // A rung the ladder no longer offers renders nothing rather than a card with
  // a blank price — the ladder is allowed to change without this page breaking.
  if (!plan) return null
  return (
    <Card
      variant={rung.popular ? 'hero' : 'elevated'}
      size="lg"
      className={`relative flex flex-col ${rung.popular ? '' : 'theme-text'}`}
    >
      {rung.popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-[color:var(--hero-cta-bg)] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[color:var(--hero-cta-text)] shadow-elev-sm ring-1 ring-black/5">
          Best value
        </span>
      )}
      <div
        className={`grid place-items-center w-14 h-14 rounded-2xl text-3xl ${
          rung.popular ? 'bg-white/15' : 'bg-[color:var(--bg-subtle)]'
        }`}
        aria-hidden="true"
      >{rung.mascot}</div>
      <div className="font-display font-black text-2xl mt-4">{plan.label}</div>
      <div className={`text-sm mt-1 mb-5 ${rung.popular ? 'text-white/70' : 'theme-text-muted'}`}>{rung.meta}</div>
      {/* Android: the ZMW figure stays off-screen for the same reason it does
          on the teacher cards — the learner rungs are real Play products
          (learner_premium_weekly / _monthly), so Play's sheet shows the
          authoritative localized price. */}
      {native ? (
        <div className="flex items-baseline gap-1.5 mb-1.5">
          <span className="font-display font-black text-3xl tracking-tight leading-none">Via Google Play</span>
        </div>
      ) : (
        <div className="flex items-baseline gap-1.5 mb-1.5">
          <span className={`text-base font-bold ${rung.popular ? 'text-white/70' : 'theme-text-muted'}`}>K</span>
          <span className="font-display font-black text-5xl tracking-tight leading-none">{plan.price}</span>
          <span className={`text-sm ${rung.popular ? 'text-white/70' : 'theme-text-muted'}`}>{plan.period}</span>
        </div>
      )}
      <div className={`text-xs mb-6 min-h-[18px] ${rung.popular ? 'text-white/70' : 'theme-text-muted'}`}>
        {native ? plan.blurb : `${plan.blurb} \u00b7 no auto-renewal`}
      </div>
      <Button
        variant={rung.popular ? 'primary' : 'secondary'}
        size="lg"
        fullWidth
        onClick={onCta}
        className={rung.popular ? '!bg-[color:var(--hero-cta-bg)] !text-[color:var(--hero-cta-text)] hover:!bg-[color:var(--hero-cta-bg)]' : ''}
      >
        {`Get ${plan.label}`}
      </Button>
      <div
        className={`mt-6 pt-6 border-t border-dashed flex flex-col gap-3 ${
          rung.popular ? 'border-white/20' : 'theme-border'
        }`}
      >
        {rung.feats.map((f, i) => (
          <Feat key={i} onDark={rung.popular}>{f}</Feat>
        ))}
      </div>
    </Card>
  )
}

function SectionTag({ children }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-6 h-0.5 bg-[color:var(--accent)]" aria-hidden="true" />
      <span className="text-xs font-black uppercase tracking-wider theme-text-muted">{children}</span>
    </div>
  )
}

export default function Plans() {
  const { currentUser, isTeacher, isParent, userProfile } = useAuth()
  const navigate = useNavigate()
  const [billing, setBilling] = useState('monthly')
  const [showUpgrade, setShowUpgrade] = useState(null) // 'pro' | 'max' | null
  // Android shell: Google Play Billing only — no mobile-money copy, no ZMW
  // price literals, no payment-method badges (Play policy).
  const native = isNativePlatform()

  /**
   * A learner we know to be (or must assume to be) under 18 sees no price.
   *
   * Gated on being SIGNED IN, deliberately. `resolveAgeBand` fails closed, so
   * it reads a visitor with no profile as under-18 — correct for a locked
   * feature, wrong here: it would blank the public pricing page for every
   * signed-out parent and teacher, which is most of its audience. We withhold
   * when we have an ACCOUNT that is or might be a child; an anonymous visitor
   * is not one, has no account to buy against, and is served the normal page.
   *
   * Teachers, parents and admins resolve to `adult` inside the resolver, so
   * they are unaffected without a role check here.
   */
  const isMinorLearner =
    Boolean(currentUser) && resolveAgeBand(userProfile) === AGE_BAND.UNDER_18
  const faqItems = native ? FAQ_NATIVE : FAQ

  // Before anything priced is constructed. Every hook above this line runs
  // unconditionally, so the early return is safe under the rules of hooks.
  if (isMinorLearner) return <GuardianPricingNotice />

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

  /**
   * Where a learner rung's CTA goes.
   *
   * Anyone reaching this is an ADULT — `isMinorLearner` returned above, so a
   * minor never sees the rung this fires from. That is worth stating because
   * an earlier version of this comment claimed the opposite: that the CTA
   * could hand a minor to /my-subscription and let "the age-aware flow there"
   * decide.
   *
   * When #2486 wrote that, there was no such flow — `MySubscriptionPage`
   * opened `UpgradeModal` with no age check, so it showed prices to whoever
   * opened it. THIS branch closes that: `MySubscriptionRoute` now sends a
   * learner who is not positively an adult to /ask-a-grown-up before the page
   * renders (see its `mayShowPrice` guard). The gate above is still the one
   * that matters here — a page that never constructs a price is a stronger
   * guarantee than a page that redirects away from one — and the rule stands
   * either way: do not route a minor at a checkout on the assumption that
   * something downstream will catch it.
   *
   * Still deliberately not the UpgradeModal the teacher cards open: the
   * learner's own subscription surface is where a learner manages a plan, and
   * a second checkout entry point on a marketing page is a second thing to
   * keep age-correct. Anonymous visitors register first, which is where an
   * age is captured at all.
   *
   * A PARENT takes a different door. /my-subscription is written for the
   * account that HOLDS the plan and a guardian never is — their money credits
   * the child (`beneficiaryUid`) — so they go to /family/plan, the checkout
   * that knows which child it is for. Without this they would be bounced by
   * ParentRouteGuard to /family/account/billing: their receipts, not a plan
   * picker.
   */
  function handleLearnerCta() {
    if (isParent) {
      navigate('/family/plan')
      return
    }
    navigate(currentUser ? '/my-subscription' : '/register?intent=upgrade&tier=learner')
  }

  // NOTE: this branch arrived with a second age gate here — a
  // `mayShowPrice` check redirecting to /ask-a-grown-up. It is deleted
  // rather than kept alongside `isMinorLearner` above, which lands the same
  // decision for every input and lands it EARLIER, before anything priced is
  // constructed. Two gates for one rule is how they drift: the day somebody
  // narrows one, the other keeps the page looking correct in review while
  // the guarantee has already moved.
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
        description="ZedExams plans for Zambian teachers (Pro and Max) and for learners and families. Pay with Airtel Money or MTN MoMo, confirm on WhatsApp."
        path="/pricing"
      />
      <div className="marketing-page min-h-screen theme-bg theme-text font-body">
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
              {native
                ? 'Start free. Upgrade when your week gets busy — billed securely through Google Play, active in seconds.'
                : "Start free. Upgrade when your week gets busy. Pay with Airtel Money or MTN MoMo, confirm on WhatsApp, and you're live within 30 minutes."}
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
                native={native}
              />
            ))}
          </div>
        </Section>

        {/* Learner plans. /pricing was teacher-only, so a learner (or the
            parent paying for one) who landed here found three teacher tiers
            and no way to buy what they actually came for. */}
        <Section className="pb-16 sm:pb-20">
          <SectionTag>For learners</SectionTag>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3 max-w-xl">
            Studying for an exam? Start here.
          </h2>
          <p className="theme-text-muted mb-9 max-w-xl">
            {native
              ? 'Unlimited quizzes, timed exam mode and every past paper for your grade. Pay by the week or by the month \u2014 whichever suits.'
              : 'Unlimited quizzes, timed exam mode and every past paper for your grade. Pay by the week or by the month \u2014 no auto-renewal, so you only pay for the period you choose.'}
          </p>
          <div className="grid gap-5 md:grid-cols-2 items-start max-w-3xl">
            {LEARNER_RUNGS.map((rung) => (
              <LearnerPlanCard
                key={rung.ladderId}
                rung={rung}
                onCta={handleLearnerCta}
                native={native}
              />
            ))}
          </div>
        </Section>

        {/* Comparison */}
        <Section className="pb-16 sm:pb-20">
          <SectionTag>Compare</SectionTag>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-3 max-w-xl">
            Every feature, side by side.
          </h2>
          {/* The table below is the TEACHER tiers only. Saying so matters now
              that learner plans share the page: an unlabelled comparison read
              as covering all five products, and none of these rows describe
              the learner rungs. */}
          <p className="theme-text-muted mb-9 max-w-xl">
            The Free, Pro and Max teacher plans.
          </p>
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
                  <Row label="Lesson plans" cells={['2', '40', 'Unlimited']} />
                  <Row label="Homework" cells={['4', '30', 'Unlimited']} />
                  <Row label="Teacher notes" cells={['Sample', '25', 'Unlimited']} />
                  <Row label="Schemes of work" cells={['Sample', '2', 'Unlimited']} />

                  <tr><td colSpan={4} className="px-5 py-2.5 bg-[color:var(--bg-subtle)] text-xs font-black uppercase tracking-wider theme-accent-text">Max studios</td></tr>
                  <Row label="Assessment studio" cells={['Sample', '1 to try', 'Unlimited']} />
                  <Row label="Exam Paper studio" cells={['Sample', '1 to try', 'Unlimited']} />

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

        {/* Payment methods — web only; the Android app bills through Google
            Play and must not advertise other payment methods. */}
        {!native && <Section className="pb-16">
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
        </Section>}

        {/* FAQ */}
        <Section className="pb-16 sm:pb-20">
          <SectionTag>FAQ</SectionTag>
          <h2 className="font-display font-black text-3xl sm:text-4xl mb-9 max-w-xl">
            The honest answers.
          </h2>
          <div className="grid gap-3.5 md:grid-cols-2">
            {faqItems.map((item) => (
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
              className="!bg-[color:var(--hero-cta-bg)] !text-[color:var(--hero-cta-text)] hover:!bg-[color:var(--hero-cta-bg)]"
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
