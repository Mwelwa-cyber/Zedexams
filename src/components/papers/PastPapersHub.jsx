/**
 * /papers — public ECZ past-paper archive (audit A2).
 *
 * The audit calls this "the largest organic-demand gap in the Zambian
 * market" — Grade 7, 9, 12 ECZ past papers drive significant SEO traffic
 * and are typically the #1 reason a learner lands on a revision site.
 *
 * Routing is open (no auth required) so search engines can index the
 * list and signed-out visitors browse before signing up. The actual
 * PDF viewer / download is auth-gated by Storage rules — that's the
 * incentive to register.
 *
 * UX:
 *   - Filter row at the top: Grade (7 / 9 / 12) + Subject + Year.
 *   - Year-grouped sections within the filtered set so a learner
 *     scanning for "Mathematics 2023" doesn't have to scroll past
 *     mark-scheme variants.
 *   - Empty state: friendly note + "papers are being uploaded" copy
 *     for the period before the archive is populated.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  PAPER_GRADES,
  listPublishedPapers,
  paperYearsFromList,
} from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'
import Skeleton from '../ui/Skeleton'

const ANY = 'any'

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? 'theme-accent-fill theme-on-accent border-transparent'
          : 'theme-border theme-text-muted hover:theme-text hover:theme-bg-subtle'
      }`}
    >
      {children}
    </button>
  )
}

function PaperCard({ paper }) {
  const subjectMeta = SUBJECTS.find((s) => s.id === paper.subject)
  const subjectLabel = subjectMeta?.label || paper.subject
  const subjectIcon = subjectMeta?.icon || '📄'
  return (
    <Link
      to={`/papers/${paper.id}`}
      className="theme-card border theme-border rounded-radius-md p-4 flex items-start gap-3 hover:theme-bg-subtle transition-colors"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl theme-bg-subtle">
        <span aria-hidden="true">{subjectIcon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm leading-snug">{paper.title}</p>
        <p className="theme-text-muted text-xs mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          <span>{paper.examBoard || 'ECZ'}</span>
          <span aria-hidden="true">·</span>
          <span>Grade {paper.grade}</span>
          <span aria-hidden="true">·</span>
          <span>{subjectLabel}</span>
          {paper.paperNumber ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Paper {paper.paperNumber}</span>
            </>
          ) : null}
        </p>
      </div>
      <span className="theme-accent-text text-xs font-black uppercase tracking-wider self-center">View →</span>
    </Link>
  )
}

function YearSection({ year, papers }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display font-black text-2xl theme-text">{year}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {papers.map((paper) => (
          <PaperCard key={paper.id} paper={paper} />
        ))}
      </div>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
      <div className="text-5xl mb-3">📚</div>
      <h2 className="theme-text font-black text-lg">Past papers coming soon</h2>
      <p className="theme-text-muted text-sm mt-2 max-w-md mx-auto">
        We&apos;re uploading the official ECZ archive — Grade 7, 9 and 12 papers
        from recent years. Check back shortly, or{' '}
        <a className="theme-accent-text font-bold underline" href="https://wa.me/260977740465">
          WhatsApp us
        </a>
        {' '}to be notified the moment the first batch lands.
      </p>
    </div>
  )
}

export default function PastPapersHub() {
  const { currentUser } = useAuth()
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [grade, setGrade] = useState(ANY)
  const [subject, setSubject] = useState(ANY)
  const [year, setYear] = useState(ANY)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listPublishedPapers({})
      .then((rows) => {
        if (!cancelled) setPapers(rows)
      })
      .catch((err) => {
        console.warn('[PastPapersHub] list failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Build the filter universes from the actual data so we never offer
  // a Grade or Subject filter that has zero papers behind it. Keeps
  // empty-state UX out of the filter bar.
  const availableGrades = useMemo(
    () => PAPER_GRADES.filter((g) => papers.some((p) => p.grade === g)),
    [papers],
  )
  const availableSubjects = useMemo(() => {
    const ids = new Set(papers.map((p) => p.subject))
    return SUBJECTS.filter((s) => ids.has(s.id))
  }, [papers])
  const availableYears = useMemo(() => paperYearsFromList(papers), [papers])

  // Apply filters in memory (the dataset is small enough — at full
  // ECZ coverage we're talking ~150 docs).
  const filtered = useMemo(() => {
    return papers.filter((p) => (
      (grade === ANY   || p.grade   === grade)
      && (subject === ANY || p.subject === subject)
      && (year === ANY    || p.year    === year)
    ))
  }, [papers, grade, subject, year])

  // Group filtered set by year for the section headers.
  const grouped = useMemo(() => {
    const byYear = new Map()
    for (const p of filtered) {
      const key = p.year || 'Undated'
      if (!byYear.has(key)) byYear.set(key, [])
      byYear.get(key).push(p)
    }
    return [...byYear.entries()]
      .sort((a, b) => (b[0] || 0) - (a[0] || 0))
      .map(([y, list]) => ({ year: y, papers: list }))
  }, [filtered])

  return (
    <div className="min-h-screen theme-bg pb-20">
      <SeoHelmet
        title="ECZ Past Papers — Grade 7, 9, 12 archive"
        description="Browse the official ECZ past-paper archive — Grade 7, Grade 9 and Grade 12 papers across every CBC subject. Sign in to download papers and mark schemes."
        path="/papers"
      />

      {/* Hero */}
      <header className="theme-hero px-4 pt-6 pb-12" data-bg-gradient="true">
        <div className="max-w-5xl mx-auto">
          <Link to="/welcome" className="inline-flex items-center gap-1.5 text-white/80 hover:text-white text-xs font-bold mb-4">
            <Logo className="h-6 w-auto" />
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-white/80 font-black text-xs uppercase tracking-widest">ECZ archive</p>
              <h1 className="text-white text-3xl sm:text-4xl font-black mt-1">Past papers</h1>
              <p className="text-white/85 text-sm sm:text-base mt-2 max-w-2xl">
                Grade 7, 9 and 12 papers from the Examinations Council of Zambia, organised by year and subject.
              </p>
            </div>
            {currentUser && (
              <Link
                to="/my-papers"
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-black px-3 py-1.5"
              >
                ⏱️ My runs
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 -mt-6">
        {/* Filters */}
        <div className="theme-card border theme-border rounded-radius-md p-4 shadow-elev-sm space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black theme-text-muted uppercase tracking-widest mr-1">Grade</span>
            <FilterChip active={grade === ANY} onClick={() => setGrade(ANY)}>All</FilterChip>
            {availableGrades.map((g) => (
              <FilterChip key={g} active={grade === g} onClick={() => setGrade(g)}>
                Grade {g}
              </FilterChip>
            ))}
          </div>
          {availableSubjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black theme-text-muted uppercase tracking-widest mr-1">Subject</span>
              <FilterChip active={subject === ANY} onClick={() => setSubject(ANY)}>All</FilterChip>
              {availableSubjects.map((s) => (
                <FilterChip key={s.id} active={subject === s.id} onClick={() => setSubject(s.id)}>
                  <span aria-hidden="true" className="mr-1">{s.icon}</span>
                  {s.shortLabel || s.label}
                </FilterChip>
              ))}
            </div>
          )}
          {availableYears.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black theme-text-muted uppercase tracking-widest mr-1">Year</span>
              <FilterChip active={year === ANY} onClick={() => setYear(ANY)}>All</FilterChip>
              {availableYears.map((y) => (
                <FilterChip key={y} active={year === y} onClick={() => setYear(y)}>
                  {y}
                </FilterChip>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="mt-6 space-y-8">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-radius-md" />
              ))}
            </div>
          ) : errored ? (
            <div role="alert" className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
              We couldn&apos;t load the archive right now. Please check your connection and try again.
            </div>
          ) : grouped.length === 0 ? (
            <EmptyState />
          ) : (
            grouped.map(({ year: y, papers: list }) => (
              <YearSection key={String(y)} year={y} papers={list} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
