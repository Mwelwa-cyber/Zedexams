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
  const [form, setForm] = useState({ displayName: '', email: '', password: '', confirm: '', grade: '5', school: '', role: 'learner' })
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
      navigate('/dashboard')
    } catch (err) {
      setError(FRIENDLY[err.code] ?? 'Registration failed. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-green-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 animate-scale-in">
        <div className="flex flex-col items-center mb-6">
          <Logo size="md" variant="full" dark={true} />
          <h1 className="text-lg font-black text-gray-700 mt-3">Create Account</h1>
          <p className="text-gray-400 text-sm mt-0.5">Join ExamPrep Zambia for free</p>
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
              <label className="block text-xs font-bold text-gray-700 mb-1">{f.label}</label>
              <input type={f.type} value={form[f.field]} onChange={set(f.field)} required placeholder={f.placeholder}
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-base focus:border-green-500 focus:outline-none" />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">I am a…</label>
              <select value={form.role} onChange={set('role')}
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none">
                <option value="learner">Learner</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>
            {form.role === 'learner' && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Grade</label>
                <select value={form.grade} onChange={set('grade')}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none">
                  <option value="5">Grade 5</option>
                  <option value="6">Grade 6</option>
                  <option value="7">Grade 7</option>
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-base py-3.5 rounded-2xl shadow-md transition-colors">
            {loading ? '⏳ Creating account…' : '🎉 Create Free Account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          Already registered?{' '}
          <Link to="/login" className="text-green-600 font-black hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
