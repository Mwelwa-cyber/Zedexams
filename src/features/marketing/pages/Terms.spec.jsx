import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import Terms from './Terms'

// Terms is a static legal document. These tests lock in the corrected
// Section 7 ("Intellectual Property") so the page can never regress to
// wording that implies ZedExams owns the national curriculum / ECZ
// materials or is officially endorsed by government bodies.
function renderTerms() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/terms']}>
        <Terms />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('Terms — Section 7 (Intellectual Property)', () => {
  it('renders the Section 7 heading', () => {
    renderTerms()
    expect(
      screen.getByRole('heading', { name: /7\.\s*Intellectual Property/i }),
    ).toBeInTheDocument()
  })

  it('states government / ECZ / third-party materials remain their owners\' property', () => {
    renderTerms()
    expect(
      screen.getByText(/remain the property\s+of their respective owners/i),
    ).toBeInTheDocument()
  })

  it('disclaims official endorsement / accreditation / affiliation', () => {
    renderTerms()
    expect(
      screen.getByText(
        /do not imply official endorsement, accreditation, partnership, sponsorship or affiliation/i,
      ),
    ).toBeInTheDocument()
  })

  it('preserves the teacher classroom-use permission and the resale restriction', () => {
    renderTerms()
    expect(
      screen.getByText(/Teachers may download, print and share materials/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/does not allow the resale, public commercial distribution/i),
    ).toBeInTheDocument()
  })

  it('holds users responsible for the rights to content they upload', () => {
    renderTerms()
    expect(
      screen.getByText(/confirms that they have the necessary rights or lawful permission/i),
    ).toBeInTheDocument()
  })

  it('renders the "users may not" restrictions as a semantic list', () => {
    renderTerms()
    const intro = screen.getByText(/Unless we provide written permission, users may not/i)
    const list = intro.nextElementSibling
    expect(list?.tagName).toBe('UL')
    expect(within(list).getAllByRole('listitem').length).toBe(6)
  })

  it('no longer contains the old over-broad ownership wording', () => {
    const { container } = renderTerms()
    const text = container.textContent
    expect(text).not.toMatch(/curriculum knowledge base we maintain/i)
    expect(text).not.toMatch(/official curriculum content/i)
    expect(text).not.toMatch(/CBC-aligned" lessons and exams/i)
  })
})
