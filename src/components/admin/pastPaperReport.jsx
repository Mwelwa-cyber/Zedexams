/**
 * pastPaperReport — the Past Paper Studio's import/verification report cards.
 *
 * Split out of PastPaperStudio.jsx so these are pure, presentational, and
 * firebase-free: PastPaperStudio.jsx (and its whole import tree — Firebase
 * Auth/Firestore/Functions, react-router) can't be unit-tested without heavy
 * mocking, but a report renderer that only takes a plain `report` object can.
 *
 * Render the structured report returned by the AI importer: what it
 * processed, what it found, the per-type breakdown, the confidence score,
 * and any issues (numbering gaps, un-keyed answers) it detected + automatic
 * corrections it applied. Gives the admin a verifiable "did it import the
 * whole paper" view.
 */

const TYPE_LABELS = {
  mcq: 'Multiple choice', tf: 'True / false', short_answer: 'Short answer',
  fill_blanks: 'Fill in the blanks', essay: 'Essay', numeric: 'Numeric',
}

// Verification screen (Phase 11): a plain-language readout of the exact-count
// invariant the importer enforces — expected vs. located vs. valid, missing
// numbers, rejected duplicates/examples/extras, and diagram attach status.
// Shown for every completed import (both gated and successful) so the admin
// can always see exactly what happened, not just the pass/fail headline.
export function VerificationSummary({ report, gatePassed }) {
  const expected = report.expectedCount
  const missing = Array.isArray(report.missingNumbers) ? report.missingNumbers : []
  const duplicates = Array.isArray(report.duplicateNumbers) ? report.duplicateNumbers : []
  const rejectedExtras = Array.isArray(report.rejectedExtras) ? report.rejectedExtras : []
  const outOfRange = rejectedExtras.filter((r) => r.reason === 'outside_declared_range')
  const dupCandidates = rejectedExtras.filter((r) => r.reason === 'duplicate_candidate')
  const examplesRejected = Number(report.examplesRejected) || 0
  const diagramsDetected = Number(report.diagramsDetected) || 0
  const diagramsAttached = Number(report.diagramsAttached) || 0
  const diagramsNeedingReview = Number(report.diagramsNeedingReview) || 0

  const lines = []
  if (expected != null) {
    lines.push({
      text: `${report.validCount ?? 0} / ${expected} questions located`,
      tone: (report.validCount ?? 0) === expected ? 'good' : 'bad',
    })
  } else {
    lines.push({ text: `${report.validCount ?? report.questionsFound ?? 0} questions located (paper declares no total to check against)`, tone: 'neutral' })
  }
  lines.push({ text: `${report.validCount ?? 0} valid question${(report.validCount ?? 0) === 1 ? '' : 's'}`, tone: 'neutral' })
  lines.push({ text: `${missing.length} missing${missing.length ? ': ' + missing.slice(0, 12).join(', ') + (missing.length > 12 ? ', …' : '') : ''}`, tone: missing.length ? 'bad' : 'good' })
  if (outOfRange.length) {
    lines.push({ text: `${outOfRange.length} extra question${outOfRange.length === 1 ? '' : 's'} rejected (not on the paper): ${outOfRange.slice(0, 12).map((r) => r.sourceQuestionNumber).join(', ')}${outOfRange.length > 12 ? ', …' : ''}`, tone: 'good' })
  }
  if (dupCandidates.length || duplicates.length) {
    const n = Math.max(dupCandidates.length, duplicates.length)
    lines.push({ text: `${n} duplicate candidate${n === 1 ? '' : 's'} collapsed to the most complete read`, tone: 'good' })
  }
  if (examplesRejected > 0) {
    lines.push({ text: `${examplesRejected} worked example / instruction block${examplesRejected === 1 ? '' : 's'} rejected`, tone: 'good' })
  }
  if (diagramsDetected > 0) {
    lines.push({ text: `${diagramsDetected} diagram${diagramsDetected === 1 ? '' : 's'} detected`, tone: 'neutral' })
    lines.push({ text: `${diagramsAttached} diagram${diagramsAttached === 1 ? '' : 's'} attached`, tone: diagramsAttached === diagramsDetected ? 'good' : 'neutral' })
    if (diagramsNeedingReview > 0) {
      lines.push({ text: `${diagramsNeedingReview} diagram${diagramsNeedingReview === 1 ? '' : 's'} need${diagramsNeedingReview === 1 ? 's' : ''} review`, tone: 'bad' })
    }
  }

  const toneCls = { good: 'text-emerald-700', bad: 'text-rose-700', neutral: 'theme-text' }
  const toneIcon = { good: '✅', bad: '⚠️', neutral: '•' }

  return (
    <div className="theme-bg-subtle rounded-xl p-4 space-y-1">
      <div className="flex items-center justify-between">
        <p className="font-black text-sm theme-text">Verification</p>
        <span className={`text-xs font-black ${gatePassed ? 'text-emerald-700' : 'text-rose-700'}`}>
          {gatePassed ? '✅ Gate passed' : '⛔ Gate blocked'}
        </span>
      </div>
      <ul className="space-y-0.5">
        {lines.map((line, i) => (
          <li key={i} className={`text-xs font-bold ${toneCls[line.tone]}`}>
            {toneIcon[line.tone]} {line.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ImportReportCard({ report }) {
  if (!report) return null
  const pct = Math.round((Number(report.confidence) || 0) * 100)
  const confTone = pct >= 85 ? 'text-emerald-700' : pct >= 60 ? 'text-amber-700' : 'text-rose-700'
  const stat = (label, value) => (
    <div className="theme-bg-subtle rounded-lg px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide theme-text-muted">{label}</p>
      <p className="theme-text font-black text-lg leading-tight">{value}</p>
    </div>
  )
  const byType = report.byType && typeof report.byType === 'object' ? report.byType : {}
  const typeEntries = Object.entries(byType).filter(([, n]) => n > 0)
  const blockers = Array.isArray(report.blockers) ? report.blockers : []
  const validationWarnings = Array.isArray(report.validationWarnings) ? report.validationWarnings : []
  return (
    <section className="theme-card border theme-border rounded-radius-md p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="theme-accent-text font-black text-xs uppercase tracking-widest">Import report</p>
        <p className={`text-sm font-black ${confTone}`}>Confidence {pct}%</p>
      </div>

      {report.gated && (
        <div className="border-l-4 border-rose-600 bg-rose-50 text-rose-900 text-sm rounded-r-lg p-3">
          <p className="font-black mb-1">⛔ Import paused — nothing was saved</p>
          <p className="text-xs mb-2">
            The paper has structural problems that must be fixed before it can
            reach the Quiz Editor. Your existing quiz was left untouched.
          </p>
          <ul className="list-disc ml-4 space-y-0.5 font-bold">
            {blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          {/* numbering.missing is NOT repeated here — gateImport already
              includes a "Missing questions: …" line in blockers. */}
        </div>
      )}

      <VerificationSummary report={report} gatePassed={report.gatePassed !== false && !report.gated} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat('Pages processed', report.pagesProcessed ?? '—')}
        {stat('Questions found', report.questionsFound ?? '—')}
        {stat('Questions imported', report.questionsImported ?? '—')}
        {stat('Duplicates removed', report.duplicatesRemoved ?? 0)}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat('With answer key', report.withAnswerKey ?? 0)}
        {stat('Need an answer', report.withoutAnswerKey ?? 0)}
        {stat('Reading passages', report.passagesCaptured ?? 0)}
        {stat('Tables rebuilt', report.tablesCaptured ?? 0)}
      </div>

      {Array.isArray(report.figures) && report.figures.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stat('Figures / maps located', report.figures.length)}
        </div>
      )}

      {report.confidenceBands && report.confidenceBands.scored > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide theme-text-muted mb-1.5">
            AI read confidence — check the lower bands first in the Quiz Editor
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full px-3 py-1 text-xs font-black bg-emerald-100 text-emerald-800">
              High: {report.confidenceBands.auto ?? 0}
            </span>
            <span className="rounded-full px-3 py-1 text-xs font-black bg-amber-100 text-amber-800">
              Review: {report.confidenceBands.review ?? 0}
            </span>
            <span className="rounded-full px-3 py-1 text-xs font-black bg-rose-100 text-rose-800">
              Check: {report.confidenceBands.approve ?? 0}
            </span>
          </div>
        </div>
      )}

      {typeEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {typeEntries.map(([type, n]) => (
            <span key={type} className="theme-bg-subtle rounded-full px-3 py-1 text-xs font-bold theme-text">
              {TYPE_LABELS[type] || type}: {n}
            </span>
          ))}
        </div>
      )}

      {Array.isArray(report.corrections) && report.corrections.length > 0 && (
        <div className="border-l-4 border-emerald-500 bg-emerald-50 text-emerald-900 text-xs rounded-r-lg p-3">
          <p className="font-black mb-1">Automatically corrected</p>
          <ul className="list-disc ml-4 space-y-0.5">
            {report.corrections.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {(() => {
        // Merge the deterministic report issues with the engine's non-blocking
        // validation warnings (dedup so a shared message isn't shown twice).
        const items = Array.from(new Set([
          ...(Array.isArray(report.issues) ? report.issues : []),
          ...validationWarnings,
        ]))
        if (!items.length) return null
        return (
          <div className="border-l-4 border-amber-500 bg-amber-50 text-amber-900 text-xs rounded-r-lg p-3">
            <p className="font-black mb-1">Review before publishing</p>
            <ul className="list-disc ml-4 space-y-0.5">
              {items.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )
      })()}

      {/* Deploy observability: which import-engine version actually ran. An
          empty value means the deployed Cloud Function is running code older
          than version stamping — i.e. a stale deploy, the exact failure that
          made past importer fixes look broken while every test passed. */}
      <p className="font-mono text-[11px] font-bold theme-text-muted">
        {report.engineVersion
          ? `engine ${report.engineVersion}`
          : '⚠ engine version not reported — the import function is running OLD code (stale deploy)'}
      </p>
    </section>
  )
}
