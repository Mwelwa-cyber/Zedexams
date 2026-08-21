/**
 * §1b — the paper cover. The screen that has to sell sitting a 90-minute exam
 * to a 12-year-old.
 *
 * Top to bottom: header · title block + illustration · notepad meta card ·
 * best-score card · mode cards · tip bar · exam settings · start.
 *
 * ── The one behavioural rule on this screen ──────────────────────────────
 *
 * "The learner chooses on the paper cover, EVERY TIME. There is no remembered
 * default — a child who practised yesterday may want the real thing today."
 * So nothing here reads a stored preference for `mode`, and nothing writes
 * one. The initial selection is Exam because the tip bar argues for trying it
 * first, not because anybody's last choice was recalled.
 *
 * `strictForward` IS remembered within the session but not across sessions,
 * for the same reason: it is a setting on THIS sitting.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  MODE_COPY, MODE_FEATURES, QUIZ_MODE, QUIZ_MODES,
} from '../lib/quizModes'
import { EXAM_ACCESS_COPY } from '../lib/examAccess'
import CoverArt from './CoverArt'
import ProgressRing from './ProgressRing'
import {
  FEATURE_ICONS, IconAward, IconBack, IconBolt, IconBookOpen, IconBookmark, IconBulb,
  IconCalendar, IconCap, IconClock, IconDoc, IconLock, IconNext, IconQuestion,
  IconRefresh, IconShield, IconTarget,
} from './QuizIcons'

/** The torn lower edge of the notepad card. */
function TornEdge() {
  return (
    <svg className="pq-tear" viewBox="0 0 300 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        d="M0 0h300v6c-10 5-20-1-30 2s-20 5-30 1-20-5-30-1-20 5-30 1-20-5-30-1-20 5-30 1-20-5-30-1-20 5-30 1-20-5-30-1z"
        fill="var(--pq-surface-2)"
        stroke="var(--pq-line)"
        strokeWidth="1"
      />
    </svg>
  )
}

function ModeCard({ mode, selected, disabled, lockCopy, durationMin, durationExact, onSelect }) {
  const copy = MODE_COPY[mode]
  const isExam = mode === QUIZ_MODE.EXAM
  const Icon = isExam ? IconClock : IconBolt
  return (
    <button
      type="button"
      className={`pq-mode ${isExam ? 'is-exam' : 'is-practice'}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(mode)}
    >
      <span className="pq-mode-top">
        <span className={`pq-mode-ico ${isExam ? 'is-exam' : 'is-practice'}`}>
          <Icon size={26} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="pq-mode-h">{copy.name}</span>
          <span className="pq-mode-p">
            {copy.tagline}
            <br />
            {isExam
              /* "About" whenever the number is not the paper's own. It is one
                 word, and it is the difference between telling a learner what
                 this paper is and guessing at it in the same voice. */
              ? <b>{durationExact ? `${durationMin} minutes on the clock.` : `About ${durationMin} minutes on the clock.`}</b>
              : copy.detail}
          </span>
        </span>
        {/* aria-hidden: the button's own aria-pressed already says whether this
            mode is chosen, and a second radio announcement is noise. */}
        <span className="pq-radio" aria-hidden="true" />
      </span>

      {/* Only the SELECTED card expands. An unselected one stays collapsed, so
          the screen is a choice between two things rather than a wall of
          sixteen bullet points. */}
      {selected && !disabled && (
        <span className="pq-mode-feats">
          {MODE_FEATURES[mode].map((f) => {
            const FeatureIcon = FEATURE_ICONS[f.icon] || IconAward
            return (
              <span className="pq-feat" key={f.icon}>
                <span className="pq-ic"><FeatureIcon size={17} /></span>
                <span>{f.label}</span>
              </span>
            )
          })}
        </span>
      )}

      {disabled && lockCopy && (
        <span className="pq-mode-locked">
          <IconLock size={18} />
          <span>
            <b>{lockCopy.title}</b>
            <span>{lockCopy.body}</span>
          </span>
        </span>
      )}
    </button>
  )
}

export default function PaperQuizCover({
  paper,
  totalQuestions,
  durationMin,
  // Whether `durationMin` is the paper's own printed time (or an admin's entry
  // of it) rather than a resolved approximation — see functions/shared/
  // paperQuiz/examSpec.js. Defaults true so a caller that knows nothing about
  // provenance is not made to hedge.
  durationExact = true,
  subjectLabel,
  history,
  examAccess,
  mode,
  onModeChange,
  strictForward,
  onStrictForwardChange,
  onStart,
  starting,
  startError,
  bookmarked,
  onToggleBookmark,
  onOpenHistory,
  onBack,
}) {
  const [fontStep, setFontStep] = useState(0)
  const FONT_STEPS = [1, 1.15, 1.3, 0.9]

  const examLocked = !examAccess.allowed
  const lockCopy = examLocked ? EXAM_ACCESS_COPY[examAccess.reason] : null

  // The paper's own facts, as the notepad's four columns.
  const facts = useMemo(() => ([
    { icon: IconBookOpen, label: 'Subject', value: subjectLabel || paper?.subject || '—' },
    { icon: IconCap, label: 'Grade', value: paper?.grade ? `Grade ${paper.grade}` : '—' },
    { icon: IconCalendar, label: 'Year', value: paper?.year ? String(paper.year) : '—' },
    { icon: IconDoc, label: 'Paper', value: paper?.sourceLabel || paper?.source || 'Past paper' },
  ]), [paper, subjectLabel])

  return (
    <div
      className="pq-cover"
      style={{ '--pq-fs': FONT_STEPS[fontStep] }}
    >
      <CoverArt />
      <div className="pq-cover-inner">
        {/* 1 · Header */}
        <div className="pq-nav">
          <button type="button" className="pq-icon-btn" onClick={onBack} aria-label="Back to the paper">
            <IconBack size={20} />
          </button>
          <span className="pq-nav-spacer" />
          <button
            type="button"
            className={`pq-icon-btn ${bookmarked ? 'is-on' : ''}`}
            aria-pressed={bookmarked}
            onClick={onToggleBookmark}
            aria-label={bookmarked ? 'Saved for offline' : 'Save for offline'}
          >
            <IconBookmark size={19} />
          </button>
          <button
            type="button"
            className="pq-icon-btn"
            onClick={() => setFontStep((s) => (s + 1) % FONT_STEPS.length)}
            aria-label="Change the text size"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 19l5-13 5 13M4.6 15h6.8" /><path d="M15 19l3-8 3 8M15.9 16.6h4.2" />
            </svg>
          </button>
        </div>

        {/* 2 · Title block */}
        <div className="pq-head">
          <p className="pq-eyebrow">Past-paper quiz</p>
          <div className="pq-eyebrow-rule" />
          <h1 className="pq-title">
            {paper?.grade ? `Grade ${paper.grade}` : ''} {subjectLabel || paper?.subject || ''}
            {paper?.sourceLabel ? <span className="pq-title-2">{paper.sourceLabel}</span> : null}
          </h1>
          <p className="pq-tagline">Test your knowledge. Build your confidence.</p>
        </div>

        {/* 3 · Notepad meta card. The paper's facts as a torn spiral-bound
            page, replacing a row of undifferentiated chips that gave a year
            the same weight as a subject. */}
        <div className="pq-notepad">
          <div className="pq-holes" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => <i key={i} />)}
          </div>
          <div className="pq-np-grid">
            {facts.map(({ icon: Icon, label, value }) => (
              <div className="pq-np-cell" key={label}>
                <span className="pq-ic"><Icon size={22} /></span>
                <span className="pq-lab">{label}</span>
                <span className="pq-val">{value}</span>
              </div>
            ))}
          </div>
          <div className="pq-np-rule" />
          <div className="pq-np-row2">
            <div className="pq-np-stat">
              <span className="pq-ic"><IconQuestion size={26} /></span>
              <span><b>{totalQuestions}</b><span>Questions</span></span>
            </div>
            <div className="pq-np-stat">
              <span className="pq-ic"><IconClock size={26} /></span>
              <span><b>{durationMin}</b><span>{durationExact ? 'Minutes' : 'Minutes (about)'}</span></span>
            </div>
          </div>
        </div>
        <TornEdge />

        {/* 4 · Best score. Hidden entirely on a first attempt — a ring at 0/60
            above the words "best score" is a discouraging thing to put in
            front of a child who has not started. */}
        {history && (
          <button type="button" className="pq-best" onClick={onOpenHistory}>
            <ProgressRing
              value={history.best.right}
              max={history.best.total}
              size={84}
              label="BEST SCORE"
              idKey="cover"
            />
            <span className="pq-best-text">
              <p>
                {`You've practised this paper `}
                <b>{history.attempts === 1 ? 'once' : history.attempts === 2 ? 'twice' : `${history.attempts} times`}</b>
                {'. Your best so far is '}
                <b>{`${history.best.right}/${history.best.total}`}</b>
                .
              </p>
              {history.weakestPart && (
                <span className="pq-weak-pill">
                  <IconTarget size={15} />
                  {`${history.weakestPart} is your weakest part.`}
                </span>
              )}
            </span>
            <span className="pq-chev"><IconNext size={20} /></span>
          </button>
        )}

        {/* 5 · Mode cards */}
        <div className="pq-divider">How do you want to do it?</div>
        {QUIZ_MODES.map((m) => (
          <ModeCard
            key={m}
            mode={m}
            selected={mode === m}
            disabled={m === QUIZ_MODE.EXAM && examLocked}
            lockCopy={m === QUIZ_MODE.EXAM ? lockCopy : null}
            durationMin={durationMin}
            durationExact={durationExact}
            onSelect={onModeChange}
          />
        ))}
        {examLocked && lockCopy?.action && (
          <p className="pq-fineprint">
            <Link to={lockCopy.actionHref} className="pq-chip">{lockCopy.action}</Link>
          </p>
        )}

        {/* 6 · Tip bar */}
        <div className="pq-tip">
          <span className="pq-ic"><IconBulb size={20} /></span>
          <p>
            <b>Tip:</b>
            {' Try Exam mode first to experience the real test. Use Practice to build confidence and improve.'}
          </p>
          <span className="pq-tip-hand" aria-hidden="true">
            Small steps. Big progress!
            <u />
          </span>
        </div>

        {/* 7 · Exam settings */}
        {mode === QUIZ_MODE.EXAM && !examLocked && (
          <>
            <p className="pq-section-label">Exam settings</p>
            <button
              type="button"
              className="pq-opt-row"
              role="switch"
              aria-checked={strictForward}
              onClick={() => onStrictForwardChange(!strictForward)}
            >
              <span className="pq-t">
                <b>Strict order</b>
                <span>Move forward only — you cannot return to a question once you leave it.</span>
              </span>
              <span className="pq-switch" aria-checked={strictForward} aria-hidden="true" />
            </button>
            {/* The reassurance panel. §1b.7 — a child about to give up ninety
                minutes needs to be told, before they start, that a refresh
                will not take it away. */}
            <div className="pq-opt-row">
              <span className="pq-ic" style={{ color: 'var(--pq-indigo)' }}><IconShield size={20} /></span>
              <span className="pq-t">
                <b>Safe from reloads</b>
                <span>
                  If your phone refreshes or the app restarts, you come straight back to your exam
                  with the time you had left.
                </span>
              </span>
            </div>
          </>
        )}

        {/* 8 · Start */}
        <div className="pq-stack" />
        <button
          type="button"
          className={`pq-cta ${mode === QUIZ_MODE.EXAM ? '' : 'is-secondary'}`}
          onClick={onStart}
          disabled={starting || (mode === QUIZ_MODE.EXAM && examLocked)}
        >
          {starting
            ? 'Getting your paper…'
            : mode === QUIZ_MODE.EXAM ? 'Start the exam' : 'Start practising'}
          {!starting && <IconNext size={18} />}
        </button>

        {startError && (
          <div className="pq-warn is-danger" style={{ marginTop: 12 }}>
            <IconRefresh size={19} />
            <p>{startError}</p>
          </div>
        )}

        <p className="pq-fineprint">
          {mode === QUIZ_MODE.EXAM
            ? 'Once you start, the clock runs until you finish or time is up. Leaving early means this attempt is not counted.'
            : 'No clock. Your place is saved as you go, and every answer is explained.'}
        </p>
      </div>
    </div>
  )
}
