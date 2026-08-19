/**
 * The bundled seed fallback, and the one thing it has to honour: a game an
 * admin permanently deleted.
 *
 * ── Why this test exists ────────────────────────────────────────────────
 *
 * The seed is compiled into the app bundle. Three learner surfaces read it
 * when Firestore has nothing for them — the games hub's catalogue rows, the
 * `/games/play/:id` route, and the daily-challenge rotation — so deleting
 * `games/{id}` from Firestore does NOT, on its own, remove a game from any
 * of them. Before the deletion list existed, a permanently deleted game
 * kept its card on the hub and stayed launchable through an old direct
 * link: a deletion that deleted nothing a learner could see.
 *
 * Run: npm run test:games-seed-fallback
 */
import assert from 'node:assert/strict'
import { GAMES_SEED, RETIRED_GAME_TYPES, getFallbackGame, getFallbackGames } from './gamesSeed.js'

const playable = GAMES_SEED.find((g) => g.active !== false && !RETIRED_GAME_TYPES.has(g.type))
assert.ok(playable, 'the seed must carry at least one playable game')

/* ── the pre-existing behaviour, unchanged ─────────────────────────── */

// No exclusion list is not an empty exclusion list — a caller that has no
// way to know must filter nothing, which is what every pre-deletion caller
// did.
assert.ok(getFallbackGames({}).length > 0)
assert.ok(getFallbackGames({ exclude: new Set() }).length === getFallbackGames({}).length)
assert.equal(getFallbackGame(playable.id), playable)
assert.equal(getFallbackGame('no_such_game'), null)

// An inactive or retired seed entry never reaches a learner, deletion or no.
{
  const inactive = GAMES_SEED.find((g) => g.active === false)
  if (inactive) assert.equal(getFallbackGame(inactive.id), null, 'a deactivated seed entry is not playable')
  const retired = GAMES_SEED.find((g) => RETIRED_GAME_TYPES.has(g.type))
  if (retired) assert.equal(getFallbackGame(retired.id), null, 'a retired mechanic is not playable')
}

/* ── the deletion list ─────────────────────────────────────────────── */

{
  const exclude = new Set([playable.id])

  // The hub's catalogue and its games list.
  const listed = getFallbackGames({ exclude })
  assert.ok(
    !listed.some((g) => g.id === playable.id),
    'a permanently deleted game must not come back as a bundled hub card',
  )
  assert.equal(listed.length, getFallbackGames({}).length - 1, 'exactly one game is removed')

  // The direct-link path. This is the one that a Firestore delete alone
  // could never close: `/games/play/:id` resolves the id against the seed
  // when the live read returns nothing, which is precisely what a deleted
  // game's live read does.
  assert.equal(
    getFallbackGame(playable.id, { exclude }),
    null,
    'a deleted game must not be launchable through an old direct URL',
  )

  // Everything else is untouched — deletion is per-game, not a switch that
  // empties the fallback.
  const other = GAMES_SEED.find((g) => (
    g.id !== playable.id && g.active !== false && !RETIRED_GAME_TYPES.has(g.type)
  ))
  assert.ok(other, 'fixture needs a second playable game')
  assert.equal(getFallbackGame(other.id, { exclude }), other)
}

// Fail-open, deliberately: an unreadable tombstone collection resolves to
// an empty set (see src/utils/gameTombstones.js), and the fallback must
// then behave exactly as it always did. The alternative — treating an
// unreadable list as "hide everything" — would empty the games hub during
// the very outage the fallback exists for.
assert.equal(getFallbackGame(playable.id, { exclude: new Set() }), playable)
assert.equal(getFallbackGame(playable.id, {}), playable)
assert.equal(getFallbackGame(playable.id, { exclude: undefined }), playable)

// Deletion is a Firestore act. The bundled catalogue is a file, so it is
// unchanged and the game can be imported again — which is the property the
// importer's "Not imported" status depends on.
assert.ok(
  GAMES_SEED.some((g) => g.id === playable.id),
  'deleting a game never removes its seed definition',
)

console.log('  ok  gamesSeed fallback honours permanent deletion')
