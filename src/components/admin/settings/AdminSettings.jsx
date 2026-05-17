import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import PageHeader from '../../ui/PageHeader'
import Card from '../../ui/Card'
import Button from '../../ui/Button'

const FIELDS = [
  { key: 'siteName', label: 'Site name', type: 'text' },
  { key: 'supportEmail', label: 'Support email', type: 'email' },
  { key: 'maintenanceMessage', label: 'Maintenance message', type: 'textarea' },
  { key: 'maxExamAttemptsPerDay', label: 'Max exam attempts per day', type: 'number', min: 0, max: 20 },
  { key: 'defaultGrade', label: 'Default grade', type: 'select', options: ['4', '5', '6', '7'] },
  { key: 'defaultTheme', label: 'Default theme', type: 'select', options: ['sky', 'lavender', 'midnight', 'oatmeal', 'vivid', 'solar'] },
]

const DEFAULTS = {
  siteName: 'ZedExams',
  supportEmail: 'support@zedexams.com',
  maintenanceMode: false,
  maintenanceMessage: '',
  registrationOpen: true,
  maxExamAttemptsPerDay: 3,
  defaultGrade: '7',
  defaultTheme: 'oatmeal',
}

export default function AdminSettings() {
  const { currentUser } = useAuth()
  const [form, setForm] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'global'))
        if (cancelled) return
        if (snap.exists()) setForm({ ...DEFAULTS, ...snap.data() })
      } catch (e) {
        console.error('settings load:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        ...form,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
      }, { merge: true })
      setMsg('✅ Settings saved.')
    } catch (err) {
      setMsg(`❌ Could not save: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="px-4 py-8 text-sm theme-text-muted">Loading settings…</p>

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Platform settings"
        description="Site-wide configuration. Changes apply immediately to every connected client."
      />

      <form onSubmit={handleSave} className="space-y-5">
        <Card variant="elevated" size="md" className="space-y-4">
          <h2 className="text-eyebrow">General</h2>
          {FIELDS.filter(f => ['siteName', 'supportEmail'].includes(f.key)).map(field => (
            <FieldRow key={field.key} field={field} value={form[field.key]} onChange={v => set(field.key, v)} />
          ))}
        </Card>

        <Card variant="elevated" size="md" className="space-y-4">
          <h2 className="text-eyebrow">Access</h2>
          <Toggle
            label="Registration open"
            description="New learners and teachers can self-register."
            value={!!form.registrationOpen}
            onChange={v => set('registrationOpen', v)}
          />
          <Toggle
            label="Maintenance mode"
            description="Shows a banner across the platform and blocks non-admin sign-in flows from completing."
            value={!!form.maintenanceMode}
            onChange={v => set('maintenanceMode', v)}
          />
          {FIELDS.filter(f => f.key === 'maintenanceMessage').map(field => (
            <FieldRow key={field.key} field={field} value={form[field.key]} onChange={v => set(field.key, v)} />
          ))}
        </Card>

        <Card variant="elevated" size="md" className="space-y-4">
          <h2 className="text-eyebrow">Limits & defaults</h2>
          {FIELDS.filter(f => ['maxExamAttemptsPerDay', 'defaultGrade', 'defaultTheme'].includes(f.key)).map(field => (
            <FieldRow key={field.key} field={field} value={form[field.key]} onChange={v => set(field.key, v)} />
          ))}
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {msg && <p className="text-sm font-bold theme-text-muted">{msg}</p>}
        </div>
      </form>
    </div>
  )
}

function FieldRow({ field, value, onChange }) {
  const id = `setting-${field.key}`
  if (field.type === 'textarea') {
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-black uppercase tracking-wider theme-text-muted mb-1">{field.label}</label>
        <textarea
          id={id}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm"
          rows={3}
        />
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-black uppercase tracking-wider theme-text-muted mb-1">{field.label}</label>
        <select
          id={id}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm font-bold"
        >
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-black uppercase tracking-wider theme-text-muted mb-1">{field.label}</label>
      <input
        id={id}
        type={field.type}
        value={value ?? ''}
        min={field.min}
        max={field.max}
        onChange={e => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
        className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm"
      />
    </div>
  )
}

function Toggle({ label, description, value, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="block font-bold theme-text">{label}</span>
        <span className="block text-xs theme-text-muted">{description}</span>
      </span>
    </label>
  )
}
