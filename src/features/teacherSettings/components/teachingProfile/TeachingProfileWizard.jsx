import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useFocusTrap from '../../../../hooks/useFocusTrap'
import { useAuth } from '../../../../contexts/AuthContext'
import Icon from '../../../../shared/components/Icon'
import ConfirmDialog from '../../../../shared/components/ConfirmDialog'
import { CheckCircleIcon as CheckCircle, Plus, StarIcon as Star, AlertTriangle } from '../../../../shared/components/icons'
import FieldRow from '../fields/FieldRow'
import SelectField from '../fields/SelectField'
import AssignmentFormModal from './AssignmentFormModal'
import {
  addAssignment,
  removeAssignment,
  setDefaultAssignment,
  saveTeachingProfile,
} from '../../../../utils/teachingProfileService'
import {
  SCHOOL_LEVELS,
  gradeLabel,
  subjectLabel,
  curriculumTypeLabel,
} from '../../../../utils/teachingProfileCore'
import { NATIONAL_CALENDAR_NAME } from '../../../../utils/calendarResolver'

// Lazy so the feedback surface (and its Firebase import) only loads if a
// teacher actually opens "Report a problem" from step 3.
const FeedbackDialog = lazy(() => import('../../../feedback').then(m => ({ default: m.FeedbackDialog })))

const STEPS = ['Your School', 'Your Teaching', 'Current Term', 'Review & Save']

// Resume from the earliest incomplete required step so a returning teacher never
// re-enters what they already saved.
function earliestIncompleteStep(profile, assignments) {
  const level = profile?.schoolLevel
  const year = profile?.academicYear
  const active = (assignments || []).filter((a) => a && a.isActive !== false)
  if (!level || !year) return 1
  if (active.length === 0) return 2
  return 4 // school + assignments exist → resume at review / default / save
}

// The four-step Teaching Profile setup wizard (supersedes the inline draft
// baseline). One step at a time with a stepper header; centred panel on
// desktop/tablet, bottom sheet on mobile. Assignments are persisted as they are
// added (section 12); the final Save flips the profile to active + onboarding
// complete and pins the default dashboard context.
//
// Props: { uid, initialProfile, initialAssignments, context, onClose, onComplete }
export default function TeachingProfileWizard({
  uid,
  initialProfile = {},
  initialAssignments = [],
  context = { status: 'unavailable' },
  onClose,
  onComplete,
}) {
  const { userProfile, updateProfileFields } = useAuth()
  const panelRef = useRef(null)

  const [step, setStep] = useState(() => earliestIncompleteStep(initialProfile, initialAssignments))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [assignModal, setAssignModal] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null) // assignment pending removal
  const [exitConfirm, setExitConfirm] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const calendarOk = context.status === 'ok'
  const defaultYear = String(calendarOk ? context.academicYear : new Date().getFullYear())

  const [school, setSchool] = useState({
    schoolName: typeof userProfile?.school === 'string' ? userProfile.school : '',
    schoolLevel: initialProfile.schoolLevel || '',
    academicYear: initialProfile.academicYear || defaultYear,
  })
  const [assignments, setAssignments] = useState(initialAssignments)
  const [defaultId, setDefaultId] = useState(
    initialProfile.defaultAssignmentId || initialAssignments[0]?.id || '',
  )

  // Exit intent — if any assignment was already saved, confirm (and reassure
  // that the saved work is kept) before closing an incomplete wizard.
  const requestClose = () => {
    if (saving) return
    if (assignments.length > 0) setExitConfirm(true)
    else onClose?.()
  }

  useFocusTrap(panelRef, { active: true, onEscape: requestClose })

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return [String(y - 1), String(y), String(y + 1), defaultYear].filter((v, i, a) => a.indexOf(v) === i)
  }, [defaultYear])

  const activeAssignments = assignments.filter((a) => a.isActive !== false)

  // ── assignment add/remove (persist immediately) ────────────────────────────
  const onAddAssignment = async (payload) => {
    const created = await addAssignment(uid, payload)
    setAssignments((list) => {
      const next = [...list, created]
      if (!defaultId) setDefaultId(created.id)
      return next
    })
    setAssignModal(false)
  }
  const onRemoveAssignment = async (id) => {
    try {
      // Only removes the assignment record — never any lesson plan, test or
      // other teaching document.
      await removeAssignment(uid, id)
      setAssignments((list) => list.filter((a) => a.id !== id))
      setDefaultId((d) => (d === id ? (assignments.find((a) => a.id !== id)?.id || '') : d))
      setConfirmRemove(null)
    } catch {
      setError('Could not remove that assignment. Please try again.')
      setConfirmRemove(null)
    }
  }

  // ── step gating ────────────────────────────────────────────────────────────
  const canNext = () => {
    if (step === 1) return !!school.schoolLevel && !!school.academicYear
    if (step === 2) return activeAssignments.length >= 1
    if (step === 3) return true
    return true
  }

  const goNext = () => {
    setError('')
    if (!canNext()) {
      setError(
        step === 1
          ? 'Choose your school level and academic year.'
          : step === 2
            ? 'Add at least one teaching assignment.'
            : '',
      )
      return
    }
    setStep((s) => Math.min(4, s + 1))
  }
  const goBack = () => { setError(''); setStep((s) => Math.max(1, s - 1)) }

  // ── final save ─────────────────────────────────────────────────────────────
  const onSave = async () => {
    setSaving(true)
    setError('')
    try {
      const chosenDefault = defaultId || activeAssignments[0]?.id || ''
      if (chosenDefault) {
        await setDefaultAssignment(uid, chosenDefault, assignments.map((a) => a.id))
      }
      await saveTeachingProfile(uid, {
        schoolLevel: school.schoolLevel,
        calendarId: 'moe-national',
        calendarSource: 'national',
        academicYear: String(school.academicYear),
        defaultAssignmentId: chosenDefault,
        profileStatus: 'active',
        onboardingCompleted: true,
      })
      // Best-effort: keep the shared school NAME in sync on the existing
      // users.school field (authoritative for display; hero/exports read it).
      // Trim, cap length, and never overwrite an existing name with empty.
      const trimmedSchool = school.schoolName.trim().slice(0, 200)
      if (trimmedSchool && trimmedSchool !== (userProfile?.school || '')) {
        try { await updateProfileFields({ school: trimmedSchool }) } catch { /* non-fatal */ }
      }
      onComplete?.()
      onClose?.()
    } catch (err) {
      console.error('Teaching Profile wizard save failed:', err)
      setError('Could not save your Teaching Profile. Please check your connection and try again.')
      setSaving(false)
    }
  }

  const titleId = 'tp-wizard-title'

  return (
    <div className="tset-tp-modal__overlay" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) requestClose()
    }}>
      <div className="tset-tp-modal tset-tp-wizard" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <div className="tset-tp-modal__handle" aria-hidden="true" />
        <header className="tset-tp-modal__head">
          <h2 id={titleId} className="tset-section__title">Teaching Profile setup</h2>
          <button type="button" className="tset-tp-iconbtn" onClick={requestClose} aria-label="Close" disabled={saving}>✕</button>
        </header>

        {/* Stepper */}
        <ol className="tset-tp-steps" aria-label={`Step ${step} of 4`}>
          {STEPS.map((label, i) => {
            const n = i + 1
            const state = n === step ? 'current' : n < step ? 'done' : 'upcoming'
            return (
              <li key={label} className={`tset-tp-step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="tset-tp-step__dot">{n < step ? <Icon as={CheckCircle} size="sm" aria-hidden="true" /> : n}</span>
                <span className="tset-tp-step__label">{label}</span>
              </li>
            )
          })}
        </ol>

        <div className="tset-tp-wizard__body">
          {step === 1 && (
            <StepSchool school={school} setSchool={setSchool} yearOptions={yearOptions} />
          )}
          {step === 2 && (
            <StepAssignments
              assignments={activeAssignments}
              onAdd={() => setAssignModal(true)}
              onRemove={(a) => setConfirmRemove(a)}
            />
          )}
          {step === 3 && (
            <StepCurrentPeriod
              context={context}
              academicYear={school.academicYear}
              onReport={() => setReportOpen(true)}
            />
          )}
          {step === 4 && (
            <StepReview
              school={school}
              assignments={activeAssignments}
              defaultId={defaultId}
              setDefaultId={setDefaultId}
              context={context}
            />
          )}
        </div>

        {error && <p className="tset-savebar__status tset-savebar__status--error" role="alert">{error}</p>}

        <div className="tset-tp-modal__actions tset-tp-wizard__actions">
          {step > 1 ? (
            <button type="button" className="tset-btn tset-btn--ghost" onClick={goBack} disabled={saving}>Back</button>
          ) : (
            <button type="button" className="tset-btn tset-btn--ghost" onClick={requestClose} disabled={saving}>Exit setup</button>
          )}
          {step < 4 ? (
            <button type="button" className="tset-btn" onClick={goNext}>Next</button>
          ) : (
            <button type="button" className="tset-btn" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Teaching Profile'}
            </button>
          )}
        </div>
      </div>

      {assignModal && (
        <AssignmentFormModal
          open
          mode="add"
          existing={assignments}
          onSubmit={onAddAssignment}
          onClose={() => setAssignModal(false)}
        />
      )}

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove this teaching assignment?"
        message="It will no longer appear in your dashboard or studio selectors. Existing lesson plans, tests and other documents will not be deleted."
        confirmLabel="Remove assignment"
        cancelLabel="Keep assignment"
        onConfirm={() => onRemoveAssignment(confirmRemove.id)}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={exitConfirm}
        variant="primary"
        title="Finish setting up later?"
        message="The teaching assignments you added have already been saved. Your Teaching Profile will remain incomplete until you finish the remaining steps."
        confirmLabel="Finish later"
        cancelLabel="Continue setup"
        onConfirm={() => { setExitConfirm(false); onClose?.() }}
        onCancel={() => setExitConfirm(false)}
      />

      {reportOpen && (
        <Suspense fallback={null}>
          <FeedbackDialog open onClose={() => setReportOpen(false)} source="teaching-profile-calendar" />
        </Suspense>
      )}
    </div>
  )
}

// ── Step 1: School & Calendar ─────────────────────────────────────────────────
function StepSchool({ school, setSchool, yearOptions }) {
  return (
    <div>
      <p className="tset-tp-wizard__lead">Tell us about your school</p>
      <div className="tset-grid">
        <FieldRow label="School name (optional)" htmlFor="w-school">
          <input id="w-school" className="studio-input" type="text" maxLength={200}
            value={school.schoolName}
            onChange={(e) => setSchool((s) => ({ ...s, schoolName: e.target.value }))}
            placeholder="e.g. Leopards Hill Primary" />
        </FieldRow>
        <FieldRow label="School level" htmlFor="w-level">
          <SelectField id="w-level" value={school.schoolLevel}
            onChange={(schoolLevel) => setSchool((s) => ({ ...s, schoolLevel }))}
            options={SCHOOL_LEVELS} placeholder="Select level" />
        </FieldRow>
        <FieldRow label="School Calendar" htmlFor="w-cal" help="ZedExams uses this to identify terms, teaching weeks and holidays.">
          <input id="w-cal" className="studio-input" type="text" value={NATIONAL_CALENDAR_NAME} readOnly disabled />
        </FieldRow>
        <FieldRow label="Academic year" htmlFor="w-year">
          <SelectField id="w-year" value={school.academicYear}
            onChange={(academicYear) => setSchool((s) => ({ ...s, academicYear }))}
            options={yearOptions} placeholder="Select year" />
        </FieldRow>
      </div>
    </div>
  )
}

// ── Step 2: Teaching assignments ──────────────────────────────────────────────
function StepAssignments({ assignments, onAdd, onRemove }) {
  return (
    <div>
      <p className="tset-tp-wizard__lead">What do you teach?</p>
      {assignments.length === 0 ? (
        <p className="tset-tp-wizard__hint">Add each grade and subject you teach. You can add several — including different curricula.</p>
      ) : (
        <ul className="tset-tp-wizard__list">
          {assignments.map((a) => (
            <li key={a.id} className="tset-tp-wizard__chip">
              <span>{gradeLabel(a.grade)} · {subjectLabel(a.subject)}{a.className ? ` · ${a.className}` : ''} · {curriculumTypeLabel(a.curriculumType)}</span>
              <button type="button" className="tset-tp-iconbtn" aria-label={`Remove ${gradeLabel(a.grade)} ${subjectLabel(a.subject)}`} onClick={() => onRemove(a)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={onAdd}>
        <Icon as={Plus} size="sm" aria-hidden="true" /> Add teaching assignment
      </button>
    </div>
  )
}

// ── Step 3: Current teaching period (derived, read-only) ─────────────────────
// Confirmation-only: the School Calendar resolver is the source of truth for
// the term/week/holiday state. There are deliberately NO editable override
// controls (no permission system exists yet) — instead the teacher can review
// the calendar or report an incorrect period.
function StepCurrentPeriod({ context, academicYear, onReport }) {
  return (
    <div>
      <p className="tset-tp-wizard__lead">Confirm your current teaching period</p>
      {context.status === 'ok' ? (
        context.isClosed ? (
          <div className="tset-tp-wizard__period">
            <p className="tset-tp-cal__closed">School is currently closed.</p>
            {context.nextTerm && (
              <p className="tset-tp-cal__term">Prepare for {context.nextTerm.termName} · Week 1 — school opens {context.nextTerm.openLabel}</p>
            )}
          </div>
        ) : (
          <div className="tset-tp-wizard__period">
            <p className="tset-tp-cal__term">{context.termName} · Week {context.weekNumber}</p>
            <p className="tset-tp-cal__meta">{context.weekBeginningLabel}–{context.weekEndingLabel}</p>
          </div>
        )
      ) : (
        <div className="tset-tp-wizard__period">
          <Icon as={AlertTriangle} size="md" aria-hidden="true" />
          <p className="tset-tp-cal__meta">School Calendar information is unavailable. You can still finish setting up and review your calendar later.</p>
        </div>
      )}
      <p className="tset-tp-wizard__hint">
        The School Calendar works this out for you from {academicYear}. It updates automatically as the term
        progresses — you don’t need to enter it by hand.
      </p>
      <div className="tset-tp-wizard__incorrect">
        <p className="tset-tp-wizard__hint">Is this teaching period incorrect? Open the School Calendar to review the dates or report the issue.</p>
        <div className="tset-tp-cal__actions">
          <Link to="/teacher/calendar" target="_blank" rel="noopener noreferrer" className="tset-btn tset-btn--ghost tset-btn--sm">View School Calendar</Link>
          <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={onReport}>Report a problem</button>
        </div>
      </div>
    </div>
  )
}

// ── Step 4: Default dashboard context ─────────────────────────────────────────
function StepReview({ school, assignments, defaultId, setDefaultId, context }) {
  return (
    <div>
      <p className="tset-tp-wizard__lead">Choose your default teaching view</p>
      <p className="tset-tp-wizard__hint">This is the first teaching context shown when you open your dashboard. You can switch to another grade or subject at any time.</p>
      <fieldset className="tset-tp-wizard__radios">
        <legend className="studio-label">Default teaching assignment</legend>
        {assignments.map((a) => (
          <label key={a.id} className={`tset-tp-radio${defaultId === a.id ? ' is-on' : ''}`}>
            <input type="radio" name="tp-default" value={a.id} checked={defaultId === a.id} onChange={() => setDefaultId(a.id)} />
            <span className="tset-tp-radio__text">
              {gradeLabel(a.grade)} · {subjectLabel(a.subject)}{a.className ? ` · ${a.className}` : ''}
            </span>
            {defaultId === a.id && <Icon as={Star} size="sm" aria-hidden="true" />}
          </label>
        ))}
      </fieldset>
      <div className="tset-tp-wizard__summary">
        <p><strong>School:</strong> {school.schoolName || '—'}{school.schoolLevel ? ` · ${SCHOOL_LEVELS.find((l) => l.value === school.schoolLevel)?.label}` : ''}</p>
        <p><strong>Calendar:</strong> {NATIONAL_CALENDAR_NAME} · {school.academicYear}</p>
        {context.status === 'ok' && !context.isClosed && (
          <p><strong>Now:</strong> {context.termName} · Week {context.weekNumber}</p>
        )}
      </div>
    </div>
  )
}
