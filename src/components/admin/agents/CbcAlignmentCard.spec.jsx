import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  CalaOutput,
  CbcAuditSummaryCard,
  CbcAlignmentCard,
  isAuditSummary,
} from './CbcAlignmentCard'

// A per-draft content-line Cala result.
const CONTENT_RESULT = {
  aligned: false,
  citations: [{ outcome: 'g1-math:o1', text: 'Count forwards and backwards from 1 to 20' }],
  gaps: [{ outcome: 'g1-math:o2', text: 'Write numerals 1-20', note: 'Outcome not covered in draft.' }],
  drift: [],
  kbVersion: 'v3',
  kbWarning: null,
}

// A weekly-audit rollup — the shape that used to render as a misleading
// green "aligned" card. Mirrors functions/agents/cron.js output.cala.
const AUDIT_SUMMARY = {
  sampleSize: 20,
  audited: 6,
  aligned: 1,
  drifted: 5,
  errored: 0,
  skipped: 14,
  findings: [
    {
      generationId: 'nkQWEeOBG4YrFdHqnnjv',
      tool: 'assessment',
      drift: [],
      gaps: [
        {
          outcome: 'g4-integrated-science-4-2-nutrition-andhealth:o1',
          text: '4.2.1.1 Classify foods based on their nutritional content',
          note: 'Outcome not covered in draft.',
        },
      ],
    },
    {
      generationId: 'Se0UZeMXhKkQf0aYT2fS',
      tool: 'sba_task',
      drift: [],
      gaps: [{ topic: '5.1.1 The Heart', note: 'Topic not found in verified CBC KB.' }],
    },
  ],
}

describe('isAuditSummary', () => {
  it('detects the weekly-audit rollup shape', () => {
    expect(isAuditSummary(AUDIT_SUMMARY)).toBe(true)
    expect(isAuditSummary({ sampleSize: 0, note: 'none' })).toBe(true)
  })

  it('rejects the per-draft content-line shape', () => {
    expect(isAuditSummary(CONTENT_RESULT)).toBe(false)
    expect(isAuditSummary(null)).toBe(false)
    expect(isAuditSummary({})).toBe(false)
  })
})

describe('CalaOutput routing', () => {
  it('renders the audit card (not the content card) for an audit rollup', () => {
    render(<CalaOutput alignment={AUDIT_SUMMARY} />)
    expect(screen.getByText(/Weekly CBC alignment audit/i)).toBeInTheDocument()
    // The old bug: an audit rollup showed the content-line "aligned" header.
    expect(screen.queryByText(/^CBC alignment —/i)).not.toBeInTheDocument()
  })

  it('renders the content card for a per-draft result', () => {
    render(<CalaOutput alignment={CONTENT_RESULT} />)
    expect(screen.getByText(/CBC alignment — review needed/i)).toBeInTheDocument()
    expect(screen.queryByText(/Weekly CBC alignment audit/i)).not.toBeInTheDocument()
  })
})

describe('CbcAuditSummaryCard', () => {
  it('summarises the run as review-needed with the flagged count', () => {
    render(<CbcAuditSummaryCard summary={AUDIT_SUMMARY} />)
    expect(screen.getByText(/review needed/i)).toBeInTheDocument()
    expect(screen.getByText(/5 of 6 audited generations flagged for review/i)).toBeInTheDocument()
  })

  it('surfaces each finding: tool, uncovered outcome, and unmatched topic', () => {
    render(<CbcAuditSummaryCard summary={AUDIT_SUMMARY} />)
    expect(screen.getByText('assessment')).toBeInTheDocument()
    expect(screen.getByText('sba task')).toBeInTheDocument()
    expect(
      screen.getByText(/4\.2\.1\.1 Classify foods based on their nutritional content/i),
    ).toBeInTheDocument()
    expect(screen.getByText('5.1.1 The Heart')).toBeInTheDocument()
    expect(screen.getByText(/Topic not found in verified CBC KB/i)).toBeInTheDocument()
  })

  it('reads as clean when nothing drifted or errored', () => {
    render(
      <CbcAuditSummaryCard
        summary={{ sampleSize: 10, audited: 8, aligned: 8, drifted: 0, errored: 0, skipped: 2, findings: [] }}
      />,
    )
    expect(screen.getByText(/audit — clean/i)).toBeInTheDocument()
    expect(screen.getByText(/All 8 audited generations aligned/i)).toBeInTheDocument()
  })

  it('falls back to aligned+drifted when an older rollup lacks `audited`', () => {
    render(
      <CbcAuditSummaryCard summary={{ sampleSize: 20, aligned: 1, drifted: 5, errored: 0, findings: [] }} />,
    )
    // 1 + 5 = 6 audited inferred.
    expect(screen.getByText(/5 of 6 audited generations flagged for review/i)).toBeInTheDocument()
  })

  it('handles the empty-sample rollup without crashing', () => {
    render(<CbcAuditSummaryCard summary={{ sampleSize: 0, note: 'No aiGenerations found to audit.' }} />)
    expect(screen.getByText(/No aiGenerations found to audit/i)).toBeInTheDocument()
  })
})

describe('CbcAlignmentCard (unchanged content-line renderer)', () => {
  it('shows citations and gaps for a per-draft result', () => {
    render(<CbcAlignmentCard alignment={CONTENT_RESULT} />)
    expect(screen.getByText('g1-math:o1')).toBeInTheDocument()
    expect(screen.getByText(/1 citation ·/i)).toBeInTheDocument()
    expect(screen.getByText(/Outcome not covered in draft/i)).toBeInTheDocument()
  })
})
