// src/features/notes/pages/LearnerNoteRead.jsx
//
// /notes/:id — the learner note view (learner redesign step 8).
//
// One reading experience: reader-format study notes render full-screen
// through the prototype reader engine (Learn/Revise). Everything else
// is retired — the redesign removed the old note formats from the
// learner path, so a stale link or a not-yet-regenerated doc gets a
// warm handoff back to the revision hub instead of the legacy reader.
// (Slide-based docs still hand off to /lessons, and admin surfaces
// keep their own editors/previews for every format.)

import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, Navigate, useSearchParams } from 'react-router-dom'

import '../../../shared/styles/learnerTheme.css'
import { useOfflineNote } from '../hooks/useOfflineNote'
import { useRecordNoteProgress } from '../hooks/useRecordNoteProgress'
import { NOTE_FORMAT } from '../../../config/curriculum'
import ReaderEngine from '../reader/ReaderEngine'
import { isReaderNote } from '../reader/readerCore'
import { coerceStudyBlocks } from '../lib/studySchema'
import { SaveOfflineButton } from '../components/SaveOfflineButton'
import { readLearnStep, writeLearnStep } from '../lib/learnStep'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import TopLine from '../../../shared/components/TopLine'

function HubShell({ title, children }) {
  const navigate = useNavigate()
  return (
    <div className="lhx">
      <SeoHelmet title={title} noIndex />
      <div className="lhx-page">
        <div className="lhx-back-row">
          <button type="button" className="lhx-back-btn" aria-label="Back to Notes" onClick={() => navigate('/notes')}>‹</button>
          <div className="lhx-back-sub">Back to Notes</div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function LearnerNoteRead() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { note, loading, error } = useOfflineNote(id)

  // Which doorway the learner is standing in. Seeded from `?mode=` (the
  // Notes tab deep-links to Revise) and then owned by the reader's own
  // segment control, which reports back through onModeChange.
  const [mode, setMode] = useState(searchParams.get('mode') === 'revise' ? 'revise' : 'learn')

  // Records opened / scroll-% / completed for the signed-in learner —
  // in LEARN mode only. Revising is not re-learning: a scroll to the
  // bottom of the flat revise view is not evidence the guided pass was
  // made, and counting it would mark a never-taught topic complete.
  useRecordNoteProgress(mode === 'learn' && note?.noteFormat ? note : null)

  // Furthest Learn section reached on this device — what Revise's
  // "Learn this properly" resumes at.
  const resumeStep = useMemo(() => readLearnStep(id), [id])

  const handleModeChange = useCallback((next) => {
    setMode(next)
    // Keep the URL honest so a share/refresh reopens the same doorway.
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'revise') p.set('mode', 'revise')
        else p.delete('mode')
        return p
      },
      { replace: true },
    )
  }, [setSearchParams])

  const handleStepReached = useCallback((step) => writeLearnStep(id, step), [id])

  const studyData = useMemo(
    () => (note?.noteFormat === NOTE_FORMAT.STUDY ? coerceStudyBlocks(note.blocks) : null),
    [note],
  )

  if (loading) {
    // A skeleton of the note rather than a 20px spinner in the middle of a
    // blank screen. This is the screen the whole funnel exists to reach,
    // and on a slow Zambian connection its loading state is a real part of
    // reading a note — a shape that becomes the note reads as the page
    // arriving; a lone spinner reads as a wait of unknown length.
    // `aria-busy` + the status line are what a screen reader gets, since
    // the bars themselves are decorative.
    return (
      <div className="lhx" style={{ minHeight: '100vh' }} aria-busy="true">
        <SeoHelmet title="Note" noIndex />
        <TopLine fixed label="Loading note" />
        {/* `paddingBottom: 0` overrides the column's tab-bar clearance —
            the reader mounts bare (no nav to clear), so the default would
            add 138px of empty scroll under a loading state. */}
        <div className="lhx-page" style={{ paddingTop: 18, paddingBottom: 0 }}>
          <div className="lhx-card" style={{ padding: 20 }}>
            <span className="sr-only" role="status">Loading note…</span>
            {/* Kicker, title, then body — the note's own shape. */}
            <div className="lhx-skel" style={{ height: 11, width: '28%', marginBottom: 14 }} aria-hidden="true" />
            <div className="lhx-skel" style={{ height: 24, width: '75%', marginBottom: 20 }} aria-hidden="true" />
            {/* Written out rather than imported: `SectionSkeleton` lives
                in features/learnerHome, and features/notes reaching into
                a sibling feature is the edge `test:import-boundaries`
                records as debt. Seven bars is a paragraph's worth. */}
            {[100, 96, 99, 92, 97, 88, 55].map((w, i) => (
              <div key={i} className="lhx-skel" style={{ height: 13, width: `${w}%`, marginBottom: 10 }} aria-hidden="true" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !note) {
    return (
      <HubShell title="Note not found">
        <div className="lhx-card" style={{ padding: 20, textAlign: 'center' }}>
          <h1 className="lhx-back-title" style={{ marginBottom: 6 }}>Note not found</h1>
          <p className="lhx-back-sub">This note may have been unpublished or removed.</p>
          <div style={{ height: 14 }} />
          <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={() => navigate('/notes')}>
            Back to Notes
          </button>
        </div>
      </HubShell>
    )
  }

  // Slide-based docs landed here from an old bookmark — hand them off to
  // the lessons viewer so they don't render as broken notes.
  if (!note.noteFormat && Array.isArray(note.slides) && note.slides.length > 0) {
    return <Navigate to={`/lessons/${id}`} replace />
  }

  // The one learner reading experience: the prototype reader engine.
  if (note.noteFormat === NOTE_FORMAT.STUDY && isReaderNote(studyData)) {
    const kicker = [note.subject, note.grade ? `GRADE ${note.grade}` : null]
      .filter(Boolean).join(' · ').toUpperCase()
    return (
      <>
        <SeoHelmet title={note.title || 'Note'} path={`/notes/${id}`} noIndex />
        <ReaderEngine
          note={{ title: note.title, kicker }}
          blocks={studyData}
          initialMode={mode}
          resumeStep={resumeStep}
          onStepReached={handleStepReached}
          onModeChange={handleModeChange}
          onBack={() => navigate('/notes')}
          footer={<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><SaveOfflineButton note={note} /></div>}
        />
      </>
    )
  }

  // Every other format is retired from the learner path (step 8).
  return (
    <HubShell title={note.title || 'Note'}>
      <div className="lhx-card" style={{ padding: 20, textAlign: 'center' }}>
        <img
          src="/images/characters/poses/zed-thinking.webp"
          alt=""
          aria-hidden="true"
          style={{ width: 96, height: 120, objectFit: 'contain', margin: '0 auto 10px' }}
        />
        <h1 className="lhx-back-title" style={{ marginBottom: 6 }}>{note.title || 'This note'}</h1>
        <p className="lhx-back-sub" style={{ maxWidth: 300, margin: '0 auto' }}>
          This note is being rebuilt into the new reading experience — it
          will be back in the Notes tab soon, better than before.
        </p>
        <div style={{ height: 16 }} />
        <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={() => navigate('/notes')}>
          See available notes
        </button>
      </div>
    </HubShell>
  )
}
