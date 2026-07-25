/**
 * Paper preview behaviour: it starts closed (and costs nothing closed), the
 * sheet it renders is the printed page, it follows the day being marked, it
 * picks up marks that are still only in the outbox, and Print sends the FULL
 * document — not the one page on screen.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../../ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const getSchoolProfile = vi.fn(async () => ({ schoolName: 'Jemareen Academy', address: 'Lusaka' }))
vi.mock('../../../../utils/schoolProfileService', () => ({
  getSchoolProfile: (...args) => getSchoolProfile(...args),
}))

const printAttendanceHtml = vi.fn()
vi.mock('../../../../utils/attendanceExportService', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, printAttendanceHtml: (...args) => printAttendanceHtml(...args) }
})

import RegisterPaperPreview from './RegisterPaperPreview'
import { buildOfficialRegisterHtml, buildRegisterExportModel } from '../../../../utils/attendanceExportService'
import { buildTermDays, resolveTermInfo } from '../../../../utils/attendanceCalendarResolver'

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

const TODAY = '2026-06-15'
const termInfo = resolveTermInfo({ term: 'Term 2', year: 2026 })
const days = buildTermDays({ termInfo, todayIso: TODAY })
const roster = [
  { id: 'a', fullName: 'Amos Banda', learnerNumber: 'ADM-1', order: 1, status: 'active' },
  { id: 'b', fullName: 'Bwalya Mwansa', learnerNumber: 'ADM-2', order: 2, status: 'active' },
]
const register = { id: 'c1', className: 'Grade 4 Blue', grade: '4', school: 'Jemareen Academy' }

// `daysWithRecords` is the hook's server + pending overlay — marking a learner
// changes it before anything reaches Firestore.
function hookWith(records = {}) {
  return {
    roster,
    termInfo,
    daysWithRecords: days.map((d) => ({ ...d, records: d.date === TODAY ? records : {} })),
    todayIso: TODAY,
  }
}

function renderPreview(props = {}) {
  return render(
    <RegisterPaperPreview
      registerHook={hookWith()}
      register={register}
      uid="t1"
      teacherName="Mr M. Chisenga"
      policy={undefined}
      focusDate={TODAY}
      {...props}
    />,
  )
}

const sheet = () => document.querySelector('iframe[title="Register paper preview"]')
const srcdoc = () => sheet().getAttribute('srcdoc')

// Opening also kicks off the school-profile read; let it settle inside act().
async function openPreview() {
  fireEvent.click(screen.getByRole('button', { name: /paper preview/i }))
  await act(async () => {})
}

// One learner's cell on the sheet, by the print colour of its status.
const ABSENT_CELL = '<td style="color:#b91c1c">A</td>'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('RegisterPaperPreview', () => {
  it('starts collapsed and does no work until it is opened', async () => {
    renderPreview()
    expect(sheet()).toBeNull()
    expect(getSchoolProfile).not.toHaveBeenCalled()

    await openPreview()
    expect(sheet()).not.toBeNull()
    expect(getSchoolProfile).toHaveBeenCalledWith('t1')
  })

  it('renders the printed page itself, on an A4 landscape sheet', async () => {
    renderPreview()
    await openPreview()
    const html = srcdoc()

    // The sheet's page markup appears verbatim in the document that prints.
    const model = buildRegisterExportModel({
      register, school: null, teacherName: 'Mr M. Chisenga', termInfo,
      daysWithRecords: hookWith().daysWithRecords, roster, printedOn: TODAY,
    })
    const start = html.indexOf('<section class="page">')
    const section = html.slice(start, html.indexOf('</section>') + 10)
    expect(buildOfficialRegisterHtml(model)).toContain(section)

    expect(html).toContain('width: 297mm')
    expect(html).not.toContain('@page')
    expect(screen.getByText(/A4 landscape · page \d+ of \d+/)).toBeInTheDocument()
  })

  it('opens on the month of the day being marked', async () => {
    renderPreview({ focusDate: '2026-05-20' })
    await openPreview()
    expect(srcdoc()).toContain('CLASS REGISTER — May 2026')
  })

  it('shows marks that are still unsaved', async () => {
    const { rerender } = render(
      <RegisterPaperPreview registerHook={hookWith()} register={register} uid="t1"
        teacherName="T" policy={undefined} focusDate={TODAY} />,
    )
    await openPreview()
    // Nobody marked yet: the June sheet carries no absence cell.
    expect(srcdoc()).not.toContain(ABSENT_CELL)

    // The hook hands over a day list with the new mark — nothing is saved yet.
    vi.useFakeTimers()
    try {
      rerender(
        <RegisterPaperPreview registerHook={hookWith({ b: { status: 'absent' } })} register={register}
          uid="t1" teacherName="T" policy={undefined} focusDate={TODAY} />,
      )
      expect(srcdoc()).not.toContain(ABSENT_CELL) // debounced, not dropped
      await act(async () => { vi.advanceTimersByTime(600) })
    } finally {
      vi.useRealTimers()
    }
    expect(srcdoc()).toContain(ABSENT_CELL)
  })

  it('prints the whole document, not just the page on screen', async () => {
    renderPreview()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))

    expect(printAttendanceHtml).toHaveBeenCalledTimes(1)
    const printed = printAttendanceHtml.mock.calls[0][0]
    expect(printed).toContain('@page { size: A4 landscape;')
    // Every month of the term, not the single previewed sheet.
    expect(printed).toContain('CLASS REGISTER — May 2026')
    expect(printed).toContain('CLASS REGISTER — June 2026')
  })

  it('switches document and page at once — only marking is debounced', async () => {
    renderPreview({ focusDate: '2026-05-20' })
    await openPreview()

    fireEvent.change(screen.getByLabelText('Preview page'), { target: { value: '2026-06' } })
    expect(srcdoc()).toContain('CLASS REGISTER — June 2026')

    fireEvent.change(screen.getByLabelText('Preview document'), { target: { value: 'summary' } })
    expect(srcdoc()).toContain('TERM ATTENDANCE SUMMARY')
  })

  it('remembers that it was left open', async () => {
    const { unmount } = renderPreview()
    await openPreview()
    unmount()
    renderPreview()
    expect(sheet()).not.toBeNull()
  })
})
