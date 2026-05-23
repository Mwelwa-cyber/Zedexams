import { useEffect, useMemo, useState } from 'react'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import ArtifactCard from './ArtifactCard'
import ArtifactFilters from './ArtifactFilters'
import MarkingGuidePanel from './MarkingGuidePanel'
import RegenerateWithNotesModal from './RegenerateWithNotesModal'
import RunningTaskDetailDrawer from './RunningTaskDetailDrawer'

// Generic grid over aiGeneratedContent for the 5 content-type tabs
// + Failed Checks. Drives every per-card action via the lookup
// table aiAgentTasks where resultContentId == artifactId.
//
// `typeFilter` (required for content tabs) constrains the query at
// the Firestore layer. `extraFilter(doc)` is a client-side predicate
// the Failed Checks tab uses to surface only failed verdicts.

const DEFAULT_FILTERS = {
  search: '', status: 'all', grade: 'all', subject: 'all', topic: 'all',
}

export default function ArtifactGrid({
  typeFilter,                       // required: 'practice_quiz' | 'exam_quiz' | ...
  extraFilter,                      // optional clientside predicate
  emptyHint,                        // string when nothing matches the filters
  pageSize = 60,
}) {
  const [artifacts, setArtifacts] = useState([])
  const [linkedTasks, setLinkedTasks] = useState({})    // artifactId → taskId
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [err, setErr] = useState(null)

  // Drawer + modal state.
  const [viewTaskId, setViewTaskId] = useState(null)
  const [markingArtifact, setMarkingArtifact] = useState(null)
  const [regenState, setRegenState] = useState(null)    // { taskId, mode }

  // Listen to aiGeneratedContent filtered by type.
  useEffect(() => {
    if (!typeFilter) {
      setArtifacts([])
      return undefined
    }
    const q = query(
      collection(db, 'aiGeneratedContent'),
      where('type', '==', typeFilter),
      orderBy('createdAt', 'desc'),
      fsLimit(pageSize),
    )
    const unsub = onSnapshot(
      q,
      snap => {
        setArtifacts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setErr(null)
      },
      e => setErr(e.message),
    )
    return () => unsub()
  }, [typeFilter, pageSize])

  // Resolve linked task IDs (one listener over aiAgentTasks where
  // resultContentId in artifactIds). Firestore `in` supports up to
  // 30 values, so we chunk if more.
  useEffect(() => {
    const ids = artifacts.map(a => a.id).filter(Boolean)
    if (!ids.length) {
      setLinkedTasks({})
      return undefined
    }
    const chunks = []
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30))
    const unsubs = chunks.map(chunk => onSnapshot(
      query(
        collection(db, 'aiAgentTasks'),
        where('resultContentId', 'in', chunk),
      ),
      snap => {
        setLinkedTasks(prev => {
          const next = { ...prev }
          snap.forEach(d => {
            const data = d.data() || {}
            if (data.resultContentId) next[data.resultContentId] = d.id
          })
          return next
        })
      },
      () => { /* swallow — linked-task resolution is best-effort */ },
    ))
    return () => unsubs.forEach(u => u())
  }, [artifacts])

  // Stitch linked task IDs onto each artifact (used by the card's
  // action buttons).
  const stitched = useMemo(() =>
    artifacts.map(a => ({ ...a, _linkedTaskId: linkedTasks[a.id] || null })),
  [artifacts, linkedTasks])

  // Apply client-side filters.
  const filtered = useMemo(() => {
    const needle = (filters.search || '').toLowerCase().trim()
    return stitched.filter(a => {
      if (filters.status !== 'all' && a.status !== filters.status) return false
      if (filters.grade !== 'all' && String(a.grade) !== filters.grade) return false
      if (filters.subject !== 'all' && a.subject !== filters.subject) return false
      if (filters.topic !== 'all' && a.topic !== filters.topic) return false
      if (extraFilter && !extraFilter(a)) return false
      if (!needle) return true
      const hay = [
        a.topic, a.subtopic, a.subject,
        a.content && a.content.title,
        a.content && a.content.description,
        a.content && a.content.shortExplanation,
        a.content && a.content.summary,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(needle)
    })
  }, [stitched, filters, extraFilter])

  // Derive known-value lists for the filter dropdowns (client-side
  // — avoids a separate facets query).
  const knownGrades = useMemo(() => uniq(stitched.map(a => String(a.grade)).filter(Boolean)), [stitched])
  const knownSubjects = useMemo(() => uniq(stitched.map(a => a.subject).filter(Boolean)), [stitched])
  const knownTopics = useMemo(() => uniq(stitched.map(a => a.topic).filter(Boolean)), [stitched])

  return (
    <div>
      <ArtifactFilters
        value={filters}
        onChange={setFilters}
        knownGrades={knownGrades}
        knownSubjects={knownSubjects}
        knownTopics={knownTopics}
      />

      {err && (
        <div className="text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded p-2 mb-3">
          Failed to load: {err}
        </div>
      )}

      <div className="text-xs text-slate-500 mb-2">
        Showing {filtered.length} of {stitched.length} {typeFilter} artifacts.
        {stitched.length === pageSize && ` (Cap: ${pageSize} — older artifacts not loaded.)`}
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-12 border border-dashed border-slate-200 rounded-lg">
          {stitched.length === 0 ?
            (emptyHint || `No ${typeFilter} artifacts yet.`) :
            'No artifacts match the current filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(a => (
            <ArtifactCard
              key={a.id}
              artifact={a}
              onView={art => setViewTaskId(art._linkedTaskId)}
              onMarkingGuide={art => setMarkingArtifact(art.content)}
              onRegenerate={(art, mode) => setRegenState({ taskId: art._linkedTaskId, mode })}
            />
          ))}
        </div>
      )}

      {viewTaskId && (
        <RunningTaskDetailDrawer taskId={viewTaskId} onClose={() => setViewTaskId(null)} />
      )}
      {markingArtifact && (
        <MarkingGuidePanel content={markingArtifact} onClose={() => setMarkingArtifact(null)} />
      )}
      {regenState && (
        <RegenerateWithNotesModal
          taskId={regenState.taskId}
          mode={regenState.mode}
          onClose={() => setRegenState(null)}
        />
      )}
    </div>
  )
}

function uniq(arr) {
  return [...new Set(arr)].sort()
}
