import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { saveScore, shuffle } from '../../utils/gamesService'
import { evaluateAndAwardGameBadges } from '../../utils/gameBadgesService'
import { getTodaysChallenge, recordDailyPlay } from '../../utils/dailyChallengeService'
import { playCorrect, playWrong, playWin, primeSounds } from '../../utils/gameSounds'
import Leaderboard from './Leaderboard'
import BadgeToast from './BadgeToast'
import ShareButton from './ShareButton'
import Confetti from './Confetti'
import SmartFeedback from './SmartFeedback'

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
  const pool = useMemo(() => game.questions || [], [game.id])

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

      <div className="grid grid-cols-3 gap-2">
        <Pill label="Score"  value={score}   tone="amber" />
        <Pill label="Streak" value={streak}  tone="emerald" />
        <Pill label="Wrong"  value={wrong}   tone="slate" />
      </div>

      <div
        key={`card-${seed}-${questionNo}`}
        className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-6 sm:p-8"
        style={{ animation: 'zx-question-in 0.3s ease-out both' }}
      >
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 mb-3">
          Question #{questionNo + 1}
        </p>
        <h2 className="text-2xl sm:text-3xl font-black leading-tight mb-6">
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

      <style>{`
        @keyframes zx-question-in {
          0%   { transform: translateY(8px) scale(0.98); opacity: 0; }
          100% { transform: translateY(0)    scale(1);    opacity: 1; }
        }
      `}</style>
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
    <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-8 sm:p-10 text-center">
      <div className="text-6xl mb-3">⚡</div>
      <h2 className="text-3xl font-black mb-2">{game.title}</h2>
      <p className="text-slate-700 max-w-md mx-auto mb-6">
        {game.description}
      </p>
      <ul className="text-sm text-slate-700 max-w-sm mx-auto text-left mb-7 space-y-1.5">
        <li>⏱️ <b>{game.timer}s</b> on the clock</li>
        <li>🎯 <b>+{game.points}</b> per correct, plus a streak bonus</li>
        <li>❌ Small penalty for wrong answers</li>
        {currentUser
          ? <li>🏅 Your score saves automatically to the leaderboard</li>
          : <li>🏅 Sign in to save your score and climb the leaderboard</li>}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="px-6 py-3.5 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-md text-lg"
      >
        Start sprint 🚀
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

      <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-8 text-center">
        <div className="text-6xl mb-2">🏁</div>
        <h2 className="text-3xl font-black mb-1">{score} pts</h2>
        <p className="text-slate-600 mb-6">Final score</p>
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-6">
          <Stat label="Correct"     value={correct} tone="emerald" />
          <Stat label="Accuracy"    value={`${accuracy}%`} tone="amber" />
          <Stat label="Best streak" value={bestStreak} tone="rose" />
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
            className="px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500"
          >
            Play again 🔁
          </button>
          <ShareButton game={game} score={score} accuracy={accuracy} bestStreak={bestStreak} />
          <Link
            to={`/games/g/${game.grade}/${game.subject}`}
            className="px-5 py-3 rounded-xl font-black text-slate-900 bg-white border-2 border-slate-200 hover:border-slate-400"
          >
            More {game.subject} games
          </Link>
        </div>
      </div>

      <Leaderboard gameId={game.id} />
    </div>
  )
}

function StreakBanner({ result }) {
  const onFire = (result.streak || 0) >= 3
  if (result.wasAlreadyCountedToday) {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 sm:p-5 flex items-center gap-4">
        <div className="text-4xl shrink-0" aria-hidden="true">⭐</div>
        <div className="flex-1">
          <p className="font-black text-amber-900 text-lg leading-tight">
            Daily challenge already ticked today
          </p>
          <p className="text-sm text-amber-800">
            Your streak is still <b>{result.streak} day{result.streak === 1 ? '' : 's'}</b>.
            Come back tomorrow for the next challenge.
          </p>
        </div>
      </div>
    )
  }
  if (result.bumped) {
    return (
      <div className={`rounded-2xl border-2 p-4 sm:p-5 flex items-center gap-4 ${onFire ? 'border-rose-400 bg-rose-50' : 'border-amber-300 bg-amber-50'}`}>
        <div className="text-5xl shrink-0" aria-hidden="true">{onFire ? '🔥' : '⭐'}</div>
        <div className="flex-1">
          <p className={`font-black text-lg leading-tight ${onFire ? 'text-rose-900' : 'text-amber-900'}`}>
            Daily streak: {result.streak} day{result.streak === 1 ? '' : 's'}!
          </p>
          <p className={`text-sm ${onFire ? 'text-rose-800' : 'text-amber-800'}`}>
            {result.streak === 1
              ? 'A new streak has begun. Play again tomorrow to keep it alive.'
              : onFire
                ? `You're on fire! Longest streak ever: ${result.longestStreak} days.`
                : `Nice run — longest streak ever: ${result.longestStreak} days.`}
          </p>
        </div>
      </div>
    )
  }
  return null
}

function SaveBanner({ saveResult }) {
  const { currentUser } = useAuth()
  if (!saveResult) return <p className="text-sm text-slate-500">Saving your score…</p>
  if (saveResult.ok) {
    return (
      <p className="text-sm text-emerald-700 font-bold">
        ✅ Score saved to your history.
      </p>
    )
  }
  if (saveResult.skipped && saveResult.reason === 'not_signed_in') {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
        Sign in to save this score and appear on the leaderboard.{' '}
        <Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`} className="font-black underline">
          Sign in →
        </Link>
        {currentUser && <span> (currently signed in as {currentUser.email})</span>}
      </div>
    )
  }
  return (
    <p className="text-sm text-rose-700 font-bold">
      Couldn't save score: {saveResult.reason || 'unknown error'}
    </p>
  )
}

function TimerBar({ timeLeft, pct }) {
  const danger = timeLeft <= 10
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`h-full transition-all ${danger ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-500 to-teal-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`w-16 text-center font-black text-2xl tabular-nums ${danger ? 'text-rose-600 animate-pulse' : 'text-slate-900'}`}>
        {timeLeft}s
      </div>
    </div>
  )
}

const TONE = {
  emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  amber:   'bg-amber-50 text-amber-900 border-amber-200',
  rose:    'bg-rose-50 text-rose-900 border-rose-200',
  slate:   'bg-slate-50 text-slate-900 border-slate-200',
}

function Pill({ label, value, tone = 'slate' }) {
  return (
    <div className={`rounded-xl border-2 px-3 py-2 text-center ${TONE[tone]}`}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-black">{value}</div>
    </div>
  )
}

function Stat({ label, value, tone = 'slate' }) {
  return (
    <div className={`rounded-xl border-2 p-4 ${TONE[tone]}`}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-black">{value}</div>
    </div>
  )
}

function Choice({ label, letter, picked, isPicked, isAnswer, onClick }) {
  let cls = 'border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50'
  if (picked !== null) {
    if (isAnswer) cls = 'border-emerald-400 bg-emerald-50 text-emerald-900'
    else if (isPicked) cls = 'border-rose-400 bg-rose-50 text-rose-900'
    else cls = 'border-slate-200 bg-slate-50 opacity-60'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={picked !== null}
      className={`w-full flex items-center gap-3 text-left p-4 rounded-xl border-2 font-bold text-lg transition ${cls}`}
    >
      <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center font-black text-slate-700">
        {letter}
      </span>
      <span className="flex-1 leading-tight">{label}</span>
    </button>
  )
}
