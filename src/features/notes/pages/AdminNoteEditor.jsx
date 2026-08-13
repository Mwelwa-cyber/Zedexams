// src/features/notes/pages/AdminNoteEditor.jsx
//
// /admin/lessons/new        — create a new note
// /admin/lessons/:id/edit   — edit an existing note
//
// Behaviour:
//   • Title + subject + grade are required to save.
//   • The first save creates the doc; subsequent saves update it.
//   • File uploads (in file mode) require the doc to exist first — the user
//     is prompted to save the draft before the uploader is enabled.
//   • Auto-save fires 1.5 s after the last edit.
//   • Publish flips status; unpublish moves back to draft.
//   • Existing slide-built lessons (noteFormat='slides' or with a slides[]
//     array) are read-only here — the new editor doesn't render slide
//     builders. They stay viewable for learners via LessonPlayer.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  ArrowLeft, Save, FileText, Upload, Trash2, Check, Clock, Loader2, Layout,
  Sparkles,
} from '../../../components/ui/icons'
import { useAuth } from '../../../contexts/AuthContext'
import { NOTE_FORMAT, NOTE_STATUS } from '../../../config/curriculum'
import app from '../../../firebase/config'

// generateNotePictures can take several minutes per note (sequential image
// generation + Storage uploads) — give it a generous client-side timeout.
const functionsInstance = getFunctions(app, 'us-central1')
const generateNotePicturesCallable = httpsCallable(
  functionsInstance,
  'generateNotePictures',
  { timeout: 600_000 },
)

import { useNote } from '../hooks/useNote'
import { generateNoteSmart, smartErrorMessage } from '../lib/smart'
import { createNote, updateNote, deleteNote } from '../lib/firestore'
import { buildExcerpt } from '../lib/format'
import { blankStudyBlocks, buildStudyExcerpt, isStudyBlocksOverSize } from '../lib/studyBlocks'
import { coerceStudyBlocks } from '../lib/studySchema'

import { NoteMetaPanel } from '../components/NoteMetaPanel'
import { NoteEditor }    from '../components/NoteEditor'
import { StudyNoteEditor } from '../components/StudyNoteEditor'
import { NoteUploader }  from '../components/NoteUploader'
import { PublishToggle } from '../components/PublishToggle'
import { SlideNotesReader } from '../components/SlideNotesReader'
import SeoHelmet         from '../../../components/seo/SeoHelmet'
import ConfirmDialog     from '../../../components/ui/ConfirmDialog'
import { useToast }      from '../../../components/ui/Toast'
import '../styles/notes.css'

const AUTOSAVE_DELAY_MS = 1500

let noCryptoBatchSeq = 0

const makeAssetBatchId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `notes-${crypto.randomUUID().slice(0, 8)}`
  }
  // Non-secure contexts lack randomUUID but still have getRandomValues.
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(3))
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `notes-${Date.now()}-${hex}`
  }
  // No Web Crypto at all: an un-filled Uint8Array is zeroes, so this appended
  // a constant `000000` and two batches started in the same millisecond shared
  // a batch id. A process-local counter keeps them apart without Math.random.
  noCryptoBatchSeq += 1
  return `notes-${Date.now()}-${noCryptoBatchSeq.toString(36).padStart(6, '0')}`
}

export function AdminNoteEditor() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isNew = !id

  const { currentUser } = useAuth()
  const toast = useToast()
  const { note, loading } = useNote(id)

  // ── form state ──────────────────────────────────────────────────────
  const [docId,        setDocId]        = useState(id || null)
  const [title,        setTitle]        = useState('')
  const [subject,      setSubject]      = useState('')
  const [grade,        setGrade]        = useState(4)
  const [term,         setTerm]         = useState(null)
  const [week,         setWeek]         = useState(null)
  const [noteFormat,   setNoteFormat]   = useState(NOTE_FORMAT.STUDY)
  const [content,      setContent]      = useState('')
  const [blocks,       setBlocks]       = useState(() => isNew ? blankStudyBlocks() : [])
  const [fileMeta,     setFileMeta]     = useState(null)
  const [status,       setStatus]       = useState(NOTE_STATUS.DRAFT)
  // Generate the asset batch eagerly for new notes so inline image uploads
  // work before the first save. The same id is persisted on the doc on
  // first save so subsequent edits reuse the same Storage folder.
  const [assetBatchId, setAssetBatchId] = useState(() => isNew ? makeAssetBatchId() : null)

  const [saveState,  setSaveState]  = useState('idle')   // idle | saving | saved | error
  const [saveError,  setSaveError]  = useState(null)

  // Picture generation state: 'idle' | 'generating' | 'done' | 'error'
  const [picState,   setPicState]   = useState('idle')
  const [picResult,  setPicResult]  = useState(null)  // { succeeded, failed, skipped }

  // AI highlights generation state: 'idle' | 'loading' | 'done' | 'error'
  const [smartState, setSmartState] = useState('idle')
  const [smartMsg,   setSmartMsg]   = useState('')

  // Which action awaits ConfirmDialog approval — 'delete' | 'pictures' | null.
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const isLegacySlides = noteFormat === NOTE_FORMAT.SLIDES
    || (note && !note.noteFormat && Array.isArray(note.slides) && note.slides.length > 0)
  // AI visual slide-notes: not editable here (regenerate to change content),
  // but previewable and publishable via the standard toggle.
  const isVisual = noteFormat === NOTE_FORMAT.VISUAL

  // Hydrate the form when the note loads.
  useEffect(() => {
    if (!note) return
    setDocId(note.id)
    setTitle(note.title || '')
    setSubject(note.subject || '')
    setGrade(note.grade ? Number(note.grade) : 4)
    setTerm(note.term == null ? null : Number(note.term))
    setWeek(note.week == null ? null : Number(note.week))
    setNoteFormat(note.noteFormat || (Array.isArray(note.slides) && note.slides.length > 0
      ? NOTE_FORMAT.SLIDES
      : NOTE_FORMAT.RICH_TEXT))
    setContent(note.content || '')
    setBlocks(coerceStudyBlocks(note.blocks))
    setFileMeta(note.fileUrl ? {
      url: note.fileUrl,
      fileName: note.fileName,
      size: note.fileSize,
      storagePath: note.storagePath,
      updatedAt: note.updatedAt,
    } : null)
    setStatus(note.status || NOTE_STATUS.DRAFT)
    // Reuse the doc's existing batch id; only generate one if this is an
    // older lesson that never had inline assets (rare).
    setAssetBatchId(note.assetBatchId || makeAssetBatchId())
  }, [note])

  // ── save logic ──────────────────────────────────────────────────────
  const saveTimeoutRef = useRef(null)
  const dirtyRef       = useRef(false)

  const canSave = title.trim() && subject && grade && currentUser?.uid && !isLegacySlides

  // Refs that mirror canSave / performSave so the autosave timer reads the
  // latest values when it fires, not the snapshot from when it was scheduled.
  // Without this, logging out within the 1.5 s debounce window leaves canSave
  // stale-true, and the timer calls performSave against a logged-out user.
  const canSaveRef     = useRef(canSave)
  const performSaveRef = useRef()
  canSaveRef.current = canSave

  const performSave = async () => {
    if (!canSave) return
    setSaveState('saving')
    setSaveError(null)

    try {
      // assetBatchId is generated on mount for new notes (so inline image
      // uploads work pre-save). Worst case we still defensively generate
      // one here.
      const batchId = assetBatchId || makeAssetBatchId()
      if (!assetBatchId) setAssetBatchId(batchId)

      const payload = {
        title,
        subject,
        grade,
        term,
        week,
        noteFormat,
        content:     noteFormat === NOTE_FORMAT.RICH_TEXT ? content : '',
        blocks:      noteFormat === NOTE_FORMAT.STUDY ? coerceStudyBlocks(blocks) : null,
        excerpt:     noteFormat === NOTE_FORMAT.RICH_TEXT ? buildExcerpt(content)
                     : noteFormat === NOTE_FORMAT.STUDY ? buildStudyExcerpt(blocks) : '',
        fileUrl:     noteFormat === NOTE_FORMAT.FILE ? (fileMeta?.url || null) : null,
        fileName:    noteFormat === NOTE_FORMAT.FILE ? (fileMeta?.fileName || null) : null,
        storagePath: noteFormat === NOTE_FORMAT.FILE ? (fileMeta?.storagePath || null) : null,
        fileSize:    noteFormat === NOTE_FORMAT.FILE ? (fileMeta?.size || null) : null,
        assetBatchId: batchId,
      }

      // Block a write that would exceed Firestore's per-document limit. The
      // helper measures the same coerced blocks we're about to save.
      if (noteFormat === NOTE_FORMAT.STUDY && isStudyBlocksOverSize(payload.blocks)) {
        setSaveError(new Error('This note is too large to save (over ~700 KB). Split it into more than one note or shorten the content.'))
        setSaveState('error')
        return
      }

      if (!docId) {
        const newId = await createNote({
          ...payload,
          createdBy: currentUser.uid,
        })
        setDocId(newId)
        navigate(`/admin/lessons/${newId}/edit`, { replace: true })
      } else {
        await updateNote(docId, payload)
      }
      dirtyRef.current = false
      setSaveState('saved')
    } catch (err) {
      console.error('save failed', err)
      setSaveError(err)
      setSaveState('error')
    }
  }

  performSaveRef.current = performSave

  // Autosave: debounce 1.5 s after the last edit. The timer body reads from
  // refs so a logout (or any other canSave change) within the debounce window
  // is honored, not papered over with the value captured at schedule time.
  useEffect(() => {
    if (!dirtyRef.current) return
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      if (canSaveRef.current) performSaveRef.current?.()
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(saveTimeoutRef.current)
  }, [title, subject, grade, term, week, content, blocks, noteFormat, fileMeta])

  const markDirty = () => { dirtyRef.current = true; setSaveState('idle') }

  const handleCreateQuizFromNote = () => {
    const params = new URLSearchParams()
    if (title.trim())  params.set('title',   `${title.trim()} — Quiz`)
    if (subject)       params.set('subject', subject)
    if (grade)         params.set('grade',   String(grade))
    // The note's title doubles as the quiz's topic seed when the AI/import
    // flows look for one — tweakable in the editor afterwards.
    if (title.trim())  params.set('topic',   title.trim())
    navigate(`/admin/quizzes/new?${params.toString()}`)
  }

  const handleDelete = () => {
    if (!docId) { navigate('/admin/lessons'); return }
    setPendingConfirm('delete')
  }

  const performDelete = async () => {
    setDeleting(true)
    try {
      await deleteNote(docId)
      navigate('/admin/lessons')
    } catch (err) {
      console.error('delete failed', err)
      toast.error('Could not delete the note. Try again.')
    } finally {
      setDeleting(false)
      setPendingConfirm(null)
    }
  }

  const hasPictureBlocks = noteFormat === NOTE_FORMAT.STUDY &&
    blocks.some(b => b && b.type === 'picture')

  const handleGeneratePictures = () => {
    if (!docId || !hasPictureBlocks) return
    setPendingConfirm('pictures')
  }

  const performGeneratePictures = async () => {
    setPendingConfirm(null)
    setPicState('generating')
    setPicResult(null)
    try {
      const res = await generateNotePicturesCallable({ noteId: docId })
      const data = res.data || {}
      setPicResult(data)
      setPicState('done')
      // Reload the note to reflect the new block.url values written by the function.
      window.location.reload()
    } catch (err) {
      console.error('generateNotePictures failed', err)
      setPicState('error')
      setPicResult({ error: err?.message || 'Unknown error' })
    }
  }

  const onGenerateHighlights = async () => {
    if (!docId) { setSmartMsg('Save the note first.'); setSmartState('error'); return }
    setSmartState('loading'); setSmartMsg('')
    try {
      const { highlights, sections } = await generateNoteSmart(docId)
      const nB = highlights ? Object.keys(highlights).length : 0
      const nS = Array.isArray(sections) ? sections.length : 0
      setSmartMsg(`Generated highlights for ${nB} block${nB === 1 ? '' : 's'} and summaries for ${nS} section${nS === 1 ? '' : 's'}.`); setSmartState('done')
    } catch (e) { setSmartMsg(smartErrorMessage(e)); setSmartState('error') }
  }

  if (!isNew && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="notes-studio notes-studio--soft min-h-full">
      <SeoHelmet title={title || (isNew ? 'New note' : 'Edit note')} noIndex />
      <main className="max-w-5xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <button
            onClick={() => navigate('/admin/lessons')}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900 transition"
          >
            <ArrowLeft size={15} /> All notes
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <SaveIndicator state={saveState} error={saveError} />

            <StatusPill status={status} />

            <button
              onClick={performSave}
              disabled={!canSave || saveState === 'saving'}
              className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition inline-flex items-center gap-1.5 text-neutral-900 disabled:opacity-50"
            >
              <Save size={14} /> Save draft
            </button>

            {!isNew && !isLegacySlides && (
              <PublishToggle
                noteId={docId}
                status={status}
                disabled={!canSave}
                onChange={setStatus}
              />
            )}

            {!isNew && !isLegacySlides && (
              <button
                onClick={handleCreateQuizFromNote}
                disabled={!canSave}
                className="text-sm px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition inline-flex items-center gap-1.5 disabled:opacity-50"
                title="Open the quiz creator pre-filled with this note's grade and subject"
              >
                <Sparkles size={14} /> Create quiz from these notes
              </button>
            )}

            {!isNew && hasPictureBlocks && (
              <button
                onClick={handleGeneratePictures}
                disabled={picState === 'generating'}
                className="text-sm px-3 py-1.5 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 transition inline-flex items-center gap-1.5 disabled:opacity-50"
                title="Generate an AI illustration for each picture block in this note"
              >
                {picState === 'generating'
                  ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                  : <>🍌 Generate pictures (nano banana)</>}
              </button>
            )}
            {picState === 'done' && picResult && (
              <span className="text-xs text-emerald-700">
                {picResult.succeeded ?? 0} generated
                {picResult.failed ? `, ${picResult.failed} failed` : ''}
              </span>
            )}
            {picState === 'error' && picResult && (
              <span className="text-xs text-red-600" title={picResult.error}>
                Picture generation failed
              </span>
            )}

            {!isNew && noteFormat === NOTE_FORMAT.STUDY && (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={onGenerateHighlights}
                  disabled={smartState === 'loading' || !docId}
                  className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 inline-flex items-center gap-1.5 text-neutral-800 disabled:opacity-50"
                  title="Generate AI highlights for this study note"
                >
                  <Sparkles size={14} /> {smartState === 'loading' ? 'Generating…' : 'Generate AI highlights'}
                </button>
                {smartMsg && (
                  <span className={`text-xs ${smartState === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
                    {smartMsg}
                  </span>
                )}
              </div>
            )}

            {!isNew && (
              <button
                onClick={handleDelete}
                className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition inline-flex items-center gap-1.5"
                title="Delete note"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {isLegacySlides && <LegacySlidesBanner />}

        <NoteMetaPanel
          title={title}     onTitleChange={(v)   => { if (!isLegacySlides) { setTitle(v);   markDirty() } }}
          subject={subject} onSubjectChange={(v) => { if (!isLegacySlides) { setSubject(v); markDirty() } }}
          grade={grade}     onGradeChange={(v)   => { if (!isLegacySlides) { setGrade(v);   markDirty() } }}
          term={term}       onTermChange={(v)    => { if (!isLegacySlides) { setTerm(v);    markDirty() } }}
          week={week}       onWeekChange={(v)    => { if (!isLegacySlides) { setWeek(v);    markDirty() } }}
        />

        {isVisual && (
          <div className="mt-4">
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-4 flex gap-3 items-start">
              <Sparkles size={18} className="text-violet-700 mt-0.5 shrink-0" />
              <div className="text-sm text-violet-900">
                <strong>AI visual slide-notes.</strong> Preview the deck below and publish it when you're happy.
                To change the content, generate a new deck — the slides aren't edited here.
              </div>
            </div>
            <SlideNotesReader deck={note?.deck} />
          </div>
        )}

        {!isLegacySlides && !isVisual && (
          <>
            <div className="flex gap-1 p-1 bg-neutral-100 rounded-xl mb-4 max-w-xl">
              <ToggleButton
                active={noteFormat === NOTE_FORMAT.STUDY}
                onClick={() => { setNoteFormat(NOTE_FORMAT.STUDY); markDirty() }}
                icon={<Layout size={14} />}
                label="Study note"
              />
              <ToggleButton
                active={noteFormat === NOTE_FORMAT.RICH_TEXT}
                onClick={() => { setNoteFormat(NOTE_FORMAT.RICH_TEXT); markDirty() }}
                icon={<FileText size={14} />}
                label="Rich text"
              />
              <ToggleButton
                active={noteFormat === NOTE_FORMAT.FILE}
                onClick={() => { setNoteFormat(NOTE_FORMAT.FILE); markDirty() }}
                icon={<Upload size={14} />}
                label="Upload PDF / Word"
              />
            </div>

            {noteFormat === NOTE_FORMAT.STUDY ? (
              <StudyNoteEditor
                value={blocks}
                onChange={(next) => { setBlocks(next); markDirty() }}
                ownerUid={currentUser?.uid}
                assetBatchId={assetBatchId}
                subject={subject}
                grade={grade}
              />
            ) : noteFormat === NOTE_FORMAT.RICH_TEXT ? (
              <NoteEditor
                value={content}
                onChange={(v) => { setContent(v); markDirty() }}
                ownerUid={currentUser?.uid}
                assetBatchId={assetBatchId}
              />
            ) : (
              <NoteUploader
                ownerUid={currentUser?.uid}
                assetBatchId={assetBatchId}
                currentFile={fileMeta}
                onUploaded={(meta) => {
                  setFileMeta({ ...meta, updatedAt: new Date() })
                  markDirty()
                }}
                onError={(err) => toast.error(err.message)}
              />
            )}

            {!docId && (
              <p className="text-xs text-neutral-500 mt-4">
                Tip: file uploads activate after the first save. Fill in the title and subject above to enable them.
              </p>
            )}
          </>
        )}
      </main>

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm === 'delete' ? 'Delete this note?' : 'Generate illustrations?'}
        message={pendingConfirm === 'delete'
          ? 'This cannot be undone.'
          : 'Illustrations are generated for every picture block in this note. This may take a minute or two per block; blocks that already have an image are skipped.'}
        confirmLabel={pendingConfirm === 'delete' ? 'Delete' : 'Generate'}
        variant={pendingConfirm === 'delete' ? 'danger' : 'primary'}
        loading={deleting}
        onConfirm={() => {
          if (pendingConfirm === 'delete') performDelete()
          else performGeneratePictures()
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  )
}

function LegacySlidesBanner() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex gap-3 items-start">
      <Layout size={18} className="text-amber-700 mt-0.5 shrink-0" />
      <div className="text-sm text-amber-900">
        <strong>This is a legacy slide-built lesson.</strong> The new Notes Studio editor doesn't
        support editing slide layouts. Learners can still view this lesson, and you can publish,
        unpublish, or delete it from here. To replace its content, delete and create a new note.
      </div>
    </div>
  )
}

function ToggleButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-sm px-3 py-2 rounded-lg transition flex items-center justify-center gap-2 ${
        active ? 'bg-white shadow-sm font-medium text-neutral-900' : 'text-neutral-600 hover:text-neutral-800'
      }`}
    >
      {icon} {label}
    </button>
  )
}

function StatusPill({ status }) {
  if (status === NOTE_STATUS.PUBLISHED) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
        style={{ backgroundColor: '#D1FAE5', color: '#047857' }}
      >
        <Check size={11} strokeWidth={2.5} /> Published
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">
      <Clock size={11} strokeWidth={2.5} /> Draft
    </span>
  )
}

function SaveIndicator({ state, error }) {
  if (state === 'saving') {
    return (
      <span className="text-xs text-neutral-500 inline-flex items-center gap-1.5">
        <Loader2 size={12} className="animate-spin" /> Saving…
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span className="text-xs text-emerald-600 inline-flex items-center gap-1.5">
        <Check size={12} /> Saved
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="text-xs text-red-600" title={error?.message}>
        Save failed — try again
      </span>
    )
  }
  return null
}
