/**
 * ClassTimetableView — the printable document, on screen.
 *
 * What these tests pin is that the PREVIEW is the document that downloads:
 * it resolves its template through the same `resolvePrintSettings` the PDF,
 * Word and Excel exports use, so a teacher cannot approve one page and hand
 * out another. The Ministry format's identity — header, official title, days
 * down the left, vertically spelled BREAK, the abbreviation key, signature
 * lines and stamp space — is the part a head of school actually signs.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ClassTimetableView from './ClassTimetableView'
import {
  buildPeriods,
  buildTimetableArtifact,
  autoFillBlocks,
  curriculumSubjectsForGrade,
  withLanguageName,
  getSchoolDayTemplate,
  DEFAULT_DAYS,
  DEFAULT_DISPLAY_PREFERENCES,
} from '../../../shared/utils/classTimetable'

const HEADER = {
  school: 'Dudzai Primary School',
  grade: 'G4',
  className: 'Grade 4 A',
  term: 2,
  year: '2026',
  teacherName: 'Mrs Banda',
}

function artifact(displayPreferences = {}, { languageName = '' } = {}) {
  const timing = getSchoolDayTemplate('government-afternoon-session').timing
  const periods = buildPeriods(timing)
  const subjects = withLanguageName(curriculumSubjectsForGrade('G4'), languageName)
  const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods, timing })
  return buildTimetableArtifact({
    header: HEADER,
    days: DEFAULT_DAYS,
    periods,
    blocks,
    timing,
    languageName,
    displayPreferences: { ...DEFAULT_DISPLAY_PREFERENCES, ...displayPreferences },
    curriculumId: 'cbc-2023',
    selectedOptions: { practical: 'expressive-arts' },
    subjectAllocations: subjects,
  })
}

describe('ClassTimetableView — the Ministry format', () => {
  const government = { printTemplate: 'government', cellText: 'abbrev' }

  it('prints the MINISTRY OF EDUCATION line, the school and the official title', () => {
    render(<ClassTimetableView timetable={artifact(government)} />)
    expect(screen.getByText('MINISTRY OF EDUCATION')).toBeInTheDocument()
    expect(screen.getByText('Dudzai Primary School')).toBeInTheDocument()
    // Grade in words AND numeral, then the stream — the reference document's
    // own title format.
    expect(screen.getByText('GRADE FOUR (4) A TIME TABLE')).toBeInTheDocument()
  })

  it('drops the Ministry line when the school turns it off, keeping everything else', () => {
    render(<ClassTimetableView timetable={artifact({ ...government, showMinistryHeader: false })} />)
    expect(screen.queryByText('MINISTRY OF EDUCATION')).not.toBeInTheDocument()
    expect(screen.getByText('GRADE FOUR (4) A TIME TABLE')).toBeInTheDocument()
  })

  it('puts days down the left whatever the on-screen orientation says', () => {
    render(<ClassTimetableView timetable={artifact({ ...government, printLayout: 'days-as-columns' })} />)
    // A days-left grid has a DAY corner cell and one row per teaching day.
    expect(screen.getByText('DAY')).toBeInTheDocument()
    expect(screen.getByText('Monday')).toBeInTheDocument()
  })

  it('spells BREAK one letter per day-row down its own column', () => {
    const { container } = render(<ClassTimetableView timetable={artifact(government)} />)
    const cells = [...container.querySelectorAll('tbody tr')].map((row) => {
      // The band column sits between the lesson columns; its cells hold a
      // single letter rather than the whole word.
      const single = [...row.querySelectorAll('td')].map((td) => td.textContent.trim())
        .filter((t) => /^[A-Z]$/.test(t))
      return single[0] || ''
    })
    expect(cells.join('')).toBe('BREAK')
  })

  it('prints the abbreviation key naming only the codes on the grid', () => {
    render(<ClassTimetableView timetable={artifact(government)} />)
    const key = screen.getByText(/^KEY:/).parentElement
    expect(key.textContent).toContain('ENG = English Language')
    expect(key.textContent).toContain('MATHS = Mathematics')
  })

  it('prints signature lines and a clear space for the school stamp', () => {
    render(<ClassTimetableView timetable={artifact(government)} />)
    expect(screen.getByText(/Class teacher: Mrs Banda/)).toBeInTheDocument()
    expect(screen.getByText('Senior teacher / Head')).toBeInTheDocument()
    expect(screen.getByText('School stamp')).toBeInTheDocument()
  })

  it('renders Monday’s ASSEMBLY as a band while the other days teach then', () => {
    const { container } = render(<ClassTimetableView timetable={artifact(government)} />)
    const assembly = [...container.querySelectorAll('td')].filter((td) => td.textContent.trim() === 'ASSEMBLY')
    expect(assembly).toHaveLength(1)
  })

  it('fills no cell with colour — the master has to survive a photocopier', () => {
    const { container } = render(<ClassTimetableView timetable={artifact(government)} />)
    const filled = [...container.querySelectorAll('td')]
      .filter((td) => /rgb\(/.test(td.style.background) && td.style.background !== 'rgb(255, 255, 255)')
    expect(filled).toHaveLength(0)
  })
})

describe('ClassTimetableView — the modern format', () => {
  const modern = { printTemplate: 'modern', printLayout: 'days-as-columns', cellText: 'full' }

  it('keeps the familiar heading and colour-codes the subject cells', () => {
    const { container } = render(<ClassTimetableView timetable={artifact(modern)} />)
    expect(screen.getByText('Class Timetable')).toBeInTheDocument()
    expect(screen.queryByText('MINISTRY OF EDUCATION')).not.toBeInTheDocument()
    const filled = [...container.querySelectorAll('td')].filter((td) => td.style.background)
    expect(filled.length).toBeGreaterThan(0)
  })

  it('prints no key or official footer when nothing is abbreviated', () => {
    render(<ClassTimetableView timetable={artifact(modern)} />)
    expect(screen.queryByText(/^KEY:/)).not.toBeInTheDocument()
    expect(screen.queryByText('School stamp')).not.toBeInTheDocument()
  })

  it('prints the language the school actually teaches', () => {
    render(<ClassTimetableView timetable={artifact(modern, { languageName: 'Chinyanja' })} />)
    expect(screen.getAllByText('Chinyanja').length).toBeGreaterThan(0)
    expect(screen.queryByText('Zambian Language')).not.toBeInTheDocument()
  })
})

describe('ClassTimetableView — nothing saved before this pass changes', () => {
  it('renders a timetable with no template, timing or language exactly as it always did', () => {
    const periods = buildPeriods({ startTime: '07:30', periodMinutes: 40, lessonPeriods: 6, breaks: [] })
    const subjects = curriculumSubjectsForGrade('G4')
    const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods })
    const legacy = {
      schemaVersion: 'class-timetable-2.0',
      header: { grade: 'G4', className: '4A' },
      days: DEFAULT_DAYS,
      periods,
      blocks,
      displayPreferences: { timetableLayout: 'days-as-columns', periodLabelMode: 'period-time' },
    }
    render(<ClassTimetableView timetable={legacy} />)
    expect(screen.getByText('Class Timetable')).toBeInTheDocument()
    expect(screen.queryByText('MINISTRY OF EDUCATION')).not.toBeInTheDocument()
    expect(screen.queryByText('ASSEMBLY')).not.toBeInTheDocument()
  })
})
