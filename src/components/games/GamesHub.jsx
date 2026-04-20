import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { GRADES } from '../../utils/gamesService'
import GamesShell from './GamesShell'

/**
 * /games — Step 1 in the Grade → Subject → Game list → Play flow.
 * Public landing where the pupil picks their grade.
 */
export default function GamesHub() {
  useEffect(() => {
    document.title = 'Free CBC Learning Games — ZedExams'
    setMeta('Play free Zambian CBC-aligned games for Grade 1 to Grade 12. Quiz, memory, spelling and math sprints.')
  }, [])

  const bands = [
    { key: 'lower', label: 'Lower Primary',   note: 'Grades 1 – 3', tint: 'from-amber-100 to-rose-100',  ring: 'border-amber-200' },
    { key: 'middle', label: 'Middle Primary', note: 'Grades 4 – 6', tint: 'from-emerald-100 to-teal-100', ring: 'border-emerald-200' },
    { key: 'upper', label: 'Upper Primary',   note: 'Grades 7 – 9', tint: 'from-sky-100 to-indigo-100',   ring: 'border-sky-200' },
    { key: 'secondary', label: 'Secondary',   note: 'Grades 10 – 12', tint: 'from-violet-100 to-pink-100', ring: 'border-violet-200' },
  ]

  return (
    <GamesShell crumbs={[]}>
      <section className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-amber-200 text-xs font-black uppercase tracking-wide text-amber-800 mb-4">
          <span>🇿🇲</span><span>CBC-aligned · Grade 1 to 12</span>
        </div>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight max-w-3xl mx-auto">
          Pick your grade and{' '}
          <span className="text-amber-600">start playing</span>.
        </h1>
        <p className="mt-3 text-base text-slate-700 max-w-xl mx-auto">
          Free CBC games for Zambian pupils. No sign-up to play, sign in to save your scores and climb the leaderboard.
        </p>
      </section>

      {bands.map((band) => {
        const grades = GRADES.filter((g) => g.band === band.key)
        return (
          <section key={band.key} className="mb-8">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-500 mb-3">
              {band.label} <span className="font-normal text-slate-400">· {band.note}</span>
            </h2>
            <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 p-4 rounded-2xl bg-gradient-to-br ${band.tint} border-2 ${band.ring}`}>
              {grades.map((g) => (
                <Link
                  key={g.value}
                  to={`/games/g/${g.value}`}
                  className="bg-white rounded-xl border-2 border-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition flex flex-col items-center justify-center py-5"
                >
                  <span className="text-3xl font-black text-slate-900 leading-none">{g.value}</span>
                  <span className="mt-1 text-[11px] font-black uppercase tracking-wider text-slate-500">Grade</span>
                </Link>
              ))}
            </div>
          </section>
        )
      })}
    </GamesShell>
  )
}

function setMeta(content) {
  let tag = document.querySelector('meta[name="description"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'description'
    document.head.appendChild(tag)
  }
  tag.content = content
}
