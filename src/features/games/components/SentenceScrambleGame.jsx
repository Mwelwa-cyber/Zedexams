import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowPathIcon,
  CheckBadgeIcon,
  QueueListIcon,
  TrophyIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid'
import { shuffle, reportGameStart } from '../services/gamesService'
import { playCorrect, playWrong, playWin, playTick, primeSounds } from '../lib/gameSounds'
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
  isCorrectOrder,
  scrambleTokens,
  validateScrambleContent,
} from '../lib/sentenceScrambleCore'

/**
 * Engine for any `type: "sentence_scramble"` game document.
 *
 * Word/step tiles arrive shuffled and the player taps them into order to
 * rebuild a sentence — or, when the answer uses '|' separators, to order
 * the steps of a process (water cycle, life cycles, farming steps). Tap a
 * placed tile to take it back. The round is built on sequencing, not
 * recall: the player always has all the pieces, the work is arranging them.
 *
 * Mirrors WordBuilderGame's slot/tile interaction so the two feel related,
 * just at word level instead of letter level.
 */
export default function SentenceScrambleGame({ game }) {
  const points = Number(game.points) || 10
  const content = useMemo(() => validateScrambleContent(game.questions), [game.questions])

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [order, setOrder] = useState([])
  const [pos, setPos] = useState(0)
  const [tiles, setTiles] = useState([])     // [{ word, placed }]
  const [slots, setSlots] = useState([])     // tileIdx or null
  const [solvedThisItem, setSolvedThisItem] = useState(false)
  const [cleanThisItem, setCleanThisItem] = useState(true)
  const [solvedCount, setSolvedCount] = useState(0)
  const [cleanCount, setCleanCount] = useState(0)
  const [mistakes, setMistakes] = useState(0)
  const [confettiKey, setConfettiKey] = useState(0)
  const startRef = useRef(null)

  const { saveResult, newBadges, streakResult, levelChange, personalBest, finish, reset } = useGameFinish()

  const items = content.ok ? content.items : []
  const current = items[order[pos] ?? 0] || { question: '', answer: '', tokens: [] }

  // Re-deal tiles whenever the item changes
  useEffect(() => {
    if (phase !== 'playing' || !current.tokens.length) return
    setTiles(scrambleTokens(current.tokens).map((word) => ({ word, placed: false })))
    setSlots(Array(current.tokens.length).fill(null))
    setSolvedThisItem(false)
    setCleanThisItem(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, order, pos])

  if (!content.ok) {
    return (
      <div className="zx-card rounded-[22px] bg-white p-10 text-center">
        <h2 className="font-display text-2xl font-bold text-slate-900">This scramble game is not set up yet</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">{content.reason}</p>
      </div>
    )
  }

  function start() {
    primeSounds()
    // Per ROUND, not per mount: "Play again" re-enters start() without
    // remounting, and saveScore() fires once per finished round.
    reportGameStart(game)
    reset()
    setOrder(shuffle(items.map((_, i) => i), Date.now()))
    setPos(0)
    setSolvedCount(0)
    setCleanCount(0)
    setMistakes(0)
    startRef.current = Date.now()
    setPhase('playing')
  }

  function placeTile(tileIdx) {
    if (solvedThisItem || tiles[tileIdx]?.placed) return
    const emptySlot = slots.findIndex((v) => v === null)
    if (emptySlot === -1) return
    playTick()
    const nextSlots = slots.slice()
    nextSlots[emptySlot] = tileIdx
    setSlots(nextSlots)
    const nextTiles = tiles.slice()
    nextTiles[tileIdx] = { ...nextTiles[tileIdx], placed: true }
    setTiles(nextTiles)

    if (nextSlots.every((v) => v !== null)) {
      const placed = nextSlots.map((idx) => nextTiles[idx].word)
      if (isCorrectOrder(placed, current.tokens)) {
        playCorrect()
        setSolvedThisItem(true)
        setSolvedCount((c) => c + 1)
        if (cleanThisItem) setCleanCount((c) => c + 1)
      } else {
        playWrong()
        setCleanThisItem(false)
        setMistakes((m) => m + 1)
      }
    }
  }

  function removeFromSlot(slotIdx) {
    if (solvedThisItem || slots[slotIdx] === null) return
    playTick()
    const tileIdx = slots[slotIdx]
    const nextSlots = slots.slice()
    nextSlots[slotIdx] = null
    setSlots(nextSlots)
    const nextTiles = tiles.slice()
    nextTiles[tileIdx] = { ...nextTiles[tileIdx], placed: false }
    setTiles(nextTiles)
  }

  function clearAll() {
    if (solvedThisItem) return
    setSlots(Array(current.tokens.length).fill(null))
    setTiles(tiles.map((t) => ({ ...t, placed: false })))
  }

  function computeScore(solved, clean) {
    return solved * points + clean * Math.round(points / 2)
  }

  async function nextItem() {
    if (pos + 1 >= order.length) {
      await endRound()
    } else {
      setPos(pos + 1)
    }
  }

  async function endRound() {
    playWin()
    setConfettiKey((k) => k + 1)
    setPhase('done')
    const total = order.length
    const accuracy = Math.round((solvedCount / Math.max(total, 1)) * 100)
    const timeSpent = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : 0
    await finish({
      game,
      score: computeScore(solvedCount, cleanCount),
      correct: solvedCount,
      wrong: total - solvedCount,
      accuracy,
      bestStreak: solvedCount,
      timeSpent,
    })
  }

  if (phase === 'ready') {
    return <ReadyCard game={game} itemCount={items.length} points={points} onStart={start} />
  }
  if (phase === 'done') {
    const total = order.length
    const accuracy = Math.round((solvedCount / Math.max(total, 1)) * 100)
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={computeScore(solvedCount, cleanCount)}
          solved={solvedCount}
          total={total}
          accuracy={accuracy}
          mistakes={mistakes}
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
  const isSequence = String(current.answer).includes('|')
  const allFilled = slots.every((v) => v !== null)
  const isWrong = allFilled && !solvedThisItem

  return (
    <div className="space-y-5">
      <div className="zx-card-dark flex items-center justify-between rounded-[22px] px-4 py-3">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-amber-300">
          {isSequence ? 'Sequence' : 'Sentence'} {pos + 1} of {order.length}
        </span>
        <span className="text-sm font-black text-white">
          Solved: <span className="text-amber-300">{solvedCount}</span>
        </span>
      </div>

      <div className="zx-card rounded-[22px] bg-white p-6 sm:p-8">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-[14px] border-2 border-slate-900 bg-blue-100 text-slate-900">
          <QueueListIcon className="h-6 w-6" />
        </span>
        <p className="mb-6 text-center font-bold text-slate-700">
          {current.question || (isSequence ? 'Put the steps in the right order.' : 'Arrange the words to make a sentence.')}
        </p>

        {/* Slots — tap to take a tile back */}
        <div className={`mb-6 flex flex-wrap justify-center gap-2 ${isSequence ? 'flex-col items-stretch sm:mx-auto sm:max-w-md' : ''}`}>
          {slots.map((tileIdx, i) => {
            const word = tileIdx !== null ? tiles[tileIdx].word : ''
            const tone = solvedThisItem
              ? 'bg-emerald-100 text-emerald-900'
              : isWrong
              ? 'bg-rose-100 text-rose-900'
              : word
              ? 'bg-blue-100 text-slate-900'
              : 'bg-slate-50 border-dashed text-slate-400'
            return (
              <button
                key={i}
                type="button"
                onClick={() => removeFromSlot(i)}
                className={`min-h-[2.75rem] rounded-[12px] border-2 border-slate-900 px-3 py-2 text-base font-black transition sm:text-lg ${tone}`}
              >
                {isSequence && <span className="mr-2 text-xs opacity-60">{i + 1}.</span>}
                {word || '…'}
              </button>
            )
          })}
        </div>

        {/* Tiles — tap to place into the next empty slot */}
        <div className="flex flex-wrap justify-center gap-2">
          {tiles.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => placeTile(i)}
              disabled={t.placed || solvedThisItem}
              className={`zx-card rounded-[12px] px-3 py-2 text-base font-black transition active:translate-y-[2px] active:shadow-none sm:text-lg ${
                t.placed ? 'bg-slate-100 text-slate-300 opacity-60' : 'bg-white text-slate-900'
              }`}
            >
              {t.word}
            </button>
          ))}
        </div>

        {solvedThisItem && (
          <div className="zx-card mt-6 rounded-[14px] bg-emerald-100 p-4 text-center font-bold text-emerald-900">
            <span className="inline-flex items-center gap-2">
              <CheckBadgeIcon className="h-5 w-5" />
              Perfect order!{cleanThisItem && ' First try — bonus points!'}
            </span>
          </div>
        )}
        {isWrong && (
          <div className="zx-card mt-6 rounded-[14px] bg-rose-100 p-4 text-center font-bold text-rose-900">
            <span className="inline-flex items-center gap-2">
              <XCircleIcon className="h-5 w-5" />
              Not quite. Tap a tile above to take it back and try again.
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-3">
        <button
          type="button"
          onClick={clearAll}
          disabled={solvedThisItem}
          className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-3.5 py-2.5 text-sm"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={nextItem}
          disabled={!solvedThisItem && !isWrong}
          className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
        >
          {pos + 1 >= order.length ? 'Finish round' : 'Next one'}
        </button>
      </div>
    </div>
  )
}

function ReadyCard({ game, itemCount, points, onStart }) {
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 text-center sm:p-10">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-blue-100 text-slate-900">
        <QueueListIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display mb-2 mt-4 text-3xl font-bold text-slate-900">{game.title}</h2>
      <p className="mx-auto mb-6 max-w-md text-slate-700">{game.description}</p>
      <ul className="mx-auto mb-7 max-w-sm space-y-1.5 text-left text-sm text-slate-700">
        <li>{itemCount} scrambles to solve</li>
        <li>Tap the tiles in the right order — tap a placed tile to take it back</li>
        <li>+{points} points each, bonus for solving on the first try</li>
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <QueueListIcon className="h-4 w-4" />
        Start arranging
      </button>
    </div>
  )
}

function DoneCard({ game, score, solved, total, accuracy, mistakes, saveResult, newBadges, streakResult, levelChange, personalBest, onRestart }) {
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
          <DoneStat label="Solved"   value={`${solved}/${total}`} tone="emerald" />
          <DoneStat label="Accuracy" value={`${accuracy}%`} tone="sky" />
          <DoneStat label="Retries"  value={mistakes} tone="rose" />
        </div>
        <SaveBanner saveResult={saveResult} />
        {levelChange?.after && (
          <div className="mt-4"><XpProgressBar progress={levelChange.after} gained={score} /></div>
        )}
        <SmartFeedback
          game={game}
          result={{ score, accuracy, correct: solved, wrong: total - solved, bestStreak: solved }}
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
          <ShareButton game={game} score={score} accuracy={accuracy} bestStreak={solved} />
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
