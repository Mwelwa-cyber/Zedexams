/**
 * GuardianPricingNotice — what /pricing shows a learner who is under 18.
 *
 * ⚠️ THERE IS NO PRICE IN THIS FILE, AND THERE MUST NEVER BE ONE.
 *
 * Same structural guarantee as `GuardianAskSheet`, for the same reason and by
 * the same means: this component imports nothing from `config/plans`, nothing
 * from `subscriptionConfig`, no checkout component, and it renders no figure.
 * There is no price in its scope to leak, so the only way one reaches a
 * twelve-year-old through this surface is for someone to add an import — a
 * visible edit, unlike a conditional that quietly evaluates the wrong way.
 *
 * Why the WHOLE page is replaced rather than the learner cards alone: /pricing
 * states figures in four places — the learner rungs, the teacher plan cards,
 * the "Or K590 / year" notes, and the FAQ's K25 answer. A gate that hid the
 * first and left the other three would satisfy the diff and not the rule. One
 * branch that replaces the surface is both the stronger guarantee and the
 * easier one to verify, which is why `Plans.jsx` returns this before it builds
 * anything else.
 *
 * And there is deliberately NO route out to a checkout here — not even
 * /my-subscription, which /pricing sends adult learners to. That page opens
 * `UpgradeModal` with no age check of its own, so linking a minor to it would
 * relocate the leak rather than close it. The child is told who can act; the
 * asking happens through the in-app unlock sheet, which is age-aware.
 */

import { Link } from 'react-router-dom'
import Logo from '../../../shared/components/Logo'
import Button from '../../../shared/components/Button'
import Card from '../../../shared/components/Card'
import SeoHelmet from '../../../shared/components/SeoHelmet'

// What Premium gives, said WITHOUT a number. The child is the one who wants
// these; the guardian is the one who can buy them. Describing the value is the
// point of showing this page to a learner at all.
const BENEFITS = [
  'Unlimited quizzes, as much practice as you want',
  'Exam mode — timed practice like the real paper',
  'Every past paper for your grade',
  'Auto-marking with a breakdown of your weak topics',
  'Downloads that work without data',
]

export default function GuardianPricingNotice() {
  return (
    <>
      {/* noIndex: this is a signed-in variant of a public marketing URL. The
          crawler sees the normal priced page, which is the one that should
          rank; indexing this would put a page with no prices under a
          /pricing result. */}
      <SeoHelmet title="Premium — ask a parent or guardian" path="/pricing" noIndex />
      <div className="marketing-page min-h-screen theme-bg theme-text font-body">
        <header className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 flex items-center justify-between py-3">
            <Link to="/" aria-label="ZedExams home" className="flex items-center">
              <Logo size="sm" />
            </Link>
            <Button as={Link} to="/dashboard" variant="ghost" size="sm">
              My dashboard
            </Button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-10 sm:py-14">
          <Card variant="hero" size="lg" className="relative overflow-hidden px-7 py-12 sm:px-12">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
              ✦ Premium
            </span>
            <h1 className="font-display font-black tracking-tight text-3xl sm:text-4xl leading-[1.1] mt-5 mb-4">
              Ask a parent or guardian to set this up.
            </h1>
            <p className="text-lg text-white/80">
              Premium is bought by the grown-up who looks after your account. Show
              them this page — or tap the padlock on any locked activity and we
              will send them a message for you.
            </p>
          </Card>

          <Card variant="elevated" size="lg" className="mt-6">
            <h2 className="font-display font-black text-xl mb-1">What you get with Premium</h2>
            <p className="theme-text-muted text-sm mb-6">
              Everything below unlocks the moment your guardian sets it up.
            </p>
            <ul className="flex flex-col gap-3.5">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex gap-2.5 text-sm leading-snug theme-text">
                  <span
                    className="flex-shrink-0 grid place-items-center w-[18px] h-[18px] rounded-full mt-0.5 text-[11px] font-black bg-[color:var(--accent-bg)] theme-accent-text"
                    aria-hidden="true"
                  >✓</span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card variant="flat" size="md" className="mt-6">
            <h2 className="font-display font-black text-lg mb-2">Are you the parent or guardian?</h2>
            <p className="theme-text-muted text-sm">
              Sign in to your own account to see plans and set up Premium for your
              learner. If you share this device, sign out first so the account
              stays theirs.
            </p>
            <div className="mt-4">
              <Button as={Link} to="/login" variant="secondary" size="md">
                Sign in as a parent or guardian
              </Button>
            </div>
          </Card>

          <p className="theme-text-muted text-sm mt-8 text-center">
            Keep studying — <Link to="/dashboard" className="underline hover:theme-text">back to your dashboard</Link>.
          </p>
        </div>
      </div>
    </>
  )
}
