import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowPathIcon,
  BanknotesIcon,
  CheckBadgeIcon,
  HeartIcon,
  LightBulbIcon,
  ShoppingBagIcon,
  TrophyIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid'
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
  configForGame,
  customerLine,
  formatKwacha,
  generateCustomer,
} from '../lib/marketChallengeCore'

const CUSTOMER_EMOJI = ['🧒🏾', '👧🏾', '👦🏾', '👩🏾', '👨🏾', '👵🏾', '👴🏾', '🧑🏾']
const MAX_HEARTS = 3

/**
 * Banknote skins per denomination (ngwee). Loosely inspired by real ZMW
 * notes — every one carries the fish eagle, like the real thing. K1 and
 * 50n render as metal coins instead.
 */
const NOTE_SKINS = {
  10000: { label: 'K100', bg: 'linear-gradient(135deg, #b45309, #f59e0b)' },
  5000:  { label: 'K50',  bg: 'linear-gradient(135deg, #6d28d9, #a78bfa)' },
  2000:  { label: 'K20',  bg: 'linear-gradient(135deg, #047857, #34d399)' },
  1000:  { label: 'K10',  bg: 'linear-gradient(135deg, #1d4ed8, #60a5fa)' },
  500:   { label: 'K5',   bg: 'linear-gradient(135deg, #a3422e, #d88962)' },
  200:   { label: 'K2',   bg: 'linear-gradient(135deg, #4d7c0f, #a3e635)' },
}

const COIN_SKINS = {
  100: { label: 'K1',  bg: 'radial-gradient(circle at 35% 30%, #fde68a, #d97706 75%)' },
  50:  { label: '50n', bg: 'radial-gradient(circle at 35% 30%, #f1f5f9, #94a3b8 75%)' },
}

/** A tappable banknote or coin, drawn entirely in CSS. */
function MoneyPiece({ denom, size = 'tray', onClick, disabled }) {
  const note = NOTE_SKINS[denom]
  const coin = COIN_SKINS[denom]
  const small = size === 'pile'
  if (note) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`zx-money-note relative shrink-0 overflow-hidden rounded-[8px] border-2 border-slate-900 text-white shadow-[2px_2px_0_rgba(15,23,42,0.85)] transition active:translate-y-[2px] active:shadow-none ${
          small ? 'h-9 w-16 text-[10px]' : 'h-12 w-[5.25rem] text-xs'
        }`}
        style={{ background: note.bg }}
      >
        <span className="absolute left-1 top-0.5 font-black drop-shadow">{note.label}</span>
        <span className="absolute bottom-0.5 right-1 font-black drop-shadow">{note.label}</span>
        <span className={`absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/30 ${small ? 'h-6 w-6 text-sm' : 'h-8 w-8 text-lg'}`}>
          🦅
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative grid shrink-0 place-items-center rounded-full border-2 border-slate-900 font-black text-slate-900 shadow-[2px_2px_0_rgba(15,23,42,0.85)] transition active:translate-y-[2px] active:shadow-none ${
        small ? 'h-9 w-9 text-[10px]' : 'h-12 w-12 text-xs'
      }`}
      style={{ background: coin?.bg }}
    >
      {coin?.label}
    </button>
  )
}

/**
 * Engine for any `type: "market_challenge"` game document — Zed Market
 * Challenge. Customers visit a Zambian market stall, ask for items, and
 * hand over Kwacha. The player must work out the total and tap notes/coins
 * from the tray to give the right CHANGE. Money maths hidden inside the
 * transaction — no questions, no options.
 *
 * Fully procedural like NumberTargetGame: `game.questions` is ignored.
 * Difficulty (easy | medium | hard, grade-band fallback) controls item
 * counts, price ranges (ngwee steps on hard), payment notes, and the tray.
 * Three wrong changes (hearts) end the round early.
 */
export default function MarketChallengeGame({ game }) {
  const points = Number(game.points) || 15
  const cfg = useMemo(() => configForGame(game), [game])

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [customers, setCustomers] = useState([])
  const [pos, setPos] = useState(0)
  const [pile, setPile] = useState([])            // tapped denominations (ngwee)
  const [hearts, setHearts] = useState(MAX_HEARTS)
  const [hintsLeft, setHintsLeft] = useState(cfg.hints)
  const [showTotal, setShowTotal] = useState(false)
  const [missedThis, setMissedThis] = useState(false)
  const [served, setServed] = useState(0)
  const [cleanServes, setCleanServes] = useState(0)
  const [mistakes, setMistakes] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [outcome, setOutcome] = useState(null)    // null | 'correct' | 'wrong'
  const [confettiKey, setConfettiKey] = useState(0)
  const startRef = useRef(null)

  const { saveResult, newBadges, streakResult, levelChange, personalBest, finish, reset } = useGameFinish()

  const customer = customers[pos] || null
  const giving = pile.reduce((sum, d) => sum + d, 0)

  function start() {
    primeSounds()
    reset()
    setCustomers(Array.from({ length: cfg.customers }, () => generateCustomer(cfg)))
    setPos(0)
    setPile([])
    setHearts(MAX_HEARTS)
    setHintsLeft(cfg.hints)
    setShowTotal(false)
    setMissedThis(false)
    setServed(0)
    setCleanServes(0)
    setMistakes(0)
    setStreak(0)
    setBestStreak(0)
    setOutcome(null)
    startRef.current = Date.now()
    setPhase('playing')
  }

  function addMoney(denom) {
    if (outcome === 'correct') return
    playTick()
    setOutcome(null)
    setPile((p) => [...p, denom])
  }

  function removeMoney(index) {
    if (outcome === 'correct') return
    playTick()
    setOutcome(null)
    setPile((p) => p.filter((_, i) => i !== index))
  }

  function clearPile() {
    if (outcome === 'correct' || !pile.length) return
    playTick()
    setOutcome(null)
    setPile([])
  }

  function useHint() {
    if (outcome === 'correct' || showTotal || hintsLeft <= 0) return
    playTick()
    setHintsLeft((h) => h - 1)
    setShowTotal(true)
  }

  function giveChange() {
    if (!customer || !pile.length || outcome === 'correct') return
    if (giving === customer.change) {
      playCorrect()
      setOutcome('correct')
      setServed((c) => c + 1)
      const clean = !missedThis && !showTotal
      if (clean) {
        setCleanServes((c) => c + 1)
        setStreak((s) => {
          const next = s + 1
          setBestStreak((b) => Math.max(b, next))
          return next
        })
      } else {
        setStreak(0)
      }
    } else {
      playWrong()
      setOutcome('wrong')
      setMissedThis(true)
      setMistakes((m) => m + 1)
      setStreak(0)
      const nextHearts = hearts - 1
      setHearts(nextHearts)
      if (nextHearts <= 0) {
        endRound({ served, cleanServes, mistakes: mistakes + 1, bestStreak })
      }
    }
  }

  async function nextCustomer() {
    if (pos + 1 >= customers.length) {
      await endRound({ served, cleanServes, mistakes, bestStreak })
      return
    }
    setPos(pos + 1)
    setPile([])
    setShowTotal(false)
    setMissedThis(false)
    setOutcome(null)
  }

  function computeScore(servedCount, cleanCount) {
    return servedCount * points + cleanCount * Math.round(points / 2)
  }

  async function endRound(stats) {
    playWin()
    setConfettiKey((k) => k + 1)
    setPhase('done')
    const total = customers.length
    const accuracy = Math.round((stats.served / Math.max(total, 1)) * 100)
    const timeSpent = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : 0
    await finish({
      game,
      score: computeScore(stats.served, stats.cleanServes),
      correct: stats.served,
      wrong: total - stats.served,
      accuracy,
      bestStreak: stats.bestStreak,
      timeSpent,
    })
  }

  if (phase === 'ready') {
    return <ReadyCard game={game} cfg={cfg} points={points} onStart={start} />
  }
  if (phase === 'done') {
    const total = customers.length
    const accuracy = Math.round((served / Math.max(total, 1)) * 100)
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={computeScore(served, cleanServes)}
          served={served}
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
  return (
    <div className="space-y-5">
      <div className="zx-card-dark flex items-center justify-between rounded-[22px] px-4 py-3">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-amber-300">
          Customer {pos + 1} of {customers.length}
        </span>
        <span className="inline-flex items-center gap-3 text-sm font-black text-white">
          <span className="inline-flex items-center gap-0.5">
            {Array.from({ length: MAX_HEARTS }).map((_, i) => (
              <HeartIcon key={i} className={`h-4 w-4 ${i < hearts ? 'text-rose-400' : 'text-white/20'}`} />
            ))}
          </span>
          Served: <span className="text-amber-300">{served}</span>
          {streak > 1 && <span className="text-amber-300">🔥 {streak}</span>}
        </span>
      </div>

      <div className="zx-card overflow-hidden rounded-[22px] bg-white">
        {/* Market scene — sky, canopy, stall counter with the goods */}
        <div className="zx-market-sky relative px-4 pt-4">
          <span aria-hidden="true" className="absolute right-4 top-3 text-3xl">☀️</span>
          <span aria-hidden="true" className="absolute left-1/3 top-2 text-xl opacity-80">⛅</span>
          <div className="relative mx-auto flex max-w-md items-end justify-center gap-1 pt-6">
            <span aria-hidden="true" className="text-4xl sm:text-5xl">{'🧑🏾‍🌾'}</span>
          </div>
          <div className="zx-market-canopy mx-auto -mb-px max-w-lg rounded-t-[12px] border-2 border-b-0 border-slate-900" />
        </div>
        <div className="zx-market-wood border-y-2 border-slate-900 px-4 py-3">
          <div className="mx-auto flex max-w-lg flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {customer?.items.map((item, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span className="text-2xl sm:text-3xl" aria-hidden="true">{item.emoji}</span>
                <span className="rounded-full border-[1.5px] border-slate-900 bg-amber-50 px-2 py-0.5 text-xs font-black text-slate-900 sm:text-sm">
                  {formatKwacha(item.price)}
                </span>
              </span>
            ))}
            {showTotal && customer && (
              <span className="rounded-full border-2 border-slate-900 bg-slate-900 px-2.5 py-0.5 text-xs font-black text-amber-300 sm:text-sm">
                Total {formatKwacha(customer.total)}
              </span>
            )}
          </div>
        </div>

        <div className="p-5 sm:p-7">
          {/* Customer + speech bubble */}
          <div className="flex items-start gap-3">
            <span className="zx-market-customer shrink-0 text-5xl leading-none sm:text-6xl" aria-hidden="true">
              {CUSTOMER_EMOJI[pos % CUSTOMER_EMOJI.length]}
            </span>
            <div className="zx-speech relative flex-1 rounded-[16px] border-2 border-slate-900 bg-white px-4 py-3 shadow-[3px_3px_0_rgba(15,23,42,0.85)]">
              <p className="font-bold text-slate-900">{customer ? customerLine(customer) : ''}</p>
            </div>
          </div>

          {/* Change being given */}
          <div className="zx-card mt-4 min-h-[4.5rem] rounded-[16px] bg-emerald-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Change you are giving</p>
              <p className="font-black text-slate-900">{giving > 0 ? formatKwacha(giving) : '—'}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {pile.map((d, i) => (
                <MoneyPiece key={i} denom={d} size="pile" onClick={() => removeMoney(i)} />
              ))}
              {!pile.length && (
                <span className="text-xs font-bold text-slate-400">Tap money below to add it here.</span>
              )}
            </div>
          </div>

          {/* Money tray */}
          <div className="zx-market-tray mt-4 rounded-[16px] border-2 border-slate-900 p-3">
            <p className="text-center text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-amber-100">Money tray</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {cfg.tray.map((d) => (
                <MoneyPiece key={d} denom={d} onClick={() => addMoney(d)} disabled={outcome === 'correct'} />
              ))}
            </div>
          </div>

          {outcome === 'correct' && customer && (
            <div className="zx-card mt-4 rounded-[14px] bg-emerald-100 p-4 text-center font-bold text-emerald-900">
              <span className="inline-flex items-center gap-2">
                <CheckBadgeIcon className="h-5 w-5" />
                ✨ Perfect change — {formatKwacha(customer.change)}! The customer is happy. 🎉
              </span>
            </div>
          )}
          {outcome === 'wrong' && (
            <div className="zx-card mt-4 rounded-[14px] bg-rose-100 p-4 text-center font-bold text-rose-900">
              <span className="inline-flex items-center gap-2">
                <XCircleIcon className="h-5 w-5" />
                That is not the right change — count again!
              </span>
            </div>
          )}
        </div>

        <style>{`
          .zx-market-sky {
            background: linear-gradient(180deg, #7dd3fc 0%, #bae6fd 55%, #e0f2fe 100%);
          }
          .zx-market-canopy {
            height: 1.1rem;
            background: repeating-linear-gradient(90deg, #ef4444 0 18px, #fcf7f3 18px 36px);
          }
          .zx-market-wood {
            background:
              repeating-linear-gradient(180deg, rgba(15,23,42,0.08) 0 2px, transparent 2px 11px),
              linear-gradient(180deg, #b45309, #92400e);
          }
          .zx-market-tray {
            background: linear-gradient(180deg, #78350f, #57290b);
          }
          .zx-speech::before {
            content: '';
            position: absolute;
            left: -9px;
            top: 18px;
            width: 14px;
            height: 14px;
            background: inherit;
            border-left: 2px solid #0f172a;
            border-bottom: 2px solid #0f172a;
            transform: rotate(45deg);
          }
          .zx-market-customer {
            animation: zx-market-bob 3.2s ease-in-out infinite;
            transform-origin: bottom center;
          }
          .zx-money-note::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.25) 45%, transparent 60%);
          }
          @keyframes zx-market-bob {
            0%, 100% { transform: translateY(0) rotate(-1deg); }
            50%      { transform: translateY(-3px) rotate(1deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .zx-market-customer { animation: none !important; }
          }
        `}</style>
      </div>

      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={clearPile}
            disabled={!pile.length || outcome === 'correct'}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-3.5 py-2.5 text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Clear
          </button>
          <button
            type="button"
            onClick={useHint}
            disabled={showTotal || hintsLeft <= 0 || outcome === 'correct'}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-3.5 py-2.5 text-sm"
          >
            <LightBulbIcon className="h-4 w-4" />
            Hint ({hintsLeft})
          </button>
        </div>
        {outcome === 'correct' ? (
          <button
            type="button"
            onClick={nextCustomer}
            className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
          >
            {pos + 1 >= customers.length ? 'Close the stall' : 'Next customer'}
          </button>
        ) : (
          <button
            type="button"
            onClick={giveChange}
            disabled={!pile.length}
            className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
          >
            <BanknotesIcon className="h-4 w-4" />
            Give change
          </button>
        )}
      </div>
    </div>
  )
}

function ReadyCard({ game, cfg, points, onStart }) {
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 text-center sm:p-10">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-amber-100 text-slate-900">
        <ShoppingBagIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display mb-2 mt-4 text-3xl font-bold text-slate-900">{game.title}</h2>
      <p className="mx-auto mb-6 max-w-md text-slate-700">{game.description}</p>
      <ul className="mx-auto mb-7 max-w-sm space-y-1.5 text-left text-sm text-slate-700">
        <li>{cfg.customers} customers to serve at your stall</li>
        <li>Add up their goods, then tap notes and coins to give the right change</li>
        <li>+{points} points per happy customer, bonus for first-try change with no hint</li>
        <li>❤️ Three wrong changes and the stall closes early!</li>
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <ShoppingBagIcon className="h-4 w-4" />
        Open the stall
      </button>
    </div>
  )
}

function DoneCard({ game, score, served, total, accuracy, bestStreak, saveResult, newBadges, streakResult, levelChange, personalBest, onRestart }) {
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
          <DoneStat label="Served"      value={`${served}/${total}`} tone="emerald" />
          <DoneStat label="Accuracy"    value={`${accuracy}%`} tone="sky" />
          <DoneStat label="Best streak" value={bestStreak} tone="rose" />
        </div>
        <SaveBanner saveResult={saveResult} />
        {levelChange?.after && (
          <div className="mt-4"><XpProgressBar progress={levelChange.after} gained={score} /></div>
        )}
        <SmartFeedback
          game={game}
          result={{ score, accuracy, correct: served, wrong: total - served, bestStreak }}
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
