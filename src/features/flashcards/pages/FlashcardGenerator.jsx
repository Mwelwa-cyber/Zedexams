import { useState, useCallback, useRef } from 'react'
import {
  generateFlashcards,
  TEACHER_LANGUAGES,
  WORKSHEET_DIFFICULTIES,
  FLASHCARD_COUNTS,
} from '../../../utils/teacherTools'
import { downloadFlashcardsDocx } from '../../../engines/export-engine/flashcardsToDocx'
import { downloadFlashcardsPdf } from '../../../engines/export-engine/flashcardsToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../../../components/teacher/StudioPageHeader'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { LIBRARY_TYPES } from '../../../config/library'
import StudioCurriculumSelector from '../../../components/teacher/curriculum/StudioCurriculumSelector'
import { curriculumSeedFromProfile } from '../../../utils/teacherDefaults'
import { readActiveAssignmentSeed, resolveStudioSeed } from '../../../utils/activeAssignmentSeed'
import StudioAssignmentChangeNotice from '../../../components/teacher/generate/StudioAssignmentChangeNotice'
import LiveGenerationCanvas from '../../../components/ui/LiveGenerationCanvas'
import {
  FieldTextarea,
  FieldSelect,
  FieldGrid,
  GenerateButton,
  StudioEmptyState,
} from '../../../components/teacher/generate/studioFields'
import Icon from '../../../components/ui/Icon'
import { Download, Play } from '../../../components/ui/icons'
import StudioOutputBoundary from '../../../components/teacher/StudioOutputBoundary'
import { useFlashcardProgress } from '../hooks/useFlashcardProgress'
import FlashcardStudyOverlay from '../components/FlashcardStudyOverlay'
import { useStudioInputDraft } from '../../../hooks/draft/useStudioInputDraft'
import { flashcardsInputDescriptor } from '../../../hooks/draft/descriptors'
import DraftStatusIndicator from '../../../components/draft/DraftStatusIndicator'
import DraftRecoveryPrompt from '../../../components/draft/DraftRecoveryPrompt'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'

/**
 * Flashcard Generator — grid preview + keyboard-driven study mode + DOCX
 * export for printable cut-out cards.
 */
export default function FlashcardGenerator() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const urlDefaults = useFormDefaultsFromUrl()
  // Selector seed: a deep-link handoff (?grade=…) wins; otherwise the
  // teacher's saved curriculum defaults (Teacher Settings → My Teaching).
  // Read once on mount by the selector — never re-seeds reactively.
  const [selectorSeed, setSelectorSeed] = useState(() =>
    resolveStudioSeed({
      urlSeed: urlDefaults,
      activeSeed: readActiveAssignmentSeed(currentUser?.uid),
      profileSeed: curriculumSeedFromProfile(userProfile),
    }),
  )
  const [selectorKey, setSelectorKey] = useState(0)
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
  const isMounted = useIsMounted()
  const [flashcards, setFlashcards] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [viewMode, setViewMode] = useState('grid') // grid | study
  const [studyIndex, setStudyIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const { masteredCards, markMastered, markReview } = useFlashcardProgress(generationId)
  // Live Generation Canvas hand-off (see WorksheetGenerator for the pattern).
  const [handedOff, setHandedOff] = useState(false)
  // Per-run token: stops a resolved callable from hijacking the UI if Stop was
  // clicked before the response landed. Bump in onStop + capture before await.
  const runRef = useRef(0)

  // Idempotency lock: one logical generation → one provider call + one saved
  // doc + one usage charge, even across a double-click / rapid tap / refresh /
  // a second tab. The server-side reservation enforces this; this is the
  // client-side belt (mints + persists the key). Separate lock keys for the
  // full generate vs a per-section regenerate so they never collide.
  const { run: runGenerateLocked } = useAiOperationLock('flashcards-studio:generate')
  const { run: runRegenerateLocked } = useAiOperationLock('flashcards-studio:regenerate')

  // Universal Draft Manager: auto-save the flashcard inputs.
  const draft = useStudioInputDraft({
    descriptor: flashcardsInputDescriptor,
    uid: currentUser?.uid,
    form, setForm, curr, setCurr,
    onReseedSelector: (c) => { setSelectorSeed(c); setSelectorKey((k) => k + 1) },
  })

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function buildInputs() {
    return {
      ...form,
      grade: curr.grade,
      subject: curr.subject,
      topic: curr.topic,
      subtopic: curr.subtopic,
      curriculum: curr.curriculum,
      framework: curr.framework,
    }
  }

  async function regenerateSection(sectionId) {
    if (!ensureCanGenerate('flashcards')) return null
    const inputs = buildInputs()
    const lockResult = await runRegenerateLocked({
      // Section-scoped fingerprint so a regenerate mints its own key rather
      // than resuming the full-generate result.
      fingerprint: stableFingerprint({ ...inputs, __regenerateSection: sectionId }),
      action: async (idempotencyKey) => {
        const outcome = await generateFlashcards({ ...inputs, idempotencyKey })
        if (!outcome.ok) {
          const err = new Error(outcome.error || 'Generation failed')
          err.response = outcome
          throw err
        }
        return outcome
      },
    })
    if (lockResult.reason === 'locked') return null
    const res = lockResult.ok ? lockResult.data : (lockResult.error?.response || { ok: false })
    if (res.ok && res.data?.flashcards) {
      const fresh = res.data.flashcards
      setFlashcards((prev) => (prev ? { ...prev, [sectionId]: fresh[sectionId] } : fresh))
      return fresh
    }
    return null
  }

  function saveToLibrary() {
    if (!generationId) return
    attachLibraryToGeneration(generationId, {
      libraryType: LIBRARY_TYPES.NOTES,
      syllabusHint: curr.curriculum === 'previous' ? 'OBC' : 'CBC',
      grade: curr.grade,
      subject: curr.subject,
    }).catch((err) => console.error('[library attach]', err))
  }

  async function onGenerate(e) {
    e?.preventDefault?.()
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
    const run = ++runRef.current
    setHandedOff(false)
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setFlashcards(null)
    setStudyIndex(0)
    setIsFlipped(false)

    const inputs = buildInputs()
    const lockResult = await runGenerateLocked({
      fingerprint: stableFingerprint(inputs),
      action: async (idempotencyKey) => {
        const outcome = await generateFlashcards({ ...inputs, idempotencyKey })
        if (!outcome.ok) {
          // generateFlashcards() resolves rather than throws; a genuine failure
          // must be THROWN so the lock keeps the key reserved for a same-input
          // retry (never re-billed) instead of minting a fresh key.
          const err = new Error(outcome.error || 'Generation failed')
          err.response = outcome
          throw err
        }
        return outcome
      },
    })
    if (run !== runRef.current) return
    if (!isMounted.current) return
    if (lockResult.reason === 'locked') return // a duplicate click slipped past the disabled button
    const res = lockResult.ok ? lockResult.data : (lockResult.error?.response || {
      ok: false, error: lockResult.error?.message || 'Generation failed. Please try again.',
    })
    if (res.ok && res.data?.status === 'processing') {
      // The server already has this exact request in flight (a retried network
      // call or another tab) — leave "Generating…" showing; the owning call
      // completes it.
      return
    }
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error)
      return
    }
    setFlashcards(res.data.flashcards)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    draft.clear().catch(() => {})

    if (res.data.generationId) {
      // Flashcards live alongside Notes — they're a study aid, not an
      // assessment.
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.NOTES,
        syllabusHint: curr.curriculum === 'previous' ? 'OBC' : 'CBC',
        grade:       curr.grade,
        subject:     curr.subject,
      }).catch((err) => console.error('[library attach]', err))
    }
  }

  const cards = flashcards?.cards || []
  const totalCards = cards.length

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
      <div className="w-full">
        <StudioPageHeader
          eyebrow="Flashcards"
          title="Revision cards"
          subtitle="Study on screen or print cut-outs for your class — Zambian CBC vocab, definitions, formulas."
          emoji="🎴"
        />

        <StudioAssignmentChangeNotice
          uid={currentUser?.uid}
          currentSeed={{ grade: curr.grade || selectorSeed?.grade || '', subject: curr.subject || selectorSeed?.subject || '', curriculum: curr.curriculum || selectorSeed?.curriculum || '' }}
          onApply={(seed) => { setSelectorSeed(seed); setSelectorKey((k) => k + 1); setCurr({}) }}
        hasUnsavedChanges={draft.status !== 'idle'}
        saveDraft={draft.flush}
        />
        <div className="mb-4"><DraftRecoveryPrompt {...draft} label="flashcards" /></div>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Input panel */}
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit sticky top-4"
          >
            <div className="flex justify-end">
              <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
            </div>
            <StudioCurriculumSelector
              key={selectorKey}
              value={selectorSeed}
              onChange={setCurr}
            />
            <FieldGrid>
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
            </FieldGrid>
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

            <GenerateButton generating={status === 'generating'}>
              Generate Flashcards
            </GenerateButton>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} flashcard sets used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* Output panel */}
          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          {handedOff && status === 'success' && flashcards ? (
          <section className="studio-card p-5 min-h-[400px]">
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>
                      {flashcards.header?.title || 'Flashcards'}
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                      {totalCards} cards · click any card to flip · press Study for full-screen mode
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => enterStudy(0)} className="studio-btn-primary">
                      <Icon as={Play} size="sm" /> Study mode
                    </button>
                    <button onClick={onExport} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Download .docx
                    </button>
                    <button onClick={onExportPdf} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Download .pdf
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
          </section>
          ) : (
            <LiveGenerationCanvas
              tool="flashcards"
              status={status}
              result={flashcards}
              docTitle={flashcards?.header?.title}
              title="Making your flashcards…"
              emptyState={<EmptyState />}
              errorMessage={errorMessage}
              savedToLibrary={Boolean(generationId)}
              onStop={() => { runRef.current += 1; setStatus('idle') }}
              onRegenerate={() => onGenerate()}
              onRegenerateSection={regenerateSection}
              onSaveToLibrary={saveToLibrary}
              onContinueEditing={() => setHandedOff(true)}
              onRetry={() => setStatus('idle')}
              continueLabel="Continue to editing & export"
            />
          )}
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

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <StudioEmptyState emoji="🎴" tone="#fde9b8" title="Ready for revision cards">
      Pick a topic and you'll get a deck of flashcards you can study on-screen
      or print as cut-outs for class.
    </StudioEmptyState>
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
              ? { background: '#fff5e6', borderColor: '#d97757' }
              : { background: 'var(--zt-card)', borderColor: '#0e2a32' }
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

