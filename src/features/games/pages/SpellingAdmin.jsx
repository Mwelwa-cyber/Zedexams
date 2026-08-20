/**
 * Admin → /admin/spelling — spelling content management.
 *
 * Spelling words are EDUCATIONAL CONTENT, not game data, and this screen
 * treats them the way the notes and question-bank surfaces treat theirs: an
 * author writes, a human reviews, and only a reviewed record reaches a child.
 * An AI may fill in a sentence, a cut and an explanation and it lands as
 * `pending` — nothing in this screen can promote a record on its own, and the
 * Approve button is the one act that sets `approved`.
 *
 * THE VALIDATION IS NOT THIS SCREEN'S. Every rule comes from
 * `spellingContentCore`, which the bank test and the pack loader also run, so
 * the bar an admin has to clear here is exactly the bar the shipped content
 * already clears. A form with its own copy of the rules is a second
 * implementation of one decision, and the form is the copy nobody runs in CI.
 *
 * PROBLEMS ARE SHOWN BEFORE SAVE, NOT AFTER. The editor validates as you type
 * and the save button is disabled while anything is wrong, with every problem
 * listed — because "malformed spelling data must never silently reach
 * learners" is only true if the person authoring it can see what is wrong at
 * the moment they can still fix it.
 *
 * THE BUNDLED BANK IS THE BASELINE, and the importer is how it gets here. It
 * is idempotent (the doc id is derived from grade + word), it SKIPS a word
 * that already exists rather than overwriting an admin's edit, and it reports
 * every row it refused rather than dropping them quietly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import {
  DIFFICULTIES,
  STATUSES,
  STRATEGIES,
  normaliseWord,
  servableToLearner,
  validateWord,
  fillGap,
} from '../lib/spellingContentCore'
import {
  deleteWord,
  importWords,
  listWordsForAdmin,
  saveWord,
  setApproval,
  setWordActive,
} from '../services/spellingContentService'
import { coachFor } from '../lib/spellingCoachCore'
import { speakWord } from '../lib/spellingSpeech'
import BreakItUpCoach from '../components/BreakItUpCoach'
import '../components/spelling.css'

const EMPTY = {
  word: '', grade: 7, band: '', difficulty: 'medium', contextSentence: '',
  chunks: [], trap: null, strategy: null, hook: '', hookNote: '', why: '',
  relatedWords: [], status: 'draft', approved: false, active: true,
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Needs review' },
  { id: 'approved', label: 'Approved' },
  { id: 'draft', label: 'Drafts' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'problems', label: 'Has problems' },
]

export default function SpellingAdmin() {
  const [grade, setGrade] = useState(7)
  const [rows, setRows] = useState([])
  const [bandTable, setBandTable] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [importReport, setImportReport] = useState(null)

  const bands = useMemo(() => new Set(bandTable.map((band) => band.id)), [bandTable])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, bank] = await Promise.all([
        listWordsForAdmin({ grade }),
        import('../../../data/spellingBank.js'),
      ])
      setBandTable(bank.SPELLING_BANDS)
      setRows(list)
    } catch (err) {
      // A failed READ is reported as a failed read. Rendering an empty list
      // here would put "Import the whole bank" one click away from a screen
      // that already has 879 words behind it.
      setError(err?.message || 'Could not load the spelling words.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [grade])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (term && !row.word.includes(term)) return false
      if (filter === 'problems') return validateWord(row, { bands }).length > 0
      if (filter === 'all') return true
      return row.status === filter
    })
  }, [rows, filter, search, bands])

  const counts = useMemo(() => ({
    all: rows.length,
    approved: rows.filter((r) => r.status === 'approved').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    problems: rows.filter((r) => validateWord(r, { bands }).length > 0).length,
  }), [rows, bands])

  /* ── actions ─────────────────────────────────────────────────────── */
  const run = async (label, fn) => {
    setBusy(label)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err?.message || 'That did not work.')
    } finally {
      setBusy('')
    }
  }

  const importBank = () => run('import', async () => {
    const bank = await import('../../../data/spellingBank.js')
    const coach = await import('../../../data/spellingCoach.js')
    const payload = bank.SPELLING_BANK.map((row) => {
      const cut = coach.SPELLING_COACH[row.word] || null
      return {
        word: row.word,
        grade: bank.SPELLING_GRADE,
        band: row.band,
        contextSentence: row.sentence,
        ...(cut ? {
          chunks: cut.chunks, trap: cut.trap, strategy: cut.strategy,
          hook: cut.hook, hookNote: cut.hookNote, why: cut.why, relatedWords: cut.transfer,
        } : {}),
        source: 'bundled-bank',
        // The bundled bank IS reviewed content — it is hand-authored and
        // `test:spelling-bank` gates it in CI — so it arrives approved rather
        // than dropping 879 words into a review queue nobody could clear.
        // Anything typed into this screen, or generated, does not.
        status: 'approved',
        approved: true,
      }
    })
    const report = await importWords(payload, { bands: new Set(bank.SPELLING_BANDS.map((b) => b.id)), status: 'approved' })
    setImportReport(report)
  })

  const openNew = () => setEditing({ ...EMPTY, grade, band: bandTable[0]?.id || '' })

  return (
    <div className="lhx">
      <SeoHelmet title="Spelling content · Admin" noIndex />
      <div className="lhx-page lhx-sp-admin">
        <header className="lhx-sp-map-head">
          <Link to="/admin" className="lhx-sp-back" aria-label="Back to admin">‹</Link>
          <h1 className="lhx-sp-map-title">Spelling content</h1>
        </header>

        <p className="lhx-sp-admin-lede">
          Words a learner is served must be <b>approved</b> and <b>active</b>. Generated content
          always lands as <b>needs review</b> — approving is a person&apos;s decision, and editing an
          approved word sends it back for review because the old approval was of different words.
        </p>

        <div className="lhx-sp-admin-bar">
          <label>
            Grade
            <select value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((g) => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </label>
          <input
            type="search"
            value={search}
            placeholder="Search words"
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search spelling words"
          />
          <button type="button" className="lhx-sp-admin-btn" onClick={openNew}>+ New word</button>
          <button type="button" className="lhx-sp-admin-btn" onClick={importBank} disabled={busy === 'import'}>
            {busy === 'import' ? 'Importing…' : 'Import the bundled bank'}
          </button>
        </div>

        <div className="lhx-sp-admin-filters" role="tablist">
          {FILTERS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`lhx-sp-admin-tab ${filter === tab.id ? 'is-on' : ''}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
              {counts[tab.id] != null && <span> {counts[tab.id]}</span>}
            </button>
          ))}
        </div>

        {error && <p className="lhx-sp-admin-error" role="alert">{error}</p>}

        {importReport && (
          <div className="lhx-sp-admin-report" role="status">
            <p>
              <b>{importReport.imported} imported</b> · {importReport.skipped} already there
              {importReport.rejected.length > 0 && <> · <b>{importReport.rejected.length} refused</b></>}
            </p>
            {/* Refused rows are NAMED. A report reading "412 imported" while
                60 malformed rows vanished is how bad content becomes
                invisible. */}
            {importReport.rejected.slice(0, 8).map((row) => (
              <p key={row.word} className="lhx-sp-admin-reject">{row.word}: {row.problems[0]}</p>
            ))}
            {importReport.rejected.length > 8 && <p>…and {importReport.rejected.length - 8} more refused</p>}
            <button type="button" className="lhx-sp-admin-btn" onClick={() => setImportReport(null)}>Dismiss</button>
          </div>
        )}

        {loading && <p className="lhx-sp-loading">Loading spelling words…</p>}

        {/* Only when the read SUCCEEDED. "No words stored" beside a read error
            is the screen answering a question it does not know the answer to,
            and it puts a whole-bank import one click away from a bank that may
            already hold 879 words. */}
        {!loading && !error && !visible.length && (
          <p className="lhx-sp-empty">
            {rows.length
              ? 'No words match that filter.'
              : `No spelling words stored for Grade ${grade} yet. Learners are playing the bundled bank — import it here to be able to edit it.`}
          </p>
        )}

        <ul className="lhx-sp-admin-list">
          {visible.map((row) => {
            const problems = validateWord(row, { bands })
            const live = servableToLearner(row, { bands })
            return (
              <li key={row.id} className="lhx-sp-admin-row">
                <div className="lhx-sp-admin-main">
                  <b>{row.word}</b>
                  <span className={`lhx-sp-admin-pill is-${row.status}`}>{row.status}</span>
                  {!row.active && <span className="lhx-sp-admin-pill is-off">inactive</span>}
                  {live && <span className="lhx-sp-admin-pill is-live">live</span>}
                  {problems.length > 0 && (
                    <span className="lhx-sp-admin-pill is-bad">{problems.length} problem{problems.length > 1 ? 's' : ''}</span>
                  )}
                  <span className="lhx-sp-admin-meta">
                    {row.band}{row.chunks.length ? ` · ${row.chunks.join('·')}` : ' · no cut'}
                  </span>
                  <span className="lhx-sp-admin-sentence">{row.contextSentence}</span>
                  {problems.length > 0 && (
                    <span className="lhx-sp-admin-problem">{problems[0]}</span>
                  )}
                </div>
                <div className="lhx-sp-admin-actions">
                  <button type="button" onClick={() => speakWord(row.word, { audioUrl: row.audio })}>🔊</button>
                  <button type="button" onClick={() => setPreview(row)}>Preview</button>
                  <button type="button" onClick={() => setEditing(row)}>Edit</button>
                  {row.status !== 'approved' && (
                    <button
                      type="button"
                      disabled={problems.length > 0 || busy !== ''}
                      title={problems.length ? 'Fix the problems first' : 'Approve for learners'}
                      onClick={() => run('approve', () => setApproval(row.id, { approved: true, bands }))}
                    >
                      Approve
                    </button>
                  )}
                  {row.status === 'approved' && (
                    <button type="button" disabled={busy !== ''}
                      onClick={() => run('reject', () => setApproval(row.id, { approved: false, bands }))}>
                      Un-approve
                    </button>
                  )}
                  <button type="button" disabled={busy !== ''}
                    onClick={() => run('active', () => setWordActive(row.id, !row.active))}>
                    {row.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  <button type="button" className="is-danger"
                    onClick={() => setConfirm(row)}>Delete</button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {editing && (
        <WordEditor
          value={editing}
          bandTable={bandTable}
          bands={bands}
          onClose={() => setEditing(null)}
          onSave={async (record) => {
            await run('save', () => saveWord(record, { bands }))
            setEditing(null)
          }}
        />
      )}

      {preview && <LearnerPreview row={preview} onClose={() => setPreview(null)} />}

      {confirm && (
        <ConfirmDialog
          open
          title={`Delete "${confirm.word}"?`}
          // Deactivating is almost always what is wanted, and saying so on the
          // destructive dialog is cheaper than undoing a deletion.
          message="This removes the record for good. To take it off the learners' ladder while keeping its history, use Deactivate instead."
          confirmLabel="Delete for good"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const id = confirm.id; setConfirm(null); run('delete', () => deleteWord(id)) }}
        />
      )}
    </div>
  )
}

/* ── the editor ────────────────────────────────────────────────────── */

function WordEditor({ value, bandTable, bands, onClose, onSave }) {
  const [draft, setDraft] = useState(() => ({
    ...value,
    chunkText: (value.chunks || []).join(' | '),
    relatedText: (value.relatedWords || []).join(', '),
  }))

  const record = useMemo(() => normaliseWord({
    ...draft,
    chunks: draft.chunkText.split('|').map((c) => c.trim()).filter(Boolean),
    relatedWords: draft.relatedText.split(',').map((w) => w.trim()).filter(Boolean),
    trap: draft.trap === '' || draft.trap == null ? null : Number(draft.trap),
  }), [draft])

  const problems = validateWord(record, { bands })
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const coach = coachFor({
    answer: record.word, chunks: record.chunks, trap: record.trap, strategy: record.strategy,
    why: record.why, hook: record.hook, hookNote: record.hookNote, related: record.relatedWords,
  })

  return (
    <div className="lhx-sp-sheet-wrap" role="dialog" aria-modal="true" aria-label="Edit spelling word">
      <button type="button" className="lhx-sp-scrim" onClick={onClose} aria-label="Close" />
      <div className="lhx-sp-sheet lhx-sp-editor">
        <span className="lhx-sp-grab" aria-hidden="true" />
        <h2 className="lhx-sp-sheet-title">{value.id ? `Edit "${value.word}"` : 'New spelling word'}</h2>

        <div className="lhx-sp-form">
          <label>
            Word
            <input value={draft.word} onChange={(e) => set({ word: e.target.value })} autoComplete="off" />
          </label>

          <div className="lhx-sp-form-row">
            <label>
              Grade
              <select value={draft.grade ?? ''} onChange={(e) => set({ grade: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7].map((g) => <option key={g} value={g}>Grade {g}</option>)}
              </select>
            </label>
            <label>
              Chapter (band)
              <select value={draft.band} onChange={(e) => set({ band: e.target.value })}>
                <option value="">Choose…</option>
                {bandTable.map((band) => <option key={band.id} value={band.id}>{band.title}</option>)}
              </select>
            </label>
            <label>
              Difficulty
              <select value={draft.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>

          <label>
            Context sentence — put <code>___</code> where the word goes
            <textarea
              rows={2}
              value={draft.contextSentence}
              onChange={(e) => set({ contextSentence: e.target.value })}
              placeholder="Our ___ helped us carry the water."
            />
          </label>
          {record.word && record.contextSentence && (
            <p className="lhx-sp-form-hint">
              After answering, the learner sees: <i>{fillGap(record.word, record.contextSentence)}</i>
            </p>
          )}

          <label>
            Recorded audio URL (optional — the device voice is used when empty)
            <input value={draft.audio || ''} onChange={(e) => set({ audio: e.target.value })} autoComplete="off" />
          </label>
          <button type="button" className="lhx-sp-admin-btn"
            onClick={() => speakWord(record.word, { audioUrl: record.audio })}>
            🔊 Preview the pronunciation
          </button>

          <fieldset className="lhx-sp-form-block">
            <legend>The cut (optional — most words need none)</legend>
            <label>
              Chunks, separated by <code>|</code>
              <input value={draft.chunkText} onChange={(e) => set({ chunkText: e.target.value })}
                placeholder="sep | a | rate" autoComplete="off" />
            </label>
            {/* The one automatable check, shown live: a cut that does not
                rebuild the word teaches a child a word that does not exist. */}
            {record.chunks.length > 0 && (
              <p className={`lhx-sp-form-check ${record.chunks.join('') === record.word ? 'is-ok' : 'is-bad'}`}>
                {record.chunks.join('') === record.word
                  ? `✓ rebuilds "${record.word}"`
                  : `✗ rebuilds "${record.chunks.join('')}", not "${record.word}"`}
              </p>
            )}

            <div className="lhx-sp-form-row">
              <label>
                Strategy
                <select value={draft.strategy || ''} onChange={(e) => set({ strategy: e.target.value || null })}>
                  <option value="">None</option>
                  {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>
                Trap — which chunk catches people
                <select value={draft.trap ?? ''} onChange={(e) => set({ trap: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">None</option>
                  {record.chunks.map((chunk, i) => <option key={i} value={i}>{i + 1}. {chunk}</option>)}
                </select>
              </label>
            </div>

            <label>
              Why people get it wrong
              <textarea rows={2} value={draft.why} onChange={(e) => set({ why: e.target.value })} />
            </label>

            <label>
              Memory hook (rare — leave empty rather than inventing one)
              <input value={draft.hook} onChange={(e) => set({ hook: e.target.value })} autoComplete="off" />
            </label>
            <label>
              What the hook means (required when there is a hook)
              <input value={draft.hookNote} onChange={(e) => set({ hookNote: e.target.value })} autoComplete="off" />
            </label>
            <label>
              Related words the same cut solves, comma separated
              <input value={draft.relatedText} onChange={(e) => set({ relatedText: e.target.value })} autoComplete="off" />
            </label>
          </fieldset>

          <label>
            Status
            <select value={draft.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        {problems.length > 0 && (
          <div className="lhx-sp-form-problems" role="alert">
            <p><b>Fix these before saving</b></p>
            {problems.map((problem) => <p key={problem}>• {problem}</p>)}
          </div>
        )}

        {coach && (
          <div className="lhx-sp-form-preview">
            <p><b>The learner sees this cut</b></p>
            <div className="lhx-sp-chunks">
              {coach.chunks.map((chunk, i) => (
                <span key={i} className={`lhx-sp-chunk ${coach.trap === i ? 'is-trap' : ''}`}>{chunk}</span>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="lhx-sp-cta" disabled={problems.length > 0}
          onClick={() => onSave(record)}>
          {problems.length ? `${problems.length} problem${problems.length > 1 ? 's' : ''} to fix` : 'Save'}
        </button>
        <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

/* ── the learner preview ───────────────────────────────────────────── */

/**
 * What the learner actually gets — the real coach component, not a mock-up of
 * it. An admin previewing an approximation has not previewed anything.
 */
function LearnerPreview({ row, onClose }) {
  const coach = coachFor({
    answer: row.word, chunks: row.chunks, trap: row.trap, strategy: row.strategy,
    why: row.why, hook: row.hook, hookNote: row.hookNote, related: row.relatedWords,
  }, { grade: row.grade })

  return (
    <div className="lhx-sp-sheet-wrap" role="dialog" aria-modal="true" aria-label="Learner preview">
      <button type="button" className="lhx-sp-scrim" onClick={onClose} aria-label="Close" />
      <div className="lhx-sp-sheet lhx-sp-editor">
        <span className="lhx-sp-grab" aria-hidden="true" />
        <h2 className="lhx-sp-sheet-title">Learner preview</h2>
        <p className="lhx-sp-sheet-sub">
          The sentence, and the coach shown after a miss.
        </p>

        <div className="lhx-sp-form-preview">
          <p><b>Before answering</b></p>
          <p className="lhx-sp-sentence">{row.contextSentence.split('___').map((part, i, all) => (
            <span key={i}>{part}{i < all.length - 1 && <b className="lhx-sp-gap">· · ·</b>}</span>
          ))}</p>
          <p><b>After answering</b></p>
          <p className="lhx-sp-sentence">{fillGap(row.word, row.contextSentence)}</p>
        </div>

        {coach
          ? <BreakItUpCoach coach={coach} attempt="" onDone={onClose} onSkip={onClose} />
          : <p className="lhx-sp-empty">This word has no cut, so a learner who misses it is shown the correct spelling and no coach.</p>}

        <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
