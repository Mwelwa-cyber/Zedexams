import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { PLANS, hasPremiumAccess } from '../../utils/subscriptionConfig'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  successful: 'bg-green-100 text-green-800',
  confirmed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  timeout: 'bg-orange-100 text-orange-800',
  rejected: 'bg-red-100 text-red-800',
}
const statusIcons  = {
  pending: '⏳',
  successful: '✅',
  confirmed: '✅',
  failed: '❌',
  timeout: '⌛',
  rejected: '❌',
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  return d.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PaymentsPanel() {
  const { currentUser } = useAuth()
  const { getPendingPayments, getAllPayments, confirmPayment, rejectPayment, grantPremium, getAllUsers, updateUserRole } = useFirestore()

  const [tab, setTab] = useState('pending')
  const [payments, setPayments] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [toast, setToast] = useState(null)

  const [grantUid, setGrantUid] = useState('')
  const [grantPlan, setGrantPlan] = useState('monthly')
  const [grantDays, setGrantDays] = useState(30)
  const [granting, setGranting] = useState(false)

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    const [p, u] = await Promise.all([
      tab === 'pending' ? getPendingPayments() : getAllPayments(),
      tab === 'users' ? getAllUsers() : Promise.resolve(users),
    ])
    setPayments(p)
    if (tab === 'users') setUsers(u)
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  async function handleConfirm(p) {
    setActionId(p.id)
    try {
      const planId = p.planId ?? p.plan
      const plan = PLANS[planId]
      await confirmPayment(p.id, p.userId, planId, plan?.durationDays ?? 30, currentUser.uid)
      show(`✅ Activated ${plan?.name} for ${p.displayName}`)
      load()
    } catch (e) { show('❌ ' + e.message) }
    setActionId(null)
  }

  async function handleReject(p) {
    if (!window.confirm(`Reject payment from ${p.displayName}?`)) return
    setActionId(p.id)
    try { await rejectPayment(p.id, currentUser.uid); show('Rejected.'); load() }
    catch (e) { show('❌ ' + e.message) }
    setActionId(null)
  }

  async function handleRoleChange(uid, role) {
    try { await updateUserRole(uid, role); setUsers(u => u.map(x => x.id === uid ? { ...x, role } : x)); show('Role updated.') }
    catch (e) { show('❌ ' + e.message) }
  }

  async function handleGrant(e) {
    e.preventDefault()
    if (!grantUid.trim()) return
    setGranting(true)
    try { await grantPremium(grantUid.trim(), grantPlan, +grantDays, currentUser.uid); show('Premium granted!'); setGrantUid('') }
    catch (e) { show('❌ ' + e.message) }
    setGranting(false)
  }

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 bg-green-700 text-white font-bold px-5 py-3 rounded-2xl shadow-lg animate-slide-up text-sm">{toast}</div>}

      <div>
        <p className="text-eyebrow">Admin overview</p>
        <h1 className="text-display-xl text-gray-800 mt-1">💳 Payments</h1>
        <p className="text-body-sm text-gray-500 mt-1">
          Review pending MTN MoMo payments, grant premium manually, and manage roles.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'pending', label: '⏳ Pending' },
          { id: 'all', label: '📋 All Payments' },
          { id: 'users', label: '👥 Users & Roles' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-bold min-h-0 ${tab === t.id ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {(tab === 'pending' || tab === 'all') && (
        loading ? <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} height={96} className="!rounded-2xl" />)}</div>
        : payments.length === 0 ? <div className="text-center py-12 text-gray-400"><div className="text-5xl mb-3">🎉</div><p className="font-bold">No payments</p></div>
        : <div className="space-y-3">
          {payments.map(p => (
            <div key={p.id} className="bg-white rounded-2xl shadow-sm border theme-border p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-black text-gray-800">{p.displayName || '—'}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusColors[p.status] || statusColors.pending}`}>{statusIcons[p.status] || '⏳'} {p.status}</span>
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">{PLANS[p.planId ?? p.plan]?.name ?? p.planId ?? p.plan} K{p.amountZMW}</span>
                  </div>
                  <p className="text-sm text-gray-500">{p.email}</p>
                  <p className="text-sm text-gray-600 mt-1">MTN MoMo: <span className="font-bold">{p.phoneNumber}</span></p>
                  <p className="text-xs text-gray-400 mt-1">Submitted: {fmtDate(p.createdAt)}</p>
                  <p className="text-xs text-gray-400 mt-1">MTN status: {p.mtnStatus || '—'}</p>
                  {p.reason && <p className="text-xs text-red-500 mt-1">{p.reason}</p>}
                </div>
                {p.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button variant="primary" size="sm" disabled={actionId === p.id} onClick={() => handleConfirm(p)}>✅ Confirm</Button>
                    <Button variant="danger" size="sm" disabled={actionId === p.id} onClick={() => handleReject(p)}>❌ Reject</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-2xl p-4">
            <h3 className="font-black text-gray-800 mb-3">⭐ Grant Premium Manually</h3>
            <form onSubmit={handleGrant} className="flex flex-wrap gap-3 items-end">
              <input value={grantUid} onChange={e => setGrantUid(e.target.value)} placeholder="User ID"
                className="flex-1 min-w-[140px] border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none" />
              <select value={grantPlan} onChange={e => { setGrantPlan(e.target.value); setGrantDays(PLANS[e.target.value]?.durationDays ?? 30) }}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {['monthly', 'termly', 'yearly'].map(p => <option key={p} value={p}>{PLANS[p].name}</option>)}
              </select>
              <input type="number" value={grantDays} onChange={e => setGrantDays(e.target.value)}
                className="w-20 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none" />
              <Button type="submit" variant="primary" size="sm" loading={granting}>
                {granting ? 'Granting…' : 'Grant'}
              </Button>
            </form>
          </div>

          {loading ? <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} height={56} />)}</div>
          : <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>{['Name', 'Role', 'Premium', 'Grade'].map(h => <th key={h} className="text-left px-4 py-3 font-black text-gray-600 text-xs">{h}</th>)}</tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b theme-border hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-800">{u.displayName || '—'}</div>
                      <div className="text-xs text-gray-400">{u.id.slice(0, 10)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold focus:border-green-500 focus:outline-none">
                        <option value="learner">learner</option>
                        <option value="teacher">teacher</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {hasPremiumAccess(u) ? <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full text-xs font-black">⭐ {u.subscriptionPlan}</span>
                        : <span className="text-gray-400 text-xs">Free</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.grade ? `G${u.grade}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </div>
  )
}
