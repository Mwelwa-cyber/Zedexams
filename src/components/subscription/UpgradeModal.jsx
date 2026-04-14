import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { PLANS, PAYMENT_DETAILS } from '../../utils/subscriptionConfig'

const planOrder = ['monthly', 'termly', 'yearly']
const planBorder = { monthly: 'border-green-400 bg-green-50', termly: 'border-blue-400 bg-blue-50', yearly: 'border-purple-400 bg-purple-50' }

export default function UpgradeModal({ onClose }) {
  const { currentUser, userProfile } = useAuth()
  const { submitPaymentRequest } = useFirestore()

  const [step, setStep] = useState('plans')
  const [sel, setSel] = useState(null)
  const [method, setMethod] = useState('MTN')
  const [phone, setPhone] = useState('')
  const [txRef, setTxRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const plan = sel ? PLANS[sel] : null

  async function handleSubmit() {
    if (!phone.trim()) { setError('Enter your mobile money number.'); return }
    setError(''); setSubmitting(true)
    try {
      await submitPaymentRequest(currentUser.uid, userProfile?.displayName ?? '', currentUser.email, sel, plan.priceZMW, method, phone.trim(), txRef.trim())
      setStep('done')
    } catch (e) { setError('Failed. Try again.'); console.error(e) }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-4 overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-yellow-400 to-orange-400 p-5 text-center relative">
          <button onClick={onClose} className="absolute top-3 right-4 text-white/80 hover:text-white text-2xl font-black min-h-0 p-0 bg-transparent shadow-none">×</button>
          <div className="text-4xl mb-1">⭐</div>
          <h2 className="text-2xl font-black text-white">Upgrade to Premium</h2>
          <p className="text-white/90 text-sm mt-1">Unlock unlimited learning</p>
        </div>

        <div className="p-5">
          {/* Step 1: Plans */}
          {step === 'plans' && <>
            <div className="grid gap-3 mb-4">
              {planOrder.map(pid => {
                const p = PLANS[pid]; const active = sel === pid
                return (
                  <button key={pid} onClick={() => setSel(pid)}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all min-h-0 ${active ? planBorder[pid] + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="flex items-center justify-between">
                      <div><span className="font-black text-gray-800 text-lg">{p.badge} {p.name}</span><span className="ml-2 text-gray-500 text-sm">{p.tagline}</span></div>
                      <div className="text-right"><div className="font-black text-2xl text-gray-800">K{p.priceZMW}</div><div className="text-xs text-gray-500">ZMW</div></div>
                    </div>
                    {active && <ul className="mt-3 space-y-1">{p.features.map(f => <li key={f} className="text-sm text-gray-700 flex items-center gap-2"><span className="text-green-500 font-black">✓</span>{f}</li>)}</ul>}
                  </button>
                )
              })}
            </div>
            <div className="bg-gray-50 rounded-2xl p-3 mb-4 text-sm text-gray-500 text-center">
              Currently on <strong>Free plan</strong> — demo quizzes and 3 past papers
            </div>
            <button onClick={() => sel && setStep('pay')} disabled={!sel}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-black text-base py-3.5 rounded-2xl">
              {sel ? `Continue → Pay K${plan.priceZMW}` : 'Select a Plan'}
            </button>
          </>}

          {/* Step 2: Pay */}
          {step === 'pay' && plan && <>
            <button onClick={() => setStep('plans')} className="text-green-600 font-bold text-sm mb-4 min-h-0 p-0 bg-transparent shadow-none">← Back</button>
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 mb-4 text-center">
              <p className="text-gray-700 font-bold">Send exactly</p>
              <p className="text-4xl font-black text-green-700 my-1">K{plan.priceZMW} ZMW</p>
              <p className="text-gray-500 text-sm">{plan.name} plan · {plan.durationDays} days</p>
            </div>
            <div className="flex gap-2 mb-4">
              {['MTN', 'Airtel'].map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`flex-1 py-2.5 rounded-xl font-black text-sm min-h-0 ${method === m ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {m === 'MTN' ? '🟡 MTN Money' : '🔴 Airtel Money'}
                </button>
              ))}
            </div>
            <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 mb-4">
              <p className="text-xs text-green-700 font-bold uppercase tracking-wider mb-1">Send to</p>
              <p className="text-2xl font-black text-green-800">{PAYMENT_DETAILS[method].number}</p>
              <p className="text-xs text-gray-500 mt-2">{PAYMENT_DETAILS[method].instructions}</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Your mobile money number *</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="096 XXX XXXX"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Transaction ref <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={txRef} onChange={e => setTxRef(e.target.value)} placeholder="From your SMS"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-500 focus:outline-none" />
              </div>
            </div>
            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-3 mb-3">{error}</p>}
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-base py-3.5 rounded-2xl">
              {submitting ? '⏳ Submitting…' : '✅ I Have Sent the Payment'}
            </button>
            <p className="text-center text-xs text-gray-400 mt-3">Your account will be upgraded within <strong>1–2 hours</strong>.</p>
          </>}

          {/* Step 3: Done */}
          {step === 'done' && (
            <div className="text-center py-4">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-2xl font-black text-gray-800 mb-2">Payment Submitted!</h3>
              <p className="text-gray-600 mb-4">We'll verify your <strong>{plan?.name}</strong> payment and activate within <strong>1–2 hours</strong>.</p>
              <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-4 text-sm text-green-800">
                <p className="font-bold mb-1">Need faster activation?</p>
                <p>WhatsApp <a href={`https://wa.me/${PAYMENT_DETAILS.contact.whatsapp.replace(/\s+/g,'')}`} className="font-black underline" target="_blank" rel="noopener noreferrer">{PAYMENT_DETAILS.contact.whatsapp}</a></p>
              </div>
              <button onClick={onClose} className="bg-green-600 text-white font-black w-full py-3.5 rounded-2xl">Back to Dashboard</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
