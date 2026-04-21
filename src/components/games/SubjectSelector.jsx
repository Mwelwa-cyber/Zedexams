import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { gradeByValue, listGames, SUBJECTS } from '../../utils/gamesService'
import { getFallbackGames } from '../../data/gamesSeed'
import GamesShell from './GamesShell'

const COLOR = {
  rose:    { soft: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    grad: 'from-rose-400 to-pink-500' },
  sky:     { soft: 'bg-sky-50',     border: 'border-sky-200',     text: 'text-sky-700',     grad: 'from-sky-400 to-cyan-500' },
  emerald: { soft: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', grad: 'from-emerald-400 to-teal-500' },
  amber:   { soft: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   grad: 'from-amber-400 to-orange-500' },
}

/**
 * /games/g/:grade — Step 2: pick a subject within the chosen grade.
 * Counts the games in each subject so empty subjects can be deprioritised.
 */
export default function SubjectSelector() {
  const { grade } = useParams()
  const gradeMeta = gradeByValue(grade)
  const [counts, setCounts] = useState(null) // { subjectSlug: count }

  useEffect(() => {
    if (!gradeMeta) return
    document.title = `${gradeMeta.label} Games — ZedExams`
    let cancelled = false
    async function load() {
      try {
        const live = await listGames({ grade: gradeMeta.value })
        const list = live.length ? live : getFallbackGames({ grade: gradeMeta.value })
        const acc = {}
        for (const s of SUBJECTS) acc[s.slug] = 0
        for (const g of list) acc[g.subject] = (acc[g.subject] || 0) + 1
        if (!cancelled) setCounts(acc)
      } catch {
        if (!cancelled) setCounts({})
      }
    }
    load()
    return () => { cancelled = true }
  }, [gradeMeta])

  if (!gradeMeta) return <Navigate to="/games" replace />

  return (
    <GamesShell crumbs={[{ label: gradeMeta.label }]}>
      <header className="mb-8">
        <p className="text-xs font-black uppercase tracking-wider text-slate-500">Step 2 of 4</p>
        <h1 className="text-3xl sm:text-4xl font-black mt-1">
          {gradeMeta.label} — pick a subject
        </h1>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SUBJECTS.map((s) => {
          const c = COLOR[s.color] || COLOR.amber
          const n = counts?.[s.slug]
          return (
            <Link
              key={s.slug}
              to={`/games/g/${gradeMeta.value}/${s.slug}`}
              className={`group block rounded-2xl border-2 ${c.border} ${c.soft} p-6 hover:shadow-md hover:-translate-y-0.5 transition`}
            >
              <div className="flex items-center gap-4">
                <div className={`text-4xl w-16 h-16 rounded-2xl bg-white border ${c.border} flex items-center justify-center`}>
                  <span aria-hidden="true">{s.emoji}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-black">{s.label}</h2>
                  <p className={`text-sm font-bold ${c.text}`}>
                    {n == null ? 'Checking…' : n === 0 ? 'No games yet — coming soon' : `${n} ${n === 1 ? 'game' : 'games'} →`}
                  </p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </GamesShell>
  )
}
