import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { getRoleLandingPath } from '../../../utils/navigation'
import { captureReferralFromUrl } from '../../../utils/referrals'
import { friendlyAuthMessage } from '../../../utils/friendlyErrors'
import { assessAction, shouldBlock } from '../../../utils/recaptcha'
import { validateFields, hasErrors, focusFirstError } from '../../../utils/formValidation'
import { requiresGuardianConsent } from '../../../utils/guardianConsent'
import { DOB_SOURCE, isKnownDobSource } from '../../../utils/ageAnswerCore'
import Logo from '../../../shared/components/Logo'
import Button from '../../../shared/components/Button'
import GoogleSignInButton from '../components/GoogleSignInButton'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { ZAMBIAN_PROVINCES } from '../../../config/zambia'
import AgeGateStep from '../components/AgeGateStep'
import GuardianConsentStep from '../components/GuardianConsentStep'
import GuardianConsentSent from '../components/GuardianConsentSent'
import {
  STEP,
  SIGNUP_ROLES,
  needsAdultConfirmation,
  needsAgeAnswer,
  resolveStep,
  stepsForRole,
} from '../../../utils/signupFlowCore'
import {
  clearSignupFlow,
  lockAgeAnswer,
  readLockedAgeAnswer,
  readSignupFlow,
  writeSignupFlow,
} from '../../../utils/signupOnboarding'
import { CANONICAL_SUBJECTS, subjectName } from '../../../config/canonicalEducation'

// Auth-error copy is centralised in src/utils/friendlyErrors.js
// (friendlyAuthMessage with flow: 'signup') so Login + Register share one
// source of truth. The sign-up phrasing of the native Google failures lives
// there too.

// Every canonical subject a teacher could teach, plus an escape hatch.
// This used to be the learner catalogue's eight upper-primary subjects,
// so a secondary teacher signing up had to pick 'Other'.
const TEACHER_SUBJECTS = [...CANONICAL_SUBJECTS.map((s) => subjectName(s.id)), 'Other']

const STRENGTH_COLORS = ['#E05C4E', '#E8872A', '#F0C040', '#1E9E6B']
const STRENGTH_MSGS   = ['Too short', 'Weak — add numbers', 'Almost there…', 'Strong ✓']

function passwordScore(v) {
  let sc = 0
  if (v.length >= 6) sc++
  if (v.length >= 8) sc++
  if (/[0-9]/.test(v) && /[a-zA-Z]/.test(v)) sc++
  if (/[^a-zA-Z0-9]/.test(v) && v.length >= 10) sc++
  return sc
}

const INPUT_CLASS =
  'w-full h-[46px] rounded-[10px] border-[1.5px] border-[#2A2A3C] bg-white ' +
  'text-[#1A1F2E] text-sm font-body px-3.5 outline-none transition-colors ' +
  'placeholder:text-[#B0AEBB] focus:border-[var(--accent)] ' +
  'focus:ring-[3px] focus:ring-black/5'

const SELECT_CLASS = INPUT_CLASS + ' appearance-none pr-8 cursor-pointer'

/**
 * Sign-up, as a sequence of screens rather than one page.
 *
 *   role select ─┬─ learner ─► age ─► auth ─┬─ 18+ ─► done
 *                │                          └─ <18 ─► guardian ─► done (limited)
 *                ├─ teacher ─► auth (18+ confirmation, no date of birth)
 *                └─ parent  ─► auth (18+ confirmation, no date of birth)
 *
 * Two things changed and both are structural rather than cosmetic:
 *
 * 1. THE AGE QUESTION MOVED IN FRONT OF EVERY SIGN-UP METHOD. It used to sit
 *    inside the email form while "Sign up with Google" sat above it, so a
 *    learner who tapped Google never saw it. An age screen one button avoids
 *    is, for Play's Families policy, not an age screen. Both methods now live
 *    on a screen that comes after it, and the guard is a rule in
 *    signupFlowCore.resolveStep rather than a conditional here — a deep link,
 *    a refresh and the back button all go through the same check.
 *
 * 2. TEACHERS AND PARENTS ARE NO LONGER ASKED THEIR BIRTHDAY. It fed no
 *    feature and no obligation, and a data type we collect is one we have to
 *    declare in the Privacy Policy and the Play Data safety form and defend
 *    on request. They tick a box confirming they are 18+; no date is stored.
 *
 * The URL carries the step (?step=age) so the flow is addressable and the
 * browser's own back button works, but the URL is never trusted — whatever it
 * asks for is passed through resolveStep, which answers with the furthest
 * step the answers on file have actually earned.
 */
export default function Register() {
  const { register, loginWithGoogle, ensureUserProfile } = useAuth()
  const navigate     = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Audit C7 — capture ?ref= once on mount and stash in localStorage.
  // The actual write into users/{uid}.referredBy happens inside
  // register() / loginWithGoogle() because the user doc is created
  // there. localStorage survives the OAuth round-trip if Google sign-in
  // bounces through accounts.google.com.
  const [referralCode, setReferralCode] = useState(null)
  useEffect(() => {
    const captured = captureReferralFromUrl(searchParams)
    if (captured) setReferralCode(captured)
  }, [searchParams])
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    confirm: '',
    grade: '',
    school: '',
    // ?role=teacher (used by the /teachers landing CTAs) preselects the
    // teacher account type; anything else falls back to learner.
    role: searchParams.get('role') === 'teacher' ? 'teacher' : 'learner',
    province: '',
    subject: '',
    // Teacher/parent only. Stored as the boolean attestation it is —
    // `ageConfirmed18Plus: true` — never as a date, because a checkbox is not
    // a birthday and recording it as one would put us back where we started.
    ageConfirmed18Plus: false,
  })
  // What the flow has established so far. Mirrored into sessionStorage on
  // every change so a Google sign-in that tears the page down (the native
  // Android shell, or any browser that falls back to a redirect) comes back
  // to a page that still knows the learner's answer.
  //   dob            — the captured date of birth (learners only)
  //   isMinor        — derived from it, for routing only; the account's real
  //                    value is recomputed server-side
  //   accountCreated — auth has succeeded; there is no going back
  //   guardianEmail  — set once the consent request is away
  const [flow, setFlow] = useState(() => readSignupFlow())
  const [lockedDob, setLockedDob] = useState(() => readLockedAgeAnswer())
  const [showPw, setShowPw]           = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError]             = useState('')
  // Per-field validation messages, keyed by field name. Drives the inline
  // errors + the scroll-to-first-invalid behaviour (see handleSubmit).
  const [fieldErrors, setFieldErrors] = useState({})

  const isTeacher = form.role === 'teacher'
  const isParent = form.role === 'parent'
  const isLearner = form.role === 'learner'

  // ── The step machine ────────────────────────────────────────────────
  // The URL proposes; resolveStep decides. Everything downstream reads
  // `step`, so there is exactly one place a screen can be reached from and
  // exactly one rule saying whether it may be.
  const requestedStep = searchParams.get('step')
  const step = resolveStep({
    requested: requestedStep,
    role: form.role,
    dob: flow.dob,
    isMinor: flow.isMinor,
    accountCreated: flow.accountCreated,
  })

  // Where in the flow this is, for the progress bar.
  //
  // Derived from stepsForRole rather than written down, so a step added to
  // the machine cannot leave the bar saying "3 of 4" forever. It is shown
  // because a form of unknown length feels endless to a nine-year-old — and
  // it reveals nothing: the number of screens is the same whatever answer
  // the age question gets, because the guardian screen is counted for every
  // learner. A bar that grew a step once a child answered "2014" would be a
  // hint about what that answer led to.
  const flowSteps = stepsForRole(form.role)
  const stepIndex = Math.max(0, flowSteps.indexOf(step))

  // Keep the URL honest about where the user actually is. `replace` so the
  // back button walks the flow rather than bouncing off a redirect.
  useEffect(() => {
    if (requestedStep === step) return
    const next = new URLSearchParams(searchParams)
    next.set('step', step)
    setSearchParams(next, { replace: true })
  }, [step, requestedStep, searchParams, setSearchParams])

  const advance = useCallback((patch, nextStep) => {
    setFlow(writeSignupFlow(patch))
    const next = new URLSearchParams(searchParams)
    next.set('step', nextStep)
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  const score = useMemo(() => passwordScore(form.password), [form.password])
  const strengthHint =
    form.password.length === 0 ? 'Enter at least 6 characters' :
    STRENGTH_MSGS[Math.max(0, score - 1)]

  function set(field) {
    return e => {
      const { value } = e.target
      setForm(f => ({ ...f, [field]: value }))
      // Clear a field's error the moment the user starts fixing it.
      setFieldErrors(prev => (prev[field] ? { ...prev, [field]: '' } : prev))
    }
  }

  function pickRole(role) {
    setForm(f => ({ ...f, role }))
    setError('')
    // Role switch changes which fields are required (grade vs subject +
    // province) — drop stale field errors so they don't linger.
    setFieldErrors({})
  }

  function continueFromRole() {
    if (!SIGNUP_ROLES.includes(form.role)) return
    // A learner meets the age screen; everyone else goes straight to auth.
    advance({ role: form.role }, needsAgeAnswer(form.role) ? STEP.AGE : STEP.AUTH)
  }

  /**
   * The age screen's one output.
   *
   * `isMinor` is derived here for ROUTING ONLY — it decides which screen comes
   * next and nothing else. The value written to the account is recomputed from
   * the date, server-side, on the user document's creation; a client that
   * could decide its own minor status would make the whole screen decorative.
   */
  function handleAgeAnswer({ dob, dobSource }) {
    // Hold this device to its first answer. lockAgeAnswer ignores a second
    // call while the first is fresh, so backing out and returning re-shows
    // this date rather than accepting a new one.
    lockAgeAnswer(dob)
    setLockedDob(readLockedAgeAnswer())
    // `dobSource` travels with the date because a derived date and a typed
    // one are not the same evidence — support needs to be able to tell a
    // learner who guessed from a grade apart from one who read their birth
    // certificate. Nothing ROUTES on it: the account's minor status is
    // derived from the date alone, which is why the derivations themselves
    // land below the consent age rather than raising a flag beside it.
    advance(
      { dob, dobSource: dobSource || DOB_SOURCE.TYPED, isMinor: requiresGuardianConsent(dob) },
      STEP.AUTH,
    )
  }

  // Friendlier field nouns than the humanised defaults ("full name", not
  // "display name"). See src/utils/formValidation.js.
  const VALIDATION_LABELS = { displayName: 'full name', school: 'school name' }

  function buildSchema() {
    return {
      displayName: ['required'],
      email: ['required', 'email'],
      password: ['required', { min: 6 }],
      confirm: [{ match: 'password', value: form.password, message: 'Passwords do not match.' }],
      // Parents have no school/grade of their own; they link to a child later.
      ...(isParent ? {} : { school: ['required'] }),
      ...(isTeacher ? { subject: ['required'], province: ['required'] } : {}),
      // A learner's grade is NOT asked here any more — it is the first step of
      // the setup wizard (`/setup`), which is where the prototype puts it and
      // where it belongs: it is a choice with consequences the learner can see
      // (the subject list on the very next screen changes with it), not a
      // dropdown buried between "school" and "confirm password". The account
      // is created without one, and `LearnerSetupGate` routes any learner
      // without a grade to the wizard, so there is no window in which a
      // grade-less learner reaches a screen that needs one.
    }
  }

  /** Shared bail-out for both auth methods: no confirmation, no account. */
  function blockedByAdultConfirmation() {
    if (!needsAdultConfirmation(form.role) || form.ageConfirmed18Plus) return false
    setFieldErrors(prev => ({
      ...prev,
      ageConfirmed18Plus: 'Please confirm that you are 18 years or older.',
    }))
    return true
  }

  async function handleGoogleSignUp() {
    setError('')
    if (blockedByAdultConfirmation()) return
    setGoogleLoading(true)
    try {
      const cred = await loginWithGoogle({
        role: form.role,
        // Onboarding answers, applied ONLY when this Google sign-in mints a
        // new account. An existing user's saved date of birth is never
        // overwritten by whatever was typed on the way in.
        onboarding: isLearner
          ? { dob: flow.dob, dobSource: flow.dobSource }
          : { ageConfirmed18Plus: form.ageConfirmed18Plus === true },
      })
      const profile = await ensureUserProfile(cred.user)

      // An account that already existed means this was a sign-IN through the
      // sign-up page. No onboarding writes happened; send them to their
      // dashboard rather than through a flow their account has outgrown.
      if (cred.isNewAccount === false) {
        clearSignupFlow()
        navigate(getRoleLandingPath(profile, '/'), { replace: true })
        return
      }

      if (isLearner && flow.isMinor) {
        // Stay on the page — the account exists and is already usable in
        // limited mode; the guardian screen attaches a consent request to it.
        advance({ accountCreated: true, provider: 'google' }, STEP.GUARDIAN)
        return
      }
      clearSignupFlow()
      // A null profile after successful auth is most likely a transient network
      // read error, not a missing profile. AuthContext's onSnapshot listener
      // runs concurrently and will populate the profile or set profileIssue on
      // its own. Calling logout() here would destroy a valid Firebase session.
      // Navigate to "/" and let RootRedirect / MissingProfileRecovery handle it.
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      if (err.code === 'auth/cancelled-popup-request') return
      console.error('[Google sign-up]', err?.code, err?.message)
      setError(friendlyAuthMessage(err.code, { flow: 'signup', online: navigator.onLine, fallback: 'Google sign-in failed. Please try again.' }))
    } finally { setGoogleLoading(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (blockedByAdultConfirmation()) return
    // Client-side validation: name the exact field, show its message inline,
    // and scroll to + focus the first offending field (spec requirement).
    const errors = validateFields(form, buildSchema(), VALIDATION_LABELS)
    if (hasErrors(errors)) {
      setFieldErrors(errors)
      setError('')
      focusFirstError(errors)
      return
    }
    setFieldErrors({})

    setError(''); setLoading(true)
    try {
      // reCAPTCHA Enterprise bot check (native Android only — no-op on web,
      // which is covered by App Check). Fail-open: only a definitive 'block'
      // verdict stops sign-up; a null token or any assessment error proceeds.
      if (shouldBlock(await assessAction('signup'))) {
        setError('We could not verify this request. Please try again in a moment.')
        return
      }
      const cred = await register(
        form.email.trim(),
        form.password,
        form.displayName.trim(),
        form.grade,
        form.school.trim(),
        form.role,
        {
          ...(isTeacher ? { province: form.province, subject: form.subject } : {}),
          // Learners only. The age screen ran before this form and
          // resolveStep refuses to render it without an answer, so this is
          // always present on the learner path — and always absent on the
          // other two, which are not asked. register() derives isMinor from
          // the date via the shared consent core rather than trusting a flag
          // the client computed.
          ...(isLearner
            ? {
              dob: flow.dob || null,
              // Guarded rather than passed through: sessionStorage is the
              // learner's own to edit, and firestore.rules pins this field to
              // a known vocabulary. An unrecognised value falls back to the
              // conservative reading — a typed date — rather than failing the
              // whole account write on a string nobody recognises.
              dobSource: isKnownDobSource(flow.dobSource) ? flow.dobSource : DOB_SOURCE.TYPED,
            }
            : {}),
          // Teachers and parents attest instead. A boolean, not a date.
          ...(needsAdultConfirmation(form.role)
            ? { ageConfirmed18Plus: form.ageConfirmed18Plus === true }
            : {}),
        },
      )
      // Warm the profile read in the background so the dashboard is ready the
      // moment they verify (failure is fine: AuthContext's onSnapshot listener
      // populates it on its own).
      ensureUserProfile(cred.user).catch(() => null)

      if (isLearner && flow.isMinor) {
        // The guardian hand-off comes before the verification page. The
        // account exists and works in limited mode either way, but this is
        // the one moment the learner is still in front of the form and can
        // type an address they actually know.
        advance({ accountCreated: true, provider: 'email' }, STEP.GUARDIAN)
        return
      }
      clearSignupFlow()
      // A fresh email/password signup is always unverified at this instant —
      // the dashboard is gated behind verification, so land directly on the
      // verification page.
      navigate('/verify-email', { replace: true })
    } catch (err) {
      // Never echo a raw Firebase message to the learner — map the code, and
      // fall back to calm generic copy when it's unmapped.
      setError(friendlyAuthMessage(err.code, { flow: 'signup', online: navigator.onLine }))
    } finally { setLoading(false) }
  }

  /**
   * Leave sign-up. The account already exists by the time any of the guardian
   * screens render, so every exit from here is a normal navigation, never a
   * rollback.
   *
   * Google sign-ups land on "/" and let RootRedirect route by role; email
   * sign-ups land on the verification page, which is what gates their
   * dashboard. Both clear the in-progress flow — but NOT the age answer,
   * which stays locked for its 24 hours.
   */
  const finishSignup = useCallback(() => {
    const viaGoogle = flow.provider === 'google'
    clearSignupFlow()
    navigate(viaGoogle ? '/' : '/verify-email', { replace: true })
  }, [flow.provider, navigate])

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative overflow-y-auto"
      style={{
        backgroundColor: 'var(--zt-surface)',
        '--accent': '#B44F2D',
        '--accent-bg': '#F8EADF',
        '--accent-fg': '#83372C',
      }}
    >
      <SeoHelmet
        title="Create account"
        description="Create your free ZedExams account to start practising."
        path="/register"
        noIndex
      />
      {/* Subtle background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
      </div>

      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[calc(100vw-2rem)] sm:max-w-[520px] px-5 sm:px-8 pt-9 pb-8 animate-scale-in relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-2.5 gap-1">
          <Logo variant="full" size="md" />
          <p className="text-[12px] text-[#6E7280] font-body">Practise smart.</p>
        </div>

        <div className="text-center mb-4">
          <h2 className="text-[20px] font-bold text-[#1A1F2E]">Create account</h2>
          {step === STEP.ROLE && (
            <p className="text-[13px] text-[#6E7280] mt-1">First — who's joining us today?</p>
          )}
        </div>

        <SignupProgress index={stepIndex} total={flowSteps.length} />

        {/* ── Step: role select ─────────────────────────────────────────
            No date of birth here and no sign-up buttons here. Both moved
            behind Continue so the learner path can put the age question in
            front of them. */}
        {step === STEP.ROLE && (
          <>
            <div className="text-[10.5px] font-bold uppercase tracking-[1px] text-[#6E7280] text-center mb-2.5">
              I am a
            </div>
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <RoleCard
                active={isLearner}
                onClick={() => pickRole('learner')}
                emoji="🎓"
                name="Learner"
                hint={<>Grade 7<br />Exam practice</>}
              />
              <RoleCard
                active={isTeacher}
                onClick={() => pickRole('teacher')}
                emoji="👩‍🏫"
                name="Teacher"
                hint={<>Lesson plans<br />&amp; tools</>}
              />
              <RoleCard
                active={isParent}
                onClick={() => pickRole('parent')}
                emoji="👪"
                name="Parent"
                hint={<>Follow your<br />child's progress</>}
              />
            </div>

            {/* Context strip */}
            <div
              className="flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 mb-4 min-h-[38px] border"
              style={
                isTeacher
                  ? { background: '#EBF5F1', borderColor: 'rgba(28,100,70,0.2)' }
                  : isParent
                    ? { background: '#EEF2FF', borderColor: 'rgba(79,70,229,0.22)' }
                    : { background: '#FFF5EC', borderColor: 'rgba(198,123,79,0.25)' }
              }
            >
              <span className="text-[14px] flex-shrink-0" aria-hidden="true">{isParent ? '👪' : '📚'}</span>
              <span
                className="text-[12.5px] font-medium"
                style={{ color: isTeacher ? '#1C6446' : isParent ? '#4338CA' : '#96552F' }}
              >
                {isTeacher
                  ? 'Access lesson plans, schemes of work & teaching tools'
                  : isParent
                    ? "Follow your child's quiz scores, streaks & subjects"
                    : "You'll get access to Grade 7 quizzes & exam practice"}
              </span>
            </div>

            <Button type="button" variant="primary" size="lg" fullWidth onClick={continueFromRole}>
              Continue
            </Button>
          </>
        )}

        {/* ── Step: the neutral age screen (learners only) ──────────────
            Before any sign-up method, on its own, with a locked first answer
            if this device already gave one today. */}
        {step === STEP.AGE && (
          <AgeGateStep onAnswer={handleAgeAnswer} lockedDob={lockedDob} />
        )}

        {/* ── Step: guardian hand-off (minors only, account already made) ─ */}
        {step === STEP.GUARDIAN && (
          flow.guardianEmail ? (
            <GuardianConsentSent guardianEmail={flow.guardianEmail} onContinue={finishSignup} />
          ) : (
            <GuardianConsentStep
              onSent={({ guardianEmail }) => setFlow(writeSignupFlow({ guardianEmail }))}
              onSkip={finishSignup}
            />
          )
        )}

        {/* ── Step: auth. Both methods, on one screen, after the age
            question has already been answered. ───────────────────────── */}
        {step === STEP.AUTH && (
        <>
        {/* The adult attestation for teachers and parents.
            It sits ABOVE both methods and gates BOTH, which is a deliberate
            difference from the brief: that asked for the checkbox on the email
            form and for the Google path to carry the same confirmation in a
            post-Google completion step. No such step exists in this codebase
            — the teacher's subject/province and the parent's child link are
            collected later, from inside the app, not in a signup completion
            screen — so building one to hold a checkbox would be inventing a
            screen. Gating both methods here is simpler and strictly stronger:
            no teacher or parent account is created without the confirmation,
            by either route. It is stored as `ageConfirmed18Plus: true`, never
            as a date. */}
        {needsAdultConfirmation(form.role) && (
          <div className="mb-4">
            <label
              htmlFor="ageConfirmed18Plus"
              className="flex items-start gap-2.5 rounded-[10px] border border-[#E4E9F0] px-3 py-2.5 cursor-pointer"
            >
              <input
                id="ageConfirmed18Plus"
                name="ageConfirmed18Plus"
                type="checkbox"
                checked={form.ageConfirmed18Plus}
                onChange={(e) => {
                  const { checked } = e.target
                  setForm(f => ({ ...f, ageConfirmed18Plus: checked }))
                  setFieldErrors(prev => (prev.ageConfirmed18Plus ? { ...prev, ageConfirmed18Plus: '' } : prev))
                }}
                aria-invalid={fieldErrors.ageConfirmed18Plus ? 'true' : undefined}
                aria-describedby={fieldErrors.ageConfirmed18Plus ? 'ageConfirmed18Plus-error' : undefined}
                className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 accent-[var(--accent)]"
              />
              <span className="text-[13px] text-[#1A1F2E] leading-[1.45]">
                I confirm that I am 18 years or older
              </span>
            </label>
            {fieldErrors.ageConfirmed18Plus && (
              <p id="ageConfirmed18Plus-error" role="alert" className="text-red-600 text-[11.5px] mt-1">
                {fieldErrors.ageConfirmed18Plus}
              </p>
            )}
          </div>
        )}

        <div className="mb-4">
          <GoogleSignInButton
            onClick={handleGoogleSignUp}
            loading={googleLoading}
            disabled={loading}
            label={isTeacher ? 'Sign up with Google as a teacher' : 'Sign up with Google'}
          />
          {isTeacher && (
            <p className="text-[11.5px] text-[#6E7280] mt-2 leading-[1.45]">
              You'll set your subject and province after signing in.
            </p>
          )}
          <div className="flex items-center gap-3 mt-4" aria-hidden="true">
            <span className="h-px flex-1 bg-[#E4E9F0]" />
            <span className="text-[11px] uppercase tracking-[1px] text-[#6E7280] font-medium">or use your email</span>
            <span className="h-px flex-1 bg-[#E4E9F0]" />
          </div>
        </div>

        {referralCode && (
          <div
            className="rounded-radius-md border border-emerald-200 bg-emerald-50 px-3 py-2 mb-3 text-xs text-emerald-900"
            role="status"
          >
            🎁 Joining with referral code <strong className="font-mono">{referralCode}</strong> — both
            you and the friend who invited you get a free month of Pro after signup.
          </div>
        )}

        {/* noValidate: our own validateFields drives friendly inline errors +
           scroll-to-first-invalid instead of the browser's native bubbles. */}
        <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
          <Field
            label="Full Name"
            id="displayName"
            value={form.displayName}
            onChange={set('displayName')}
            placeholder="Your full name"
            autoComplete="name"
            icon="👤"
            error={fieldErrors.displayName}
          />

          <Field
            label="Email address"
            id="email"
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="your@email.com"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            autoCapitalize="none"
            icon="✉"
            error={fieldErrors.email}
          />

          <div>
            <label htmlFor="password" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Password</label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={set('password')}
                required
                placeholder="Min 6 characters"
                autoComplete="new-password"
                aria-invalid={fieldErrors.password ? 'true' : undefined}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                className={`${INPUT_CLASS} pr-11 ${fieldErrors.password ? '!border-red-500' : ''}`}
              />
              <EyeBtn shown={showPw} onClick={() => setShowPw(v => !v)} />
            </div>
            {fieldErrors.password && (
              <p id="password-error" className="text-red-600 text-[11.5px] mt-1">{fieldErrors.password}</p>
            )}
            {/* Strength bars */}
            <div className="flex gap-1 mt-1.5">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className="h-[3px] flex-1 rounded-[3px] transition-colors"
                  style={{ background: i < score ? STRENGTH_COLORS[score - 1] : '#E4E9F0' }}
                />
              ))}
            </div>
            <p className={`text-[11px] mt-1 ${score >= 3 ? 'text-[#1E9E6B]' : 'text-[#6E7280]'}`}>
              {strengthHint}
            </p>
          </div>

          <div>
            <label htmlFor="confirm" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Confirm Password</label>
            <div className="relative">
              <input
                id="confirm"
                name="confirm"
                type={showConfirm ? 'text' : 'password'}
                value={form.confirm}
                onChange={set('confirm')}
                required
                placeholder="Repeat password"
                autoComplete="new-password"
                aria-invalid={fieldErrors.confirm ? 'true' : undefined}
                aria-describedby={fieldErrors.confirm ? 'confirm-error' : undefined}
                className={`${INPUT_CLASS} pr-11 ${fieldErrors.confirm ? '!border-red-500' : ''}`}
              />
              <EyeBtn shown={showConfirm} onClick={() => setShowConfirm(v => !v)} />
            </div>
            {fieldErrors.confirm && (
              <p id="confirm-error" className="text-red-600 text-[11.5px] mt-1">{fieldErrors.confirm}</p>
            )}
          </div>

          {!isParent && (
            <Field
              label="School Name"
              id="school"
              value={form.school}
              onChange={set('school')}
              placeholder="e.g. Lusaka Academy"
              autoComplete="organization"
              icon="🏫"
              error={fieldErrors.school}
            />
          )}

          {/* The learner's Grade dropdown used to sit here. It moved to the
              setup wizard's first step — see buildSchema above. */}

          {isTeacher && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="subject" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Subject</label>
                <div className="relative">
                  <select
                    id="subject"
                    name="subject"
                    value={form.subject}
                    onChange={set('subject')}
                    required
                    aria-invalid={fieldErrors.subject ? 'true' : undefined}
                    aria-describedby={fieldErrors.subject ? 'subject-error' : undefined}
                    className={`${SELECT_CLASS} ${fieldErrors.subject ? '!border-red-500' : ''}`}
                  >
                    <option value="">Select subject</option>
                    {TEACHER_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E7280] text-[13px] pointer-events-none" aria-hidden="true">▾</span>
                </div>
                {fieldErrors.subject && (
                  <p id="subject-error" className="text-red-600 text-[11.5px] mt-1">{fieldErrors.subject}</p>
                )}
              </div>
              <div>
                <label htmlFor="province" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Province</label>
                <div className="relative">
                  <select
                    id="province"
                    name="province"
                    value={form.province}
                    onChange={set('province')}
                    required
                    aria-invalid={fieldErrors.province ? 'true' : undefined}
                    aria-describedby={fieldErrors.province ? 'province-error' : undefined}
                    className={`${SELECT_CLASS} ${fieldErrors.province ? '!border-red-500' : ''}`}
                  >
                    <option value="">Province</option>
                    {ZAMBIAN_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E7280] text-[13px] pointer-events-none" aria-hidden="true">▾</span>
                </div>
                {fieldErrors.province && (
                  <p id="province-error" className="text-red-600 text-[11.5px] mt-1">{fieldErrors.province}</p>
                )}
              </div>
            </div>
          )}

          {error && (
            <p aria-live="polite" className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm" style={{ borderColor: 'var(--danger-fg)' }}>
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
          >
            {loading
              ? (isTeacher ? 'Submitting request…' : 'Creating account…')
              : (isTeacher ? 'Request Teacher Account' : 'Create Free Account')}
          </Button>
        </form>
        </>
        )}

        {step === STEP.AUTH && (
          <p className="text-[11.5px] text-[#6E7280] text-center mt-3 leading-[1.5]">
            By registering you agree to our{' '}
            <Link to="/terms" className="text-[var(--accent)] font-medium hover:underline">Terms of Service</Link>
            {' '}and{' '}
            <Link to="/privacy" className="text-[var(--accent)] font-medium hover:underline">Privacy Policy</Link>
          </p>
        )}

        {/* Once the account exists there is nothing left to sign in to — and
            offering "Already registered?" on the neutral age screen would put
            an escape hatch next to the one question we need answered. */}
        {(step === STEP.ROLE || step === STEP.AUTH) && (
          <p className="text-center text-[13px] text-[#6E7280] mt-4">
            Already registered?{' '}
            <Link to="/login" className="text-[var(--accent)] font-semibold hover:underline">
              Sign In
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}

/* ── helpers ─────────────────────────────────────────────── */

function RoleCard({ active, onClick, emoji, name, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'relative flex flex-col items-center gap-1 px-2.5 pt-4 pb-3 rounded-[14px] border-[1.5px] ' +
        'bg-white text-center select-none cursor-pointer transition-all hover:-translate-y-px hover:shadow-md ' +
        (active
          ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(198,123,79,0.10)] bg-[#FFF5EC]'
          : 'border-[#E4E9F0]')
      }
    >
      <span
        className={
          'absolute top-[9px] right-[9px] w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center text-[9px] font-bold transition-all ' +
          (active
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
            : 'border-[#E4E9F0] bg-white text-transparent')
        }
        aria-hidden="true"
      >
        ✓
      </span>
      <span className="text-[28px]" aria-hidden="true">{emoji}</span>
      <span className="text-[13.5px] font-semibold text-[#1A1F2E]">{name}</span>
      <span className="text-[11px] text-[#6E7280] leading-[1.35]">{hint}</span>
    </button>
  )
}

function Field({ label, id, icon, type = 'text', error, ...rest }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">{label}</label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={type}
          required
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${INPUT_CLASS} ${icon ? 'pr-11' : ''} ${error ? '!border-red-500' : ''}`}
          {...rest}
        />
        {icon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E7280] text-[15px] leading-none pointer-events-none" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-red-600 text-[11.5px] mt-1">{error}</p>
      )}
    </div>
  )
}

function EyeBtn({ shown, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={e => e.preventDefault()}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-lg text-[15px] leading-none select-none text-[#6E7280] hover:text-[#1A1F2E] transition-transform active:scale-90 bg-transparent shadow-none p-0 min-h-0"
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      tabIndex={-1}
    >
      <span aria-hidden="true">{shown ? '🙈' : '👁'}</span>
    </button>
  )
}

/**
 * How far through sign-up this is.
 *
 * Deliberately dumb — it is handed a position and a total and draws them. The
 * `aria-hidden` bar plus the readable "Step 2 of 4" is the pairing that works
 * in both directions: a sighted child gets the glance, a screen reader gets a
 * sentence instead of a decorative div.
 */
function SignupProgress({ index, total }) {
  if (!Number.isFinite(total) || total < 2) return null
  const pct = Math.round(((index + 1) / total) * 100)
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <div
        aria-hidden="true"
        className="flex-1 h-[6px] rounded-full bg-[#EDE7DF] overflow-hidden"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-black text-[#8A8378] whitespace-nowrap">
        Step {index + 1} of {total}
      </span>
    </div>
  )
}
