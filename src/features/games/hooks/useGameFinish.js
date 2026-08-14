import { useState } from 'react'
import { saveScore, readRoundBaseline, readRoundOutcome } from '../../../utils/gamesService'
import { evaluateAndAwardGameBadges } from '../../../utils/gameBadgesService'
import { getTodaysChallenge, recordDailyPlay } from '../../../utils/dailyChallengeService'

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
  const [personalBest, setPersonalBest] = useState(null)

  function reset() {
    setPhase('playing')
    setSaveResult(null)
    setNewBadges([])
    setStreakResult(null)
    setLevelChange(null)
    setPersonalBest(null)
  }

  async function finish(result) {
    setPhase('done')

    // Snapshot progression (windowed total + all-time best for this game)
    // *before* saving, so a level-up / personal best can be resolved exactly.
    const baseline = await readRoundBaseline(result.game?.id)

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

    try {
      const { levelChange: lc, personalBest: pb } = await readRoundOutcome({
        score: result.score,
        baseline,
      })
      if (lc) setLevelChange(lc)
      if (pb) setPersonalBest(pb)
    } catch { /* progression is non-critical */ }

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

  return { phase, setPhase, saveResult, newBadges, streakResult, levelChange, personalBest, finish, reset }
}
