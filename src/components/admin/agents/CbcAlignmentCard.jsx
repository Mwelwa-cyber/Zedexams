/**
 * Presentational renderers for Cala's output on the agent job detail page.
 *
 * `job.output.cala` carries TWO different shapes, depending on which Cala
 * wrote it:
 *
 *   1. Content-line run (functions/agents/runners/cala.js, per draft):
 *        { aligned: boolean, citations[], gaps[], drift[], kbVersion, kbWarning }
 *      → CbcAlignmentCard.
 *
 *   2. Weekly audit rollup (functions/agents/cron.js weeklyCbcAlignmentAudit):
 *        { sampleSize, audited, aligned: number, drifted, errored, skipped,
 *          findings[] }
 *      → CbcAuditSummaryCard.
 *
 * Feeding shape #2 to CbcAlignmentCard renders a misleading green
 * "aligned" card (because the numeric `aligned` count is truthy) with no
 * detail, leaving the real findings buried in the raw-JSON toggle — the
 * bug this module fixes. `CalaOutput` sniffs the shape and routes to the
 * right renderer.
 *
 * Deliberately free of Firebase / auth imports so it can be unit-tested
 * with @testing-library without mocking the SDK.
 */

// The audit rollup is the only shape with a `findings` array / a
// `sampleSize`; the per-draft shape has neither and uses a boolean
// `aligned`. Either signal is sufficient and unambiguous.
export function isAuditSummary(alignment) {
  return Boolean(
    alignment &&
      typeof alignment === 'object' &&
      (Array.isArray(alignment.findings) ||
        typeof alignment.sampleSize === 'number'),
  )
}

const toolLabel = (t) => (t ? String(t).replace(/_/g, ' ') : 'unknown tool')

// Structured renderer for a content-line Cala run. (Moved verbatim out of
// AgentJobDetail.jsx so both renderers live together.)
export function CbcAlignmentCard({ alignment }) {
  if (!alignment || typeof alignment !== 'object') return null
  const {
    aligned, citations = [], gaps = [], drift = [], kbVersion, kbWarning,
  } = alignment

  const citationCount = Array.isArray(citations) ? citations.length : 0
  const gapCount = Array.isArray(gaps) ? gaps.length : 0
  const driftCount = Array.isArray(drift) ? drift.length : 0

  const headerCls = aligned
    ? 'border-emerald-200 bg-emerald-50'
    : 'border-amber-200 bg-amber-50'
  const headerText = aligned ? 'text-emerald-800' : 'text-amber-800'

  return (
    <section className={`rounded-2xl border ${headerCls} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-black ${headerText}`}>
            CBC alignment — {aligned ? 'aligned' : 'review needed'}
          </p>
          <p className={`text-xs mt-0.5 ${headerText} opacity-80`}>
            {citationCount} citation{citationCount === 1 ? '' : 's'} ·{' '}
            {gapCount} gap{gapCount === 1 ? '' : 's'} ·{' '}
            {driftCount} drift item{driftCount === 1 ? '' : 's'}
            {kbVersion ? <> · KB <code className="font-mono">{kbVersion}</code></> : null}
          </p>
        </div>
      </div>

      {kbWarning && (
        <p className="rounded-lg bg-white/60 px-3 py-2 text-xs text-amber-900">
          <span className="font-black">KB warning:</span> {kbWarning}
        </p>
      )}

      {citationCount > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-emerald-900 mb-1.5">
            Citations
          </h4>
          <ul className="space-y-1.5">
            {citations.map((c, i) => (
              <li key={`${c.outcome || 'c'}-${i}`} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                <div className="font-mono text-[11px] text-emerald-800 font-black">
                  {c.outcome || '—'}
                </div>
                {c.text && <div className="theme-text mt-0.5">{c.text}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {gapCount > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-amber-900 mb-1.5">
            Gaps
          </h4>
          <ul className="space-y-1.5">
            {gaps.map((g, i) => (
              <li key={`g-${i}`} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                {g.outcome && (
                  <div className="font-mono text-[11px] text-amber-800 font-black">
                    {g.outcome}
                  </div>
                )}
                {g.text && <div className="theme-text mt-0.5">{g.text}</div>}
                {g.note && <div className="theme-text-muted mt-0.5 italic">{g.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {driftCount > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-red-900 mb-1.5">
            Drift
          </h4>
          <ul className="space-y-1.5">
            {drift.map((d, i) => (
              <li key={`d-${i}`} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                <div className="font-mono text-[11px] text-red-800 font-black">
                  {d.outcome || '—'}
                </div>
                {d.note && <div className="theme-text-muted mt-0.5 italic">{d.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function AuditStat({ label, value, accent }) {
  return (
    <div className="rounded-xl border theme-border bg-white/60 px-3 py-2 text-center">
      <p className="text-[10px] font-black uppercase tracking-wider theme-text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-black ${accent || 'theme-text'}`}>{value}</p>
    </div>
  )
}

// One sampled generation that Cala flagged. Renders the two kinds of gap
// it emits — a whole-topic miss ("Topic not found…") vs a specific
// uncovered outcome — plus any drift or hard error.
function AuditFinding({ finding }) {
  const gaps = Array.isArray(finding.gaps) ? finding.gaps : []
  const drift = Array.isArray(finding.drift) ? finding.drift : []
  const topicGaps = gaps.filter((g) => !g.outcome)
  const outcomeGaps = gaps.filter((g) => g.outcome)

  return (
    <li className="rounded-lg border theme-border bg-white/70 px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800">
          {toolLabel(finding.tool)}
        </span>
        {finding.generationId && (
          <code className="font-mono text-[10px] theme-text-muted truncate">{finding.generationId}</code>
        )}
      </div>

      {finding.error && (
        <p className="text-[11px] text-red-700">
          <span className="font-black">Error:</span> {finding.error}
        </p>
      )}

      {topicGaps.map((g, i) => (
        <p key={`t-${i}`} className="theme-text">
          <span className="font-black">Topic:</span> {g.topic || g.kbEntryId || '(none)'}
          {g.note && <span className="theme-text-muted italic"> — {g.note}</span>}
        </p>
      ))}

      {outcomeGaps.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-amber-900">
            Outcomes not covered
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {outcomeGaps.map((g, i) => (
              <li key={`o-${i}`}>
                <span className="font-mono text-[10px] font-black text-amber-800">{g.outcome}</span>
                {g.text && <span className="theme-text"> — {g.text}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {drift.map((d, i) => (
        <p key={`d-${i}`} className="text-[11px] text-red-800">
          <span className="font-black">Drift:</span> <span className="font-mono">{d.outcome}</span>
          {d.note && <span className="theme-text-muted italic"> — {d.note}</span>}
        </p>
      ))}
    </li>
  )
}

// Readable renderer for the weekly CBC audit rollup.
export function CbcAuditSummaryCard({ summary }) {
  if (!summary || typeof summary !== 'object') return null
  const {
    sampleSize = 0,
    aligned = 0,
    drifted = 0,
    errored = 0,
    skipped = 0,
    audited,
    findings = [],
    note,
  } = summary

  // `audited` was added alongside `skipped`; older rollups predate it, so
  // fall back to aligned + drifted.
  const auditedCount = typeof audited === 'number' ? audited : aligned + drifted
  const clean = drifted === 0 && errored === 0
  const list = Array.isArray(findings) ? findings : []

  const headerCls = clean ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
  const headerText = clean ? 'text-emerald-800' : 'text-amber-800'

  let verdict
  if (!sampleSize) {
    verdict = note || 'No generations were available to audit.'
  } else if (clean) {
    verdict = `All ${auditedCount} audited generation${auditedCount === 1 ? '' : 's'} aligned with the verified CBC KB.`
  } else {
    const parts = [`${drifted} of ${auditedCount} audited generation${auditedCount === 1 ? '' : 's'} flagged for review`]
    if (errored) parts.push(`${errored} errored`)
    verdict = `${parts.join(' · ')}.`
  }

  return (
    <section className={`rounded-2xl border ${headerCls} p-4 space-y-3`}>
      <div>
        <p className={`text-sm font-black ${headerText}`}>
          Weekly CBC alignment audit — {clean ? 'clean' : 'review needed'}
        </p>
        <p className={`text-xs mt-0.5 ${headerText} opacity-80`}>{verdict}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <AuditStat label="Sampled" value={sampleSize} />
        <AuditStat label="Audited" value={auditedCount} />
        <AuditStat label="Aligned" value={aligned} accent="text-emerald-700" />
        <AuditStat label="Flagged" value={drifted} accent={drifted > 0 ? 'text-amber-700' : undefined} />
        <AuditStat label="Skipped" value={skipped} accent="theme-text-muted" />
        <AuditStat label="Errored" value={errored} accent={errored > 0 ? 'text-red-700' : undefined} />
      </div>

      <p className="rounded-lg bg-white/50 px-3 py-2 text-[11px] theme-text-muted leading-relaxed">
        <span className="font-black theme-text">Flagged</span> means Cala found a gap against the verified CBC
        outcomes — either a topic it couldn&apos;t match or an outcome the draft didn&apos;t cover.{' '}
        <span className="font-black theme-text">Skipped</span> generations have nothing to align against
        (non-curricular tools like timetables, or subject-wide papers with no topic) and are not a problem.
      </p>

      {list.length > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-amber-900 mb-1.5">
            Findings ({list.length})
          </h4>
          <ul className="space-y-1.5">
            {list.map((f, i) => (
              <AuditFinding key={f.generationId || `f-${i}`} finding={f} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// Shape-sniffing wrapper used by the job detail page.
export function CalaOutput({ alignment }) {
  if (!alignment) return null
  return isAuditSummary(alignment) ? (
    <CbcAuditSummaryCard summary={alignment} />
  ) : (
    <CbcAlignmentCard alignment={alignment} />
  )
}

export default CalaOutput
