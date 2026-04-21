import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  gradeByValue, subjectBySlug, getGame,
} from '../../utils/gamesService'
import { getFallbackGame } from '../../data/gamesSeed'
import GamesShell from './GamesShell'
import TimedQuizGame from './TimedQuizGame'
import MemoryMatchGame from './MemoryMatchGame'
import WordBuilderGame from './WordBuilderGame'

/**
 * /games/play/:gameId — Step 4: the play surface.
 *
 * Looks the game up in Firestore, falls back to the bundled seed if the
 * collection is empty, then dispatches to the engine matching `type`.
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
        const fb = getFallbackGame(gameId)
        if (fb) setGame(fb)
        else setNotFound(true)
      } catch (err) {
        if (cancelled) return
        console.error('PlayGame load failed', err)
        const fb = getFallbackGame(gameId)
        if (fb) setGame(fb)
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
      <GamesShell crumbs={[{ label: 'Loading…' }]}>
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <div className="text-4xl mb-3 animate-bounce">🎮</div>
          <p className="font-black">Loading game…</p>
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
    <GamesShell crumbs={crumbs} maxW="max-w-3xl">
      <GameHeader game={game} subjectMeta={subjectMeta} gradeMeta={gradeMeta} />
      <GameEngine game={game} />
    </GamesShell>
  )
}

function GameHeader({ game, subjectMeta, gradeMeta }) {
  return (
    <header className="mb-6 flex items-center gap-4">
      <div className="text-5xl sm:text-6xl" aria-hidden="true">{subjectMeta?.emoji || '🎮'}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1.5 mb-1">
          {gradeMeta && <Chip>{gradeMeta.label}</Chip>}
          {subjectMeta && <Chip>{subjectMeta.label}</Chip>}
          {game.cbc_topic && <Chip>CBC · {game.cbc_topic}</Chip>}
          <Chip tone="amber">{game.difficulty || 'easy'}</Chip>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black leading-tight truncate">{game.title}</h1>
        <p className="text-sm text-slate-600">{game.description}</p>
      </div>
    </header>
  )
}

function Chip({ children, tone = 'slate' }) {
  const cls = tone === 'amber'
    ? 'bg-amber-100 text-amber-800'
    : 'bg-slate-100 text-slate-700'
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  )
}

/**
 * Dispatches to the right engine by game.type.
 * Supported:  timed_quiz  |  memory_match  |  word_builder
 */
function GameEngine({ game }) {
  if (game.type === 'timed_quiz')   return <TimedQuizGame   game={game} />
  if (game.type === 'memory_match') return <MemoryMatchGame game={game} />
  if (game.type === 'word_builder') return <WordBuilderGame game={game} />
  return (
    <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="text-5xl mb-3">🚧</div>
      <h2 className="text-xl font-black mb-1">Unknown game type</h2>
      <p className="text-slate-600 max-w-md mx-auto mb-5">
        This game is saved with <span className="font-mono">type="{game.type}"</span>
        but no engine is registered for it yet.
      </p>
      <Link to="/games" className="inline-block px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500">
        Back to all games
      </Link>
    </div>
  )
}
