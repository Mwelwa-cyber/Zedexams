/**
 * GeneratorStudioShell — the ONE layout template for the generator studios
 * (Worksheet / Rubric / Homework). Each studio keeps 100% of its own
 * generation logic, locks, drafts and exports, and hands this shell the
 * per-studio pieces as props — so a change to the shared scaffold lands on
 * every studio at once instead of being copy-pasted three times.
 *
 * The shell owns:
 *   - the `studio-page` scaffold + SeoHelmet + StudioPageHeader call
 *     (lucide `icon` band — never emoji);
 *   - the ≤2-row notice stack ORDER: studio-specific notices, then the amber
 *     DraftRecoveryPrompt strip, then the SetupForYouCard suggestion;
 *   - the `lg:grid-cols-[400px_1fr]` grid;
 *   - the form card, with the DraftStatusIndicator saved chip pinned
 *     top-right and the usage line under the Generate button;
 *   - the preview column's idle behaviour: a COMPACT empty state (icon + one
 *     line, not full column height) on desktop, and NOTHING on phones (<lg)
 *     until generating starts — the output node is only mounted once
 *     `status !== 'idle'`. Studios keep wrapping their output node in
 *     StudioOutputBoundary before passing it in.
 *
 * It also exports useStudioSetupForYou — the ONE "Set up for you" prefill
 * brain (I3): reads the teacher's Weekly Forecast via useTeacherPlanContext
 * and, when the studio opened with NO grade/subject seed, seeds the selector
 * once and derives the card's chips from the LIVE selector payload (`curr`) —
 * never from the raw suggestion — so the chips follow the teacher's edits
 * (the single-source-of-truth rule in SetupForYouCard.jsx).
 */

import { useEffect, useRef, useState } from 'react'
import StudioPageHeader from './StudioPageHeader'
import SeoHelmet from './SeoHelmet'
import SetupForYouCard from './SetupForYouCard'
import DraftStatusIndicator from './DraftStatusIndicator'
import DraftRecoveryPrompt from './DraftRecoveryPrompt'
import { useTeacherPlanContext } from '../hooks/useTeacherPlanContext'

export default function GeneratorStudioShell({
  /** Page <title> for SeoHelmet (always noIndex — teacher-only pages). */
  seoTitle = '',
  /** { eyebrow, title, description, icon, metaItems? } → StudioPageHeader. */
  header = {},
  /** Studio-specific notice nodes (CreatedFromLessonPlanNotice, assignment-change…). */
  notices = null,
  /** useStudioInputDraft return — drives the recovery strip + saved chip. */
  draft = null,
  /** Human label for the recovery strip ("worksheet" / "rubric" / "homework"). */
  draftLabel = 'draft',
  /** { chips, onChange?, onDismiss?, title? } from useStudioSetupForYou, or null. */
  setupForYou = null,
  /** Form submit handler (the studio's onGenerate). */
  onSubmit,
  /** The StudioCurriculumSelector node (studio owns key/seed/props). */
  selector = null,
  /** The studio's field nodes. */
  form = null,
  /** The GenerateButton node. */
  generateButton = null,
  /** Usage-meter line rendered under the button (string or node). */
  usageLine = null,
  /** Extra classes on the form card (e.g. "sticky top-4"). */
  formCardClassName = '',
  /** 'idle' | 'generating' | 'success' | 'error' — decides the preview column. */
  status = 'idle',
  /** { icon, tone?, title, text } for the compact desktop idle state. */
  emptyState = null,
  /** The right-pane node (StudioOutputBoundary-wrapped by the studio). */
  output = null,
}) {
  return (
    <div className="studio-page">
      {seoTitle ? <SeoHelmet title={seoTitle} noIndex /> : null}
      <div className="w-full">
        <StudioPageHeader
          eyebrow={header.eyebrow}
          title={header.title}
          subtitle={header.description}
          icon={header.icon}
          metaItems={header.metaItems}
        />

        {notices}

        {(draft || setupForYou) && (
          <div className="mb-4 space-y-3">
            {draft && <DraftRecoveryPrompt {...draft} label={draftLabel} />}
            {setupForYou && (
              <SetupForYouCard
                title={setupForYou.title}
                chips={setupForYou.chips}
                onChange={setupForYou.onChange}
                changeLabel={setupForYou.changeLabel}
                onDismiss={setupForYou.onDismiss}
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          <form
            onSubmit={onSubmit}
            className={`studio-card p-5 space-y-4 h-fit ${formCardClassName}`.trim()}
          >
            {draft && (
              <div className="flex justify-end">
                <DraftStatusIndicator
                  status={draft.status}
                  savedAt={draft.savedAt}
                  online={draft.online}
                />
              </div>
            )}
            {selector}
            {form}
            {generateButton}
            {usageLine ? (
              <div className="text-xs theme-text-secondary text-center">{usageLine}</div>
            ) : null}
          </form>

          {/* Preview column: nothing on phones while idle (the form is the
              whole screen until generating starts); a compact one-line empty
              state on desktop; the studio's real output node otherwise. */}
          {status === 'idle' ? (
            <StudioIdleEmptyState {...(emptyState || {})} />
          ) : (
            output
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Compact desktop-only idle state for the preview column: a small icon disc +
 * one line, deliberately NOT full column height (that's what the old
 * StudioEmptyState medallion did). Hidden entirely below lg — on a phone the
 * preview column simply doesn't exist until generating starts.
 */
export function StudioIdleEmptyState({
  icon: IconComponent = null,
  tone = '#f0eee8',
  title = '',
  text = '',
}) {
  return (
    <div
      className="hidden lg:flex studio-card p-5 h-fit items-center gap-4"
      data-testid="studio-idle-empty"
    >
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
        style={{ background: tone, color: 'var(--zt-text)' }}
        aria-hidden="true"
      >
        {IconComponent && <IconComponent size={22} strokeWidth={2} />}
      </div>
      <div className="min-w-0">
        <h3 className="studio-display" style={{ fontSize: 17, margin: 0 }}>{title}</h3>
        {text && (
          <p className="text-sm m-0" style={{ color: 'var(--zt-text-muted)' }}>{text}</p>
        )}
      </div>
    </div>
  )
}

/**
 * useStudioSetupForYou — the I3 "Set up for you" prefill, shared by the three
 * generator studios.
 *
 * When the studio opened with NO grade/subject/topic seed (a URL deep-link,
 * active-assignment or profile seed that populated the fields suppresses the
 * card — those flows have their own notices) and the teacher's latest Weekly
 * Forecast yields a suggestion, this seeds the selector ONCE (via `applySeed`,
 * which re-seeds + remounts it) and returns the SetupForYouCard props.
 *
 * SINGLE SOURCE OF TRUTH: the chips derive from the LIVE `curr` payload — what
 * the selector actually holds — so when the teacher changes grade/subject the
 * chips follow automatically. Only the Week number comes from the suggestion
 * (the selector has no notion of weeks).
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.uid
 * @param {object|null} opts.initialSeed  the resolveStudioSeed() result the studio mounted with
 * @param {object} opts.curr              the live StudioCurriculumSelector payload
 * @param {(seed: object) => void} opts.applySeed  re-seed + remount the selector
 * @param {{current: HTMLElement|null}} [opts.selectorAnchorRef]  scroll target for "Change"
 * @returns {null | { chips: Array, onChange: Function, onDismiss: Function }}
 */
export function useStudioSetupForYou({
  uid,
  initialSeed,
  curr,
  applySeed,
  selectorAnchorRef = null,
}) {
  // "Empty" means the studio opened with no curriculum identity at all —
  // any grade/subject/topic in the seed means some flow already set it up.
  const seedWasEmpty = !initialSeed || (
    !initialSeed.grade && !initialSeed.subject && !initialSeed.topic &&
    !initialSeed.gradeLabel && !initialSeed.subjectKey
  )
  // Only fetch the forecast when it could actually be used.
  const { suggestion } = useTeacherPlanContext(seedWasEmpty ? uid : null)

  const [applied, setApplied] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const appliedRef = useRef(false)
  // Refs so the apply effect reads the LATEST live state without re-running
  // (re-running on every curr change would re-seed over the teacher's edits).
  const currRef = useRef(curr)
  currRef.current = curr
  const applySeedRef = useRef(applySeed)
  applySeedRef.current = applySeed

  useEffect(() => {
    if (!seedWasEmpty || appliedRef.current || !suggestion) return
    if (!suggestion.grade && !suggestion.subject) return
    // The suggestion resolves asynchronously — if the teacher has already
    // started picking by hand, never clobber their choice.
    const live = currRef.current || {}
    if (live.grade || live.subject) return
    appliedRef.current = true
    applySeedRef.current?.({
      curriculumMode: 'cbc',
      curriculum: 'cbc',
      grade: suggestion.grade,
      subject: suggestion.subject,
      topic: suggestion.topic || '',
      subtopic: suggestion.subtopic || '',
    })
    setApplied(true)
  }, [suggestion, seedWasEmpty])

  if (!applied || dismissed) return null

  const live = curr || {}
  const chips = [
    suggestion?.weekNumber != null
      ? { label: `Week ${suggestion.weekNumber}`, variant: 'blue' }
      : null,
    live.gradeLabel ? { label: live.gradeLabel } : null,
    live.subjectLabel ? { label: live.subjectLabel } : null,
    live.curriculumMode === 'cbc'
      ? { label: '✓ CBC curriculum', variant: 'green' }
      : null,
  ].filter(Boolean)

  return {
    chips,
    onChange: () => {
      try {
        selectorAnchorRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch { /* scrollIntoView unavailable (jsdom / old WebView) — non-fatal */ }
    },
    onDismiss: () => setDismissed(true),
  }
}
