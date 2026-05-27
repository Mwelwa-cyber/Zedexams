import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import {
  listMyGenerations,
  titleForGeneration,
  formatDate,
  bucketIntoTree,
  librarySectionForGeneration,
  TOOL_META,
} from '../../../utils/teacherLibraryService'
import {
  LIBRARY_SECTIONS,
  LIBRARY_SECTION_BY_ID,
  LIBRARY_TYPES,
  SYLLABUS_OPTIONS,
  TERMS,
  getActiveGradeForms,
  getSubjectsForGradeForm,
  getAssessmentTypesForGradeForm,
} from '../../../config/library'
import { classifyForLibrary } from '../../../utils/libraryClassification'
import SeoHelmet from '../../seo/SeoHelmet'

/**
 * Hierarchical Library Browser.
 *
 * Step-by-step flow (mobile-first):
 *   1. Library Type   (Schemes / Forecasts / Syllabi / Lesson Plans / Notes / Assessments)
 *   2. Syllabus       (CBC / OBC / Secondary)
 *   3. Grade / Form
 *   4. Term           (skipped for Syllabi)
 *   5. Subject
 *   6. Assessment Type   (Assessments only)
 *   7. Documents
 *
 * Selections are reflected in the URL so back/forward works and links
 * are deep-shareable.
 */

const PARAM_KEYS = ['type', 'syllabus', 'grade', 'term', 'subject', 'assess']

const COLORS = {
  paper:    '#f5efe1',
  ink:      '#0e2a32',
  inkSoft:  '#566f76',
  faint:    '#8a9aa1',
  border:   '#d4cab2',
  card:     '#fff',
  orange:   '#ff7a2e',
}

/* ── Per-tile icons ────────────────────────────────────────────── */
// Every tile inside a picker used to share one icon (all grades a
// schoolbag, all subjects a blue book, …). Distinct icons make a folder
// of siblings scannable.

const SYLLABUS_ICON = {
  CBC:       '🌱',
  CDC:       '📜',
  Secondary: '🎓',
}

const TERM_ICON = {
  'Term 1': '🌤️',
  'Term 2': '🌧️',
  'Term 3': '☀️',
}

const ASSESSMENT_ICON = {
  topic:       '🎯',
  monthly:     '🗓️',
  midterm:     '📊',
  end_of_term: '🏁',
}

const GRADE_KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']

// Grade/Form → numbered keycap (Grade 4 → 4️⃣, Form 1 → 1️⃣).
function gradeFormIcon(value) {
  const m = String(value || '').match(/(\d+)/)
  if (m) {
    const n = Number(m[1])
    if (n === 10) return '🔟'
    if (n >= 0 && n <= 9) return GRADE_KEYCAPS[n]
  }
  return /form/i.test(String(value)) ? '🎓' : '🎒'
}

const SUBJECT_ICON = {
  'Mathematics':                                     '🔢',
  'Mathematics and Science':                         '🧮',
  'English Language':                                '📖',
  'Literacy and Language':                           '🔤',
  'Zambian Language':                                '🗣️',
  'Integrated Science':                              '🔬',
  'Social Studies':                                  '🌍',
  'History':                                         '🏛️',
  'Geography':                                       '🗺️',
  'Religious Education':                              '⛪',
  'Technology Studies':                              '🔧',
  'Creative and Technology Studies':                 '🎨',
  'Home Economics':                                  '🍳',
  'Expressive Arts':                                 '🎭',
  'Physics':                                         '⚛️',
  'Chemistry':                                       '🧪',
  'Principles of Accounting':                        '💰',
  'Information and Communication Technology (ICT)':  '💻',
}

function subjectIcon(value) {
  return SUBJECT_ICON[value] || '📘'
}

export default function TeacherLibrary() {
  const { currentUser } = useAuth()
  const { getMyAssessments } = useFirestore()
  const [searchParams, setSearchParams] = useSearchParams()

  const sel = useMemo(() => ({
    type:     searchParams.get('type')     || '',
    syllabus: searchParams.get('syllabus') || '',
    grade:    searchParams.get('grade')    || '',
    term:     searchParams.get('term')     || '',
    subject:  searchParams.get('subject')  || '',
    assess:   searchParams.get('assess')   || '',
  }), [searchParams])

  const [generations, setGenerations] = useState([])
  const [assessments, setAssessments] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')

  /* ── Data load ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setStatus('loading')
    Promise.all([
      listMyGenerations({ uid: currentUser.uid }),
      getMyAssessments(currentUser.uid).catch(() => []),
    ])
      .then(([gens, asmts]) => {
        if (cancelled) return
        setGenerations(gens)
        setAssessments(asmts)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err?.message || 'Could not load your library.')
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [currentUser]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Selection helpers ─────────────────────────────────────── */
  function setStep(updates) {
    const next = new URLSearchParams(searchParams)
    for (const k of Object.keys(updates)) {
      const v = updates[k]
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setSearchParams(next, { replace: false })
  }

  function backTo(level) {
    // Clear everything below the given level (inclusive of `level`).
    const order = ['type', 'syllabus', 'grade', 'term', 'subject', 'assess']
    const idx = order.indexOf(level)
    if (idx < 0) return setStep(Object.fromEntries(PARAM_KEYS.map(k => [k, ''])))
    const next = new URLSearchParams(searchParams)
    for (let i = idx; i < order.length; i++) next.delete(order[i])
    setSearchParams(next, { replace: false })
  }

  /* ── Index legacy rows (no library coords) into the tree ──── */
  // Backfill on the fly so old generations still show up in the right
  // folder. Cheap because the user's full library is ≤60 rows.
  const indexedGenerations = useMemo(() => {
    return generations.map((g) => {
      if (g.library?.libraryType) return g
      const section = librarySectionForGeneration(g)
      if (!section) return g
      const lib = classifyForLibrary({
        libraryType: section.id,
        grade:       g.inputs?.grade || g.meta?.klass,
        term:        g.inputs?.term  || (() => {
          const tw = String(g.meta?.termWeek || '')
          const m = tw.match(/Term\s*(\d)/i)
          return m ? `Term ${m[1]}` : null
        })(),
        subject:     g.inputs?.subject || g.meta?.subject,
      })
      return { ...g, library: lib }
    })
  }, [generations])

  // Treat each saved assessment as a library row so they appear in the
  // Assessments folder alongside generated drafts.
  const assessmentRows = useMemo(() => {
    return assessments.map((a) => ({
      id:        a.id,
      ownerUid:  a.createdBy,
      tool:      'assessment',
      output:    a,
      inputs:    { grade: a.grade, subject: a.subject, term: a.term },
      createdAt: a.createdAt,
      library:   a.library || classifyForLibrary({
        libraryType:    LIBRARY_TYPES.ASSESSMENTS,
        grade:          a.grade ? `Grade ${a.grade}` : null,
        term:           a.term,
        subject:        a.subject,
        assessmentType: a.assessmentType,
      }),
      __linkTo:  `/teacher/assessments/${a.id}/edit`,
      __title:   a.title || `${a.subject || 'Assessment'} ${a.assessmentType || ''}`.trim(),
    }))
  }, [assessments])

  const allRows = useMemo(
    () => [...indexedGenerations, ...assessmentRows],
    [indexedGenerations, assessmentRows],
  )

  const tree = useMemo(() => bucketIntoTree(allRows), [allRows])

  const totalSaved = allRows.length

  /* ── Render decisions ──────────────────────────────────────── */

  if (status === 'loading') {
    return (
      <Shell>
        <Header />
        <LoadingState />
      </Shell>
    )
  }
  if (status === 'error') {
    return (
      <Shell>
        <Header />
        <ErrorState message={errorMessage} />
      </Shell>
    )
  }

  // Build breadcrumb path from current selection.
  const crumbs = buildCrumbs(sel)

  // Step 1 — pick a library section.
  if (!sel.type) {
    return (
      <Shell>
        <Header subtitle={`${totalSaved} saved item${totalSaved === 1 ? '' : 's'} across all studios`} />
        <SectionPicker tree={tree} onPick={(t) => setStep({ type: t })} />
      </Shell>
    )
  }

  const section = LIBRARY_SECTION_BY_ID[sel.type]
  if (!section) {
    return (
      <Shell>
        <Header />
        <ErrorState message={`Unknown library section: ${sel.type}`} />
      </Shell>
    )
  }

  // Step 2 — pick syllabus.
  if (!sel.syllabus) {
    return (
      <Shell>
        <Header subtitle={section.label} crumbs={crumbs} onCrumb={backTo} />
        <SyllabusPicker tree={tree[sel.type] || {}} onPick={(s) => setStep({ syllabus: s })} />
      </Shell>
    )
  }

  // Step 3 — pick grade / form.
  if (!sel.grade) {
    return (
      <Shell>
        <Header subtitle={`${section.label} · ${sel.syllabus}`} crumbs={crumbs} onCrumb={backTo} />
        <GradeFormPicker
          syllabus={sel.syllabus}
          subTree={(tree[sel.type] || {})[sel.syllabus] || {}}
          onPick={(g) => setStep({ grade: g })}
        />
      </Shell>
    )
  }

  // Step 4 — pick term (skipped for Syllabi).
  if (section.hasTerm && !sel.term) {
    return (
      <Shell>
        <Header
          subtitle={`${section.label} · ${sel.syllabus} · ${sel.grade}`}
          crumbs={crumbs}
          onCrumb={backTo}
        />
        <TermPicker
          subTree={((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {}}
          onPick={(t) => setStep({ term: t })}
        />
      </Shell>
    )
  }

  // Step 5 — pick subject.
  if (!sel.subject) {
    const branch = section.hasTerm
      ? (((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {})[sel.term] || {}
      : ((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {}
    return (
      <Shell>
        <Header
          subtitle={[section.label, sel.syllabus, sel.grade, section.hasTerm && sel.term].filter(Boolean).join(' · ')}
          crumbs={crumbs}
          onCrumb={backTo}
        />
        <SubjectPicker
          syllabus={sel.syllabus}
          gradeForm={sel.grade}
          subTree={branch}
          onPick={(s) => setStep({ subject: s })}
        />
      </Shell>
    )
  }

  // Step 6 — Assessments only — pick assessment type.
  if (section.hasAssessmentType && !sel.assess) {
    const branch = (((((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {})[sel.term] || {})[sel.subject]) || {}
    return (
      <Shell>
        <Header
          subtitle={[section.label, sel.syllabus, sel.grade, sel.term, sel.subject].filter(Boolean).join(' · ')}
          crumbs={crumbs}
          onCrumb={backTo}
        />
        <AssessmentTypePicker
          syllabus={sel.syllabus}
          gradeForm={sel.grade}
          subTree={branch}
          onPick={(t) => setStep({ assess: t })}
        />
      </Shell>
    )
  }

  // Step 7 — leaf documents.
  const leaf = readLeaf(tree, sel)
  return (
    <Shell>
      <Header
        subtitle={[section.label, sel.syllabus, sel.grade, section.hasTerm && sel.term, sel.subject, section.hasAssessmentType && labelForAssessment(sel.syllabus, sel.grade, sel.assess)]
          .filter(Boolean).join(' · ')}
        crumbs={crumbs}
        onCrumb={backTo}
        section={section}
      />
      <DocumentList items={leaf} section={section} />
    </Shell>
  )
}

/* ── Layout chrome ─────────────────────────────────────────────── */

function Shell({ children }) {
  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: COLORS.paper }}>
      <SeoHelmet title="Teacher library" noIndex />
      <div className="max-w-6xl mx-auto">{children}</div>
    </div>
  )
}

function Header({ subtitle, crumbs, onCrumb, section }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/teacher"
            className="inline-flex items-center gap-1.5 mb-3 no-underline text-sm font-bold rounded-xl border-2 px-3 py-1.5 transition-colors"
            style={{ borderColor: COLORS.ink, color: COLORS.ink, background: COLORS.card }}
          >
            ← Home
          </Link>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 32, color: COLORS.ink, margin: 0, letterSpacing: '-.3px' }}>
            Library
          </h1>
          {subtitle && (
            <p style={{ fontSize: 13, color: COLORS.inkSoft, margin: '4px 0 0' }}>
              {subtitle}
            </p>
          )}
        </div>
        {section?.createTo && (
          <Link
            to={section.createTo}
            className="inline-flex items-center gap-1.5 rounded-xl font-bold no-underline transition-colors"
            style={{ background: COLORS.ink, color: '#fff', padding: '10px 16px', fontSize: 13 }}
          >
            + New {section.label.replace(/s$/, '')}
          </Link>
        )}
      </div>
      {crumbs && crumbs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            type="button"
            onClick={() => onCrumb && onCrumb('type')}
            className="text-xs font-bold rounded-full px-3 py-1.5 cursor-pointer transition-colors"
            style={{ background: COLORS.card, border: `1.5px solid ${COLORS.border}`, color: COLORS.inkSoft }}
          >
            Library
          </button>
          {crumbs.map((c) => (
            <span key={c.level} className="flex items-center gap-2">
              <span style={{ color: COLORS.faint, fontSize: 12 }}>›</span>
              <button
                type="button"
                onClick={() => onCrumb && onCrumb(c.level)}
                className="text-xs font-bold rounded-full px-3 py-1.5 cursor-pointer transition-colors"
                style={{ background: COLORS.card, border: `1.5px solid ${COLORS.border}`, color: COLORS.ink }}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Step pickers ──────────────────────────────────────────────── */

function SectionPicker({ tree, onPick }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {LIBRARY_SECTIONS.map((s) => {
        const branch = tree[s.id] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={s.id}
            icon={s.icon}
            accent={s.accent}
            title={s.label}
            subtitle={`${count} saved ${count === 1 ? 'item' : 'items'}`}
            onClick={() => onPick(s.id)}
          />
        )
      })}
    </div>
  )
}

function SyllabusPicker({ tree, onPick }) {
  const extras = extraKeys(tree, SYLLABUS_OPTIONS.map((o) => o.value))
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {SYLLABUS_OPTIONS.map((opt) => {
        const branch = tree[opt.value] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={opt.value}
            icon={SYLLABUS_ICON[opt.value] || '📚'}
            accent="#fde2c4"
            title={opt.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(opt.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanTile key={k} label={k} count={countLeaves(tree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

function GradeFormPicker({ syllabus, subTree, onPick }) {
  const grades = getActiveGradeForms(syllabus)
  const extras = extraKeys(subTree, grades.map((g) => g.value))
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {grades.map((g) => {
        const branch = subTree[g.value] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={g.value}
            icon={gradeFormIcon(g.value)}
            accent="#dbe7f4"
            title={g.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(g.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanTile key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
      {grades.length === 0 && extras.length === 0 && (
        <EmptyHint text={`No grades configured for ${syllabus} yet.`} />
      )}
    </div>
  )
}

function TermPicker({ subTree, onPick }) {
  const extras = extraKeys(subTree, TERMS.map((t) => t.value))
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {TERMS.map((t) => {
        const branch = subTree[t.value] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={t.value}
            icon={TERM_ICON[t.value] || '📅'}
            accent="#faecb8"
            title={t.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(t.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanTile key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

function SubjectPicker({ syllabus, gradeForm, subTree, onPick }) {
  const subjects = getSubjectsForGradeForm(syllabus, gradeForm)
  const extras = extraKeys(subTree, subjects)
  if (subjects.length === 0 && extras.length === 0) {
    return <EmptyHint text={`Subjects for ${syllabus} ${gradeForm} are not configured yet.`} />
  }
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {subjects.map((s) => {
        const branch = subTree[s] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={s}
            icon={subjectIcon(s)}
            accent="#d8ecd0"
            title={s}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(s)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanTile key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

function AssessmentTypePicker({ syllabus, gradeForm, subTree, onPick }) {
  const types = getAssessmentTypesForGradeForm(syllabus, gradeForm)
  const extras = extraKeys(subTree, types.map((t) => t.value))
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {types.map((t) => {
        const branch = subTree[t.value] || []
        const count = Array.isArray(branch) ? branch.length : countLeaves(branch)
        return (
          <Tile
            key={t.value}
            icon={ASSESSMENT_ICON[t.value] || '📝'}
            accent="#e8d8f0"
            title={t.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(t.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanTile key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

/* ── Documents (leaf) ──────────────────────────────────────────── */

// Multi-lesson generations from the Lesson Plan Studio (v14+) share an
// `inputs.lessonSeries.seriesId` across their siblings. Group those into one
// header row so a teacher who generated a 4-lesson series doesn't see four
// near-identical "Food Hygiene" tiles. Returns a flat render list where each
// entry is either { kind: 'card', item } or { kind: 'group', group }.
//
// The group is positioned at the place of its newest member (preserving the
// list's createdAt-desc order across groups), and its children render in
// pedagogical order (lessonNumber ascending) when expanded.
function partitionIntoSeriesGroups(items) {
  const groupsBySeriesId = new Map()
  const out = []
  for (const item of items || []) {
    const series = item?.inputs?.lessonSeries
    const seriesId = series && series.seriesId
    const total = series && Number(series.totalLessons)
    // A "series" here means 2+ planned lessons sharing a seriesId. Lone
    // single-lesson generations stay as ordinary cards even though the new
    // shape stamps a default lessonSeries on every doc.
    const isSeriesMember = seriesId && total && total > 1
    if (!isSeriesMember) {
      out.push({ kind: 'card', item })
      continue
    }
    let g = groupsBySeriesId.get(seriesId)
    if (!g) {
      g = { seriesId, items: [], firstItem: item }
      groupsBySeriesId.set(seriesId, g)
      // Reserve this slot in render order; we'll fill it with the populated
      // group once all members have been collected below.
      out.push({ kind: 'group', group: g })
    }
    g.items.push(item)
  }
  // Sort each group's children by lessonNumber so the expanded view reads
  // "Lesson 1, 2, 3, 4" instead of newest-first.
  for (const g of groupsBySeriesId.values()) {
    g.items.sort((a, b) => {
      const an = Number(a?.inputs?.lessonSeries?.lessonNumber) || 0
      const bn = Number(b?.inputs?.lessonSeries?.lessonNumber) || 0
      return an - bn
    })
  }
  return out
}

function DocumentList({ items, section }) {
  // Local expand state, keyed by seriesId. Defaults to collapsed so the
  // library stays scannable when a teacher has many series.
  const [expanded, setExpanded] = useState(() => new Set())
  const toggle = (seriesId) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(seriesId)) next.delete(seriesId)
      else next.add(seriesId)
      return next
    })
  }
  const rendered = useMemo(() => partitionIntoSeriesGroups(items || []), [items])
  if (!items || items.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed py-10 px-4 text-center" style={{ background: COLORS.card, borderColor: COLORS.border }}>
        <p style={{ fontSize: 13, color: COLORS.faint, margin: 0 }}>
          {section.emptyHint}
        </p>
      </div>
    )
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {rendered.map((entry) => {
        if (entry.kind === 'card') {
          return <DocumentCard key={entry.item.id} item={entry.item} section={section} />
        }
        const isOpen = expanded.has(entry.group.seriesId)
        return (
          <SeriesGroupBlock
            key={`group:${entry.group.seriesId}`}
            group={entry.group}
            section={section}
            open={isOpen}
            onToggle={() => toggle(entry.group.seriesId)}
          />
        )
      })}
    </div>
  )
}

// Renders a series as a full-width header card (spans every column of the
// auto-fill grid via `gridColumn: 1 / -1`) plus, when expanded, the child
// lesson cards laid out as a nested grid below it. Keeping the children
// inside the same grid cell avoids fighting the parent's auto-fill layout
// when adjacent series have different sibling counts.
function SeriesGroupBlock({ group, section, open, onToggle }) {
  const first = group.firstItem
  const series = first?.inputs?.lessonSeries || {}
  const total = Number(series.totalLessons) || group.items.length
  const planningMode = String(series.planningMode || 'multiple')
  // Title derives from the topic / subtopic the studio saved on each plan —
  // siblings share these — so we surface them once at the group level
  // instead of repeating them on every child tile.
  const topicLabel = first?.inputs?.subtopic || first?.inputs?.topic || titleForGeneration(first)
  const itemIcon = TOOL_META[first?.tool]?.icon || section.icon
  const modeLabel = {
    single: 'Single',
    multiple: 'Multiple lessons',
    week: 'Full week plan',
    ai_suggested: 'AI suggested',
  }[planningMode] || 'Multiple lessons'
  // Pick the freshest createdAt across the children so the date label
  // tracks re-runs of an existing series. formatDate() accepts a Firestore
  // Timestamp directly, so we hold on to the original ts object.
  let newestTs = null
  let newestMs = 0
  for (const it of group.items) {
    const ts = it?.createdAt
    const ms = (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0
    if (ms > newestMs) { newestMs = ms; newestTs = ts }
  }
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full text-left no-underline rounded-2xl border-2 p-4 transition-all hover:-translate-y-0.5"
        style={{ background: COLORS.card, borderColor: COLORS.ink, color: COLORS.ink, cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: section.accent, display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0 }}>
            {itemIcon}
          </div>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 15, color: COLORS.ink, margin: '0 0 2px', lineHeight: 1.25 }} className="line-clamp-2">
              {topicLabel}
            </p>
            <p style={{ fontSize: 12, color: COLORS.inkSoft, margin: 0 }}>
              <span style={{ fontWeight: 700, color: COLORS.orange }}>{group.items.length} of {total} lesson plans</span>
              {' · '}
              <span>{modeLabel}</span>
              {first?.library?.path ? <> · <span style={{ color: COLORS.faint }}>{first.library.path}</span></> : null}
            </p>
          </div>
          <div
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              width: 28,
              height: 28,
              borderRadius: 8,
              background: COLORS.paper,
              display: 'grid',
              placeItems: 'center',
              color: COLORS.ink,
              fontSize: 14,
              fontWeight: 700,
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform .15s ease',
            }}
          >
            ›
          </div>
        </div>
        {newestTs ? (
          <p style={{ fontSize: 11, color: COLORS.faint, margin: '10px 0 0', fontWeight: 600 }}>
            {formatDate(newestTs)}
          </p>
        ) : null}
      </button>
      {open ? (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            marginTop: 12,
            paddingLeft: 12,
            borderLeft: `3px solid ${COLORS.orange}`,
          }}
        >
          {group.items.map((child) => (
            <DocumentCard key={child.id} item={child} section={section} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DocumentCard({ item, section }) {
  // When this card is being rendered inside an expanded series group, the
  // header already shows the shared topic / subtopic. Re-using that as the
  // child title would print the same text on every sibling card. Prefer the
  // per-lesson identity ("Lesson 2 — Concept introduction") so the
  // expanded grid is scannable. titleForGeneration() handles non-series
  // generations as before.
  const series = item?.inputs?.lessonSeries
  const isSeriesChild = !!(series && series.seriesId && Number(series.totalLessons) > 1)
  const baseTitle = item.__title || titleForGeneration(item)
  const title = isSeriesChild
    ? `Lesson ${Number(series.lessonNumber) || '?'}${series.lessonFocus ? ` — ${series.lessonFocus}` : ''}`
    : baseTitle
  const linkTo = item.__linkTo || `/teacher/library/${item.id}`
  // Per-item icon (e.g. ✨ for lesson plans, 📓 for notes) so a mixed
  // folder of saved tools is visually distinguishable. Falls back to the
  // section icon when the tool is unknown (e.g. saved assessments).
  const itemIcon = TOOL_META[item.tool]?.icon || section.icon
  return (
    <Link
      to={linkTo}
      className="block no-underline rounded-2xl border-2 p-4 transition-all hover:-translate-y-0.5"
      style={{ background: COLORS.card, borderColor: COLORS.ink, minHeight: 140, color: COLORS.ink }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 11, background: section.accent, display: 'grid', placeItems: 'center', fontSize: 20, marginBottom: 10, flexShrink: 0 }}>
        {itemIcon}
      </div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 15, color: COLORS.ink, margin: '0 0 4px', lineHeight: 1.25 }} className="line-clamp-2">
        {title}
      </p>
      <p style={{ fontSize: 12, color: COLORS.inkSoft, margin: 0 }}>
        {isSeriesChild
          ? `${baseTitle}${item.library?.path ? ` · ${item.library.path}` : ''}`
          : (item.library?.path || '')}
      </p>
      {item.createdAt && (
        <p style={{ fontSize: 11, color: COLORS.faint, margin: '10px 0 0', fontWeight: 600 }}>
          {formatDate(item.createdAt)}
        </p>
      )}
    </Link>
  )
}

/* ── Bits & helpers ────────────────────────────────────────────── */

function Tile({ icon, accent, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left block rounded-2xl border-2 p-5 transition-all hover:-translate-y-0.5 cursor-pointer"
      style={{ background: COLORS.card, borderColor: COLORS.ink, minHeight: 150, color: COLORS.ink }}
    >
      <div style={{ width: 52, height: 52, borderRadius: 14, background: accent, display: 'grid', placeItems: 'center', fontSize: 26, marginBottom: 14 }}>
        {icon}
      </div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 18, color: COLORS.ink, margin: '0 0 6px', lineHeight: 1.2 }}>
        {title}
      </p>
      <p style={{ fontSize: 12, color: COLORS.faint, margin: 0, fontWeight: 600 }}>
        {subtitle}
      </p>
    </button>
  )
}

// Tile for a folder whose key exists in the saved data but isn't in the
// static taxonomy (e.g. "Unsorted", a legacy subject, or an inactive
// grade). Without this the item is counted at the parent but unreachable.
function OrphanTile({ label, count, onClick }) {
  return (
    <Tile
      icon="🗂️"
      accent="#e5e0d2"
      title={label === 'Unsorted' ? 'Unsorted' : label}
      subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
      onClick={onClick}
    />
  )
}

function EmptyHint({ text }) {
  return (
    <div className="rounded-2xl border-2 border-dashed py-10 px-4 text-center" style={{ background: COLORS.card, borderColor: COLORS.border }}>
      <p style={{ fontSize: 13, color: COLORS.faint, margin: 0 }}>{text}</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="rounded-2xl border-2 border-dashed p-12 text-center" style={{ background: COLORS.card, borderColor: COLORS.border }}>
      <div className="text-4xl mb-3 animate-bounce">📚</div>
      <p style={{ fontSize: 13, color: COLORS.faint }}>Loading your library…</p>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="rounded-2xl border-2 border-dashed p-12 text-center" style={{ background: COLORS.card, borderColor: COLORS.border }}>
      <div className="text-4xl mb-3">⚠️</div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 16, color: COLORS.ink, marginBottom: 6 }}>
        Could not load your library
      </p>
      <p style={{ fontSize: 13, color: COLORS.faint, margin: 0 }}>{message}</p>
    </div>
  )
}

/* ── Tree utilities ────────────────────────────────────────────── */

// Keys present in a tree branch that the static taxonomy doesn't offer.
// These hold real items (e.g. "Unsorted", or a subject/grade that no
// longer matches the config) and must still be navigable, otherwise the
// parent count includes rows that no child tile can reach.
function extraKeys(branch, knownValues) {
  if (!branch || typeof branch !== 'object') return []
  const known = new Set(knownValues)
  return Object.keys(branch)
    .filter((k) => !known.has(k) && countLeaves(branch[k]) > 0)
    .sort((a, b) => {
      if (a === 'Unsorted') return 1
      if (b === 'Unsorted') return -1
      return a.localeCompare(b)
    })
}

function countLeaves(node) {
  if (!node) return 0
  if (Array.isArray(node)) return node.length
  let total = 0
  for (const k of Object.keys(node)) total += countLeaves(node[k])
  return total
}

function readLeaf(tree, sel) {
  const section = LIBRARY_SECTION_BY_ID[sel.type]
  if (!section) return []
  let cursor = tree[sel.type]
  if (!cursor) return []
  cursor = cursor[sel.syllabus]; if (!cursor) return []
  cursor = cursor[sel.grade];    if (!cursor) return []
  if (section.hasTerm) {
    cursor = cursor[sel.term];   if (!cursor) return []
  }
  cursor = cursor[sel.subject];  if (!cursor) return []
  if (section.hasAssessmentType) {
    cursor = cursor[sel.assess]; if (!cursor) return []
  }
  return Array.isArray(cursor) ? cursor : []
}

function buildCrumbs(sel) {
  const out = []
  if (sel.type) {
    const s = LIBRARY_SECTION_BY_ID[sel.type]
    out.push({ level: 'syllabus', label: s?.label || sel.type })
  }
  if (sel.syllabus) out.push({ level: 'grade',  label: sel.syllabus })
  if (sel.grade)    out.push({ level: 'term',   label: sel.grade })
  if (sel.term)     out.push({ level: 'subject', label: sel.term })
  if (sel.subject)  out.push({ level: 'assess',  label: sel.subject })
  return out
}

function labelForAssessment(syllabus, gradeForm, value) {
  if (!value) return ''
  const found = getAssessmentTypesForGradeForm(syllabus, gradeForm).find((t) => t.value === value)
  return found?.label || value
}
