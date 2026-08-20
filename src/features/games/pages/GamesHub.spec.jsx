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
  auth: { currentUser: { uid: 'learner-1' }, userProfile: { grade: 7 } },
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
  { id: 'g-path', title: 'Number Target: Master', type: 'number_target', grade: 7, subject: 'mathematics', points: 15 },
  { id: 'g-words', title: 'Spell the Animal', type: 'word_builder', grade: 7, subject: 'english', cbc_topic: 'Spelling', points: 15 },
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
  // Restored explicitly: `vi.clearAllMocks()` resets the vi.fn()s above but
  // not this plain object, and the race tests below reassign it (challenges
  // switched off, signed out). Without this a later test inherits whichever
  // learner ran last — the seed-fallback test would look for grade-4 games
  // as a signed-out visitor, who resolves to the rollout grade instead.
  mocks.auth = { currentUser: { uid: 'learner-1' }, userProfile: { grade: 7 } }
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
  it('names the game it opens, under the destination\'s own word', async () => {
    renderHub()
    // The card used to read "Today's quiz · Play with Zed" whatever the
    // rotation returned. Both halves misdescribed the destination: this is
    // the Daily CHALLENGE (a rotating game — "Today's quiz" is Home's
    // /daily card, five ranked questions), and Zed HOSTS it rather than
    // playing it, so the one card promising him as an opponent was the one
    // that never had him. A learner who tapped it landed on a screen
    // headed "Today's Challenge" and read the trip as a wrong turn.
    const hero = (await screen.findByText('Number Target: Master')).closest('a')
    expect(within(hero).getByText('Today\u2019s challenge')).toBeInTheDocument()
    expect(screen.queryByText('Play with Zed')).toBeNull()
    // The card opens the daily-intro screen, which owns the Play button
    // into the actual challenge game.
    expect(hero).toHaveAttribute('href', '/games/daily')
    expect(within(hero).getByText(/Keep your 3-day streak/)).toBeInTheDocument()
  })

  it('a challenge doc with no title keeps its Play instead of inventing a name', async () => {
    mocks.getTodaysChallenge.mockResolvedValue({
      game: { id: 'g-untitled', type: 'memory_match', grade: 7 },
      source: 'rotation',
      dateId: '2026-08-19',
    })
    renderHub()
    const hero = (await screen.findByText('Play today\u2019s challenge')).closest('a')
    expect(hero).toHaveAttribute('href', '/games/daily')
    expect(screen.queryByText('Game')).toBeNull()
  })

  it('asks for TODAY\'S CHALLENGE by the learner\'s grade, and prints that grade on BOTH heroes', async () => {
    renderHub()
    await screen.findByText('Number Target: Master')

    // The query is scoped at the source. Before this, the rotation ran
    // over the whole collection and the hero labelled whatever it landed
    // on — "TODAY'S QUIZ · GRADE 3" above a challenge card saying
    // "Grade 7", for one learner, on one screen.
    expect(mocks.getTodaysChallenge).toHaveBeenCalledWith({ grade: 7 })

    // One function feeds both pills, so they cannot disagree. Asserting
    // BOTH (rather than one) is what makes a second grade source fail
    // here instead of in production.
    const quiz = screen.getByText('Number Target: Master').closest('a')
    const race = screen.getByText('Race a learner').closest('a')
    expect(within(quiz).getByText('Grade 7')).toBeInTheDocument()
    expect(within(race).getByText('Grade 7')).toBeInTheDocument()
    // …and never the grade of the game the rotation happened to return,
    // which for GAMES[0] is also 4 — so the fixture below proves it.
  })

  it('a grade with no challenge today gets the empty state, never another grade\'s', async () => {
    mocks.getTodaysChallenge.mockResolvedValue({ game: null, source: 'none', dateId: '2026-08-19', grade: 7 })
    renderHub()
    expect(await screen.findByText('No challenge today')).toBeInTheDocument()
    // Not a link: a card that says there is nothing to play must not open
    // a page that says it again.
    expect(screen.getByText('No challenge today').closest('a')).toBeNull()
    expect(document.querySelector('a[href="/games/daily"]')).toBeNull()
    // The rest of the hub is unaffected — an empty day is not an outage.
    expect(screen.getByText('Your games')).toBeInTheDocument()
  })

  it('the grade on the pills is the LEARNER\'s, not the returned game\'s', async () => {
    // The exact shape of the live bug: a Grade 3 game came back for a
    // Grade 7 learner. The pill must still read the learner.
    mocks.getTodaysChallenge.mockResolvedValue({
      game: { id: 'g-wrong', title: 'Someone else\'s quiz', type: 'timed_quiz', grade: 3 },
      source: 'rotation',
      dateId: '2026-08-19',
    })
    renderHub()
    const quiz = (await screen.findByText('Someone else\'s quiz')).closest('a')
    expect(within(quiz).getByText('Grade 7')).toBeInTheDocument()
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
    await screen.findByText('Number Target: Master')
    // The count is now the link into the Sticker Collection.
    const shelfLink = screen.getByRole('link', { name: `1 of ${GAME_BADGES.length} ›` })
    expect(shelfLink).toHaveAttribute('href', '/games/stickers')
    expect(document.querySelectorAll('.lhx-badge.is-earned')).toHaveLength(1)
    expect(document.querySelectorAll('.lhx-badge.is-locked')).toHaveLength(GAME_BADGES.length - 1)
  })

  it('lists every playable pack for the learner\'s grade, mechanics first', async () => {
    renderHub()
    // A mechanic with exactly ONE pack is still named for the MECHANIC,
    // never for the content pack behind it — that part of the mockup is
    // unchanged.
    const words = (await screen.findByText('Spelling')).closest('a')
    expect(words).toHaveAttribute('href', '/games/play/g-words')
    expect(within(words).getByText('Best 120')).toBeInTheDocument()
    expect(within(words).getByText('English · Spelling')).toBeInTheDocument()
    // Scoped to the catalogue ROWS. The rule is about how a row is named;
    // the daily hero above legitimately carries the challenge pack's own
    // title, because it names the game it opens.
    const rowText = [...document.querySelectorAll('a.lhx-game')].map((r) => r.textContent).join(' | ')
    expect(rowText).not.toContain('Spell the Animal')
    expect(rowText).not.toContain('Number Target: Master')

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
    // backed by the bundled seed pack.
    expect(screen.getByText('Meaning Match')).toBeInTheDocument()
    expect(screen.getByText('Punctuation Pro')).toBeInTheDocument()

    // THE BUG THIS ASSERTS AGAINST: the hub used to stop at four rows —
    // one per mechanic — so the `timed_quiz` packs were unreachable by
    // browsing however many of them existed, while learner search listed
    // them happily. They have an engine, so they list.
    const grammar = screen.getByText('Grammar & Meaning').closest('a')
    expect(grammar).toHaveAttribute('href', '/games/play/english_grammar_g7')
    expect(screen.getByText('Ratio & Percentage')).toBeInTheDocument()
    expect(screen.getByText('Body Systems & Energy')).toBeInTheDocument()
    // Two live packs replace their seed twins, and every other Grade 7 pack
    // lists behind them. The old ceiling was four rows, whatever the number.
    // 17 since Spelling Ride joined the catalogue as a fifth mechanic.
    expect(document.querySelectorAll('a.lhx-game')).toHaveLength(17)

    // …but a Grade 6 quiz is still not a Grade 7 learner's game. Widening
    // WHAT lists must not widen WHICH GRADE lists.
    expect(screen.queryByText('G6 Quiz')).toBeNull()
    // …grade browsing is gone…
    expect(screen.queryByText(/Browse by grade/)).toBeNull()
    // …and the Map Quest teaser renders honestly as coming soon, not a link.
    const mapQuest = screen.getByText('Map Quest').closest('.lhx-game')
    expect(mapQuest.tagName).not.toBe('A')
    expect(within(mapQuest).getByText('Soon')).toBeInTheDocument()
  })

  it('a second pack of a mechanic gets its own row, named for its own pack', async () => {
    // The shape an admin hits the moment they add a game: a mechanic the
    // grade already has. `.find()` returned the first one and the new pack
    // was invisible — adding a game did nothing a learner could see.
    mocks.listGames.mockResolvedValue([
      { id: 'mm-words-g7', title: 'Word Meanings', type: 'memory_match', grade: 7, subject: 'english' },
      { id: 'mm-capitals-g7', title: 'African Capitals', type: 'memory_match', grade: 7, subject: 'social' },
    ])
    renderHub()

    const capitals = (await screen.findByText('African Capitals')).closest('a')
    expect(capitals).toHaveAttribute('href', '/games/play/mm-capitals-g7')
    const meanings = screen.getByText('Word Meanings').closest('a')
    expect(meanings).toHaveAttribute('href', '/games/play/mm-words-g7')

    // Two rows both reading "Meaning Match" would identify neither, so
    // once a mechanic owns more than one row each speaks for its own pack.
    expect(screen.queryByText('Meaning Match')).toBeNull()
    // And the live packs answer for their type — the bundled Grade 7
    // Meaning Match is a fallback for an EMPTY type, not a third row.
    expect(document.querySelector('a[href="/games/play/english_meaning_match_g7"]')).toBeNull()
  })

  it('never shows another grade\'s pack, whatever its mechanic', async () => {
    // The exact live shape of the bug: a live pack of a mechanic the learner's
    // grade also has, but belonging to a grade they are not in.
    //
    // This used to also assert the "mechanic waits" row, using word_builder as
    // the probe because the seed had no Grade 4 pack for it. Grade 7 now has a
    // pack for every mechanic — test:learner-grade-games fails if it ever does
    // not — so that hole cannot be produced from the real seed any more, and
    // building a fixture with a hole in it would test the fixture. The rule
    // itself is proven on buildCatalogue in gamesHubCore.test.js.
    mocks.listGames.mockResolvedValue([
      { id: 'g-wb-g6', title: 'Spell the Planet', type: 'word_builder', grade: 6, subject: 'english', cbc_topic: 'Spelling' },
    ])
    renderHub()

    // The mechanic is there, backed by the learner's OWN grade…
    const row = (await screen.findByText('Spelling')).closest('a')
    expect(row).toHaveAttribute('href', '/games/play/english_word_builder_g7')
    // …and the Grade 6 pack is nowhere, by link or by name.
    expect(document.querySelector('a[href="/games/play/g-wb-g6"]')).toBeNull()
    expect(screen.queryByText('Spell the Planet')).toBeNull()

    // The named mechanics lead in the registry's order, whatever else lists
    // behind them; Map Quest closes the list.
    const names = [...document.querySelectorAll('.lhx-game b')].map((el) => el.textContent)
    // 'Spelling' rather than 'Word Builder': the card opens the spelling
    // ladder, and the mechanic NAME is what a child reads. The `type` behind
    // it is still `word_builder` — the registry key did not move.
    //
    // 'Spelling Ride' sits beside it rather than replacing it: the ladder and
    // the ride are two mechanics over ONE word bank and one learner record,
    // so listing only one would hide the other.
    expect(names.slice(0, 5)).toEqual(['Number Path', 'Spelling', 'Spelling Ride', 'Meaning Match', 'Punctuation Pro'])
    expect(names.at(-1)).toBe('Map Quest')
    // The tail is ordered by TYPE and then by title — fraction_ladder, then
    // map_place, then the timed_quiz packs alphabetically — so the order is a
    // property of the data rather than of which pool answered first.
    expect(names.slice(5, -1)).toEqual([
      // fraction_ladder, then the six map_place modes by title, then the
      // timed_quiz packs by title.
      'Fraction Ladder',
      'Know Zambia', 'Zambia: Journey', 'Zambia: Odd one out', 'Zambia: Our neighbours',
      'Zambia: Where’s the capital?', 'Zambia: Where’s the ceremony?',
      'Body Systems & Energy', 'Grammar & Meaning', 'Integer Battle',
      'Ratio & Percentage', 'Zambia: Land & Government',
    ])
  })

  it('asks the games list for the learner\'s grade too, not just the daily', async () => {
    renderHub()
    await screen.findByText('Number Target: Master')
    expect(mocks.listGames).toHaveBeenCalledWith({ grade: 7 })
  })

  it('offers ONE race HERO — the live one — with Race Zed a rank below it', async () => {
    renderHub()
    const live = (await screen.findByText('Race a learner')).closest('a')
    expect(live).toHaveAttribute('href', '/games/duel/live')
    expect(within(live).getByText('Live challenge')).toBeInTheDocument()
    // Child-readable: "same questions, server keeps score" was written
    // for an adult reviewer, and it pushed the card to three lines.
    expect(within(live).getByText('5 quick questions')).toBeInTheDocument()
    expect(screen.queryByText(/server keeps score/)).toBeNull()

    // #2496 deleted the "CHALLENGE MODE · Race Zed!" HERO because two
    // coral heroes made the real-opponent race read as the bot's variant.
    // That half stands: still exactly one race hero on the page.
    expect(screen.queryByText('CHALLENGE MODE')).toBeNull()
    expect(document.querySelectorAll('.lhx-gh-hero-race')).toHaveLength(1)

    // What did NOT stand is the sentence that made the deletion safe —
    // "/games/duel is untouched and still reachable". Nothing linked to it
    // afterwards, so a fully built screen was reachable only by typing the
    // URL, while the one card still naming Zed opened the daily challenge.
    // The door is back, one rank down: a row, never a hero.
    const zed = document.querySelector('a[href="/games/duel"]')
    expect(zed).not.toBeNull()
    expect(zed.className).not.toMatch(/lhx-gh-hero/)
    expect(within(zed).getByText('Race Zed')).toBeInTheDocument()
    // And it says which opponent is the robot BEFORE the tap — that is
    // what earns it a place under a card promising a real learner.
    expect(within(zed).getByText(/robot/i)).toBeInTheDocument()
  })

  it('a guardian who switched challenges off gets neither race', async () => {
    // The row reads duelAllowed — the same predicate /games/duel reads —
    // so the hub can never offer a race the page then refuses with
    // "challenges are switched off for this account".
    mocks.auth = {
      currentUser: { uid: 'learner-1' },
      userProfile: { grade: 7, role: 'learner', guardianControls: { challenges: false } },
    }
    renderHub()
    await screen.findByText('Number Target: Master')
    expect(document.querySelector('a[href="/games/duel"]')).toBeNull()
    expect(screen.queryByText('Race a learner')).toBeNull()
  })

  it('a signed-out visitor keeps Race Zed — it is the only race they can play', async () => {
    // The live card is signed-in only: its queue is written as the
    // learner's own doc. duelAllowed deliberately keeps the bot race for a
    // visitor (/games is public and the duel writes nothing for them), so
    // gating this row beside the live card would leave a visitor looking
    // at a games hub with no race on it at all.
    mocks.auth = { currentUser: null, userProfile: null }
    renderHub()
    await screen.findByText('Race Zed')
    expect(document.querySelector('a[href="/games/duel"]')).not.toBeNull()
    expect(screen.queryByText('Race a learner')).toBeNull()
  })

  it('a Firestore failure falls back to the seed catalogue instead of an empty hub', async () => {
    mocks.listGames.mockRejectedValue(new Error('offline'))
    mocks.getMyHistory.mockRejectedValue(new Error('offline'))
    mocks.getTodaysChallenge.mockRejectedValue(new Error('offline'))
    mocks.getMyStreak.mockRejectedValue(new Error('offline'))
    mocks.getMyGameBadges.mockRejectedValue(new Error('offline'))
    renderHub()
    // Seed games render (the learner is grade 7, and the seed is Grade 7).
    const cards = await screen.findAllByRole('link', { name: /Best|Play/ })
    expect(cards.length).toBeGreaterThan(0)
  })
  /**
   * The first screen a new learner meets. It used to open, for everyone,
   * with a Level strip over an empty meter and an Achievements shelf over
   * ten padlocks — more than half of a 390×844 phone spent telling a
   * child they had nothing, above the games (LEARNER_UI_AUDIT L-16).
   *
   * `progressBlockMode` is unit-tested next door; what these assert is
   * that the hub is actually WIRED to it, in both directions, which the
   * pure test cannot see.
   */
  describe('a learner with no progress yet', () => {
    beforeEach(() => {
      mocks.getMyHistory.mockResolvedValue([])
      mocks.getMyGameBadges.mockResolvedValue({ byId: {} })
    })

    it('leads with the games instead of two empty blocks', async () => {
      renderHub()
      const games = await screen.findByRole('heading', { name: 'Your games' })
      expect(screen.queryByRole('heading', { name: 'Achievements' })).toBeNull()
      expect(games).toBeInTheDocument()
      // The level strip goes with it — an empty meter is the same claim.
      expect(screen.queryByText(/^Level \d/)).toBeNull()
    })

    it('offers one line naming what to aim at, not a count of nothing', async () => {
      renderHub()
      const row = await screen.findByText(/first sticker/i)
      expect(row).toBeInTheDocument()
      // The padlock shelf is what this replaced; it must not also render.
      expect(screen.queryByText(`0 of ${GAME_BADGES.length} \u203a`)).toBeNull()
    })
  })

  describe('a learner who has earned something', () => {
    it('puts the level and the stickers back above the games', async () => {
      // The default fixture already has history and one badge.
      renderHub()
      expect(await screen.findByRole('heading', { name: 'Achievements' })).toBeInTheDocument()
      expect(screen.getByText(/^Level \d/)).toBeInTheDocument()

      // ...and above, not merely present. compareDocumentPosition is the
      // only ordering signal jsdom has, since it does layout nothing.
      const achievements = screen.getByRole('heading', { name: 'Achievements' })
      const games = screen.getByRole('heading', { name: 'Your games' })
      const achievementsComesFirst = Boolean(
        achievements.compareDocumentPosition(games) & Node.DOCUMENT_POSITION_FOLLOWING,
      )
      expect(achievementsComesFirst).toBe(true)
    })
  })

})
