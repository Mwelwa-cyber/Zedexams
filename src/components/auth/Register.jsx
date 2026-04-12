import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'

const FRIENDLY = {
  'auth/email-already-in-use': 'This email is already registered. Try logging in.',
  'auth/weak-password':        'Password must be at least 6 characters.',
  'auth/invalid-email':        'Please enter a valid email address.',
}

export default function Register() {
  const { register } = useAuth()
  const navigate     = useNavigate()
  const [form, setForm] = useState({ displayName: '', email: '', password: '', confirm: '', grade: '4', school: '', role: 'learner' })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    if (form.password.length < 6)       { setError('Password must be at least 6 characters.'); return }
    setError(''); setLoading(true)
    try {
      await register(form.email.trim(), form.password, form.displayName.trim(), form.grade, form.school.trim(), form.role)
      // RootRedirect will send learners → /dashboard, teachers → /teacher
      navigate('/')
    } catch (err) {
      setError(FRIENDLY[err.code] ?? 'Registration failed. Please try again.')
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
          <h1 className="text-lg font-black theme-text mt-3">Create Account</h1>
          <p className="theme-text-muted text-sm mt-0.5">Join ExamPrep Zambia for free</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {[
            { label: 'Full Name', field: 'displayName', type: 'text', placeholder: 'Your full name' },
            { label: 'Email',     field: 'email',       type: 'email', placeholder: 'your@email.com' },
            { label: 'Password',  field: 'password',    type: 'password', placeholder: 'Min 6 characters' },
            { label: 'Confirm Password', field: 'confirm', type: 'password', placeholder: 'Repeat password' },
            { label: 'School Name', field: 'school',    type: 'text', placeholder: 'e.g. Lusaka Academy' },
          ].map(f => (
            <div key={f.field}>
              <label className="block text-xs font-bold theme-text mb-1">{f.label}</label>
              <input type={f.type} value={form[f.field]} onChange={set(f.field)} required placeholder={f.placeholder}
                className="w-full border-2 rounded-xl px-3 py-2.5 text-base focus:border-green-500 focus:outline-none transition-colors theme-input" />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold theme-text mb-1">I am a…</label>
              <select value={form.role} onChange={set('role')}
                className="w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none theme-input transition-colors">
                <option value="learner">Learner</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>
            {form.role === 'learner' && (
              <div>
                <label className="block text-xs font-bold theme-text mb-1">Grade</label>
                <select value={form.grade} onChange={set('grade')}
                  className="w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none theme-input transition-colors">
                  <option value="4">Grade 4</option>
                  <option value="5">Grade 5</option>
                  <option value="6">Grade 6</option>
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-base py-3.5 rounded-2xl shadow-md transition-colors">
            {loading ? 'Creating account…' : 'Create Free Account'}
          </button>
        </form>

        <p className="text-center text-sm theme-text-muted mt-4">
          Already registered?{' '}
          <Link to="/login" className="text-green-600 font-black hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
