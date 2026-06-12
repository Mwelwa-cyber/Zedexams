import { useState } from 'react'
import { saveScore, getMyHistory } from '../../utils/gamesService'
import { evaluateAndAwardGameBadges } from '../../utils/gameBadgesService'
import { getTodaysChallenge, recordDailyPlay } from '../../utils/dailyChallengeService'
import { levelUpInfo } from '../../utils/gameProgress'

// Same window the games hub sums for its points total, so the level shown on
// the done screen matches the hub.
const HISTORY_WINDOW = 40

/**
 * Shared "end of round" plumbing for any game engine.
 *
 * Every engine (TimedQuizGame, MemoryMatchGame, WordBuilderGame, …) should:
 *   1. Construct a consistent result object with the shape below.
 *   2. Call `finish(result)` when the player is done.
 *   3. Render the returned `saveResult`, `newBadges`, and `streakResult` in
 *      its DoneCard — the UI components (SaveBanner, BadgeToast,
 *      StreakBanner) are shared in ./DoneBanners.jsx.
 *
 * Result shape:
 *   {
 *     game,          // the game doc
 *     score,         // number — the player's final score
 *     correct,       // number — correct answers
 *     wrong,         // number — wrong answers
 *     accuracy,      // 0–100
 *     bestStreak,    // number — longest streak in this round
 *     timeSpent,     // seconds
 *   }
 *
 * Returns:
 *   { phase, saveResult, newBadges, streakResult, finish(result), reset() }
 *   phase ∈ 'playing' | 'done'
 */
export function useGameFinish() {
  const [phase, setPhase] = useState('playing')
  const [saveResult, setSaveResult] = useState(null)
  const [newBadges, setNewBadges] = useState([])
  const [streakResult, setStreakResult] = useState(null)
  const [levelChange, setLevelChange] = useState(null)

  function reset() {
    setPhase('playing')
    setSaveResult(null)
    setNewBadges([])
    setStreakResult(null)
    setLevelChange(null)
  }

  async function finish(result) {
    setPhase('done')

    // Snapshot the points total *before* this round so a level-up can be
    // detected exactly, independent of write propagation.
    let beforeTotal = null
    try {
      const history = await getMyHistory(HISTORY_WINDOW)
      beforeTotal = history.reduce((sum, row) => sum + (Number(row.score) || 0), 0)
    } catch {
      /* progression is non-critical — skip if history is unavailable */
    }

    const savePayload = {
      game: result.game,
      score: result.score,
      accuracy: result.accuracy,
      timeSpent: result.timeSpent,
      correct: result.correct,
      wrong: result.wrong,
      bestStreak: result.bestStreak,
    }
    const save = await saveScore(savePayload)
    setSaveResult(save)

    if (!save?.ok) return

    if (beforeTotal != null) {
      const after = beforeTotal + (Number(result.score) || 0)
      setLevelChange(levelUpInfo(beforeTotal, after))
    }

    // Badges
    try {
      const { newlyEarned } = await evaluateAndAwardGameBadges({
        game: result.game,
        score: result.score,
        correct: result.correct,
        wrong: result.wrong,
        accuracy: result.accuracy,
        bestStreak: result.bestStreak,
      })
      if (newlyEarned?.length) setNewBadges(newlyEarned)
    } catch (err) {
      console.warn('badge evaluation failed', err)
    }

    // Daily streak
    try {
      const { game: todaysGame } = await getTodaysChallenge()
      if (todaysGame?.id) {
        const streakOutcome = await recordDailyPlay({
          gameId: result.game.id,
          dailyGameId: todaysGame.id,
        })
        if (streakOutcome.isDaily) setStreakResult(streakOutcome)
      }
    } catch (err) {
      console.warn('daily streak update failed', err)
    }
  }

  return { phase, setPhase, saveResult, newBadges, streakResult, levelChange, finish, reset }
}
