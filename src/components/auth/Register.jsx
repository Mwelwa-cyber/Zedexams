import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import GoogleSignInButton from './GoogleSignInButton'
import SeoHelmet from '../seo/SeoHelmet'

const FRIENDLY = {
  'auth/email-already-in-use': 'This email is already registered. Try logging in.',
  'auth/weak-password':        'Password must be at least 6 characters.',
  'auth/invalid-email':        'Please enter a valid email address.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/popup-blocked':        'Your browser blocked the Google sign-in popup. Please allow popups and try again.',
  'auth/account-exists-with-different-credential':
                               'An account already exists with this email. Sign in with the original method.',
}

const ZAMBIAN_PROVINCES = [
  'Central',
  'Copperbelt',
  'Eastern',
  'Luapula',
  'Lusaka',
  'Muchinga',
  'Northern',
  'North-Western',
  'Southern',
  'Western',
]

const TEACHER_SUBJECTS = [
  'Mathematics',
  'English',
  'Science',
  'Social Studies',
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
  const { register, loginWithGoogle, logout, ensureUserProfile } = useAuth()
  const navigate     = useNavigate()
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    confirm: '',
    grade: '',
    school: '',
    role: 'learner',
    province: '',
    subject: '',
  })
  const [showPw, setShowPw]           = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError]             = useState('')

  const isTeacher = form.role === 'teacher'
  const score = useMemo(() => passwordScore(form.password), [form.password])
  const strengthHint =
    form.password.length === 0 ? 'Enter at least 6 characters' :
    STRENGTH_MSGS[Math.max(0, score - 1)]

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  function pickRole(role) {
    setForm(f => ({ ...f, role }))
    setError('')
  }

  function validate() {
    if (!form.displayName.trim()) return 'Full name is required.'
    if (!form.email.trim())       return 'Email is required.'
    if (form.password.length < 6) return 'Password must be at least 6 characters.'
    if (form.password !== form.confirm) return 'Passwords do not match.'
    if (!form.school.trim())      return 'School name is required.'
    if (isTeacher) {
      if (!form.subject.trim())  return 'Please select a subject.'
      if (!form.province.trim()) return 'Please select a province.'
    } else {
      if (!form.grade.trim())    return 'Please select your grade.'
    }
    return ''
  }

  async function handleGoogleSignUp() {
    setError('')
    setGoogleLoading(true)
    try {
      const cred = await loginWithGoogle({ role: form.role })
      const profile = await ensureUserProfile(cred.user)
      if (!profile) {
        try { await logout() } catch { /* ignore secondary failure */ }
        setError('Signed in with Google, but we could not finish creating your ZedExams profile. Please try again or contact support.')
        return
      }
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      if (err.code === 'auth/cancelled-popup-request') return
      setError(FRIENDLY[err.code] ?? 'Google sign-in failed. Please try again.')
    } finally { setGoogleLoading(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const message = validate()
    if (message) { setError(message); return }

    setError(''); setLoading(true)
    try {
      const cred = await register(
        form.email.trim(),
        form.password,
        form.displayName.trim(),
        form.grade,
        form.school.trim(),
        form.role,
        isTeacher ? { province: form.province, subject: form.subject } : {},
      )
      // Wait for the profile we just wrote to be picked up into context state
      // before navigating, so the landing page sees a populated userProfile
      // instead of racing the onAuthStateChanged listener.
      const profile = await ensureUserProfile(cred.user)
      if (!profile) {
        try { await logout() } catch { /* ignore secondary failure */ }
        setError('Account created, but we could not finish loading your ZedExams profile. Please sign in again.')
        return
      }
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      const friendly = FRIENDLY[err.code] ?? err.message ?? 'Registration failed. Please try again.'
      setError(friendly)
    } finally { setLoading(false) }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{
        backgroundColor: '#FDF6EC',
        '--accent': '#EA580C',
        '--accent-bg': '#FFEDD5',
        '--accent-fg': '#9A3412',
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

      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[400px] sm:max-w-[520px] px-8 pt-9 pb-8 animate-scale-in relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-2.5 gap-1">
          <Logo variant="full" size="md" />
          <p className="text-[12px] text-[#999] font-body">Practise smart.</p>
        </div>

        <div className="text-center mb-6">
          <h2 className="text-[20px] font-bold text-[#1A1F2E]">Create account</h2>
          <p className="text-[13px] text-[#888] mt-1">First — who's joining us today?</p>
        </div>

        {/* Role picker */}
        <div className="text-[10.5px] font-bold uppercase tracking-[1px] text-[#aaa] text-center mb-2.5">
          I am a
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <RoleCard
            active={!isTeacher}
            onClick={() => pickRole('learner')}
            emoji="🎓"
            name="Learner"
            hint={<>Grades 4–6<br />Exam practice</>}
          />
          <RoleCard
            active={isTeacher}
            onClick={() => pickRole('teacher')}
            emoji="👩‍🏫"
            name="Teacher"
            hint={<>Lesson plans<br />&amp; teaching tools</>}
          />
        </div>

        {/* Context strip */}
        <div
          className="flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 mb-4 min-h-[38px] border"
          style={
            isTeacher
              ? { background: '#EBF5F1', borderColor: 'rgba(28,100,70,0.2)' }
              : { background: '#FFF5EC', borderColor: 'rgba(232,135,42,0.25)' }
          }
        >
          <span className="text-[14px] flex-shrink-0" aria-hidden="true">{isTeacher ? '📚' : '📚'}</span>
          <span
            className="text-[12.5px] font-medium"
            style={{ color: isTeacher ? '#1C6446' : '#C96E1C' }}
          >
            {isTeacher
              ? 'Access lesson plans, schemes of work & teaching tools'
              : "You'll get access to Grade 4–6 quizzes & exam practice"}
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
            <p className="text-[11.5px] text-[#888] mt-2 leading-[1.45]">
              You'll set your subject and province after signing in.
            </p>
          )}
          <div className="flex items-center gap-3 mt-4" aria-hidden="true">
            <span className="h-px flex-1 bg-[#E4E9F0]" />
            <span className="text-[11px] uppercase tracking-[1px] text-[#aaa] font-medium">or use your email</span>
            <span className="h-px flex-1 bg-[#E4E9F0]" />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <Field
            label="Full Name"
            id="displayName"
            value={form.displayName}
            onChange={set('displayName')}
            placeholder="Your full name"
            autoComplete="name"
            icon="👤"
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
                className={`${INPUT_CLASS} pr-11`}
              />
              <EyeBtn shown={showPw} onClick={() => setShowPw(v => !v)} />
            </div>
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
            <p className={`text-[11px] mt-1 ${score >= 3 ? 'text-[#1E9E6B]' : 'text-[#aaa]'}`}>
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
                className={`${INPUT_CLASS} pr-11`}
              />
              <EyeBtn shown={showConfirm} onClick={() => setShowConfirm(v => !v)} />
            </div>
          </div>

          <Field
            label="School Name"
            id="school"
            value={form.school}
            onChange={set('school')}
            placeholder="e.g. Lusaka Academy"
            autoComplete="organization"
            icon="🏫"
          />

          {!isTeacher && (
            <div>
              <label htmlFor="grade" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Grade</label>
              <div className="relative">
                <select
                  id="grade"
                  name="grade"
                  value={form.grade}
                  onChange={set('grade')}
                  required
                  className={SELECT_CLASS}
                >
                  <option value="">Select your grade</option>
                  <option value="4">Grade 4</option>
                  <option value="5">Grade 5</option>
                  <option value="6">Grade 6</option>
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aaa] text-[13px] pointer-events-none" aria-hidden="true">▾</span>
              </div>
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
                    className={SELECT_CLASS}
                  >
                    <option value="">Select subject</option>
                    {TEACHER_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aaa] text-[13px] pointer-events-none" aria-hidden="true">▾</span>
                </div>
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
                    className={SELECT_CLASS}
                  >
                    <option value="">Province</option>
                    {ZAMBIAN_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aaa] text-[13px] pointer-events-none" aria-hidden="true">▾</span>
                </div>
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

        <p className="text-[11.5px] text-[#aaa] text-center mt-3 leading-[1.5]">
          By registering you agree to our{' '}
          <Link to="/terms" className="text-[var(--accent)] font-medium hover:underline">Terms of Service</Link>
          {' '}and{' '}
          <Link to="/privacy" className="text-[var(--accent)] font-medium hover:underline">Privacy Policy</Link>
        </p>

        <p className="text-center text-[13px] text-[#888] mt-4">
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
          ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(232,135,42,0.10)] bg-[#FFF5EC]'
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
      <span className="text-[11px] text-[#888] leading-[1.35]">{hint}</span>
    </button>
  )
}

function Field({ label, id, icon, type = 'text', ...rest }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">{label}</label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={type}
          required
          className={`${INPUT_CLASS} ${icon ? 'pr-11' : ''}`}
          {...rest}
        />
        {icon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aaa] text-[15px] leading-none pointer-events-none" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
    </div>
  )
}

function EyeBtn({ shown, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={e => e.preventDefault()}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-lg text-[15px] leading-none select-none text-[#aaa] hover:text-[#1A1F2E] transition-transform active:scale-90 bg-transparent shadow-none p-0 min-h-0"
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      tabIndex={-1}
    >
      <span aria-hidden="true">{shown ? '🙈' : '👁'}</span>
    </button>
  )
}
