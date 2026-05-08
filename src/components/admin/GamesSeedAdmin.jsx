import { useState } from 'react'
import { GAMES_SEED } from '../../data/gamesSeed'
import { upsertGame } from '../../utils/gamesService'
import SeoHelmet from '../seo/SeoHelmet'

/**
 * Admin → /admin/games-seed — one-click import of the curated games seed
 * into the Firestore `games` collection. Same pattern as the CBC KB import.
 *
 * Idempotent: re-running just merges/updates existing docs by id.
 */
export default function GamesSeedAdmin() {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [done, setDone] = useState(false)

  async function runImport() {
    setBusy(true)
    setLog([])
    setDone(false)
    const lines = []
    for (const game of GAMES_SEED) {
      try {
        await upsertGame(game.id, game)
        lines.push({ id: game.id, ok: true, title: game.title })
      } catch (err) {
        lines.push({ id: game.id, ok: false, title: game.title, error: err?.message || 'failed' })
      }
      setLog([...lines])
    }
    setBusy(false)
    setDone(true)
  }

  const ok = log.filter((l) => l.ok).length
  const fail = log.filter((l) => !l.ok).length

  return (
    <div className="max-w-3xl mx-auto p-6">
      <SeoHelmet title="Games seed importer" noIndex />
      <h1 className="text-2xl font-black mb-1">Games Seed Importer</h1>
      <p className="theme-text-muted text-sm mb-6">
        Pushes the curated games library into Firestore at <code>games/&lt;id&gt;</code>.
        Safe to re-run — existing documents are merged in place.
      </p>

      <div className="theme-card border theme-border rounded-2xl p-5 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-black text-lg">{GAMES_SEED.length} games in seed</p>
            <p className="text-sm theme-text-muted">
              Grades: {[...new Set(GAMES_SEED.map((g) => g.grade))].sort().join(', ')} ·
              Subjects: {[...new Set(GAMES_SEED.map((g) => g.subject))].join(', ')}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={runImport}
            className="px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50"
          >
            {busy ? 'Importing…' : done ? 'Re-import' : 'Import games to Firestore'}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="theme-card border theme-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b theme-border flex items-center justify-between">
            <p className="font-black">Result</p>
            <p className="text-sm theme-text-muted">
              <span className="text-emerald-700 font-black">{ok} ok</span>
              {fail > 0 && <span className="ml-3 text-rose-700 font-black">{fail} failed</span>}
            </p>
          </div>
          <ul className="divide-y theme-border">
            {log.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className={l.ok ? 'text-emerald-600' : 'text-rose-600'}>{l.ok ? '✓' : '✗'}</span>
                <span className="font-bold theme-text">{l.title}</span>
                <span className="theme-text-muted ml-auto font-mono text-xs">{l.id}</span>
                {!l.ok && <span className="text-rose-700 text-xs">{l.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && fail === 0 && (
        <div className="mt-5 rounded-xl border-2 border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm font-bold">
          ✅ All games imported. Visit <a href="/games" className="underline">/games</a> to see them live.
        </div>
      )}
    </div>
  )
}
