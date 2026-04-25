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
import {
  MetaPill,
  getGameTypeTheme,
  getSubjectMascot,
  getSubjectTheme,
} from './gamesUi'

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
        <div className="zx-loading-card rounded-[20px] border border-white/80 bg-white/88 p-10 text-center shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
          <span
            role="img"
            aria-label="Game Pal"
            className="zx-loading-mascot mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full bg-white text-[3rem] leading-none ring-4 ring-white shadow-[0_16px_36px_-14px_rgba(15,23,42,0.32)]"
          >
            🎮
          </span>
          <p className="mt-5 text-xl font-black text-slate-900">Setting up your game…</p>
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
  const subjectTheme = getSubjectTheme(subjectMeta?.slug || game.subject)
  const typeTheme = getGameTypeTheme(game.type)
  const mascot = getSubjectMascot(subjectMeta?.slug || game.subject)

  return (
    <header className={`zx-game-header relative mb-6 overflow-hidden rounded-[20px] border ${subjectTheme.border} bg-gradient-to-br ${subjectTheme.gradient} p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.18)] sm:p-7`}>
      <div aria-hidden="true" className="pointer-events-none absolute -top-12 -right-10 h-36 w-36 rounded-full bg-white/45 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-white/30 blur-3xl" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
        <span
          role="img"
          aria-label={mascot.name}
          className="zx-game-header-mascot relative inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white text-[3rem] leading-none ring-4 ring-white/80 shadow-[0_16px_36px_-14px_rgba(15,23,42,0.4)] sm:h-24 sm:w-24 sm:text-[3.4rem]"
        >
          {mascot.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            {gradeMeta && <MetaPill icon={SparklesIcon} label={gradeMeta.label} />}
            {subjectMeta && <MetaPill icon={subjectTheme.icon} label={subjectMeta.label} />}
            <MetaPill icon={typeTheme.icon} label={typeTheme.label} />
            {game.cbc_topic && <MetaPill icon={SparklesIcon} label={game.cbc_topic} />}
          </div>
          <p className="mt-3 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
            With {mascot.name}
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            {game.title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-700 sm:text-base">
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

  return (
    <div className="rounded-[20px] border border-dashed border-slate-300 bg-white/88 p-10 text-center shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
      <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white">
        <PuzzlePieceIcon className="h-8 w-8 text-amber-300" />
      </span>
      <h2 className="mt-5 text-2xl font-black text-slate-900">This game type is not wired yet</h2>
      <p className="mt-3 text-base leading-7 text-slate-600">
        The saved document uses <span className="font-mono">type=&quot;{game.type}&quot;</span>, but no matching play engine is registered.
      </p>
      <Link
        to="/games"
        className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 active:scale-[0.98]"
      >
        Back to games
      </Link>
    </div>
  )
}
