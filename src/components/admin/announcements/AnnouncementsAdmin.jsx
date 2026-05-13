import { useEffect, useState } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import PageHeader from '../../ui/PageHeader'
import Card from '../../ui/Card'
import Button from '../../ui/Button'

const SEVERITIES = ['info', 'warn', 'success']
const AUDIENCES = ['all', 'learners', 'teachers', 'admins']

function fmt(ts) {
  if (!ts) return '—'
  try {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
    if (Number.isNaN(d.getTime?.())) return '—'
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

const EMPTY = {
  title: '',
  body: '',
  severity: 'info',
  audience: 'all',
  active: true,
}

export default function AnnouncementsAdmin() {
  const { currentUser } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [msg, setMsg] = useState('')

  async function reload() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')))
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) {
      console.error('announcements load:', e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [])

  function set(key, value) { setForm(f => ({ ...f, [key]: value })) }

  function startEdit(item) {
    setEditingId(item.id)
    setForm({
      title: item.title || '',
      body: item.body || '',
      severity: item.severity || 'info',
      audience: item.audience || 'all',
      active: !!item.active,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY)
    setMsg('')
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.title.trim()) { setMsg('Title is required.'); return }
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        severity: form.severity,
        audience: form.audience,
        active: !!form.active,
        updatedAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
      }
      if (editingId) {
        await updateDoc(doc(db, 'announcements', editingId), payload)
      } else {
        await addDoc(collection(db, 'announcements'), { ...payload, createdAt: serverTimestamp() })
      }
      cancelEdit()
      reload()
    } catch (err) {
      setMsg(`❌ ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item) {
    try {
      await updateDoc(doc(db, 'announcements', item.id), { active: !item.active })
      reload()
    } catch (err) {
      window.alert(err.message || err)
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"?`)) return
    try {
      await deleteDoc(doc(db, 'announcements', item.id))
      reload()
    } catch (err) {
      window.alert(err.message || err)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Announcements"
        description="Publish banner messages to learners, teachers, or admins. Active announcements show across the platform."
      />

      <Card variant="elevated" size="md">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-black uppercase tracking-wider theme-text-muted mb-1">Title</label>
              <input
                value={form.title}
                onChange={e => set('title', e.target.value)}
                className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm"
                placeholder="e.g. Exams server maintenance Friday"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-black uppercase tracking-wider theme-text-muted mb-1">Body</label>
              <textarea
                value={form.body}
                onChange={e => set('body', e.target.value)}
                rows={3}
                className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-wider theme-text-muted mb-1">Severity</label>
              <select value={form.severity} onChange={e => set('severity', e.target.value)} className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm font-bold">
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-wider theme-text-muted mb-1">Audience</label>
              <select value={form.audience} onChange={e => set('audience', e.target.value)} className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm font-bold">
                {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <label className="md:col-span-2 inline-flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
              Active (visible to the audience)
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update announcement' : 'Publish announcement'}
            </Button>
            {editingId && <Button type="button" variant="secondary" onClick={cancelEdit}>Cancel</Button>}
            {msg && <p className="text-sm font-bold theme-text-muted">{msg}</p>}
          </div>
        </form>
      </Card>

      <Card variant="flat" size="md" className="!p-0 overflow-hidden">
        <div className="px-5 py-3 border-b theme-border text-xs font-black uppercase tracking-wider theme-text-muted">
          Published announcements
        </div>
        {loading ? (
          <p className="px-5 py-8 text-sm theme-text-muted text-center">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-sm theme-text-muted text-center">No announcements yet.</p>
        ) : (
          items.map(item => (
            <div key={item.id} className="border-b theme-border last:border-b-0 px-5 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="min-w-0">
                <p className="font-black theme-text">{item.title}</p>
                <p className="text-xs theme-text-muted truncate">{item.body || '—'}</p>
                <p className="text-[11px] mt-1 theme-text-muted">
                  {fmt(item.createdAt)} · {item.audience} · {item.severity} · {item.active ? 'active' : 'inactive'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => handleToggle(item)}>
                  {item.active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => startEdit(item)}>Edit</Button>
                <Button variant="secondary" size="sm" onClick={() => handleDelete(item)}>Delete</Button>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
