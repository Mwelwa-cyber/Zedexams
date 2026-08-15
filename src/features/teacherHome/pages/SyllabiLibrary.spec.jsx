import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import SyllabiLibrary from './SyllabiLibrary.jsx'

// The studio loads the merged curriculum JSON via the KB service — feed it a
// tiny fixture so the reading-first behaviours (subject panel, full screen
// reading mode, column width hints) can be exercised without the ~1.3MB file.
vi.mock('../../../utils/syllabusKbService', () => ({
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
    vi.unstubAllGlobals()
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

  it('renders even a SINGLE learning activity as a bullet (matches the source syllabus)', async () => {
    const { container } = await openPhysics()
    // Form 1 has two activities → bulleted list (baseline).
    const form1Items = container.querySelectorAll('.ss-activities-cell li')
    expect(form1Items.length).toBe(2)
    // Switch to Form 2, whose subtopic has ONE activity ("• Demonstrating
    // friction"). It must still render inside a bulleted <li>, not as plain
    // text — otherwise single-activity cells look bullet-less next to
    // multi-activity ones.
    fireEvent.click(screen.getByRole('tab', { name: 'Form 2' }))
    const cell = container.querySelector('.ss-activities-cell')
    expect(cell.querySelector('li')).toHaveTextContent('Demonstrating friction')
  })

  it('era switcher in the slide-out panel switches to the 2013 curriculum and closes the panel', async () => {
    // Stub fetch so the lazy 2013 data load resolves immediately rather than
    // leaving async state updates pending after the synchronous assertion.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))

    const { container } = renderStudio()
    await screen.findAllByRole('button', { name: /Physics/ })

    // Open the subject slide-out panel.
    fireEvent.click(container.querySelector('.ss-menu-btn'))
    const sidebar = container.querySelector('.ss-sidebar')
    expect(sidebar.classList.contains('is-open')).toBe(true)

    // The panel-era-switch control must be present inside the open slide-out.
    const eraBtns = [...sidebar.querySelectorAll('.ss-panel-era-btn')]
    expect(eraBtns).toHaveLength(2)
    const legacyBtn = eraBtns.find((b) => /2013/.test(b.textContent))
    expect(legacyBtn).toBeTruthy()

    // Clicking '2013' switches the era and closes the panel (switchEra calls
    // setSubjectPanelOpen(false) so the slide-out collapses).
    fireEvent.click(legacyBtn)
    const root = container.querySelector('.ss-root')
    expect(root.getAttribute('data-era')).toBe('legacy')
    expect(sidebar.classList.contains('is-open')).toBe(false)
  })

  it('fills the viewport from its measured page offset rather than a fixed guess', async () => {
    // The studio's height is `100dvh - var(--ss-vh-offset)`, and the offset is
    // how far down the page it starts. Hard-coding it (it used to be 160px)
    // either overshoots the fold or leaves a dead strip at the bottom, so the
    // value has to come from the element's own position — 200px down here.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 200, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 200,
      toJSON: () => ({}),
    })
    try {
      const { container } = renderStudio()
      await screen.findAllByRole('button', { name: /Physics/ })
      expect(container.querySelector('.ss-root').style.getPropertyValue('--ss-vh-offset'))
        .toBe('208px')
    } finally {
      rect.mockRestore()
    }
  })
})
