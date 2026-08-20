/**
 * Admin → /admin/spelling-ride — Spelling Ride's two admin surfaces.
 *
 * WORD CHOICE SENTENCES, and the COHORT REPORT. They share a page because
 * they are the same job seen from two ends: which sentences are we serving,
 * and which words is the cohort failing. An admin who finds `necessary` at the
 * top of the second list can act on it in the first.
 *
 * THE SENTENCES follow `/admin/spelling`'s rules exactly, because they are the
 * same kind of thing: validation comes from `spellingSentenceCore` (which the
 * guard and the game also run, so the bar here is the bar the shipped content
 * clears), nothing on this screen can promote a record on its own, and editing
 * an approved sentence sends it back for review — the old approval was of
 * different words.
 *
 * THE COHORT REPORT NAMES NO CHILD. See `spellingCohortCore` for why, and for
 * why this is an admin screen rather than the teacher-facing one §8 of the
 * brief asks for: there is no learner↔teacher link in this product, so a
 * teacher has no set of learners to aggregate and could not read their records
 * if they had. That is a stated limitation, not a silently different feature.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import { SPELLING_CHOICE_BANK } from '../../../data/spellingChoiceBank'
import { DISTRACTOR_COUNT, normaliseSentence, servableSentence, validateSentence } from '../lib/spellingSentenceCore'
import { MIN_COHORT, aggregateCohort, cohortCsv } from '../lib/spellingCohortCore'
import {
  deleteSentence,
  listSentencesForAdmin,
  saveSentence,
  setSentenceApproval,
} from '../services/spellingSentenceService'
import { readSpellingCohortPools } from '../services/spellingProgressService'
import '../components/spelling.css'

const EMPTY = { id: '', text: '', answer: '', distractors: ['', ''], note: '', grade: 7, status: 'draft', approved: false, active: true }

function download(name, body) {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function SpellingRideAdmin() {
  const [view, setView] = useState('sentences')

  return (
    <div className="lhx">
      <SeoHelmet title="Spelling Ride · Admin" noIndex />
      <div className="lhx-page lhx-sp-admin">
        <header className="lhx-sp-map-head">
          <Link to="/admin" className="lhx-sp-back" aria-label="Back to admin">‹</Link>
          <h1 className="lhx-sp-map-title">Spelling Ride</h1>
        </header>

        <div className="lhx-sp-admin-filters" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'sentences'}
            className={`lhx-sp-admin-tab ${view === 'sentences' ? 'is-on' : ''}`}
            onClick={() => setView('sentences')}
          >
            Word Choice sentences
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'cohort'}
            className={`lhx-sp-admin-tab ${view === 'cohort' ? 'is-on' : ''}`}
            onClick={() => setView('cohort')}
          >
            Which words the cohort fails
          </button>
        </div>

        {view === 'sentences' ? <SentencesPanel /> : <CohortPanel />}
      </div>
    </div>
  )
}

/* ── Word Choice sentences ─────────────────────────────────────────── */

function SentencesPanel() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await listSentencesForAdmin())
    } catch (err) {
      setError(err?.message || 'Could not load the sentences.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (label, fn) => {
    setBusy(label)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err?.problems?.[0] || err?.message || 'That did not work.')
    } finally {
      setBusy('')
    }
  }

  /**
   * Seed the collection from the bundled bank.
   *
   * Idempotent by construction — the doc id is the item's own id — and it
   * lands each row APPROVED, because these are the reviewed baseline that
   * already ships in the bundle. A row that is already there is written over
   * with the same content, which is a no-op an admin cannot get wrong; an
   * edited row keeps its id, so re-importing would restore the bundled text.
   * That is why the button says so.
   */
  const importBundled = () => run('import', async () => {
    for (const item of SPELLING_CHOICE_BANK) {
      await saveSentence({ ...item, grade: 7, status: 'approved', approved: true, active: true })
    }
  })

  return (
    <>
      <p className="lhx-sp-admin-lede">
        The three lanes of Spelling Ride&apos;s Word Choice mode. A sentence a learner is served
        must be <b>approved</b> and <b>active</b>; editing an approved one sends it back for
        review, because the old approval was of different words. The bundled{' '}
        {SPELLING_CHOICE_BANK.length}-sentence bank is what plays when this collection is empty or
        unreachable, so nothing here can leave the game without content.
      </p>

      <div className="lhx-sp-admin-bar">
        <button type="button" className="lhx-sp-admin-btn" onClick={() => setEditing({ ...EMPTY })}>
          + New sentence
        </button>
        <button type="button" className="lhx-sp-admin-btn" onClick={importBundled} disabled={busy === 'import'}>
          {busy === 'import' ? 'Importing…' : 'Import the bundled bank (overwrites edits)'}
        </button>
      </div>

      {error && <p className="lhx-sp-admin-error" role="alert">{error}</p>}
      {loading && <p className="lhx-sp-loading">Loading sentences…</p>}

      {!loading && rows.length === 0 && (
        <p className="lhx-sp-admin-lede">
          Nothing here yet — the game is playing the bundled bank. Import it above to start editing.
        </p>
      )}

      <ul className="lhx-sp-admin-list">
        {rows.map((row) => {
          const problems = validateSentence(row)
          return (
            <li key={row.id} className="lhx-sp-admin-row">
              <div className="lhx-sp-admin-main">
                <b>{row.answer}</b>
                {servableSentence(row)
                  ? <span className="lhx-sp-admin-pill is-live">live</span>
                  : <span className={`lhx-sp-admin-pill is-${row.status}`}>{row.status}</span>}
                {!row.active && <span className="lhx-sp-admin-pill is-off">inactive</span>}
                {problems.length > 0 && (
                  <span className="lhx-sp-admin-pill is-bad">
                    {problems.length} problem{problems.length === 1 ? '' : 's'}
                  </span>
                )}
                <span className="lhx-sp-admin-sentence">{row.text}</span>
                <span className="lhx-sp-admin-meta">against {row.distractors.join(' · ')}</span>
                {problems.length > 0 && <span className="lhx-sp-admin-problem">{problems[0]}</span>}
              </div>
              <div className="lhx-sp-admin-actions">
                <button type="button" onClick={() => setEditing(row)}>Edit</button>
                <button
                  type="button"
                  disabled={problems.length > 0 && !row.approved}
                  title={problems.length > 0 && !row.approved ? problems[0] : ''}
                  onClick={() => run('approve', () => setSentenceApproval(row.id, !row.approved))}
                >
                  {row.approved ? 'Withdraw' : 'Approve'}
                </button>
                <button type="button" className="is-danger" onClick={() => setConfirm(row)}>Delete</button>
              </div>
            </li>
          )
        })}
      </ul>

      {editing && (
        <SentenceEditor
          value={editing}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await run('save', () => saveSentence(next))
            setEditing(null)
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          open
          title={`Delete "${confirm.answer}"?`}
          message="The bundled bank still carries this sentence, so the game keeps playing it. Deleting only removes the edited copy."
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const target = confirm
            setConfirm(null)
            await run('delete', () => deleteSentence(target.id))
          }}
        />
      )}
    </>
  )
}

function SentenceEditor({ value, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normaliseSentence({
    ...value,
    distractors: [value.distractors?.[0] || '', value.distractors?.[1] || ''],
  }))
  // The problems are recomputed as you type and the save button is disabled
  // while any stands — the same rule the word editor follows, for the same
  // reason: a person can only fix what they can see while they are still here.
  const problems = useMemo(
    () => validateSentence({ ...draft, distractors: draft.distractors.filter(Boolean) }),
    [draft],
  )

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const setDistractor = (index, text) => setDraft((current) => {
    const next = [current.distractors[0] || '', current.distractors[1] || '']
    next[index] = text
    return { ...current, distractors: next }
  })

  return (
    <div className="lhx-sp-sheet-wrap" role="dialog" aria-modal="true" aria-label="Edit Word Choice sentence">
      <button type="button" className="lhx-sp-scrim" onClick={onClose} aria-label="Close" />
      <div className="lhx-sp-sheet lhx-sp-editor">
        <span className="lhx-sp-grab" aria-hidden="true" />
        <h2 className="lhx-sp-sheet-title">
          {value.id ? `Edit "${value.answer}"` : 'New Word Choice sentence'}
        </h2>
        <div className="lhx-sp-form">
      <label>
        Sentence — write the gap as ___
        <input
          value={draft.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Be ___ while the teacher is speaking."
        />
      </label>
      <label>
        The right word
        <input value={draft.answer} onChange={(e) => set({ answer: e.target.value })} placeholder="quiet" />
      </label>
      {Array.from({ length: DISTRACTOR_COUNT }, (_, i) => (
        <label key={i}>
          {`Wrong option ${i + 1}`}
          <input
            value={draft.distractors[i] || ''}
            onChange={(e) => setDistractor(i, e.target.value)}
            placeholder={i === 0 ? 'quite' : 'quit'}
          />
        </label>
      ))}
      <label>
        Note (what the difference is — shown to nobody yet, kept for the review)
        <input value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="quiet = no noise" />
      </label>

      {problems.map((problem) => (
        <p key={problem} className="lhx-sp-admin-problem">{problem}</p>
      ))}

      <div className="lhx-sp-admin-actions">
        <button
          type="button"
          disabled={problems.length > 0}
          onClick={() => onSave({ ...draft, distractors: draft.distractors.filter(Boolean) })}
        >
          Save
        </button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
        </div>
      </div>
    </div>
  )
}

/* ── the cohort ────────────────────────────────────────────────────── */

function CohortPanel() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    readSpellingCohortPools({ max: 500 })
      .then((pools) => { if (!cancelled) setState({ status: 'ready', ...aggregateCohort(pools) }) })
      // A failed read is reported AS a failed read. An empty table here would
      // read as "nobody is struggling", which is the opposite of the truth.
      .catch((err) => { if (!cancelled) setState({ status: 'error', message: err?.message || 'unknown' }) })
    return () => { cancelled = true }
  }, [])

  if (state.status === 'loading') return <p className="lhx-sp-loading">Reading the cohort…</p>
  if (state.status === 'error') {
    return (
      <p className="lhx-sp-admin-error">
        The spelling records could not be read, so this table is unknown rather than empty ({state.message}).
      </p>
    )
  }

  return (
    <>
      <p className="lhx-sp-admin-lede">
        Every learner&apos;s spelling record, folded into one list of words — from the ladder and
        from Spelling Ride together, because they write to the same record. <b>No learner is
        named.</b> A word counts as missed only while it is still unmastered, so a word somebody
        struggled with and then learned drops off rather than making the list longest for whoever
        has practised most.
      </p>

      <p className="lhx-sp-admin-lede">
        {state.learners === 0
          ? 'No learner has a spelling record yet.'
          : `${state.learners} learner${state.learners === 1 ? '' : 's'} with a spelling record.`}
        {state.suppressed && ` Percentages are hidden below ${MIN_COHORT} learners — with this few, a rate names individuals.`}
      </p>

      {state.words.length > 0 && (
        <div className="lhx-sp-admin-bar">
          <button
            type="button"
            className="lhx-sp-admin-btn"
            onClick={() => download(`spelling-cohort-${new Date().toISOString().slice(0, 10)}.csv`, cohortCsv(state))}
          >
            Download CSV
          </button>
        </div>
      )}

      {state.words.length === 0 ? (
        <p className="lhx-sp-admin-lede">Nothing is being missed yet.</p>
      ) : (
        <ul className="lhx-sp-admin-list">
          {state.words.slice(0, 60).map((row) => (
            <li key={row.word} className="lhx-sp-admin-row">
              <div className="lhx-sp-admin-main">
                <b>{row.word}</b>
                <span className="lhx-sp-admin-meta">
                  {row.missedBy} of {row.seenBy} who met it still miss it
                  {!state.suppressed && ` · ${row.missRate}%`}
                  {row.masteredBy > 0 && ` · ${row.masteredBy} mastered`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
