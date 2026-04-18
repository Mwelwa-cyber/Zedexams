import { useEffect, useState, useCallback } from 'react'
import {
  generateFlashcards,
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
  TEACHER_LANGUAGES,
  WORKSHEET_DIFFICULTIES,
  FLASHCARD_COUNTS,
} from '../../../utils/teacherTools'
import { downloadFlashcardsDocx } from '../../../utils/flashcardsToDocx'

/**
 * Flashcard Generator — grid preview + keyboard-driven study mode + DOCX
 * export for printable cut-out cards.
 */
export default function FlashcardGenerator() {
  const [form, setForm] = useState({
    grade: 'G5',
    subject: 'mathematics',
    topic: '',
    subtopic: '',
    count: 15,
    difficulty: 'mixed',
    language: 'english',
    instructions: '',
  })
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [flashcards, setFlashcards] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [viewMode, setViewMode] = useState('grid') // grid | study
  const [studyIndex, setStudyIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onGenerate(e) {
    e.preventDefault()
    if (!form.topic.trim()) {
      setErrorMessage('Please enter a topic.')
      setStatus('error')
      return
    }
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setFlashcards(null)
    setStudyIndex(0)
    setIsFlipped(false)

    const res = await generateFlashcards(form)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error)
      setErrorDetail(
        [res.code && `code: ${res.code}`, res.rawMessage && `detail: ${res.rawMessage}`]
          .filter(Boolean).join(' · '),
      )
      return
    }
    setFlashcards(res.data.flashcards)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
  }

  const cards = flashcards?.cards || []
  const totalCards = cards.length

  /* Keyboard shortcuts for study mode */
  useEffect(() => {
    if (viewMode !== 'study' || !totalCards) return
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setIsFlipped((f) => !f)
      } else if (e.key === 'ArrowRight') {
        setStudyIndex((i) => Math.min(i + 1, totalCards - 1))
        setIsFlipped(false)
      } else if (e.key === 'ArrowLeft') {
        setStudyIndex((i) => Math.max(i - 1, 0))
        setIsFlipped(false)
      } else if (e.key === 'Escape') {
        setViewMode('grid')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewMode, totalCards])

  const enterStudy = useCallback((startAt = 0) => {
    setStudyIndex(startAt)
    setIsFlipped(false)
    setViewMode('study')
  }, [])

  function buildFilename() {
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const parts = [
      slug(form.grade),
      slug(form.subject),
      slug(flashcards?.header?.topic || form.topic),
      'flashcards',
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean)
    return `${parts.join('_')}.docx`
  }

  function onExport() {
    if (!flashcards) return
    downloadFlashcardsDocx(flashcards, buildFilename())
  }

  return (
    <div className="min-h-screen theme-bg p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-black theme-text">
            Flashcard Generator
          </h1>
          <p className="text-sm theme-text-secondary mt-1">
            Revision cards for Zambian CBC — study on screen or print cut-outs for your class.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Input panel */}
          <form
            onSubmit={onGenerate}
            className="theme-card border theme-border rounded-2xl p-5 space-y-4 h-fit sticky top-4"
          >
            <FieldSelect
              label="Grade"
              value={form.grade}
              options={TEACHER_GRADES}
              onChange={(v) => updateField('grade', v)}
            />
            <FieldSelect
              label="Subject"
              value={form.subject}
              options={TEACHER_SUBJECTS}
              onChange={(v) => updateField('subject', v)}
            />
            <FieldText
              label="Topic *"
              placeholder="e.g. The Circulatory System"
              value={form.topic}
              onChange={(v) => updateField('topic', v)}
              maxLength={120}
            />
            <FieldText
              label="Sub-topic (optional)"
              placeholder="e.g. The heart and blood vessels"
              value={form.subtopic}
              onChange={(v) => updateField('subtopic', v)}
              maxLength={160}
            />
            <FieldSelect
              label="Number of cards"
              value={String(form.count)}
              options={FLASHCARD_COUNTS.map((p) => ({
                value: String(p.value), label: p.label,
              }))}
              onChange={(v) => updateField('count', Number(v))}
            />
            <FieldSelect
              label="Difficulty"
              value={form.difficulty}
              options={WORKSHEET_DIFFICULTIES}
              onChange={(v) => updateField('difficulty', v)}
            />
            <FieldSelect
              label="Language"
              value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => updateField('language', v)}
            />
            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder="e.g. Focus on definitions. Include one formula card."
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)}
              maxLength={500}
            />

            <button
              type="submit"
              disabled={status === 'generating'}
              className="w-full py-3 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {status === 'generating' ? 'Generating…' : '🎴 Generate Flashcards'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} flashcard sets used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* Output panel */}
          <section className="theme-card border theme-border rounded-2xl p-5 min-h-[400px]">
            {status === 'idle' && <EmptyState />}
            {status === 'generating' && <GeneratingState />}
            {status === 'error' && (
              <ErrorState
                message={errorMessage}
                detail={errorDetail}
                onDismiss={() => setStatus('idle')}
              />
            )}
            {status === 'success' && flashcards && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="text-lg font-black theme-text">
                      {flashcards.header?.title || 'Flashcards'}
                    </h2>
                    <p className="text-xs theme-text-secondary">
                      {totalCards} cards · click any card to flip · press Study for full-screen mode
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => enterStudy(0)}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500"
                    >
                      ▶️ Study mode
                    </button>
                    <button
                      onClick={onExport}
                      className="px-4 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                      📄 Download .docx
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <GridView cards={cards} onStudy={enterStudy} />
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved as generation <code>{generationId}</code>.
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* Study-mode overlay */}
      {viewMode === 'study' && flashcards && (
        <StudyOverlay
          cards={cards}
          index={studyIndex}
          isFlipped={isFlipped}
          onPrev={() => { setStudyIndex((i) => Math.max(i - 1, 0)); setIsFlipped(false) }}
          onNext={() => { setStudyIndex((i) => Math.min(i + 1, cards.length - 1)); setIsFlipped(false) }}
          onFlip={() => setIsFlipped((f) => !f)}
          onClose={() => setViewMode('grid')}
        />
      )}
    </div>
  )
}

/* ── Inputs ─────────────────────────────────────────────────── */

function FieldLabel({ children }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide theme-text-secondary mb-1">
      {children}
    </label>
  )
}
function FieldText({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
    </div>
  )
}
function FieldTextarea({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
      />
    </div>
  )
}
function FieldSelect({ label, value, options, onChange }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3">🎴</div>
      <h3 className="text-lg font-black theme-text mb-1">Ready for revision cards</h3>
      <p className="text-sm theme-text-secondary max-w-md">
        Pick a topic and you'll get a deck of flashcards you can study on-screen
        or print as cut-outs for class.
      </p>
    </div>
  )
}
function GeneratingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3 animate-bounce">🎴</div>
      <h3 className="text-lg font-black theme-text mb-1">Building your deck…</h3>
      <p className="text-sm theme-text-secondary max-w-md">
        Usually takes under 20 seconds.
      </p>
    </div>
  )
}
function ErrorState({ message, detail, onDismiss }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3">⚠️</div>
      <h3 className="text-lg font-black theme-text mb-1">Something went wrong</h3>
      <p className="text-sm theme-text-secondary max-w-md mb-3">{message}</p>
      {detail && (
        <p className="text-xs theme-text-secondary/70 max-w-md mb-4 font-mono break-all px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800">
          {detail}
        </p>
      )}
      <button onClick={onDismiss} className="px-4 py-2 rounded-xl text-sm font-bold border theme-border">
        Try again
      </button>
    </div>
  )
}

/* ── Grid view ──────────────────────────────────────────────── */

function GridView({ cards, onStudy }) {
  const [flipped, setFlipped] = useState({})
  const toggle = (i) => setFlipped((f) => ({ ...f, [i]: !f[i] }))

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {cards.map((card, i) => (
        <button
          key={i}
          type="button"
          onClick={() => toggle(i)}
          onDoubleClick={() => onStudy(i)}
          className={`text-left rounded-2xl border-2 p-4 min-h-[140px] transition-all ${
            flipped[i]
              ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-300'
              : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-300'
          } hover:-translate-y-0.5 hover:shadow-md`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
              Card {i + 1} · {card.category}
            </span>
            <span className="text-[10px] text-slate-500">click to flip</span>
          </div>
          {!flipped[i] ? (
            <p className="theme-text font-bold">{card.front}</p>
          ) : (
            <div>
              <p className="theme-text text-sm">{card.back}</p>
              {card.example && (
                <p className="text-xs text-slate-600 italic mt-2">e.g. {card.example}</p>
              )}
              {card.hint && (
                <p className="text-xs text-slate-600 italic mt-1">💡 {card.hint}</p>
              )}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

/* ── Study overlay ──────────────────────────────────────────── */

function StudyOverlay({ cards, index, isFlipped, onPrev, onNext, onFlip, onClose }) {
  const card = cards[index]
  const isLast = index === cards.length - 1
  const isFirst = index === 0

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl flex items-center justify-between mb-4 text-white/80 text-sm">
        <div>
          Card <span className="font-black">{index + 1}</span> of {cards.length}
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded-lg text-sm font-bold bg-white/10 hover:bg-white/20 transition"
        >
          Close (Esc)
        </button>
      </div>

      <button
        type="button"
        onClick={onFlip}
        className={`w-full max-w-2xl min-h-[320px] rounded-3xl border-4 p-10 text-left transition-all ${
          isFlipped
            ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-400'
            : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-400'
        }`}
      >
        <span className="block text-[11px] font-black uppercase tracking-wide text-slate-500 mb-4">
          {isFlipped ? 'Answer' : 'Question'} · {card.category}
        </span>
        {!isFlipped ? (
          <p className="text-2xl sm:text-3xl font-black text-slate-900 leading-snug">
            {card.front}
          </p>
        ) : (
          <div>
            <p className="text-xl sm:text-2xl text-slate-900 leading-snug">
              {card.back}
            </p>
            {card.example && (
              <p className="mt-4 text-slate-600 italic">
                Example: {card.example}
              </p>
            )}
            {card.hint && (
              <p className="mt-2 text-slate-600 italic">
                💡 {card.hint}
              </p>
            )}
          </div>
        )}
      </button>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="px-5 py-3 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        <button
          onClick={onFlip}
          className="px-5 py-3 rounded-xl font-black text-slate-900 bg-white hover:bg-slate-100"
        >
          {isFlipped ? 'Show question' : 'Show answer'} (Space)
        </button>
        <button
          onClick={onNext}
          disabled={isLast}
          className="px-5 py-3 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
      <p className="mt-4 text-xs text-white/60">
        Space/Enter to flip · ← → to navigate · Esc to close
      </p>
    </div>
  )
}
