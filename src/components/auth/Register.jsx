import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import { captureReferralFromUrl } from '../../utils/referrals'
import { friendlyAuthMessage } from '../../utils/friendlyErrors'
import { assessAction, shouldBlock } from '../../utils/recaptcha'
import { validateFields, hasErrors, focusFirstError } from '../../utils/formValidation'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import GoogleSignInButton from './GoogleSignInButton'
import SeoHelmet from '../seo/SeoHelmet'
import { ZAMBIAN_PROVINCES } from '../../config/zambia'
import AgeGateStep from './AgeGateStep'

// Auth-error copy is centralised in src/utils/friendlyErrors.js
// (friendlyAuthMessage with flow: 'signup') so Login + Register share one
// source of truth. The sign-up phrasing of the native Google failures lives
// there too.

const TEACHER_SUBJECTS = [
  'English',
  'Integrated Science',
  'Mathematics',
  'Social Studies',
  'Expressive Art',
  'Technology Studies',
  'Cinyanja',
  'Home Economics',
  'Other',
]

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

export default function Register() {
  const { register, loginWithGoogle, ensureUserProfile } = useAuth()
  const navigate     = useNavigate()
  const [searchParams] = useSearchParams()
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
  })
  // Age gate (Play Families policy). It runs BEFORE the account-details form
  // — a mixed-audience app must route by age before it collects anything —
  // and its result is carried here until register() writes it.
  //   null            → the age screen is still showing
  //   {dob, guardian} → answered; guardian is null for an adult
  const [ageResult, setAgeResult] = useState(null)
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
      ...(isLearner ? { grade: ['required'] } : {}),
    }
  }

  async function handleGoogleSignUp() {
    setError('')
    setGoogleLoading(true)
    try {
      const cred = await loginWithGoogle({ role: form.role })
      const profile = await ensureUserProfile(cred.user)
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
          // The age screen ran before this form, so these are always present.
          // register() derives isMinor from the DOB via the shared consent
          // core rather than trusting a flag the client computed.
          dob: ageResult?.dob || null,
          guardian: ageResult?.guardian || null,
        },
      )
      // A fresh email/password signup is always unverified at this instant —
      // the dashboard is gated behind verification, so land directly on the
      // verification page. Warm the profile read in the background so the
      // dashboard is ready the moment they verify (failure is fine:
      // AuthContext's onSnapshot listener populates it on its own).
      ensureUserProfile(cred.user).catch(() => null)
      navigate('/verify-email', { replace: true })
    } catch (err) {
      // Never echo a raw Firebase message to the learner — map the code, and
      // fall back to calm generic copy when it's unmapped.
      setError(friendlyAuthMessage(err.code, { flow: 'signup', online: navigator.onLine }))
    } finally { setLoading(false) }
  }

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

        <div className="text-center mb-6">
          <h2 className="text-[20px] font-bold text-[#1A1F2E]">Create account</h2>
          <p className="text-[13px] text-[#6E7280] mt-1">First — who's joining us today?</p>
        </div>

        {/* Role picker */}
        <div className="text-[10.5px] font-bold uppercase tracking-[1px] text-[#6E7280] text-center mb-2.5">
          I am a
        </div>
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <RoleCard
            active={isLearner}
            onClick={() => pickRole('learner')}
            emoji="🎓"
            name="Learner"
            hint={<>Grades 4–7<br />Exam practice</>}
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
                : "You'll get access to Grade 4–7 quizzes & exam practice"}
          </span>
        </div>

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

        {/* Age gate first. A mixed-audience app must route by age BEFORE it
            collects an account, and the screen has to stay neutral — so it
            renders instead of the form rather than alongside it, with nothing
            on it hinting what a younger answer leads to. */}
        {!ageResult ? (
          <AgeGateStep
            onAdult={({ dob }) => setAgeResult({ dob, guardian: null })}
            onChild={({ dob, guardian }) => setAgeResult({ dob, guardian })}
          />
        ) : (
        /* noValidate: our own validateFields drives friendly inline errors +
           scroll-to-first-invalid instead of the browser's native bubbles. */
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

          {isLearner && (
            <div>
              <label htmlFor="grade" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Grade</label>
              <div className="relative">
                <select
                  id="grade"
                  name="grade"
                  value={form.grade}
                  onChange={set('grade')}
                  required
                  aria-invalid={fieldErrors.grade ? 'true' : undefined}
                  aria-describedby={fieldErrors.grade ? 'grade-error' : undefined}
                  className={`${SELECT_CLASS} ${fieldErrors.grade ? '!border-red-500' : ''}`}
                >
                  <option value="">Select your grade</option>
                  <option value="4">Grade 4</option>
                  <option value="5">Grade 5</option>
                  <option value="6">Grade 6</option>
                  <option value="7">Grade 7</option>
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E7280] text-[13px] pointer-events-none" aria-hidden="true">▾</span>
              </div>
              {fieldErrors.grade && (
                <p id="grade-error" className="text-red-600 text-[11.5px] mt-1">{fieldErrors.grade}</p>
              )}
            </div>
          )}

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
        )}

        <p className="text-[11.5px] text-[#6E7280] text-center mt-3 leading-[1.5]">
          By registering you agree to our{' '}
          <Link to="/terms" className="text-[var(--accent)] font-medium hover:underline">Terms of Service</Link>
          {' '}and{' '}
          <Link to="/privacy" className="text-[var(--accent)] font-medium hover:underline">Privacy Policy</Link>
        </p>

        <p className="text-center text-[13px] text-[#6E7280] mt-4">
          Already registered?{' '}
          <Link to="/login" className="text-[var(--accent)] font-semibold hover:underline">
            Sign In
          </Link>
        </p>
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
