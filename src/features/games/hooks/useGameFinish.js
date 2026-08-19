import { useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { saveScore, readRoundBaseline, readRoundOutcome } from '../services/gamesService'
import { evaluateAndAwardGameBadges } from '../../../utils/gameBadgesService'
import { getTodaysChallenge, recordDailyPlay } from '../../../utils/dailyChallengeService'
import { resolveLearnerGrade } from '../lib/gamesHubCore'

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
  // The daily-challenge lookup below has to ask for the SAME grade the hub
  // offered, or the streak is compared against a game the learner was
  // never shown and never bumps. One function answers both.
  const { userProfile } = useAuth()
  const grade = resolveLearnerGrade(userProfile)
  const [phase, setPhase] = useState('playing')
  const [saveResult, setSaveResult] = useState(null)
  const [newBadges, setNewBadges] = useState([])
  const [streakResult, setStreakResult] = useState(null)
  const [levelChange, setLevelChange] = useState(null)
  const [personalBest, setPersonalBest] = useState(null)

  // ONE ROUND WRITES ONE SCORE.
  //
  // `saveScore` is an `addDoc`, so it mints a fresh document per call and
  // cannot converge the way an id-keyed write does. `setPhase('done')` looks
  // like the re-entry guard but is not one: it is React state, applied on the
  // next render, so a second call arriving inside the same frame — the "End"
  // button double-tapped before it unmounts — passes it and reaches the write.
  // Two rows for one round inflate the public leaderboard, the windowed level
  // total and the personal-best comparison, and `scores` is append-only for
  // learners in the rules, so the learner cannot undo it.
  //
  // A ref is claimed synchronously, which is the only thing that can refuse a
  // call made before a render. It is the pattern already used a few lines away
  // in `pickedRef`, and by `persistInFlightRef` in the Assessment Studio.
  // Released in `reset()` — per ROUND, since "Play again" re-enters without
  // remounting the hook.
  const finishingRef = useRef(false)

  function reset() {
    finishingRef.current = false
    setPhase('playing')
    setSaveResult(null)
    setNewBadges([])
    setStreakResult(null)
    setLevelChange(null)
    setPersonalBest(null)
  }

  async function finish(result) {
    if (finishingRef.current) return
    finishingRef.current = true
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
      const { game: todaysGame } = await getTodaysChallenge({ grade })
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
