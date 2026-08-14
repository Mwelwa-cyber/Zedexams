// src/features/learnerSearch/pages/LearnerSearch.jsx
//
// /search — global learner search across quizzes, notes, past papers and games.
// One search box, results grouped by type, each linking to its content. Search
// is client-side over the learner's in-scope catalogue (see useLearnerSearch);
// there's no server-side full-text index yet.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useLearnerSearch } from '../../../hooks/useLearnerSearch'
import { RESULT_TYPES, RESULT_TYPE_META } from '../../../utils/learnerSearch'
import { Search } from '../../../components/ui/icons'
import Icon from '../../../components/ui/Icon'
import Skeleton from '../../../components/ui/Skeleton'
import SeoHelmet from '../../../components/seo/SeoHelmet'

export default function LearnerSearch() {
  const { userProfile } = useAuth()
  const grade = userProfile?.grade || null
  const [params, setParams] = useSearchParams()
  const [input, setInput] = useState(() => params.get('q') || '')
  const query = input.trim()

  // Keep the URL in sync (shareable / refresh-safe) without thrashing history.
  useEffect(() => {
    const id = setTimeout(() => {
      setParams(query ? { q: query } : {}, { replace: true })
    }, 250)
    return () => clearTimeout(id)
  }, [query, setParams])

  const { loading, groups, total } = useLearnerSearch(query, grade)
  const hasQuery = query.length > 0
  const nonEmptyTypes = useMemo(
    () => RESULT_TYPES.filter((t) => groups[t]?.length > 0),
    [groups],
  )

  return (
    <div className="theme-bg theme-text min-h-screen">
      <SeoHelmet title="Search" path="/search" noIndex />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-3 text-xl font-black theme-text">Search</h1>

        {/* Search box */}
        <div className="relative mb-5">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted">
            <Icon as={Search} size="sm" />
          </span>
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search quizzes, notes, papers & games…"
            aria-label="Search all content"
            autoFocus
            className="theme-input theme-card w-full rounded-2xl border-2 theme-border py-3 pl-10 pr-4 text-sm font-semibold outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* States */}
        {!hasQuery ? (
          <EmptyPrompt />
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={64} className="!rounded-2xl" />)}
          </div>
        ) : total === 0 ? (
          <NoResults query={query} grade={grade} />
        ) : (
          <div className="space-y-6">
            <p className="text-xs font-bold theme-text-muted">
              {total} result{total === 1 ? '' : 's'} for “{query}”
            </p>
            {nonEmptyTypes.map((type) => (
              <ResultGroup key={type} type={type} items={groups[type]} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ResultGroup({ type, items }) {
  const meta = RESULT_TYPE_META[type]
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-black theme-text">
        <span aria-hidden="true">{meta.icon}</span>
        {meta.label}
        <span className="theme-text-muted font-bold">({items.length})</span>
      </h2>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={`${r.type}:${r.id}`}>
            <Link
              to={r.route}
              className="zx-card theme-card flex items-center gap-3 rounded-2xl border theme-border px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl theme-bg-subtle text-lg" aria-hidden="true">
                {meta.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black theme-text">{r.title}</span>
                {r.subtitle && (
                  <span className="block truncate text-xs font-bold theme-text-muted">{r.subtitle}</span>
                )}
              </span>
              <span className="theme-text-muted" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function EmptyPrompt() {
  return (
    <div className="theme-card rounded-2xl border theme-border p-8 text-center">
      <div className="mb-2 text-4xl">🔎</div>
      <p className="text-sm font-black theme-text">Find anything in ZedExams</p>
      <p className="mx-auto mt-1 max-w-sm text-xs font-bold theme-text-muted">
        Search across your quizzes, notes, past papers and games — all in one place.
      </p>
    </div>
  )
}

function NoResults({ query, grade }) {
  return (
    <div className="theme-card rounded-2xl border theme-border p-8 text-center">
      <div className="mb-2 text-4xl">🤔</div>
      <p className="text-sm font-black theme-text">No results for “{query}”</p>
      <p className="mx-auto mt-1 max-w-sm text-xs font-bold theme-text-muted">
        Try a different word or a subject name{grade ? ` — this searches your Grade ${String(grade).replace(/^G/i, '')} content` : ''}.
      </p>
    </div>
  )
}
