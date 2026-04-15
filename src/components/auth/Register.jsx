import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { storage } from '../../firebase/config'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../ui/Logo'

const FRIENDLY = {
  'auth/email-already-in-use': 'This email is already registered. Try logging in.',
  'auth/weak-password':        'Password must be at least 6 characters.',
  'auth/invalid-email':        'Please enter a valid email address.',
}

const MAX_PROOF_SIZE = 10 * 1024 * 1024
const ALLOWED_PROOF_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function safeFileName(name) {
  const cleaned = String(name || 'teacher-proof')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, 90) || 'teacher-proof'
}

export default function Register() {
  const { register } = useAuth()
  const { submitTeacherApplication } = useFirestore()
  const navigate     = useNavigate()
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    confirm: '',
    grade: '4',
    school: '',
    role: 'learner',
    phone: '',
    nrc: '',
  })
  const [proofFile, setProofFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  function handleProofChange(e) {
    const file = e.target.files?.[0] || null
    setProofFile(file)
  }

  function validateTeacherFields() {
    if (!form.displayName.trim()) return 'Full name is required.'
    if (!form.school.trim()) return 'School name is required.'
    if (!form.phone.trim()) return 'Phone number is required.'
    if (!/^[+0-9()\s-]{7,24}$/.test(form.phone.trim())) return 'Enter a valid phone number.'
    if (!form.nrc.trim()) return 'NRC number is required.'
    if (!/^[0-9/\-\s]{6,24}$/.test(form.nrc.trim())) return 'Enter a valid NRC number.'
    if (!proofFile) return 'Upload a teaching certificate or school proof document.'
    if (!ALLOWED_PROOF_TYPES.has(proofFile.type)) return 'Upload a PDF, image, or DOCX proof document.'
    if (proofFile.size > MAX_PROOF_SIZE) return 'Proof document must be 10MB or smaller.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    if (form.password.length < 6)       { setError('Password must be at least 6 characters.'); return }
    const isTeacherSignup = form.role === 'teacher'
    const teacherError = isTeacherSignup ? validateTeacherFields() : ''
    if (teacherError) { setError(teacherError); return }

    setError(''); setSuccess(''); setLoading(true)
    let accountCreated = false
    try {
      const cred = await register(form.email.trim(), form.password, form.displayName.trim(), form.grade, form.school.trim(), form.role)
      accountCreated = true

      if (isTeacherSignup) {
        const proofPath = `teacher-verification/${cred.user.uid}/${Date.now()}-${safeFileName(proofFile.name)}`
        await uploadBytes(storageRef(storage, proofPath), proofFile, { contentType: proofFile.type })
        await submitTeacherApplication(cred.user.uid, {
          email: form.email.trim(),
          fullName: form.displayName.trim(),
          phoneNumber: form.phone.trim(),
          schoolName: form.school.trim(),
          nrcNumber: form.nrc.trim(),
          proofPath,
          proofFileName: proofFile.name,
          proofContentType: proofFile.type,
          proofSize: proofFile.size,
        })
        setSuccess('Teacher application submitted. You can use learner features while an admin reviews it.')
        setTimeout(() => navigate(getRoleLandingPath('learner'), { replace: true }), 1200)
      } else {
        navigate(getRoleLandingPath('learner'), { replace: true })
      }
    } catch (err) {
      const message = FRIENDLY[err.code] ?? err.message ?? 'Registration failed. Please try again.'
      setError(accountCreated && isTeacherSignup
        ? `${message} Your account was created as a learner, but the teacher application was not completed.`
        : message)
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
          <p className="theme-text-muted text-sm mt-0.5">Join ZedExams for free</p>
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
            <div className="rounded-2xl border-2 border-blue-100 bg-blue-50 p-4 space-y-3">
              <div>
                <p className="text-sm font-black text-blue-900">Teacher verification</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Teacher access starts after admin approval. Until then, your account stays as a learner.
                </p>
              </div>

              <div>
                <label htmlFor="phone" className="block text-xs font-bold text-blue-900 mb-1">Phone Number</label>
                <input id="phone" name="phone" type="tel" value={form.phone} onChange={set('phone')} required={form.role === 'teacher'} placeholder="e.g. 0968 123 456"
                  autoComplete="tel" inputMode="tel"
                  className="w-full border-2 rounded-xl px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none transition-colors theme-input" />
              </div>

              <div>
                <label htmlFor="nrc" className="block text-xs font-bold text-blue-900 mb-1">NRC Number</label>
                <input id="nrc" name="nrc" type="text" value={form.nrc} onChange={set('nrc')} required={form.role === 'teacher'} placeholder="e.g. 123456/78/9"
                  autoComplete="off"
                  className="w-full border-2 rounded-xl px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none transition-colors theme-input" />
              </div>

              <div>
                <label htmlFor="proof-file" className="block text-xs font-bold text-blue-900 mb-1">Teaching Certificate or School Proof</label>
                <input id="proof-file" name="proofFile" type="file" onChange={handleProofChange} required={form.role === 'teacher'} accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
                  className="w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none transition-colors theme-input file:mr-3 file:rounded-lg file:border-0 file:bg-blue-100 file:px-3 file:py-1.5 file:text-xs file:font-black file:text-blue-700" />
                <p className="text-xs text-blue-700 mt-1">PDF, image, or DOCX. Maximum 10MB.</p>
              </div>
            </div>
          )}

          {error && <p aria-live="polite" className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          {success && <p aria-live="polite" className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-xl px-3 py-2">{success}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-base py-3.5 rounded-2xl shadow-md transition-colors">
            {loading
              ? form.role === 'teacher' ? 'Submitting application…' : 'Creating account…'
              : form.role === 'teacher' ? 'Submit Teacher Application' : 'Create Free Account'}
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
