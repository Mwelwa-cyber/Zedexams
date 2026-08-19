/**
 * Behaviour tests for the games hub (visual fix, docs/learner/
 * zedexams-games-hub-mockup.html): the daily-challenge hero links to the day's game,
 * the XP card reads the kept levelInfo curve from saved history, the
 * badge shelf locks unearned badges, the game cards carry best scores
 * from history, and a Firestore failure falls back to the seed
 * catalogue instead of freezing the hub.
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
    const hero = (await screen.findByText(/Today's quiz/)).closest('a')
    expect(within(hero).getByText('Play with Zed')).toBeInTheDocument()
    // The card opens the prototype's daily-intro screen, which owns the
    // Play button into the actual challenge game.
    expect(hero).toHaveAttribute('href', '/games/daily')
    expect(within(hero).getByText('3-day streak — keep it going 🔥')).toBeInTheDocument()
  })

  it('XP card reads the level curve from saved history (200 pts → Level 2)', async () => {
    renderHub()
    expect(await screen.findByText(/Level 2/)).toBeInTheDocument()
    expect(screen.getByText(/XP to Level 3/)).toBeInTheDocument()
  })

  it('badge shelf shows every badge, locking the unearned ones', async () => {
    renderHub()
    await screen.findByText(/Today's quiz/)
    // The count is now the link into the Sticker Collection.
    const shelfLink = screen.getByRole('link', { name: `1 / ${GAME_BADGES.length} ›` })
    expect(shelfLink).toHaveAttribute('href', '/games/stickers')
    expect(document.querySelectorAll('.lhx-badge.is-earned')).toHaveLength(1)
    expect(document.querySelectorAll('.lhx-badge.is-locked')).toHaveLength(GAME_BADGES.length - 1)
  })

  it('the catalogue is exactly the mockup: one card per mechanic + the Map Quest teaser', async () => {
    renderHub()
    // Named for the MECHANIC, never for the content pack behind it.
    const words = (await screen.findByText('Word Builder')).closest('a')
    expect(words).toHaveAttribute('href', '/games/play/g-words')
    // A best SCORE is a number, not a completion percentage — one pill,
    // no bar. The bar it replaces read full at "Best 120", meaning nothing.
    expect(within(words).getByText('Best 120')).toBeInTheDocument()
    // ONE meta line, `Subject · Topic`, not two wrapping chips.
    expect(within(words).getByText('English · Spelling')).toBeInTheDocument()
    expect(screen.queryByText('Spell the Animal')).toBeNull()
    expect(screen.queryByText('Number Target: Master')).toBeNull()

    const path = document.querySelector('a.ghx-game[href="/games/play/g-path"]')
    expect(within(path).getByText('Number Path')).toBeInTheDocument()
    // Never played → "Play", not a 0%-filled track beside "Not played yet".
    expect(within(path).getByText('Play')).toBeInTheDocument()
    expect(screen.queryByText('Not played yet')).toBeNull()
    expect(document.querySelectorAll('.lhx-gc-bar')).toHaveLength(0)

    // The two mechanics the live collection has no doc for still render,
    // backed by the bundled seed pack — a catalogue of "exactly four"
    // that silently shows two is the bug this asserts against.
    expect(screen.getByText('Meaning Match')).toBeInTheDocument()
    expect(screen.getByText('Punctuation Pro')).toBeInTheDocument()
    expect(document.querySelectorAll('a.ghx-game')).toHaveLength(4)

    // timed_quiz games never list as catalogue cards (daily-only)…
    expect(screen.queryByText('G6 Quiz')).toBeNull()
    // …grade browsing is gone…
    expect(screen.queryByText(/Browse by grade/)).toBeNull()
    // …and the Map Quest teaser is not a link, because it goes nowhere.
    const mapQuest = screen.getByText('Map Quest').closest('.ghx-game')
    expect(mapQuest.tagName).not.toBe('A')
  })

  it('shows the SAME grade on both heroes, from one source', async () => {
    // The bug this screen was rebuilt around: the daily hero read its
    // grade off whatever game the rotation picked and the challenge card
    // read it off the profile, so one screen said "GRADE 3" and "Grade 7"
    // for the same child. Both now render resolveLearnerGrade.
    renderHub()
    const daily = (await screen.findByText(/Today's quiz/)).closest('a')
    const live = screen.getByText('Race a learner').closest('a')
    expect(within(daily).getByText('Grade 4')).toBeInTheDocument()
    expect(within(live).getByText('Grade 4')).toBeInTheDocument()
    // …and never a grade the learner did not state. The old challenge card
    // hard-coded `|| 7`.
    expect(screen.queryByText('Grade 7')).toBeNull()
  })

  it('refuses a daily quiz from another grade rather than showing it', async () => {
    // "If the grade-scoped query returns nothing, render the empty state —
    // never fall back to another grade's quiz."
    mocks.getTodaysChallenge.mockResolvedValue({
      game: { ...GAMES[0], id: 'g-wrong-grade', grade: 3 },
      source: 'firestore-override',
      dateId: '2026-08-16',
    })
    renderHub()
    await screen.findByText('Word Builder')
    expect(screen.queryByText(/Today's quiz/)).toBeNull()
    expect(document.querySelector('a[href="/games/daily"]')).toBeNull()
  })

  it('the leaderboard is offered once, from the top bar', async () => {
    renderHub()
    await screen.findByText('Word Builder')
    const links = document.querySelectorAll('a[href="/games/leaderboard"]')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('aria-label', 'Leaderboard')
  })

  it('offers ONE race card — the live one — and no Race Zed! bot card', async () => {
    renderHub()
    const live = (await screen.findByText('Race a learner')).closest('a')
    expect(live).toHaveAttribute('href', '/games/duel/live')
    expect(within(live).getByText(/Live challenge/)).toBeInTheDocument()
    // Child-readable: "same questions, server keeps score" was written for
    // an adult reviewer and pushed the card to three lines.
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
    const cards = await screen.findAllByRole('link', { name: /Best|Play|New/ })
    expect(cards.length).toBeGreaterThan(0)
  })
})
