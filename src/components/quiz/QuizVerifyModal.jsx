import { useEffect, useMemo, useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../firebase/config'
import { serializeQuizSections } from '../../utils/quizSections.js'
import { extractRichTextPlain } from '../../utils/quizRichText.js'

const functions = getFunctions(app, 'us-central1')
const verifyQuizCallable = httpsCallable(functions, 'verifyQuiz', {
  timeout: 90_000,
})

const SCORE_ROWS = [
  { key: 'answerAccuracy', label: 'Answer Accuracy' },
  { key: 'gradeMatch',     label: 'Grade Match' },
  { key: 'clarity',        label: 'Clarity' },
  { key: 'grammar',        label: 'Grammar' },
  { key: 'optionsQuality', label: 'Options Quality' },
  { key: 'cbcAlignment',   label: 'CBC Alignment' },
]

// Vex needs both the questions AND the passage/map context that surrounds
// them. Without the passages, an MCQ like "Name the National Park marked A"
// looks unanswerable to the verifier and every map-based question gets
// flagged as a blocker. Pass passage metadata (instructions, kind,
// imageUrl) and link each question via passageId so the runner can attach
// the correct image to its multimodal call.
function buildVerifyPayload(sections, parts) {
  const { questions, passages } = serializeQuizSections(sections, parts)
  const passagesPayload = passages.map(p => ({
    id: p.id,
    title: (p.title || '').slice(0, 200),
    passageKind: p.passageKind || 'comprehension',
    instructions: extractRichTextPlain(p.instructions).slice(0, 1500),
    passageText: extractRichTextPlain(p.passageText).slice(0, 4000),
    imageUrl: p.imageUrl || null,
  }))
  const questionsPayload = questions.map(q => ({
    type: q.type || 'mcq',
    text: extractRichTextPlain(q.text).slice(0, 1200),
    options: Array.isArray(q.options)
      ? q.options.map(o => extractRichTextPlain(o).slice(0, 400))
      : [],
    correctAnswer: q.correctAnswer,
    marks: q.marks ?? 1,
    expectedAnswer: q.expectedAnswer
      ? extractRichTextPlain(q.expectedAnswer).slice(0, 400)
      : undefined,
    passageId: q.passageId || null,
    imageUrl: q.imageUrl || null,
  }))
  return { questions: questionsPayload, passages: passagesPayload }
}

function scoreColor(score) {
  if (score >= 90) return 'bg-emerald-500'
  if (score >= 75) return 'bg-amber-500'
  return 'bg-rose-500'
}

function scoreText(score) {
  if (score >= 90) return 'text-emerald-700'
  if (score >= 75) return 'text-amber-700'
  return 'text-rose-700'
}

function severityBadge(severity) {
  return severity === 'blocker'
    ? 'bg-rose-100 text-rose-800 border-rose-300'
    : 'bg-amber-100 text-amber-800 border-amber-300'
}

function ScoreBar({ score }) {
  const pct = Math.max(0, Math.min(100, Number(score) || 0))
  return (
    <div className="flex items-center gap-3">
      <div className="theme-bg-subtle h-2 flex-1 overflow-hidden rounded-full">
        <div
          className={`h-full ${scoreColor(pct)} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-12 text-right font-black tabular-nums ${scoreText(pct)}`}>
        {pct}%
      </span>
    </div>
  )
}

function IssueRow({ issue }) {
  return (
    <li className={`rounded-xl border-2 p-3 text-sm ${severityBadge(issue.severity)}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded-full border bg-white/70 px-2 py-0.5 text-xs font-black uppercase">
          {issue.severity}
        </span>
        <span className="rounded-full border bg-white/70 px-2 py-0.5 text-xs font-bold">
          Q{Number(issue.questionIndex || 0) + 1}
        </span>
        <span className="rounded-full border bg-white/70 px-2 py-0.5 text-xs font-bold">
          {issue.category}
        </span>
      </div>
      <p className="mt-2 break-words font-semibold leading-snug">{issue.message}</p>
      {issue.suggestion ? (
        <p className="mt-1 break-words text-xs italic opacity-90">Fix: {issue.suggestion}</p>
      ) : null}
    </li>
  )
}

export default function QuizVerifyModal({
  open,
  quizId,
  form,
  sections,
  parts,
  onClose,
  onPublish,
  onFixIssues,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [warningsExpanded, setWarningsExpanded] = useState(false)

  const payload = useMemo(() => {
    if (!open) return null
    try {
      const { questions, passages } = buildVerifyPayload(sections || [], parts || [])
      return {
        quizId: quizId || '',
        questions,
        passages,
        meta: {
          grade: form?.grade || '',
          subject: form?.subject || '',
          topic: form?.topic || '',
          subtopic: form?.subtopic || '',
          difficulty: form?.difficulty || '',
        },
      }
    } catch (err) {
      setError(err?.message || 'Failed to prepare quiz for verification.')
      return null
    }
  }, [open, quizId, form, sections, parts])

  useEffect(() => {
    if (!open) {
      setResult(null)
      setError('')
      setLoading(false)
      setWarningsExpanded(false)
      return
    }
    if (!payload) return
    let cancelled = false
    setLoading(true)
    setError('')
    setResult(null)
    verifyQuizCallable(payload)
      .then(res => { if (!cancelled) setResult(res?.data || null) })
      .catch(err => {
        if (cancelled) return
        const code = err?.code || ''
        const msg = err?.message || 'Verification failed.'
        setError(code ? `${msg} (${code})` : msg)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, payload])

  if (!open) return null

  const blockers = Array.isArray(result?.blockers) ? result.blockers : []
  const warnings = Array.isArray(result?.warnings) ? result.warnings : []
  const overall = Number(result?.overallScore) || 0
  const verdict = result?.verdict || ''
  const lowQuality = !!result && !result.aiUnreadable && overall > 0 && overall < 80
  const cleanPass = !!result && !blockers.length && !warnings.length &&
    !result.aiUnreadable && !lowQuality && verdict === 'pass'
  // Vex is an aide, not a gate. We've seen it flag questions whose keyed
  // answers are demonstrably correct, so we never lock the publish button
  // on its verdict — only on the loading state. The blocker list is still
  // shown for the teacher to consider before clicking through.
  const canPublish = !loading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="theme-card theme-border w-full max-w-2xl overflow-hidden rounded-3xl border-2 shadow-elev-md">
        <div className="theme-accent-fill theme-on-accent flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-black uppercase tracking-wide">
              Vex
            </span>
            <h2 className="truncate text-base font-black sm:text-lg">Quiz Quality Check</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-bold hover:bg-white/30"
          >
            Close
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4 sm:space-y-5 sm:px-5 sm:py-5">
          {loading && (
            <div className="theme-text flex flex-col items-center gap-3 py-10">
              <div className="theme-accent-fill h-3 w-3 animate-ping rounded-full" />
              <p className="font-semibold">Vex is reviewing your quiz…</p>
              <p className="theme-text-muted text-xs">Checking answers, grade fit, clarity, grammar, options, and CBC alignment.</p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 text-rose-800">
              <p className="font-black">Could not run the AI check.</p>
              <p className="mt-1 text-sm">{error}</p>
              <p className="mt-2 text-xs italic">
                You can still publish if you trust the quiz — Vex is an aide, not a gate.
              </p>
            </div>
          )}

          {!loading && result && (
            <>
              <div className="theme-bg-subtle theme-border flex flex-col items-stretch gap-3 rounded-2xl border-2 p-4 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex shrink-0 flex-row items-baseline justify-center gap-2 sm:flex-col sm:items-center sm:gap-0">
                  <span className={`text-4xl font-black tabular-nums ${scoreText(overall)}`}>
                    {overall}%
                  </span>
                  <span className="theme-text-muted text-xs font-bold uppercase">
                    Quality Score
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="theme-text break-words font-semibold leading-snug">
                    {result.summary || 'No summary returned.'}
                  </p>
                  {result.modelUsed ? (
                    <p className="theme-text-muted mt-1 break-words text-xs">
                      Model: {result.modelUsed}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="theme-border space-y-3 rounded-2xl border-2 p-4">
                <h3 className="theme-text font-black">Category breakdown</h3>
                <ul className="space-y-2">
                  {SCORE_ROWS.map(row => (
                    <li key={row.key} className="grid grid-cols-[7rem_1fr] items-center gap-2 sm:grid-cols-[10rem_1fr] sm:gap-3">
                      <span className="theme-text truncate text-sm font-semibold">{row.label}</span>
                      <ScoreBar score={result.scores?.[row.key] ?? 0} />
                    </li>
                  ))}
                </ul>
              </div>

              {blockers.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-black text-rose-700">
                    Blockers ({blockers.length}) — must fix before publishing
                  </h3>
                  <ul className="space-y-2">
                    {blockers.map((b, i) => (
                      <IssueRow key={`b-${i}`} issue={b} />
                    ))}
                  </ul>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setWarningsExpanded(v => !v)}
                    className="flex w-full items-center justify-between rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-2 text-amber-900"
                  >
                    <span className="font-black">
                      Warnings ({warnings.length}) — publishing still allowed
                    </span>
                    <span className="text-xs font-bold">
                      {warningsExpanded ? 'Hide' : 'Show'}
                    </span>
                  </button>
                  {warningsExpanded && (
                    <ul className="space-y-2">
                      {warnings.map((w, i) => (
                        <IssueRow key={`w-${i}`} issue={w} />
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {!blockers.length && !warnings.length && result.aiUnreadable && (
                <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-amber-800">
                  <p className="font-black">AI response was unreadable.</p>
                  <p className="mt-1 text-sm">
                    Vex couldn&apos;t parse a verdict — only structural checks
                    ran. Review the quiz manually before publishing.
                  </p>
                </div>
              )}

              {!blockers.length && !warnings.length && !result.aiUnreadable && lowQuality && (
                <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-amber-800">
                  <p className="font-black">Quality score is below 80%.</p>
                  <p className="mt-1 text-sm">
                    Vex didn&apos;t flag specific issues, but the overall
                    quality score ({overall}%) is mediocre. Review the
                    category bars above and re-read each question before
                    publishing.
                  </p>
                </div>
              )}

              {cleanPass && (
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                  <p className="font-black">No issues detected.</p>
                  <p className="mt-1 text-sm">This quiz looks ready to publish.</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="theme-border flex flex-wrap items-center justify-end gap-2 border-t-2 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="theme-card theme-border theme-text rounded-xl border-2 px-3 py-2 text-sm font-black hover:border-[var(--accent)] sm:px-4 sm:text-base"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onFixIssues}
            disabled={loading}
            className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-black text-amber-800 hover:bg-amber-100 disabled:opacity-40 sm:px-4 sm:text-base"
          >
            Fix Issues
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={!canPublish}
            title={blockers.length
              ? 'Vex flagged blockers. Review them, but you can still publish.'
              : ''}
            className="theme-accent-fill theme-on-accent rounded-xl px-3 py-2 text-sm font-black shadow-elev-sm disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:text-base"
          >
            {loading ? 'Verifying…' : 'Publish anyway'}
          </button>
        </div>
      </div>
    </div>
  )
}
