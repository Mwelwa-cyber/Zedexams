import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { getFallbackGames } from '../../data/gamesSeed'
import { gradeByValue, listGames, subjectBySlug } from '../../utils/gamesService'
import GamesShell from './GamesShell'
import {
  GameDiscoveryCard,
  GamesSectionHeading,
  IconBubble,
  MetaPill,
  getGameStatusBadge,
  getSubjectMascot,
  getSubjectTheme,
} from './gamesUi'

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

  const subjectTheme = getSubjectTheme(subjectMeta.slug)

  return (
    <GamesShell
      crumbs={[
        { label: gradeMeta.label, to: `/games/g/${gradeMeta.value}` },
        { label: subjectMeta.label },
      ]}
    >
      <section className={`mb-8 overflow-hidden rounded-[20px] border ${subjectTheme.border} bg-gradient-to-br ${subjectTheme.gradient} p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.2)] sm:p-7`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill icon={SparklesIcon} label={gradeMeta.label} />
              <MetaPill icon={subjectTheme.icon} label={subjectMeta.label} />
            </div>
            <div className="mt-5 flex items-start gap-4">
              <IconBubble icon={subjectTheme.icon} theme={subjectTheme} size="h-14 w-14" iconClassName="h-7 w-7" />
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
            <div className="rounded-2xl bg-white/75 px-4 py-3 text-sm font-bold text-slate-700 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.25)]">
              {games.length} game{games.length === 1 ? '' : 's'} ready now
            </div>
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
            <div className="mb-5 rounded-[20px] border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 text-sm text-amber-900 shadow-[0_18px_40px_-30px_rgba(245,158,11,0.22)]">
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

          <div className="grid gap-4 lg:grid-cols-3">
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
    <div className="grid gap-4 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={`rounded-[20px] border border-slate-100 bg-white/82 p-5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)] ${index === 0 ? 'lg:col-span-2 sm:p-7' : ''}`}
        >
          <div className="h-12 w-12 rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-5 h-7 w-3/4 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="mt-3 h-4 w-full rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-2 h-4 w-5/6 rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-5 flex gap-2">
            <div className="h-8 w-24 rounded-full bg-slate-100 animate-pulse" />
            <div className="h-8 w-24 rounded-full bg-slate-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ gradeMeta, subjectMeta }) {
  const mascot = getSubjectMascot(subjectMeta.slug)

  return (
    <div className="zx-empty-card rounded-[20px] border border-dashed border-slate-300 bg-white/82 p-10 text-center shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <span
          role="img"
          aria-label={mascot.name}
          className="zx-empty-mascot inline-flex h-20 w-20 items-center justify-center rounded-full bg-white text-[3rem] leading-none ring-4 ring-white shadow-[0_16px_36px_-14px_rgba(15,23,42,0.32)]"
        >
          {mascot.emoji}
        </span>
        <h2 className="mt-5 text-2xl font-black text-slate-900">No games here yet — but {mascot.name} is on it!</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">
          {subjectMeta.label} for {gradeMeta.label} will land here as soon as the next pack is published.
        </p>
        <Link
          to={`/games/g/${gradeMeta.value}`}
          className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 active:scale-[0.98]"
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
