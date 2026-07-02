import { useEffect, useState, useCallback } from 'react'
import {
  generateFlashcards,
  TEACHER_LANGUAGES,
  WORKSHEET_DIFFICULTIES,
  FLASHCARD_COUNTS,
} from '../../../utils/teacherTools'
import { downloadFlashcardsDocx } from '../../../utils/flashcardsToDocx'
import { downloadFlashcardsPdf } from '../../../utils/flashcardsToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { LIBRARY_TYPES } from '../../../config/library'
import StudioCurriculumSelector from '../curriculum/StudioCurriculumSelector'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import { FieldTextarea, FieldSelect } from './studioFields'
import StudioOutputBoundary from '../StudioOutputBoundary'
import { useFlashcardProgress } from '../../../hooks/useFlashcardProgress'
import FlashcardStudyOverlay from '../views/FlashcardStudyOverlay'

/**
 * Flashcard Generator — grid preview + keyboard-driven study mode + DOCX
 * export for printable cut-out cards.
 */
export default function FlashcardGenerator() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const urlDefaults = useFormDefaultsFromUrl()
  const [form, setForm] = useState(() => ({
    count: 15,
    difficulty: 'mixed',
    language: 'english',
    instructions: '',
    ...urlDefaults,
  }))
  // Standardized curriculum selection (CBC/Previous → grade → subject → topic →
  // subtopic). `curr` holds the latest payload, including the server-ready
  // grade/subject/curriculum/framework fields.
  const [curr, setCurr] = useState({})
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const isMounted = useIsMounted()
  const [flashcards, setFlashcards] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [viewMode, setViewMode] = useState('grid') // grid | study
  const [studyIndex, setStudyIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const { masteredCards, markMastered, markReview } = useFlashcardProgress(generationId)

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onGenerate(e) {
    e.preventDefault()
    if (!curr.curriculumMode) {
      setErrorMessage('Please choose a curriculum.')
      setStatus('error')
      return
    }
    if (!curr.grade || !curr.subject) {
      setErrorMessage('Please select a class and subject.')
      setStatus('error')
      return
    }
    if (!curr.topic || !curr.topic.trim()) {
      setErrorMessage('Please select a topic.')
      setStatus('error')
      return
    }
    if (!ensureCanGenerate('flashcards')) return
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setFlashcards(null)
    setStudyIndex(0)
    setIsFlipped(false)

    const res = await generateFlashcards({
      ...form,
      grade: curr.grade,
      subject: curr.subject,
      topic: curr.topic,
      subtopic: curr.subtopic,
      curriculum: curr.curriculum,
      framework: curr.framework,
    })
    if (!isMounted.current) return
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

    if (res.data.generationId) {
      // Flashcards live alongside Notes — they're a study aid, not an
      // assessment.
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.NOTES,
        grade:       curr.grade,
        subject:     curr.subject,
      }).catch((err) => console.error('[library attach]', err))
    }
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
    return buildDownloadName({
      docType: 'Flashcards',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      topic: flashcards?.header?.topic || curr.topic,
    })
  }

  function onExport() {
    if (!flashcards) return
    downloadFlashcardsDocx(flashcards, buildFilename(), { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  function onExportPdf() {
    if (!flashcards) return
    const filename = buildDownloadName({
      docType: 'Flashcards',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      topic: flashcards?.header?.topic || curr.topic,
      ext: 'pdf',
    })
    downloadFlashcardsPdf(flashcards, filename, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  return (
    <div className="studio-page">
      <SeoHelmet title="Flashcard generator" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Flashcards"
          title="Revision cards"
          subtitle="Study on screen or print cut-outs for your class — Zambian CBC vocab, definitions, formulas."
          emoji="🎴"
        />

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Input panel */}
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit sticky top-4"
          >
            <StudioCurriculumSelector
              value={urlDefaults}
              onChange={setCurr}
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
              className="studio-btn-primary w-full py-3"
            >
              {status === 'generating' ? 'Generating…' : '▶ Generate Flashcards'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} flashcard sets used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* Output panel */}
          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && <EmptyState />}
            {status === 'generating' && (
              <AiGenerationProgress variant="card" preset="flashcards" running title="Building your deck…" />
            )}
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
                    <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>
                      {flashcards.header?.title || 'Flashcards'}
                    </h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      {totalCards} cards · click any card to flip · press Study for full-screen mode
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => enterStudy(0)} className="studio-btn-primary">
                      ▶ Study mode
                    </button>
                    <button onClick={onExport} className="studio-btn-ghost">
                      📄 Download .docx
                    </button>
                    <button onClick={onExportPdf} className="studio-btn-ghost">
                      📄 Download .pdf
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
          </StudioOutputBoundary>
        </div>
      </div>

      {/* Study-mode overlay */}
      {viewMode === 'study' && flashcards && (
        <FlashcardStudyOverlay
          cards={cards}
          index={studyIndex}
          isFlipped={isFlipped}
          masteredCards={masteredCards}
          onPrev={() => { setStudyIndex((i) => Math.max(i - 1, 0)); setIsFlipped(false) }}
          onNext={() => { setStudyIndex((i) => Math.min(i + 1, cards.length - 1)); setIsFlipped(false) }}
          onFlip={() => setIsFlipped((f) => !f)}
          onClose={() => setViewMode('grid')}
          onMarkMastered={(i) => markMastered(i, cards.length)}
          onMarkReview={(i) => markReview(i, cards.length)}
        />
      )}
    </div>
  )
}

/* ── Inputs ─────────────────────────────────────────────────── */

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div style={{ width: 86, height: 86, borderRadius: '50%', background: '#fde9b8', display: 'grid', placeItems: 'center', fontSize: 44 }}>
        🎴
      </div>
      <h3 className="studio-display mt-4" style={{ fontSize: 20 }}>Ready for revision cards</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>
        Pick a topic and you'll get a deck of flashcards you can study on-screen
        or print as cut-outs for class.
      </p>
    </div>
  )
}
function ErrorState({ message, detail, onDismiss }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3">⚠️</div>
      <h3 className="studio-display" style={{ fontSize: 20 }}>Something went wrong</h3>
      <p className="text-sm max-w-md mb-3 mt-1" style={{ color: '#566f76' }}>{message}</p>
      {detail && (
        <p className="text-xs max-w-md mb-4 font-mono break-all px-3 py-2 rounded-lg" style={{ background: 'var(--sv-canvas)', color: 'var(--sv-muted)' }}>
          {detail}
        </p>
      )}
      <button onClick={onDismiss} className="studio-btn-ghost">
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
          className="text-left rounded-2xl border-2 p-4 min-h-[140px] transition-all hover:-translate-y-0.5 hover:shadow-md"
          style={
            flipped[i]
              ? { background: '#fff5e6', borderColor: '#ff7a2e' }
              : { background: '#ffffff', borderColor: '#0e2a32' }
          }
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

