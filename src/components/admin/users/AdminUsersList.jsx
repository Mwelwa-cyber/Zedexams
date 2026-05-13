import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { collection, getDocs, query, where, limit } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import PageHeader from '../../ui/PageHeader'
import Card from '../../ui/Card'
import Button from '../../ui/Button'
import Icon from '../../ui/Icon'
import { Search, Download, ChevronRight } from '../../ui/icons'
import UserStatusBadge from './UserStatusBadge'
import { adminSetUserStatus } from '../../../utils/adminUsersService'
import { ADMIN_QUERY_LIMIT } from '../../../hooks/useFirestore'

const ROLE_LABELS = { admin: 'Admin', teacher: 'Teacher', learner: 'Learner', student: 'Learner' }

function downloadCSV(rows, filename) {
  const header = ['id', 'email', 'displayName', 'role', 'grade', 'school', 'status', 'createdAt']
  const csv = [
    header.join(','),
    ...rows.map(r => header.map(k => JSON.stringify(r[k] ?? '')).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmtDate(ts) {
  if (!ts) return '—'
  try {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
    if (!d || Number.isNaN(d.getTime?.())) return '—'
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

/**
 * AdminUsersList — unified user table for learners, teachers and admins.
 *
 * The `defaultRole` prop is used by the per-role routes (/admin/teachers,
 * /admin/admins) to lock the role filter so admins land directly on the
 * audience they expect. The `?status=suspended` query string can pre-fill
 * the status filter (used by the "Suspended" sidebar quick link).
 */
export default function AdminUsersList({ defaultRole = 'all' }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState(defaultRole)
  const [params] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(params.get('status') || 'all')
  const [busy, setBusy] = useState({})
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      try {
        const constraints = []
        if (defaultRole === 'teacher') constraints.push(where('role', '==', 'teacher'))
        else if (defaultRole === 'admin') constraints.push(where('role', '==', 'admin'))
        else if (defaultRole === 'learner') constraints.push(where('role', 'in', ['learner', 'student']))
        constraints.push(limit(ADMIN_QUERY_LIMIT))
        const snap = await getDocs(query(collection(db, 'users'), ...constraints))
        if (cancelled) return
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setUsers(rows)
        setError(null)
      } catch (e) {
        console.error('AdminUsersList load:', e)
        if (!cancelled) setError('Could not load users. Check your permissions and retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [defaultRole, location.key])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter(u => {
      if (roleFilter !== 'all' && defaultRole === 'all') {
        const matchesRole = roleFilter === 'learner'
          ? (u.role === 'learner' || u.role === 'student')
          : u.role === roleFilter
        if (!matchesRole) return false
      }
      if (statusFilter !== 'all') {
        const status = u.status || 'active'
        if (status !== statusFilter) return false
      }
      if (!term) return true
      const hay = `${u.email || ''} ${u.displayName || ''} ${u.school || ''}`.toLowerCase()
      return hay.includes(term)
    })
  }, [users, roleFilter, statusFilter, search, defaultRole])

  async function handleSuspend(uid, current) {
    if (busy[uid]) return
    const goal = current === 'suspended' ? 'active' : 'suspended'
    const reason = goal === 'suspended'
      ? (window.prompt('Optional reason for suspension (logged in the audit trail):') || '')
      : ''
    setBusy(b => ({ ...b, [uid]: true }))
    try {
      await adminSetUserStatus({ uid, status: goal, reason })
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, status: goal, suspendReason: reason } : u))
    } catch (e) {
      window.alert(`Could not update status: ${e.message || e}`)
    } finally {
      setBusy(b => ({ ...b, [uid]: false }))
    }
  }

  async function handleSoftDelete(uid) {
    if (busy[uid]) return
    if (!window.confirm('Soft-delete this user? They will lose access immediately. The record stays for audit; reverse with status=active.')) return
    setBusy(b => ({ ...b, [uid]: true }))
    try {
      await adminSetUserStatus({ uid, status: 'deleted', reason: 'soft delete by admin' })
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, status: 'deleted' } : u))
    } catch (e) {
      window.alert(`Could not delete: ${e.message || e}`)
    } finally {
      setBusy(b => ({ ...b, [uid]: false }))
    }
  }

  const titleByRole = {
    all: 'All users',
    teacher: 'Teachers',
    admin: 'Admins',
    learner: 'Learners',
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="User management"
        title={titleByRole[defaultRole]}
        description={defaultRole === 'all'
          ? 'View, search, suspend, and edit anyone with a ZedExams account.'
          : `${titleByRole[defaultRole]} only. Use All users to switch audience.`}
      />

      <Card variant="flat" size="md">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 relative">
            <Icon as={Search} size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, or school"
              className="theme-input w-full rounded-xl border theme-border pl-9 pr-3 py-2 text-sm"
            />
          </div>
          {defaultRole === 'all' && (
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="theme-input rounded-xl border theme-border px-3 py-2 text-sm font-bold"
            >
              <option value="all">All roles</option>
              <option value="learner">Learners</option>
              <option value="teacher">Teachers</option>
              <option value="admin">Admins</option>
            </select>
          )}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="theme-input rounded-xl border theme-border px-3 py-2 text-sm font-bold"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Deleted</option>
          </select>
          <Button
            variant="secondary"
            size="md"
            onClick={() => downloadCSV(filtered, 'zedexams-users.csv')}
            disabled={!filtered.length}
            leadingIcon={<Icon as={Download} size="sm" />}
          >
            Export CSV
          </Button>
        </div>
      </Card>

      {error && (
        <Card variant="flat" size="md" className="border-red-200 bg-red-50">
          <p className="text-sm font-bold text-red-700">{error}</p>
        </Card>
      )}

      <Card variant="flat" size="md" className="!p-0 overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-4 px-5 py-3 border-b theme-border text-[11px] font-black uppercase tracking-wider theme-text-muted">
          <span>User</span>
          <span>Role</span>
          <span>Grade</span>
          <span>Status</span>
          <span>Joined</span>
          <span className="text-right">Actions</span>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm theme-text-muted">Loading users…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm theme-text-muted">No users match these filters.</p>
        ) : (
          filtered.map(u => {
            const status = u.status || 'active'
            return (
              <div key={u.id} className="border-b theme-border last:border-b-0 px-5 py-3 grid grid-cols-1 md:grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-2 md:gap-4 items-center">
                <div className="min-w-0">
                  <p className="font-black theme-text truncate">{u.displayName || '—'}</p>
                  <p className="text-xs theme-text-muted truncate">{u.email}</p>
                </div>
                <div className="text-sm font-bold theme-text">{ROLE_LABELS[u.role] || u.role}</div>
                <div className="text-sm theme-text-muted">{u.grade ? `G${u.grade}` : '—'}</div>
                <div><UserStatusBadge status={status} /></div>
                <div className="text-xs theme-text-muted">{fmtDate(u.createdAt)}</div>
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <Link
                    to={`/admin/users/${u.id}`}
                    className="theme-bg-subtle theme-border hover:theme-accent-bg hover:theme-accent-text inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors"
                  >
                    Open
                    <Icon as={ChevronRight} size="xs" />
                  </Link>
                  {status !== 'deleted' && (
                    <button
                      onClick={() => handleSuspend(u.id, status)}
                      disabled={!!busy[u.id]}
                      className="bg-amber-100 text-amber-800 hover:bg-amber-200 rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-50"
                    >
                      {status === 'suspended' ? 'Unsuspend' : 'Suspend'}
                    </button>
                  )}
                  {status !== 'deleted' && (
                    <button
                      onClick={() => handleSoftDelete(u.id)}
                      disabled={!!busy[u.id]}
                      className="bg-red-100 text-red-700 hover:bg-red-200 rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </Card>

      <p className="text-xs theme-text-muted">
        Showing up to {ADMIN_QUERY_LIMIT} users at a time.
        For larger queries use the dedicated Reports section or the CSV export.
      </p>
    </div>
  )
}
