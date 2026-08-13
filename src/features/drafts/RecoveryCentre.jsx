/**
 * Recovery Centre / Draft Dashboard — /teacher/drafts
 *
 * One place for a teacher to see every in-progress draft the Universal Draft
 * Manager is holding across all studios (cloud + this device), and to resume or
 * discard any of them. Read-mostly: it reuses the shipped list/delete helpers
 * and changes nothing about how studios save or recover.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import useStudioAvailability from '../../hooks/useStudioAvailability'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { listDraftsRemote, deleteDraftRemote } from '../../hooks/draft/draftCloudSync'
import { idbListDrafts, idbDeleteDraft } from '../../hooks/draft/draftIdbStore'
import { TOOL_META } from '../../utils/teacherLibraryService'
import { timeAgo } from '../../utils/gamificationService'
import StudioPageHeader from '../../shared/components/StudioPageHeader'
import SeoHelmet from '../../components/seo/SeoHelmet'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/Toast'
import {
  mergeDraftLists,
  studioLabel,
  summarizeDraft,
  resumeRoute,
  syncStatus,
} from './draftDashboard.js'

// Icons for the studioIds TOOL_META (teacherLibraryService) doesn't carry.
const EXTRA_ICONS = { sba_task: '🧪', sba_tracker: '🧮', sba_planner: '🗂️' }
const iconFor = (studioId) => TOOL_META[studioId]?.icon || EXTRA_ICONS[studioId] || '📝'

export default function RecoveryCentre() {
  const { currentUser } = useAuth()
  // A draft for a studio that is no longer offered is still the teacher's — it
  // is listed, and it can still be discarded. What it loses is "Continue
  // editing", which would bounce off the studio's redirect.
  const { isAvailable, retiredLabel } = useStudioAvailability()
  const navigate = useNavigate()
  const online = useNetworkStatus()
  const toast = useToast()
  const uid = currentUser?.uid

  const [status, setStatus] = useState('loading') // loading | ready | error
  const [rows, setRows] = useState([])
  const [pendingDiscard, setPendingDiscard] = useState(null)
  const [discarding, setDiscarding] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    if (!uid) return
    setStatus('loading')
    try {
      const [remote, local] = await Promise.all([
        listDraftsRemote({ uid }).catch(() => []),
        idbListDrafts({ uid }).catch(() => []),
      ])
      if (!mountedRef.current) return
      setRows(mergeDraftLists(local, remote))
      setStatus('ready')
    } catch {
      if (mountedRef.current) setStatus('error')
    }
  }, [uid])

  useEffect(() => { load() }, [load])

  const confirmDiscard = useCallback(async () => {
    const row = pendingDiscard
    if (!row) return
    setDiscarding(true)
    try {
      await Promise.all([
        deleteDraftRemote({ uid, draftId: row.draftId }),
        idbDeleteDraft({ studioId: row.studioId, uid, draftId: row.draftId }),
      ])
      if (mountedRef.current) {
        setRows((list) => list.filter((r) => r.draftId !== row.draftId))
        toast.info('Draft discarded.')
      }
    } catch {
      if (mountedRef.current) toast.error('Could not discard the draft. Please try again.')
    } finally {
      if (mountedRef.current) { setDiscarding(false); setPendingDiscard(null) }
    }
  }, [pendingDiscard, uid, toast])

  return (
    <div className="studio-page">
      <SeoHelmet title="Recovery Centre" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="Recovery Centre"
          title="Your unfinished drafts"
          subtitle="Everything you've started but not yet saved to the library — auto-protected on this device and, when online, in the cloud. Pick up where you left off, or clear one out."
          emoji="🗂️"
        />

        {status === 'loading' && (
          <div className="studio-card p-10 text-center text-sm theme-text-secondary">Loading your drafts…</div>
        )}

        {status === 'error' && (
          <div className="studio-card p-10 text-center text-sm">
            <p className="mb-3">We couldn't load your drafts just now.</p>
            <button type="button" onClick={load} className="studio-btn-ghost">
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && rows.length === 0 && (
          <div className="studio-card p-12 text-center">
            <div className="text-4xl mb-3" aria-hidden="true">✨</div>
            <h2 className="studio-display" style={{ fontSize: 20 }}>No drafts in progress</h2>
            <p className="text-sm max-w-md mx-auto mt-1 theme-text-secondary">
              When you start work in any studio it's auto-saved here until you save it to your library.
              Nothing to recover right now — you're all caught up.
            </p>
          </div>
        )}

        {status === 'ready' && rows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {rows.map((row) => {
              const sync = syncStatus(row.source)
              const summary = summarizeDraft(row.studioId, row.payload)
              const resumable = isAvailable(row.studioId)
              const retired = retiredLabel(row.studioId)
              return (
                <div key={row.draftId} className="studio-card p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0" aria-hidden="true">{iconFor(row.studioId)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{studioLabel(row.studioId)}</span>
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium ring-1 ring-black/5"
                          title={online ? sync.label : 'Offline — will sync when you reconnect'}
                        >
                          <span aria-hidden="true">{sync.icon}</span>{sync.label}
                        </span>
                      </div>
                      {summary && <p className="text-sm theme-text-secondary truncate">{summary}</p>}
                      <p className="text-xs theme-text-secondary mt-0.5">Last edited {timeAgo(row.savedAt)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end items-center">
                    {!resumable && retired && (
                      <span className="mr-auto text-xs theme-text-secondary">{retired}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingDiscard(row)}
                      className="studio-btn-ghost text-xs text-rose-700"
                    >
                      Discard
                    </button>
                    {resumable && (
                      <button
                        type="button"
                        onClick={() => navigate(resumeRoute(row.studioId, row.draftId))}
                        className="studio-btn-primary text-xs"
                      >
                        Continue editing
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDiscard)}
        title="Discard this draft?"
        message={
          pendingDiscard
            ? `This permanently deletes the unsaved ${studioLabel(pendingDiscard.studioId)} draft from this device and the cloud. Anything already saved to your library is not affected.`
            : ''
        }
        confirmLabel={discarding ? 'Discarding…' : 'Discard draft'}
        onConfirm={confirmDiscard}
        onCancel={() => setPendingDiscard(null)}
      />
    </div>
  )
}
