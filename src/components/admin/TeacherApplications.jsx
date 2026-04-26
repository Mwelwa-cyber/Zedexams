import { useEffect, useState } from 'react'
import { ref as storageRef, getDownloadURL } from 'firebase/storage'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { storage } from '../../firebase/config'
import StatusBadge from '../ui/StatusBadge'

function fmtDate(ts) {
  if (!ts) return '-'
  const d = ts?.toDate?.() ?? new Date(ts)
  return d.toLocaleDateString('en-ZM', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-gray-800 break-words">{value || '-'}</p>
    </div>
  )
}

function TeacherApplicationCard({
  app,
  expanded,
  onToggle,
  onLoadProof,
  proofUrl,
  proofLoading,
  proofError,
  onApprove,
  onReject,
  busy,
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const actionBusy = busy === app.id

  return (
    <div className="bg-white rounded-2xl border theme-border shadow-sm p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-black text-gray-800 text-base">{app.fullName}</h2>
            <StatusBadge status={app.status} />
          </div>
          <p className="text-sm text-gray-500 mt-1">{app.schoolName}</p>
          <p className="text-xs text-gray-400 mt-1">Submitted {fmtDate(app.submittedAt)}</p>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="self-start rounded-xl border border-gray-200 px-4 py-2 text-sm font-black text-gray-700 hover:bg-gray-50 min-h-0"
        >
          {expanded ? 'Close' : 'Open Application'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 border-t theme-border pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Detail label="Full name" value={app.fullName} />
            <Detail label="Email" value={app.email} />
            <Detail label="Phone number" value={app.phoneNumber} />
            <Detail label="NRC number" value={app.nrcNumber} />
            <Detail label="School name" value={app.schoolName} />
            <Detail label="Proof file" value={`${app.proofFileName || 'Document'} (${fmtSize(app.proofSize)})`} />
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-blue-700">Uploaded proof document</p>
            {proofUrl ? (
              <a
                href={proofUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
              >
                View Document
              </a>
            ) : (
              <button
                type="button"
                onClick={() => onLoadProof(app)}
                disabled={proofLoading}
                className="mt-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60 min-h-0"
              >
                {proofLoading ? 'Loading document...' : 'Load Document Link'}
              </button>
            )}
            {proofError && <p className="mt-2 text-xs font-bold text-red-600">{proofError}</p>}
          </div>

          {rejecting && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-3 space-y-2">
              <label className="block text-xs font-black text-red-700">Rejection reason</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Optional note for the applicant"
                className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
              />
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onReject(app, reason)
                    setRejecting(false)
                    setReason('')
                  }}
                  disabled={actionBusy}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700 disabled:opacity-60 min-h-0"
                >
                  Confirm Reject
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejecting(false)
                    setReason('')
                  }}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-black text-gray-700 hover:bg-gray-50 min-h-0"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!rejecting && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => onApprove(app)}
                disabled={actionBusy}
                className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-black text-white hover:bg-green-700 disabled:opacity-60 min-h-0"
              >
                {actionBusy ? 'Approving...' : 'Approve Teacher'}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={actionBusy}
                className="flex-1 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-600 hover:bg-red-100 disabled:opacity-60 min-h-0"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TeacherApplications() {
  const { currentUser } = useAuth()
  const {
    getPendingTeacherApplications,
    approveTeacherApplication,
    rejectTeacherApplication,
  } = useFirestore()

  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [proofUrls, setProofUrls] = useState({})
  const [proofLoadingId, setProofLoadingId] = useState(null)
  const [proofErrors, setProofErrors] = useState({})
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState(null)

  function show(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function load() {
    setLoading(true)
    const data = await getPendingTeacherApplications()
    setApplications(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function loadProof(app) {
    if (!app.proofPath || proofUrls[app.id]) return
    setProofLoadingId(app.id)
    setProofErrors(prev => ({ ...prev, [app.id]: '' }))
    try {
      const url = await getDownloadURL(storageRef(storage, app.proofPath))
      setProofUrls(prev => ({ ...prev, [app.id]: url }))
    } catch (e) {
      setProofErrors(prev => ({ ...prev, [app.id]: e.message || 'Could not load the document link.' }))
    } finally {
      setProofLoadingId(null)
    }
  }

  async function handleApprove(app) {
    setBusy(app.id)
    try {
      await approveTeacherApplication(app.id, app.userId, currentUser.uid)
      show(`${app.fullName} is now approved as a teacher.`)
      await load()
      setExpandedId(null)
    } catch (e) {
      show(e.message || 'Could not approve this application.')
    } finally {
      setBusy(null)
    }
  }

  async function handleReject(app, reason) {
    setBusy(app.id)
    try {
      await rejectTeacherApplication(app.id, app.userId, currentUser.uid, reason)
      show(`${app.fullName} was rejected.`)
      await load()
      setExpandedId(null)
    } catch (e) {
      show(e.message || 'Could not reject this application.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-xs rounded-2xl bg-gray-900 px-5 py-3 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Teacher Applications</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review verification details before granting teacher access.</p>
        </div>
        {!loading && (
          <span className={`self-start rounded-full px-3 py-1.5 text-sm font-black ${
            applications.length > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {applications.length} pending
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border theme-border bg-white" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="rounded-2xl border theme-border bg-white py-16 text-center">
          <p className="font-black text-gray-700">No pending teacher applications</p>
          <p className="mt-1 text-sm text-gray-400">New submissions will appear here for review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map(app => (
            <TeacherApplicationCard
              key={app.id}
              app={app}
              expanded={expandedId === app.id}
              onToggle={() => {
                const nextId = expandedId === app.id ? null : app.id
                setExpandedId(nextId)
                if (nextId) loadProof(app)
              }}
              onLoadProof={loadProof}
              proofUrl={proofUrls[app.id]}
              proofLoading={proofLoadingId === app.id}
              proofError={proofErrors[app.id]}
              onApprove={handleApprove}
              onReject={handleReject}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  )
}
