import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  CalculatorIcon,
  CheckBadgeIcon,
  ForwardIcon,
  LightBulbIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { playCorrect, playWrong, playWin, playTick, primeSounds } from '../lib/gameSounds'
import { reportGameStart } from '../services/gamesService'
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
  applyOp,
  configForGame,
  formatStep,
  generateRound,
  invalidMoveHint,
} from '../lib/numberTargetCore'

/**
 * Engine for any `type: "number_target"` game document.
 *
 * Countdown-style maths: each round the player gets a set of number tiles
 * and must COMBINE them with + − × ÷ to hit a target number. Combining two
 * tiles consumes them and produces a new tile with the result, so the player
 * is building an expression, not picking an answer — every round is solvable
 * by construction (see numberTargetCore.js).
 *
 * Rounds are fully procedural: `game.questions` is ignored, so these games
 * need zero content authoring. Difficulty comes from `game.difficulty`
 * (easy | medium | hard) with a grade-band fallback, and `game.rounds` can
 * override the per-difficulty round count.
 */
export default function NumberTargetGame({ game }) {
  const points = Number(game.points) || 15
  const cfg = useMemo(() => configForGame(game), [game])
  const roundCount = Number(game.rounds) > 0 ? Number(game.rounds) : cfg.rounds

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [rounds, setRounds] = useState([])
  const [pos, setPos] = useState(0)
  const [history, setHistory] = useState([])   // stack of boards; board = [{ id, value }]
  const [selectedId, setSelectedId] = useState(null)
  const [op, setOp] = useState(null)
  const [hint, setHint] = useState(null)
  const [roundState, setRoundState] = useState('solve') // solve | solved | revealed
  const [solvedCount, setSolvedCount] = useState(0)
  const [cleanSolves, setCleanSolves] = useState(0)     // solved without undo/reset
  const [undosThisRound, setUndosThisRound] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [confettiKey, setConfettiKey] = useState(0)
  const startRef = useRef(null)
  const idRef = useRef(0)

  const { saveResult, newBadges, streakResult, levelChange, personalBest, finish, reset } = useGameFinish()

  const round = rounds[pos] || null
  const board = history[history.length - 1] || []

  function freshBoard(tiles) {
    return tiles.map((value) => ({ id: ++idRef.current, value }))
  }

  function start() {
    primeSounds()
    // Per ROUND, not per mount: "Play again" re-enters start() without
    // remounting, and saveScore() fires once per finished round.
    reportGameStart(game)
    reset()
    const generated = Array.from({ length: roundCount }, () => generateRound(cfg))
    setRounds(generated)
    setPos(0)
    setHistory([freshBoard(generated[0].tiles)])
    setSelectedId(null)
    setOp(null)
    setHint(null)
    setRoundState('solve')
    setSolvedCount(0)
    setCleanSolves(0)
    setUndosThisRound(0)
    setStreak(0)
    setBestStreak(0)
    startRef.current = Date.now()
    setPhase('playing')
  }

  function tapTile(cell) {
    if (roundState !== 'solve') return
    setHint(null)
    if (cell.id === selectedId) {
      setSelectedId(null)
      setOp(null)
      return
    }
    if (selectedId === null || op === null) {
      playTick()
      setSelectedId(cell.id)
      return
    }
    combine(cell)
  }

  function tapOp(nextOp) {
    if (roundState !== 'solve' || selectedId === null) return
    playTick()
    setHint(null)
    setOp(nextOp)
  }

  function combine(secondCell) {
    const firstCell = board.find((c) => c.id === selectedId)
    if (!firstCell) return
    const result = applyOp(firstCell.value, secondCell.value, op)
    if (result === null) {
      playWrong()
      setHint(invalidMoveHint(op))
      setOp(null)
      return
    }
    const merged = { id: ++idRef.current, value: result }
    const nextBoard = board
      .filter((c) => c.id !== firstCell.id && c.id !== secondCell.id)
      .concat(merged)
    setHistory((h) => [...h, nextBoard])
    setOp(null)

    if (result === round.target) {
      playCorrect()
      setSelectedId(null)
      setRoundState('solved')
      setSolvedCount((c) => c + 1)
      if (undosThisRound === 0) setCleanSolves((c) => c + 1)
      setStreak((s) => {
        const next = s + 1
        setBestStreak((b) => Math.max(b, next))
        return next
      })
    } else {
      playTick()
      // Keep the new tile selected so players can chain operations.
      setSelectedId(merged.id)
    }
  }

  function undo() {
    if (roundState !== 'solve' || history.length <= 1) return
    playTick()
    setHistory((h) => h.slice(0, -1))
    setSelectedId(null)
    setOp(null)
    setHint(null)
    setUndosThisRound((u) => u + 1)
  }

  function resetRound() {
    if (roundState !== 'solve' || history.length <= 1) return
    playTick()
    setHistory((h) => [h[0]])
    setSelectedId(null)
    setOp(null)
    setHint(null)
    setUndosThisRound((u) => u + 1)
  }

  function skip() {
    if (roundState !== 'solve') return
    playWrong()
    setRoundState('revealed')
    setSelectedId(null)
    setOp(null)
    setHint(null)
    setStreak(0)
  }

  async function nextRound() {
    if (pos + 1 >= rounds.length) {
      await endRound()
      return
    }
    const nextPos = pos + 1
    setPos(nextPos)
    setHistory([freshBoard(rounds[nextPos].tiles)])
    setSelectedId(null)
    setOp(null)
    setHint(null)
    setUndosThisRound(0)
    setRoundState('solve')
  }

  function computeScore(solved, clean) {
    return solved * points + clean * Math.round(points / 2)
  }

  async function endRound() {
    playWin()
    setConfettiKey((k) => k + 1)
    setPhase('done')
    const total = rounds.length
    const accuracy = Math.round((solvedCount / Math.max(total, 1)) * 100)
    const timeSpent = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : 0

    await finish({
      game,
      score: computeScore(solvedCount, cleanSolves),
      correct: solvedCount,
      wrong: total - solvedCount,
      accuracy,
      bestStreak,
      timeSpent,
    })
  }

  if (phase === 'ready') {
    return <ReadyCard game={game} cfg={cfg} roundCount={roundCount} points={points} onStart={start} />
  }
  if (phase === 'done') {
    const total = rounds.length
    const accuracy = Math.round((solvedCount / Math.max(total, 1)) * 100)
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={computeScore(solvedCount, cleanSolves)}
          solved={solvedCount}
          total={total}
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
  const firstValue = board.find((c) => c.id === selectedId)?.value ?? null
  const solved = roundState === 'solved'
  const revealed = roundState === 'revealed'
  const stuck = roundState === 'solve' && board.length === 1

  return (
    <div className="space-y-5">
      <div className="zx-card-dark flex items-center justify-between rounded-[22px] px-4 py-3">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-amber-300">
          Target {pos + 1} of {rounds.length}
        </span>
        <span className="text-sm font-black text-white">
          Solved: <span className="text-amber-300">{solvedCount}</span>
          {streak > 1 && <span className="ml-2 text-amber-300">🔥 {streak}</span>}
        </span>
      </div>

      <div className="zx-card rounded-[22px] bg-white p-6 sm:p-8">
        <p className="text-center text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
          Make this number
        </p>
        <p className={`font-display mt-1 text-center text-5xl font-bold sm:text-6xl ${solved ? 'text-emerald-600' : 'text-slate-900'}`}>
          {round.target}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {board.map((cell) => {
            const isSelected = cell.id === selectedId
            const isTarget = solved && cell.value === round.target
            return (
              <button
                key={cell.id}
                type="button"
                onClick={() => tapTile(cell)}
                disabled={solved || revealed}
                className={`zx-card min-w-[3.5rem] rounded-[12px] px-3 h-14 sm:h-16 font-black text-2xl sm:text-3xl transition active:translate-y-[2px] active:shadow-none ${
                  isTarget
                    ? 'bg-emerald-100 text-emerald-900'
                    : isSelected
                    ? 'bg-amber-200 text-slate-900 ring-2 ring-amber-500'
                    : 'bg-white text-slate-900'
                }`}
              >
                {cell.value}
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex justify-center gap-2">
          {cfg.ops.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => tapOp(o)}
              disabled={solved || revealed || selectedId === null}
              className={`h-12 w-12 rounded-[12px] border-2 border-slate-900 font-black text-xl transition sm:h-14 sm:w-14 sm:text-2xl ${
                op === o
                  ? 'bg-slate-900 text-amber-300'
                  : selectedId === null
                  ? 'bg-slate-50 text-slate-300'
                  : 'bg-blue-100 text-slate-900'
              }`}
            >
              {o}
            </button>
          ))}
        </div>

        <p className="mt-4 min-h-[1.5rem] text-center text-sm font-bold text-slate-500">
          {solved
            ? null
            : revealed
            ? null
            : hint
            ? <span className="text-rose-600">{hint}</span>
            : stuck
            ? 'Only one tile left and it is not the target — undo and try another way!'
            : firstValue === null
            ? 'Tap a number, then a sign, then another number.'
            : op === null
            ? `${firstValue} … now pick + − × ÷`
            : `${firstValue} ${op} … now tap the second number`}
        </p>

        {solved && (
          <div className="zx-card mt-4 rounded-[14px] bg-emerald-100 p-4 text-center font-bold text-emerald-900">
            <span className="inline-flex items-center gap-2">
              <CheckBadgeIcon className="h-5 w-5" />
              You made {round.target}!{undosThisRound === 0 && ' Clean solve — bonus points!'}
            </span>
          </div>
        )}
        {revealed && (
          <div className="zx-card mt-4 rounded-[14px] bg-sky-100 p-4 text-center text-sky-900">
            <span className="inline-flex items-center gap-2 font-bold">
              <LightBulbIcon className="h-5 w-5" />
              One way to make {round.target}:
            </span>
            <div className="mt-2 flex flex-wrap justify-center gap-2 font-black">
              {round.recipe.map((step, i) => (
                <span key={i} className="rounded-full border-[1.5px] border-sky-900/30 bg-white/70 px-3 py-1 text-sm">
                  {formatStep(step)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={solved || revealed || history.length <= 1}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-3.5 py-2.5 text-sm"
          >
            <ArrowUturnLeftIcon className="h-4 w-4" />
            Undo
          </button>
          <button
            type="button"
            onClick={resetRound}
            disabled={solved || revealed || history.length <= 1}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-3.5 py-2.5 text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Start over
          </button>
        </div>
        {solved || revealed ? (
          <button
            type="button"
            onClick={nextRound}
            className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
          >
            {pos + 1 >= rounds.length ? 'Finish round' : 'Next target'}
          </button>
        ) : (
          <button
            type="button"
            onClick={skip}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-3.5 py-2.5 text-sm"
          >
            <ForwardIcon className="h-4 w-4" />
            Show me &amp; skip
          </button>
        )}
      </div>
    </div>
  )
}

function ReadyCard({ game, cfg, roundCount, points, onStart }) {
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 text-center sm:p-10">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-orange-100 text-slate-900">
        <CalculatorIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display mb-2 mt-4 text-3xl font-bold text-slate-900">{game.title}</h2>
      <p className="mx-auto mb-6 max-w-md text-slate-700">{game.description}</p>
      <ul className="mx-auto mb-7 max-w-sm space-y-1.5 text-left text-sm text-slate-700">
        <li>{roundCount} target numbers to make</li>
        <li>Combine number tiles with {cfg.ops.join(' ')} — two tiles become one</li>
        <li>+{points} points per target, bonus for solving without undo</li>
        <li>Every target CAN be made — keep trying combinations!</li>
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <CalculatorIcon className="h-4 w-4" />
        Start crunching
      </button>
    </div>
  )
}

function DoneCard({ game, score, solved, total, accuracy, bestStreak, saveResult, newBadges, streakResult, levelChange, personalBest, onRestart }) {
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
          <DoneStat label="Targets"     value={`${solved}/${total}`} tone="emerald" />
          <DoneStat label="Accuracy"    value={`${accuracy}%`} tone="sky" />
          <DoneStat label="Best streak" value={bestStreak} tone="rose" />
        </div>
        <SaveBanner saveResult={saveResult} />
        {levelChange?.after && (
          <div className="mt-4"><XpProgressBar progress={levelChange.after} gained={score} /></div>
        )}
        <SmartFeedback
          game={game}
          result={{ score, accuracy, correct: solved, wrong: total - solved, bestStreak }}
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
