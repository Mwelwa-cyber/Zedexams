import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowPathIcon,
  BoltIcon,
  CheckBadgeIcon,
  InboxStackIcon,
  TrophyIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid'
import { shuffle } from '../../../utils/gamesService'
import { playCorrect, playWrong, playWin, primeSounds } from '../lib/gameSounds'
import { useGameFinish } from '../hooks/useGameFinish'
import { SaveBanner, StreakBanner, DoneStat } from './DoneBanners'
import { LevelUpBanner, XpProgressBar, PersonalBestBanner } from './Progress'
import BadgeToast from './BadgeToast'
import ShareButton from './ShareButton'
import Confetti from '../../../shared/components/Confetti'
import Leaderboard from './Leaderboard'
import MascotCelebration from './MascotCelebration'
import MascotGreeting from './MascotGreeting'
import SmartFeedback from './SmartFeedback'
import { RatingStars } from './gamesUi'
import {
  matchesBin,
  multiplierFor,
  validateSortingContent,
} from '../lib/sortingFactoryCore'

const BIN_GRID = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
}

const BIN_TONES = [
  { idle: 'bg-blue-100', flash: 'ring-4 ring-blue-500' },
  { idle: 'bg-emerald-100', flash: 'ring-4 ring-emerald-500' },
  { idle: 'bg-amber-100', flash: 'ring-4 ring-amber-500' },
  { idle: 'bg-rose-100', flash: 'ring-4 ring-rose-500' },
]

/**
 * Engine for any `type: "sorting_factory"` game document.
 *
 * Items arrive one at a time and the player flicks each into the right bin
 * (2–4 bins, derived from the unique `answer` values). Consecutive correct
 * sorts build a combo multiplier (×2 at 4, ×3 at 8), so the round plays
 * like an arcade run. A wrong sort briefly lights up the right bin before
 * the next item — teaching through the mechanic, not a score screen.
 *
 * Optional `game.timer` (seconds) ends the round early, arcade-style.
 */
export default function SortingFactoryGame({ game }) {
  const points = Number(game.points) || 10
  const duration = Number(game.timer) || 0
  const content = useMemo(() => validateSortingContent(game.questions), [game.questions])

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [deck, setDeck] = useState([])
  const [pos, setPos] = useState(0)
  const [score, setScore] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [wrong, setWrong] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [flash, setFlash] = useState(null) // { bin, kind: 'correct' | 'reveal' }
  const [timeLeft, setTimeLeft] = useState(duration)
  const [confettiKey, setConfettiKey] = useState(0)
  const startRef = useRef(null)
  const advanceRef = useRef(null)
  const endedRef = useRef(false)
  // Mirror of the scoring state for endRound(), which can be called from
  // the countdown interval's closure where the state values are stale.
  const statsRef = useRef({ score: 0, correct: 0, wrong: 0, bestStreak: 0 })

  const { saveResult, newBadges, streakResult, levelChange, personalBest, finish, reset } = useGameFinish()

  // Countdown (only when the game doc sets a timer)
  useEffect(() => {
    if (phase !== 'playing' || duration <= 0) return
    const t = setInterval(() => {
      setTimeLeft((s) => {
        if (s <= 1) {
          clearInterval(t)
          endRound()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, duration])

  useEffect(() => () => clearTimeout(advanceRef.current), [])

  if (!content.ok) {
    return (
      <div className="zx-card rounded-[22px] bg-white p-10 text-center">
        <h2 className="font-display text-2xl font-bold text-slate-900">This sorting game is not set up yet</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">{content.reason}</p>
      </div>
    )
  }

  const { items, bins } = content
  const current = deck[pos] || null

  function start() {
    primeSounds()
    reset()
    clearTimeout(advanceRef.current)
    endedRef.current = false
    setDeck(shuffle(items, Date.now()))
    setPos(0)
    setScore(0)
    setCorrect(0)
    setWrong(0)
    setStreak(0)
    setBestStreak(0)
    setFlash(null)
    setTimeLeft(duration)
    statsRef.current = { score: 0, correct: 0, wrong: 0, bestStreak: 0 }
    startRef.current = Date.now()
    setPhase('playing')
  }

  function tapBin(bin) {
    if (!current || flash) return
    const stats = statsRef.current
    if (matchesBin(current, bin)) {
      playCorrect()
      const nextStreak = streak + 1
      stats.score += points * multiplierFor(nextStreak)
      stats.correct += 1
      stats.bestStreak = Math.max(stats.bestStreak, nextStreak)
      setStreak(nextStreak)
      setBestStreak(stats.bestStreak)
      setScore(stats.score)
      setCorrect(stats.correct)
      setFlash({ bin, kind: 'correct' })
      advanceRef.current = setTimeout(() => advance(pos), 350)
    } else {
      playWrong()
      stats.wrong += 1
      setStreak(0)
      setWrong(stats.wrong)
      // Light up the right bin so the miss itself teaches.
      const rightBin = bins.find((b) => matchesBin(current, b))
      setFlash({ bin: rightBin, kind: 'reveal' })
      advanceRef.current = setTimeout(() => advance(pos), 1100)
    }
  }

  function advance(fromPos) {
    setFlash(null)
    if (fromPos + 1 >= deck.length) endRound()
    else setPos(fromPos + 1)
  }

  async function endRound() {
    if (endedRef.current) return
    endedRef.current = true
    clearTimeout(advanceRef.current)
    playWin()
    setConfettiKey((k) => k + 1)
    setPhase('done')
    const stats = statsRef.current
    const attempted = stats.correct + stats.wrong
    const accuracy = Math.round((stats.correct / Math.max(attempted, 1)) * 100)
    const timeSpent = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : 0
    await finish({
      game,
      score: stats.score,
      correct: stats.correct,
      wrong: stats.wrong,
      accuracy,
      bestStreak: stats.bestStreak,
      timeSpent,
    })
  }

  if (phase === 'ready') {
    return <ReadyCard game={game} bins={bins} itemCount={items.length} points={points} duration={duration} onStart={start} />
  }
  if (phase === 'done') {
    const attempted = correct + wrong
    const accuracy = Math.round((correct / Math.max(attempted, 1)) * 100)
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={score}
          correct={correct}
          attempted={attempted}
          accuracy={accuracy}
          bestStreak={bestStreak}
          saveResult={saveResult}
          newBadges={newBadges}
          streakResult={streakResult}
          levelChange={levelChange}
          personalBest={personalBest}
          onRestart={start}
        />
      </>
    )
  }

  // Playing
  const multiplier = multiplierFor(streak)
  return (
    <div className="space-y-5">
      <div className="zx-card-dark flex items-center justify-between rounded-[22px] px-4 py-3">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-amber-300">
          Item {Math.min(pos + 1, deck.length)} of {deck.length}
        </span>
        <span className="text-sm font-black text-white">
          {duration > 0 && <span className="mr-3 text-amber-300">⏱ {timeLeft}s</span>}
          Score: <span className="text-amber-300">{score}</span>
          {multiplier > 1 && <span className="ml-2 rounded-full bg-amber-300 px-2 py-0.5 text-[11px] text-slate-900">×{multiplier} combo</span>}
        </span>
      </div>

      <div className="zx-card rounded-[22px] bg-white p-6 sm:p-8">
        <p className="text-center text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
          Sort this into the right bin
        </p>
        <div className="zx-card mx-auto mt-4 flex min-h-[5.5rem] max-w-md items-center justify-center rounded-[18px] bg-orange-50 px-6 py-5">
          <span className="font-display text-center text-2xl font-bold text-slate-900 sm:text-3xl">
            {current?.question}
          </span>
        </div>

        <div className={`mt-6 grid gap-3 ${BIN_GRID[bins.length] || BIN_GRID[4]}`}>
          {bins.map((bin, i) => {
            const tone = BIN_TONES[i % BIN_TONES.length]
            const isFlash = flash?.bin === bin
            return (
              <button
                key={bin}
                type="button"
                onClick={() => tapBin(bin)}
                disabled={!!flash}
                className={`zx-card rounded-[16px] px-3 py-5 font-black text-base sm:text-lg text-slate-900 transition active:translate-y-[2px] active:shadow-none ${tone.idle} ${isFlash ? tone.flash : ''}`}
              >
                <InboxStackIcon className="mx-auto mb-1.5 h-6 w-6" />
                {bin}
              </button>
            )
          })}
        </div>

        <p className="mt-4 min-h-[1.5rem] text-center text-sm font-bold">
          {flash?.kind === 'correct' && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckBadgeIcon className="h-4 w-4" />
              Sorted!{streak >= 4 && ` ${streak} in a row — combo ×${multiplier}!`}
            </span>
          )}
          {flash?.kind === 'reveal' && (
            <span className="inline-flex items-center gap-1.5 text-rose-700">
              <XCircleIcon className="h-4 w-4" />
              Not quite — it belongs in {flash.bin}.
            </span>
          )}
        </p>
      </div>
    </div>
  )
}

function ReadyCard({ game, bins, itemCount, points, duration, onStart }) {
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 text-center sm:p-10">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-emerald-100 text-slate-900">
        <InboxStackIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display mb-2 mt-4 text-3xl font-bold text-slate-900">{game.title}</h2>
      <p className="mx-auto mb-6 max-w-md text-slate-700">{game.description}</p>
      <ul className="mx-auto mb-7 max-w-sm space-y-1.5 text-left text-sm text-slate-700">
        <li>{itemCount} items to sort into: {bins.join(' · ')}</li>
        <li>+{points} points per correct sort</li>
        <li>4 in a row doubles your points, 8 in a row triples them!</li>
        {duration > 0 && <li>⏱ Beat the {duration}-second clock</li>}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <BoltIcon className="h-4 w-4" />
        Start sorting
      </button>
    </div>
  )
}

function DoneCard({ game, score, correct, attempted, accuracy, bestStreak, saveResult, newBadges, streakResult, levelChange, personalBest, onRestart }) {
  return (
    <div className="space-y-5">
      {levelChange?.leveledUp && <LevelUpBanner change={levelChange} />}
      {personalBest?.isBest && <PersonalBestBanner personalBest={personalBest} />}
      {streakResult?.isDaily && <StreakBanner result={streakResult} />}
      {newBadges?.length > 0 && <BadgeToast badges={newBadges} />}

      <div className="zx-card rounded-[22px] bg-white p-8 text-center">
        <MascotCelebration game={game} accuracy={accuracy} score={score} />
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-slate-900 text-white">
          <TrophyIcon className="h-8 w-8 text-amber-300" />
        </span>
        <h2 className="font-display mb-1 mt-4 text-3xl font-bold text-slate-900">{score} pts</h2>
        <div className="my-4 flex justify-center">
          <RatingStars filled={accuracy >= 90 ? 5 : accuracy >= 70 ? 4 : accuracy >= 50 ? 3 : 2} />
        </div>
        <div className="mx-auto my-5 grid max-w-md grid-cols-3 gap-3">
          <DoneStat label="Sorted"      value={`${correct}/${attempted}`} tone="emerald" />
          <DoneStat label="Accuracy"    value={`${accuracy}%`} tone="sky" />
          <DoneStat label="Best combo"  value={bestStreak} tone="rose" />
        </div>
        <SaveBanner saveResult={saveResult} />
        {levelChange?.after && (
          <div className="mt-4"><XpProgressBar progress={levelChange.after} gained={score} /></div>
        )}
        <SmartFeedback
          game={game}
          result={{ score, accuracy, correct, wrong: attempted - correct, bestStreak }}
          saveResult={saveResult}
        />
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onRestart}
            className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Play again
          </button>
          <ShareButton game={game} score={score} accuracy={accuracy} bestStreak={bestStreak} />
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
