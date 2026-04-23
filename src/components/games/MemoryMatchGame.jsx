import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { shuffle } from '../../utils/gamesService'
import { playCorrect, playWrong, playWin, playTick, primeSounds } from '../../utils/gameSounds'
import { useGameFinish } from './useGameFinish'
import { SaveBanner, StreakBanner, DoneStat } from './DoneBanners'
import BadgeToast from './BadgeToast'
import ShareButton from './ShareButton'
import Confetti from './Confetti'
import Leaderboard from './Leaderboard'
import SmartFeedback from './SmartFeedback'

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
  const points = Number(game.points) || 10
  const pairs = useMemo(() => (game.questions || []).filter((p) => p.answer), [game.id])

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [deck, setDeck] = useState([])        // array of { pairId, label, side }
  const [flipped, setFlipped] = useState([])  // indices currently face-up (unmatched)
  const [matched, setMatched] = useState([])  // matched indices
  const [moves, setMoves] = useState(0)
  const [mismatches, setMismatches] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [confettiKey, setConfettiKey] = useState(0)
  const startRef = useRef(null)

  const { saveResult, newBadges, streakResult, finish, reset } = useGameFinish()

  // stopwatch
  useEffect(() => {
    if (phase !== 'playing' || !startRef.current) return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 500)
    return () => clearInterval(t)
  }, [phase])

  function buildDeck() {
    const cards = []
    pairs.forEach((p, i) => {
      cards.push({ pairId: i, label: p.question, side: 'Q' })
      cards.push({ pairId: i, label: p.answer,   side: 'A' })
    })
    return shuffle(cards, Date.now())
  }

  function start() {
    primeSounds()
    reset()
    setPhase('playing')
    setDeck(buildDeck())
    setFlipped([])
    setMatched([])
    setMoves(0)
    setMismatches(0)
    setElapsed(0)
    startRef.current = Date.now()
  }

  function handleFlip(i) {
    if (phase !== 'playing') return
    if (flipped.includes(i) || matched.includes(i)) return
    if (flipped.length >= 2) return
    playTick()
    const next = [...flipped, i]
    setFlipped(next)
    if (next.length === 2) {
      setMoves((m) => m + 1)
      const [a, b] = next
      if (deck[a].pairId === deck[b].pairId && deck[a].side !== deck[b].side) {
        // match
        setTimeout(() => {
          playCorrect()
          const newMatched = [...matched, a, b]
          setMatched(newMatched)
          setFlipped([])
          if (newMatched.length === deck.length) {
            winRound(newMatched)
          }
        }, 380)
      } else {
        setTimeout(() => { playWrong(); setMismatches((m) => m + 1); setFlipped([]) }, 900)
      }
    }
  }

  async function winRound(matchedAll) {
    playWin()
    setConfettiKey((k) => k + 1)
    setPhase('done')
    const totalPairs = pairs.length
    const perfectMoves = totalPairs
    const movesUsed = Math.max(moves + 1, perfectMoves) // +1 for the final move that sealed the win
    const efficiency = perfectMoves / movesUsed       // 0..1 (1 = perfect)
    const bonusMax = points * totalPairs
    const bonus = Math.round(efficiency * bonusMax)
    const finalScore = points * totalPairs + bonus
    const timeSpent = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : elapsed
    const accuracy = Math.round(efficiency * 100)

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
    const totalPairs = pairs.length
    const movesUsed = Math.max(moves, totalPairs)
    const efficiency = Math.round((totalPairs / movesUsed) * 100)
    const finalScore = Math.round(points * totalPairs + (efficiency / 100) * points * totalPairs)
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
          onRestart={restart}
        />
      </>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <StatPill label="Matches" value={`${matched.length / 2} / ${pairs.length}`} tone="emerald" />
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
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleFlip(i)}
              disabled={isMatched}
              aria-label={faceUp ? card.label : 'Hidden card'}
              className="relative aspect-[3/4] w-full rounded-2xl focus:outline-none focus:ring-4 focus:ring-amber-300"
            >
              {faceUp ? (
                <div className={`w-full h-full rounded-2xl flex items-center justify-center p-2 text-center font-black border-2 ${
                  isMatched
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-white border-amber-300 text-slate-900'
                }`}>
                  <span className={card.label.length <= 3 ? 'text-4xl sm:text-5xl' : 'text-sm sm:text-base leading-tight'}>
                    {card.label}
                  </span>
                </div>
              ) : (
                <div className="w-full h-full rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 border-2 border-orange-600 flex items-center justify-center text-white text-3xl shadow-md hover:scale-[1.02] transition">
                  <span aria-hidden="true">🎴</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="text-center">
        <button type="button" onClick={restart} className="text-sm font-bold text-slate-600 hover:text-slate-900 underline">
          Reshuffle ↻
        </button>
      </div>
    </div>
  )
}

function ReadyCard({ game, pairs, onStart }) {
  const { currentUser } = useAuth()
  return (
    <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-8 sm:p-10 text-center">
      <div className="text-6xl mb-3">🧠</div>
      <h2 className="text-3xl font-black mb-2">{game.title}</h2>
      <p className="text-slate-700 max-w-md mx-auto mb-6">{game.description}</p>
      <ul className="text-sm text-slate-700 max-w-sm mx-auto text-left mb-7 space-y-1.5">
        <li>🎴 {pairs} pairs to find ({pairs * 2} cards)</li>
        <li>🏆 Fewer moves = bigger bonus</li>
        {currentUser
          ? <li>🏅 Your score saves automatically to the leaderboard</li>
          : <li>🏅 Sign in to save your score and climb the leaderboard</li>}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="px-6 py-3.5 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-md text-lg"
      >
        Start matching 🎴
      </button>
    </div>
  )
}

function DoneCard({ game, score, moves, mismatches, elapsed, efficiency, saveResult, newBadges, streakResult, onRestart }) {
  const stars = efficiency >= 90 ? 3 : efficiency >= 70 ? 2 : 1
  return (
    <div className="space-y-5">
      {streakResult?.isDaily && <StreakBanner result={streakResult} />}
      {newBadges?.length > 0 && <BadgeToast badges={newBadges} />}

      <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-8 text-center">
        <div className="text-6xl mb-2">🎉</div>
        <h2 className="text-3xl font-black mb-1">{score} pts</h2>
        <div className="text-2xl mb-3">
          {'⭐'.repeat(stars)}{'☆'.repeat(3 - stars)}
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-6">
          <DoneStat label="Moves"    value={moves} tone="amber" />
          <DoneStat label="Efficiency" value={`${efficiency}%`} tone="emerald" />
          <DoneStat label="Time"     value={formatTime(elapsed)} tone="sky" />
        </div>
        <SaveBanner saveResult={saveResult} />
        <SmartFeedback
          game={game}
          result={{ score, accuracy: efficiency, correct: moves, wrong: mismatches, bestStreak: 0 }}
          saveResult={saveResult}
        />
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <button type="button" onClick={onRestart} className="px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500">
            Play again 🔁
          </button>
          <ShareButton game={game} score={score} accuracy={efficiency} bestStreak={0} />
          <Link to={`/games/g/${game.grade}/${game.subject}`} className="px-5 py-3 rounded-xl font-black text-slate-900 bg-white border-2 border-slate-200 hover:border-slate-400">
            More games
          </Link>
        </div>
      </div>

      <Leaderboard gameId={game.id} />
    </div>
  )
}

function StatPill({ label, value, tone = 'slate' }) {
  const TONE = {
    emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    amber:   'bg-amber-50 text-amber-900 border-amber-200',
    sky:     'bg-sky-50 text-sky-900 border-sky-200',
    slate:   'bg-slate-50 text-slate-900 border-slate-200',
  }
  return (
    <div className={`flex-1 rounded-xl border-2 px-3 py-2 text-center ${TONE[tone] || TONE.slate}`}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  )
}

function gridCols(n) {
  if (n <= 8) return 4
  if (n <= 12) return 4
  if (n <= 16) return 4
  return 6
}

function formatTime(s) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}
