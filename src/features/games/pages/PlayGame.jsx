import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { LockClosedIcon, PuzzlePieceIcon, SparklesIcon } from '@heroicons/react/24/solid'
import {
  getGame,
  gradeByValue,
  subjectBySlug,
} from '../services/gamesService'
import { getFallbackGame, isDemoGame } from '../../../data/gamesSeed'
import { loadDeletedGameIds } from '../../../utils/gameTombstones'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscription } from '../../../hooks/useSubscription'
import UpgradeModal from '../../../components/subscription/UpgradeModal'
import Button from '../../../shared/components/Button'
import GamesShell from '../components/GamesShell'
import GameStickerStyles from '../../../shared/components/GameStickerStyles'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import TimedQuizGame from '../components/TimedQuizGame'
import MeaningMatchGame from '../components/MeaningMatchGame'
import PunctuationProGame from '../components/PunctuationProGame'
import WordBuilderGame from '../components/WordBuilderGame'
import NumberTargetGame from '../components/NumberTargetGame'
import KnowZambiaGame from '../components/KnowZambiaGame'
import FractionLadderGame from '../components/FractionLadderGame'
import { RETIRED_GAME_TYPES } from '../../../data/gamesSeed'
import {
  getGameAccessMeta,
  getGameTypeTheme,
  getSubjectMascot,
} from '../components/gamesUi'
import SeoHelmet from '../../../shared/components/SeoHelmet'

// Game types whose engine brings its own full-screen `.lhx` chrome (exit
// control, head bar, win screen) — these render bare, in the learner design
// system, without the legacy GamesShell nav or the zx-card hero. The first
// four are the prototype-v3 rebuild (learner redesign step 4); map_place and
// fraction_ladder shipped later with identical chrome but were left mounting
// INSIDE the legacy shell, which stacked two clashing headers (amber/serif
// shell over the purple `.lhx` game) on every map and fraction round.
const PROTO_ENGINES = new Set([
  'number_target',
  'word_builder',
  'memory_match',
  'punctuation',
  'map_place',
  'fraction_ladder',
])

const SUBJECT_TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

/**
 * /games/play/:gameId — play surface.
 */
export default function PlayGame() {
  const { gameId } = useParams()
  const { currentUser } = useAuth()
  const { canAccessFullContent } = useSubscription()
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      // The bundled seed is what makes a game playable before it is seeded
      // and during a Firestore outage — and it is also why a permanently
      // deleted game stayed launchable through an old direct link. The
      // deletion list is loaded alongside the live doc (fail-open: an
      // unreadable list leaves the fallback as it was) and consulted only
      // on the fallback path, so a live doc is never gated behind it.
      try {
        const [live, deletedIds] = await Promise.all([
          getGame(gameId),
          loadDeletedGameIds(),
        ])
        if (cancelled) return
        if (live) {
          setGame(live)
          return
        }

        const fallback = getFallbackGame(gameId, { exclude: deletedIds })
        if (fallback) setGame(fallback)
        else setNotFound(true)
      } catch (err) {
        if (cancelled) return
        console.error('PlayGame load failed', err)
        const fallback = getFallbackGame(gameId, { exclude: await loadDeletedGameIds() })
        if (fallback) setGame(fallback)
        else setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [gameId])

  if (notFound) return <Navigate to="/games" replace />
  if (loading || !game) {
    return (
      <GamesShell crumbs={[{ label: 'Loading…' }]} maxW="max-w-4xl">
        <div className="zx-card zx-loading-card mx-auto max-w-md rounded-[22px] bg-white p-10 text-center">
          <span
            role="img"
            aria-label="Game Pal"
            className="zx-loading-mascot mx-auto inline-flex h-20 w-20 items-center justify-center rounded-[18px] border-2 border-slate-900 bg-orange-100 text-[3rem] leading-none"
          >
            🎮
          </span>
          <p className="font-display mt-5 text-xl font-bold text-slate-900">Setting up your game…</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Pulling the latest game data. This will only take a moment!</p>
          <style>{`
            .zx-loading-card .zx-loading-mascot {
              animation: zx-loading-bob 1.6s ease-in-out infinite;
              transform-origin: center;
            }
            @keyframes zx-loading-bob {
              0%, 100% { transform: translateY(0)   rotate(-4deg); }
              50%      { transform: translateY(-6px) rotate(4deg); }
            }
            @media (prefers-reduced-motion: reduce) {
              .zx-loading-card .zx-loading-mascot { animation: none !important; }
            }
          `}</style>
        </div>
      </GamesShell>
    )
  }

  const gradeMeta = gradeByValue(game.grade)
  const subjectMeta = subjectBySlug(game.subject)
  // Grade/subject browsing retired (step 8) — the crumb trail is just
  // the hub and the game.
  const crumbs = [{ label: 'Games', to: '/games' }, { label: game.title }]
  const locked = !isDemoGame(game) && !canAccessFullContent

  // The rebuilt prototype-v3 engines bring their own full-screen `.lhx`
  // chrome (path head, ✕ control, win screen) — mount them bare, without
  // the legacy GamesShell/GameHeader wrapper. The premium lock keeps the
  // legacy chrome until the games paywall surface is redesigned.
  if (!locked && PROTO_ENGINES.has(game.type)) {
    return (
      <>
        <SeoHelmet
          title={game.title}
          description={game.description || `Play ${game.title} on ZedExams. CBC-aligned learning game for ${gradeMeta?.label || 'Zambian learners'}.`}
          path={`/games/play/${game.id || gameId}`}
        />
        <GameEngine game={game} />
      </>
    )
  }

  // timed_quiz (the daily-quiz engine) keeps its component untouched —
  // it carries the Phase 3 assessment-engine flag wiring and two pinned
  // specs — but plays inside the learner shell: a `.lhx` page with the
  // prototype back row, GameStickerStyles for its animations, and the
  // `.lhx-tq` bridge in gamesProto.css restyling its zx vocabulary to
  // the prototype palette (colours only, structure identical).
  if (!locked && game.type === 'timed_quiz') {
    return (
      <div className="lhx">
        <SeoHelmet
          title={game.title}
          description={game.description || `Play ${game.title} on ZedExams. CBC-aligned learning game for ${gradeMeta?.label || 'Zambian learners'}.`}
          path={`/games/play/${game.id || gameId}`}
        />
        <div className="lhx-page">
          <div className="lhx-back-row">
            <Link to="/games" className="lhx-back-btn" aria-label="Back to games">‹</Link>
            <div>
              <div className="lhx-back-title">⚡ {game.title}</div>
              <div className="lhx-back-sub">
                {[subjectMeta?.label, gradeMeta?.label].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div className="lhx-tq">
            <GameStickerStyles />
            <GameEngine game={game} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <GamesShell crumbs={crumbs} maxW="max-w-4xl">
      <SeoHelmet
        title={game.title}
        description={game.description || `Play ${game.title} on ZedExams. CBC-aligned learning game for ${gradeMeta?.label || 'Zambian learners'}.`}
        path={`/games/play/${game.id || gameId}`}
      />
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      <GameHeader game={game} subjectMeta={subjectMeta} gradeMeta={gradeMeta} />
      {locked ? (
        <PremiumLockedState
          currentUser={currentUser}
          onUpgrade={() => setShowUpgrade(true)}
        />
      ) : (
        <GameEngine game={game} />
      )}
    </GamesShell>
  )
}

function GameHeader({ game, subjectMeta, gradeMeta }) {
  const typeTheme = getGameTypeTheme(game.type)
  const mascot = getSubjectMascot(subjectMeta?.slug || game.subject)
  const subjectKey = String(subjectMeta?.slug || game.subject || '').toLowerCase()
  const tileBg = SUBJECT_TILE_BG[subjectKey] || 'bg-orange-100'
  const TypeIcon = typeTheme.icon
  const accessMeta = getGameAccessMeta(game)
  const AccessIcon = accessMeta.icon

  return (
    <header className="zx-card zx-game-header relative mb-6 rounded-[22px] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <span
          role="img"
          aria-label={mascot.name}
          className={`zx-game-header-mascot grid h-20 w-20 shrink-0 place-items-center rounded-[18px] border-2 border-slate-900 text-[3rem] leading-none sm:h-24 sm:w-24 sm:text-[3.4rem] ${tileBg}`}
        >
          {mascot.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            {gradeMeta && <span className="zx-chip">{gradeMeta.label}</span>}
            {subjectMeta && <span className="zx-chip">{subjectMeta.label}</span>}
            <span className="zx-chip">
              <TypeIcon className="h-3.5 w-3.5" />
              {typeTheme.label}
            </span>
            <span className={`zx-chip ${accessMeta.className}`}>
              <AccessIcon className="h-3.5 w-3.5" />
              {accessMeta.label}
            </span>
            {game.cbc_topic && (
              <span className="zx-chip">
                <SparklesIcon className="h-3.5 w-3.5" />
                {game.cbc_topic}
              </span>
            )}
          </div>
          <p className="zx-eyebrow mt-3">With {mascot.name}</p>
          <h1 className="font-display mt-1 text-2xl font-bold leading-tight tracking-tight text-slate-900 sm:text-3xl">
            {game.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-700 sm:text-base">
            {game.description}
          </p>
        </div>
      </div>
      <style>{`
        .zx-game-header .zx-game-header-mascot {
          animation: zx-game-header-bob 5s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes zx-game-header-bob {
          0%, 100% { transform: translateY(0)   rotate(-3deg); }
          50%      { transform: translateY(-4px) rotate(3deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .zx-game-header .zx-game-header-mascot { animation: none !important; }
        }
      `}</style>
    </header>
  )
}

function PremiumLockedState({ currentUser, onUpgrade }) {
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 text-center sm:p-10">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-slate-900 text-white">
        <LockClosedIcon className="h-8 w-8 text-amber-300" />
      </span>
      <h2 className="font-display mt-5 text-2xl font-bold text-slate-900">This game is part of Premium</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
        Foundational demo games stay free, while deeper revision packs unlock with a premium plan.
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        {currentUser ? (
          <Button size="lg" onClick={onUpgrade}>Upgrade to play</Button>
        ) : (
          <Button as={Link} to="/login" size="lg">Log in to unlock</Button>
        )}
        <Button as={Link} to="/games" variant="secondary" size="lg">Back to games</Button>
      </div>
    </div>
  )
}

function GameEngine({ game }) {
  if (game.type === 'timed_quiz') return <TimedQuizGame game={game} />
  if (game.type === 'memory_match') return <MeaningMatchGame game={game} />
  if (game.type === 'punctuation') return <PunctuationProGame game={game} />
  if (game.type === 'word_builder') return <WordBuilderGame game={game} />
  if (game.type === 'number_target') return <NumberTargetGame game={game} />
  if (game.type === 'map_place') return <KnowZambiaGame game={game} />
  if (game.type === 'fraction_ladder') return <FractionLadderGame game={game} />

  // The 2026-08 redesign retired the legacy mechanics (learner redesign
  // step 4). A live Firestore doc of a retired type can still be reached
  // by an old bookmark or a stale list — say so warmly instead of
  // rendering the "not wired" developer card.
  if (RETIRED_GAME_TYPES.has(game.type)) {
    return (
      <div className="zx-card rounded-[22px] bg-white p-10 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-amber-100 text-[2rem]" aria-hidden="true">
          🏝️
        </span>
        <h2 className="font-display mt-5 text-2xl font-bold text-slate-900">This game has retired</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">
          {game.title} took a bow when the new games arrived. Try Number Path, Word Builder, Meaning Match or Punctuation Pro — same points, badges and leaderboard.
        </p>
        <Link
          to="/games"
          className="zx-sticker-btn zx-sticker-btn-dark mt-6 rounded-[14px] px-4 py-2.5 text-sm"
        >
          See the new games
        </Link>
      </div>
    )
  }

  return (
    <div className="zx-card rounded-[22px] bg-white p-10 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-slate-900 text-white">
        <PuzzlePieceIcon className="h-8 w-8 text-amber-300" />
      </span>
      <h2 className="font-display mt-5 text-2xl font-bold text-slate-900">This game type is not wired yet</h2>
      <p className="mt-3 text-base leading-7 text-slate-600">
        The saved document uses <span className="font-mono">type=&quot;{game.type}&quot;</span>, but no matching play engine is registered.
      </p>
      <Link
        to="/games"
        className="zx-sticker-btn zx-sticker-btn-dark mt-6 rounded-[14px] px-4 py-2.5 text-sm"
      >
        Back to games
      </Link>
    </div>
  )
}
