import { useEffect, useState } from 'react'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import SeoHelmet from '../../seo/SeoHelmet'

export default function CurriculumUpdateReports() {
  const [reports, setReports] = useState([])

  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'curriculumUpdateReports'),
        orderBy('scannedAt', 'desc'),
        fsLimit(50),
      ),
      snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => unsub()
  }, [])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <SeoHelmet title="Curriculum updates — Learner AI" />
      <h1 className="text-2xl font-bold mb-2">Curriculum update reports</h1>
      <p className="text-sm text-slate-600 mb-4">
        Daily scans by the Curriculum Watcher agent. Never mutates the KB —
        only reports drift.
      </p>
      {!reports.length && <div className="text-sm text-slate-500">No reports yet.</div>}
      {reports.map(r => (
        <div key={r.id} className="border rounded p-3 mb-3 bg-white">
          <div className="text-sm text-slate-600">
            Scanned: {r.scannedAt?.toDate?.()?.toLocaleString?.() || ''} ·
            KB: {r.kbVersion} ·
            New: {r.newDocuments?.length || 0} ·
            Changed: {r.changedDocuments?.length || 0} ·
            Stale modules: {r.staleKbModules?.length || 0}
          </div>
          {r.note && <div className="text-xs text-slate-500 mt-1">{r.note}</div>}
        </div>
      ))}
    </div>
  )
}
