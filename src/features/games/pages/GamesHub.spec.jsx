/**
 * Behaviour tests for the Games hub.
 *
 * The originals (learner redesign step 4) are kept: the daily hero links
 * to the day's game, the level strip reads the kept levelInfo curve from
 * saved history, the badge shelf locks unearned badges, the game rows
 * carry best scores, and a Firestore failure falls back to the seed
 * catalogue instead of freezing the hub.
 *
 * The 2026-08-19 pass adds the ones that would have caught the bug it
 * fixed: BOTH hero cards print the learner's own grade, the daily query
 * is ASKED for that grade, and a grade with no quiz today renders an
 * empty state rather than another grade's quiz. Layout claims (fixed row
 * heights, nothing under the fixed chrome) are not asserted here — jsdom
 * has no layout engine, so they belong in the Chromium harness,
 * `npm run smoke:games-hub`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  listGames: vi.fn(),
  getMyHistory: vi.fn(),
  getTodaysChallenge: vi.fn(),
  getMyStreak: vi.fn(),
  getMyGameBadges: vi.fn(),
  auth: { currentUser: { uid: 'learner-1' }, userProfile: { grade: 4 } },
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => mocks.auth,
}))
// Fully replaced (no importOriginal): the real module imports the Firebase
// client, which cannot initialise in jsdom. GRADES/SUBJECTS are static data,
// restated here in the shape the hub reads.
vi.mock('../services/gamesService', () => ({
  listGames: mocks.listGames,
  getMyHistory: mocks.getMyHistory,
  GRADES: [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: `Grade ${value}` })),
  SUBJECTS: [
    { slug: 'mathematics', label: 'Mathematics' },
    { slug: 'english', label: 'English' },
    { slug: 'science', label: 'Science' },
    { slug: 'social', label: 'Social Studies' },
  ],
}))
vi.mock('../../../utils/dailyChallengeService', () => ({
  getTodaysChallenge: mocks.getTodaysChallenge,
  getMyStreak: mocks.getMyStreak,
}))
vi.mock('../../../utils/gameBadgesService', () => ({
  getMyGameBadges: mocks.getMyGameBadges,
}))
// The deletion list the seed fallback is filtered by. Mocked for the same
// reason as the services above — the real module reaches Firestore — and
// empty here, so the fallback behaviour these tests assert is unchanged.
vi.mock('../../../utils/gameTombstones', () => ({
  loadDeletedGameIds: () => Promise.resolve(new Set()),
  resetDeletedGameCache: () => {},
  isDeletedGame: () => false,
}))
vi.mock('../../../shared/components/learnerTours', () => ({
  GamesHubTour: () => null,
}))
vi.mock('../../../shared/components/SeoHelmet', () => ({
  default: () => null,
}))

import GamesHub from './GamesHub'
import { GAME_BADGES } from '../../../data/gameBadges'

// Deliberately titled with CONTENT names, the way real docs are: the hub
// must name each card for its mechanic, not for the pack behind it.
const GAMES = [
  { id: 'g-path', title: 'Number Target: Master', type: 'number_target', grade: 4, subject: 'mathematics', points: 15 },
  { id: 'g-words', title: 'Spell the Animal', type: 'word_builder', grade: 4, subject: 'english', cbc_topic: 'Spelling', points: 15 },
  { id: 'g-other-grade', title: 'G6 Quiz', type: 'timed_quiz', grade: 6, subject: 'science', points: 15 },
]

function renderHub() {
  return render(
    <MemoryRouter>
      <GamesHub />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.listGames.mockResolvedValue(GAMES)
  mocks.getMyHistory.mockResolvedValue([
    { gameId: 'g-words', score: 80 },
    { gameId: 'g-words', score: 120 },
  ])
  mocks.getTodaysChallenge.mockResolvedValue({ game: GAMES[0], source: 'rotation', dateId: '2026-08-16' })
  mocks.getMyStreak.mockResolvedValue({ streak: 3, longestStreak: 5, signedIn: true })
  mocks.getMyGameBadges.mockResolvedValue({ byId: { 'first-game': { earnedAt: 1 } } })
})

describe('GamesHub', () => {
  it('renders the daily hero linking to the intro screen, with the streak line', async () => {
    renderHub()
    const hero = (await screen.findByText('Play with Zed')).closest('a')
    // The card opens the daily-intro screen, which owns the Play button
    // into the actual challenge game.
    expect(hero).toHaveAttribute('href', '/games/daily')
    expect(within(hero).getByText(/Keep your 3-day streak/)).toBeInTheDocument()
  })

  it('asks for TODAY\'S QUIZ by the learner\'s grade, and prints that grade on BOTH heroes', async () => {
    renderHub()
    await screen.findByText('Play with Zed')

    // The query is scoped at the source. Before this, the rotation ran
    // over the whole collection and the hero labelled whatever it landed
    // on — "TODAY'S QUIZ · GRADE 3" above a challenge card saying
    // "Grade 7", for one learner, on one screen.
    expect(mocks.getTodaysChallenge).toHaveBeenCalledWith({ grade: 4 })

    // One function feeds both pills, so they cannot disagree. Asserting
    // BOTH (rather than one) is what makes a second grade source fail
    // here instead of in production.
    const quiz = screen.getByText('Play with Zed').closest('a')
    const race = screen.getByText('Race a learner').closest('a')
    expect(within(quiz).getByText('Grade 4')).toBeInTheDocument()
    expect(within(race).getByText('Grade 4')).toBeInTheDocument()
    // …and never the grade of the game the rotation happened to return,
    // which for GAMES[0] is also 4 — so the fixture below proves it.
  })

  it('a grade with no quiz today gets the empty state, never another grade\'s quiz', async () => {
    mocks.getTodaysChallenge.mockResolvedValue({ game: null, source: 'none', dateId: '2026-08-19', grade: 4 })
    renderHub()
    expect(await screen.findByText('No quiz today')).toBeInTheDocument()
    // Not a link: a card that says there is nothing to play must not open
    // a page that says it again.
    expect(screen.getByText('No quiz today').closest('a')).toBeNull()
    expect(document.querySelector('a[href="/games/daily"]')).toBeNull()
    // The rest of the hub is unaffected — an empty day is not an outage.
    expect(screen.getByText('Your games')).toBeInTheDocument()
  })

  it('the grade on the pills is the LEARNER\'s, not the returned game\'s', async () => {
    // The exact shape of the live bug: a Grade 3 game came back for a
    // Grade 4 learner. The pill must still read the learner.
    mocks.getTodaysChallenge.mockResolvedValue({
      game: { id: 'g-wrong', title: 'Someone else\'s quiz', type: 'timed_quiz', grade: 3 },
      source: 'rotation',
      dateId: '2026-08-19',
    })
    renderHub()
    const quiz = (await screen.findByText('Play with Zed')).closest('a')
    expect(within(quiz).getByText('Grade 4')).toBeInTheDocument()
    expect(within(quiz).queryByText('Grade 3')).toBeNull()
    expect(screen.queryByText(/GRADE 3/i)).toBeNull()
  })

  it('XP card reads the level curve from saved history (200 pts → Level 2)', async () => {
    renderHub()
    expect(await screen.findByText(/Level 2/)).toBeInTheDocument()
    expect(screen.getByText(/XP to Level 3/)).toBeInTheDocument()
  })

  it('badge shelf shows every badge, locking the unearned ones', async () => {
    renderHub()
    await screen.findByText('Play with Zed')
    // The count is now the link into the Sticker Collection.
    const shelfLink = screen.getByRole('link', { name: `1 of ${GAME_BADGES.length} ›` })
    expect(shelfLink).toHaveAttribute('href', '/games/stickers')
    expect(document.querySelectorAll('.lhx-badge.is-earned')).toHaveLength(1)
    expect(document.querySelectorAll('.lhx-badge.is-locked')).toHaveLength(GAME_BADGES.length - 1)
  })

  it('the catalogue is exactly the mockup: one card per mechanic + the Map Quest teaser', async () => {
    renderHub()
    // Named for the MECHANIC, never for the content pack behind it.
    const words = (await screen.findByText('Word Builder')).closest('a')
    expect(words).toHaveAttribute('href', '/games/play/g-words')
    expect(within(words).getByText('Best 120')).toBeInTheDocument()
    expect(within(words).getByText('English · Spelling')).toBeInTheDocument()
    expect(screen.queryByText('Spell the Animal')).toBeNull()
    expect(screen.queryByText('Number Target: Master')).toBeNull()

    const path = document.querySelector('a.lhx-game[href="/games/play/g-path"]')
    expect(within(path).getByText('Number Path')).toBeInTheDocument()
    // ONE meta line, `subject · topic` — not two wrapping chips, which is
    // what made one row taller than its neighbours.
    expect(within(path).getByText('Mathematics · Level 1')).toBeInTheDocument()
    // An unplayed game gets the Play pill, and NO progress bar: a 0%
    // track beside "Not played yet" measures nothing.
    expect(within(path).getByText('Play')).toBeInTheDocument()
    expect(path.querySelector('.lhx-gc-bar, .lhx-game-bar')).toBeNull()

    // The two mechanics the live collection has no doc for still render,
    // backed by the bundled seed pack — a catalogue of "exactly four"
    // that silently shows two is the bug this asserts against.
    expect(screen.getByText('Meaning Match')).toBeInTheDocument()
    expect(screen.getByText('Punctuation Pro')).toBeInTheDocument()
    expect(document.querySelectorAll('a.lhx-game')).toHaveLength(4)

    // timed_quiz games never list as catalogue cards (daily-only)…
    expect(screen.queryByText('G6 Quiz')).toBeNull()
    // …grade browsing is gone…
    expect(screen.queryByText(/Browse by grade/)).toBeNull()
    // …and the Map Quest teaser renders honestly as coming soon, not a link.
    const mapQuest = screen.getByText('Map Quest').closest('.lhx-game')
    expect(mapQuest.tagName).not.toBe('A')
    expect(within(mapQuest).getByText('Soon')).toBeInTheDocument()
  })

  it('never shows another grade\'s pack — the mechanic waits instead', async () => {
    // The exact live shape of the bug. `word_builder` is the probe on
    // purpose: the bundled seed has no Grade 4 pack for it (only Grade 3),
    // so this measures the real fallback against the real seed rather than
    // against a fixture built to have a hole in it.
    mocks.listGames.mockResolvedValue([
      { id: 'g-wb-g6', title: 'Spell the Planet', type: 'word_builder', grade: 6, subject: 'english', cbc_topic: 'Spelling' },
    ])
    renderHub()

    const row = (await screen.findByText('Word Builder')).closest('.lhx-game')
    // The row is still there — a catalogue of "exactly four" that shows
    // three is the other half of the bug.
    expect(row).toBeInTheDocument()
    // …but it does not open, and it carries none of that pack's identity.
    expect(row.tagName).not.toBe('A')
    expect(document.querySelector('a[href="/games/play/g-wb-g6"]')).toBeNull()
    expect(within(row).getByText('Coming soon for Grade 4')).toBeInTheDocument()
    expect(within(row).getByText('Soon')).toBeInTheDocument()
    expect(screen.queryByText('Spell the Planet')).toBeNull()
    expect(screen.queryByText(/English · Spelling/)).toBeNull()

    // The four mechanics are all still listed, in order, plus Map Quest.
    const names = [...document.querySelectorAll('.lhx-game b')].map((el) => el.textContent)
    expect(names).toEqual(['Number Path', 'Word Builder', 'Meaning Match', 'Punctuation Pro', 'Map Quest'])
  })

  it('asks the games list for the learner\'s grade too, not just the daily', async () => {
    renderHub()
    await screen.findByText('Play with Zed')
    expect(mocks.listGames).toHaveBeenCalledWith({ grade: 4 })
  })

  it('offers ONE race card — the live one — and no Race Zed! bot card', async () => {
    renderHub()
    const live = (await screen.findByText('Race a learner')).closest('a')
    expect(live).toHaveAttribute('href', '/games/duel/live')
    expect(within(live).getByText('Live challenge')).toBeInTheDocument()
    // Child-readable: "same questions, server keeps score" was written
    // for an adult reviewer, and it pushed the card to three lines.
    expect(within(live).getByText('5 quick questions')).toBeInTheDocument()
    expect(screen.queryByText(/server keeps score/)).toBeNull()
    expect(screen.queryByText('Race Zed!')).toBeNull()
    expect(screen.queryByText('CHALLENGE MODE')).toBeNull()
    expect(document.querySelector('a[href="/games/duel"]')).toBeNull()
  })

  it('a Firestore failure falls back to the seed catalogue instead of an empty hub', async () => {
    mocks.listGames.mockRejectedValue(new Error('offline'))
    mocks.getMyHistory.mockRejectedValue(new Error('offline'))
    mocks.getTodaysChallenge.mockRejectedValue(new Error('offline'))
    mocks.getMyStreak.mockRejectedValue(new Error('offline'))
    mocks.getMyGameBadges.mockRejectedValue(new Error('offline'))
    renderHub()
    // Seed games render (the learner is grade 4, the seed has grade-4 games).
    const cards = await screen.findAllByRole('link', { name: /Best|Play/ })
    expect(cards.length).toBeGreaterThan(0)
  })
})
