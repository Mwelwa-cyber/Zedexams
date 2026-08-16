// src/features/notes/pages/LearnerNoteRead.jsx
//
// /notes/:id — the reader view.
//
// Two render modes based on the note's noteFormat:
//   • 'rich_text' (default for new notes) → renders HTML content in a prose container
//   • 'file'                              → shows a download card (no inline PDF preview)
// Slide-based docs (no noteFormat, has slides[]) belong on /lessons/:id —
// if a learner lands here with a slide-based id we redirect to the
// lessons viewer instead of showing a fallback message.

import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useParams, Navigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Calendar, Download, FileType, Loader2 } from '../../../shared/components/icons'

import { useOfflineNote }     from '../hooks/useOfflineNote'
import { useRecordNoteProgress } from '../hooks/useRecordNoteProgress'
import { NOTE_FORMAT }        from '../../../config/curriculum'
import { formatDate }         from '../lib/format'
import { sanitizeNoteHTML }   from '../../../editor/utils/sanitize.js'
import { SlideNotesReader }   from '../components/SlideNotesReader'
import { StudyNoteReader }    from '../components/StudyNoteReader'
import ReaderEngine           from '../reader/ReaderEngine'
import { isReaderNote }       from '../reader/readerCore'
import { ReaderControls }     from '../components/ReaderControls'
import { ReaderPrefsMenu }    from '../components/ReaderPrefsMenu'
import { useReaderPrefs }     from '../hooks/useReaderPrefs'
import { NoteInsights }       from '../components/NoteInsights'
import { coerceStudyBlocks }  from '../lib/studySchema'
import { buildToc }           from '../lib/toc'
import { fetchNoteSmart }     from '../lib/smart'
import { useActiveSection }   from '../hooks/useActiveSection'
import { NoteToc }            from '../components/NoteToc'
import { BackToTop }          from '../components/BackToTop'
import { SaveOfflineButton }  from '../components/SaveOfflineButton'
import SeoHelmet              from '../../../shared/components/SeoHelmet'
import '../styles/notes.css'

const SUBJECT_STYLES = {
  'Mathematics':         { bg: '#EFF6FF', fg: '#1E40AF', border: '#BFDBFE' },
  'Integrated Science':  { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' },
  'Social Studies':      { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A' },
  'English':             { bg: '#FFF1F2', fg: '#9F1239', border: '#FECDD3' },
  'Technology Studies':  { bg: '#F5F3FF', fg: '#5B21B6', border: '#DDD6FE' },
  'Home Economics':      { bg: '#FDF2F8', fg: '#9D174D', border: '#FBCFE8' },
  'Expressive Art':      { bg: '#FCF7F3', fg: '#83372C', border: '#EFD1BC' },
}

const subjectStyle = (subject) =>
  SUBJECT_STYLES[subject] || { bg: '#F5F5F5', fg: '#404040', border: '#E5E5E5' }

export function LearnerNoteRead() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const wantsInsights = searchParams.get('insights') === '1'
  const { note, loading, error } = useOfflineNote(id)

  // Learner reading-comfort: text size, typeface, page background (persisted).
  const prefs = useReaderPrefs()

  // Records opened / scroll-% / completed for the signed-in learner. No-ops
  // until the note has loaded; ignores legacy slide docs (they redirect away).
  useRecordNoteProgress(note?.noteFormat ? note : null)

  // Derived study data + TOC. Computed as hooks (unconditionally, before the
  // early returns) so hook order is stable. Safe when `note` is null/loading.
  const studyData = useMemo(
    () => (note?.noteFormat === NOTE_FORMAT.STUDY ? coerceStudyBlocks(note.blocks) : null),
    [note],
  )
  const toc = useMemo(() => buildToc(studyData || []), [studyData])
  const anchorByIndex = useMemo(() => new Map(toc.map(e => [e.index, e.id])), [toc])
  const activeKey = useActiveSection(toc)

  const [highlightsOn, setHighlightsOn] = useState(() => {
    try { return localStorage.getItem('notes:hl') !== '0' } catch { return true }
  })
  const [highlightsByBlock, setHighlightsByBlock] = useState(null)
  const [sectionSummaries, setSectionSummaries] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (id && note?.noteFormat === NOTE_FORMAT.STUDY) {
      fetchNoteSmart(id).then(r => { if (!cancelled) { setHighlightsByBlock(r?.highlights || null); setSectionSummaries(r?.sections || null) } }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [id, note])
  const summaryByBlockId = useMemo(() => {
    const m = {}
    for (const s of sectionSummaries || []) { if (s?.key && s?.summary) m[s.key] = s.summary }
    return m
  }, [sectionSummaries])
  const toggleHighlights = () => setHighlightsOn(v => {
    const next = !v
    try { localStorage.setItem('notes:hl', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })
  const hasHighlights = !!highlightsByBlock && Object.keys(highlightsByBlock).length > 0

  if (loading) {
    return (
      <div className={`notes-studio ${prefs.pageClass} min-h-screen pb-24 lg:pb-8`}>
        <SeoHelmet title="Note" path={`/notes/${id}`} noIndex />
        <div className="min-h-[50vh] flex items-center justify-center text-neutral-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className={`notes-studio ${prefs.pageClass} min-h-screen pb-24 lg:pb-8`}>
        <SeoHelmet title="Note not found" path={`/notes/${id}`} noIndex />
        <div className="max-w-xl mx-auto px-4 sm:px-5 py-16 text-center">
          <h1 className="font-display text-3xl mb-2 text-[#0F1B2D]">Note not found</h1>
          <p className="text-sm text-[#4A5A6E] mb-6">
            This note may have been unpublished or removed.
          </p>
          <button
            onClick={() => navigate('/notes')}
            className="notes-chip notes-chip-shadow inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F1B2D] text-white text-sm font-semibold hover:-translate-y-px transition"
          >
            <ArrowLeft size={14} /> Back to all notes
          </button>
        </div>
      </div>
    )
  }

  // Slide-based docs landed here from an old bookmark — hand them off to
  // the lessons viewer so they don't render as broken notes.
  const isLegacySlides = !note.noteFormat && Array.isArray(note.slides) && note.slides.length > 0
  if (isLegacySlides) {
    return <Navigate to={`/lessons/${id}`} replace />
  }

  // Reader-engine study notes (learner redesign step 3): a study note
  // carrying any interactive reader block renders full-screen through
  // the prototype-v3 engine. The per-note gate is what lets the
  // pipeline retire old notes subject-by-subject — untouched notes keep
  // the legacy reader below until they are regenerated.
  if (note.noteFormat === NOTE_FORMAT.STUDY && isReaderNote(studyData)) {
    const kicker = [note.subject, note.grade ? `GRADE ${note.grade}` : null]
      .filter(Boolean).join(' · ').toUpperCase()
    return (
      <>
        <SeoHelmet title={note.title || 'Note'} path={`/notes/${id}`} noIndex />
        <ReaderEngine
          note={{ title: note.title, kicker }}
          blocks={studyData}
          initialMode={searchParams.get('mode') === 'revise' ? 'revise' : 'learn'}
          onBack={() => navigate('/notes')}
          footer={<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><SaveOfflineButton note={note} /></div>}
        />
      </>
    )
  }

  const s = subjectStyle(note.subject)
  const studyBlocks = studyData

  return (
    <div className={`notes-studio ${prefs.pageClass} min-h-screen pb-24 lg:pb-8`}>
      <SeoHelmet title={note.title || 'Note'} path={`/notes/${id}`} noIndex />
      <main className="max-w-2xl mx-auto px-4 sm:px-5 py-8">
        <button
          onClick={() => navigate('/notes')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F1B2D] hover:text-[#A3422E] transition mb-8"
        >
          <ArrowLeft size={15} /> All notes
        </button>

        <article>
          <div className="flex flex-wrap gap-2 items-center mb-5">
            <span
              className="inline-flex items-center text-xs font-semibold rounded-full border-2 px-2.5 py-1"
              style={{ backgroundColor: s.bg, color: s.fg, borderColor: '#0F1B2D' }}
            >
              {note.subject}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F1B2D] bg-white border border-[#0F1B2D] px-2 py-0.5 rounded-full">
              Grade {note.grade}
            </span>
            <span className="text-xs text-[#4A5A6E] inline-flex items-center gap-1">
              <Calendar size={11} /> Published {formatDate(note.publishedAt)}
            </span>
            <span className="ml-auto">
              <SaveOfflineButton note={note} />
            </span>
          </div>

          <h1 className="font-display text-3xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05] mb-6 text-[#0F1B2D]">
            {note.title}
          </h1>

          {note.excerpt && (
            <p className="text-lg text-neutral-600 mb-8 font-display-italic leading-relaxed">
              {note.excerpt}
            </p>
          )}

          <hr className="my-8 border-0 border-t-2 border-dashed border-[#D8D0BC]" />

          {note.noteFormat !== NOTE_FORMAT.FILE && (
            <NoteInsights noteId={id} autoOpen={wantsInsights} />
          )}

          {note.noteFormat === NOTE_FORMAT.FILE ? (
            <FileDownload note={note} />
          ) : note.noteFormat === NOTE_FORMAT.VISUAL ? (
            <SlideNotesReader deck={note.deck} />
          ) : note.noteFormat === NOTE_FORMAT.STUDY ? (
            <>
              <ReaderPrefsMenu {...prefs} />
              <ReaderControls blocks={studyBlocks} title={note.title}
                highlightsOn={highlightsOn} onToggleHighlights={toggleHighlights} hasHighlights={hasHighlights} />
              <div className={prefs.bodyClass}>
                <StudyNoteReader blocks={studyBlocks} anchorByIndex={anchorByIndex}
                  highlightsByBlock={highlightsByBlock} highlightsOn={highlightsOn} summaryByBlockId={summaryByBlockId} />
              </div>
            </>
          ) : (
            <>
              <ReaderPrefsMenu {...prefs} />
              <div className={prefs.bodyClass}>
                <div
                  className="prose-note"
                  dangerouslySetInnerHTML={{ __html: sanitizeNoteHTML(note.content) || '<p>This note has no content yet.</p>' }}
                />
              </div>
            </>
          )}

          <hr className="my-10 border-0 border-t-2 border-dashed border-[#D8D0BC]" />

          <div className="flex items-center justify-between text-sm text-[#4A5A6E]">
            <span>Last updated {formatDate(note.updatedAt)}</span>
            {note.noteFormat === NOTE_FORMAT.FILE && note.fileUrl && (
              <a
                href={note.fileUrl}
                download={note.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="notes-chip notes-chip-shadow inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:-translate-y-px transition text-[#0F1B2D] font-semibold"
              >
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </article>
        {note.noteFormat === NOTE_FORMAT.STUDY && (
          <>
            <NoteToc toc={toc} activeKey={activeKey} summaryByKey={summaryByBlockId} />
            <BackToTop />
          </>
        )}
      </main>
    </div>
  )
}

function FileDownload({ note }) {
  return (
    <div className="notes-card p-8 text-center my-6">
      <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-red-100 border-2 border-[#0F1B2D]" style={{ boxShadow: '0 2px 0 #0F1B2D' }}>
        <FileType size={28} className="text-red-600" />
      </div>
      <h3 className="font-display text-2xl mb-1 text-[#0F1B2D]">{note.fileName || 'Download'}</h3>
      <p className="text-sm text-[#4A5A6E] mb-5">
        Tap below to open or save this note as a PDF.
      </p>
      <a
        href={note.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="notes-chip notes-chip-shadow inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-bold hover:-translate-y-px transition"
        style={{ backgroundColor: '#D97757' }}
      >
        <Download size={15} /> Download PDF
      </a>
    </div>
  )
}

