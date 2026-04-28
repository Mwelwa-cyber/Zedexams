import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BoltIcon,
  ArrowPathIcon,
  TrophyIcon,
  MapPinIcon,
} from '@heroicons/react/24/solid'
import { useAuth } from '../../contexts/AuthContext'
import { saveScore, shuffle } from '../../utils/gamesService'
import { evaluateAndAwardGameBadges } from '../../utils/gameBadgesService'
import { getTodaysChallenge, recordDailyPlay } from '../../utils/dailyChallengeService'
import { playCorrect, playWrong, playWin, primeSounds } from '../../utils/gameSounds'
import { buildStaticMapUrl } from '../../utils/staticMap'
import { getProvince } from '../../data/zambiaProvinces'
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
 * Engine for any `type: "province_shapes"` game document.
 *
 * Mechanics: a fixed deck of 10 questions, one per Zambian province. Each
 * question shows the province silhouette (rendered via Maps Static API
 * polygon path) and four name options. Round ends when all 10 questions
 * have been answered or the timer hits 0, whichever comes first.
 */
export default function ProvinceShapesGame({ game }) {
  const points = Number(game.points) || 15
  const duration = Number(game.timer) || 90
  const pool = useMemo(() => game.questions || [], [game.questions])
  const totalQuestions = pool.length

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [seed, setSeed] = useState(0)
  const [deck, setDeck] = useState(() => shuffle(pool, Date.now()))
  const [pos, setPos] = useState(0)
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

  // Auto-advance after a brief reveal beat
  useEffect(() => {
    if (picked === null) return
    const t = setTimeout(() => {
      advanceToNextQuestion()
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedAt])

  // Preload the next question's silhouette so the swap is instant.
  useEffect(() => {
    if (phase !== 'playing') return
    const nextQ = deck[pos + 1]
    if (!nextQ) return
    const url = buildSilhouetteUrl(nextQ)
    if (!url) return
    const img = new Image()
    img.src = url
  }, [phase, pos, deck])

  function advanceToNextQuestion() {
    setPicked(null)
    const nextPos = pos + 1
    if (nextPos >= totalQuestions) {
      finish()
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

  if (phase === 'ready') return <ReadyCard game={game} totalQuestions={totalQuestions} onStart={start} />
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
  const silhouetteUrl = buildSilhouetteUrl(q)

  return (
    <div className="space-y-5">
      <TimerBar timeLeft={timeLeft} pct={pct} />

      <div className="grid grid-cols-3 gap-2">
        <Pill label="Score"  value={score}   tone="amber" />
        <Pill label="Streak" value={streak}  tone="emerald" />
        <Pill label="Wrong"  value={wrong}   tone="slate" />
      </div>

      <div
        key={`card-${seed}-${pos}`}
        className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-6 sm:p-8"
        style={{ animation: 'zx-question-in 0.3s ease-out both' }}
      >
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 mb-3">
          Province {pos + 1} of {totalQuestions}
        </p>
        <h2 className="text-xl sm:text-2xl font-black leading-tight mb-4">
          {q.question || 'Which province is this?'}
        </h2>
        <Silhouette url={silhouetteUrl} provinceName={q.answer} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6" key={`${seed}-${pos}`}>
          {q.options.map((opt, i) => (
            <Choice
              key={`${seed}-${pos}-${i}`}
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
    return deck[pos] || { question: '', options: [], answer: '', provinceId: '' }
  }
}

/* ── URL helper ─────────────────────────────────────────────────── */

function buildSilhouetteUrl(question) {
  const province = getProvince(question?.provinceId)
  if (!province) return ''
  try {
    return buildStaticMapUrl({
      lat: province.center.lat,
      lng: province.center.lng,
      zoom: province.zoom,
      size: [600, 380],
      mapType: 'terrain',
      paths: [{
        color: '0xff5722ff',
        weight: 4,
        fillcolor: '0xff572277',
        points: province.polygon,
      }],
    })
  } catch (err) {
    console.warn('silhouette URL build failed', err?.message)
    return ''
  }
}

/* ── Sub-components ─────────────────────────────────────────────── */

function Silhouette({ url, provinceName }) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  // Reset state when the URL changes (next question).
  useEffect(() => {
    setLoaded(false)
    setErrored(false)
  }, [url])

  if (!url || errored) {
    return (
      <div className="aspect-[3/2] w-full rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center">
        <div className="text-center text-slate-500 text-sm px-6">
          <MapPinIcon className="h-10 w-10 mx-auto mb-2 text-slate-400" />
          Map preview unavailable. Check that <span className="font-mono text-xs">VITE_GOOGLE_MAPS_STATIC_KEY</span> is set.
        </div>
      </div>
    )
  }

  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-slate-100 border-2 border-slate-200">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 rounded-full border-4 border-slate-200 border-t-slate-600 animate-spin" />
        </div>
      )}
      <img
        src={url}
        alt={`Outline of ${provinceName} Province`}
        loading="eager"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </div>
  )
}

function ReadyCard({ game, totalQuestions, onStart }) {
  const { currentUser } = useAuth()
  return (
    <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-8 sm:p-10 text-center">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-500 text-white shadow-[0_20px_40px_-24px_rgba(245,158,11,0.55)]">
        <MapPinIcon className="h-8 w-8" />
      </span>
      <h2 className="text-3xl font-black mb-2">{game.title}</h2>
      <p className="text-slate-700 max-w-md mx-auto mb-6">
        {game.description}
      </p>
      <ul className="text-sm text-slate-700 max-w-sm mx-auto text-left mb-7 space-y-1.5">
        <li><b>{totalQuestions} provinces</b> to identify</li>
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
        className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-base font-black text-white bg-gradient-to-b from-amber-400 to-orange-500 ring-1 ring-amber-300/60 shadow-[0_14px_28px_-12px_rgba(249,115,22,0.55),inset_0_1px_0_rgba(255,255,255,0.4)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_32px_-14px_rgba(249,115,22,0.6),inset_0_1px_0_rgba(255,255,255,0.45)] active:translate-y-0"
      >
        <BoltIcon className="h-4 w-4" />
        Start map quiz
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
        <MascotCelebration game={game} accuracy={accuracy} score={score} />
        <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_20px_40px_-24px_rgba(15,23,42,0.4)]">
          <TrophyIcon className="h-8 w-8 text-amber-300" />
        </span>
        <h2 className="text-3xl font-black mb-1">{score} pts</h2>
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
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white bg-gradient-to-b from-amber-400 to-orange-500 ring-1 ring-amber-300/60 shadow-[0_12px_24px_-10px_rgba(249,115,22,0.5),inset_0_1px_0_rgba(255,255,255,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_28px_-12px_rgba(249,115,22,0.55),inset_0_1px_0_rgba(255,255,255,0.4)] active:translate-y-0"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Play again
          </button>
          <ShareButton game={game} score={score} accuracy={accuracy} bestStreak={bestStreak} />
          <Link
            to={`/games/g/${game.grade}/${game.subject}`}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-slate-900 bg-white border border-slate-200 shadow-[0_8px_18px_-10px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_24px_-12px_rgba(15,23,42,0.22)] active:translate-y-0"
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
