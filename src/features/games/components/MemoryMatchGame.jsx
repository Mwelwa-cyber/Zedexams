import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowPathIcon,
  PuzzlePieceIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { useAuth } from '../../../contexts/AuthContext'
import { playCorrect, playWrong, playWin, playTick, primeSounds } from '../lib/gameSounds'
import { useGameFinish } from '../hooks/useGameFinish'
import { SaveBanner, StreakBanner, DoneStat } from './DoneBanners'
import BadgeToast from './BadgeToast'
import ShareButton from './ShareButton'
import Confetti from '../../../shared/components/Confetti'
import Leaderboard from './Leaderboard'
import MascotCelebration from './MascotCelebration'
import MascotGreeting from './MascotGreeting'
import SmartFeedback from './SmartFeedback'
import ScorePops, { useScorePops } from './ScorePops'
import { LevelUpBanner, XpProgressBar, PersonalBestBanner } from './Progress'
import { RatingStars } from './gamesUi'
import {
  buildDeck,
  canFlip,
  doneSummary,
  formatTime,
  gridCols,
  isMatch,
  isWin,
  playablePairs,
  pointsPerMatch,
  scoreWin,
  starsForEfficiency,
} from '../lib/memoryMatchCore'

/**
 * Engine for any `type: "memory_match"` game document.
 *
 * Content shape: `game.questions` is an array of { question, answer } pairs.
 * Each pair becomes two cards (question-side and answer-side), the full
 * deck is shuffled, and the player flips two at a time to find matches.
 *
 * Scoring:
 *   - Base points per match: `game.points` (default 10).
 *   - Bonus: up to `game.points × game.questions.length` extra if the player
 *     uses the minimum number of moves.
 */
export default function MemoryMatchGame({ game }) {
  const points = pointsPerMatch(game)
  const pairs = useMemo(() => playablePairs(game.questions), [game.questions])

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [deck, setDeck] = useState([])        // array of { pairId, label, side }
  const [flipped, setFlipped] = useState([])  // indices currently face-up (unmatched)
  const [matched, setMatched] = useState([])  // matched indices
  const [moves, setMoves] = useState(0)
  const [mismatches, setMismatches] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [confettiKey, setConfettiKey] = useState(0)
  const [shakePair, setShakePair] = useState([]) // indices of a mismatched pair, briefly shaken
  const { pops, pushPop } = useScorePops()
  const startRef = useRef(null)

  const { saveResult, newBadges, streakResult, levelChange, personalBest, finish, reset } = useGameFinish()

  // stopwatch
  useEffect(() => {
    if (phase !== 'playing' || !startRef.current) return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 500)
    return () => clearInterval(t)
  }, [phase])

  function start() {
    primeSounds()
    reset()
    setPhase('playing')
    setDeck(buildDeck(pairs))
    setFlipped([])
    setMatched([])
    setMoves(0)
    setMismatches(0)
    setElapsed(0)
    setShakePair([])
    startRef.current = Date.now()
  }

  function handleFlip(i) {
    if (phase !== 'playing') return
    if (!canFlip(i, flipped, matched)) return
    playTick()
    const next = [...flipped, i]
    setFlipped(next)
    if (next.length === 2) {
      setMoves((m) => m + 1)
      const [a, b] = next
      if (isMatch(deck[a], deck[b])) {
        // match
        setTimeout(() => {
          playCorrect()
          pushPop(points)
          const newMatched = [...matched, a, b]
          setMatched(newMatched)
          setFlipped([])
          if (isWin(newMatched.length, deck.length)) {
            winRound(newMatched)
          }
        }, 380)
      } else {
        setShakePair([a, b])
        setTimeout(() => {
          playWrong()
          setMismatches((m) => m + 1)
          setFlipped([])
          setShakePair([])
        }, 900)
      }
    }
  }

  async function winRound() {
    playWin()
    setConfettiKey((k) => k + 1)
    setPhase('done')
    const totalPairs = pairs.length
    // `moves` is stale here (the sealing move's setMoves hasn't landed), so +1.
    const { finalScore, accuracy } = scoreWin({ totalPairs, movesTaken: moves + 1, points })
    const timeSpent = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : elapsed

    await finish({
      game,
      score: finalScore,
      correct: totalPairs,
      wrong: mismatches,
      accuracy,
      bestStreak: 0,
      timeSpent,
    })
  }

  function restart() { start() }

  if (phase === 'ready') return <ReadyCard game={game} onStart={start} pairs={pairs.length} />
  if (phase === 'done') {
    const { efficiency, finalScore } = doneSummary({ totalPairs: pairs.length, moves, points })
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={finalScore}
          moves={moves}
          mismatches={mismatches}
          elapsed={elapsed}
          efficiency={efficiency}
          saveResult={saveResult}
          newBadges={newBadges}
          streakResult={streakResult}
          levelChange={levelChange}
          personalBest={personalBest}
          onRestart={restart}
        />
      </>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2 sm:gap-3">
        <div className="relative flex-1">
          <StatPill label="Matches" value={`${matched.length / 2} / ${pairs.length}`} tone="emerald" />
          <ScorePops pops={pops} />
        </div>
        <StatPill label="Moves"   value={moves} tone="amber" />
        <StatPill label="Time"    value={formatTime(elapsed)} tone="sky" />
      </div>

      <div
        className="grid gap-3 sm:gap-4"
        style={{ gridTemplateColumns: `repeat(${gridCols(deck.length)}, minmax(0, 1fr))` }}
      >
        {deck.map((card, i) => {
          const faceUp = flipped.includes(i) || matched.includes(i)
          const isMatched = matched.includes(i)
          const isShaking = shakePair.includes(i)
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleFlip(i)}
              disabled={isMatched}
              aria-label={faceUp ? card.label : 'Hidden card'}
              className={`relative aspect-[3/4] w-full rounded-[14px] focus:outline-none focus:ring-4 focus:ring-amber-300 ${isShaking ? 'zx-shake' : ''}`}
            >
              {faceUp ? (
                <div className={`zx-card w-full h-full rounded-[14px] flex items-center justify-center p-2 text-center font-black ${
                  isMatched ? 'bg-emerald-100 text-emerald-900' : 'bg-white text-slate-900'
                }`}>
                  <span className={card.label.length <= 3 ? 'text-4xl sm:text-5xl' : 'text-sm sm:text-base leading-tight'}>
                    {card.label}
                  </span>
                </div>
              ) : (
                <div className="zx-card w-full h-full rounded-[14px] bg-[#D97757] flex items-center justify-center text-white transition active:translate-y-[2px] active:shadow-none">
                  <PuzzlePieceIcon className="h-10 w-10" />
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="text-center">
        <button type="button" onClick={restart} className="text-sm font-bold text-slate-600 hover:text-slate-900 underline">
          Reshuffle deck
        </button>
      </div>
    </div>
  )
}

function ReadyCard({ game, pairs, onStart }) {
  const { currentUser } = useAuth()
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 sm:p-10 text-center">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-orange-100 text-slate-900">
        <PuzzlePieceIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display text-3xl font-bold mb-2 mt-4 text-slate-900">{game.title}</h2>
      <p className="text-slate-700 max-w-md mx-auto mb-6">{game.description}</p>
      <ul className="text-sm text-slate-700 max-w-sm mx-auto text-left mb-7 space-y-1.5">
        <li>{pairs} pairs to find ({pairs * 2} cards)</li>
        <li>Fewer moves unlock a bigger bonus score</li>
        {currentUser
          ? <li>Your score saves automatically to the leaderboard</li>
          : <li>Sign in to save your score and climb the leaderboard</li>}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <PuzzlePieceIcon className="h-4 w-4" />
        Start matching
      </button>
    </div>
  )
}

function DoneCard({ game, score, moves, mismatches, elapsed, efficiency, saveResult, newBadges, streakResult, levelChange, personalBest, onRestart }) {
  const stars = starsForEfficiency(efficiency)
  return (
    <div className="space-y-5">
      {levelChange?.leveledUp && <LevelUpBanner change={levelChange} />}
      {personalBest?.isBest && <PersonalBestBanner personalBest={personalBest} />}
      {streakResult?.isDaily && <StreakBanner result={streakResult} />}
      {newBadges?.length > 0 && <BadgeToast badges={newBadges} />}

      <div className="zx-card rounded-[22px] bg-white p-8 text-center">
        <MascotCelebration game={game} accuracy={efficiency} score={score} />
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-slate-900 text-white">
          <TrophyIcon className="h-8 w-8 text-amber-300" />
        </span>
        <h2 className="font-display text-3xl font-bold mb-1 mt-4 text-slate-900">{score} pts</h2>
        <div className="mb-4 flex justify-center">
          <RatingStars filled={stars} />
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-6">
          <DoneStat label="Moves"    value={moves} tone="amber" />
          <DoneStat label="Efficiency" value={`${efficiency}%`} tone="emerald" />
          <DoneStat label="Time"     value={formatTime(elapsed)} tone="sky" />
        </div>
        <SaveBanner saveResult={saveResult} />
        {levelChange?.after && (
          <div className="mt-4"><XpProgressBar progress={levelChange.after} gained={score} /></div>
        )}
        <SmartFeedback
          game={game}
          result={{ score, accuracy: efficiency, correct: moves, wrong: mismatches, bestStreak: 0 }}
          saveResult={saveResult}
        />
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <button
            type="button"
            onClick={onRestart}
            className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Play again
          </button>
          <ShareButton game={game} score={score} accuracy={efficiency} bestStreak={0} />
          <Link
            to={`/games/g/${game.grade}/${game.subject}`}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-4 py-2.5 text-sm"
          >
            More games
          </Link>
        </div>
      </div>

      <Leaderboard gameId={game.id} />
    </div>
  )
}

const PILL_TONE = {
  emerald: 'bg-emerald-100',
  amber:   'bg-amber-100',
  sky:     'bg-sky-100',
  slate:   'bg-slate-100',
}

function StatPill({ label, value, tone = 'slate' }) {
  return (
    <div className={`zx-card flex-1 rounded-[14px] px-3 py-2 text-center text-slate-900 ${PILL_TONE[tone] || PILL_TONE.slate}`}>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="font-display text-lg font-bold leading-none mt-1">{value}</div>
    </div>
  )
}
