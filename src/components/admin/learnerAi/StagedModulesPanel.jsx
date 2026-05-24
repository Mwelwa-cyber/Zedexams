import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import ControlCentreLayout from './ControlCentreLayout'
import {
  listStagedCurriculumModules,
  promoteCurriculumModule,
  promoteCurriculumModuleWithAi,
  rejectCurriculumModule,
} from '../../../utils/stagedCurriculumModules'

// Admin queue for curriculumWatcher-ingested modules. Each row is one
// `curriculum/{id}` doc that the agent staged into the private RAG
// layer. Admin can either:
//   - Promote → server callable upserts a stub topic into
//     cbcKnowledgeBase/{activeVersion}/topics/{topicId} (merge:true,
//     so any rich admin edits are preserved). Admin still fills the
//     outcomes / subtopics / competencies via /admin/cbc-kb.
//   - Reject → flips reviewStatus to 'rejected' so the row drops out
//     of the queue. The underlying RAG chunks are NOT deleted.
//
// The list is loaded via callable (not a direct Firestore subscription)
// because firestore.rules close `curriculum/*` to all clients.

const CONFIDENCE_CLASSES = {
  high:   'bg-emerald-50 text-emerald-800 border-emerald-300',
  medium: 'bg-amber-50 text-amber-800 border-amber-300',
  low:    'bg-rose-50 text-rose-700 border-rose-300',
}

function ConfidencePill({ confidence }) {
  const cls = CONFIDENCE_CLASSES[confidence] || 'bg-slate-100 text-slate-700 border-slate-300'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {confidence || 'unknown'}
    </span>
  )
}

function formatGrade(g) {
  if (g == null) return '—'
  if (typeof g === 'number') return `Grade ${g}`
  return String(g)
}

function formatImportedAt(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch { return '' }
}

export default function StagedModulesPanel() {
  const { isAdmin } = useAuth()
  const [modules, setModules] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await listStagedCurriculumModules()
    if (!result.ok) {
      setError(result.error)
      setModules([])
    } else {
      setModules(result.modules)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      setError('Admin only.')
      setLoading(false)
      return
    }
    load()
  }, [isAdmin, load])

  async function handlePromote(m) {
    if (!confirm(
      `Promote "${m.topic || '(no topic)'}" to the canonical CBC knowledge base?\n\n` +
      `This creates a STUB topic under ${formatGrade(m.grade)} / ${m.subject || '(no subject)'}. ` +
      'You’ll still need to fill in subtopics + outcomes via /admin/cbc-kb.',
    )) return
    setBusyId(m.curriculumId)
    setError(null)
    setNotice(null)
    const result = await promoteCurriculumModule(m.curriculumId)
    if (!result.ok) {
      setError(result.error)
    } else {
      const where = result.alreadyPromoted ?
        `already promoted as ${result.topicId}` :
        `promoted to topic ${result.topicId} (version ${result.version})`
      setNotice(`"${m.topic || m.curriculumId}" — ${where}.`)
      await load()
    }
    setBusyId(null)
  }

  async function handlePromoteWithAi(m) {
    if (!confirm(
      `Promote "${m.topic || '(no topic)'}" using AI?\n\n` +
      `Claude will read the staged RAG chunks for this module and extract ` +
      `subtopics, specific outcomes, key competencies, values, and ` +
      `suggested materials before writing the topic to the canonical KB.\n\n` +
      `Cost: ~$0.02 per call. Takes ~10–30 seconds. The result is marked ` +
      `reviewStatus:"needs_review" so you can edit it in /admin/cbc-kb.`,
    )) return
    setBusyId(m.curriculumId)
    setError(null)
    setNotice(null)
    const result = await promoteCurriculumModuleWithAi(m.curriculumId)
    if (!result.ok) {
      setError(result.error)
    } else {
      const e = result.enrichment || {}
      const counts = result.alreadyPromoted ?
        'already promoted' :
        `${e.subtopicsCount || 0} subtopics, ${e.outcomesCount || 0} outcomes, ` +
        `${e.competenciesCount || 0} competencies, ${e.valuesCount || 0} values, ` +
        `${e.materialsCount || 0} materials`
      setNotice(
        `"${m.topic || m.curriculumId}" — promoted to ${result.topicId} ` +
        `with AI enrichment (${counts}). Review in /admin/cbc-kb.`,
      )
      await load()
    }
    setBusyId(null)
  }

  async function handleReject(m) {
    const reason = prompt(
      `Reject "${m.topic || '(no topic)'}"?\n\n` +
      'Optional: enter a short reason (recorded for audit). The underlying RAG chunks ' +
      'are NOT deleted — only the queue row is removed.',
      '',
    )
    if (reason === null) return // cancelled
    setBusyId(m.curriculumId)
    setError(null)
    setNotice(null)
    const result = await rejectCurriculumModule(m.curriculumId, reason || null)
    if (!result.ok) {
      setError(result.error)
    } else {
      setNotice(`"${m.topic || m.curriculumId}" — rejected.`)
      await load()
    }
    setBusyId(null)
  }

  return (
    <ControlCentreLayout title="Staged curriculum modules">
      <p className="text-sm text-slate-600 mb-4 max-w-3xl">
        Modules the <strong>curriculum watcher</strong> agent downloaded and
        parsed from the trusted Zambian source whitelist (CDC Repository,
        Ministry of Education, ECZ). Each row is searchable now via the
        private-RAG layer; click <em>Promote</em> to also add it as a stub
        in the canonical CBC knowledge base so teachers see it in topic
        dropdowns. Outcomes + subtopics still need to be filled in
        manually via <code>/admin/cbc-kb</code>.
      </p>

      {notice && (
        <div className="mb-3 px-3 py-2 rounded border border-emerald-300 bg-emerald-50 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 rounded border border-rose-300 bg-rose-50 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="text-xs text-slate-500">
          {modules.length} staged module(s) awaiting review
        </span>
      </div>

      {!loading && modules.length === 0 && !error && (
        <div className="border border-dashed border-slate-300 rounded p-6 text-center text-sm text-slate-500">
          No staged modules. The curriculum watcher will queue new modules here
          the next time it detects a change on a whitelisted source.
        </div>
      )}

      <ul className="space-y-3">
        {modules.map((m) => (
          <li
            key={m.curriculumId}
            className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">
                    {m.topic || <span className="italic text-slate-400">(no topic detected)</span>}
                  </h3>
                  <ConfidencePill confidence={m.confidence} />
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatGrade(m.grade)} · {m.subject || '—'}
                  {m.term ? ` · Term ${m.term}` : ''}
                  {' · '}{m.parsedFrom || '—'}
                  {m.chunkCount ? ` · ${m.chunkCount} chunk(s)` : ''}
                </div>
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => handlePromoteWithAi(m)}
                  disabled={busyId === m.curriculumId}
                  title="Run Claude over the RAG chunks to fill subtopics + outcomes automatically (~$0.02, ~10–30s)"
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {busyId === m.curriculumId ? 'Working…' : 'Promote with AI'}
                </button>
                <button
                  type="button"
                  onClick={() => handlePromote(m)}
                  disabled={busyId === m.curriculumId}
                  title="Create a stub topic; admin fills outcomes by hand in /admin/cbc-kb"
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Promote (stub)
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(m)}
                  disabled={busyId === m.curriculumId}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-rose-700 border border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-600 break-all">
              <span className="text-slate-400">Source: </span>
              <a
                href={m.sourceUrl || '#'}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-700 hover:underline"
              >
                {m.sourceName || m.sourceUrl || m.source || '—'}
              </a>
            </div>
            {m.anchorText && (
              <div className="text-xs text-slate-500 mt-1 italic">
                Link text: &ldquo;{m.anchorText}&rdquo;
              </div>
            )}
            <div className="text-[11px] text-slate-400 mt-2">
              Imported {formatImportedAt(m.importedAt) || '(no timestamp)'}
              {' · '}id <code className="text-slate-500">{m.curriculumId}</code>
            </div>
          </li>
        ))}
      </ul>
    </ControlCentreLayout>
  )
}
