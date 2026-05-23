import { useEffect, useMemo, useState } from 'react'
import {
  listVersionsForContent, describeChangeType, diffContent, prettyJson,
} from '../../../utils/aiContentVersionsService'

// Admin-only modal that surfaces the full version history for one
// aiGeneratedContent doc. Powers the "Compare Versions" affordance
// on ArtifactCard + ExamDraftDetailPage.
//
// Layout:
//   - Left rail: scrollable list of every version (newest first).
//     Each row shows version number, changeType chip, changedBy,
//     changeReason (when present), createdAt. Each row has
//     two radios — "left" + "right" — for the side-by-side compare.
//   - Right pane: side-by-side comparison of the two selected
//     versions. Three tabs:
//       1. Diff      — flat list of differing leaf paths
//       2. Left JSON — pretty-printed snapshot of the older version
//       3. Right JSON — pretty-printed snapshot of the newer version
//
// Privacy: relies on the Firestore rule
// (aiGeneratedContentVersions admin-only-read) — never opens this
// component for learner users. The route mounting it is admin-gated
// upstream (ControlCentreLayout is inside an AdminRoute).

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

function VersionRow({ v, selectedLeft, selectedRight, onPickLeft, onPickRight }) {
  const meta = describeChangeType(v.changeType)
  return (
    <li className={`border-b border-slate-100 px-3 py-2 text-xs ${
      selectedLeft === v.id || selectedRight === v.id ? 'bg-blue-50' : ''
    }`}>
      <div className="flex items-center gap-2">
        <span className="font-bold tabular-nums text-slate-900">v{v.version}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${meta.cls}`}>
          {meta.label}
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600 truncate">{v.changedBy || '—'}</span>
        <span className="ml-auto text-slate-400 text-[10px]">{timeAgo(v.createdAt)}</span>
      </div>
      {v.changeReason && (
        <div className="text-slate-600 mt-0.5 line-clamp-2">
          <span className="font-semibold">Reason: </span>{v.changeReason}
        </div>
      )}
      <div className="flex gap-3 mt-1.5">
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio" name="left-version"
            checked={selectedLeft === v.id}
            onChange={() => onPickLeft(v.id)}
            className="h-3 w-3"
          />
          <span className="text-[10px] text-slate-600">left</span>
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio" name="right-version"
            checked={selectedRight === v.id}
            onChange={() => onPickRight(v.id)}
            className="h-3 w-3"
          />
          <span className="text-[10px] text-slate-600">right</span>
        </label>
      </div>
    </li>
  )
}

function DiffView({ left, right }) {
  const diffs = useMemo(
    () => diffContent(left && left.content, right && right.content),
    [left, right],
  )
  if (!left || !right) {
    return <p className="text-xs text-slate-500 p-3">Pick a left + right version to compare.</p>
  }
  if (left.id === right.id) {
    return <p className="text-xs text-slate-500 p-3">Same version selected on both sides.</p>
  }
  if (diffs.length === 0) {
    return (
      <p className="text-xs text-emerald-700 p-3">
        Content is identical between v{left.version} and v{right.version}.
        (Only status / metadata changed — e.g. an approval that didn't
        touch the content payload.)
      </p>
    )
  }
  return (
    <div className="p-3">
      <div className="text-xs text-slate-600 mb-2">
        Showing <strong>{diffs.length}</strong> differing field{diffs.length === 1 ? '' : 's'}{' '}
        between v{left.version} ({left.changeType}) and v{right.version} ({right.changeType}).
      </div>
      <ul className="space-y-2">
        {diffs.map((d, i) => (
          <li key={i} className="border border-slate-200 rounded-md overflow-hidden">
            <div className="bg-slate-50 px-2 py-1 text-[10px] font-mono text-slate-700 border-b border-slate-200">
              {d.path}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-x divide-slate-200 text-xs">
              <pre className="p-2 bg-rose-50 text-rose-900 whitespace-pre-wrap break-all overflow-x-auto max-h-40">
                {stringify(d.leftValue)}
              </pre>
              <pre className="p-2 bg-emerald-50 text-emerald-900 whitespace-pre-wrap break-all overflow-x-auto max-h-40">
                {stringify(d.rightValue)}
              </pre>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function stringify(v) {
  if (v === undefined) return '<missing>'
  if (v === null) return 'null'
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function JsonView({ snapshot }) {
  if (!snapshot) {
    return <p className="text-xs text-slate-500 p-3">Pick a version.</p>
  }
  return (
    <pre className="p-3 text-[11px] leading-snug whitespace-pre-wrap break-all overflow-x-auto max-h-[60vh] bg-slate-50 border-t border-slate-200">
      {prettyJson(snapshot.content)}
    </pre>
  )
}

export default function CompareVersionsPanel({ contentId, onClose }) {
  const [versions, setVersions] = useState([])
  const [err, setErr] = useState(null)
  const [leftId, setLeftId] = useState(null)
  const [rightId, setRightId] = useState(null)
  const [tab, setTab] = useState('diff')  // 'diff' | 'left' | 'right'

  useEffect(() => {
    if (!contentId) return undefined
    const unsub = listVersionsForContent({
      contentId,
      onChange: vs => {
        setVersions(vs)
        // Default selection: oldest on the left, newest on the right.
        if (vs.length >= 2) {
          setLeftId(prev => prev || vs[vs.length - 1].id)
          setRightId(prev => prev || vs[0].id)
        } else if (vs.length === 1) {
          setLeftId(vs[0].id)
          setRightId(vs[0].id)
        }
      },
      onError: e => setErr(e.message),
    })
    return () => unsub()
  }, [contentId])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const left = useMemo(() => versions.find(v => v.id === leftId) || null, [versions, leftId])
  const right = useMemo(() => versions.find(v => v.id === rightId) || null, [versions, rightId])

  return (
    <div role="dialog" aria-modal="true" aria-label="Version history"
         className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center px-3">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Version history</h3>
            <div className="text-[11px] text-slate-500">
              Audit trail for <code className="font-mono">{contentId}</code>
              {' · '}{versions.length} version{versions.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-700 text-2xl leading-none px-1"
          >
            ×
          </button>
        </header>

        {err && (
          <div className="px-4 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-200">
            {err}
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_1fr]">
          <aside className="border-r border-slate-200 overflow-y-auto min-h-[200px] max-h-[70vh]">
            {versions.length === 0 ? (
              <p className="text-xs text-slate-500 p-3">
                No versions recorded yet. Versions appear here once the
                generator emits content or an admin acts on the linked
                task.
              </p>
            ) : (
              <ul>
                {versions.map(v => (
                  <VersionRow
                    key={v.id} v={v}
                    selectedLeft={leftId} selectedRight={rightId}
                    onPickLeft={setLeftId} onPickRight={setRightId}
                  />
                ))}
              </ul>
            )}
          </aside>
          <main className="overflow-y-auto min-h-[200px] max-h-[70vh]">
            <nav className="px-3 pt-2 flex gap-1 border-b border-slate-200 bg-white sticky top-0 z-10">
              <TabBtn active={tab === 'diff'}  onClick={() => setTab('diff')}>Diff</TabBtn>
              <TabBtn active={tab === 'left'}  onClick={() => setTab('left')}>
                Left JSON{left ? ` (v${left.version})` : ''}
              </TabBtn>
              <TabBtn active={tab === 'right'} onClick={() => setTab('right')}>
                Right JSON{right ? ` (v${right.version})` : ''}
              </TabBtn>
            </nav>
            {tab === 'diff'  && <DiffView left={left} right={right} />}
            {tab === 'left'  && <JsonView snapshot={left} />}
            {tab === 'right' && <JsonView snapshot={right} />}
          </main>
        </div>

        <footer className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600">
          Admin-only view. Learners never see version history. Snapshots
          are append-only — no version is ever overwritten or deleted.
        </footer>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-bold px-3 py-1.5 rounded-t border-b-2 transition-colors ${
        active ?
          'border-blue-600 text-blue-700 bg-white' :
          'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}
