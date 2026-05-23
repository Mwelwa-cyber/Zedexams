import { useEffect, useMemo, useState } from 'react'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import ControlCentreLayout from './ControlCentreLayout'

// Admin audit view of learnerWeaknessProfiles. Per-row summary with
// a side drawer for the full repeatedMistakes / recommendedNotes /
// recommendedQuizzes lists.
//
// Read-only — this page does NOT write to weakness profiles. The
// Weakness Detection agent owns those.

function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0
  if (!ms) return ''
  const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86_400)}d ago`
}

function Drawer({ profile, onClose }) {
  useEffect(() => {
    if (!profile) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [profile])
  if (!profile) return null
  const rm = Array.isArray(profile.repeatedMistakes) ? profile.repeatedMistakes : []
  const rn = Array.isArray(profile.recommendedNotes) ? profile.recommendedNotes : []
  const rq = Array.isArray(profile.recommendedQuizzes) ? profile.recommendedQuizzes : []
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex justify-end">
      <button type="button" onClick={onClose} aria-label="Close"
              className="absolute inset-0 bg-slate-900/40" />
      <aside className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl">
        <header className="px-4 py-3 border-b border-slate-200 sticky top-0 bg-white z-10 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Weakness profile</div>
            <h3 className="text-base font-bold text-slate-900">Learner {profile.learnerId}</h3>
            <div className="text-xs text-slate-500">
              G{profile.grade} · {profile.subject} · updated {timeAgo(profile.lastUpdated)}
            </div>
          </div>
          <button type="button" onClick={onClose}
                  className="text-slate-500 hover:text-slate-700 text-2xl leading-none px-1"
                  aria-label="Close">×</button>
        </header>

        <section className="px-4 py-3 border-b border-slate-100">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Weak topics ({(profile.weakTopics || []).length})
          </h4>
          {profile.weakTopics && profile.weakTopics.length ? (
            <ul className="text-sm list-disc pl-5 text-slate-700 space-y-0.5">
              {profile.weakTopics.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : <div className="text-xs text-slate-500">None.</div>}
        </section>

        <section className="px-4 py-3 border-b border-slate-100">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Weak subtopics ({(profile.weakSubtopics || []).length})
          </h4>
          {profile.weakSubtopics && profile.weakSubtopics.length ? (
            <ul className="text-sm list-disc pl-5 text-slate-700 space-y-0.5">
              {profile.weakSubtopics.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : <div className="text-xs text-slate-500">None.</div>}
        </section>

        <section className="px-4 py-3 border-b border-slate-100">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Repeated mistakes ({rm.length})
          </h4>
          {rm.length ? (
            <ul className="text-sm space-y-1.5">
              {rm.map((m, i) => (
                <li key={i} className="border border-slate-100 rounded px-2 py-1.5">
                  <div className="font-semibold text-slate-700">{m.topic}</div>
                  {Number.isInteger(m.timesMissed) && (
                    <div className="text-[11px] text-slate-500">
                      Missed {m.timesMissed} time{m.timesMissed === 1 ? '' : 's'}
                      {Number.isFinite(m.averageScore) ? ` · avg ${m.averageScore}%` : ''}
                    </div>
                  )}
                  {m.mistake && <div className="text-xs text-slate-600 mt-1">{m.mistake}</div>}
                </li>
              ))}
            </ul>
          ) : <div className="text-xs text-slate-500">None.</div>}
        </section>

        <section className="px-4 py-3 border-b border-slate-100">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Recommended notes ({rn.length})
          </h4>
          {rn.length ? (
            <ul className="text-sm list-disc pl-5 text-slate-700 space-y-0.5">
              {rn.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : <div className="text-xs text-slate-500">None.</div>}
        </section>

        <section className="px-4 py-3">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Recommended quizzes ({rq.length})
          </h4>
          {rq.length ? (
            <ul className="text-sm list-disc pl-5 text-slate-700 space-y-0.5">
              {rq.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : <div className="text-xs text-slate-500">None.</div>}
        </section>
      </aside>
    </div>
  )
}

export default function WeaknessReportsList() {
  const [profiles, setProfiles] = useState([])
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    const q = query(
      collection(db, 'learnerWeaknessProfiles'),
      orderBy('lastUpdated', 'desc'),
      fsLimit(120),
    )
    const unsub = onSnapshot(
      q,
      snap => {
        setProfiles(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setErr(null)
      },
      e => setErr(e.message),
    )
    return () => unsub()
  }, [])

  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim()
    if (!needle) return profiles
    return profiles.filter(p =>
      (p.learnerId || '').toLowerCase().includes(needle) ||
      (p.subject || '').toLowerCase().includes(needle) ||
      (p.weakTopics || []).some(t => t.toLowerCase().includes(needle)),
    )
  }, [profiles, search])

  return (
    <ControlCentreLayout
      title="Weakness reports"
      helmetTitle="Weakness reports — AI Control Centre"
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by learner ID, subject, or weak topic…"
          className="flex-1 min-w-[200px] text-xs border border-slate-300 rounded px-2 py-1.5"
        />
        <div className="text-xs text-slate-500">{filtered.length} of {profiles.length}</div>
      </div>

      {err && (
        <div className="text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded p-2 mb-3">
          Failed to load: {err}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-12 border border-dashed border-slate-200 rounded-lg">
          {profiles.length === 0 ?
            'No weakness profiles yet. The Weakness Detection agent populates these from completed quiz attempts.' :
            'No profiles match the current search.'}
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Learner</th>
                <th className="px-3 py-2 text-left">Grade · Subject</th>
                <th className="px-3 py-2 text-left">Top weak topics</th>
                <th className="px-3 py-2 text-left">Top weak subtopics</th>
                <th className="px-3 py-2 text-left">Updated</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-700 truncate max-w-[140px]">
                    {p.learnerId}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    G{p.grade} · {p.subject}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {(p.weakTopics || []).slice(0, 3).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {(p.weakSubtopics || []).slice(0, 3).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{timeAgo(p.lastUpdated)}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setDrawer(p)}
                      className="text-blue-600 hover:underline text-xs font-semibold"
                    >
                      View full profile
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer profile={drawer} onClose={() => setDrawer(null)} />
    </ControlCentreLayout>
  )
}
