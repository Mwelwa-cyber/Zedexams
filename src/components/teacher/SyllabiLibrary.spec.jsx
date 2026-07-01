import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import SyllabiLibrary from './SyllabiLibrary.jsx'

// The studio loads the merged curriculum JSON via the KB service — feed it a
// tiny fixture so the reading-first behaviours (subject panel, full screen
// reading mode, column width hints) can be exercised without the ~1.3MB file.
vi.mock('../../utils/syllabusKbService', () => ({
  getMergedSyllabi: vi.fn(async () => ({
    'Physics Syllabus (Forms 1-4)': {
      'Form 1': {
        columns: ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
        rows: [
          { type: 'section', label: 'MECHANICS' },
          {
            type: 'data',
            cells: {
              'TOPIC': 'Measurements',
              'SUB-TOPIC': 'Length and time',
              'SPECIFIC COMPETENCES': 'Measure length using appropriate instruments',
              'LEARNING ACTIVITIES': '• Measuring desks\n• Using stop watches',
              'EXPECTED STANDARD': 'Length measured accurately',
            },
          },
        ],
      },
      'Form 2': {
        columns: ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
        rows: [
          {
            type: 'data',
            cells: {
              'TOPIC': 'Forces',
              'SUB-TOPIC': 'Types of forces',
              'SPECIFIC COMPETENCES': 'Describe types of forces',
              'LEARNING ACTIVITIES': '• Demonstrating friction',
              'EXPECTED STANDARD': 'Forces described correctly',
            },
          },
        ],
      },
    },
  })),
}))

function renderStudio() {
  return render(
    <HelmetProvider>
      <SyllabiLibrary />
    </HelmetProvider>,
  )
}

// "Physics" appears twice (sidebar nav item + home card) — open via the card.
async function openPhysics() {
  const utils = renderStudio()
  const buttons = await screen.findAllByRole('button', { name: /Physics/ })
  fireEvent.click(buttons.find(b => b.classList.contains('ss-subj-card')))
  return utils
}

describe('SyllabiLibrary (Syllabus Studio)', () => {
  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
  })

  it('opens a subject and marks the root as subject view (collapses nav to a rail via CSS)', async () => {
    const { container } = await openPhysics()
    const root = container.querySelector('.ss-root')
    expect(root.getAttribute('data-view')).toBe('subject')
    // Grade tabs render inside the sticky tabs bar.
    expect(screen.getByRole('tab', { name: 'Form 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Form 2' })).toBeInTheDocument()
    // The rail expander is in the DOM so tablet/desktop users can reopen the
    // list (visibility is media-query driven, which jsdom doesn't evaluate).
    expect(container.querySelector('.ss-rail-toggle')).toBeTruthy()
  })

  it('sizes columns ≈25/45/30 via colgroup hints (TOPIC hidden until filtering)', async () => {
    const { container } = await openPhysics()
    let cols = [...container.querySelectorAll('colgroup col')].map(c => c.style.width)
    // 4 visible content columns → 22/40/23/15.
    expect(cols).toEqual(['22%', '40%', '23%', '15%'])
    // Filtering brings TOPIC back with a slim 10% share.
    fireEvent.change(screen.getByPlaceholderText('Filter rows in this level…'), {
      target: { value: 'length' },
    })
    cols = [...container.querySelectorAll('colgroup col')].map(c => c.style.width)
    expect(cols).toHaveLength(5)
    expect(cols[0]).toBe('10%')
  })

  it('enters and exits full screen reading mode, locking the page scroll behind it', async () => {
    const { container } = await openPhysics()
    fireEvent.click(screen.getByRole('button', { name: /Full screen/ }))
    const root = container.querySelector('.ss-root')
    expect(root.classList.contains('is-reading')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    // Reading bar shows the subject + active level and the exit control.
    expect(screen.getByText('Form 1', { selector: '.ss-rb-title span' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Exit full screen/ }))
    expect(root.classList.contains('is-reading')).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('exits reading mode on Escape', async () => {
    const { container } = await openPhysics()
    fireEvent.click(screen.getByRole('button', { name: /Full screen/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('.ss-root').classList.contains('is-reading')).toBe(false)
  })

  it('wraps section and topic banner labels for the pinned-label scroll trick', async () => {
    const { container } = await openPhysics()
    // The spans stick horizontally on phones (CSS-driven) so banner text
    // stays readable while the table h-scrolls under the pinned column.
    // Direct-child selectors guard against wrapper elements sneaking in
    // between td and span, which would break the sticky trick.
    expect(container.querySelector('.ss-section-row td > .ss-rowlabel')).toHaveTextContent('MECHANICS')
    expect(container.querySelector('.ss-topic-header-row td > .ss-rowlabel')).toHaveTextContent('Measurements')
  })

  it('defers Escape to a stacked modal dialog instead of exiting reading mode beneath it', async () => {
    const { container } = await openPhysics()
    fireEvent.click(screen.getByRole('button', { name: /Full screen/ }))
    const root = container.querySelector('.ss-root')
    expect(root.classList.contains('is-reading')).toBe(true)

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    try {
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(root.classList.contains('is-reading')).toBe(true)
      expect(document.body.style.overflow).toBe('hidden')
    } finally {
      dialog.remove()
    }

    // With the modal gone, Escape exits as normal.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(root.classList.contains('is-reading')).toBe(false)
  })

  it('opens the subject panel from the hamburger and closes it on selection', async () => {
    const { container } = renderStudio()
    await screen.findAllByRole('button', { name: /Physics/ })
    // The hamburger is media-query gated (hidden on desktop), so target it by
    // class — jsdom leaves the base display:none in force.
    fireEvent.click(container.querySelector('.ss-menu-btn'))
    const sidebar = container.querySelector('.ss-sidebar')
    expect(sidebar.classList.contains('is-open')).toBe(true)
    expect(container.querySelector('.ss-backdrop')).toBeTruthy()
    // Picking a subject from the panel closes it and opens the subject view.
    fireEvent.click(sidebar.querySelector('.ss-nav-item'))
    expect(sidebar.classList.contains('is-open')).toBe(false)
    expect(container.querySelector('.ss-backdrop')).toBeNull()
  })
})
