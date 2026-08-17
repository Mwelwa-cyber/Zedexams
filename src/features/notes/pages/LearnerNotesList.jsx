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
import { fetchNoteForCache } from '../hooks/useOfflineNote'
import { downloadForOffline } from '../../../offline/contentCache.js'
import { isReaderNote, reviseMinutes } from '../reader/readerCore'
import { coerceStudyBlocks } from '../lib/studySchema'
import { NOTE_FORMAT, getSubjectsForGrade } from '../../../config/curriculum'
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
}

export function LearnerNotesList() {
  const navigate = useNavigate()
  const { profile } = useLearnerProfile()
  const grade = profile?.grade

  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(null) // null | {done, total} | 'done'

  const { allNotes, loading, error, reload } = useLearnerNotes({ grade })

  // Reader-format notes only, with their honest revise time.
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
        })),
    [allNotes],
  )

  // Group by the grade's subject order; English leads (the demo lives there).
  const sections = useMemo(() => {
    const subjects = getSubjectsForGrade(grade) || []
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
      const key = String(s).toLowerCase()
      if (key === 'english') continue
      if (bySubject.has(key)) {
        out.push({ key, label: subjectLabel(s), rows: bySubject.get(key) })
        bySubject.delete(key)
      }
    }
    for (const [key, rows] of bySubject) out.push({ key, label: subjectLabel(key), rows })
    return out
  }, [readerNotes, grade])

  const q = search.trim().toLowerCase()
  const visibleSections = sections
    .map((s) => ({ ...s, rows: q ? s.rows.filter((r) => r.title.toLowerCase().includes(q)) : s.rows }))
    .filter((s) => s.rows.length > 0)

  const downloadableIds = readerNotes.map((r) => r.id)

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
                {section.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="lhx-topic-row"
                    onClick={() => navigate(row.to)}
                  >
                    <span className="lhx-topic-ic" aria-hidden="true">{row.icon}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="lhx-topic-name" style={{ display: 'block' }}>{row.title}</span>
                      <span className="lhx-topic-sub" style={{ display: 'block' }}>
                        Key points · {row.minutes} min revise
                      </span>
                    </span>
                    <span className="lhx-gc-chev" aria-hidden="true">›</span>
                  </button>
                ))}
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
