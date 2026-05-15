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
  SYLLABUS_TYPES,
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
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {SYLLABUS_OPTIONS.map((opt) => {
        const branch = tree[opt.value] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={opt.value}
            icon="📚"
            accent="#fde2c4"
            title={opt.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(opt.value)}
          />
        )
      })}
    </div>
  )
}

function GradeFormPicker({ syllabus, subTree, onPick }) {
  const grades = getActiveGradeForms(syllabus)
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {grades.map((g) => {
        const branch = subTree[g.value] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={g.value}
            icon={syllabus === SYLLABUS_TYPES.SECONDARY ? '🎓' : '🎒'}
            accent="#dbe7f4"
            title={g.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(g.value)}
          />
        )
      })}
      {grades.length === 0 && (
        <EmptyHint text={`No grades configured for ${syllabus} yet.`} />
      )}
    </div>
  )
}

function TermPicker({ subTree, onPick }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {TERMS.map((t) => {
        const branch = subTree[t.value] || {}
        const count = countLeaves(branch)
        return (
          <Tile
            key={t.value}
            icon="📅"
            accent="#faecb8"
            title={t.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(t.value)}
          />
        )
      })}
    </div>
  )
}

function SubjectPicker({ syllabus, gradeForm, subTree, onPick }) {
  const subjects = getSubjectsForGradeForm(syllabus, gradeForm)
  if (subjects.length === 0) {
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
            icon="📘"
            accent="#d8ecd0"
            title={s}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(s)}
          />
        )
      })}
    </div>
  )
}

function AssessmentTypePicker({ syllabus, gradeForm, subTree, onPick }) {
  const types = getAssessmentTypesForGradeForm(syllabus, gradeForm)
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {types.map((t) => {
        const branch = subTree[t.value] || []
        const count = Array.isArray(branch) ? branch.length : countLeaves(branch)
        return (
          <Tile
            key={t.value}
            icon="📝"
            accent="#e8d8f0"
            title={t.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(t.value)}
          />
        )
      })}
    </div>
  )
}

/* ── Documents (leaf) ──────────────────────────────────────────── */

function DocumentList({ items, section }) {
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
      {items.map((item) => (
        <DocumentCard key={item.id} item={item} section={section} />
      ))}
    </div>
  )
}

function DocumentCard({ item, section }) {
  const title = item.__title || titleForGeneration(item)
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
        {item.library?.path || ''}
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
