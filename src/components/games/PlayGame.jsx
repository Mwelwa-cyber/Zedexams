import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { PuzzlePieceIcon, SparklesIcon } from '@heroicons/react/24/solid'
import {
  getGame,
  gradeByValue,
  subjectBySlug,
} from '../../utils/gamesService'
import { getFallbackGame } from '../../data/gamesSeed'
import GamesShell from './GamesShell'
import TimedQuizGame from './TimedQuizGame'
import MemoryMatchGame from './MemoryMatchGame'
import WordBuilderGame from './WordBuilderGame'
import ProvinceShapesGame from './ProvinceShapesGame'
import {
  getGameTypeTheme,
  getSubjectMascot,
} from './gamesUi'

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
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const live = await getGame(gameId)
        if (cancelled) return
        if (live) {
          setGame(live)
          return
        }

        const fallback = getFallbackGame(gameId)
        if (fallback) setGame(fallback)
        else setNotFound(true)
      } catch (err) {
        if (cancelled) return
        console.error('PlayGame load failed', err)
        const fallback = getFallbackGame(gameId)
        if (fallback) setGame(fallback)
        else setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [gameId])

  useEffect(() => {
    if (game?.title) document.title = `${game.title} — ZedExams Games`
  }, [game?.title])

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
  const crumbs = [
    gradeMeta && { label: gradeMeta.label, to: `/games/g/${gradeMeta.value}` },
    gradeMeta && subjectMeta && { label: subjectMeta.label, to: `/games/g/${gradeMeta.value}/${subjectMeta.slug}` },
    { label: game.title },
  ].filter(Boolean)

  return (
    <GamesShell crumbs={crumbs} maxW="max-w-4xl">
      <GameHeader game={game} subjectMeta={subjectMeta} gradeMeta={gradeMeta} />
      <GameEngine game={game} />
    </GamesShell>
  )
}

function GameHeader({ game, subjectMeta, gradeMeta }) {
  const typeTheme = getGameTypeTheme(game.type)
  const mascot = getSubjectMascot(subjectMeta?.slug || game.subject)
  const subjectKey = String(subjectMeta?.slug || game.subject || '').toLowerCase()
  const tileBg = SUBJECT_TILE_BG[subjectKey] || 'bg-orange-100'
  const TypeIcon = typeTheme.icon

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

function GameEngine({ game }) {
  if (game.type === 'timed_quiz') return <TimedQuizGame game={game} />
  if (game.type === 'memory_match') return <MemoryMatchGame game={game} />
  if (game.type === 'word_builder') return <WordBuilderGame game={game} />
  if (game.type === 'province_shapes') return <ProvinceShapesGame game={game} />

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
