import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { GAMES_SEED } from '../../data/gamesSeed'
import { upsertGame } from '../../utils/gamesService'
import SeoHelmet from '../../shared/components/SeoHelmet'

/**
 * Admin → /admin/games-seed — selective import of the curated games seed
 * into the Firestore `games` collection.
 *
 * Each seed game is shown with its current Firestore status (new / active /
 * deactivated) and a checkbox. NOTHING is selected by default — importing is
 * an explicit, per-game choice, so games deliberately deleted or deactivated
 * in Firestore are never resurrected by a bulk re-run. Importing a game that
 * exists is still a merge by id (and re-activates it — upsertGame forces
 * active unless the seed says otherwise).
 */
export default function GamesSeedAdmin() {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [done, setDone] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [existing, setExisting] = useState(null)   // id -> { active } | null while loading
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const snap = await getDocs(collection(db, 'games'))
        if (cancelled) return
        const map = {}
        snap.docs.forEach((d) => { map[d.id] = { active: d.data()?.active !== false } })
        setExisting(map)
      } catch (err) {
        if (cancelled) return
        console.error('GamesSeedAdmin: failed to load existing games', err)
        setLoadError(err?.message || 'Could not load the live games collection.')
        setExisting({})
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const statusOf = useMemo(() => {
    return (game) => {
      if (!existing) return { key: 'loading', label: 'Checking…', className: 'bg-slate-100 text-slate-500' }
      const doc = existing[game.id]
      if (!doc) return { key: 'missing', label: 'Not in Firestore', className: 'bg-sky-100 text-sky-800' }
      if (!doc.active) return { key: 'inactive', label: 'Deactivated in Firestore', className: 'bg-amber-100 text-amber-800' }
      return { key: 'active', label: 'Live in Firestore', className: 'bg-emerald-100 text-emerald-800' }
    }
  }, [existing])

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectMissing() {
    if (!existing) return
    setSelected(new Set(GAMES_SEED.filter((g) => !existing[g.id]).map((g) => g.id)))
  }

  function selectNone() {
    setSelected(new Set())
  }

  async function runImport() {
    const games = GAMES_SEED.filter((g) => selected.has(g.id))
    if (!games.length) return
    setBusy(true)
    setLog([])
    setDone(false)
    const lines = []
    for (const game of games) {
      try {
        await upsertGame(game.id, game)
        lines.push({ id: game.id, ok: true, title: game.title })
      } catch (err) {
        lines.push({ id: game.id, ok: false, title: game.title, error: err?.message || 'failed' })
      }
      setLog([...lines])
    }
    // Refresh statuses so freshly imported games show as live.
    setExisting((prev) => {
      const next = { ...(prev || {}) }
      lines.filter((l) => l.ok).forEach((l) => { next[l.id] = { active: true } })
      return next
    })
    setSelected(new Set())
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
        Pick which curated seed games to push into Firestore at <code>games/&lt;id&gt;</code>.
        Only ticked games are written — anything you have deleted or deactivated stays
        that way unless you explicitly tick it again (importing re-activates it).
      </p>

      {loadError && (
        <div className="mb-5 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm font-bold">
          ⚠️ Could not read the live games collection ({loadError}). Statuses are unknown —
          only import games you are sure about.
        </div>
      )}

      <div className="theme-card border theme-border rounded-2xl p-5 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-black text-lg">
              {selected.size} of {GAMES_SEED.length} games selected
            </p>
            <p className="text-sm theme-text-muted">
              Grades: {[...new Set(GAMES_SEED.map((g) => g.grade))].sort((a, b) => a - b).join(', ')} ·
              Subjects: {[...new Set(GAMES_SEED.map((g) => g.subject))].join(', ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !existing}
              onClick={selectMissing}
              className="px-3 py-2 rounded-xl font-bold text-sm border theme-border theme-text hover:bg-slate-50 disabled:opacity-50"
            >
              Select missing
            </button>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={selectNone}
              className="px-3 py-2 rounded-xl font-bold text-sm border theme-border theme-text hover:bg-slate-50 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={runImport}
              className="px-5 py-2 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50"
            >
              {busy ? 'Importing…' : `Import ${selected.size || ''} selected`}
            </button>
          </div>
        </div>
      </div>

      <div className="theme-card border theme-border rounded-2xl overflow-hidden mb-5">
        <ul className="divide-y theme-border">
          {GAMES_SEED.map((game) => {
            const status = statusOf(game)
            const checked = selected.has(game.id)
            return (
              <li key={game.id}>
                <label className="flex items-center gap-3 px-5 py-2.5 text-sm cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(game.id)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="font-bold theme-text">{game.title}</span>
                  <span className="theme-text-muted text-xs">G{game.grade} · {game.subject} · {game.type}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${status.className}`}>
                    {status.label}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
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
          ✅ Selected games imported. Visit <a href="/games" className="underline">/games</a> to see them live.
        </div>
      )}
    </div>
  )
}
