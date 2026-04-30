import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../ui/Logo'
import Button from '../ui/Button'

const FRIENDLY = {
  'auth/email-already-in-use': 'This email is already registered. Try logging in.',
  'auth/weak-password':        'Password must be at least 6 characters.',
  'auth/invalid-email':        'Please enter a valid email address.',
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

export default function Register() {
  const { register } = useAuth()
  const navigate     = useNavigate()
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    confirm: '',
    grade: '4',
    school: '',
    role: 'learner',
    province: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    document.title = 'Create Account — ZedExams'
  }, [])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  function validateTeacherFields() {
    if (!form.displayName.trim()) return 'Full name is required.'
    if (!form.school.trim()) return 'School name is required.'
    if (!form.province.trim()) return 'Please select a province.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    if (form.password.length < 6)       { setError('Password must be at least 6 characters.'); return }
    const isTeacherSignup = form.role === 'teacher'
    const teacherError = isTeacherSignup ? validateTeacherFields() : ''
    if (teacherError) { setError(teacherError); return }

    setError(''); setLoading(true)
    try {
      await register(
        form.email.trim(),
        form.password,
        form.displayName.trim(),
        form.grade,
        form.school.trim(),
        form.role,
        isTeacherSignup ? { province: form.province } : {},
      )
      navigate(getRoleLandingPath(form.role), { replace: true })
    } catch (err) {
      const message = FRIENDLY[err.code] ?? err.message ?? 'Registration failed. Please try again.'
      setError(message)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-4">
      {/* Subtle decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
      </div>
      <div className="theme-card rounded-3xl shadow-xl border theme-border w-full max-w-sm p-8 animate-scale-in relative z-10">
        <div className="flex flex-col items-center mb-6">
          <Logo variant="full" size="lg" />
          <h1 className="text-display-md theme-text mt-3">Create account</h1>
          <p className="theme-text-muted text-body-sm mt-0.5">Join ZedExams for free</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {[
            { label: 'Full Name', field: 'displayName', type: 'text', placeholder: 'Your full name', autoComplete: 'name' },
            { label: 'Email', field: 'email', type: 'email', placeholder: 'your@email.com', autoComplete: 'email', inputMode: 'email', spellCheck: false, autoCapitalize: 'none' },
            { label: 'Password', field: 'password', type: 'password', placeholder: 'Min 6 characters', autoComplete: 'new-password' },
            { label: 'Confirm Password', field: 'confirm', type: 'password', placeholder: 'Repeat password', autoComplete: 'new-password' },
            { label: 'School Name', field: 'school', type: 'text', placeholder: 'e.g. Lusaka Academy', autoComplete: 'organization' },
          ].map(f => (
            <div key={f.field}>
              <label htmlFor={f.field} className="block text-xs font-bold theme-text mb-1">{f.label}</label>
              <input id={f.field} name={f.field} type={f.type} value={form[f.field]} onChange={set(f.field)} required placeholder={f.placeholder}
                autoComplete={f.autoComplete} inputMode={f.inputMode} spellCheck={f.spellCheck} autoCapitalize={f.autoCapitalize}
                className="w-full border-2 rounded-xl px-3 py-2.5 text-base focus:border-green-500 focus:outline-none transition-colors theme-input" />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div>
                <label htmlFor="role" className="block text-xs font-bold theme-text mb-1">I am a…</label>
              <select id="role" name="role" value={form.role} onChange={set('role')}
                className="w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none theme-input transition-colors">
                <option value="learner">Learner</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>
            {form.role === 'learner' && (
              <div>
                <label htmlFor="grade" className="block text-xs font-bold theme-text mb-1">Grade</label>
                <select id="grade" name="grade" value={form.grade} onChange={set('grade')}
                  className="w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none theme-input transition-colors">
                  <option value="4">Grade 4</option>
                  <option value="5">Grade 5</option>
                  <option value="6">Grade 6</option>
                </select>
              </div>
            )}
          </div>

          {form.role === 'teacher' && (
            <div>
              <label htmlFor="province" className="block text-xs font-bold theme-text mb-1">Province</label>
              <select id="province" name="province" value={form.province} onChange={set('province')} required
                className="w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none theme-input transition-colors">
                <option value="">Select your province</option>
                {ZAMBIAN_PROVINCES.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p aria-live="polite" className="text-danger bg-danger-subtle border rounded-xl px-3 py-2 text-body-sm" style={{ borderColor: 'var(--danger-fg)' }}>
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
            {loading ? 'Creating account…' : 'Create Free Account'}
          </Button>
        </form>

        <p className="text-center text-sm theme-text-muted mt-4">
          Already registered?{' '}
          <Link to="/login" className="text-green-600 font-black hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
