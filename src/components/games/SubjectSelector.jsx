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
      <section className="mb-8 rounded-[20px] border border-white/80 bg-white/82 p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.18)] sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <MetaPill icon={SparklesIcon} label={gradeMeta.label} />
          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
            {totalGames} games available
          </span>
        </div>
        <GamesSectionHeading
          eyebrow="Pick a subject"
          title={`${gradeMeta.label} game tracks`}
          description="Choose a subject lane to open matching game cards, clear progress bars, and quick mobile-friendly tap targets."
        />
      </section>

      {state.loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-[20px] border border-slate-100 bg-white/82 p-5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
              <div className="h-12 w-12 rounded-full bg-slate-100 animate-pulse" />
              <div className="mt-5 h-7 w-2/3 rounded-2xl bg-slate-100 animate-pulse" />
              <div className="mt-3 h-4 w-full rounded-full bg-slate-100 animate-pulse" />
              <div className="mt-5 h-2.5 w-full rounded-full bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
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
                      ? `${progress.plays} saved play${progress.plays === 1 ? '' : 's'} in this subject.`
                      : `Start with ${progress.totalGames} game${progress.totalGames === 1 ? '' : 's'} waiting for you.`
                    : 'This pack is reserved for the next release.'
                }
              />
            )
          })}
        </div>
      )}
    </GamesShell>
  )
}
