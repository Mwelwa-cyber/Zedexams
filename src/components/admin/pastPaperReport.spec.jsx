/**
 * Behavioural tests for the Past Paper Studio's verification report (Phase
 * 11/15): the studio must show expected/valid/missing/rejected/diagram
 * counts, and reflect a gate-blocked import loudly and honestly.
 *
 * Run: npm run test:unit -- pastPaperReport
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VerificationSummary, ImportReportCard } from './pastPaperReport'

// Mirrors the Phase 7 report example: a clean 60/60 import with a couple of
// duplicates and one worked example rejected, and diagrams mostly attached.
const cleanReport = {
  expectedCount: 60,
  candidateCount: 63,
  validCount: 60,
  questionsFound: 63,
  missingNumbers: [],
  duplicateNumbers: [],
  rejectedExtras: [
    { sourceQuestionNumber: 61, reason: 'outside_declared_range' },
    { sourceQuestionNumber: 62, reason: 'outside_declared_range' },
    { sourceQuestionNumber: 23, reason: 'duplicate_candidate' },
  ],
  examplesRejected: 1,
  diagramsDetected: 9,
  diagramsAttached: 8,
  diagramsNeedingReview: 1,
  gatePassed: true,
  confidence: 0.94,
  byType: { mcq: 60 },
  corrections: [],
  issues: [],
  validationWarnings: [],
  blockers: [],
  engineVersion: '2026.07.18-exact-count',
}

const blockedReport = {
  ...cleanReport,
  validCount: 59,
  missingNumbers: [24],
  gatePassed: false,
  gated: true,
  blockers: ['Missing questions: 24'],
}

describe('VerificationSummary', () => {
  it('reports expected / valid / missing counts for a clean 60/60 import', () => {
    render(<VerificationSummary report={cleanReport} gatePassed />)
    expect(screen.getByText(/60 \/ 60 questions located/)).toBeInTheDocument()
    expect(screen.getByText(/60 valid question/)).toBeInTheDocument()
    expect(screen.getByText(/0 missing/)).toBeInTheDocument()
    expect(screen.getByText(/✅ Gate passed/)).toBeInTheDocument()
  })

  it('reports rejected extras and duplicate candidates', () => {
    render(<VerificationSummary report={cleanReport} gatePassed />)
    expect(screen.getByText(/2 extra questions? rejected/)).toBeInTheDocument()
    expect(screen.getByText(/61, 62/)).toBeInTheDocument()
    expect(screen.getByText(/1 duplicate candidate/)).toBeInTheDocument()
  })

  it('reports the rejected worked example', () => {
    render(<VerificationSummary report={cleanReport} gatePassed />)
    expect(screen.getByText(/1 worked example \/ instruction block rejected/)).toBeInTheDocument()
  })

  it('reports diagram detected / attached / needing-review counts', () => {
    render(<VerificationSummary report={cleanReport} gatePassed />)
    expect(screen.getByText(/9 diagrams detected/)).toBeInTheDocument()
    expect(screen.getByText(/8 diagrams attached/)).toBeInTheDocument()
    expect(screen.getByText(/1 diagram needs review/)).toBeInTheDocument()
  })

  it('shows a blocked gate + the missing number when the import failed validation', () => {
    render(<VerificationSummary report={blockedReport} gatePassed={false} />)
    expect(screen.getByText(/⛔ Gate blocked/)).toBeInTheDocument()
    expect(screen.getByText(/1 missing: 24/)).toBeInTheDocument()
  })
})

describe('ImportReportCard', () => {
  it('renders the verification summary alongside the existing stat grid', () => {
    render(<ImportReportCard report={cleanReport} />)
    expect(screen.getByText('Verification')).toBeInTheDocument()
    expect(screen.getByText('Questions imported')).toBeInTheDocument()
  })

  it('surfaces the gated banner and blockers for a blocked import, and does not report success', () => {
    render(<ImportReportCard report={blockedReport} />)
    expect(screen.getByText(/Import paused — nothing was saved/)).toBeInTheDocument()
    expect(screen.getByText(/Missing questions: 24/)).toBeInTheDocument()
    expect(screen.getByText(/⛔ Gate blocked/)).toBeInTheDocument()
  })

  it('returns nothing for a null report', () => {
    const { container } = render(<ImportReportCard report={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
