// src/features/notes/pages/AdminVisualNotesGenerator.jsx
//
// /admin/lessons/visual/new — admin-only generator for AI visual slide-notes.
//
// Flow (the "direct admin flow"):
//   1. Admin fills grade / subject / topic.
//   2. "Generate" calls the `generateVisualNotes` Cloud Function, which writes
//      a PRIVATE draft to aiGenerations and returns the finished deck (text +
//      Recraft line-art illustrations). This can take ~30-60s.
//   3. The deck previews inline using the same SlideNotesReader the learner sees.
//   4. "Save as draft note" writes it into the lessons collection
//      (noteFormat='visual_slides') and hands off to the note editor, where the
//      existing Publish toggle makes it learner-visible.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

import {
  ArrowLeft, Sparkles, Loader2, Save, AlertTriangle,
} from '../../../components/ui/icons'
import { useAuth } from '../../../contexts/AuthContext'
import { GRADES, SUBJECTS, NOTE_FORMAT } from '../../../config/curriculum'
import { createNote } from '../lib/firestore'
import { SlideNotesReader } from '../components/SlideNotesReader'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import '../styles/notes.css'

// Visual-notes generation runs Claude + up to ~10 sequential Recraft calls, so
// give the callable plenty of headroom (the function itself caps at 300s).
const functions = getFunctions(app, 'us-central1')
const generateVisualNotesCallable = httpsCallable(functions, 'generateVisualNotes', {
  timeout: 300_000,
})

// Map the client subject labels to the backend curriculum keys the
// generateVisualNotes function validates against.
const SUBJECT_LABEL_TO_KEY = {
  'English': 'english',
  'Integrated Science': 'integrated_science',
  'Mathematics': 'mathematics',
  'Social Studies': 'social_studies',
  'Expressive Art': 'expressive_arts',
  'Technology Studies': 'technology_studies',
  'Cinyanja': 'cinyanja',
  'Home Economics': 'home_economics',
}

const LANGUAGES = [
  ['english', 'English'],
  ['bemba', 'Bemba'],
  ['nyanja', 'Nyanja'],
  ['tonga', 'Tonga'],
  ['lozi', 'Lozi'],
]

export function AdminVisualNotesGenerator() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  const [grade, setGrade] = useState(GRADES[0])
  const [subjectLabel, setSubjectLabel] = useState('')
  const [topic, setTopic] = useState('')
  const [subtopic, setSubtopic] = useState('')
  const [language, setLanguage] = useState('english')
  const [instructions, setInstructions] = useState('')

  const [phase, setPhase] = useState('idle')   // idle | generating | done | error
  const [deck, setDeck] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [warning, setWarning] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const subjectKey = SUBJECT_LABEL_TO_KEY[subjectLabel] || ''
  const canGenerate = Boolean(subjectKey) && topic.trim() && phase !== 'generating'

  const handleGenerate = async () => {
    if (!canGenerate) return
    setPhase('generating')
    setErrorMsg('')
    setWarning('')
    setDeck(null)
    setGenerationId(null)
    setSaveError('')
    try {
      const res = await generateVisualNotesCallable({
        grade: `G${grade}`,
        subject: subjectKey,
        topic: topic.trim(),
        subtopic: subtopic.trim(),
        language,
        instructions: instructions.trim(),
      })
      const data = res?.data || {}
      if (!data.deck || !Array.isArray(data.deck.slides) || data.deck.slides.length === 0) {
        setErrorMsg(data.warning || 'The generator did not return a usable deck. Please try again.')
        setPhase('error')
        return
      }
      setDeck(data.deck)
      setGenerationId(data.generationId || null)
      setWarning(data.warning || '')
      setPhase('done')
    } catch (err) {
      console.error('generateVisualNotes failed', err)
      setErrorMsg(err?.message || 'Generation failed. Please try again.')
      setPhase('error')
    }
  }

  const handleSaveDraft = async () => {
    if (!deck || !currentUser?.uid) return
    setSaving(true)
    setSaveError('')
    try {
      const hero = deck.slides.find((s) => s.type === 'hero')
      const newId = await createNote({
        title: deck.header?.title || topic.trim(),
        subject: subjectLabel,
        grade: String(grade),
        noteFormat: NOTE_FORMAT.VISUAL,
        deck,
        sourceGenerationId: generationId,
        excerpt: hero?.subtitle || '',
        createdBy: currentUser.uid,
      })
      navigate(`/admin/lessons/${newId}/edit`)
    } catch (err) {
      console.error('save visual note failed', err)
      setSaveError(err?.message || 'Could not save the note. Try again.')
      setSaving(false)
    }
  }

  return (
    <div className="notes-studio min-h-full" style={{ backgroundColor: '#FAFAF7' }}>
      <SeoHelmet title="Generate visual notes" noIndex />
      <main className="max-w-5xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <button
            onClick={() => navigate('/admin/lessons')}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900 transition"
          >
            <ArrowLeft size={15} /> All notes
          </button>
          {phase === 'done' && deck && (
            <button
              onClick={handleSaveDraft}
              disabled={saving}
              className="text-sm px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save as draft note
            </button>
          )}
        </div>

        <h1 className="font-display text-3xl mb-1 text-neutral-900 inline-flex items-center gap-2">
          <Sparkles size={22} className="text-[var(--accent)]" /> Visual notes generator
        </h1>
        <p className="text-sm text-neutral-500 mb-6">
          Generate an illustrated, learner-facing slide deck for a CBC topic. Review the preview, then save it as a
          draft note and publish when you're happy.
        </p>

        <div className="bg-white rounded-2xl border border-neutral-200 p-5 mb-6 grid gap-4 sm:grid-cols-2">
          <Field label="Grade">
            <select
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            >
              {GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </Field>

          <Field label="Subject">
            <select
              value={subjectLabel}
              onChange={(e) => setSubjectLabel(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            >
              <option value="" disabled>Choose a subject…</option>
              {SUBJECTS
                .filter((s) => SUBJECT_LABEL_TO_KEY[s.label])
                .map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
            </select>
          </Field>

          <Field label="Topic">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. The Circulatory System"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Sub-topic (optional)">
            <input
              value={subtopic}
              onChange={(e) => setSubtopic(e.target.value)}
              placeholder="e.g. How blood moves around the body"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Language">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            >
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          <Field label="Extra instructions (optional)">
            <input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. focus on real Zambian examples"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
          </Field>

          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="text-sm px-4 py-2 rounded-lg bg-neutral-900 text-white hover:opacity-90 transition inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {phase === 'generating'
                ? <><Loader2 size={14} className="animate-spin" /> Generating… (this can take up to a minute)</>
                : <><Sparkles size={14} /> Generate visual notes</>}
            </button>
          </div>
        </div>

        {phase === 'error' && errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex gap-2 items-start text-sm text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {warning && phase === 'done' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex gap-2 items-start text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{warning}</span>
          </div>
        )}

        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-800">
            {saveError}
          </div>
        )}

        {phase === 'generating' && (
          <div className="min-h-[30vh] flex flex-col items-center justify-center text-neutral-500 gap-3">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">Writing the deck and drawing the illustrations…</p>
          </div>
        )}

        {phase === 'done' && deck && (
          <div>
            <h2 className="font-display text-xl mb-3 text-neutral-900">Preview</h2>
            <SlideNotesReader deck={deck} />
          </div>
        )}
      </main>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-neutral-600 mb-1">{label}</span>
      {children}
    </label>
  )
}

export default AdminVisualNotesGenerator
