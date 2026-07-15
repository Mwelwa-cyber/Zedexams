import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import SettingsDetailShell from '../components/SettingsDetailShell'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import Icon from '../../../components/ui/Icon'
import {
  CalendarDays,
  GraduationCap,
  StarIcon as Star,
  Plus,
  CheckCircleIcon as CheckCircle,
  AlertTriangle,
  Clock,
  ClipboardList,
  BookOpen,
  RefreshCw,
  ChevronRight,
} from '../../../components/ui/icons'
import { useTeachingProfile } from '../lib/useTeachingProfile'
import AssignmentFormModal from '../components/teachingProfile/AssignmentFormModal'
import TeachingProfileWizard from '../components/teachingProfile/TeachingProfileWizard'
import {
  saveTeachingProfile,
  addAssignment,
  updateAssignment,
  removeAssignment,
  setDefaultAssignment,
} from '../../../utils/teachingProfileService'
import {
  gradeLabel,
  subjectLabel,
  curriculumTypeLabel,
  resolveDefaultAssignmentId,
  assignmentKey,
  findDuplicateAssignment,
} from '../../../utils/teachingProfileCore'
import { weeklyTargets } from '../../../utils/teachingTargets'
import { buildMigrationPlan } from '../../../utils/teachingProfileMigration'
import { listMyGenerations } from '../../../utils/teacherLibraryService'
import { useFirestore } from '../../../hooks/useFirestore'
import { useAuth } from '../../../contexts/AuthContext'
import TeachingProfileMigrationCard from '../components/teachingProfile/TeachingProfileMigrationCard'

const CALENDAR_REASON_TEXT = {
  calendar_not_found: 'We couldn’t find the calendar linked to your profile.',
  year_not_supported: 'We don’t have calendar data for this year yet.',
  invalid_date: 'The calendar date could not be read.',
}

export default function TeachingProfilePanel() {
  const {
    uid, loading, error, hasProfile, profile, assignments,
    schoolName, context, completion, yearMismatch, effectiveDefaultId, reload,
  } = useTeachingProfile()

  const { userProfile } = useAuth()
  const { getMyAssessments } = useFirestore()
  const [modal, setModal] = useState(null) // { mode:'add'|'edit', initial }
  const [confirmRemove, setConfirmRemove] = useState(null) // assignment to remove
  const [wizardOpen, setWizardOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  // ── existing-teacher migration (suggest a pre-filled profile) ───────────────
  // For a teacher who has no profile yet, infer the classes they teach from their
  // existing work so onboarding starts from a confirmable draft, not a blank
  // form. Suggest-only: nothing is saved until they tick + continue.
  const [migration, setMigration] = useState({ suggestions: [], defaults: {}, error: '' })
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [applyingMigration, setApplyingMigration] = useState(false)
  const [migrationSeed, setMigrationSeed] = useState(null) // { initialProfile, initialAssignments }
  const migrationLoadedRef = useRef(false)

  useEffect(() => {
    if (loading || hasProfile || !uid) return
    if (assignments.length > 0) return // already started — don't re-suggest
    if (migrationLoadedRef.current) return
    migrationLoadedRef.current = true
    let cancelled = false
    ;(async () => {
      // Broader inference (Phase 8 follow-up): recent generations AND test
      // papers. getMyAssessments reads only the assessment docs' summary
      // metadata (grade/subject/curriculum live top-level; question bodies are
      // a subcollection) — no full-document loads. Both are best-effort.
      const [generations, assessments] = await Promise.all([
        listMyGenerations({ uid }).catch(() => []),
        Promise.resolve().then(() => getMyAssessments(uid)).catch(() => []),
      ])
      if (cancelled) return
      const plan = buildMigrationPlan({
        generations,
        assessments,
        teacherPreferences: userProfile?.teacherPreferences,
        existingAssignments: assignments,
      })
      setMigration({ suggestions: plan.suggestions, defaults: plan.defaults, error: '' })
      setSelectedKeys(new Set(plan.suggestions.map((s) => assignmentKey(s))))
    })()
    return () => { cancelled = true }
    // getMyAssessments is stable-enough here: migrationLoadedRef guarantees the
    // inference runs once per mount regardless of hook identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasProfile, uid, assignments, userProfile])

  const toggleSuggestion = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Persist the ticked suggestions, then open the wizard pre-filled from them +
  // the inferred defaults. Assignments persist immediately (same as the wizard's
  // own add path); the profile doc is only written when the wizard is completed.
  const applyMigration = async () => {
    const chosen = migration.suggestions.filter((s) => selectedKeys.has(assignmentKey(s)))
    if (!chosen.length || applyingMigration) return
    setApplyingMigration(true)
    setMigration((m) => ({ ...m, error: '' }))
    try {
      const seedRecords = []
      for (const s of chosen) {
        // Idempotent: never create a second identical assignment. If the teacher
        // already has this grade+subject+class (e.g. a re-run), reuse it.
        const existing = findDuplicateAssignment(assignments, s)
        if (existing) { seedRecords.push(existing); continue }
        const rec = await addAssignment(uid, {
          grade: s.grade, subject: s.subject, className: s.className, curriculumType: s.curriculumType, isActive: true,
        })
        seedRecords.push(rec)
      }
      setMigrationSeed({
        initialProfile: { schoolLevel: migration.defaults.schoolLevel || '', academicYear: migration.defaults.academicYear || '' },
        initialAssignments: seedRecords,
      })
      reload()
      setWizardOpen(true)
    } catch {
      setMigration((m) => ({ ...m, error: 'We could not add those assignments. Please try again or start from scratch.' }))
    } finally {
      setApplyingMigration(false)
    }
  }

  // ── assignment mutations ───────────────────────────────────────────────────
  const submitAssignment = async (payload) => {
    if (modal?.mode === 'edit') {
      await updateAssignment(uid, modal.initial.id, payload)
    } else {
      const created = await addAssignment(uid, payload)
      // First assignment (or no working default) becomes the default (section 12).
      const noDefault = !effectiveDefaultId
      if (assignments.length === 0 || noDefault) {
        await setDefaultAssignment(uid, created.id, [...assignments.map((a) => a.id), created.id])
      }
    }
    setModal(null)
    await reload()
  }

  const makeDefault = async (id) => {
    setBusy(true); setActionError('')
    try {
      await setDefaultAssignment(uid, id, assignments.map((a) => a.id))
      await reload()
    } catch { setActionError('Could not update your default assignment.') } finally { setBusy(false) }
  }

  const toggleActive = async (a) => {
    setBusy(true); setActionError('')
    try {
      await updateAssignment(uid, a.id, { isActive: !a.isActive })
      await reload()
    } catch { setActionError('Could not update the assignment.') } finally { setBusy(false) }
  }

  const doRemove = async () => {
    const a = confirmRemove
    setBusy(true); setActionError('')
    try {
      await removeAssignment(uid, a.id)
      // If we removed the default, promote the next active one.
      const remaining = assignments.filter((x) => x.id !== a.id)
      if (profile.defaultAssignmentId === a.id) {
        const nextDefault = resolveDefaultAssignmentId({ defaultAssignmentId: '' }, remaining)
        if (nextDefault) await setDefaultAssignment(uid, nextDefault, remaining.map((x) => x.id))
        else await saveTeachingProfile(uid, { defaultAssignmentId: '' })
      }
      setConfirmRemove(null)
      await reload()
    } catch { setActionError('Could not remove the assignment.') } finally { setBusy(false) }
  }

  // ── loading / error / empty ────────────────────────────────────────────────
  if (loading) {
    return (
      <SettingsDetailShell rowId="teachingProfile">
        <div className="tset-card tset-tp-skeleton" aria-busy="true">Loading your Teaching Profile…</div>
      </SettingsDetailShell>
    )
  }

  if (error) {
    return (
      <SettingsDetailShell rowId="teachingProfile">
        <div className="tset-card tset-tp-empty">
          <Icon as={AlertTriangle} size="lg" className="tset-tp-empty__icon" />
          <p className="tset-tp-empty__title">{error}</p>
          <button type="button" className="tset-btn" onClick={reload}>Try again</button>
        </div>
      </SettingsDetailShell>
    )
  }

  if (!hasProfile) {
    const hasSuggestions = migration.suggestions.length > 0
    return (
      <SettingsDetailShell rowId="teachingProfile">
        {hasSuggestions ? (
          <TeachingProfileMigrationCard
            suggestions={migration.suggestions}
            selectedKeys={selectedKeys}
            onToggle={toggleSuggestion}
            onApply={applyMigration}
            onSkip={() => { setMigrationSeed(null); setWizardOpen(true) }}
            applying={applyingMigration}
            error={migration.error}
          />
        ) : (
          <div className="tset-card tset-tp-empty">
            <Icon as={GraduationCap} size="lg" className="tset-tp-empty__icon" />
            <p className="tset-tp-empty__title">Set up your Teaching Profile</p>
            <p className="tset-tp-empty__desc">
              Add the grades, subjects and classes you teach so your dashboard and studios can prepare
              the correct teaching work.
            </p>
            {actionError && <p className="tset-savebar__status tset-savebar__status--error" role="alert">{actionError}</p>}
            <button type="button" className="tset-btn" onClick={() => { setMigrationSeed(null); setWizardOpen(true) }}>
              Start Teaching Profile
            </button>
          </div>
        )}
        {wizardOpen && (
          <TeachingProfileWizard
            uid={uid}
            initialProfile={migrationSeed?.initialProfile || profile}
            initialAssignments={migrationSeed?.initialAssignments || assignments}
            context={context}
            onClose={() => setWizardOpen(false)}
            onComplete={reload}
          />
        )}
      </SettingsDetailShell>
    )
  }

  const activeAssignments = assignments.filter((a) => a.isActive)
  const targets = weeklyTargets(activeAssignments)
  const calendarOk = context.status === 'ok'

  return (
    <SettingsDetailShell rowId="teachingProfile">
      {actionError && (
        <p className="tset-savebar__status tset-savebar__status--error" role="alert">{actionError}</p>
      )}

      {/* Draft profile — offer the setup wizard ------------------------------ */}
      {!profile.onboardingCompleted && (
        <div className="tset-card tset-tp-warn" role="status">
          <Icon as={GraduationCap} size="md" className="tset-tp-warn__icon" aria-hidden="true" />
          <div className="tset-tp-warn__body">
            <p className="tset-tp-warn__title">Continue setting up your Teaching Profile</p>
            <p className="tset-tp-warn__desc">Your saved assignments are kept. Finish the quick four-step setup so your dashboard and studios use the right teaching context.</p>
            <button type="button" className="tset-btn tset-btn--sm" onClick={() => setWizardOpen(true)}>Continue setup</button>
          </div>
        </div>
      )}

      {/* Academic-year mismatch (non-blocking) -------------------------------- */}
      {yearMismatch.mismatch && (
        <div className="tset-card tset-tp-warn" role="status">
          <Icon as={AlertTriangle} size="md" className="tset-tp-warn__icon" aria-hidden="true" />
          <div className="tset-tp-warn__body">
            <p className="tset-tp-warn__title">Review academic year</p>
            <p className="tset-tp-warn__desc">
              Your Teaching Profile is set to {yearMismatch.profileYear}, but the connected calendar is
              currently resolving {yearMismatch.resolvedYear}.
            </p>
            <Link to="/settings/calendar" className="tset-btn tset-btn--ghost tset-btn--sm">Review profile</Link>
          </div>
        </div>
      )}

      {/* Completion card ------------------------------------------------------ */}
      <section className="tset-card tset-tp-completion" aria-label="Profile completion">
        <div className="tset-tp-completion__head">
          <div>
            <p className="tset-tp-completion__title">Teaching Profile</p>
            <p className="tset-tp-completion__pct">
              {completion.complete ? 'Teaching Profile complete' : `${completion.percent}% complete`}
            </p>
          </div>
          <div className="tset-tp-meter" role="progressbar" aria-valuenow={completion.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Profile ${completion.percent}% complete`}>
            <span className="tset-tp-meter__fill" style={{ width: `${completion.percent}%` }} />
          </div>
        </div>
        <ul className="tset-tp-checklist">
          {completion.items.map((item) => (
            <li key={item.key} className={`tset-tp-checkitem${item.done ? ' is-done' : ''}`}>
              <Icon as={CheckCircle} size="sm" aria-hidden="true" />
              <span>{item.label}</span>
              <span className="tset-tp-checkitem__state">{item.done ? 'Done' : 'To do'}</span>
            </li>
          ))}
        </ul>
        <p className="tset-tp-reco-eyebrow">Recommended enhancements (optional)</p>
        <ul className="tset-tp-checklist tset-tp-checklist--reco">
          {completion.recommended.map((item) => (
            <li key={item.key} className={`tset-tp-checkitem${item.done ? ' is-done' : ''}`}>
              <Icon as={CheckCircle} size="sm" aria-hidden="true" />
              <span>{item.label}</span>
              <span className="tset-tp-checkitem__state">{item.done ? 'Done' : 'Optional'}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* School Calendar card ------------------------------------------------- */}
      <section className="tset-section">
        <h2 className="tset-section__title">School Calendar</h2>
        {calendarOk ? (
          <div className="tset-card tset-tp-cal">
            <div className="tset-tp-cal__row">
              <span className="tset-row__badge tset-row__badge--green"><Icon as={CalendarDays} size="md" /></span>
              <div className="tset-tp-cal__main">
                <p className="tset-tp-cal__name">{context.calendarName}</p>
                <p className="tset-tp-cal__meta">
                  National School Calendar · {schoolName ? `Connected school: ${schoolName}` : 'Not linked to a school'}
                </p>
                {context.isClosed ? (
                  <p className="tset-tp-cal__closed">
                    School is currently closed. Your dashboard will prepare for the next teaching week
                    {context.nextTerm ? ` — ${context.nextTerm.termName} opens ${context.nextTerm.openLabel}.` : '.'}
                  </p>
                ) : (
                  <p className="tset-tp-cal__term">
                    {context.termName} · Week {context.weekNumber} · {context.weekBeginningLabel}–{context.weekEndingLabel}
                  </p>
                )}
              </div>
            </div>
            <p className="tset-tp-cal__note">You’re using the national Ministry of Education calendar.</p>
            <div className="tset-tp-cal__actions">
              <Link to="/teacher/calendar" className="tset-btn tset-btn--ghost tset-btn--sm">View calendar</Link>
            </div>
          </div>
        ) : (
          <div className="tset-card tset-tp-cal tset-tp-cal--unavailable">
            <span className="tset-row__badge tset-row__badge--orange"><Icon as={AlertTriangle} size="md" /></span>
            <div>
              <p className="tset-tp-cal__name">School Calendar information is unavailable</p>
              <p className="tset-tp-cal__meta">
                {CALENDAR_REASON_TEXT[context.reason] || 'Select a supported academic year or review your calendar settings.'}
              </p>
              <div className="tset-tp-cal__actions">
                <Link to="/teacher/calendar" className="tset-btn tset-btn--ghost tset-btn--sm">View School Calendar</Link>
                <button type="button" className="tset-btn tset-btn--sm" onClick={reload}>
                  <Icon as={RefreshCw} size="sm" aria-hidden="true" /> Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Teaching assignments ------------------------------------------------- */}
      <section className="tset-section">
        <h2 className="tset-section__title">Your Teaching Assignments</h2>
        {assignments.length === 0 ? (
          <div className="tset-card tset-tp-empty tset-tp-empty--inline">
            <p className="tset-tp-empty__title">Add your first teaching assignment</p>
            <button type="button" className="tset-btn" onClick={() => setModal({ mode: 'add' })}>
              <Icon as={Plus} size="sm" aria-hidden="true" /> Add teaching assignment
            </button>
          </div>
        ) : (
          <>
            <ul className="tset-tp-assignments">
              {assignments.map((a) => (
                <li key={a.id} className={`tset-card tset-tp-assign${a.isActive ? '' : ' is-inactive'}`}>
                  <div className="tset-tp-assign__head">
                    <p className="tset-tp-assign__title">
                      {gradeLabel(a.grade)} — {subjectLabel(a.subject)}
                      {a.id === effectiveDefaultId && <span className="tset-tp-badge tset-tp-badge--default"><Icon as={Star} size="sm" aria-hidden="true" /> Default</span>}
                      {!a.isActive && <span className="tset-tp-badge tset-tp-badge--muted">Inactive</span>}
                    </p>
                    <p className="tset-tp-assign__meta">
                      {curriculumTypeLabel(a.curriculumType)}
                      {calendarOk && !context.isClosed ? ` · ${context.termName}` : ''}
                      {a.className ? ` · ${a.className}` : ''}
                      {a.periodsPerWeek != null ? ` · ${a.periodsPerWeek} periods/week` : ''}
                    </p>
                  </div>
                  <div className="tset-tp-assign__actions">
                    <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={() => setModal({ mode: 'edit', initial: a })} disabled={busy}>Edit</button>
                    {a.isActive && a.id !== effectiveDefaultId && (
                      <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={() => makeDefault(a.id)} disabled={busy}>Set as default</button>
                    )}
                    <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={() => toggleActive(a)} disabled={busy}>
                      {a.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm tset-btn--danger" onClick={() => setConfirmRemove(a)} disabled={busy}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" className="tset-btn" onClick={() => setModal({ mode: 'add' })} disabled={busy}>
              <Icon as={Plus} size="sm" aria-hidden="true" /> Add teaching assignment
            </button>
          </>
        )}
      </section>

      {/* Weekly teaching targets --------------------------------------------- */}
      {targets.length > 0 && (
        <section className="tset-section">
          <h2 className="tset-section__title">Weekly Teaching Targets</h2>
          <p className="tset-section__hint">
            Your targets are currently based on curriculum allocation or teacher-entered values.
          </p>
          <ul className="tset-tp-targets">
            {targets.map((t) => (
              <li key={t.id} className="tset-tp-target">
                <span className="tset-tp-target__label">{gradeLabel(t.grade)} · {subjectLabel(t.subject)}</span>
                <span className="tset-tp-target__value">
                  {t.periods != null ? `${t.periods} period${t.periods === 1 ? '' : 's'}` : 'Not set'}
                  <span className="tset-tp-target__source"> · {t.label}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="tset-tp-reco">
            <span className="tset-row__badge tset-row__badge--orange"><Icon as={Clock} size="sm" /></span>
            <div className="tset-tp-reco__body">
              <p className="tset-tp-reco__title">Improve weekly planning accuracy</p>
              <p className="tset-tp-reco__desc">
                Connect your Class Timetable so ZedExams can calculate the correct lesson targets for each subject.
              </p>
              <Link to="/teacher/generate/class-timetable" className="tset-btn tset-btn--ghost tset-btn--sm">Connect Class Timetable</Link>
            </div>
          </div>
        </section>
      )}

      {/* Connected teaching tools -------------------------------------------- */}
      <section className="tset-section">
        <h2 className="tset-section__title">Connected Teaching Tools</h2>
        <ul className="tset-tp-tools">
          <ToolRow icon={CalendarDays} label="School Calendar" status={calendarOk ? 'Connected' : 'Unavailable'} ok={calendarOk} to="/teacher/calendar" action="View calendar" />
          <ToolRow icon={Clock} label="Class Timetable" status="Not connected" ok={false} to="/teacher/generate/class-timetable" action="Connect timetable" />
          <ToolRow icon={ClipboardList} label="Curriculum" status="Connected" ok to="/settings/curriculum" action="View curriculum" />
          <ToolRow icon={BookOpen} label="Schemes of Work" status={`${activeAssignments.length} subject${activeAssignments.length === 1 ? '' : 's'}`} ok={activeAssignments.length > 0} to="/teacher/generate/scheme-of-work" action="Open Schemes" />
        </ul>
      </section>

      {/* Modals -------------------------------------------------------------- */}
      {modal && (
        <AssignmentFormModal
          open
          mode={modal.mode}
          initial={modal.initial}
          existing={assignments}
          onSubmit={submitAssignment}
          onClose={() => setModal(null)}
        />
      )}
      {wizardOpen && (
        <TeachingProfileWizard
          uid={uid}
          initialProfile={profile}
          initialAssignments={assignments}
          context={context}
          onClose={() => setWizardOpen(false)}
          onComplete={reload}
        />
      )}
      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove this teaching assignment?"
        message="It will no longer appear in your dashboard or studio selectors. Existing lesson plans, tests and other documents will not be deleted."
        confirmLabel="Remove assignment"
        cancelLabel="Keep assignment"
        loading={busy}
        onConfirm={doRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </SettingsDetailShell>
  )
}

function ToolRow({ icon, label, status, ok, to, action }) {
  return (
    <li className="tset-tp-tool">
      <span className={`tset-row__badge tset-row__badge--${ok ? 'green' : 'slate'}`}><Icon as={icon} size="sm" /></span>
      <span className="tset-tp-tool__text">
        <span className="tset-tp-tool__label">{label}</span>
        <span className={`tset-tp-tool__status${ok ? ' is-ok' : ''}`}>{status}</span>
      </span>
      <Link to={to} className="tset-tp-tool__action">{action} <Icon as={ChevronRight} size="sm" aria-hidden="true" /></Link>
    </li>
  )
}
