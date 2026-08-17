/**
 * Help & Support — what needs pinning is the promises: the FAQ search
 * actually narrows, every answer describes the real product (no XP, no
 * offline packs), Childline 116 is a real tel: link, and the rate-us
 * button exists only where a Play listing is guaranteed (the Android
 * build).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: {} }),
}))
vi.mock('../../marketing', () => ({
  ContactDialog: ({ open }) => (open ? <div data-testid="contact-dialog" /> : null),
}))

let mockNative
vi.mock('../../../utils/runtime', () => ({
  isNativePlatform: () => mockNative,
}))

import HelpPanel, { FAQS, filterFaqs } from './HelpPanel'

const section = { id: 'help', label: 'Help & Support' }

function mount() {
  return render(
    <MemoryRouter>
      <HelpPanel section={section} />
    </MemoryRouter>,
  )
}

beforeEach(() => { mockNative = false })

describe('filterFaqs', () => {
  it('AND-matches tokens over question and answer, case-insensitively', () => {
    expect(filterFaqs('streak')).toHaveLength(1)
    expect(filterFaqs('GRADE exams')).toHaveLength(1)
    expect(filterFaqs('')).toHaveLength(FAQS.length)
    expect(filterFaqs('zzzz')).toHaveLength(0)
  })
})

describe('HelpPanel', () => {
  it('searching narrows the FAQ list and clearing restores it', () => {
    mount()
    expect(screen.getAllByRole('group')).toHaveLength(FAQS.length)
    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'streak' } })
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.getByText('How do points and streaks work?')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: '' } })
    expect(screen.getAllByRole('group')).toHaveLength(FAQS.length)
  })

  it('offers support instead of a dead end when nothing matches', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'zzzz' } })
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.getByText(/message support below/)).toBeInTheDocument()
  })

  it('never claims features the app does not have', () => {
    // The prototype's answers mention XP and downloadable offline packs;
    // neither exists in this build, so neither may be promised here.
    mount()
    expect(screen.queryByText(/XP/)).toBeNull()
    expect(screen.queryByText(/download/i)).toBeNull()
  })

  it('links Childline Zambia as a real tel: call', () => {
    mount()
    const row = screen.getByRole('link', { name: /Childline Zambia/ })
    expect(row).toHaveAttribute('href', 'tel:116')
  })

  it('shows the Play Store rate-us row on the Android build only', () => {
    mount()
    expect(screen.queryByText(/Rate us on Google Play/)).toBeNull()
  })

  it('…and shows it on native, pointing at the real listing', () => {
    mockNative = true
    mount()
    const row = screen.getByRole('link', { name: /Rate us on Google Play/ })
    expect(row).toHaveAttribute('href', expect.stringContaining('com.zedexams.android'))
  })

  it('opens the contact dialog from Message support', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Message support/ }))
    expect(screen.getByTestId('contact-dialog')).toBeInTheDocument()
  })
})
