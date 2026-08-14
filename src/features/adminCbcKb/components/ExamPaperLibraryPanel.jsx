import { useMemo, useState } from 'react'
import {
  ASSESSMENT_FORMAT_TYPES, ASSESSMENT_FORMAT_BANDS, gradeToFormatBand,
} from '../../../utils/adminCbcKbService'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../../utils/teacherTools'

// ── Exam Paper Library panel ─────────────────────────────────────────────
// Bulk-upload real Zambian assessment papers, analyse each one into a stored
// per-paper analysis, then synthesise many of them into one consolidated
// format-profile draft the assessment generator grounds on. Lives in the CBC
// KB home view, beside the Assessment Formats panel.

const TYPE_LABELS = Object.fromEntries(
  ASSESSMENT_FORMAT_TYPES.map((t) => [t.value, t.label]),
)
const BAND_LABELS = Object.fromEntries(
  ASSESSMENT_FORMAT_BANDS.map((b) => [b.value, b.label]),
)

// TEACHER_GRADES carries {group} separators interleaved with {value,label}
// grade entries — fold them into <optgroup>s for the grade picker.
const GRADE_OPTGROUPS = (() => {
  const groups = []
  let cur = null
  for (const g of TEACHER_GRADES) {
    if (g.group) { cur = { label: g.group, items: [] }; groups.push(cur) }
    else if (cur) cur.items.push(g)
    else { cur = { label: '', items: [g] }; groups.push(cur) }
  }
  return groups
})()

function subjectLabel(subject) {
  if (subject === '_generic') return 'All subjects (generic)'
  const hit = TEACHER_SUBJECTS.find((s) => s.value === subject)
  return hit ? hit.label : String(subject || '').replace(/_/g, ' ')
}

const ORIGIN_SHORT = {
  builtin_seed: 'seed', manual: 'manual',
  pdf_extract: 'sample paper', docx_extract: 'sample paper',
  library_synthesis: 'library',
}

// Whether a bucket of real papers has actually reached the assessment
// generator. The generator grounds on Firestore profiles keyed
// `${type}-${band}-${subject}` (assessmentFormats.js), so we look the bucket's
// id up against the live profile list and the pending drafts to answer, per
// bucket, "are these papers being used yet?".
function bucketStatus(bucket, profileById, draftTuples) {
  const id = `${bucket.assessmentType}-${bucket.gradeBand}-${bucket.subject}`
  const profile = profileById.get(id)
  // A library-synthesised profile that's already live is the strongest signal:
  // these papers are in the generator regardless of any newer pending draft.
  if (profile && profile.origin === 'library_synthesis') {
    return { tone: 'live', text: '✓ In the live generator (from this library)' }
  }
  // A pending draft means these papers HAVE been synthesised but aren't live
  // yet — surface that ahead of any unrelated manual/seed profile in the slot,
  // which would otherwise hide the just-processed draft.
  if (draftTuples.has(id)) {
    return { tone: 'draft', text: '⏳ Draft awaiting approval' }
  }
  if (profile) {
    return {
      tone: 'other',
      text: `Live override: ${ORIGIN_SHORT[profile.origin] || profile.origin}`,
    }
  }
  // No Firestore row for this slot. listAssessmentFormats() returns only the
  // Firestore overrides, not the in-code seeds the generator still merges and
  // resolves against (exact seed → band-generic seed → default), so the
  // generator IS serving this slot from a built-in profile. Say that rather
  // than implying the slot is unserved.
  return { tone: 'none', text: 'Built-in seed (not synthesised)' }
}

const STATUS_STYLES = {
  live: { bg: '#e7f6ee', fg: '#13683b' },
  draft: { bg: '#e8eefc', fg: '#1e40af' },
  other: { bg: '#fef6e7', fg: '#92600a' },
  none: { bg: '#eef2f7', fg: '#64748b' },
}

function BucketStatusBadge({ status }) {
  const s = STATUS_STYLES[status.tone] || STATUS_STYLES.none
  return (
    <span
      style={{
        display: 'inline-block', fontSize: 11, fontWeight: 600,
        padding: '2px 9px', borderRadius: 999,
        background: s.bg, color: s.fg, whiteSpace: 'nowrap',
      }}
    >
      {status.text}
    </span>
  )
}

/**
 * Group stored samples into band → (subject + type) buckets so the admin can
 * see how much corpus backs each paper kind and synthesise per bucket.
 */
function groupSamples(samples) {
  const byBand = new Map()
  for (const s of samples || []) {
    const band = s.gradeBand || gradeToFormatBand(s.grade) || 'other'
    const key = `${s.assessmentType || '?'}|${band}|${s.subject || '_generic'}`
    if (!byBand.has(band)) byBand.set(band, new Map())
    const buckets = byBand.get(band)
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        gradeBand: band,
        subject: s.subject || '_generic',
        assessmentType: s.assessmentType || '?',
        samples: [],
      })
    }
    buckets.get(key).samples.push(s)
  }
  const bandOrder = ASSESSMENT_FORMAT_BANDS.map((b) => b.value)
  return Array.from(byBand.entries())
    .sort(([a], [b]) => bandOrder.indexOf(a) - bandOrder.indexOf(b))
    .map(([band, buckets]) => ({
      band,
      buckets: Array.from(buckets.values())
        .sort((x, y) => x.key.localeCompare(y.key)),
    }))
}

export default function ExamPaperLibraryPanel({
  samples, profiles, drafts, onAnalyzeBatch, onDelete, onSynthesize,
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    grade: 'G5', subject: '_generic', assessmentType: 'end_of_term',
    year: '', region: '',
  })
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [synthBusyKey, setSynthBusyKey] = useState('')
  const [openSampleId, setOpenSampleId] = useState('')

  const total = (samples || []).length
  const grouped = useMemo(() => groupSamples(samples), [samples])
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Live profiles by id + the (type-band-subject) tuples that have a pending
  // library-synthesis draft — drives the per-bucket "are these used?" badge.
  const profileById = useMemo(() => {
    const m = new Map()
    for (const p of profiles || []) m.set(p.id, p)
    return m
  }, [profiles])
  const draftTuples = useMemo(() => {
    const s = new Set()
    for (const d of drafts || []) {
      if (d.origin === 'library_synthesis') {
        s.add(`${d.assessmentType}-${d.gradeBand}-${d.subject}`)
      }
    }
    return s
  }, [drafts])

  async function runBatch() {
    if (!files.length || busy) return
    setBusy(true)
    try {
      const ok = await onAnalyzeBatch({ files, ...form })
      if (ok) setFiles([])
    } finally {
      setBusy(false)
    }
  }

  async function runSynthesis(bucket) {
    setSynthBusyKey(bucket.key)
    try {
      await onSynthesize({
        assessmentType: bucket.assessmentType,
        gradeBand: bucket.gradeBand,
        subject: bucket.subject,
      })
    } finally {
      setSynthBusyKey('')
    }
  }

  return (
    <section className="ss-custom-panel" aria-label="Exam Paper Library">
      <div className="ss-custom-head">
        <div>
          <div className="ss-sh-dash">EXAM PAPER LIBRARY</div>
          <h2 className="ss-sh-title">
            Real Zambian papers
            {total > 0 && <span className="ss-custom-count">{total}</span>}
          </h2>
          <p className="ss-custom-blurb">
            Upload real assessment papers (Nursery → Grade 7 and beyond).
            Claude analyses each one — format, wording, question arrangement,
            picture use, answer spaces and grade-level difficulty — and stores
            it here. Synthesise a bucket into a format profile and the
            assessment generator writes papers in that Zambian style. Exemplars
            are always fresh paraphrases; real questions are never copied.
          </p>
        </div>
        <div className="ss-custom-actions">
          <button type="button" className="ss-tab-btn" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide uploader' : 'Upload papers'}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ border: '1px solid #d9cfb8', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div className="ss-ct-grade-row">
            <div className="ss-field">
              <label>Grade</label>
              <select value={form.grade} onChange={(e) => update('grade', e.target.value)}>
                {GRADE_OPTGROUPS.map((g) => (
                  g.label ? (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((it) => (
                        <option key={it.value} value={it.value}>{it.label}</option>
                      ))}
                    </optgroup>
                  ) : g.items.map((it) => (
                    <option key={it.value} value={it.value}>{it.label}</option>
                  ))
                ))}
              </select>
            </div>
            <div className="ss-field">
              <label>Subject</label>
              <select value={form.subject} onChange={(e) => update('subject', e.target.value)}>
                <option value="_generic">All subjects (generic)</option>
                {TEACHER_SUBJECTS.filter((s) => s.value).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="ss-field">
              <label>Assessment type</label>
              <select value={form.assessmentType} onChange={(e) => update('assessmentType', e.target.value)}>
                {ASSESSMENT_FORMAT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="ss-ct-grade-row">
            <div className="ss-field">
              <label>Year (optional)</label>
              <input
                type="number"
                placeholder="e.g. 2024"
                value={form.year}
                onChange={(e) => update('year', e.target.value)}
              />
            </div>
            <div className="ss-field">
              <label>Region / source (optional)</label>
              <input
                type="text"
                placeholder="e.g. Lusaka, ECZ"
                value={form.region}
                onChange={(e) => update('region', e.target.value)}
              />
            </div>
            <div className="ss-field">
              <label>Papers (.pdf / .docx / photo — select many)</label>
              <input
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </div>
          </div>
          <p className="ss-custom-blurb" style={{ marginTop: 0 }}>
            All selected files share the classification above. Upload one grade
            and subject at a time for the cleanest corpus. Photos suit
            single-page papers; use a PDF for multi-page papers.
          </p>
          <button
            type="button"
            className="ss-btn-primary"
            onClick={runBatch}
            disabled={busy || files.length === 0}
          >
            {busy ?
              `Analysing ${files.length} paper${files.length === 1 ? '' : 's'}…` :
              `Analyse ${files.length || ''} paper${files.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {total === 0 && (
        <p className="ss-custom-empty">
          No papers analysed yet. Click <strong>Upload papers</strong> to add
          real assessment papers and build the reference corpus.
        </p>
      )}

      {grouped.map((bandGroup) => (
        <div key={bandGroup.band} className="ss-custom-grade-block" style={{ marginBottom: 12 }}>
          <div className="ss-custom-grade-label">
            {BAND_LABELS[bandGroup.band] || bandGroup.band}
          </div>
          {bandGroup.buckets.map((bucket) => (
            <div
              key={bucket.key}
              style={{ border: '1px solid #e7dec8', borderRadius: 10, padding: 12, marginBottom: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong className="theme-text">
                    {TYPE_LABELS[bucket.assessmentType] || bucket.assessmentType}
                  </strong>
                  {' · '}{subjectLabel(bucket.subject)}
                  <span className="ss-custom-count" style={{ marginLeft: 8 }}>
                    {bucket.samples.length}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <BucketStatusBadge status={bucketStatus(bucket, profileById, draftTuples)} />
                  <button
                    type="button"
                    className="ss-add-row-btn"
                    onClick={() => runSynthesis(bucket)}
                    disabled={synthBusyKey === bucket.key}
                    title="Merge these papers into one format-profile draft for review"
                  >
                    {synthBusyKey === bucket.key ?
                      'Synthesising…' : '✦ Synthesise format profile'}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                {bucket.samples.map((s) => {
                  const expanded = openSampleId === s.id
                  const a = s.analysis || {}
                  return (
                    <div key={s.id} className="ss-custom-card" style={{ marginBottom: 6 }}>
                      <div className="ss-custom-card-meta">
                        {s.grade}
                        {s.year ? ` · ${s.year}` : ''}
                        {s.region ? ` · ${s.region}` : ''}
                      </div>
                      <div className="ss-custom-card-title">
                        {s.title || s.sourceNote || 'Untitled paper'}
                      </div>
                      {a.summary && (
                        <div className="ss-custom-card-subs">
                          {expanded ? a.summary :
                            `${String(a.summary).slice(0, 140)}${a.summary.length > 140 ? '…' : ''}`}
                        </div>
                      )}
                      {expanded && <SampleAnalysisDetail analysis={a} />}
                      <div className="ss-custom-card-actions">
                        <button
                          type="button"
                          className="ss-row-btn ss-row-edit"
                          onClick={() => setOpenSampleId(expanded ? '' : s.id)}
                        >
                          {expanded ? 'less' : 'details'}
                        </button>
                        <button
                          type="button"
                          className="ss-row-btn ss-row-delete"
                          onClick={() => onDelete(s)}
                        >
                          delete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

function SampleAnalysisDetail({ analysis }) {
  const a = analysis || {}
  const sections = [
    ['Structure', (a.paperStructure || []).map((s) =>
      `${s.heading || s.name}${Number.isFinite(Number(s.marksShare)) ? ` (~${s.marksShare}%)` : ''}`)],
    ['Arrangement', a.questionArrangement ? [a.questionArrangement] : []],
    ['Numbering', a.numberingStyle ? [a.numberingStyle] : []],
    ['Command words', a.commandWords || []],
    ['Phrasing', a.phrasingNotes || []],
    ['Marks', a.marksConventions || []],
    ['Pictures & diagrams', a.pictureUsage || []],
    ['Answer spaces', a.answerSpaceConventions || []],
    ['Grade-level fit', a.gradeLevelNotes ? [a.gradeLevelNotes] : []],
    ['Cover instructions', a.coverInstructions || []],
  ].filter(([, v]) => v && v.length)

  return (
    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
      {sections.map(([label, items]) => (
        <div key={label} style={{ marginBottom: 6 }}>
          <div style={{ fontWeight: 600 }}>{label}</div>
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
            {items.slice(0, 8).map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      ))}
      {Array.isArray(a.exemplarQuestions) && a.exemplarQuestions.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontWeight: 600 }}>Exemplars (paraphrased)</div>
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
            {a.exemplarQuestions.map((q, i) => (
              <li key={i}>
                [{q.type}, {q.marks} mark{q.marks === 1 ? '' : 's'}] {q.prompt}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
