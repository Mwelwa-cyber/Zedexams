import { useState, useEffect, useRef } from 'react'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { seedFirestore } from '../../utils/seedData'
import { hasPremiumAccess } from '../../utils/subscriptionConfig'
import { db, storage } from '../../firebase/config'
import PaymentsPanel from '../admin/PaymentsPanel'

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
const YEARS    = ['2024', '2023', '2022', '2021', '2020']

export default function AdminPanel() {
  const { currentUser } = useAuth()
  const {
    getAllQuizzes, createQuiz, saveQuestions, updateQuiz, deleteQuiz,
    getAllUsers, getAllResults,
    getPapers, createPaper, deletePaper,
  } = useFirestore()

  const [tab, setTab]       = useState('overview')
  const [users, setUsers]   = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [results, setResults] = useState([])
  const [papers, setPapers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [toast, setToast]     = useState(null)

  // Quiz builder state
  const [qf, setQf]           = useState({ title: '', subject: 'Mathematics', grade: '4', term: '1', year: '2024', type: 'quiz', duration: 30 })
  const [questions, setQuestions] = useState([{ text: '', options: ['', '', '', ''], correctAnswer: 0, topic: '', marks: 1, type: 'mcq' }])
  const [saving, setSaving]   = useState(false)

  // Papers upload state
  const fileInputRef          = useRef(null)
  const [pf, setPf]           = useState({ title: '', subject: 'Mathematics', grade: '4', term: '1', year: '2024' })
  const [uploadFile, setUploadFile]     = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading]       = useState(false)
  const [papersLoading, setPapersLoading] = useState(false)

  useEffect(() => {
    async function load() {
      const [u, q, r] = await Promise.all([getAllUsers(), getAllQuizzes(), getAllResults()])
      setUsers(u); setQuizzes(q); setResults(r); setLoading(false)
    }
    load()
  }, [])

  // Load papers when tab is selected
  useEffect(() => {
    if (tab !== 'papers') return
    async function loadPapers() {
      setPapersLoading(true)
      const data = await getPapers({})
      setPapers(data)
      setPapersLoading(false)
    }
    loadPapers()
  }, [tab])

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  async function handleSeed() {
    setSeeding(true)
    try { await seedFirestore(db, currentUser.uid); show('✅ Sample data seeded!') } catch (e) { show('❌ ' + e.message) }
    const q = await getAllQuizzes(); setQuizzes(q); setSeeding(false)
  }

  // ── Quiz Builder helpers ─────────────────────────────────────
  function addQuestion() {
    setQuestions(p => [...p, { text: '', options: ['', '', '', ''], correctAnswer: 0, topic: '', marks: 1, type: 'mcq' }])
  }
  function removeQuestion(i) { if (questions.length > 1) setQuestions(p => p.filter((_, j) => j !== i)) }
  function setQ(i, field, val) { setQuestions(p => p.map((q, j) => j === i ? { ...q, [field]: val } : q)) }
  function setOpt(qi, oi, val) { setQuestions(p => p.map((q, j) => j === qi ? { ...q, options: q.options.map((o, k) => k === oi ? val : o) } : q)) }

  async function handleSaveQuiz(publish = false) {
    if (!qf.title.trim()) { show('Please enter a title.'); return }
    const empty = questions.some(q => !q.text.trim() || q.options.some(o => !o.trim()))
    if (empty) { show('Fill in all question texts and options.'); return }
    setSaving(true)
    try {
      const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)
      const quizId = await createQuiz({
        ...qf, totalMarks, questionCount: questions.length,
        isPublished: publish, createdBy: currentUser.uid,
      })
      await saveQuestions(quizId, questions.map(q => ({
        text: q.text, options: q.options, correctAnswer: q.correctAnswer,
        topic: q.topic, marks: q.marks || 1, type: q.type || 'mcq',
      })))
      show(publish ? '✅ Quiz published!' : '✅ Quiz saved as draft!')
      setQf({ title: '', subject: 'Mathematics', grade: '4', term: '1', year: '2024', type: 'quiz', duration: 30 })
      setQuestions([{ text: '', options: ['', '', '', ''], correctAnswer: 0, topic: '', marks: 1, type: 'mcq' }])
      const q = await getAllQuizzes(); setQuizzes(q)
    } catch (e) { show('❌ ' + e.message) }
    setSaving(false)
  }

  async function togglePublish(quiz) {
    await updateQuiz(quiz.id, { isPublished: !quiz.isPublished })
    setQuizzes(p => p.map(q => q.id === quiz.id ? { ...q, isPublished: !q.isPublished } : q))
  }

  async function handleDeleteQuiz(quiz) {
    if (!window.confirm(`Delete "${quiz.title}"?`)) return
    await deleteQuiz(quiz.id)
    setQuizzes(p => p.filter(q => q.id !== quiz.id))
    show('Deleted.')
  }

  // ── Papers upload ────────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.type !== 'application/pdf') { show('❌ Only PDF files are accepted.'); return }
    if (file.size > 20 * 1024 * 1024) { show('❌ File too large (max 20 MB).'); return }
    setUploadFile(file)
  }

  async function handleUploadPaper() {
    if (!uploadFile)       { show('Select a PDF file first.'); return }
    if (!pf.title.trim())  { show('Enter a paper title.'); return }
    setUploading(true)
    setUploadProgress(0)
    try {
      const filename   = `papers/${Date.now()}_${uploadFile.name.replace(/\s+/g, '_')}`
      const fileRef    = storageRef(storage, filename)
      const uploadTask = uploadBytesResumable(fileRef, uploadFile)

      await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          reject,
          resolve,
        )
      })

      const downloadURL = await getDownloadURL(uploadTask.snapshot.ref)
      await createPaper({
        ...pf,
        fileURL:    downloadURL,
        fileName:   uploadFile.name,
        fileSize:   uploadFile.size,
        uploadedBy: currentUser.uid,
      })
      show('✅ Paper uploaded successfully!')
      setPf({ title: '', subject: 'Mathematics', grade: '4', term: '1', year: '2024' })
      setUploadFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setUploadProgress(0)
      // Refresh papers list
      const data = await getPapers({})
      setPapers(data)
    } catch (e) {
      console.error(e)
      show('❌ Upload failed: ' + e.message)
    }
    setUploading(false)
  }

  async function handleDeletePaper(paper) {
    if (!window.confirm(`Delete "${paper.title}"?`)) return
    await deletePaper(paper.id)
    setPapers(p => p.filter(x => x.id !== paper.id))
    show('Paper deleted.')
  }

  function fmtSize(bytes) {
    if (!bytes) return ''
    if (bytes < 1024)        return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const tabs = [
    { id: 'overview',  label: '📊 Overview' },
    { id: 'quizzes',   label: '📝 Quizzes' },
    { id: 'create',    label: '➕ Create Quiz' },
    { id: 'papers',    label: '📄 Papers' },
    { id: 'payments',  label: '💳 Payments' },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-700 text-white font-bold px-5 py-3 rounded-2xl shadow-lg animate-slide-up text-sm max-w-xs">
          {toast}
        </div>
      )}

      <h1 className="text-2xl font-black text-gray-800 mb-4">⚙️ Admin Panel</h1>

      <div className="flex gap-2 flex-wrap mb-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all min-h-0 ${tab === t.id ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
            { icon: '👥', label: 'Users',   val: users.length },
            { icon: '📝', label: 'Quizzes', val: quizzes.length },
            { icon: '📊', label: 'Results', val: results.length },
            { icon: '⭐', label: 'Premium', val: users.filter(hasPremiumAccess).length },
          ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-center">
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className="font-black text-xl text-gray-800">{loading ? '…' : s.val}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
          <button onClick={handleSeed} disabled={seeding}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-800 font-black py-3 rounded-2xl disabled:opacity-50 min-h-0">
            {seeding ? '⏳ Seeding…' : '🌱 Seed Sample Data'}
          </button>
        </div>
      )}

      {/* ── Quizzes list ─────────────────────────────────────── */}
      {tab === 'quizzes' && (
        <div className="space-y-3">
          {loading ? <p className="text-gray-400 py-8 text-center">Loading…</p> :
            quizzes.length === 0 ? <p className="text-gray-400 py-8 text-center">No quizzes yet. Create one!</p> :
              quizzes.map(q => (
                <div key={q.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-800 text-sm truncate">{q.title}</p>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{q.subject}</span>
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">G{q.grade}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${q.isPublished ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                        {q.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => togglePublish(q)} className="text-xs font-bold px-3 py-1.5 rounded-full border border-gray-200 min-h-0 hover:bg-gray-50">
                    {q.isPublished ? 'Unpublish' : 'Publish'}
                  </button>
                  <button onClick={() => handleDeleteQuiz(q)} className="text-red-500 text-xs font-bold px-3 py-1.5 rounded-full border border-red-200 min-h-0 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              ))}
        </div>
      )}

      {/* ── Create Quiz ───────────────────────────────────────── */}
      {tab === 'create' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
            <h2 className="font-black text-gray-800">Quiz Details</h2>
            <input value={qf.title} onChange={e => setQf(f => ({ ...f, title: e.target.value }))} placeholder="Quiz title"
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-base focus:border-green-500 focus:outline-none" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <select value={qf.subject} onChange={e => setQf(f => ({ ...f, subject: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={qf.grade} onChange={e => setQf(f => ({ ...f, grade: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
              </select>
              <select value={qf.term} onChange={e => setQf(f => ({ ...f, term: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
              </select>
              <input type="number" value={qf.duration} onChange={e => setQf(f => ({ ...f, duration: +e.target.value }))} placeholder="Minutes"
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none" />
              <select value={qf.type} onChange={e => setQf(f => ({ ...f, type: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                <option value="quiz">Quiz</option>
                <option value="past-paper">Past Paper</option>
              </select>
            </div>
          </div>

          {questions.map((q, qi) => (
            <div key={qi} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-black text-gray-800 text-sm">Question {qi + 1}</span>
                <div className="flex gap-2">
                  <select value={q.type} onChange={e => {
                    setQ(qi, 'type', e.target.value)
                    if (e.target.value === 'truefalse') { setQ(qi, 'options', ['True', 'False']); setQ(qi, 'correctAnswer', 0) }
                    else if (q.options.length < 4) { setQ(qi, 'options', ['', '', '', '']) }
                  }} className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-green-500 focus:outline-none">
                    <option value="mcq">MCQ</option>
                    <option value="truefalse">True/False</option>
                  </select>
                  {questions.length > 1 && (
                    <button onClick={() => removeQuestion(qi)} className="text-red-500 text-xs font-bold min-h-0 p-0 bg-transparent shadow-none">✕ Remove</button>
                  )}
                </div>
              </div>
              <input value={q.text} onChange={e => setQ(qi, 'text', e.target.value)} placeholder="Question text…"
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none" />
              <div className="grid grid-cols-2 gap-2">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-1.5">
                    <input type="radio" name={`correct-${qi}`} checked={q.correctAnswer === oi}
                      onChange={() => setQ(qi, 'correctAnswer', oi)} className="accent-green-600" />
                    <input value={opt} onChange={e => setOpt(qi, oi, e.target.value)}
                      placeholder={`Option ${['A', 'B', 'C', 'D'][oi]}`}
                      disabled={q.type === 'truefalse'}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-green-500 focus:outline-none disabled:bg-gray-50" />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={q.topic} onChange={e => setQ(qi, 'topic', e.target.value)} placeholder="Topic (e.g. Fractions)"
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-green-500 focus:outline-none" />
                <input type="number" value={q.marks} onChange={e => setQ(qi, 'marks', +e.target.value)} min={1}
                  className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-green-500 focus:outline-none" />
              </div>
            </div>
          ))}

          <button onClick={addQuestion} className="w-full border-2 border-dashed border-gray-300 text-gray-500 font-bold py-3 rounded-2xl hover:border-green-400 hover:text-green-600 min-h-0">
            + Add Question
          </button>

          <div className="flex gap-3">
            <button onClick={() => handleSaveQuiz(false)} disabled={saving}
              className="flex-1 border-2 border-green-600 text-green-600 font-black py-3 rounded-2xl disabled:opacity-50 min-h-0">
              {saving ? '…' : '💾 Save Draft'}
            </button>
            <button onClick={() => handleSaveQuiz(true)} disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-2xl disabled:opacity-50 min-h-0">
              {saving ? '…' : '🚀 Publish'}
            </button>
          </div>
        </div>
      )}

      {/* ── Papers Upload ─────────────────────────────────────── */}
      {tab === 'papers' && (
        <div className="space-y-4">
          {/* Upload form */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="font-black text-gray-800">📤 Upload Past Paper (PDF)</h2>

            {/* PDF file picker */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center cursor-pointer hover:border-green-400 transition-colors">
              {uploadFile ? (
                <div>
                  <div className="text-3xl mb-1">📄</div>
                  <p className="font-bold text-gray-800 text-sm">{uploadFile.name}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{fmtSize(uploadFile.size)}</p>
                  <button onClick={e => { e.stopPropagation(); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="mt-2 text-red-500 text-xs font-bold underline min-h-0 bg-transparent shadow-none p-0">
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <div className="text-3xl mb-2">📁</div>
                  <p className="font-bold text-gray-600 text-sm">Tap to select PDF</p>
                  <p className="text-gray-400 text-xs mt-0.5">Max 20 MB · PDF only</p>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />

            {/* Paper metadata */}
            <input value={pf.title} onChange={e => setPf(f => ({ ...f, title: e.target.value }))}
              placeholder="Paper title (e.g. Grade 6 Mathematics 2023 Term 2)"
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-base focus:border-green-500 focus:outline-none" />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <select value={pf.grade} onChange={e => setPf(f => ({ ...f, grade: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
              </select>
              <select value={pf.subject} onChange={e => setPf(f => ({ ...f, subject: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={pf.term} onChange={e => setPf(f => ({ ...f, term: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
              </select>
              <select value={pf.year} onChange={e => setPf(f => ({ ...f, year: e.target.value }))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Upload progress */}
            {uploading && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1 font-bold">
                  <span>Uploading…</span><span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            <button onClick={handleUploadPaper} disabled={uploading || !uploadFile}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-2xl disabled:opacity-50 min-h-0 transition-colors">
              {uploading ? `⏳ Uploading… ${uploadProgress}%` : '📤 Upload Paper'}
            </button>
          </div>

          {/* Existing papers list */}
          <h3 className="font-black text-gray-700 text-sm px-1">Uploaded Papers ({papersLoading ? '…' : papers.length})</h3>
          {papersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : papers.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-4xl mb-2">📂</div>
              <p className="text-gray-500 font-bold text-sm">No papers uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {papers.map(p => (
                <div key={p.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-start gap-3">
                  <div className="bg-red-100 text-red-600 w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0">📄</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-800 text-sm leading-snug truncate">{p.title}</p>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">G{p.grade}</span>
                      <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{p.subject}</span>
                      <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">T{p.term}</span>
                      <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{p.year}</span>
                      {p.fileSize && <span className="text-gray-400 text-xs px-1">{fmtSize(p.fileSize)}</span>}
                    </div>
                    <p className="text-gray-400 text-xs mt-1">⬇️ {p.downloadCount ?? 0} downloads</p>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <a href={p.fileURL} target="_blank" rel="noopener noreferrer"
                      className="text-green-600 text-xs font-bold px-3 py-1.5 rounded-full border border-green-200 hover:bg-green-50 text-center">
                      View
                    </a>
                    <button onClick={() => handleDeletePaper(p)}
                      className="text-red-500 text-xs font-bold px-3 py-1.5 rounded-full border border-red-200 hover:bg-red-50 min-h-0">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Payments ─────────────────────────────────────────── */}
      {tab === 'payments' && <PaymentsPanel />}
    </div>
  )
}
