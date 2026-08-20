/**
 * Behaviour tests for the Games Seed Importer.
 *
 * The rules themselves are node-tested in `lib/gamesSeedAdminCore.test.js`.
 * What can only be checked with a DOM is here, and the first two are the
 * reason this file exists:
 *
 *   • "Clear selection" unchecks boxes and reaches NO Firestore call. The
 *     old button said "Clear" on a screen with no destructive action; the
 *     moment permanent deletion sits beside it, the misreading is
 *     catastrophic, so the separation is asserted rather than assumed.
 *   • Nothing is deleted without a confirmation, and cancelling deletes
 *     nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  listAllGamesForAdmin: vi.fn(),
  listGameTombstonesForAdmin: vi.fn(),
  importSeedGame: vi.fn(),
  deleteGameForever: vi.fn(),
  setGameActive: vi.fn(),
  seed: [
    { id: 'math_a_g4', title: 'Fraction Match', subject: 'mathematics', grade: 4, type: 'timed_quiz' },
    { id: 'eng_b_g4', title: 'Punctuation Pro', subject: 'english', grade: 4, type: 'punctuation' },
    { id: 'sci_c_g5', title: 'Digestive System Quest', subject: 'science', grade: 5, type: 'timed_quiz' },
    { id: 'math_d_g6', title: 'Percent Power', subject: 'mathematics', grade: 6, type: 'timed_quiz' },
    { id: 'eng_e_g6', title: 'Grammar Gym', subject: 'english', grade: 6, type: 'timed_quiz' },
    { id: 'sci_f_g6', title: 'Solar System Safari', subject: 'science', grade: 6, type: 'timed_quiz' },
  ],
}))

// Fully replaced: the real service imports the Firebase client, which
// cannot initialise in jsdom.
vi.mock('../services/gamesService', () => ({
  listAllGamesForAdmin: mocks.listAllGamesForAdmin,
  listGameTombstonesForAdmin: mocks.listGameTombstonesForAdmin,
  importSeedGame: mocks.importSeedGame,
  deleteGameForever: mocks.deleteGameForever,
  setGameActive: mocks.setGameActive,
}))
vi.mock('../../../data/gamesSeed', () => ({ GAMES_SEED: mocks.seed }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const { default: GamesSeedAdmin } = await import('./GamesSeedAdmin.jsx')

function renderPage() {
  return render(<MemoryRouter><GamesSeedAdmin /></MemoryRouter>)
}

/** Wait for the initial collection read to land. */
async function ready() {
  await waitFor(() => expect(screen.getByLabelText('Fraction Match')).toBeInTheDocument())
}

function row(title) {
  return screen.getByLabelText(title).closest('li')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listAllGamesForAdmin.mockResolvedValue({
    math_a_g4: { id: 'math_a_g4', title: 'Fraction Match', active: true, grade: 4, subject: 'mathematics', type: 'timed_quiz' },
    eng_b_g4: { id: 'eng_b_g4', title: 'Punctuation Pro', active: false, grade: 4, subject: 'english', type: 'punctuation' },
  })
  mocks.listGameTombstonesForAdmin.mockResolvedValue({})
  mocks.importSeedGame.mockResolvedValue({ outcome: 'ok' })
  mocks.deleteGameForever.mockResolvedValue({ outcome: 'ok' })
  mocks.setGameActive.mockResolvedValue({ outcome: 'ok' })
})

describe('statuses', () => {
  it('tells Live, Inactive and Not imported apart', async () => {
    renderPage()
    await ready()
    // The old screen printed "Live in Firestore" for a deactivated game
    // too — the status lying about the one thing an admin came to check.
    expect(within(row('Fraction Match')).getByText('Live')).toBeInTheDocument()
    expect(within(row('Punctuation Pro')).getByText('Inactive')).toBeInTheDocument()
    expect(within(row('Digestive System Quest')).getByText('Not imported')).toBeInTheDocument()
  })

  it('refuses to guess when the collection cannot be read', async () => {
    mocks.listAllGamesForAdmin.mockRejectedValue(new Error('permission-denied'))
    renderPage()
    await waitFor(() => expect(screen.getByText(/Could not read the live games collection/)).toBeInTheDocument())
    // Not "Not imported" — that would put 47 games one click from being
    // written over 47 live ones.
    expect(within(row('Fraction Match')).getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import selected/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete selected/ })).toBeDisabled()
  })
})

describe('selection', () => {
  it('counts immediately and Clear selection unselects without deleting', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    expect(screen.getByTestId('selection-count')).toHaveTextContent('0 of 6 games selected')
    await user.click(screen.getByLabelText('Fraction Match'))
    await user.click(screen.getByLabelText('Punctuation Pro'))
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 of 6 games selected')

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByTestId('selection-count')).toHaveTextContent('0 of 6 games selected')
    expect(screen.getByLabelText('Fraction Match')).not.toBeChecked()

    // The whole point: this button is not a data operation.
    expect(mocks.deleteGameForever).not.toHaveBeenCalled()
    expect(mocks.setGameActive).not.toHaveBeenCalled()
    expect(mocks.importSeedGame).not.toHaveBeenCalled()
  })

  it('Select missing picks only seed games with no Firestore record', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Select missing' }))
    expect(screen.getByLabelText('Digestive System Quest')).toBeChecked()
    expect(screen.getByLabelText('Fraction Match')).not.toBeChecked()
    // An inactive game is not "missing" — importing over it would silently
    // re-activate it.
    expect(screen.getByLabelText('Punctuation Pro')).not.toBeChecked()
  })

  it('select-all covers the rows on screen and says how many that is', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.type(screen.getByLabelText('Search games'), 'match')
    expect(screen.getByLabelText(/Select all 1 shown/)).toBeInTheDocument()
    await user.click(screen.getByLabelText(/Select all 1 shown/))
    expect(screen.getByTestId('selection-count')).toHaveTextContent('1 of 6 games selected')
  })

  it('warns when a selected game is hidden by the filters', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Fraction Match'))
    await user.type(screen.getByLabelText('Search games'), 'digestive')
    // The row is gone but the selection is not, and Delete selected would
    // still act on it — so the screen says so.
    expect(screen.getByText(/1 selected game is hidden by the filters/)).toBeInTheDocument()
  })
})

describe('filters and search', () => {
  it('narrows by status and by title', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Inactive' }))
    expect(screen.getByLabelText('Punctuation Pro')).toBeInTheDocument()
    expect(screen.queryByLabelText('Fraction Match')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    await user.type(screen.getByLabelText('Search games'), 'Punctuation Pro')
    expect(screen.getByLabelText('Punctuation Pro')).toBeInTheDocument()
    expect(screen.queryByLabelText('Digestive System Quest')).not.toBeInTheDocument()
  })
})

describe('import', () => {
  it('imports only the not-imported half of a mixed selection, and says so', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Fraction Match'))          // live
    await user.click(screen.getByLabelText('Digestive System Quest'))  // not imported

    expect(screen.getByText(/Mixed selection/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Import selected \(1\)/ }))

    await waitFor(() => expect(mocks.importSeedGame).toHaveBeenCalledTimes(1))
    // Never the live one — an action must not silently act on half a
    // selection in the wrong direction.
    expect(mocks.importSeedGame).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sci_c_g5' }),
    )
  })

  it('reports already-existed separately from failed', async () => {
    const user = userEvent.setup()
    // The game went live in another tab after this page loaded: the
    // transaction inside the service finds it and skips.
    mocks.importSeedGame.mockResolvedValue({ id: 'sci_c_g5', outcome: 'skipped', reason: 'already_exists' })
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Digestive System Quest'))
    await user.click(screen.getByRole('button', { name: /Import selected \(1\)/ }))

    const result = await screen.findByTestId('bulk-result')
    // "0 imported" alone would read as a failure; "0 failed" is what says
    // the run was fine and there was simply nothing to do.
    expect(within(result).getByText('0 imported')).toBeInTheDocument()
    expect(within(result).getByText(/1 already existed/)).toBeInTheDocument()
    expect(within(result).getByText('0 failed')).toBeInTheDocument()
  })

  it('surfaces a failure with its reason instead of a silent no-op', async () => {
    const user = userEvent.setup()
    mocks.importSeedGame.mockResolvedValue({ id: 'sci_c_g5', outcome: 'failed', reason: 'permission-denied' })
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Digestive System Quest'))
    await user.click(screen.getByRole('button', { name: /Import selected \(1\)/ }))

    const result = await screen.findByTestId('bulk-result')
    expect(within(result).getByText('1 failed')).toBeInTheDocument()
    expect(within(result).getByText('permission-denied')).toBeInTheDocument()
  })
})

describe('permanent deletion', () => {
  it('confirms first, and cancelling deletes nothing', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Fraction Match'))
    await user.click(screen.getByRole('button', { name: /Delete selected \(1\)/ }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Delete 1 game permanently?')).toBeInTheDocument()
    expect(mocks.deleteGameForever).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.deleteGameForever).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deletes on confirm and reports the outcome', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Fraction Match'))
    await user.click(screen.getByRole('button', { name: /Delete selected/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(mocks.deleteGameForever).toHaveBeenCalledWith(
      'math_a_g4', expect.objectContaining({ title: 'Fraction Match' }),
    ))
    const result = await screen.findByTestId('bulk-result')
    expect(within(result).getByText('Deletion complete')).toBeInTheDocument()
    expect(within(result).getByText('1 deleted')).toBeInTheDocument()
  })

  it('deletes an inactive game without making the admin re-activate it first', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Punctuation Pro'))
    await user.click(screen.getByRole('button', { name: /Delete selected \(1\)/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(mocks.deleteGameForever).toHaveBeenCalledWith('eng_b_g4', expect.anything()))
  })

  it('a game already deleted elsewhere is reported, not treated as an error', async () => {
    const user = userEvent.setup()
    mocks.deleteGameForever.mockResolvedValue({ id: 'math_a_g4', outcome: 'skipped', reason: 'already_missing' })
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Fraction Match'))
    await user.click(screen.getByRole('button', { name: /Delete selected/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete permanently' }))

    const result = await screen.findByTestId('bulk-result')
    expect(within(result).getByText('1 already missing')).toBeInTheDocument()
    expect(within(result).getByText('0 failed')).toBeInTheDocument()
  })

  it('requires a typed DELETE for a large batch', async () => {
    const user = userEvent.setup()
    // Six live games: past the threshold where a big deletion is more
    // likely to be a stale Select all than a decision.
    mocks.listAllGamesForAdmin.mockResolvedValue(Object.fromEntries(
      mocks.seed.map((g) => [g.id, { ...g, active: true }]),
    ))
    renderPage()
    await ready()

    await user.click(screen.getByLabelText(/Select all 6 shown/))
    await user.click(screen.getByRole('button', { name: /Delete selected \(6\)/ }))

    const confirmBtn = await screen.findByRole('button', { name: 'Delete permanently' })
    expect(confirmBtn).toBeDisabled()
    await user.click(confirmBtn)
    expect(mocks.deleteGameForever).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(mocks.deleteGameForever).toHaveBeenCalledTimes(6))
  })

  it('names the games in the confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByLabelText('Fraction Match'))
    await user.click(screen.getByRole('button', { name: /Delete selected/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Fraction Match')).toBeInTheDocument()
    // The dialog states what deletion does NOT touch, because that is the
    // question an admin is actually weighing.
    expect(within(dialog).getByText(/Learner scores, badges and history are kept/)).toBeInTheDocument()
  })
})

describe('a deleted game leaves the list', () => {
  // The bug this whole block exists for: an admin deleted a game, went
  // back to the list, and found it still there reading "Not imported".
  // True of the seed entry, and a straight contradiction of what they had
  // just done.
  beforeEach(() => {
    mocks.listAllGamesForAdmin.mockResolvedValue({
      math_a_g4: { id: 'math_a_g4', title: 'Fraction Match', active: true, grade: 4, subject: 'mathematics', type: 'timed_quiz' },
    })
    mocks.listGameTombstonesForAdmin.mockResolvedValue({
      eng_b_g4: { gameId: 'eng_b_g4', gameTitle: 'Punctuation Pro', gameType: 'punctuation', grade: 4, subject: 'english' },
    })
  })

  it('is gone from the default list', async () => {
    renderPage()
    await ready()
    expect(screen.queryByLabelText('Punctuation Pro')).not.toBeInTheDocument()
    // and it is not being counted as part of the catalogue any more
    expect(screen.getByTestId('selection-count')).toHaveTextContent('0 of 5 games selected')
    expect(screen.getByText(/1 deleted/)).toBeInTheDocument()
  })

  it('is not offered for import, by button or by Select missing', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Select missing' }))
    // Four never-imported games; the deleted one is not among them.
    expect(screen.queryByLabelText('Punctuation Pro')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Import selected/ }))
    await waitFor(() => expect(mocks.importSeedGame).toHaveBeenCalled())
    const importedIds = mocks.importSeedGame.mock.calls.map(([g]) => g.id)
    expect(importedIds).not.toContain('eng_b_g4')
  })

  it('is findable and restorable on the Deleted tab', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Deleted' }))
    const row = screen.getByLabelText('Punctuation Pro')
    expect(row).toBeInTheDocument()
    expect(within(row.closest('li')).getByText('Deleted')).toBeInTheDocument()

    // Restore is the same write as import, under the name of what it does.
    await user.click(screen.getByRole('button', { name: 'Actions for Punctuation Pro' }))
    expect(screen.queryByRole('menuitem', { name: /Delete permanently/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /Restore this game/ }))
    await waitFor(() => expect(mocks.importSeedGame).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'eng_b_g4' }),
    ))
  })

  it('restores in bulk from the Deleted tab', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Deleted' }))
    await user.click(screen.getByLabelText('Punctuation Pro'))
    await user.click(screen.getByRole('button', { name: /Restore selected \(1\)/ }))
    await waitFor(() => expect(mocks.importSeedGame).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'eng_b_g4' }),
    ))
  })

  it('a live document outranks a stale tombstone', async () => {
    // Re-importing clears the tombstone in the same transaction, but if
    // that read were stale the games collection is the honest answer —
    // otherwise a restored game reads Deleted while learners can play it.
    mocks.listGameTombstonesForAdmin.mockResolvedValue({
      math_a_g4: { gameId: 'math_a_g4', gameTitle: 'Fraction Match' },
    })
    renderPage()
    await ready()
    expect(within(row('Fraction Match')).getByText('Live')).toBeInTheDocument()
  })
})

describe('per-row actions', () => {
  it('offers Deactivate for a live game and Delete permanently for both', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Actions for Fraction Match' }))
    expect(screen.getByRole('menuitem', { name: /Deactivate/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Delete permanently/ })).toBeInTheDocument()
    // Deactivate and delete are different actions and stay different.
    await user.click(screen.getByRole('menuitem', { name: /Deactivate/ }))
    await waitFor(() => expect(mocks.setGameActive).toHaveBeenCalledWith('math_a_g4', false))
    expect(mocks.deleteGameForever).not.toHaveBeenCalled()
  })

  it('a single-row delete still confirms', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Actions for Punctuation Pro' }))
    await user.click(screen.getByRole('menuitem', { name: /Delete permanently/ }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(mocks.deleteGameForever).not.toHaveBeenCalled()
  })

  it('a not-imported game offers Import and no destructive action', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Actions for Digestive System Quest' }))
    expect(screen.getByRole('menuitem', { name: /Import this game/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Delete permanently/ })).not.toBeInTheDocument()
  })
})
