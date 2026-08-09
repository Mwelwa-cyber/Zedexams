/**
 * Upload / photograph an existing class timetable.
 *
 * Lets a teacher bring in a timetable they already have — a PDF, Word or
 * Excel document, or a photo of one written on paper — instead of building
 * it from scratch. The file is read (Gemini via Firebase AI Logic) into the
 * studio's editable grid, where the teacher corrects it and the curriculum
 * check confirms it matches the grade. See src/utils/timetableExtraction.js.
 */

import { useRef, useState } from 'react'
import { UPLOAD_ACCEPT, extractTimetableFromFile } from '../lib/timetableExtraction'
import { useToast } from '../../../components/ui/Toast'

const gradeDigits = (g) => String(g || '').match(/\d+/)?.[0] || ''

export default function TimetableUploadPanel({ grade, days, onExtracted }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const cameraRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')

  async function handleFile(file, srcRef) {
    if (!file || busy) return
    setBusy(true)
    setNotes('')
    try {
      const result = await extractTimetableFromFile(file, { grade, days })
      onExtracted?.(result)
      setNotes(result.notes || '')
      const mismatched = result.detectedGrade && gradeDigits(result.detectedGrade) !== gradeDigits(grade)
      const gradeNote = mismatched ? ` It looks like a ${result.detectedGrade} timetable — check the grade above.` : ''
      toast.success(`Read ${result.lessonCount} lessons from your timetable — review and correct below.${gradeNote}`)
    } catch (err) {
      toast.error(err?.message || 'Could not read that timetable.')
    } finally {
      setBusy(false)
      if (srcRef?.current) srcRef.current.value = '' // let the same file be re-picked
    }
  }

  return (
    <section className="studio-card p-5 space-y-3">
      <div>
        <h2 className="studio-display" style={{ fontSize: 18, margin: 0 }}>Already have a timetable? Upload it</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
          Bring in a timetable you already have — a PDF, Word or Excel file, or a photo of one on paper. We&apos;ll read it into the
          editable grid below so you can correct it, then the curriculum check confirms it matches this grade.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
          className="studio-btn-ghost disabled:opacity-50">
          ⬆️ Upload file
        </button>
        <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()}
          className="studio-btn-ghost disabled:opacity-50">
          📷 Take a photo
        </button>
        <span className="self-center text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
          PDF · Word · Excel · image — up to 15 MB
        </span>
      </div>

      {busy && (
        <p className="text-xs font-bold" style={{ color: 'var(--success-fg)' }}>
          Reading your timetable… this can take a few seconds.
        </p>
      )}
      {notes && !busy && (
        <p className="text-xs" style={{ color: 'var(--warning-fg)' }}>
          Note from the reader: {notes}
        </p>
      )}

      <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0], fileRef)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0], cameraRef)} />
    </section>
  )
}
