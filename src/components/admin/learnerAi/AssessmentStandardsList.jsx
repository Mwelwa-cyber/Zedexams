import { useEffect, useState } from 'react'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import SeoHelmet from '../../seo/SeoHelmet'

export default function AssessmentStandardsList() {
  const [standards, setStandards] = useState([])

  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'assessmentStandards'),
        orderBy('updatedAt', 'desc'),
        fsLimit(50),
      ),
      snap => setStandards(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => unsub()
  }, [])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <SeoHelmet title="Assessment standards — Learner AI" />
      <h1 className="text-2xl font-bold mb-2">Assessment standards</h1>
      <p className="text-sm text-slate-600 mb-4">
        Blooms distribution, question-type mix, and mark scheme settings per
        grade × subject × term. Drafts produced by the Standards agent; admins
        promote to approved.
      </p>
      {!standards.length && <div className="text-sm text-slate-500">No standards on file yet.</div>}
      {standards.map(s => (
        <div key={s.id} className="border rounded p-3 mb-3 bg-white text-sm">
          <div className="font-medium">
            G{s.grade} · {s.subject} · Term {s.term ?? '—'} ·
            <span className="ml-2 text-xs text-slate-500">{s.status || 'draft'}</span>
          </div>
          <pre className="text-xs bg-slate-50 p-2 rounded mt-2 overflow-auto">{JSON.stringify(s.bloomsDistribution, null, 2)}</pre>
        </div>
      ))}
    </div>
  )
}
