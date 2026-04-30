import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BoltIcon,
  ArrowPathIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { useAuth } from '../../contexts/AuthContext'
import { saveScore, shuffle } from '../../utils/gamesService'
import { evaluateAndAwardGameBadges } from '../../utils/gameBadgesService'
import { getTodaysChallenge, recordDailyPlay } from '../../utils/dailyChallengeService'
import { playCorrect, playWrong, playWin, primeSounds } from '../../utils/gameSounds'
import Leaderboard from './Leaderboard'
import BadgeToast from './BadgeToast'
import ShareButton from './ShareButton'
import Confetti from './Confetti'
import MascotCelebration from './MascotCelebration'
import MascotGreeting from './MascotGreeting'
import SmartFeedback from './SmartFeedback'
import { DoneStat, SaveBanner, StreakBanner } from './DoneBanners'
import { RatingStars } from './gamesUi'

/**
 * Engine for any `type: "timed_quiz"` game document.
 *
 * Mechanics:
 *   1. The player sees a "Ready?" splash that explains the rules.
 *   2. On start, the global timer (`game.timer` seconds) begins counting
 *      down. Questions are drawn from a shuffled deck of game.questions.
 *      When the deck runs out, it gets reshuffled — and we make sure the
 *      first question of the new deck is NOT the same as the last question
 *      of the old deck, so nothing ever feels like an immediate repeat.
 *   3. The score is points-per-correct (`game.points`) minus a small
 *      penalty for wrong answers, with a streak bonus.
 *   4. On time-up the player sees their stats, the leaderboard, and a
 *      sign-in nudge if their score wasn't saved.
 */
export default function TimedQuizGame({ game }) {
  const points = Number(game.points) || 10
  const duration = Number(game.timer) || 60
  const pool = useMemo(() => game.questions || [], [game.questions])

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [seed, setSeed] = useState(0)
  const [deck, setDeck] = useState(() => shuffle(pool, Date.now()))
  const [pos, setPos] = useState(0)
  const [questionNo, setQuestionNo] = useState(0) // total questions seen in this round
  const [picked, setPicked] = useState(null)
  const [revealedAt, setRevealedAt] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [wrong, setWrong] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(duration)
  const [saveResult, setSaveResult] = useState(null)
  const [newBadges, setNewBadges] = useState([])
  const [streakResult, setStreakResult] = useState(null)
  const [confettiKey, setConfettiKey] = useState(0)
  const startedAtRef = useRef(null)

  // Countdown
  useEffect(() => {
    if (phase !== 'playing') return
    if (timeLeft <= 0) { finish(); return }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft])

  // Auto-advance after a brief reveal beat (simulates quiz feel)
  useEffect(() => {
    if (picked === null) return
    const t = setTimeout(() => {
      advanceToNextQuestion()
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedAt])

  function advanceToNextQuestion() {
    setPicked(null)
    setQuestionNo((n) => n + 1)
    const nextPos = pos + 1
    if (nextPos >= deck.length) {
      // Deck exhausted — reshuffle. If the freshly shuffled deck happens to
      // start with the same question we just answered, rotate by one so we
      // never see an immediate back-to-back repeat.
      const justAsked = deck[pos]?.question
      let fresh = shuffle(pool, Date.now() + Math.random() * 9999)
      if (fresh.length > 1 && fresh[0]?.question === justAsked) {
        fresh = [fresh[1], fresh[0], ...fresh.slice(2)]
      }
      setDeck(fresh)
      setPos(0)
    } else {
      setPos(nextPos)
    }
  }

  function start() {
    primeSounds()
    setSeed((s) => s + 1)
    setPhase('playing')
    setDeck(shuffle(pool, Date.now()))
    setPos(0)
    setQuestionNo(0)
    setPicked(null)
    setCorrect(0)
    setWrong(0)
    setStreak(0)
    setBestStreak(0)
    setScore(0)
    setTimeLeft(duration)
    setSaveResult(null)
    setNewBadges([])
    setStreakResult(null)
    startedAtRef.current = Date.now()
  }

  function pick(i) {
    if (phase !== 'playing' || picked !== null) return
    const q = currentQuestion()
    const correctIdx = q.options.findIndex((o) => String(o) === String(q.answer))
    setPicked(i)
    setRevealedAt(Date.now())
    if (i === correctIdx) {
      playCorrect()
      const newStreak = streak + 1
      const bonus = Math.min(5, Math.floor(newStreak / 3))
      const gained = points + bonus
      setCorrect((c) => c + 1)
      setStreak(newStreak)
      if (newStreak > bestStreak) setBestStreak(newStreak)
      setScore((s) => s + gained)
    } else {
      playWrong()
      const penalty = Math.max(2, Math.floor(points / 4))
      setWrong((w) => w + 1)
      setStreak(0)
      setScore((s) => Math.max(0, s - penalty))
    }
  }

  async function finish() {
    setPhase('done')
    const total = correct + wrong
    const accuracy = total ? Math.round((correct / total) * 100) : 0
    const timeSpent = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : duration
    // Celebrate if they played well
    if (score >= 50 || accuracy >= 80) {
      playWin()
      setConfettiKey((k) => k + 1)
    }
    const result = await saveScore({
      game,
      score,
      accuracy,
      timeSpent,
      correct,
      wrong,
      bestStreak,
    })
    setSaveResult(result)

    // Only evaluate/award badges if the score actually saved (i.e. signed in).
    if (result?.ok) {
      try {
        const { newlyEarned } = await evaluateAndAwardGameBadges({
          game, score, correct, wrong, accuracy, bestStreak,
        })
        if (newlyEarned?.length) {
          setNewBadges(newlyEarned)
          playWin()
          setConfettiKey((k) => k + 1)
        }
      } catch (err) {
        console.warn('badge evaluation failed', err)
      }

      // Check if this game is today's daily challenge — if so, bump streak.
      try {
        const { game: todaysGame } = await getTodaysChallenge()
        if (todaysGame?.id) {
          const streakOutcome = await recordDailyPlay({
            gameId: game.id,
            dailyGameId: todaysGame.id,
          })
          if (streakOutcome.isDaily) setStreakResult(streakOutcome)
        }
      } catch (err) {
        console.warn('daily streak update failed', err)
      }
    }
  }

  if (phase === 'ready') return <ReadyCard game={game} onStart={start} />
  if (phase === 'done') {
    const total = correct + wrong
    const accuracy = total ? Math.round((correct / total) * 100) : 0
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={score}
          correct={correct}
          wrong={wrong}
          accuracy={accuracy}
          bestStreak={bestStreak}
          saveResult={saveResult}
          newBadges={newBadges}
          streakResult={streakResult}
          onRestart={start}
        />
      </>
    )
  }

  const q = currentQuestion()
  const correctIdx = q.options.findIndex((o) => String(o) === String(q.answer))
  const pct = Math.max(0, Math.round((timeLeft / duration) * 100))

  return (
    <div className="space-y-5">
      <TimerBar timeLeft={timeLeft} pct={pct} />

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Pill label="Score"  value={score}   tone="amber" />
        <Pill label="Streak" value={streak}  tone="emerald" />
        <Pill label="Wrong"  value={wrong}   tone="rose" />
      </div>

      <div
        key={`card-${seed}-${questionNo}`}
        className="zx-card rounded-[22px] bg-white p-6 sm:p-8"
        style={{ animation: 'zx-question-in 0.3s ease-out both' }}
      >
        <p className="zx-eyebrow mb-3">Question #{questionNo + 1}</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold leading-tight mb-6 text-slate-900">
          {q.question}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" key={`${seed}-${questionNo}`}>
          {q.options.map((opt, i) => (
            <Choice
              key={`${seed}-${questionNo}-${i}`}
              label={opt}
              letter={String.fromCharCode(65 + i)}
              picked={picked}
              isPicked={picked === i}
              isAnswer={correctIdx === i}
              onClick={() => pick(i)}
            />
          ))}
        </div>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={finish}
          className="text-sm font-bold text-slate-500 hover:text-slate-900 underline"
        >
          End round early
        </button>
      </div>
    </div>
  )

  function currentQuestion() {
    return deck[pos] || { question: '', options: [], answer: '' }
  }
}

/* ── Sub-components ─────────────────────────────────────────────── */

function ReadyCard({ game, onStart }) {
  const { currentUser } = useAuth()
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 sm:p-10 text-center">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-orange-100 text-slate-900">
        <BoltIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display text-3xl font-bold mb-2 mt-4 text-slate-900">{game.title}</h2>
      <p className="text-slate-700 max-w-md mx-auto mb-6">
        {game.description}
      </p>
      <ul className="text-sm text-slate-700 max-w-sm mx-auto text-left mb-7 space-y-1.5">
        <li><b>{game.timer}s</b> on the clock</li>
        <li><b>+{game.points}</b> per correct answer, plus streak bonus points</li>
        <li>Small penalties apply for wrong answers</li>
        {currentUser
          ? <li>Your score saves automatically to the leaderboard</li>
          : <li>Sign in to save your score and climb the leaderboard</li>}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <BoltIcon className="h-4 w-4" />
        Start sprint
      </button>
      <p className="mt-5 text-xs text-slate-500">Tip: tap the answer or use the A / B / C / D keys.</p>
    </div>
  )
}

function DoneCard({ game, score, correct, wrong, accuracy, bestStreak, saveResult, newBadges, streakResult, onRestart }) {
  return (
    <div className="space-y-5">
      {streakResult?.isDaily && <StreakBanner result={streakResult} />}
      {newBadges?.length > 0 && <BadgeToast badges={newBadges} />}

      <div className="zx-card rounded-[22px] bg-white p-8 text-center">
        <MascotCelebration game={game} accuracy={accuracy} score={score} />
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-slate-900 text-white">
          <TrophyIcon className="h-8 w-8 text-amber-300" />
        </span>
        <h2 className="font-display text-3xl font-bold mb-1 mt-4 text-slate-900">{score} pts</h2>
        <p className="text-slate-600 mb-6">Final score</p>
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-6">
          <DoneStat label="Correct" value={correct} tone="emerald" />
          <DoneStat label="Accuracy" value={`${accuracy}%`} tone="amber" />
          <DoneStat label="Best streak" value={bestStreak} tone="rose" />
        </div>
        <div className="mb-4 flex justify-center">
          <RatingStars filled={accuracy >= 90 ? 5 : accuracy >= 70 ? 4 : accuracy >= 50 ? 3 : 2} />
        </div>
        <SaveBanner saveResult={saveResult} />
        <SmartFeedback
          game={game}
          result={{ score, accuracy, correct, wrong, bestStreak }}
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
          <ShareButton game={game} score={score} accuracy={accuracy} bestStreak={bestStreak} />
          <Link
            to={`/games/g/${game.grade}/${game.subject}`}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-4 py-2.5 text-sm"
          >
            More {game.subject} games
          </Link>
        </div>
      </div>

      <Leaderboard gameId={game.id} />
    </div>
  )
}

function TimerBar({ timeLeft, pct }) {
  const danger = timeLeft <= 10
  return (
    <div className="zx-card-dark flex items-center gap-3 rounded-[22px] px-4 py-3">
      <div className="flex-1 h-3 rounded-full bg-white/15 overflow-hidden border border-white/10">
        <div
          className={`h-full transition-all ${danger ? 'bg-rose-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`w-16 text-center font-display font-bold text-2xl tabular-nums ${danger ? 'text-rose-300 animate-pulse' : 'text-white'}`}>
        {timeLeft}s
      </div>
    </div>
  )
}

const PILL_TONE = {
  emerald: 'bg-emerald-100',
  amber:   'bg-amber-100',
  rose:    'bg-rose-100',
  slate:   'bg-slate-100',
}

function Pill({ label, value, tone = 'slate' }) {
  return (
    <div className={`zx-card rounded-[14px] px-3 py-2 text-center text-slate-900 ${PILL_TONE[tone]}`}>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="font-display text-xl font-bold leading-none mt-1">{value}</div>
    </div>
  )
}

function Choice({ label, letter, picked, isPicked, isAnswer, onClick }) {
  let cls = 'bg-white text-slate-900'
  if (picked !== null) {
    if (isAnswer) cls = 'bg-emerald-100 text-emerald-900'
    else if (isPicked) cls = 'bg-rose-100 text-rose-900'
    else cls = 'bg-slate-50 text-slate-500 opacity-70'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={picked !== null}
      className={`zx-card w-full flex items-center gap-3 text-left p-4 rounded-[14px] font-bold text-lg transition active:translate-y-[2px] active:shadow-none ${cls}`}
    >
      <span className="shrink-0 w-9 h-9 rounded-[10px] border-2 border-slate-900 bg-white flex items-center justify-center font-black text-slate-900">
        {letter}
      </span>
      <span className="flex-1 leading-tight">{label}</span>
    </button>
  )
}
