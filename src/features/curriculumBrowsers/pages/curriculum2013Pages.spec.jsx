import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Curriculum2013Home from './Curriculum2013Home.jsx'
import ECE2013Curriculum from './ECE2013Curriculum.jsx'
import Primary2013Curriculum from './Primary2013Curriculum.jsx'
import Secondary2013Curriculum from './Secondary2013Curriculum.jsx'

// Render smoke tests for the four 2013 curriculum reference pages. They are
// presentational (no Firebase), so mounting them in a Router with SeoHelmet
// stubbed exercises the real component tree — catching runtime errors (bad
// map, undefined prop, missing icon) that a build alone would not.
vi.mock('../../../components/seo/SeoHelmet', () => ({ default: () => null }))

function renderPage(ui, path) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

describe('2013 curriculum reference pages', () => {
  it('renders the hub with links to each level', () => {
    renderPage(<Curriculum2013Home />, '/teacher/curriculum/2013')
    expect(screen.getByRole('heading', { name: /Zambia Curriculum Framework 2013/i })).toBeInTheDocument()
    // Level cards link to the three per-level pages.
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/teacher/curriculum/2013/ece')
    expect(hrefs).toContain('/teacher/curriculum/2013/primary')
    expect(hrefs).toContain('/teacher/curriculum/2013/secondary')
    // Switcher back to the current curriculum exists.
    expect(hrefs).toContain('/teacher/curriculum')
  })

  it('renders the ECE page with the three stages', () => {
    renderPage(<ECE2013Curriculum />, '/teacher/curriculum/2013/ece')
    expect(screen.getByRole('heading', { name: /Early Childhood Care/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Day-Care/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Reception$/ })).toBeInTheDocument()
  })

  it('renders the Primary page with both bands and totals', () => {
    renderPage(<Primary2013Curriculum />, '/teacher/curriculum/2013/primary')
    expect(screen.getByRole('heading', { name: /Zambia Primary Curriculum \(2013\)/i })).toBeInTheDocument()
    // The two official timetables render on the default "All" tab (targeting the
    // table titles specifically, not the same-named filter tabs).
    expect(screen.getByText(/Timetable — Lower Primary/i)).toBeInTheDocument()
    expect(screen.getByText(/Timetable — Upper Primary/i)).toBeInTheDocument()
  })

  it('renders the Secondary page with both career pathways', () => {
    renderPage(<Secondary2013Curriculum />, '/teacher/curriculum/2013/secondary')
    expect(screen.getByRole('heading', { name: /Zambia Secondary Curriculum \(2013\)/i })).toBeInTheDocument()
    // The three Senior-Secondary academic-option headings render.
    expect(screen.getByRole('heading', { name: 'Academic Pathway — 3 Options' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Natural Sciences' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Social Sciences' })).toBeInTheDocument()
    // The five-option Vocational pathway section renders.
    expect(screen.getByRole('heading', { name: /Vocational Career Pathway — 5 Options/i })).toBeInTheDocument()
  })
})
