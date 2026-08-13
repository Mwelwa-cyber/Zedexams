import { useEffect, useMemo, useRef, useState } from 'react'
import { renderPlanHtml } from '../../../components/teacher/studio/utils/renderPlanHtml'
import { buildMetaRevealSteps, buildBodyRevealSteps } from '../lib/lessonRevealSteps'

/**
 * LiveLessonPlanPreview — the "writing itself" preview for the Lesson Plan
 * Studio. Instead of a spinner or a bare "Preparing lesson plan…" card, it
 * renders the REAL lesson-plan document (via renderPlanHtml + /studio/lesson.css)
 * and builds it up in front of the teacher:
 *
 *   1. Generating (planJson == null): the school name, teacher, class, subject,
 *      topic, sub-topic, date and duration type into the document header one by
 *      one (all from the form the teacher already filled in — honest, not
 *      invented), with the empty progression table already laid out beneath.
 *   2. Revealing (planJson arrives): each section of the body appears in order —
 *      general competences → specific competence → goal → rationale → prior
 *      knowledge → materials → then the progression table fills stage by stage
 *      (introduction, development, learner tasks, assessment, conclusion).
 *   3. Complete: onComplete() fires and the parent swaps in the static preview
 *      with the Edit / Save / Download / Print toolbar.
 *
 * Every frame is a subset of the real result the model returned; the last frame
 * is the plan verbatim. Respects prefers-reduced-motion by jumping to the end.
 *
 * Props:
 *   meta            — render meta (school, teacherName, grade, subject, …) from the form
 *   curriculumMode  — 'cbc' | 'previous'
 *   planJson        — null while generating; the parsed plan once it lands
 *   onComplete      — called once, after the final section is revealed
 *   onStop          — optional; shows a Stop control while generating
 */
export default function LiveLessonPlanPreview({
  meta = {},
  curriculumMode = 'cbc',
  planJson = null,
  onComplete,
  onStop,
  // Overridable for tests / reduced-motion tuning.
  headerStepMs = 320,
  bodyStepMs = 620,
}) {
  const reduced = usePrefersReducedMotion()
  const scrollerRef = useRef(null)
  const docEndRef = useRef(null)

  // Header fill-in snapshots (used while generating and as the stable header
  // once the body reveals).
  const metaSteps = useMemo(() => buildMetaRevealSteps(meta), [meta])
  const fullMeta = metaSteps[metaSteps.length - 1] || meta

  // Body reveal steps — only once the plan lands.
  const bodySteps = useMemo(
    () => (planJson ? buildBodyRevealSteps(planJson, curriculumMode) : null),
    [planJson, curriculumMode],
  )

  const generating = !planJson

  // ── Header fill-in timer (generating phase) ────────────────────────────────
  const [headerIdx, setHeaderIdx] = useState(0)
  useEffect(() => {
    if (!generating) return undefined
    setHeaderIdx(0)
    if (reduced || metaSteps.length <= 1) {
      setHeaderIdx(metaSteps.length - 1)
      return undefined
    }
    const id = setInterval(() => {
      setHeaderIdx((i) => {
        if (i >= metaSteps.length - 1) {
          clearInterval(id)
          return i
        }
        return i + 1
      })
    }, headerStepMs)
    return () => clearInterval(id)
  }, [generating, reduced, metaSteps.length, headerStepMs])

  // ── Body reveal timer (revealing phase) ────────────────────────────────────
  const [bodyIdx, setBodyIdx] = useState(0)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete })

  useEffect(() => {
    if (!bodySteps || bodySteps.length === 0) return undefined
    completedRef.current = false
    if (reduced) {
      setBodyIdx(bodySteps.length - 1)
      return undefined
    }
    setBodyIdx(0)
    const id = setInterval(() => {
      setBodyIdx((i) => {
        if (i >= bodySteps.length - 1) {
          clearInterval(id)
          return i
        }
        return i + 1
      })
    }, bodyStepMs)
    return () => clearInterval(id)
  }, [bodySteps, reduced, bodyStepMs])

  // Hand off once the final frame is on screen: a short beat after the last
  // section reveals, call onComplete exactly once. Kept separate from the tick
  // timer so completion is driven purely by "we reached the last step".
  useEffect(() => {
    if (!bodySteps || completedRef.current) return undefined
    if (bodyIdx < bodySteps.length - 1) return undefined
    const t = setTimeout(() => {
      if (completedRef.current) return
      completedRef.current = true
      if (typeof onCompleteRef.current === 'function') onCompleteRef.current()
    }, reduced ? 30 : 450)
    return () => clearTimeout(t)
  }, [bodyIdx, bodySteps, reduced])

  // ── Compute the HTML for the current frame ─────────────────────────────────
  const { html, statusLabel } = useMemo(() => {
    if (generating) {
      const stepMeta = metaSteps[Math.min(headerIdx, metaSteps.length - 1)] || meta
      return {
        html: renderPlanHtml({}, stepMeta, curriculumMode),
        statusLabel: 'Writing your lesson plan',
      }
    }
    const step = bodySteps[Math.min(bodyIdx, bodySteps.length - 1)]
    return {
      html: renderPlanHtml(step.plan, fullMeta, curriculumMode),
      statusLabel: step.label,
    }
  }, [generating, metaSteps, headerIdx, bodySteps, bodyIdx, fullMeta, meta, curriculumMode])

  const isFinalFrame = !generating && bodyIdx >= (bodySteps?.length || 1) - 1
  const total = generating ? metaSteps.length : bodySteps.length
  const current = generating ? headerIdx + 1 : bodyIdx + 1
  const pct = Math.max(6, Math.round((current / Math.max(total, 1)) * 100))

  // Keep the newest content in view as the document grows (contained scroll on
  // desktop; on mobile the page scroll owns it, so this is a gentle nudge).
  useEffect(() => {
    const el = docEndRef.current
    const scroller = scrollerRef.current
    if (!el || !scroller) return
    // Only auto-follow while actively revealing, never on the final frame.
    if (isFinalFrame) return
    try {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
    } catch {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [html, isFinalFrame, reduced])

  return (
    <div className="lp-live w-full" data-testid="live-lesson-preview" data-phase={generating ? 'generating' : 'revealing'}>
      {/* Live status header */}
      <div className="lp-live-bar">
        <div className="lp-live-status">
          <span className="lp-live-dot" aria-hidden="true" />
          <span className="lp-live-label">
            {statusLabel}
            {!isFinalFrame && <span className="lp-live-ellipsis" aria-hidden="true" />}
          </span>
        </div>
        {typeof onStop === 'function' && generating && (
          <button type="button" onClick={onStop} className="lp-live-stop">
            Stop
          </button>
        )}
      </div>
      <div className="lp-live-track" aria-hidden="true">
        <div className="lp-live-fill" style={{ width: `${pct}%` }} />
      </div>

      {/* The document, building itself */}
      <div ref={scrollerRef} className="lp-live-scroller">
        <div className="doc-wrap lp-live-doc-wrap mx-auto w-full max-w-[794px]">
          {/* Safe: renderPlanHtml() output is HTML-escaped, never raw user input. */}
          <div className={`doc lp-live-doc${isFinalFrame ? '' : ' lp-live-writing'}`}>
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {!isFinalFrame && <span className="lp-live-caret" aria-hidden="true" />}
            <span ref={docEndRef} />
          </div>
        </div>
      </div>

      <p className="lp-live-foot" role="status" aria-live="polite">
        {generating
          ? 'Building your lesson plan live — the full document is being written…'
          : 'Revealing your lesson plan section by section…'}
      </p>
    </div>
  )
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    onChange()
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])
  return reduced
}
