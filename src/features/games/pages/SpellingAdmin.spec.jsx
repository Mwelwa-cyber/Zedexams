/**
 * The admin content workflow: author → validate → approve → serve.
 *
 * The one property every test here circles is that a machine check is a FLOOR
 * a human approval sits on, not a step the approval replaces. A record that
 * fails validation cannot be saved, cannot be approved, and is not served even
 * if it somehow carries `approved: true`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../lib/spellingSpeech', () => ({ speakWord: vi.fn(), speakChunk: vi.fn(), stopSpeech: vi.fn(), speechAvailable: () => false }))

const saved = []
const approvals = []
vi.mock('../services/spellingContentService', () => ({
  listWordsForAdmin: vi.fn(async () => rows),
  saveWord: vi.fn(async (record) => { saved.push(record); return 'id-1' }),
  setApproval: vi.fn(async (id, opts) => { approvals.push({ id, ...opts }) }),
  setWordActive: vi.fn(async () => {}),
  deleteWord: vi.fn(async () => {}),
  importWords: vi.fn(async () => ({ imported: 2, skipped: 1, rejected: [{ word: 'colour', problems: ['bad'] }], total: 4 })),
}))

import SpellingAdmin from './SpellingAdmin'
import { saveWord, setApproval } from '../services/spellingContentService'

/** The bundled bank's real band ids, so band validation is genuine. */
const GOOD = {
  id: 'g7_neighbour', word: 'neighbour', grade: 7, band: 'silent', difficulty: 'medium',
  contextSentence: 'Our ___ helped us carry the water.', audio: '',
  chunks: ['neigh', 'bour'], trap: 1, strategy: 'trap', hook: '', hookNote: '',
  why: 'The -eigh- is the bit people miss.', relatedWords: [],
  status: 'pending', approved: false, active: true, source: '',
}
const BROKEN = {
  ...GOOD,
  id: 'g7_broken', word: 'separate', band: 'silent',
  contextSentence: 'Please ___ the beans.',
  // The chunks rebuild "seperate" — a cut that teaches a misspelling.
  chunks: ['sep', 'e', 'rate'], trap: 1,
}

let rows = []
beforeEach(() => { rows = [GOOD, BROKEN]; saved.length = 0; approvals.length = 0; vi.clearAllMocks() })

const renderAdmin = () => render(<MemoryRouter><SpellingAdmin /></MemoryRouter>)

describe('Spelling admin', () => {
  it('lists every word with its review state and flags the broken one', async () => {
    renderAdmin()
    expect(await screen.findByText('neighbour')).toBeInTheDocument()
    expect(screen.getByText('separate')).toBeInTheDocument()
    // The problem is named on the row, not hidden behind an edit click.
    expect(screen.getByText(/rebuild/)).toBeInTheDocument()
    expect(screen.getByText(/1 problem/)).toBeInTheDocument()
  })

  it('refuses to approve a record that fails a machine check', async () => {
    renderAdmin()
    await screen.findByText('separate')
    const rowsEl = [...document.querySelectorAll('.lhx-sp-admin-row')]
    const broken = rowsEl.find((el) => el.textContent.includes('separate'))
    const approve = [...broken.querySelectorAll('button')].find((b) => b.textContent === 'Approve')
    // Disabled, with the reason on the control rather than only in a toast
    // after the click — a reviewer has to know before they try.
    expect(approve).toBeDisabled()
    expect(approve.getAttribute('title')).toMatch(/Fix the problems/)
    expect(setApproval).not.toHaveBeenCalled()
  })

  it('approves a clean record, and approval is the one act that sets it', async () => {
    renderAdmin()
    await screen.findByText('neighbour')
    const rowsEl = [...document.querySelectorAll('.lhx-sp-admin-row')]
    const good = rowsEl.find((el) => el.textContent.includes('neighbour'))
    const approve = [...good.querySelectorAll('button')].find((b) => b.textContent === 'Approve')
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    await waitFor(() => expect(setApproval).toHaveBeenCalled())
    expect(setApproval.mock.calls[0][1].approved).toBe(true)
  })

  it('the editor blocks a save while anything is wrong, and says what', async () => {
    renderAdmin()
    await screen.findByText('separate')
    const rowsEl = [...document.querySelectorAll('.lhx-sp-admin-row')]
    const broken = rowsEl.find((el) => el.textContent.includes('separate'))
    fireEvent.click([...broken.querySelectorAll('button')].find((b) => b.textContent === 'Edit'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Fix these before saving')
    // The one automatable check, shown live beside the field.
    expect(dialog).toHaveTextContent('rebuilds "seperate", not "separate"')
    const save = [...dialog.querySelectorAll('button')].find((b) => /problem/.test(b.textContent))
    expect(save).toBeDisabled()
    expect(saveWord).not.toHaveBeenCalled()
  })

  it('fixing the cut clears the block and the save goes through', async () => {
    renderAdmin()
    await screen.findByText('separate')
    const rowsEl = [...document.querySelectorAll('.lhx-sp-admin-row')]
    const broken = rowsEl.find((el) => el.textContent.includes('separate'))
    fireEvent.click([...broken.querySelectorAll('button')].find((b) => b.textContent === 'Edit'))

    const dialog = await screen.findByRole('dialog')
    const chunks = dialog.querySelector('input[placeholder="sep | a | rate"]')
    fireEvent.change(chunks, { target: { value: 'sep | a | rate' } })

    expect(dialog).toHaveTextContent('✓ rebuilds "separate"')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(saveWord).toHaveBeenCalled())
    expect(saveWord.mock.calls[0][0].chunks).toEqual(['sep', 'a', 'rate'])
  })

  it('a sentence printing its own answer is refused', async () => {
    renderAdmin()
    await screen.findByText('neighbour')
    const rowsEl = [...document.querySelectorAll('.lhx-sp-admin-row')]
    const good = rowsEl.find((el) => el.textContent.includes('neighbour'))
    fireEvent.click([...good.querySelectorAll('button')].find((b) => b.textContent === 'Edit'))

    const dialog = await screen.findByRole('dialog')
    const sentence = dialog.querySelector('textarea')
    fireEvent.change(sentence, { target: { value: 'Our neighbour helped ___ us.' } })
    expect(dialog).toHaveTextContent(/prints "neighbour"/)
  })

  it('an American spelling is refused', async () => {
    renderAdmin()
    await screen.findByText('neighbour')
    const rowsEl = [...document.querySelectorAll('.lhx-sp-admin-row')]
    const good = rowsEl.find((el) => el.textContent.includes('neighbour'))
    fireEvent.click([...good.querySelectorAll('button')].find((b) => b.textContent === 'Edit'))

    const dialog = await screen.findByRole('dialog')
    const sentence = dialog.querySelector('textarea')
    fireEvent.change(sentence, { target: { value: 'The ___ liked the color grey.' } })
    expect(dialog).toHaveTextContent(/American form/)
    expect(dialog).toHaveTextContent(/colour/)
  })

  it('the preview shows the real coach a learner would get', async () => {
    renderAdmin()
    await screen.findByText('neighbour')
    const rowsEl = [...document.querySelectorAll('.lhx-sp-admin-row')]
    const good = rowsEl.find((el) => el.textContent.includes('neighbour'))
    fireEvent.click([...good.querySelectorAll('button')].find((b) => b.textContent === 'Preview'))

    const dialog = await screen.findByRole('dialog')
    // The real component, not a mock-up of it — previewing an approximation is
    // not previewing.
    expect(dialog).toHaveTextContent("Let's fix this one")
    expect(dialog.querySelector('.lhx-sp-chunk')).toBeTruthy()
    // And the sentence both ways round, so the reviewer can judge both.
    expect(dialog).toHaveTextContent('Our neighbour helped us carry the water.')
  })

  it('a bulk import names the rows it refused rather than dropping them quietly', async () => {
    renderAdmin()
    await screen.findByText('neighbour')
    fireEvent.click(screen.getByRole('button', { name: /Import the bundled bank/ }))
    expect(await screen.findByText(/2 imported/)).toBeInTheDocument()
    expect(screen.getByText(/1 refused/)).toBeInTheDocument()
    expect(screen.getByText(/colour: bad/)).toBeInTheDocument()
  })

  it('a failed read is reported as a failure, never as an empty bank', async () => {
    const { listWordsForAdmin } = await import('../services/spellingContentService')
    listWordsForAdmin.mockRejectedValueOnce(new Error('offline'))
    renderAdmin()
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    // The critical part: it must NOT say "no words stored", which would put a
    // whole-bank import one click away from a bank that already has 879.
    expect(screen.queryByText(/No spelling words stored/)).toBeNull()
  })
})
