/**
 * AssignmentWizard — full-screen modal that walks the teacher through
 * picking targets, configuring options, and reviewing before the
 * assignment fans out.
 *
 * Modes (mode segmented control):
 *   - automatic → grade/subject/school rule resolves to a class list
 *   - manual    → hand-pick classes (+ optional learner subset)
 *
 * Flow:
 *   1. Mode + smart suggestion + template
 *   2. Targets (auto rule OR class picker)
 *   3. Options (timer, retakes, schedule, notify…)
 *   4. Review & confirm
 *
 * The wizard does not own quiz data. It receives `quiz` and calls
 * `assignQuizToTargets()` on commit; the parent decides what to do
 * with the per-target outcome (toast, page refresh, etc.).
 *
 * Mobile-first: full-bleed bottom sheet on phones, centred modal on
 * tablet/desktop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { listTeacherClasses } from '../../../utils/classes'
import {
  assignQuizToTargets,
  buildSmartSuggestion,
  listAssignmentsForResource,
  resolveAutomaticTargets,
} from '../../../utils/quizAssignments'
import { getTemplate, resolveTemplateDates } from '../../../utils/assignmentTemplates'
import AssignmentModePicker from './AssignmentModePicker'
import AutomaticPanel from './AutomaticPanel'
import ManualPanel from './ManualPanel'
import SmartSuggestionCard from './SmartSuggestionCard'
import TemplatePicker from './TemplatePicker'
import AssignmentSummary from './AssignmentSummary'

const DEFAULT_OPTIONS = {
  timed: false,
  allowRetakes: false,
  shuffleQuestions: false,
  lockAfterSubmission: false,
  notifyLearners: true,
  addToDailyChallenge: false,
  openAtInput: '',
  dueAtInput: '',
}

const SUB_STEPS = ['mode', 'target', 'options', 'review']
const STEP_TITLES = {
  mode: 'Pick a mode',
  target: 'Choose targets',
  options: 'Settings',
  review: 'Review & confirm',
}

function toDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

async function fetchClassMembers(uids) {
  if (!uids.length) return new Map()
  const out = new Map()
  for (let i = 0; i < uids.length; i += 10) {
    const chunk = uids.slice(i, i + 10)
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('__name__', 'in', chunk)))
      for (const d of snap.docs) {
        const data = d.data() || {}
        out.set(d.id, {
          uid: d.id,
          displayName: data.displayName || '',
          email: data.email || '',
        })
      }
    } catch (err) {
      console.warn('[AssignmentWizard] member fetch failed', err)
    }
  }
  return out
}

export default function AssignmentWizard({
  open,
  quiz,
  resourceType = 'quiz',
  initialClassId = null,
  onClose,
  onAssigned,
}) {
  const { currentUser } = useAuth()

  const [step, setStep] = useState('mode')
  const [mode, setMode] = useState('automatic')
  const [template, setTemplate] = useState(null)
  const [rule, setRule] = useState({ grade: null, subject: null, school: null })
  const [selectedClassIds, setSelectedClassIds] = useState([])
  const [selectedLearnerUids, setSelectedLearnerUids] = useState([])
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS })

  const [classes, setClasses] = useState([])
  const [existingClassIds, setExistingClassIds] = useState([])
  const [learnerLookup, setLearnerLookup] = useState(new Map())
  const [learnersLoading, setLearnersLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [hideSuggestion, setHideSuggestion] = useState(false)

  const panelRef = useRef(null)
  const previouslyFocused = useRef(null)

  // Reset state every time the modal opens.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement
    setStep('mode')
    setBusy(false)
    setError('')
    setOutcome(null)
    setHideSuggestion(false)
    setMode('automatic')
    setTemplate(null)
    setRule({
      grade: quiz?.grade ? String(quiz.grade) : null,
      subject: quiz?.subject || null,
      school: null,
    })
    setSelectedClassIds(initialClassId ? [initialClassId] : [])
    setSelectedLearnerUids([])
    setOptions({ ...DEFAULT_OPTIONS })
    return () => {
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus()
      }
    }
  }, [open, quiz?.grade, quiz?.subject, initialClassId])

  // Load the teacher's classes + existing assignments for the quiz.
  useEffect(() => {
    if (!open || !currentUser?.uid || !quiz?.id) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      listTeacherClasses(currentUser.uid, { includeArchived: false, limit: 100 }).catch((err) => {
        console.warn('[AssignmentWizard] classes load failed', err)
        return []
      }),
      listAssignmentsForResource(quiz.id).catch((err) => {
        console.warn('[AssignmentWizard] existing assignments load failed', err)
        return []
      }),
    ])
      .then(([loadedClasses, existing]) => {
        if (cancelled) return
        setClasses(loadedClasses)
        setExistingClassIds(existing.map((a) => a.classId))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, currentUser?.uid, quiz?.id])

  // Lazy-load learner display info when manual mode + classes selected.
  useEffect(() => {
    if (!open || mode !== 'manual' || selectedClassIds.length === 0) return
    const uids = new Set()
    for (const klass of classes) {
      if (!selectedClassIds.includes(klass.id)) continue
      for (const uid of (klass.learners || [])) uids.add(uid)
    }
    const missing = Array.from(uids).filter((uid) => !learnerLookup.has(uid))
    if (missing.length === 0) return
    let cancelled = false
    setLearnersLoading(true)
    fetchClassMembers(missing)
      .then((map) => {
        if (cancelled) return
        setLearnerLookup((prev) => {
          const next = new Map(prev)
          for (const [uid, summary] of map.entries()) next.set(uid, summary)
          return next
        })
      })
      .finally(() => { if (!cancelled) setLearnersLoading(false) })
    return () => { cancelled = true }
  }, [open, mode, selectedClassIds, classes, learnerLookup])

  // Escape closes.
  useEffect(() => {
    if (!open) return
    function onKey(event) { if (event.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  const suggestion = useMemo(() => buildSmartSuggestion({ quiz, classes }), [quiz, classes])

  const automaticTargets = useMemo(() => {
    if (mode !== 'automatic') return []
    return resolveAutomaticTargets(classes, rule)
  }, [mode, classes, rule])

  const targets = useMemo(() => {
    const source = mode === 'automatic'
      ? automaticTargets
      : classes.filter((c) => selectedClassIds.includes(c.id))
    return source.map((klass) => ({
      classId: klass.id,
      className: klass.name || '',
      classGrade: klass.grade,
      classSubject: klass.subject,
      classLearners: klass.learners || [],
      learnerUids: mode === 'manual' && selectedLearnerUids.length > 0
        ? selectedLearnerUids.filter((uid) => (klass.learners || []).includes(uid))
        : null,
    }))
  }, [mode, automaticTargets, classes, selectedClassIds, selectedLearnerUids])

  const eligibleTargets = useMemo(
    () => targets.filter((t) => !existingClassIds.includes(t.classId)),
    [targets, existingClassIds],
  )

  const resolvedOptions = useMemo(() => ({
    ...options,
    openAt: toDate(options.openAtInput),
    dueAt: toDate(options.dueAtInput),
  }), [options])

  function setOptionField(field, value) {
    setOptions((prev) => ({ ...prev, [field]: value }))
  }

  function applyTemplate(id) {
    setTemplate(id)
    if (!id) return
    const tpl = getTemplate(id)
    if (!tpl) return
    const { openAt, dueAt } = resolveTemplateDates(tpl)
    setOptions((prev) => ({
      ...prev,
      timed: tpl.defaults.timed,
      allowRetakes: tpl.defaults.allowRetakes,
      shuffleQuestions: tpl.defaults.shuffleQuestions,
      lockAfterSubmission: tpl.defaults.lockAfterSubmission,
      notifyLearners: tpl.defaults.notifyLearners,
      addToDailyChallenge: tpl.defaults.addToDailyChallenge,
      openAtInput: openAt ? toLocalInput(openAt) : '',
      dueAtInput: dueAt ? toLocalInput(dueAt) : '',
    }))
  }

  function acceptSuggestion() {
    if (!suggestion) return
    setMode('automatic')
    setRule({
      grade: suggestion.grade || null,
      subject: suggestion.scope === 'grade+subject' ? suggestion.subject : null,
      school: null,
    })
    setStep('target')
    setHideSuggestion(true)
  }

  const goToStep = useCallback((nextStep) => {
    setError('')
    setStep(nextStep)
  }, [])

  function nextStep() {
    if (step === 'mode') goToStep('target')
    else if (step === 'target') goToStep('options')
    else if (step === 'options') goToStep('review')
  }

  function prevStep() {
    const index = SUB_STEPS.indexOf(step)
    if (index > 0) goToStep(SUB_STEPS[index - 1])
  }

  function canProceed() {
    if (step === 'mode') return true
    if (step === 'target') {
      if (mode === 'automatic') return automaticTargets.length > 0
      return selectedClassIds.length > 0
    }
    return true
  }

  async function handleConfirm() {
    setError('')
    if (eligibleTargets.length === 0) {
      setError('No eligible targets — every selected class already has this quiz.')
      return
    }
    setBusy(true)
    try {
      const result = await assignQuizToTargets({
        resourceType,
        resourceId: quiz.id,
        targets: eligibleTargets,
        existingClassIds,
        options: {
          ...resolvedOptions,
          template,
          assignmentMode: mode,
        },
      })
      setOutcome(result)
      if (result.errors.length === 0) {
        onAssigned?.(result)
      }
    } catch (err) {
      console.error('[AssignmentWizard] assign failed', err)
      setError(err?.message || 'Could not finish assigning. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const stepIndex = SUB_STEPS.indexOf(step)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assignment-wizard-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div
        aria-hidden="true"
        onClick={() => !busy && onClose?.()}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        className={[
          'relative w-full sm:max-w-2xl max-h-[92vh] theme-card theme-border border',
          'rounded-t-3xl sm:rounded-3xl shadow-elev-xl overflow-hidden flex flex-col',
        ].join(' ')}
      >
        <header className="flex items-start justify-between gap-3 border-b theme-border p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <p className="text-eyebrow theme-text-muted">
              Step {stepIndex + 1} of {SUB_STEPS.length}
            </p>
            <h2 id="assignment-wizard-title" className="theme-text text-display-md mt-1 truncate">
              {STEP_TITLES[step]}
            </h2>
            <p className="theme-text-muted text-xs mt-1 truncate">
              Assigning: <span className="theme-text font-bold">{quiz?.title || 'this quiz'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="theme-text-muted hover:theme-text rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
          >
            ✕
          </button>
        </header>

        <div className="theme-bg-subtle px-4 py-2 sm:px-5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={SUB_STEPS.length}
            aria-valuenow={stepIndex + 1}
            className="h-1.5 w-full rounded-full bg-white/40 overflow-hidden"
          >
            <div
              className="theme-accent-fill h-full rounded-full transition-all duration-300"
              style={{ width: `${((stepIndex + 1) / SUB_STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {outcome ? (
            <OutcomePanel outcome={outcome} onClose={onClose} />
          ) : (
            <>
              {loading && (
                <p className="theme-text-muted text-sm">Loading your classes…</p>
              )}

              {step === 'mode' && (
                <div className="space-y-4">
                  <AssignmentModePicker value={mode} onChange={setMode} />
                  {suggestion && !hideSuggestion && (
                    <SmartSuggestionCard
                      suggestion={suggestion}
                      onAccept={acceptSuggestion}
                      onCustomise={() => setHideSuggestion(true)}
                      busy={busy}
                    />
                  )}
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest theme-text-muted mb-2">
                      Quick templates
                    </p>
                    <TemplatePicker value={template} onChange={applyTemplate} />
                  </div>
                </div>
              )}

              {step === 'target' && (
                mode === 'automatic' ? (
                  <AutomaticPanel
                    rule={rule}
                    onRuleChange={setRule}
                    options={options}
                    onOptionChange={setOptionField}
                    allClasses={classes}
                    existingClassIds={existingClassIds}
                  />
                ) : (
                  <ManualPanel
                    allClasses={classes}
                    selectedClassIds={selectedClassIds}
                    onSelectedClassesChange={setSelectedClassIds}
                    selectedLearnerUids={selectedLearnerUids}
                    onSelectedLearnersChange={setSelectedLearnerUids}
                    options={options}
                    onOptionChange={setOptionField}
                    existingClassIds={existingClassIds}
                    learnerLookup={learnerLookup}
                    learnersLoading={learnersLoading}
                  />
                )
              )}

              {step === 'options' && (
                <section className="surface space-y-4 p-4 sm:p-5">
                  <header className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-lg">⚙️</span>
                    <h3 className="theme-text text-base font-black">Review settings</h3>
                  </header>
                  <p className="theme-text-muted text-xs">
                    Settings carry across from the previous step — change
                    anything before reviewing the final summary.
                  </p>
                  <OptionsRecap options={resolvedOptions} mode={mode} template={template} />
                </section>
              )}

              {step === 'review' && (
                <AssignmentSummary
                  mode={mode}
                  targets={eligibleTargets}
                  options={resolvedOptions}
                  template={template}
                  quizTitle={quiz?.title}
                />
              )}

              {error && (
                <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {!outcome && (
          <footer className="border-t theme-border p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={stepIndex === 0 ? onClose : prevStep}
              disabled={busy}
              className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle disabled:opacity-50 min-h-[44px]"
            >
              {stepIndex === 0 ? 'Cancel' : '← Back'}
            </button>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <span className="theme-text-muted text-xs font-bold">
                {eligibleTargets.length} class{eligibleTargets.length === 1 ? '' : 'es'} ready
              </span>
              {step !== 'review' ? (
                <button
                  type="button"
                  onClick={nextStep}
                  disabled={!canProceed()}
                  className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50 min-h-[44px]"
                >
                  Continue →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={busy || eligibleTargets.length === 0}
                  className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50 min-h-[44px]"
                >
                  {busy ? 'Assigning…' : `Assign to ${eligibleTargets.length} class${eligibleTargets.length === 1 ? '' : 'es'}`}
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

function OptionsRecap({ options, mode, template }) {
  const items = []
  if (options.timed) items.push('Timed')
  if (options.allowRetakes) items.push('Retakes allowed')
  if (options.shuffleQuestions) items.push('Questions shuffled')
  if (options.lockAfterSubmission) items.push('Lock after submission')
  if (options.notifyLearners !== false) items.push('Notify learners')
  if (options.addToDailyChallenge) items.push('Daily challenge')
  return (
    <div className="space-y-3">
      <p className="theme-text-muted text-xs">
        Mode: <strong className="theme-text">{mode === 'automatic' ? 'Automatic' : 'Manual'}</strong>
        {' · '}Template: <strong className="theme-text">{template ? getTemplate(template)?.label : 'Custom'}</strong>
      </p>
      {items.length === 0 ? (
        <p className="theme-text-muted text-sm">No extra options enabled.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((label) => (
            <li
              key={label}
              className="rounded-full theme-accent-bg theme-accent-text px-2.5 py-1 text-xs font-black"
            >
              ✓ {label}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-2 text-xs theme-text-muted">
        <div>
          <p className="font-black uppercase tracking-widest">Opens</p>
          <p className="theme-text font-bold text-sm">
            {options.openAt ? options.openAt.toLocaleString() : 'Immediately'}
          </p>
        </div>
        <div>
          <p className="font-black uppercase tracking-widest">Closes</p>
          <p className="theme-text font-bold text-sm">
            {options.dueAt ? options.dueAt.toLocaleString() : 'No close date'}
          </p>
        </div>
      </div>
    </div>
  )
}

function OutcomePanel({ outcome, onClose }) {
  const ok = outcome.assigned.length > 0 && outcome.errors.length === 0
  return (
    <div className="space-y-4">
      <div className={[
        'rounded-2xl border-2 p-4 text-sm',
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : outcome.errors.length === 0
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-rose-200 bg-rose-50 text-rose-900',
      ].join(' ')}>
        <p className="font-black text-base">
          {ok ? '✅ Assignment complete' : outcome.errors.length === 0 ? 'Nothing to assign' : 'Some assignments failed'}
        </p>
        <ul className="mt-2 space-y-1 text-xs">
          {outcome.assigned.length > 0 && <li>Assigned to {outcome.assigned.length} class{outcome.assigned.length === 1 ? '' : 'es'}.</li>}
          {outcome.skipped.length > 0 && <li>Skipped {outcome.skipped.length} that already had this quiz.</li>}
          {outcome.errors.length > 0 && <li>{outcome.errors.length} class{outcome.errors.length === 1 ? '' : 'es'} could not be assigned — please retry.</li>}
        </ul>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 min-h-[44px]"
        >
          Done
        </button>
      </div>
    </div>
  )
}

function toLocalInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
