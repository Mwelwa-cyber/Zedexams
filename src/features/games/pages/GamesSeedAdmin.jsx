import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GAMES_SEED } from '../../../data/gamesSeed'
import {
  deleteGameForever,
  importSeedGame,
  listAllGamesForAdmin,
  setGameActive,
} from '../services/gamesService'
import {
  STATUS,
  STATUS_HINT,
  STATUS_LABEL,
  buildRows,
  deleteConfirmCopy,
  describeSummary,
  filterRows,
  needsTypedConfirmation,
  partitionSelection,
  selectMissingIds,
  summariseResults,
  typedConfirmationAccepted,
  TYPE_TO_CONFIRM_WORD,
} from '../lib/gamesSeedAdminCore'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ActionMenu from '../../../shared/components/ActionMenu'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'

/**
 * Admin → /admin/games-seed — the games management screen.
 *
 * It compares the curated SEED catalogue (`src/data/gamesSeed.js`, a
 * bundled array) against the LIVE `games` collection in Firestore, and
 * offers the four actions that move a game between those states:
 *
 *     [ Select missing ] [ Clear selection ] [ Import selected ] [ Delete selected ]
 *
 * ── The two actions that must never be confused ─────────────────────────
 *
 * **Clear selection** unchecks boxes. It touches no data, ever. It was
 * previously labelled just "Clear", which reads as "clear the games" — the
 * one misreading that would be catastrophic on a screen that now also
 * deletes.
 *
 * **Delete selected** permanently removes Firestore records, behind a
 * confirmation (and, past five games, a typed DELETE). It never touches
 * the seed: a deleted seed game goes back to "Not imported" and can be
 * imported again, because the seed is a file in the bundle and nothing at
 * runtime can change it.
 *
 * Nothing is selected by default and no action runs without an explicit
 * selection, so there is no path here that acts on the whole catalogue.
 *
 * Every decision on this screen (statuses, filtering, which action applies
 * to which selection, the confirmation copy, the result counts) lives in
 * `lib/gamesSeedAdminCore.js` under plain node. This file is the wiring.
 */

const STATUS_PILL = {
  [STATUS.LIVE]: 'bg-emerald-100 text-emerald-800',
  [STATUS.INACTIVE]: 'bg-amber-100 text-amber-900',
  [STATUS.NOT_IMPORTED]: 'bg-sky-100 text-sky-800',
  [STATUS.UNKNOWN]: 'bg-slate-100 text-slate-600',
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: STATUS.LIVE, label: STATUS_LABEL[STATUS.LIVE] },
  { value: STATUS.INACTIVE, label: STATUS_LABEL[STATUS.INACTIVE] },
  { value: STATUS.NOT_IMPORTED, label: STATUS_LABEL[STATUS.NOT_IMPORTED] },
]

const BTN = 'px-3 py-2 rounded-xl font-bold text-sm border theme-border theme-text hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed'

export default function GamesSeedAdmin() {
  const [existing, setExisting] = useState(null)   // id -> live doc summary | null while loading/failed
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(null)           // 'import' | 'delete' | `row:${id}` | null
  const [result, setResult] = useState(null)       // { kind, rows, summary }
  const [confirm, setConfirm] = useState(null)     // { rows } for a pending deletion
  const [typed, setTyped] = useState('')

  const [statusFilter, setStatusFilter] = useState('all')
  const [gradeFilter, setGradeFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  /**
   * Re-read the live collection. Called on mount and after every write, so
   * the statuses on screen are the ones Firestore last reported rather
   * than a local guess about what a write did.
   */
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const map = await listAllGamesForAdmin()
      setExisting(map)
      setLoadError(null)
      return map
    } catch (err) {
      console.error('GamesSeedAdmin: failed to load the live games collection', err)
      // Deliberately left as null rather than {}: an empty map would render
      // 47 games as "Not imported" and invite an import over 47 live ones.
      setExisting(null)
      setLoadError(err?.message || 'Could not read the live games collection.')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const rows = useMemo(() => buildRows({ seed: GAMES_SEED, existing }), [existing])

  const grades = useMemo(
    () => [...new Set(rows.map((r) => r.grade).filter((g) => g != null))].sort((a, b) => a - b),
    [rows],
  )
  const subjects = useMemo(
    () => [...new Set(rows.map((r) => r.subject).filter(Boolean))].sort(),
    [rows],
  )
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.type).filter(Boolean))].sort(),
    [rows],
  )

  const visible = useMemo(
    () => filterRows(rows, {
      status: statusFilter, grade: gradeFilter, subject: subjectFilter, type: typeFilter, search,
    }),
    [rows, statusFilter, gradeFilter, subjectFilter, typeFilter, search],
  )

  const partition = useMemo(
    () => partitionSelection({ rows, visibleRows: visible, selectedIds: selected }),
    [rows, visible, selected],
  )

  const running = busy !== null
  const importable = partition.importable
  const deletable = partition.deletable

  /* ── selection ─────────────────────────────────────────────────── */

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // "Clear selection" — unchecks boxes and NOTHING else. No Firestore call
  // is reachable from this function; that is the point of it.
  function clearSelection() {
    setSelected(new Set())
  }

  // Only seed entries with no Firestore record, and only among the rows on
  // screen — so it obeys the filters rather than quietly reaching past them.
  function selectMissing() {
    if (!existing) return
    setSelected(new Set(selectMissingIds(visible)))
  }

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id))
  const someVisibleSelected = visible.some((r) => selected.has(r.id))

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.id))
      else visible.forEach((r) => next.add(r.id))
      return next
    })
  }

  /* ── import ────────────────────────────────────────────────────── */

  async function runImport() {
    if (!importable.length || running) return
    setBusy('import')
    setResult(null)
    const out = []
    for (const row of importable) {
      // The transaction inside importSeedGame re-checks Firestore, so a
      // row that went live in another tab since this page loaded comes
      // back 'skipped' rather than being written over.
      const r = await importSeedGame(row.seed)
      out.push({ ...r, title: row.title })
      setResult({ kind: 'import', rows: [...out], summary: summariseResults(out) })
    }
    await refresh()
    setSelected(new Set())
    setBusy(null)
    setResult({ kind: 'import', rows: out, summary: summariseResults(out) })
  }

  /* ── delete ────────────────────────────────────────────────────── */

  function askDelete(rowsToDelete) {
    if (!rowsToDelete.length || running) return
    setTyped('')
    setConfirm({ rows: rowsToDelete })
  }

  async function runDelete() {
    const target = confirm?.rows || []
    if (!target.length) return
    setBusy('delete')
    const out = []
    for (const row of target) {
      const r = await deleteGameForever(row.id, {
        title: row.title, type: row.type, grade: row.grade, subject: row.subject,
      })
      out.push({ ...r, title: row.title })
      setResult({ kind: 'delete', rows: [...out], summary: summariseResults(out) })
    }
    await refresh()
    setSelected((prev) => {
      const next = new Set(prev)
      out.filter((r) => r.outcome !== 'failed').forEach((r) => next.delete(r.id))
      return next
    })
    setConfirm(null)
    setTyped('')
    setBusy(null)
    setResult({ kind: 'delete', rows: out, summary: summariseResults(out) })
  }

  /* ── per-row actions ───────────────────────────────────────────── */

  async function toggleActive(row) {
    if (running) return
    setBusy(`row:${row.id}`)
    const r = await setGameActive(row.id, row.status !== STATUS.LIVE)
    await refresh()
    setBusy(null)
    if (r.outcome === 'failed') {
      setResult({
        kind: r.outcome,
        rows: [{ ...r, title: row.title }],
        summary: summariseResults([r]),
      })
    }
  }

  const copy = confirm ? deleteConfirmCopy(confirm.rows) : null
  const mustType = !!confirm && needsTypedConfirmation(confirm.rows.length)
  const canConfirm = !mustType || typedConfirmationAccepted(typed)

  return (
    <div className="max-w-4xl mx-auto p-6">
      <SeoHelmet title="Games seed importer" noIndex />
      <h1 className="text-2xl font-black mb-1">Games</h1>
      <p className="theme-text-muted text-sm mb-6">
        The curated seed catalogue (in the app bundle) beside the live <code>games</code>{' '}
        collection in Firestore. Importing copies a seed game to{' '}
        <code>games/&lt;id&gt;</code>; deleting removes the Firestore record only — the
        seed entry stays and can be imported again.
      </p>

      {loadError && (
        <div className="mb-5 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm font-bold">
          ⚠️ Could not read the live games collection ({loadError}). Statuses show as
          “Unknown” and no action is offered — reload once Firestore is reachable rather
          than importing over games that may already be live.
          <button type="button" onClick={refresh} className="ml-3 underline">Try again</button>
        </div>
      )}

      {/* ── toolbar ──────────────────────────────────────────────── */}
      <div className="theme-card border theme-border rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-black text-lg" data-testid="selection-count">
              {selected.size} of {rows.length} games selected
            </p>
            <p className="text-sm theme-text-muted">
              {visible.length === rows.length
                ? `${rows.length} in the catalogue`
                : `Showing ${visible.length} of ${rows.length}`}
              {partition.hidden.length > 0 && (
                <span className="text-amber-700 font-bold">
                  {' '}· {partition.hidden.length} selected {partition.hidden.length === 1 ? 'game is' : 'games are'} hidden by the filters
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={running || !existing} onClick={selectMissing} className={BTN}>
              Select missing
            </button>
            <button
              type="button"
              disabled={running || selected.size === 0}
              onClick={clearSelection}
              className={BTN}
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={running || importable.length === 0}
              onClick={runImport}
              title={importable.length === 0 ? 'Select a game that is not imported yet' : undefined}
              className="px-4 py-2 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'import' ? 'Importing…' : `Import selected${importable.length ? ` (${importable.length})` : ''}`}
            </button>
            {/* Deliberately NOT the same visual treatment as Import: outlined
                and red, so the destructive action never reads as the
                routine one at a glance. */}
            <button
              type="button"
              disabled={running || deletable.length === 0}
              onClick={() => askDelete(deletable)}
              title={deletable.length === 0 ? 'Select a game that exists in Firestore' : undefined}
              className="px-4 py-2 rounded-xl font-black text-rose-700 border-2 border-rose-300 bg-white hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'delete' ? 'Deleting…' : `Delete selected${deletable.length ? ` (${deletable.length})` : ''}`}
            </button>
          </div>
        </div>

        {/* A mixed selection is not refused — it is explained, and each
            button says exactly how much of the selection it will act on. */}
        {partition.mixed && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Mixed selection: <strong>Import selected</strong> will import the{' '}
            {importable.length} not-imported {importable.length === 1 ? 'game' : 'games'};{' '}
            <strong>Delete selected</strong> will delete the {deletable.length} Firestore{' '}
            {deletable.length === 1 ? 'record' : 'records'}. Neither touches the other.
          </p>
        )}
      </div>

      {/* ── filters + search ─────────────────────────────────────── */}
      <div className="theme-card border theme-border rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border theme-border overflow-hidden">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              aria-pressed={statusFilter === f.value}
              className={`px-3 py-1.5 text-sm font-bold ${statusFilter === f.value ? 'bg-slate-800 text-white' : 'theme-text hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="games-search">Search games</label>
        <input
          id="games-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search games…"
          className="flex-1 min-w-[180px] px-3 py-2 rounded-xl border theme-border text-sm"
        />
        <select
          aria-label="Grade"
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border theme-border text-sm font-bold"
        >
          <option value="all">All grades</option>
          {grades.map((g) => <option key={g} value={g}>Grade {g}</option>)}
        </select>
        <select
          aria-label="Subject"
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border theme-border text-sm font-bold"
        >
          <option value="all">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          aria-label="Game type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border theme-border text-sm font-bold"
        >
          <option value="all">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* ── list ─────────────────────────────────────────────────── */}
      <div className="theme-card border theme-border rounded-2xl overflow-hidden mb-5">
        <div className="flex items-center gap-3 px-5 py-3 border-b theme-border bg-slate-50/60">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected }}
            disabled={running || visible.length === 0}
            onChange={toggleSelectAllVisible}
            aria-label={`Select all ${visible.length} shown`}
            className="h-4 w-4 accent-emerald-600"
          />
          <span className="text-sm font-bold theme-text">
            Select all {visible.length} shown
          </span>
        </div>
        {loading && <p className="px-5 py-6 text-sm theme-text-muted">Loading the live collection…</p>}
        {!loading && visible.length === 0 && (
          <p className="px-5 py-6 text-sm theme-text-muted">No games match these filters.</p>
        )}
        <ul className="divide-y theme-border">
          {!loading && visible.map((row) => {
            const checked = selected.has(row.id)
            const rowBusy = busy === `row:${row.id}`
            return (
              <li key={row.id} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={running}
                  onChange={() => toggle(row.id)}
                  aria-label={row.title}
                  className="h-4 w-4 accent-emerald-600"
                />
                <span className="font-bold theme-text truncate">{row.title}</span>
                <span className="theme-text-muted text-xs whitespace-nowrap">
                  G{row.grade} · {row.subject} · {row.type}
                  {!row.inSeed && <span className="ml-2 text-slate-500">· not in seed</span>}
                </span>
                <span
                  title={STATUS_HINT[row.status]}
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL[row.status]}`}
                >
                  {rowBusy ? 'Working…' : STATUS_LABEL[row.status]}
                </span>
                <ActionMenu
                  ariaLabel={`Actions for ${row.title}`}
                  label={<span aria-hidden="true">⋮</span>}
                  buttonClassName="px-2 py-1 rounded-lg border theme-border font-black leading-none"
                  disabled={running}
                  items={[
                    row.status === STATUS.LIVE && {
                      label: 'Preview as a learner',
                      onSelect: () => window.open(`/games/play/${row.id}`, '_blank', 'noopener'),
                    },
                    row.status === STATUS.LIVE && {
                      label: 'Deactivate',
                      hint: 'Keeps the record; hides it from learners',
                      onSelect: () => toggleActive(row),
                    },
                    row.status === STATUS.INACTIVE && {
                      label: 'Activate',
                      hint: 'Show it to learners again',
                      onSelect: () => toggleActive(row),
                    },
                    row.status === STATUS.NOT_IMPORTED && row.inSeed && {
                      label: 'Import this game',
                      onSelect: async () => {
                        setBusy(`row:${row.id}`)
                        const r = await importSeedGame(row.seed)
                        await refresh()
                        setBusy(null)
                        setResult({ kind: 'import', rows: [{ ...r, title: row.title }], summary: summariseResults([r]) })
                      },
                    },
                    (row.status === STATUS.LIVE || row.status === STATUS.INACTIVE) && {
                      label: 'Delete permanently',
                      hint: 'Removes the Firestore record. Cannot be undone',
                      danger: true,
                      onSelect: () => askDelete([row]),
                    },
                  ].filter(Boolean)}
                />
              </li>
            )
          })}
        </ul>
      </div>

      {/* ── result ───────────────────────────────────────────────── */}
      {result && (
        <div className="theme-card border theme-border rounded-2xl overflow-hidden" data-testid="bulk-result">
          <div className="px-5 py-3 border-b theme-border flex items-center justify-between flex-wrap gap-2">
            <p className="font-black">
              {result.kind === 'delete' ? 'Deletion complete' : 'Import complete'}
            </p>
            <p className="text-sm theme-text-muted flex gap-4">
              {describeSummary(result.kind, result.summary).map((line, i) => (
                <span key={line} className={i === 0 ? 'font-black theme-text' : (result.summary.failed > 0 && i === 2 ? 'font-black text-rose-700' : '')}>
                  {line}
                </span>
              ))}
            </p>
          </div>
          <ul className="divide-y theme-border">
            {result.rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className={r.outcome === 'ok' ? 'text-emerald-600' : r.outcome === 'skipped' ? 'text-slate-400' : 'text-rose-600'}>
                  {r.outcome === 'ok' ? '✓' : r.outcome === 'skipped' ? '–' : '✗'}
                </span>
                <span className="font-bold theme-text">{r.title}</span>
                <span className="theme-text-muted ml-auto font-mono text-xs">{r.id}</span>
                {r.outcome !== 'ok' && (
                  // The reason code, not a stack: enough to tell
                  // "already existed" from "permission-denied" without
                  // putting backend internals on the screen.
                  <span className={r.outcome === 'failed' ? 'text-rose-700 text-xs' : 'text-slate-500 text-xs'}>
                    {r.reason || 'failed'}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {result.kind === 'import' && result.summary.ok > 0 && (
            <p className="px-5 py-3 text-sm font-bold text-emerald-800 bg-emerald-50">
              ✅ Imported. Visit <Link to="/games" className="underline">/games</Link> to see them live.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={copy?.title || ''}
        confirmLabel={busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
        cancelLabel="Cancel"
        variant="danger"
        loading={busy === 'delete'}
        confirmDisabled={!canConfirm}
        onCancel={() => { if (busy !== 'delete') { setConfirm(null); setTyped('') } }}
        onConfirm={() => { if (canConfirm) runDelete() }}
        message={copy && (
          <div className="space-y-2">
            <p>{copy.body}</p>
            <ul className="list-disc pl-5">
              {copy.names.map((n) => <li key={n}>{n}</li>)}
              {copy.more > 0 && <li>…and {copy.more} more</li>}
            </ul>
            <p className="text-xs">{copy.note}</p>
            {mustType && (
              <label className="block pt-1">
                <span className="font-bold theme-text">Type {TYPE_TO_CONFIRM_WORD} to confirm</span>
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-label={`Type ${TYPE_TO_CONFIRM_WORD} to confirm`}
                  className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-rose-300 text-sm"
                />
              </label>
            )}
          </div>
        )}
      />
    </div>
  )
}
