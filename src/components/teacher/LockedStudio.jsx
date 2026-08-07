/**
 * LockedStudio — what a Free-plan teacher sees in place of a closed studio.
 *
 * Free opens the studios with a free-preview allowance (PLAN_LIMITS.free[tool]
 * > 0: lesson plans, worksheets, homework, short tests, scheme previews);
 * every zero-allowance studio routes through <StudioGate>, which renders this for Free
 * teachers (Pro/Max get the real studio). It shows the studio header, a clear
 * "upgrade to unlock" banner, and a read-only SAMPLE of what the studio
 * produces — rendered with the studio's own View component so the preview
 * matches a real generation. The sample is non-interactive (pointer-events
 * off, aria-hidden) and carries a corner "SAMPLE" ribbon; the only actions are
 * the upgrade CTAs, which open the standard Pro/Max paywall.
 */

import { useEffect } from 'react'
import SeoHelmet from '../seo/SeoHelmet'
import StudioPageHeader from './StudioPageHeader'
import { paywall } from '../../utils/paywall'
import { getStudioSample } from '../../data/studioSamples'

import { WorksheetView } from '../../features/worksheet'
import { FlashcardsView } from '../../features/flashcards'
import SchemeOfWorkView from './views/SchemeOfWorkView'
import WeeklyForecastView from './views/WeeklyForecastView'
import RecordOfWorkView from './views/RecordOfWorkView'
import MarkScheduleView from './views/MarkScheduleView'
import NotesView from './views/NotesView'
import { RubricView } from '../../features/rubric'
import SbaTaskView from './views/SbaTaskView'
import SbaTrackerView from './views/SbaTrackerView'
import SbaPlanView from './views/SbaPlanView'
import ClassTimetableView from './views/ClassTimetableView'
import TestPaperOfficial from '../marketing/TestPaperOfficial'

/** Render the sample artifact with the studio's own read-only view. */
function SampleArtifact({ render, artifact }) {
  if (!artifact) return null
  switch (render) {
    case 'worksheet':       return <WorksheetView worksheet={artifact} showAnswers={false} />
    case 'flashcards':      return <FlashcardsView flashcards={artifact} />
    case 'scheme_of_work':  return <SchemeOfWorkView scheme={artifact} />
    case 'weekly_forecast': return <WeeklyForecastView forecast={artifact} />
    case 'record_of_work':  return <RecordOfWorkView record={artifact} />
    case 'mark_schedule':   return <MarkScheduleView schedule={artifact} mode="marks" />
    case 'notes':           return <NotesView notes={artifact} />
    case 'rubric':          return <RubricView rubric={artifact} />
    case 'homework':        return <HomeworkSample hw={artifact} />
    case 'sba_task':        return <SbaTaskView task={artifact} showAnswers />
    case 'sba_tracker':     return <SbaTrackerView sheet={artifact} />
    case 'sba_planner':     return <SbaPlanView plan={artifact} />
    case 'class_timetable': return <ClassTimetableView timetable={artifact} />
    case 'test_paper':      return <TestPaperOfficial paper={artifact.midterm || artifact} />
    default:                return null
  }
}

// Homework has no shared View (its renderer is private to HomeworkStudio), so
// the sample is drawn here from the same shape the studio produces.
function HomeworkSample({ hw }) {
  const h = hw.header || {}
  return (
    <article className="space-y-4">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          <div><span className="font-bold">Topic: </span>{h.topic}</div>
          {h.subtopic && <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>}
        </div>
        {hw.instructions && <p className="mt-3 text-sm italic theme-text-secondary">{hw.instructions}</p>}
      </div>
      <ol className="list-decimal pl-5 space-y-3 text-sm theme-text">
        {(hw.questions || []).map((q) => (
          <li key={q.number}>
            <p>{q.prompt}</p>
            <div className="mt-1 pt-1 border-t theme-border">
              <p className="text-emerald-700"><span className="font-bold">Answer: </span>{q.answer}</p>
              {q.workingNotes && <p className="text-xs theme-text-secondary italic mt-0.5">{q.workingNotes}</p>}
            </div>
          </li>
        ))}
      </ol>
      {hw.parentNote && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h4 className="font-bold text-sm text-sky-900 mb-1">Note for parent / guardian</h4>
          <p className="text-sm text-sky-800">{hw.parentNote}</p>
        </div>
      )}
      {hw.answerKey?.markingNotes && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-bold text-sm text-emerald-900 mb-1">Marking guidance</h4>
          <p className="text-sm text-emerald-800">{hw.answerKey.markingNotes}</p>
        </div>
      )}
    </article>
  )
}

export default function LockedStudio({ tool }) {
  const sample = getStudioSample(tool)

  // Unknown tool — fall back to a bare upsell rather than crash.
  const eyebrow = sample?.eyebrow || 'Teacher Studio'
  const title = sample?.title || 'A Pro & Max studio'
  const subtitle = sample?.subtitle || 'Upgrade to unlock this studio.'
  const emoji = sample?.emoji || '🔒'
  const feature = sample?.feature || 'This studio'

  function upgrade() {
    paywall.show('feature-locked', { feature, tool })
  }

  // A Free teacher only ever reaches this component by pressing a studio that's
  // reserved for Pro/Max (StudioGate routes them here). Surface the paywall
  // message immediately on arrival so it's unmissable that this studio needs a
  // paid plan — rather than relying on them noticing the sample/CTA. Fires once
  // per mount, so navigating to a different locked studio re-shows it. The
  // sample stays rendered behind the modal as context.
  useEffect(() => {
    paywall.show('feature-locked', { feature, tool })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  return (
    <div className="studio-page">
      <SeoHelmet title={`${eyebrow} — Sample`} noIndex />
      <div className="w-full px-3 sm:px-4">
        <StudioPageHeader
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          emoji={emoji}
          rightSlot={
            <button
              type="button"
              onClick={upgrade}
              className="rounded-xl px-4 py-2 text-sm font-bold"
              style={{ background: '#d97757', color: '#fff' }}
            >
              🔓 Unlock
            </button>
          }
        />

        {/* Upgrade banner */}
        <div
          className="rounded-2xl p-5 mb-6"
          style={{ background: 'linear-gradient(135deg,#0e2a32 0%,#143a44 100%)', color: '#fff', boxShadow: '0 10px 30px rgba(14,42,50,.25)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-full" style={{ background: '#d97757', color: '#fff' }}>
              🔒 Pro &amp; Max
            </span>
            <span className="text-xs" style={{ color: '#a9c4c9' }}>Free plan · sample only</span>
          </div>
          <h3 className="font-display font-black" style={{ fontSize: 20, margin: '0 0 4px' }}>
            This is a sample of what the {eyebrow.replace(/ Studio$/i, '').toLowerCase()} makes.
          </h3>
          <p className="text-sm" style={{ color: '#cfe0e3', margin: 0, maxWidth: 580 }}>
            On the <strong>Free</strong> plan you can create <strong>lesson plans</strong>. To generate your
            own {feature.toLowerCase()} — edited, exported and saved to your library — upgrade to{' '}
            <strong>Pro</strong> or <strong>Max</strong>.
          </p>
          <button
            type="button"
            onClick={upgrade}
            className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
            style={{ background: '#d97757', color: '#fff' }}
          >
            See plans &amp; unlock →
          </button>
        </div>

        {/* Read-only sample */}
        <section className="studio-card p-5 relative overflow-hidden">
          {/* corner ribbon */}
          <div
            aria-hidden="true"
            className="absolute z-10 text-[11px] font-black uppercase tracking-wider"
            style={{
              top: 18, right: -34, transform: 'rotate(45deg)', width: 150, textAlign: 'center',
              background: '#d97757', color: '#fff', padding: '4px 0', boxShadow: '0 2px 8px rgba(0,0,0,.2)',
            }}
          >
            Sample
          </div>

          <div className="mb-4">
            <h2 className="studio-display" style={{ fontSize: 20, margin: '0 0 2px' }}>
              Example output
            </h2>
            <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
              A real generation looks like this. Yours would use your own grade, subject and topic.
            </p>
          </div>

          {/* The sample itself is inert: no clicks, no selection, hidden from AT. */}
          <div className="select-none pointer-events-none" aria-hidden="true">
            <SampleArtifact render={sample?.render} artifact={sample?.artifact} />
          </div>
        </section>

        <div className="text-center mt-6">
          <button
            type="button"
            onClick={upgrade}
            className="rounded-xl px-6 py-3 text-sm font-bold"
            style={{ background: '#0e2a32', color: '#fff' }}
          >
            Unlock {feature.toLowerCase()} with Pro or Max →
          </button>
        </div>
      </div>
    </div>
  )
}
