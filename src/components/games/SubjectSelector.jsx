import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { getFallbackGames } from '../../data/gamesSeed'
import {
  SUBJECTS,
  getMyHistory,
  gradeByValue,
  listGames,
} from '../../utils/gamesService'
import GamesShell from './GamesShell'
import {
  GamesSectionHeading,
  MetaPill,
  SubjectProgressCard,
  buildSubjectProgress,
} from './gamesUi'

/**
 * /games/g/:grade — choose a subject inside the selected grade.
 * Keeps the same data flow, but presents subjects as premium progress cards.
 */
export default function SubjectSelector() {
  const { grade } = useParams()
  const gradeMeta = gradeByValue(grade)
  const [state, setState] = useState({ loading: true, games: [], history: [] })

  useEffect(() => {
    if (!gradeMeta) return
    document.title = `${gradeMeta.label} Games — ZedExams`

    let cancelled = false
    async function load() {
      setState((prev) => ({ ...prev, loading: true }))
      // allSettled so one failed read (e.g. signed-out history) cannot keep
      // the subject selector stuck on its skeleton.
      const [liveResult, historyResult] = await Promise.allSettled([
        listGames({ grade: gradeMeta.value }),
        getMyHistory(40),
      ])
      if (cancelled) return
      const liveGames = liveResult.status === 'fulfilled' ? liveResult.value : []
      const history = historyResult.status === 'fulfilled' ? historyResult.value : []
      setState({
        loading: false,
        games: liveGames.length ? liveGames : getFallbackGames({ grade: gradeMeta.value }),
        history,
      })
    }

    load()
    return () => { cancelled = true }
  }, [gradeMeta])

  if (!gradeMeta) return <Navigate to="/games" replace />

  const totalGames = state.games.length

  return (
    <GamesShell crumbs={[{ label: gradeMeta.label }]}>
      <section className="zx-card mb-8 rounded-[22px] bg-white p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <MetaPill icon={SparklesIcon} label={gradeMeta.label} />
          <span className="zx-chip">{totalGames} games available</span>
        </div>
        <GamesSectionHeading
          eyebrow="Pick a subject"
          title={`${gradeMeta.label} game tracks`}
          description="Choose a subject lane to open matching game cards, clear progress bars, and quick mobile-friendly tap targets."
        />
      </section>

      {state.loading ? (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="zx-card animate-pulse rounded-[22px] bg-white p-4">
              <div className="mb-3 h-16 w-16 rounded-[18px] border-2 border-slate-900 bg-slate-100" />
              <div className="h-4 w-2/3 rounded bg-slate-100" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
              <div className="mt-3 h-2 rounded-full border-[1.5px] border-slate-900 bg-slate-100" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3.5 grid-cols-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
          {SUBJECTS.map((subject) => {
            const progress = buildSubjectProgress(subject.slug, state.games, state.history)
            return (
              <SubjectProgressCard
                key={subject.slug}
                subject={subject}
                gamesCount={progress.totalGames}
                progress={progress.progress}
                href={`/games/g/${gradeMeta.value}/${subject.slug}`}
                showComingSoon={progress.totalGames === 0}
                helperText={
                  progress.totalGames
                    ? progress.plays
                      ? `${progress.plays} of ${progress.totalGames} played`
                      : `${progress.totalGames} games ready`
                    : 'Coming soon'
                }
              />
            )
          })}
        </div>
      )}
    </GamesShell>
  )
}
