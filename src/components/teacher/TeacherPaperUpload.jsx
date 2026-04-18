import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { storage } from '../../firebase/config'

const SUBJECTS = [
  'Mathematics',
  'English',
  'Integrated Science',
  'Social Studies',
  'Technology Studies',
  'Home Economics',
  'Expressive Arts',
]
const GRADES   = ['4', '5', '6', '7']
const TERMS    = ['1', '2', '3']
const YEARS    = ['2024', '2023', '2022', '2021', '2020', '2019', '2018']

const FIELD  = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none'
const SELECT = 'border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none'

export default function TeacherPaperUpload() {
  const { createPaper } = useFirestore()
  const { currentUser, isAdmin } = useAuth()
  const navigate = useNavigate()
  const fileRef  = useRef(null)

  const [form, setForm] = useState({
    title:   '',
    grade:   '6',
    subject: 'Mathematics',
    term:    '1',
    year:    '2023',
  })
  const [file, setFile]         = useState(null)
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [toast, setToast]       = useState(null)

  function set(field, val) { setForm(f => ({ ...f, [field]: val })) }
  function show(msg)       { setToast(msg); setTimeout(() => setToast(null), 4000) }

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.type !== 'application/pdf') { show('❌ Only PDF files are allowed.'); return }
    if (f.size > 20 * 1024 * 1024)   { show('❌ File must be under 20 MB.'); return }
    setFile(f)
    e.target.value = ''
  }

  // publish=true  → admin publishes directly
  // submit=true   → teacher submits for approval
  // neither       → save as draft
  async function handleSave({ publish = false, submit = false } = {}) {
    if (!form.title.trim()) { show('❌ Please enter a title.'); return }
    if (!file)              { show('❌ Please select a PDF file.'); return }

    setUploading(true)
    setSaving(true)
    try {
      // 1. Upload PDF to Storage
      const path = `papers/${currentUser.uid}/${Date.now()}-${file.name.replace(/[^a-z0-9.\-_]/gi, '_')}`
      const sRef = storageRef(storage, path)
      await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(sRef, file, { contentType: 'application/pdf' })
        task.on('state_changed',
          snap => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          reject,
          resolve,
        )
      })
      const fileURL = await getDownloadURL(sRef)
      setUploading(false)

      // 2. Create Firestore document
      const status = publish ? 'published' : submit ? 'pending' : 'draft'

      await createPaper({
        ...form,
        fileURL,
        fileSize: file.size,
        uploadedBy: currentUser.uid,
        status,
        isPublished: publish,
        ...(submit && { submittedAt: new Date() }),
      })

      const msg = publish ? '✅ Paper published!' : submit ? '📤 Submitted for approval!' : '✅ Paper saved as draft!'
      show(msg)
      setTimeout(() => navigate(isAdmin ? '/admin/content' : '/teacher/content'), 1200)
    } catch (e) {
      console.error(e)
      show('❌ Upload failed: ' + e.message)
      setUploading(false)
      setSaving(false)
    }
  }

  const backPath = isAdmin ? '/admin/content' : '/teacher/content'

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 p-1 min-h-0 bg-transparent shadow-none">←</button>
        <div>
          <h1 className="text-2xl font-black text-gray-800">📤 Upload Past Paper</h1>
          <p className="text-gray-500 text-sm">Upload a PDF exam paper for learners</p>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-black text-gray-700">Paper Details</h2>
        <input
          value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="Paper title (e.g. Grade 6 Mathematics 2023 Paper 1)"
          className={FIELD}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select value={form.grade}   onChange={e => set('grade', e.target.value)}   className={SELECT}>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select value={form.subject} onChange={e => set('subject', e.target.value)} className={SELECT}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={form.term}    onChange={e => set('term', e.target.value)}    className={SELECT}>
            {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
          </select>
          <select value={form.year}    onChange={e => set('year', e.target.value)}    className={SELECT}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* File upload */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-black text-gray-700">PDF File</h2>

        {file ? (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
            <span className="text-3xl">📄</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-gray-800 text-sm truncate">{file.name}</p>
              <p className="text-gray-500 text-xs mt-0.5">{(file.size / (1024 * 1024)).toFixed(2)} MB · PDF</p>
            </div>
            <button
              onClick={() => setFile(null)}
              className="text-red-500 hover:text-red-600 font-black text-xs min-h-0 bg-transparent shadow-none px-2">
              ✕ Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl p-8 text-center transition-all min-h-0 bg-transparent shadow-none">
            <div className="text-4xl mb-2">📄</div>
            <p className="font-black text-gray-700">Click to select a PDF</p>
            <p className="text-gray-400 text-xs mt-1">PDF only · max 20 MB</p>
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />

        {/* Upload progress */}
        {uploading && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-gray-600">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pb-6">
        <button
          onClick={() => handleSave({})}
          disabled={saving}
          className="flex-1 border-2 border-blue-600 text-blue-600 font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 hover:bg-blue-50 transition-colors">
          {saving && !uploading ? '⏳ Saving…' : uploading ? `⏳ ${progress}%…` : '💾 Save Draft'}
        </button>
        {isAdmin ? (
          <button
            onClick={() => handleSave({ publish: true })}
            disabled={saving}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 transition-colors">
            {saving ? '⏳ Publishing…' : '🚀 Publish Paper'}
          </button>
        ) : (
          <button
            onClick={() => handleSave({ submit: true })}
            disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 transition-colors">
            {saving ? '⏳ Submitting…' : '📤 Submit for Approval'}
          </button>
        )}
      </div>
    </div>
  )
}
