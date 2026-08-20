/**
 * gamesHubCore — the Games hub's decisions, as rules rather than as JSX.
 *
 * Pure: no DOM, no React, no Firebase, no clock of its own (every function
 * that needs "now" is handed it). Node-tested by `gamesHubCore.test.js`.
 *
 * ── Why the learner's grade is a FUNCTION and not an expression ─────────
 *
 * The hub used to answer "which grade is this learner in?" twice, in two
 * different ways, three lines apart:
 *
 *   TODAY'S QUIZ · GRADE {challengeGame.grade}   ← the grade of whichever
 *                                                  game the daily rotation
 *                                                  happened to land on
 *   Grade {Number(userProfile?.grade) || 7}      ← the learner's own grade
 *
 * So a Grade 7 learner was shown "TODAY'S QUIZ · GRADE 3" above a live
 * challenge card reading "Grade 7", and the quiz behind the first card was
 * genuinely a Grade 3 quiz — the rotation is over the whole `games`
 * collection and nothing scoped it. The label was not lying about the data;
 * the data was wrong.
 *
 * `resolveLearnerGrade` is the one answer. Both hero cards render it, and
 * `getTodaysChallenge({ grade })` is scoped by it, so the two cards cannot
 * disagree and the quiz behind the first one is the learner's own grade by
 * construction rather than by review. Rendering it as a PILL on both heroes
 * (the mockup's shape) is part of the same fix: a future mismatch shows up
 * side by side on the screen instead of hiding inside an eyebrow label.
 *
 * A signed-out visitor and a profile with no grade both fall to the rollout
 * grade (`LEARNER_GRADES[0]`). That is not a guess about the person — /games
 * is a public route, and the learner side is open to exactly one grade, so
 * it is the only grade the hub could honestly offer. It replaces the old
 * hard-coded `|| 7`, which said the same thing without saying where it came
 * from and would have gone stale the day a second grade opens.
 */

import { LEARNER_GRADES } from '../../../config/curriculum.js'

/** A game counts as NEW for its first 30 days in the catalogue. */
export const NEW_GAME_WINDOW_MS = 1000 * 60 * 60 * 24 * 30

/**
 * The grade this hub is showing — for the daily-quiz query, the live
 * challenge, and the pill on both hero cards.
 *
 * @param {object|null} profile  the users/{uid} document, if loaded
 * @returns {number} an integer grade; never null, so no caller needs a fallback
 */
export function resolveLearnerGrade(profile) {
  const n = Number(String(profile?.grade ?? '').trim())
  if (Number.isInteger(n) && n > 0) return n
  return LEARNER_GRADES[0]
}

/**
 * The single meta line under a game's name: `Subject · Topic`.
 *
 * One line, not two chips. Two wrapping chips are what made Meaning Match
 * ~40px taller than Punctuation Pro, and a card list whose rows are
 * different heights cannot be scanned. A game with no topic keeps just its
 * subject rather than printing a trailing separator.
 */
export function gameMetaLine(subjectLabel, topic) {
  const parts = [subjectLabel, topic].map((p) => String(p ?? '').trim()).filter(Boolean)
  return parts.join(' · ')
}

/**
 * The ONE status pill on a game card: `Play`, `Best <n>` or `New`.
 *
 * This replaces the progress bar that used to sit here, which measured
 * nothing it could name. Three of five games rendered a 0%-filled track
 * beside "Not played yet" — a bar whose only content is that it is empty —
 * and for the other two it was drawn from `best / (points × 2)`, so Word
 * Builder's read full at "Best 120". A best score is not a completion
 * percentage; there is no completion to measure, so nothing is drawn.
 *
 * A played game shows its best score even when it is also new: what the
 * learner did outranks how long the game has been here.
 *
 * @returns {{kind: 'best'|'new'|'play', label: string}}
 */
export function gameStatusPill({ best = 0, isNew = false } = {}) {
  const score = Number(best) || 0
  if (score > 0) return { kind: 'best', label: `Best ${score}` }
  if (isNew) return { kind: 'new', label: 'New' }
  return { kind: 'play', label: 'Play' }
}

/**
 * Was this game added recently enough to be flagged NEW?
 *
 * `now` is a parameter so this is testable without a clock. Firestore
 * Timestamps and plain millisecond numbers both arrive here, and a game with
 * no creation date (every bundled seed doc) is never new — an unknown date
 * is not evidence of recency.
 */
export function isRecentlyAdded(createdAt, now) {
  const ms = typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : Number(createdAt)
  if (!Number.isFinite(ms) || ms <= 0) return false
  return now - ms < NEW_GAME_WINDOW_MS
}

/**
 * The catalogue: every game this learner can play, and NEVER another
 * grade's pack.
 *
 * ── The bug this replaces (2026-08-19) ─────────────────────────────────
 *
 * This function used to answer "one row per mechanic": it walked the four
 * `CATALOGUE_MECHANICS` and took `.find()` — the FIRST pack of that
 * mechanic at the learner's grade — so the hub rendered at most four game
 * rows no matter how many games existed. `/games` is the only browse
 * surface left (the `/games/g/:grade` routes became redirects), so that
 * ceiling was the whole learner catalogue.
 *
 * What it hid, measured against the bundled seed of 47 games:
 *
 *   • Every second and subsequent pack of a mechanic. Import a new Meaning
 *     Match for a grade that already has one and it is invisible —
 *     `.find()` returns the other one. This is the shape an admin hits
 *     immediately: adding a game does nothing.
 *   • Every playable type that is not one of the four mechanics — 27 of
 *     the 47 seed games are `timed_quiz`, including all six "Spell It
 *     Right" packs. They are playable (`PlayGame` renders `TimedQuizGame`)
 *     and `useLearnerSearch` already lists them as findable, so a learner
 *     could SEARCH for a game the hub refused to browse.
 *
 * So the rule is now: list the games that exist. A row per pack, ordered
 * by mechanic so the mockup's four still lead, everything else after.
 *
 * ── What did NOT change, because it was right ──────────────────────────
 *
 * Grade scoping. A pack belongs to a learner's grade or it is not offered:
 * a Grade 6 pack under a Grade 7 learner's mechanic name mis-levels the
 * child AND posts their score to the same leaderboard as everyone playing
 * their own grade. `games` arrives grade-scoped from the query and is
 * re-checked here, because a query is a promise about the fetch, not about
 * what reached this function.
 *
 * ── Why "nothing" is still a ROW ───────────────────────────────────────
 *
 * A MECHANIC with no pack for this grade returns `{ game: null }` rather
 * than being dropped, and the hub renders it as a row that says so and
 * does not open. A gap a learner can see is a gap someone can fill; a gap
 * that removes a row is indistinguishable from the mechanic never
 * existing. Only the named mechanics get this treatment — a type that is
 * merely absent (no `timed_quiz` pack this grade) has no name to wait
 * under and no mockup row to leave empty.
 *
 * The placeholder deliberately carries NO subject. A subject would have to
 * be invented: three of the four mechanics have an inherent one, but
 * `memory_match` genuinely does not — its packs are English word meanings
 * in one grade, mathematics in another, African capitals in a third.
 *
 * ── The seed backs a TYPE, not an item ─────────────────────────────────
 *
 * `seeded` is the bundled fallback, and it fills a type only when the live
 * collection has NO pack of that type for this grade. Merging the two
 * pools item by item would list the live pack and the seed pack of the
 * same mechanic side by side as two rows — the admin's imported copy and
 * the bundled one — which reads as a duplicate rather than as a fallback.
 * Live-or-seed per type keeps the live collection authoritative wherever
 * it has been seeded at all.
 *
 * ── Naming: the mechanic, until there is more than one of it ───────────
 *
 * A doc's `title` names its CONTENT pack ("Spell the Animal", "Number
 * Target: Master"); the mechanic name ("Word Builder") is what the mockup
 * puts on the card, and it is stable across grades and seeding states. So
 * a mechanic with exactly one pack keeps the mechanic name. The moment
 * there are two, the mechanic name would print twice and identify
 * neither, so both rows fall back to their own titles. A type with no
 * mechanic name (`timed_quiz`) always uses its title.
 *
 * @param {object}   options
 * @param {Array}    options.mechanics      CATALOGUE_MECHANICS — `{type, name}`,
 *                                          in the order the mockup lists them
 * @param {Array}    options.games          live docs for this grade
 * @param {Array}    options.seeded         bundled fallback packs
 * @param {number}   options.grade          the learner's grade
 * @param {Set}      [options.playableTypes] every type with an engine behind
 *                                          it (PLAYABLE_GAME_TYPES). Defaults
 *                                          to the mechanics' own types, so a
 *                                          caller that says nothing gets the
 *                                          conservative catalogue rather than
 *                                          cards that open on nothing.
 * @returns {Array<{key: string, type: string, name: string, game: object|null}>}
 */
export function buildCatalogue({ mechanics = [], games = [], seeded = [], grade, playableTypes } = {}) {
  const allowed = playableTypes instanceof Set
    ? playableTypes
    : new Set(mechanics.map((m) => m.type))

  // Grade is re-checked, and compared as a NUMBER: Firestore hands grades
  // back as strings as readily as numbers, and a string/number mismatch
  // here would silently empty the whole catalogue.
  const bucketByType = (pool) => {
    const byType = new Map()
    for (const game of Array.isArray(pool) ? pool : []) {
      if (!game || !allowed.has(game.type)) continue
      if (Number(game.grade) !== Number(grade)) continue
      if (!byType.has(game.type)) byType.set(game.type, [])
      byType.get(game.type).push(game)
    }
    for (const packs of byType.values()) packs.sort(byTitle)
    return byType
  }

  const live = bucketByType(games)
  const seed = bucketByType(seeded)
  // Live-or-seed per type — never both. See the note above.
  const packsOf = (type) => live.get(type) || seed.get(type) || []

  const rows = []
  const named = new Set()

  for (const { type, name } of mechanics) {
    if (named.has(type)) continue
    named.add(type)
    const packs = packsOf(type)
    if (!packs.length) {
      rows.push({ key: `mechanic:${type}`, type, name, game: null })
      continue
    }
    for (const game of packs) rows.push(gameRow(game, type, packs.length === 1 ? name : null))
  }

  // Everything else with an engine behind it. Sorted by type so the order
  // is a property of the data rather than of which pool answered first.
  const rest = [...new Set([...live.keys(), ...seed.keys()])]
    .filter((type) => !named.has(type))
    .sort()
  for (const type of rest) {
    for (const game of packsOf(type)) rows.push(gameRow(game, type, null))
  }

  return rows
}

/**
 * Order packs of one type predictably.
 *
 * Case-folded codepoint order rather than `localeCompare`, deliberately:
 * collation depends on the runtime's locale and ICU build, so the same
 * catalogue could come out in two orders on two devices and the tests that
 * pin the order would pass on one machine and fail on another. A doc with
 * no title sorts first, which is where an empty string belongs.
 */
function byTitle(a, b) {
  const x = String(a?.title ?? '').toLowerCase()
  const y = String(b?.title ?? '').toLowerCase()
  if (x === y) return 0
  return x < y ? -1 : 1
}

/**
 * One playable row. `mechanicLabel` is the mechanic's name when it is the
 * honest label for this row (see the naming note), and null when the row
 * must speak for its own content pack.
 */
function gameRow(game, type, mechanicLabel) {
  return {
    key: String(game.id ?? `${type}:${game.title ?? ''}`),
    type,
    name: mechanicLabel || String(game.title || '').trim() || 'Game',
    game,
  }
}

/**
 * What a catalogue row that has no pack for this grade says.
 *
 * Written for the learner rather than about the data: "we have not made
 * this one for your grade yet" is the true statement, and it is also the
 * one a child can do something with (wait, or play the others).
 */
export function unavailableRowCopy(grade) {
  return { meta: `Coming soon for Grade ${grade}`, pill: 'Soon' }
}

/**
 * The daily hero's copy. Three states, and the third is the point.
 *
 * When the grade-scoped query finds no challenge for today, the card SAYS
 * so and offers no Play. It must never fall back to another grade's
 * challenge — that is the bug this whole module exists for — and a hero
 * that silently disappears reads as a broken page rather than as an empty
 * day.
 *
 * ── The card names what it opens ─────────────────────────────────────
 *
 * It used to read "Today's quiz · Play with Zed", and both halves were
 * wrong about the thing behind them:
 *
 * - It is not a QUIZ. `/games/daily` is the Daily CHALLENGE — one rotating
 *   game, which today may be Meaning Match and tomorrow Number Target.
 *   "Today's quiz" is a different live feature: Home's card opens `/daily`,
 *   the five-question ranked Daily Quiz. Two front doors carrying one name
 *   and opening different screens is a name collision, not a synonym.
 * - It is not played WITH Zed. Zed HOSTS the challenge; the learner plays
 *   it alone. The surface where a learner actually races Zed is
 *   `/games/duel`, which the hub deliberately no longer offers (#2496
 *   left one race card, the live learner-vs-learner one). So the only card
 *   promising Zed as an opponent was the one that never had him.
 *
 * So the hero names the actual game, under the destination's own word —
 * the same rule DailyIntro already holds itself to, for the same reason:
 * a learner who taps a title must land on a screen they recognise. The
 * title is the game's, the eyebrow is "Today's challenge", and
 * `/games/daily` says "Today's Challenge" at the top with that game's name
 * under it.
 *
 * @param {object}  opts
 * @param {boolean} opts.hasChallenge  did the grade-scoped lookup find one
 * @param {number}  opts.streakDays    the learner's current streak
 * @param {string}  opts.gameTitle     the challenge game's own name
 */
export function dailyHeroCopy({ hasChallenge, streakDays = 0, gameTitle = '' } = {}) {
  const eyebrow = 'Today’s challenge'
  if (!hasChallenge) {
    return { eyebrow, title: 'No challenge today', sub: 'Come back tomorrow for a new one', action: null }
  }
  const days = Number(streakDays) || 0
  return {
    eyebrow,
    // A challenge whose doc carries no title is still a real challenge, so
    // the card keeps its Play and borrows the wording of the button it
    // leads to. Never a placeholder that reads like a name ("Game").
    title: String(gameTitle || '').trim() || 'Play today’s challenge',
    sub: days > 0 ? `🔥 Keep your ${days}-day streak` : '🔥 Play today to start a streak',
    action: 'Play',
  }
}

/**
 * The Race Zed row — the hub's door into `/games/duel`.
 *
 * ── Why this is a ROW and not a third hero card ────────────────────────
 *
 * A "CHALLENGE MODE · Race Zed!" hero card stood here until 2026-08-18,
 * and #2496 removed it for a reason that still holds: stacked under the
 * live learner-vs-learner race, two coral heroes read as one feature in
 * two flavours, and the real-opponent one — the harder thing to build and
 * the better thing to play — looked like the variant of the practice one.
 *
 * What did NOT hold is the sentence that made removing it safe:
 * "/games/duel is untouched and STILL REACHABLE; only the hub entry point
 * is gone." Nothing linked to it afterwards. A fully built screen — the VS
 * countdown, the five-question race, Zed's precomputed timeline, the
 * result and the rematch — was reachable only by typing the URL, and the
 * one card that still carried Zed's name opened the daily challenge
 * instead. That pair is what a learner reported as "the Play with Zed
 * button takes me somewhere else": both halves of the promise had been
 * true at different times, and by then neither was.
 *
 * So the door comes back one rank DOWN. A hero card competes with the
 * card above it; a row under it is read as belonging to it, which is what
 * it is — the practice mode of the same five-question race.
 *
 * ── It names the opponent, before the tap ──────────────────────────────
 *
 * "Race Zed" is the destination's own title, under the rule
 * `dailyHeroCopy` records: a learner who taps a name must land on a
 * screen wearing it. The sub carries the single fact that separates this
 * row from the card above it — Zed is our robot. `DuelRace` already tags
 * him ROBOT COACH on its own screen so a scripted bot is never mistaken
 * for a real child, and a learner choosing between two races needs that
 * before they choose, not after.
 *
 * ── Who sees it ────────────────────────────────────────────────────────
 *
 * `challengesAllowed` is `duelAllowed` — the one predicate the route
 * itself reads — so the row cannot offer a race the page then refuses
 * with "challenges are switched off for this account".
 *
 * It is deliberately NOT also gated on being signed in, which is what the
 * live card above it genuinely needs (that queue is written as the
 * learner's own doc). `duelAllowed` keeps the race for a signed-out
 * visitor on purpose — /games is public and the duel writes nothing for
 * them — so for a visitor this row is the ONLY race on the page, and
 * hiding it beside the live card would remove the one thing they can
 * actually play.
 *
 * It also does not try to predict whether a race can be FIELDED. The
 * route draws from an unscoped `listGames()` and falls back across
 * grades, while the hub holds a grade-scoped pool; answering here would
 * answer a different question from a different pool, and would hide the
 * row on races that work. `DuelRace` owns that check and already says
 * "No race can start right now" when its own draw comes up empty.
 *
 * @param {object}  opts
 * @param {boolean} opts.challengesAllowed  duelAllowed(currentUser, userProfile)
 * @returns {{title: string, sub: string}|null} null when the row must not render
 */
export function zedRaceRow({ challengesAllowed = false } = {}) {
  if (!challengesAllowed) return null
  return {
    title: 'Race Zed',
    sub: 'Practice race — Zed is our robot, not a learner',
  }
}

/**
 * Does this learner's progress deserve two blocks, or one line?
 *
 * The hub used to open the same way for everyone: a Level strip reading
 * "Level 1 · Rookie" over an empty meter, then an Achievements shelf
 * reading "0 of 10" over ten padlocks — and only then the games. On a
 * 390×844 phone that put more than half the first screen above the thing
 * the page is for (`docs/learner/LEARNER_UI_AUDIT.md` L-16). For a child
 * arriving for the first time it is worse than merely tall: two blocks
 * whose entire content is a statement that they have nothing.
 *
 * A learner who HAS earned something is in the opposite position — the
 * level and the stickers are the reward, and they should be prominent.
 * So the screen answers a question about the learner rather than
 * rendering one layout for both.
 *
 *   'full'    the two blocks, above the games — there is progress to show
 *   'compact' one row that names the next thing to aim at, below the
 *             games — there is not, so lead with something playable
 *
 * A signed-out visitor always gets 'compact': they have no progress at
 * all, and their level meter can only ever say "Sign in to earn XP",
 * which is an ask, not a reward, and does not belong above the games.
 *
 * @param {object}  opts
 * @param {boolean} opts.signedIn
 * @param {number}  opts.earnedCount  badges this learner has earned
 * @param {number}  opts.totalPoints  lifetime XP across saved runs
 * @returns {'full'|'compact'}
 */
export function progressBlockMode({ signedIn = false, earnedCount = 0, totalPoints = 0 } = {}) {
  if (!signedIn) return 'compact'
  // EITHER signal is enough. A learner can hold XP before their first
  // badge (badges are milestones, points are every run), and the reverse
  // is possible too if a badge is ever awarded for something unscored —
  // requiring both would hide real progress from the learner who has it.
  if (Number(earnedCount) > 0) return 'full'
  if (Number(totalPoints) > 0) return 'full'
  return 'compact'
}

/**
 * The one line that replaces the two blocks in 'compact' mode.
 *
 * It says what to DO, not what is missing — "Play a game to earn your
 * first sticker" rather than "0 of 10 · Level 1". A first-run screen
 * that inventories the learner's zeroes is the failure being fixed; a
 * differently-worded inventory would be the same failure.
 */
export function progressStarterRow({ signedIn = false, badgeCount = 0 } = {}) {
  return {
    icon: '🏅',
    title: signedIn ? 'Play a game to earn your first sticker' : 'Sign in to keep your scores',
    sub: signedIn
      ? `${badgeCount} stickers to collect`
      : 'Your XP, stickers and levels are saved to your account',
  }
}
