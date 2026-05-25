import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { PLANS, PAYMENT_DETAILS, hasPremiumAccess, daysUntilExpiry } from '../../utils/subscriptionConfig'
import { resendInvoiceEmail } from '../../utils/invoices'
import { sendActivationConfirmation, sendExpiryReminders } from '../../utils/whatsapp'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'
import SeoHelmet from '../seo/SeoHelmet'
import RevenueTrendCard from './RevenueTrendCard'

// Products surfaced in the admin grant dropdown. Ordered by what we
// actually sell most. Each entry resolves to a plan id in PLANS.
const GRANT_PLAN_IDS = [
  'grade7_monthly',
  'grade7_termly',
  'grade9_monthly',
  'grade12_monthly',
  'full_platform_termly',
  'single_subject_monthly',
]

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
  const {
    getPendingPayments, getAllPayments, confirmPayment, rejectPayment,
    grantPremium, revokePremium, getAllUsers, updateUserRole,
    grantAccessByEmail, getTodayPaymentStats, getActivePremiumCount,
    getRecentConfirmedPayments, findUserByEmail, getMyPayments,
  } = useFirestore()

  const [tab, setTab] = useState('grant')
  const [payments, setPayments] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [toast, setToast] = useState(null)

  const [grantUid, setGrantUid] = useState('')
  const [grantPlan, setGrantPlan] = useState('monthly')
  const [grantDays, setGrantDays] = useState(30)
  const [granting, setGranting] = useState(false)
  const [rowActionUid, setRowActionUid] = useState(null)

  // Grant-tab state
  const [grantEmail, setGrantEmail] = useState('')
  const [grantPhone, setGrantPhone] = useState('')
  const [grantProductId, setGrantProductId] = useState(GRANT_PLAN_IDS[0])
  const [grantProductDays, setGrantProductDays] = useState(PLANS[GRANT_PLAN_IDS[0]]?.durationDays ?? 30)
  const [grantPaymentRef, setGrantPaymentRef] = useState('')
  const [grantSubmitting, setGrantSubmitting] = useState(false)
  const [grantStats, setGrantStats] = useState({ revenue: 0, activations: 0, activeUsers: 0 })
  const [recentActivations, setRecentActivations] = useState([])
  const [lastGrant, setLastGrant] = useState(null)
  const [remindersRunning, setRemindersRunning] = useState(false)
  // Email-driven customer preview. Populated after a 400ms debounce
  // when the admin pauses typing in the email field, so each keystroke
  // doesn't fire a Firestore query.
  const [lookupResult, setLookupResult] = useState(null) // { user, lastPayment } | { notFound: true } | null
  const [lookupLoading, setLookupLoading] = useState(false)

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  const loadGrantTab = useCallback(async () => {
    const [stats, activeUsers, recent] = await Promise.all([
      getTodayPaymentStats(),
      getActivePremiumCount(),
      getRecentConfirmedPayments(10),
    ])
    setGrantStats({ ...stats, activeUsers })
    setRecentActivations(recent)
  }, [getTodayPaymentStats, getActivePremiumCount, getRecentConfirmedPayments])

  const load = useCallback(async () => {
    setLoading(true)
    if (tab === 'grant') {
      await loadGrantTab()
    } else if (tab === 'pending' || tab === 'all') {
      const p = await (tab === 'pending' ? getPendingPayments() : getAllPayments())
      setPayments(p)
    } else if (tab === 'users') {
      const u = await getAllUsers()
      setUsers(u)
    }
    setLoading(false)
  }, [tab, loadGrantTab, getAllPayments, getAllUsers, getPendingPayments])

  useEffect(() => { load() }, [load])

  // Debounced email → user lookup. Pre-fills phone + shows current
  // subscription state inline. Falls through silently if the field is
  // empty or doesn't look like an email yet.
  useEffect(() => {
    const value = grantEmail.trim().toLowerCase()
    if (!value || !value.includes('@') || !value.includes('.')) {
      setLookupResult(null)
      setLookupLoading(false)
      return undefined
    }
    let cancelled = false
    setLookupLoading(true)
    const handle = setTimeout(async () => {
      const user = await findUserByEmail(value)
      if (cancelled) return
      if (!user) {
        setLookupResult({ notFound: true })
        setLookupLoading(false)
        return
      }
      // Pull most recent payment so the admin can verify this isn't
      // a double-grant (customer already paid + activated today).
      const payments = await getMyPayments(user.id, { limit: 1 })
      if (cancelled) return
      setLookupResult({ user, lastPayment: payments[0] || null })
      setLookupLoading(false)
      // Pre-fill the phone field if the customer has one on file and
      // the admin hasn't already typed one. Saves the WhatsApp-number
      // lookup step entirely for repeat customers.
      const onFile = user.subscriptionPhoneNumber || ''
      if (onFile && !grantPhone.trim()) setGrantPhone(onFile)
    }, 400)
    return () => { cancelled = true; clearTimeout(handle) }
    // grantPhone deliberately omitted: we read it inside the effect to
    // decide whether to auto-fill, but re-running on every phone
    // keystroke would re-fire the Firestore lookup. ESLint can't model
    // this nuance cleanly — the manual dep list is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantEmail, findUserByEmail, getMyPayments])

  async function handleGrantAccess(e) {
    e.preventDefault()
    if (!grantEmail.trim()) return
    setGrantSubmitting(true)
    try {
      const result = await grantAccessByEmail({
        email: grantEmail,
        planId: grantProductId,
        durationDays: +grantProductDays,
        paymentReference: grantPaymentRef,
        phoneNumber: grantPhone,
        adminId: currentUser.uid,
      })
      const plan = PLANS[grantProductId]
      const expiryStr = result.expiry.toLocaleDateString('en-ZM', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
      const confirmText =
        `Hi ${result.displayName.split(' ')[0] || 'there'}! ` +
        `Your ${plan.name} (K${plan.priceZMW}) is now active until ${expiryStr}. ` +
        `Login at zedexams.com with ${grantEmail.trim().toLowerCase()}. Welcome!`
      // Try auto-sending via the Meta WhatsApp API when a phone was
      // entered. Soft-fails: if the API isn't configured or the send
      // bounces, the admin still gets the copy/wa.me fallback below.
      let sendStatus = null
      const trimmedPhone = grantPhone.trim()
      if (trimmedPhone) {
        try {
          const res = await sendActivationConfirmation({
            phone: trimmedPhone,
            body: confirmText,
          })
          sendStatus = res
        } catch (err) {
          sendStatus = { status: 'failed', error: err.message }
        }
      }

      setLastGrant({
        name: result.displayName,
        email: grantEmail.trim().toLowerCase(),
        phone: trimmedPhone,
        plan: plan.name,
        expiryStr,
        confirmText,
        sendStatus,
      })
      if (sendStatus?.status === 'sent') {
        show(`✅ Activated & WhatsApp sent to ${result.displayName}`)
      } else if (sendStatus?.status === 'failed') {
        show(`✅ Activated · ⚠ WhatsApp failed — use the copy button below`)
      } else {
        show(`✅ Activated ${plan.name} for ${result.displayName}`)
      }
      setGrantEmail('')
      setGrantPhone('')
      setGrantPaymentRef('')
      loadGrantTab()
    } catch (err) {
      show('❌ ' + err.message)
    }
    setGrantSubmitting(false)
  }

  function handleCopyConfirmation() {
    if (!lastGrant) return
    navigator.clipboard?.writeText(lastGrant.confirmText)
      .then(() => show('📋 Confirmation copied — paste into WhatsApp'))
      .catch(() => show('❌ Could not copy.'))
  }

  function handleOpenWhatsApp() {
    if (!lastGrant) return
    const number = PAYMENT_DETAILS.contact.whatsapp.replace(/[^\d]/g, '')
    const url = `https://wa.me/${number}?text=${encodeURIComponent(lastGrant.confirmText)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function handleSendReminders() {
    if (remindersRunning) return
    if (!window.confirm(
      "Send WhatsApp renewal reminders to learners expiring in the next 3 days or lapsed in the last 14? Each user receives at most one reminder per 20 hours."
    )) return
    setRemindersRunning(true)
    try {
      const res = await sendExpiryReminders()
      if (res.status === 'skipped' && res.reason === 'meta-not-configured') {
        show('⚠ Meta WhatsApp secrets not set on the server.')
      } else {
        show(`📨 Reminders: ${res.sent} sent · ${res.skipped} skipped · ${res.failed} failed (of ${res.candidates} candidates)`)
      }
    } catch (err) {
      show('❌ ' + (err.message || 'Could not send reminders.'))
    }
    setRemindersRunning(false)
  }

  function handleExportTodayCsv() {
    if (!recentActivations.length) {
      show('No activations to export yet.')
      return
    }
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
    const todaysRows = recentActivations.filter((p) => {
      const dt = p.confirmedAt?.toDate?.() ?? (p.confirmedAt ? new Date(p.confirmedAt) : null)
      return dt && dt >= startOfToday
    })
    if (!todaysRows.length) {
      show('No activations today yet.')
      return
    }
    const escape = (v) => {
      const s = String(v ?? '').replace(/"/g, '""')
      return /[",\n]/.test(s) ? `"${s}"` : s
    }
    const lines = [
      ['confirmedAt', 'email', 'displayName', 'plan', 'amountZMW', 'paymentReference', 'paymentId'].join(','),
      ...todaysRows.map((p) => [
        (p.confirmedAt?.toDate?.() ?? new Date(p.confirmedAt)).toISOString(),
        p.email || '',
        p.displayName || '',
        p.planName || PLANS[p.planId]?.name || p.planId || '',
        p.amountZMW || 0,
        p.paymentReference || '',
        p.id,
      ].map(escape).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zedexams-sales-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

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
    // Promotion to / demotion from admin is one-click and irreversible
    // without a second admin available — confirm before applying.
    const current = users.find(u => u.id === uid)?.role
    const touchesAdmin = role === 'admin' || current === 'admin'
    if (touchesAdmin) {
      const name = users.find(u => u.id === uid)?.displayName || uid
      const verb = role === 'admin' ? `promote ${name} to admin` : `change ${name} from admin to ${role}`
      if (!window.confirm(`Are you sure you want to ${verb}?`)) return
    }
    try { await updateUserRole(uid, role); setUsers(u => u.map(x => x.id === uid ? { ...x, role } : x)); show('Role updated.') }
    catch (e) { show('❌ ' + e.message) }
  }

  async function handleResendInvoice(p) {
    // Audit D3 follow-up — invoice doc is keyed by paymentId, so the
    // resend callable takes the same id directly.
    setActionId(p.id)
    try {
      const result = await resendInvoiceEmail(p.id)
      show(result?.emailedTo
        ? `📧 Receipt resent to ${result.emailedTo}`
        : '📧 Receipt resent.')
    } catch (e) {
      show('❌ ' + (e?.message || 'Could not resend the receipt.'))
    }
    setActionId(null)
  }

  async function handleGrant(e) {
    e.preventDefault()
    if (!grantUid.trim()) return
    setGranting(true)
    try { await grantPremium(grantUid.trim(), grantPlan, +grantDays, currentUser.uid); show('Premium granted!'); setGrantUid('') }
    catch (e) { show('❌ ' + e.message) }
    setGranting(false)
  }

  // Per-row grant: uses the currently selected plan + days from the form
  // so admins don't have to copy a 28-char Firestore UID into the input.
  async function handleRowGrant(u) {
    setRowActionUid(u.id)
    try {
      await grantPremium(u.id, grantPlan, +grantDays, currentUser.uid)
      const planName = PLANS[grantPlan]?.name ?? grantPlan
      setUsers(list => list.map(x => x.id === u.id
        ? { ...x, premium: true, isPremium: true, paymentStatus: 'active', subscriptionStatus: 'active', subscriptionPlan: grantPlan }
        : x))
      show(`⭐ Granted ${planName} to ${u.displayName || u.id.slice(0, 10)}`)
    } catch (e) { show('❌ ' + e.message) }
    setRowActionUid(null)
  }

  async function handleRowRevoke(u) {
    if (!window.confirm(`Revoke premium from ${u.displayName || u.id}?`)) return
    setRowActionUid(u.id)
    try {
      await revokePremium(u.id)
      setUsers(list => list.map(x => x.id === u.id
        ? { ...x, premium: false, isPremium: false, paymentStatus: 'inactive', subscriptionStatus: 'inactive', subscriptionPlan: 'free' }
        : x))
      show('Premium revoked.')
    } catch (e) { show('❌ ' + e.message) }
    setRowActionUid(null)
  }

  async function handleCopyUid(uid) {
    try { await navigator.clipboard.writeText(uid); show('User ID copied.') }
    catch { show('❌ Could not copy.') }
  }

  return (
    <div className="space-y-4">
      <SeoHelmet title="Payments" noIndex />
      {toast && <div className="fixed top-4 right-4 z-50 bg-green-700 text-white font-bold px-5 py-3 rounded-2xl shadow-lg animate-slide-up text-sm">{toast}</div>}

      <div>
        <p className="text-eyebrow">Admin overview</p>
        <h1 className="text-display-xl text-gray-800 mt-1">💳 Payments</h1>
        <p className="text-body-sm text-gray-500 mt-1">
          Confirm Mobile Money payments after WhatsApp verification, grant premium manually, and manage roles.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'grant', label: '🎯 Grant access' },
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

      {tab === 'grant' && (
        <div className="space-y-4">
          {/* 7-day revenue trend — visual cue when daily volume is
              up/down so the admin notices a slow day before they're
              halfway through the next launch post. */}
          <RevenueTrendCard />

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-2xl shadow-sm border theme-border p-4 text-center">
              <div className="text-2xl font-black text-[#B8860B]">K{grantStats.revenue.toLocaleString()}</div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mt-1 font-bold">Today</div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border theme-border p-4 text-center">
              <div className="text-2xl font-black text-gray-800">{grantStats.activations}</div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mt-1 font-bold">Activations</div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border theme-border p-4 text-center">
              <div className="text-2xl font-black text-gray-800">{grantStats.activeUsers}</div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mt-1 font-bold">Active users</div>
            </div>
          </div>

          {/* Grant form */}
          <div className="bg-white rounded-2xl shadow-sm border theme-border p-5">
            <h3 className="text-base font-black text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#B8860B]" />
              Grant access
            </h3>
            <form onSubmit={handleGrantAccess} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                    Customer email
                  </label>
                  <input
                    type="email"
                    value={grantEmail}
                    onChange={(e) => setGrantEmail(e.target.value)}
                    required
                    placeholder="parent.mwape@gmail.com"
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                    WhatsApp number <span className="text-gray-400 normal-case font-normal">(auto-send)</span>
                  </label>
                  <input
                    type="tel"
                    value={grantPhone}
                    onChange={(e) => setGrantPhone(e.target.value)}
                    placeholder="0977 740 465"
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Email-driven customer preview. Reflects what the
                  admin will write when they submit (current plan vs.
                  fresh activation, phone already on file, last payment
                  date). */}
              {lookupLoading && (
                <div className="text-xs text-gray-500 px-2">Looking up customer…</div>
              )}
              {lookupResult?.notFound && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                  <p className="font-bold text-amber-900">No account for this email yet</p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Ask the customer to sign up at zedexams.com first — granting will fail until then.
                  </p>
                </div>
              )}
              {lookupResult?.user && (() => {
                const u = lookupResult.user
                const last = lookupResult.lastPayment
                const isPrem = hasPremiumAccess(u)
                const daysLeft = daysUntilExpiry(u)
                const planName = PLANS[u.subscriptionPlan]?.name || u.subscriptionPlan || 'No plan'
                const lastDate = last?.createdAt?.toDate?.()
                  ? last.createdAt.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                  : null
                return (
                  <div className={`rounded-xl p-3 text-sm border ${isPrem ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-bold text-gray-800">
                          {u.displayName || u.email}
                          {u.role && u.role !== 'learner' && (
                            <span className="ml-2 text-[10px] font-black uppercase tracking-wider bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{u.role}</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {isPrem
                            ? `⭐ ${planName} · ${daysLeft != null ? `${daysLeft} days left` : 'active'}`
                            : 'Free tier — no active subscription'}
                        </p>
                        {u.subscriptionPhoneNumber && (
                          <p className="text-xs text-gray-500 mt-0.5">📱 {u.subscriptionPhoneNumber}</p>
                        )}
                      </div>
                      {last && (
                        <div className="text-right text-xs text-gray-500 flex-shrink-0">
                          <p>Last: K{last.amountZMW || 0}</p>
                          {lastDate && <p>{lastDate}</p>}
                        </div>
                      )}
                    </div>
                    {isPrem && daysLeft != null && daysLeft > 0 && (() => {
                      const planForGrant = PLANS[grantProductId]
                      const addDays = +grantProductDays || planForGrant?.durationDays || 30
                      const totalDays = daysLeft + addDays
                      return (
                        <p className="text-xs text-blue-700 mt-2 leading-snug">
                          ℹ Customer has {daysLeft} day{daysLeft === 1 ? '' : 's'} left.
                          Granting adds {addDays} day{addDays === 1 ? '' : 's'} on top — new expiry in <strong>{totalDays} days</strong>.
                        </p>
                      )
                    })()}
                  </div>
                )
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                    Plan
                  </label>
                  <select
                    value={grantProductId}
                    onChange={(e) => {
                      const pid = e.target.value
                      setGrantProductId(pid)
                      setGrantProductDays(PLANS[pid]?.durationDays ?? 30)
                    }}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none"
                  >
                    {GRANT_PLAN_IDS.map((pid) => (
                      <option key={pid} value={pid}>
                        {PLANS[pid].name} · K{PLANS[pid].priceZMW}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                    Duration (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={grantProductDays}
                    onChange={(e) => setGrantProductDays(e.target.value)}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
                  Payment reference (optional)
                </label>
                <input
                  type="text"
                  value={grantPaymentRef}
                  onChange={(e) => setGrantPaymentRef(e.target.value)}
                  placeholder="MP260524.1422.A12345"
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none"
                />
              </div>
              <Button type="submit" variant="primary" size="lg" fullWidth loading={grantSubmitting}>
                {grantSubmitting ? 'Granting…' : 'Grant access'}
              </Button>
              <p className="text-xs text-gray-500 bg-yellow-50 border-l-4 border-[#B8860B] rounded-r p-3">
                <strong className="text-gray-800">What happens:</strong> the user is activated immediately
                with an expiry date. A payment record is written for the dashboard & CSV export.
                After saving, you'll get a copy-pasteable WhatsApp confirmation.
              </p>
            </form>
          </div>

          {/* Post-grant confirmation snippet */}
          {lastGrant && (
            <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4">
              <p className="text-sm font-bold text-green-800 mb-1">
                ✅ Activated {lastGrant.plan} for {lastGrant.name} ({lastGrant.email})
              </p>
              {lastGrant.sendStatus?.status === 'sent' && (
                <p className="text-xs text-green-700 mb-2">
                  📨 WhatsApp message sent to {lastGrant.phone}
                  {lastGrant.sendStatus.messageId ? ` · id ${lastGrant.sendStatus.messageId.slice(-8)}` : ''}
                </p>
              )}
              {lastGrant.sendStatus?.status === 'skipped' && (
                <p className="text-xs text-yellow-700 mb-2">
                  ⚠ WhatsApp API not configured — use Copy / Open WhatsApp below.
                </p>
              )}
              {lastGrant.sendStatus?.status === 'failed' && (
                <p className="text-xs text-red-600 mb-2">
                  ⚠ Auto-send failed: {lastGrant.sendStatus.error || 'unknown error'} — use the buttons below.
                </p>
              )}
              {!lastGrant.sendStatus && lastGrant.phone === '' && (
                <p className="text-xs text-gray-600 mb-2">
                  No WhatsApp number entered — copy/paste the message below.
                </p>
              )}
              <textarea
                readOnly
                value={lastGrant.confirmText}
                className="w-full text-sm bg-white border border-green-200 rounded-lg p-3 mb-3 font-mono"
                rows={3}
              />
              <div className="flex gap-2 flex-wrap">
                <Button variant="primary" size="sm" onClick={handleCopyConfirmation}>
                  📋 Copy message
                </Button>
                <Button variant="secondary" size="sm" onClick={handleOpenWhatsApp}>
                  💬 Open WhatsApp
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setLastGrant(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* Recent activations */}
          <div className="bg-white rounded-2xl shadow-sm border theme-border p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#B8860B]" />
                Recent activations
              </h3>
              <div className="flex gap-2 flex-wrap">
                <Button variant="secondary" size="sm" onClick={handleExportTodayCsv}>
                  ⬇ Export today's sales
                </Button>
                <Button variant="secondary" size="sm" loading={remindersRunning} onClick={handleSendReminders}>
                  {remindersRunning ? 'Sending…' : '📨 Send expiry reminders'}
                </Button>
              </div>
            </div>
            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} height={40} />)}</div>
            ) : recentActivations.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No activations yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>{['Email', 'Plan', 'Activated', 'Status'].map((h) => (
                      <th key={h} className="text-left px-3 py-2 font-bold text-gray-600 text-xs uppercase tracking-wider">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {recentActivations.map((p) => (
                      <tr key={p.id} className="border-b theme-border">
                        <td className="px-3 py-2 text-gray-800">{p.email || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {p.planName || PLANS[p.planId]?.name || p.planId || '—'}
                          {p.amountZMW ? ` · K${p.amountZMW}` : ''}
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{fmtDate(p.confirmedAt)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusColors[p.status] || statusColors.confirmed}`}>
                            {statusIcons[p.status] || '✅'} {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

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
                  {p.phoneNumber && (
                    <p className="text-sm text-gray-600 mt-1">Mobile Money: <span className="font-bold">{p.phoneNumber}</span></p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Submitted: {fmtDate(p.createdAt)}</p>
                  {p.reason && <p className="text-xs text-red-500 mt-1">{p.reason}</p>}
                </div>
                {p.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button variant="primary" size="sm" disabled={actionId === p.id} onClick={() => handleConfirm(p)}>✅ Confirm</Button>
                    <Button variant="danger" size="sm" disabled={actionId === p.id} onClick={() => handleReject(p)}>❌ Reject</Button>
                  </div>
                )}
                {(p.status === 'successful' || p.status === 'confirmed') && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={actionId === p.id}
                      onClick={() => handleResendInvoice(p)}
                    >
                      {actionId === p.id ? 'Sending…' : '📧 Resend invoice'}
                    </Button>
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
                <tr>{['Name', 'Role', 'Premium', 'Grade', 'Actions'].map(h => <th key={h} className="text-left px-4 py-3 font-black text-gray-600 text-xs">{h}</th>)}</tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isPremium = hasPremiumAccess(u)
                  const busy = rowActionUid === u.id
                  return (
                  <tr key={u.id} className="border-b theme-border hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-800">{u.displayName || '—'}</div>
                      <button
                        type="button"
                        onClick={() => handleCopyUid(u.id)}
                        title="Copy full User ID"
                        className="text-xs text-gray-400 hover:text-green-600 hover:underline cursor-pointer"
                      >
                        {u.id?.slice(0, 10) || '—'}… 📋
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <select value={u.role || ''} onChange={e => handleRoleChange(u.id, e.target.value)}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold focus:border-green-500 focus:outline-none">
                        <option value="" disabled>— no role —</option>
                        <option value="learner">learner</option>
                        <option value="teacher">teacher</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {isPremium ? <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full text-xs font-black">⭐ {u.subscriptionPlan}</span>
                        : <span className="text-gray-400 text-xs">Free</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.grade ? `G${u.grade}` : '—'}</td>
                    <td className="px-4 py-3">
                      {isPremium ? (
                        <Button variant="danger" size="sm" disabled={busy} onClick={() => handleRowRevoke(u)}>
                          {busy ? '…' : 'Revoke'}
                        </Button>
                      ) : (
                        <Button variant="primary" size="sm" disabled={busy} onClick={() => handleRowGrant(u)}>
                          {busy ? '…' : '⭐ Grant'}
                        </Button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </div>
  )
}
