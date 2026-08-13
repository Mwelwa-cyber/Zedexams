/**
 * usePaperResumeSync — records "last opened paper + page" for the
 * dashboard hero's Continue Reading block.
 *
 * It lives in `papers` rather than `learnerHome` because papers is what
 * CALLS it and what owns the page number it reads; learner-home is the
 * reader on the other side of the storage contract in
 * `src/shared/utils/paperResumeStorage.js`. Writing the learner's profile
 * from here is the same direction the viewer already writes localStorage in
 * — it is one feature publishing its own progress, not reaching into
 * another's internals.
 *
 * Write strategy (spec §6/§24 — no per-scroll writes):
 *   • localStorage mirror updates on mount and again when the learner
 *     leaves (unmount / tab hidden / pagehide), reading the page number
 *     the viewer already tracks in `paper-progress:{paperId}`.
 *   • Firestore (`learner_profiles/{uid}.lastSession.paperResume`)
 *     syncs at most at those same leave moments, debounced through a
 *     dirty flag — one or two writes per reading session, never per
 *     scroll. Cross-device resume resolves by `updatedAt` recency.
 */
import { useEffect } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { PAPER_RESUME_KEY, writeJson, readPaperPage } from '../../../shared/utils/paperResumeStorage'

export default function usePaperResumeSync({ paperId, paper, uid }) {
  useEffect(() => {
    if (!paperId || !paper) return undefined

    const paperPages = (paper.assets || []).filter(
      (a) => a && a.role !== 'mark-scheme' && String(a.contentType || '').startsWith('image/'),
    ).length

    const snapshot = () => ({
      paperId,
      title: paper.title || null,
      subject: paper.subject || null,
      year: paper.year ?? null,
      page: readPaperPage(paperId),
      totalPages: paperPages || null,
      updatedAt: Date.now(),
    })

    // Immediate local record so the dashboard reflects this open even
    // if the learner never scrolls.
    writeJson(PAPER_RESUME_KEY, snapshot())

    let synced = false
    const syncRemote = () => {
      if (synced || !uid) return
      synced = true
      const record = snapshot()
      writeJson(PAPER_RESUME_KEY, record)
      try {
        setDoc(
          doc(db, 'learner_profiles', uid),
          { lastSession: { paperResume: record } },
          { merge: true },
        ).catch(() => { /* best-effort; local mirror already saved */ })
      } catch { /* Firestore unavailable — local mirror already saved */ }
    }
    const onLeave = () => {
      writeJson(PAPER_RESUME_KEY, snapshot())
      syncRemote()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onLeave()
      else synced = false // returned to the tab — allow one more sync on next leave
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onLeave)
      onLeave()
    }
  }, [paperId, paper, uid])
}
