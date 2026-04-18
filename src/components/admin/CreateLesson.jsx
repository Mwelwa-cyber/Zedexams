import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'

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

const FIELD = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-base focus:border-green-500 focus:outline-none'
const SELECT = 'border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none'

export default function CreateLesson() {
  const { createLesson, updateLesson, getLessonById } = useFirestore()
  const { currentUser, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    title:   '',
    grade:   '4',
    subject: 'Mathematics',
    topic:   '',
    term:    '1',
    content: '',
    imageURL: '',
    objectives: '',
    keyVocab: '',
  })
  const [saving, setSaving] = useState(false)
  const [toast, setToast]   = useState(null)

  function set(field, val) { setForm(f => ({ ...f, [field]: val })) }
  function show(msg)       { setToast(msg); setTimeout(() => setToast(null), 3500) }

  // publish=true  → admin publishes directly
  // submit=true   → teacher submits for approval
  // neither       → save draft
  async function handleSave({ publish = false, submit = false } = {}) {
    if (!form.title.trim())   { show('❌ Please enter a lesson title.'); return }
    if (!form.topic.trim())   { show('❌ Please enter a topic.'); return }
    if (!form.content.trim()) { show('❌ Please enter the lesson content.'); return }
    setSaving(true)
    try {
      const status = publish ? 'published' : submit ? 'pending' : 'draft'
      await createLesson({
        ...form,
        isPublished: publish,
        status,
        createdBy:   currentUser.uid,
        objectives:  form.objectives.split('\n').map(s => s.trim()).filter(Boolean),
        keyVocab:    form.keyVocab.split(',').map(s => s.trim()).filter(Boolean),
        ...(submit && { submittedAt: new Date() }),
      })
      const msg = publish ? '✅ Lesson published!' : submit ? '📤 Submitted for approval!' : '✅ Lesson saved as draft!'
      show(msg)
      const returnPath = isAdmin ? '/admin/content' : '/teacher/content'
      setTimeout(() => navigate(returnPath), 1200)
    } catch (e) {
      console.error(e)
      show('❌ Failed to save: ' + e.message)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-700 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs animate-slide-up">
          {toast}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 p-1 min-h-0 bg-transparent shadow-none">←</button>
        <div>
          <h1 className="text-2xl font-black text-gray-800">📖 Create Lesson</h1>
          <p className="text-gray-500 text-sm">Add a new lesson for your learners</p>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-black text-gray-700">Lesson Details</h2>
        <input value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="Lesson title (e.g. Introduction to Fractions)"
          className={FIELD} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select value={form.grade} onChange={e => set('grade', e.target.value)} className={SELECT}>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select value={form.subject} onChange={e => set('subject', e.target.value)} className={SELECT}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={form.term} onChange={e => set('term', e.target.value)} className={SELECT}>
            {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
          </select>
          <input value={form.topic} onChange={e => set('topic', e.target.value)}
            placeholder="Topic (e.g. Fractions)" className={SELECT} />
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-black text-gray-700">Lesson Content</h2>
        <p className="text-xs text-gray-400">Write the full lesson text. Use blank lines to separate paragraphs.</p>
        <textarea value={form.content} onChange={e => set('content', e.target.value)}
          placeholder="Write the lesson content here…&#10;&#10;You can use multiple paragraphs. Explain concepts clearly for Grade 4–7 learners."
          rows={12}
          className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 text-base focus:border-green-500 focus:outline-none resize-y leading-relaxed" />
      </div>

      {/* Extras */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-black text-gray-700">Optional Extras</h2>
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1.5">Learning Objectives (one per line)</label>
          <textarea value={form.objectives} onChange={e => set('objectives', e.target.value)}
            placeholder="By the end of this lesson, learners will be able to:&#10;1. Identify fractions&#10;2. Compare fractions"
            rows={4}
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none resize-none" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1.5">Key Vocabulary (comma-separated)</label>
          <input value={form.keyVocab} onChange={e => set('keyVocab', e.target.value)}
            placeholder="numerator, denominator, fraction, whole number"
            className={FIELD} />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1.5">Image URL (optional)</label>
          <input value={form.imageURL} onChange={e => set('imageURL', e.target.value)}
            placeholder="https://example.com/image.png"
            className={FIELD} />
          {form.imageURL && (
            <img src={form.imageURL} alt="Preview" onError={e => { e.target.style.display = 'none' }}
              className="mt-2 rounded-xl max-h-40 object-cover border border-gray-100" />
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pb-6">
        <button onClick={() => handleSave({})} disabled={saving}
          className="flex-1 border-2 border-green-600 text-green-600 font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 hover:bg-green-50 transition-colors">
          {saving ? '⏳ Saving…' : '💾 Save Draft'}
        </button>
        {isAdmin ? (
          <button onClick={() => handleSave({ publish: true })} disabled={saving}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 transition-colors">
            {saving ? '⏳ Publishing…' : '🚀 Publish Lesson'}
          </button>
        ) : (
          <button onClick={() => handleSave({ submit: true })} disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 transition-colors">
            {saving ? '⏳ Submitting…' : '📤 Submit for Approval'}
          </button>
        )}
      </div>
    </div>
  )
}
