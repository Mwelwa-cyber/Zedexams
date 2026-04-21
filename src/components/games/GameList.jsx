import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { gradeByValue, listGames, subjectBySlug } from '../../utils/gamesService'
import { getFallbackGames } from '../../data/gamesSeed'
import GamesShell from './GamesShell'

const DIFFICULTY_CHIP = {
  easy:   'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  hard:   'bg-rose-100 text-rose-800',
}

/**
 * /games/g/:grade/:subject — Step 3: list of games for the chosen
 * grade + subject. Reads live Firestore, falls back to the local seed
 * so the UI always shows something even before an admin import.
 */
export default function GameList() {
  const { grade, subject } = useParams()
  const gradeMeta = gradeByValue(grade)
  const subjectMeta = subjectBySlug(subject)

  const [games, setGames] = useState(null)
  const [source, setSource] = useState('live') // 'live' | 'fallback'

  useEffect(() => {
    if (!gradeMeta || !subjectMeta) return
    document.title = `${gradeMeta.label} ${subjectMeta.label} Games — ZedExams`
    let cancelled = false
    async function load() {
      const live = await listGames({ grade: gradeMeta.value, subject: subjectMeta.slug })
      if (cancelled) return
      if (live.length) {
        setGames(live)
        setSource('live')
      } else {
        const fb = getFallbackGames({ grade: gradeMeta.value, subject: subjectMeta.slug })
        setGames(fb)
        setSource('fallback')
      }
    }
    load()
    return () => { cancelled = true }
  }, [gradeMeta, subjectMeta])

  if (!gradeMeta) return <Navigate to="/games" replace />
  if (!subjectMeta) return <Navigate to={`/games/g/${gradeMeta.value}`} replace />

  return (
    <GamesShell crumbs={[
      { label: gradeMeta.label, to: `/games/g/${gradeMeta.value}` },
      { label: subjectMeta.label },
    ]}>
      <header className="mb-6 flex items-center gap-4">
        <div className="text-5xl">{subjectMeta.emoji}</div>
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Step 3 of 4</p>
          <h1 className="text-3xl sm:text-4xl font-black leading-tight">{gradeMeta.label} · {subjectMeta.label}</h1>
        </div>
      </header>

      {games == null && <SkeletonGrid />}

      {games != null && games.length === 0 && (
        <EmptyState gradeMeta={gradeMeta} subjectMeta={subjectMeta} />
      )}

      {games != null && games.length > 0 && (
        <>
          {source === 'fallback' && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm font-bold">
              📡 Showing offline preview — an admin can run <Link to="/admin/games-seed" className="underline">Games Seed Importer</Link> to publish these to Firestore.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        </>
      )}
    </GamesShell>
  )
}

function GameCard({ game }) {
  return (
    <Link
      to={`/games/play/${game.id}`}
      className="group block rounded-2xl border-2 border-slate-200 bg-white p-5 hover:shadow-lg hover:-translate-y-0.5 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-black text-lg leading-tight">{game.title}</h3>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${DIFFICULTY_CHIP[game.difficulty] || 'bg-slate-100 text-slate-700'}`}>
          {game.difficulty || 'easy'}
        </span>
      </div>
      {game.cbc_topic && (
        <p className="text-xs font-black uppercase tracking-wider text-slate-500 mt-1">
          CBC · {game.cbc_topic}
        </p>
      )}
      <p className="mt-2 text-sm text-slate-700 line-clamp-2">{game.description}</p>

      <div className="mt-4 flex items-center justify-between text-xs font-black text-slate-500">
        <span>⏱ {game.timer}s · 🎯 {game.points} pts</span>
        <span className="text-amber-600">Play →</span>
      </div>
    </Link>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl border-2 border-slate-200 bg-white p-5">
          <div className="h-4 w-2/3 bg-slate-200 rounded animate-pulse mb-3"></div>
          <div className="h-3 w-1/3 bg-slate-100 rounded animate-pulse mb-4"></div>
          <div className="h-3 bg-slate-100 rounded animate-pulse mb-2"></div>
          <div className="h-3 bg-slate-100 rounded animate-pulse w-5/6"></div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ gradeMeta, subjectMeta }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="text-5xl mb-3">🧩</div>
      <h2 className="text-xl font-black mb-1">No games published yet</h2>
      <p className="text-slate-600 max-w-md mx-auto mb-5">
        There are no {subjectMeta.label} games for {gradeMeta.label} yet. We're
        adding packs every week.
      </p>
      <Link to={`/games/g/${gradeMeta.value}`} className="inline-block px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500">
        ← Pick a different subject
      </Link>
    </div>
  )
}
