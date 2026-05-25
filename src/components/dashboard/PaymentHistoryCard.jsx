import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { PLANS } from '../../utils/subscriptionConfig'
import Icon from '../ui/Icon'
import { CreditCard } from '../ui/icons'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusChip(status) {
  // Pending/successful/confirmed are the live states the customer
  // sees; failed/timeout/rejected are admin-side and shouldn't show
  // up here in practice (no legacy MoMo flow writes pending anymore).
  if (status === 'successful' || status === 'confirmed') {
    return { label: 'Paid', cls: 'bg-green-100 text-green-700' }
  }
  if (status === 'pending') {
    return { label: 'Pending', cls: 'bg-yellow-100 text-yellow-800' }
  }
  return { label: status || '—', cls: 'bg-gray-100 text-gray-600' }
}

/**
 * PaymentHistoryCard — customer-scoped view of past payments. Sits
 * under InvoicesCard on ProfilePage; self-hides when the customer has
 * no payments on file (most free-tier accounts), so the existing
 * empty-state UX is unchanged.
 *
 * The /payments Firestore rule already permits read where userId ==
 * request.auth.uid, so this works straight from the client. No
 * callable round-trip needed.
 */
export default function PaymentHistoryCard() {
  const { currentUser } = useAuth()
  const { getMyPayments } = useFirestore()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!currentUser?.uid) { setLoading(false); return }
    getMyPayments(currentUser.uid)
      .then((list) => { if (!cancelled) setRows(list) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser?.uid, getMyPayments])

  if (loading) return null
  if (!rows.length) return null

  return (
    <div className="theme-card rounded-2xl border theme-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon as={CreditCard} size="md" strokeWidth={2.1} className="theme-accent-text" />
        <h2 className="font-black theme-text text-base">Payment history</h2>
      </div>
      <ul className="divide-y theme-border">
        {rows.map((p) => {
          const chip = statusChip(p.status)
          const planName = p.planName || PLANS[p.planId]?.name || p.planId || 'Subscription'
          return (
            <li key={p.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="font-bold theme-text text-sm truncate">{planName}</p>
                <p className="text-xs theme-text-muted mt-0.5">
                  {fmtDate(p.createdAt)}
                  {p.paymentReference ? ` · ref ${p.paymentReference}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {p.amountZMW != null && (
                  <span className="font-black theme-text text-sm">K{p.amountZMW}</span>
                )}
                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${chip.cls}`}>
                  {chip.label}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="text-xs theme-text-muted mt-3 leading-relaxed">
        Showing your last {rows.length} payment{rows.length === 1 ? '' : 's'}.
        Questions about a charge? Message us on WhatsApp.
      </p>
    </div>
  )
}
