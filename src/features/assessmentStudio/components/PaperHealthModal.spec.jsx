import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaperHealthModal from './PaperHealthModal.jsx'
import { computePaperHealth } from '../lib/paperHealth.js'

// Build a real health object so the spec exercises the gate end-to-end
// (computePaperHealth → PaperHealthModal), not a hand-faked shape.
function healthFrom({ issues = [], summary = [], smartWarnings = [], stats = {} } = {}) {
  return computePaperHealth({ validation: { issues, summary }, smartWarnings, stats })
}

const readyHealth = healthFrom({
  summary: [{ id: 'title', label: 'Title set', ok: true }, { id: 'q', label: 'At least one question', ok: true }],
  stats: { questionCount: 12, totalMarks: 30, printPdfPages: 2, sectionCount: 2 },
})

const blockedHealth = healthFrom({
  issues: [
    { id: 'subject', label: 'Subject is required', severity: 'error' },
    { id: 'opt-empty-q1', label: 'Question 1 option C is empty', severity: 'error' },
  ],
  summary: [{ id: 'subject', label: 'Subject set', ok: false }],
  stats: { questionCount: 3, totalMarks: 6 },
})

const attentionHealth = healthFrom({
  smartWarnings: [{ key: 'school', severity: 'warn', message: 'Missing school name.' }],
  summary: [{ id: 'title', label: 'Title set', ok: true }],
  stats: { questionCount: 8, totalMarks: 16 },
})

describe('PaperHealthModal', () => {
  let onClose, onVerify, onPrimary
  beforeEach(() => {
    onClose = vi.fn()
    onVerify = vi.fn()
    onPrimary = vi.fn()
  })

  function renderModal(health, extra = {}) {
    return render(
      <PaperHealthModal
        open
        health={health}
        onClose={onClose}
        onVerify={onVerify}
        primaryAction={{ label: 'Save to library', onClick: onPrimary, disabled: health.blockerCount > 0 }}
        {...extra}
      />,
    )
  }

  it('renders nothing when closed', () => {
    const { container } = render(<PaperHealthModal open={false} health={readyHealth} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without a health object', () => {
    const { container } = render(<PaperHealthModal open health={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a Ready badge and an all-clear message for a clean paper', () => {
    renderModal(readyHealth)
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText(/Everything checks out/i)).toBeInTheDocument()
    // Primary save is enabled on a clean paper.
    expect(screen.getByRole('button', { name: /Save to library/i })).not.toBeDisabled()
  })

  it('lists the blockers and disables Save when the paper is blocked', () => {
    renderModal(blockedHealth)
    expect(screen.getByText('Needs fixing')).toBeInTheDocument()
    expect(screen.getByText(/Fix before saving \(2\)/i)).toBeInTheDocument()
    expect(screen.getByText('Subject is required')).toBeInTheDocument()
    expect(screen.getByText('Question 1 option C is empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save to library/i })).toBeDisabled()
  })

  it('surfaces advisories but still allows saving in the attention state', () => {
    renderModal(attentionHealth)
    expect(screen.getByText('Worth a look')).toBeInTheDocument()
    expect(screen.getByText(/Worth checking \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText('Missing school name.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save to library/i })).not.toBeDisabled()
  })

  it('renders the live paper stats', () => {
    renderModal(readyHealth)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText(/questions/)).toBeInTheDocument()
    expect(screen.getByText('marks')).toBeInTheDocument()
  })

  it('routes the AI quality check through onVerify', () => {
    renderModal(readyHealth)
    fireEvent.click(screen.getByRole('button', { name: /Run AI quality check/i }))
    expect(onVerify).toHaveBeenCalledTimes(1)
  })

  it('fires the primary action when Save is clicked', () => {
    renderModal(readyHealth)
    fireEvent.click(screen.getByRole('button', { name: /Save to library/i }))
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })

  it('closes on the Close button and on Escape', () => {
    renderModal(readyHealth)
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows a busy primary action without firing twice', () => {
    render(
      <PaperHealthModal
        open
        health={readyHealth}
        onClose={onClose}
        primaryAction={{ label: 'Save to library', busy: true, busyLabel: 'Saving…', onClick: onPrimary }}
      />,
    )
    expect(screen.getByRole('button', { name: /Saving…/i })).toBeDisabled()
  })
})

describe('PaperHealthModal — printability', () => {
  const layoutHealth = (over = {}) => ({
    status: 'print-blocked',
    blockers: [],
    advisories: [],
    checks: [],
    printBlockers: [{ id: 'blank-page', label: 'Page 2 is blank — the paper ends with an empty sheet.' }],
    printBlockerCount: 1,
    layoutPending: false,
    layoutUnverified: false,
    blockerCount: 0,
    advisoryCount: 0,
    ready: true,
    stats: {},
    ...over,
  })

  it('lists the layout problem the export was refused for', () => {
    // The gap this closes: a refused Print SENDS the teacher to this panel, and
    // before Phase 5 the panel had never heard of pagination and told them
    // everything was fine.
    render(<PaperHealthModal open health={layoutHealth()} onClose={() => {}} />)
    expect(screen.getByText(/Page 2 is blank/)).toBeInTheDocument()
    expect(screen.getByText(/Fix before printing \(1\)/)).toBeInTheDocument()
  })

  it('says Word is unaffected, because that button is enabled beside it', () => {
    render(<PaperHealthModal open health={layoutHealth()} onClose={() => {}} />)
    expect(screen.getByText(/Word download is unaffected/i)).toBeInTheDocument()
  })

  it('does not present it as an unfinished paper', () => {
    render(<PaperHealthModal open health={layoutHealth()} onClose={() => {}} />)
    expect(screen.queryByText(/Fix before saving/)).not.toBeInTheDocument()
  })

  it('reports a measurement in progress as progress, not as a defect', () => {
    render(<PaperHealthModal open onClose={() => {}} health={layoutHealth({
      status: 'ready', printBlockers: [], printBlockerCount: 0, layoutPending: true,
    })} />)
    expect(screen.getByText(/Checking the page layout/)).toBeInTheDocument()
    expect(screen.queryByText(/Fix before printing/)).not.toBeInTheDocument()
  })

  it('reports a failed measurement as unverified', () => {
    render(<PaperHealthModal open onClose={() => {}} health={layoutHealth({
      status: 'ready', printBlockers: [], printBlockerCount: 0, layoutUnverified: true,
    })} />)
    expect(screen.getByText(/could not be verified/)).toBeInTheDocument()
  })

  it('a clean paper still reads as clean', () => {
    render(<PaperHealthModal open onClose={() => {}} health={layoutHealth({
      status: 'ready', printBlockers: [], printBlockerCount: 0,
    })} />)
    expect(screen.queryByText(/Fix before printing/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Checking the page layout/)).not.toBeInTheDocument()
  })
})
