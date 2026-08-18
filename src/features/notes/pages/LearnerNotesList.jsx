// src/features/notes/pages/LearnerNotesList.jsx
//
// /notes — the prototype-v4 REVISION HUB (learner redesign step 8),
// rendered inside the learner shell (Notes is one of the four tabs).
//
// The hub lists ONLY reader-format notes — `noteFormat: 'study'` whose
// blocks pass `isReaderNote` — because the redesign retired the old
// note formats ("odd notes"): they are hidden here and show a retired
// card if reached by an old link, while regenerated notes join the hub
// subject by subject as the pipeline publishes them. Rows open the
// reader in REVISE mode (the hub is for quick revision; the full Learn
// pace lives one tap away inside the reader). The Conjunctions demo —
// the prototype's working note — anchors the English section until real
// English notes replace it.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../notesHub.css'
import { useLearnerProfile } from '../hooks/useLearnerProfile'
import { useLearnerNotes } from '../hooks/useLearnerNotes'
import { useNoteProgressMap } from '../hooks/useNoteProgressMap'
import { useDownloadedNotes } from '../hooks/useDownloadedNotes'
import { NOTE_PROGRESS_STATUS } from '../lib/progress'
import { fetchNoteForCache } from '../hooks/useOfflineNote'
import { downloadForOffline } from '../../../offline/contentCache.js'
import { buildNoteSearchText, isReaderNote, matchesNoteSearch, reviseMinutes } from '../reader/readerCore'
import { coerceStudyBlocks } from '../lib/studySchema'
import { NOTE_FORMAT, getGradeSubjects } from '../../../config/curriculum'
import { reportClientError } from '../../../utils/clientErrorReporting'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'

// Per-subject row icon (the prototype gives each topic a small emoji
// tile; per-note art is a content field the pipeline can add later).
const SUBJECT_ICONS = {
  english: '🔗',
  mathematics: '🔢',
  'integrated-science': '🧪',
  science: '🧪',
  'social-studies': '🌍',
  social: '🌍',
}

const subjectIcon = (subject) => SUBJECT_ICONS[String(subject || '').toLowerCase()] || '📘'
const subjectLabel = (subject) =>
  String(subject || '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

/** The prototype's working note — a fixture, listed until real English
 * reader notes exist so the hub always demonstrates the experience. */
const DEMO_ROW = {
  id: '__reader-demo__',
  icon: '🔗',
  title: 'Conjunctions — Joining Words',
  minutes: 2,
  to: '/notes/reader-preview?mode=revise',
  searchText: 'conjunctions joining words and but so because english',
  downloadable: false,
}

export function LearnerNotesList() {
  const navigate = useNavigate()
  const { profile } = useLearnerProfile()
  const grade = profile?.grade

  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(null) // null | {done, total} | 'done'
  const [downloadingId, setDownloadingId] = useState(null)

  const { allNotes, loading, error, reload } = useLearnerNotes({ grade })
  const { progressById } = useNoteProgressMap()
  const { downloadedIds, refresh: refreshDownloads } = useDownloadedNotes()

  // Reader-format notes only, with their honest revise time.
  //
  // The hub holds NO content — it is an index over the same `notes/*`
  // the Subjects doorway opens. Each row is a reference (the note id)
  // plus state (progress, downloaded); nothing here can drift from the
  // note because nothing here is authored.
  const readerNotes = useMemo(
    () =>
      allNotes
        .filter((n) => n.noteFormat === NOTE_FORMAT.STUDY)
        .map((n) => ({ note: n, blocks: coerceStudyBlocks(n.blocks) }))
        .filter(({ blocks }) => isReaderNote(blocks))
        .map(({ note, blocks }) => ({
          id: note.id,
          subject: note.subject,
          icon: subjectIcon(note.subject),
          title: note.title,
          minutes: reviseMinutes(blocks),
          to: `/notes/${note.id}?mode=revise`,
          // Stamped on write; recomputed here for notes authored before
          // the field existed, by the same function that stamps it.
          searchText: note.searchText || buildNoteSearchText(note, blocks),
          downloadable: true,
        })),
    [allNotes],
  )

  // Group by the grade's subject order; English leads (the demo lives there).
  const sections = useMemo(() => {
    // Subject OBJECTS for the grade. This used to take the band-wide LABEL
    // list and lowercase it ("Integrated Science" → "integrated science"),
    // which never equals the id notes are tagged with ("science"), so every
    // multi-word subject dropped out of the grade's order into the
    // catch-all below.
    const subjects = getGradeSubjects(grade) || []
    const bySubject = new Map()
    for (const row of readerNotes) {
      const key = String(row.subject || 'other').toLowerCase()
      if (!bySubject.has(key)) bySubject.set(key, [])
      bySubject.get(key).push(row)
    }
    const english = bySubject.get('english') || []
    bySubject.delete('english')
    const out = [{ key: 'english', label: 'English', rows: [...english, DEMO_ROW] }]
    for (const s of subjects) {
      const key = String(s.id).toLowerCase()
      if (key === 'english') continue
      if (bySubject.has(key)) {
        out.push({ key, label: s.label, rows: bySubject.get(key) })
        bySubject.delete(key)
      }
    }
    for (const [key, rows] of bySubject) out.push({ key, label: subjectLabel(key), rows })
    return out
  }, [readerNotes, grade])

  // Search reaches into the note (title, headings, key points) and runs
  // across every subject at once — the hub's whole reason for existing.
  const q = search.trim()
  const visibleSections = sections
    .map((s) => ({
      ...s,
      rows: q ? s.rows.filter((r) => matchesNoteSearch(r.searchText || r.title.toLowerCase(), q)) : s.rows,
    }))
    .filter((s) => s.rows.length > 0)

  const downloadableIds = readerNotes.map((r) => r.id)

  // Per-note download. The hub is where revision is planned, so a
  // learner picks the topics they will study without data — downloading
  // every note is the other button, not the only one.
  async function downloadOne(id) {
    if (!id || downloadingId) return
    setDownloadingId(id)
    try {
      await downloadForOffline({ type: 'note', id, fetcher: () => fetchNoteForCache(id) })
      await refreshDownloads()
    } catch (err) {
      reportClientError(err, 'notes.downloadOne')
    } finally {
      setDownloadingId(null)
    }
  }

  async function downloadAll() {
    if (saving || downloadableIds.length === 0) return
    setSaving({ done: 0, total: downloadableIds.length })
    let done = 0
    for (const id of downloadableIds) {
      try {
        await downloadForOffline({ type: 'note', id, fetcher: () => fetchNoteForCache(id) })
      } catch (err) {
        reportClientError(err, 'notes.downloadAll')
      }
      done += 1
      setSaving({ done, total: downloadableIds.length })
    }
    setSaving('done')
    await refreshDownloads()
  }

  return (
    <div>
      <SeoHelmet title="Notes" path="/notes" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Home" onClick={() => navigate('/dashboard')}>‹</button>
        <div>
          <div className="lhx-back-title">Notes</div>
          <div className="lhx-back-sub">Quick revision{grade ? ` · Grade ${grade}` : ''}</div>
        </div>
      </div>

      <input
        type="search"
        className="lhx-note-search"
        placeholder="🔍 Search topics… try 'conjunctions'"
        aria-label="Search notes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={68} className="lhx-skel" style={{ borderRadius: 20 }} />
          ))}
        </div>
      ) : (
        <>
          {error && allNotes.length === 0 && (
            <div className="lhx-card" style={{ padding: 16 }}>
              <p className="lhx-topic-sub">We hit a snag loading your notes.</p>
              <div style={{ height: 10 }} />
              <button type="button" className="lhx-btn lhx-btn-primary" onClick={reload}>Try again</button>
            </div>
          )}

          {visibleSections.map((section) => (
            <section key={section.key} aria-label={section.label}>
              <div className="lhx-section-head">
                <h2 className="lhx-section-title">{section.label}</h2>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {section.rows.map((row) => {
                  const learned = progressById[row.id]?.status === NOTE_PROGRESS_STATUS.COMPLETED
                  const downloaded = downloadedIds.has(row.id)
                  return (
                    <div key={row.id} className="lhx-note-row">
                      <button
                        type="button"
                        className="lhx-topic-row"
                        onClick={() => navigate(row.to)}
                      >
                        <span className="lhx-topic-ic" aria-hidden="true">{row.icon}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="lhx-topic-name" style={{ display: 'block' }}>{row.title}</span>
                          <span className="lhx-topic-sub" style={{ display: 'block' }}>
                            {learned ? '✓ Learned' : 'Not learned yet'} · {row.minutes} min revise
                            {downloaded && <span className="lhx-note-offline-badge"> · ⬇ Offline</span>}
                          </span>
                        </span>
                        <span className="lhx-gc-chev" aria-hidden="true">›</span>
                      </button>
                      {row.downloadable && !downloaded && (
                        <button
                          type="button"
                          className="lhx-note-dl"
                          aria-label={`Download ${row.title} for offline`}
                          disabled={downloadingId === row.id}
                          onClick={() => downloadOne(row.id)}
                        >
                          {downloadingId === row.id ? '…' : '⬇'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

          {q && visibleSections.length === 0 && (
            <p className="lhx-topic-sub" style={{ textAlign: 'center', marginTop: 8 }}>
              Nothing matches “{search.trim()}” yet.
            </p>
          )}

          {downloadableIds.length > 0 && (
            <button
              type="button"
              className="lhx-btn lhx-btn-block"
              style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }}
              onClick={downloadAll}
              disabled={!!saving && saving !== 'done'}
            >
              {saving === 'done'
                ? '✓ Notes saved for offline'
                : saving
                  ? `Saving ${saving.done} / ${saving.total}…`
                  : '💾 Download all notes for offline'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
