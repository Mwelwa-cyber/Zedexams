import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import GeneratorStudioShell from './GeneratorStudioShell.jsx'

// The shared-shell contract: header text renders, the notice stack keeps its
// order (recovery strip ABOVE SetupForYouCard), the saved chip lives inside
// the form card, and the preview column is a compact desktop-only empty state
// while idle (nothing on phones), swapping to the real output once generating.

// Helmet needs a provider we don't want to stand up here.
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

// The plan-context hook (used by useStudioSetupForYou, which this suite does
// not exercise) reads Firestore — keep it inert.
vi.mock('../studio/hooks/useTeacherPlanContext', () => ({
  useTeacherPlanContext: () => ({ loading: false, suggestion: null }),
}))

// A draft whose recovery strip is VISIBLE (recovery.available) and whose
// status renders the DraftStatusIndicator "Saved" pill.
function visibleDraft() {
  return {
    status: 'saved',
    savedAt: Date.now(),
    online: true,
    recovery: { available: true, payload: { savedAt: Date.now() } },
    source: 'local',
    acceptRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    flush: vi.fn(),
    clear: vi.fn(),
  }
}

function renderShell(overrides = {}) {
  return render(
    <MemoryRouter>
      <GeneratorStudioShell
        seoTitle="Test studio"
        header={{
          eyebrow: 'Assessment',
          title: 'Rubric Studio',
          description: 'Mark consistently — four-level rubrics.',
          icon: ListChecks,
        }}
        draft={visibleDraft()}
        draftLabel="rubric"
        setupForYou={{
          chips: [{ label: 'Grade 4' }, { label: 'Mathematics' }],
          onChange: vi.fn(),
          onDismiss: vi.fn(),
        }}
        onSubmit={(e) => e.preventDefault()}
        selector={<div data-testid="selector-slot" />}
        form={<div data-testid="form-fields" />}
        generateButton={<button type="submit">Generate</button>}
        usageLine="1/10 used"
        status="idle"
        emptyState={{ icon: ListChecks, title: 'Ready when you are', text: 'Pick a class on the left.' }}
        output={<div data-testid="studio-output">OUTPUT</div>}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('GeneratorStudioShell', () => {
  it('renders the header eyebrow, title and description', () => {
    renderShell()
    expect(screen.getByText('Assessment')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rubric Studio' })).toBeInTheDocument()
    expect(screen.getByText('Mark consistently — four-level rubrics.')).toBeInTheDocument()
  })

  it('renders the recovery strip ABOVE the SetupForYouCard in the notice stack', () => {
    renderShell()
    const recovery = screen.getByRole('alertdialog', { name: /unfinished draft/i })
    const card = screen.getByText(/set up for you/i)
    // DOCUMENT_POSITION_FOLLOWING = the card comes after the recovery strip.
    expect(
      recovery.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders the saved chip inside the form card, with the form contents', () => {
    renderShell()
    const chip = screen.getByRole('status')
    expect(chip).toHaveTextContent(/saved/i)
    expect(chip.closest('form')).not.toBeNull()
    expect(screen.getByTestId('selector-slot').closest('form')).not.toBeNull()
    expect(screen.getByTestId('form-fields').closest('form')).not.toBeNull()
    expect(screen.getByText('1/10 used').closest('form')).not.toBeNull()
  })

  it('idle: shows the compact desktop-only empty state and does NOT mount the output', () => {
    renderShell({ status: 'idle' })
    const empty = screen.getByTestId('studio-idle-empty')
    // Compact one-liner, hidden below lg (phones render no preview column).
    expect(empty.className).toContain('hidden')
    expect(empty.className).toContain('lg:flex')
    expect(screen.getByText('Ready when you are')).toBeInTheDocument()
    expect(screen.queryByTestId('studio-output')).not.toBeInTheDocument()
  })

  it('generating: mounts the output and drops the idle empty state', () => {
    renderShell({ status: 'generating' })
    expect(screen.getByTestId('studio-output')).toBeInTheDocument()
    expect(screen.queryByTestId('studio-idle-empty')).not.toBeInTheDocument()
  })
})
