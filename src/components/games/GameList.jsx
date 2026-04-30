import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { getFallbackGames } from '../../data/gamesSeed'
import { gradeByValue, listGames, subjectBySlug } from '../../utils/gamesService'
import GamesShell from './GamesShell'
import {
  GameDiscoveryCard,
  GamesSectionHeading,
  MetaPill,
  getGameStatusBadge,
  getSubjectMascot,
} from './gamesUi'

const SUBJECT_TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

/**
 * /games/g/:grade/:subject — discovery page for the chosen grade + subject.
 * Keeps the same Firestore reads while upgrading the browse experience.
 */
export default function GameList() {
  const { grade, subject } = useParams()
  const gradeMeta = gradeByValue(grade)
  const subjectMeta = subjectBySlug(subject)
  const [games, setGames] = useState(null)
  const [source, setSource] = useState('live')

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
        setGames(getFallbackGames({ grade: gradeMeta.value, subject: subjectMeta.slug }))
        setSource('fallback')
      }
    }

    load()
    return () => { cancelled = true }
  }, [gradeMeta, subjectMeta])

  if (!gradeMeta) return <Navigate to="/games" replace />
  if (!subjectMeta) return <Navigate to={`/games/g/${gradeMeta.value}`} replace />

  const subjectKey = String(subjectMeta.slug || '').toLowerCase()
  const tileBg = SUBJECT_TILE_BG[subjectKey] || 'bg-orange-100'
  const mascot = getSubjectMascot(subjectMeta.slug)

  return (
    <GamesShell
      crumbs={[
        { label: gradeMeta.label, to: `/games/g/${gradeMeta.value}` },
        { label: subjectMeta.label },
      ]}
    >
      <section className="zx-card mb-8 rounded-[22px] bg-white p-6 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill icon={SparklesIcon} label={gradeMeta.label} />
              <MetaPill label={subjectMeta.label} />
            </div>
            <div className="mt-5 flex items-start gap-4">
              <span
                role="img"
                aria-label={mascot.name}
                className={`grid h-14 w-14 shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 text-3xl leading-none ${tileBg}`}
              >
                {mascot.emoji}
              </span>
              <div>
                <GamesSectionHeading
                  eyebrow="Discover games"
                  title={`${subjectMeta.label} for ${gradeMeta.label}`}
                  description="Browse colourful game cards with clear points, duration, and type labels before you jump into play."
                />
              </div>
            </div>
          </div>

          {games && games.length > 0 && (
            <span className="zx-chip">
              {games.length} game{games.length === 1 ? '' : 's'} ready now
            </span>
          )}
        </div>
      </section>

      {games == null && <SkeletonGrid />}

      {games != null && games.length === 0 && (
        <EmptyState gradeMeta={gradeMeta} subjectMeta={subjectMeta} />
      )}

      {games != null && games.length > 0 && (
        <>
          {source === 'fallback' && (
            <div className="zx-card mb-5 rounded-[18px] bg-amber-100 px-5 py-4 text-sm text-amber-900">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-black">Preview mode is active.</p>
                  <p className="mt-1 leading-6 text-amber-800">
                    These games are showing from the bundled fallback list until the live collection is published.
                  </p>
                </div>
                <Link to="/admin/games-seed" className="font-black underline">
                  Open Games Seed Importer
                </Link>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game, index) => (
              <GameDiscoveryCard
                key={game.id}
                game={game}
                badge={getGameStatusBadge(game, index, games[0]?.id)}
                variant={index === 0 ? 'featured' : 'standard'}
                showRating
              />
            ))}
          </div>
        </>
      )}
    </GamesShell>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={`zx-card animate-pulse rounded-[22px] bg-white p-5 ${index === 0 ? 'lg:col-span-2 sm:p-7' : ''}`}
        >
          <div className="h-12 w-12 rounded-[14px] border-2 border-slate-900 bg-slate-100" />
          <div className="mt-5 h-7 w-3/4 rounded bg-slate-100" />
          <div className="mt-3 h-4 w-full rounded bg-slate-100" />
          <div className="mt-2 h-4 w-5/6 rounded bg-slate-100" />
          <div className="mt-5 flex gap-2">
            <div className="h-8 w-24 rounded-full bg-slate-100" />
            <div className="h-8 w-24 rounded-full bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

const EMPTY_TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

function EmptyState({ gradeMeta, subjectMeta }) {
  const mascot = getSubjectMascot(subjectMeta.slug)
  const tileBg = EMPTY_TILE_BG[String(subjectMeta.slug || '').toLowerCase()] || 'bg-orange-100'

  return (
    <div className="zx-empty-card zx-card rounded-[22px] bg-white p-10 text-center">
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <span
          role="img"
          aria-label={mascot.name}
          className={`zx-empty-mascot grid h-20 w-20 place-items-center rounded-[18px] border-2 border-slate-900 text-[3rem] leading-none ${tileBg}`}
        >
          {mascot.emoji}
        </span>
        <h2 className="font-display mt-5 text-2xl font-bold text-slate-900">No games here yet — but {mascot.name} is on it!</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">
          {subjectMeta.label} for {gradeMeta.label} will land here as soon as the next pack is published.
        </p>
        <Link
          to={`/games/g/${gradeMeta.value}`}
          className="zx-sticker-btn zx-sticker-btn-dark mt-6 rounded-[14px] px-4 py-2.5 text-sm"
        >
          Pick a different subject
        </Link>
      </div>
      <style>{`
        .zx-empty-card .zx-empty-mascot {
          animation: zx-empty-bob 4.4s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes zx-empty-bob {
          0%, 100% { transform: translateY(0)   rotate(-3deg); }
          50%      { transform: translateY(-5px) rotate(3deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .zx-empty-card .zx-empty-mascot { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
