import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import {
  listMyGenerations,
  titleForGeneration,
  formatDate,
} from '../../../utils/teacherLibraryService'
import SeoHelmet from '../../seo/SeoHelmet'

const SECTIONS = [
  {
    key: 'lesson_plan',
    label: 'Lesson Plans',
    icon: '🦊',
    accent: '#fde2c4',
    createTo: '/teacher/generate/lesson-plan',
    emptyHint: 'Generate your first lesson plan to see it here.',
    source: 'generations',
  },
  {
    key: 'assessments',
    label: 'Assessments',
    icon: '🦅',
    accent: '#e8d8f0',
    createTo: '/teacher/assessments',
    emptyHint: 'Create a topic, monthly or end-of-term assessment.',
    source: 'quizzes',
  },
  {
    key: 'scheme_of_work',
    label: 'Schemes of Work',
    icon: '🦁',
    accent: '#faecb8',
    createTo: '/teacher/generate/scheme-of-work',
    emptyHint: 'Plan a whole term with a scheme of work.',
    source: 'generations',
  },
  {
    key: 'worksheet',
    label: 'Worksheets',
    icon: '🐢',
    accent: '#d8ecd0',
    createTo: '/teacher/generate/worksheet',
    emptyHint: 'Generate practice worksheets aligned to your lesson.',
    source: 'generations',
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: '🦉',
    accent: '#dbe7f4',
    createTo: null,
    emptyHint: 'Teacher delivery notes — coming soon.',
    source: 'none',
  },
]

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function genSubtitle(g) {
  const parts = [g.inputs?.grade, g.inputs?.subject ? formatSubject(g.inputs.subject) : ''].filter(Boolean)
  return parts.join(' · ')
}

function quizSubtitle(q) {
  const parts = [q.grade || q.targetGrade, q.subject ? formatSubject(q.subject) : ''].filter(Boolean)
  return parts.join(' · ')
}

export default function TeacherLibrary() {
  const { currentUser } = useAuth()
  const { getMyQuizzes } = useFirestore()
  const [searchParams, setSearchParams] = useSearchParams()
  const folderParam = searchParams.get('folder') || searchParams.get('tool') || ''
  const openFolderKey = SECTIONS.some((s) => s.key === folderParam) ? folderParam : ''
  const openFolder = SECTIONS.find((s) => s.key === openFolderKey) || null
  const initialQuery = searchParams.get('q') || ''

  const [generations, setGenerations] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [errorMessage, setErrorMessage] = useState('')
  const [search, setSearch] = useState(initialQuery)

  const closeFolder = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('folder')
    next.delete('tool')
    setSearchParams(next, { replace: false })
  }

  const openFolderByKey = (key) => {
    const next = new URLSearchParams(searchParams)
    next.set('folder', key)
    next.delete('tool')
    setSearchParams(next, { replace: false })
  }

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setStatus('loading')
    Promise.all([
      listMyGenerations({ uid: currentUser.uid }),
      getMyQuizzes(currentUser.uid).catch(() => []),
    ])
      .then(([gens, qs]) => {
        if (cancelled) return
        setGenerations(gens)
        setQuizzes(qs)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err?.message || 'Could not load your library.')
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [currentUser])

  const term = search.trim().toLowerCase()

  const filteredGenerations = useMemo(() => {
    if (!term) return generations
    return generations.filter((r) => {
      const haystack = [
        r.inputs?.topic, r.inputs?.subtopic,
        titleForGeneration(r), r.inputs?.grade, r.inputs?.subject,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [generations, term])

  const filteredQuizzes = useMemo(() => {
    if (!term) return quizzes
    return quizzes.filter((q) => {
      const haystack = [q.title, q.topic, q.subject, q.grade].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [quizzes, term])

  const sectionData = useMemo(() => {
    const result = {}
    SECTIONS.forEach((s) => { result[s.key] = [] })
    filteredGenerations.forEach((g) => {
      if (result[g.tool]) {
        result[g.tool].push({
          id: g.id,
          title: titleForGeneration(g),
          subtitle: genSubtitle(g),
          metaLabel: formatDate(g.createdAt),
          to: `/teacher/library/${g.id}`,
        })
      }
    })
    filteredQuizzes.forEach((q) => {
      result.assessments.push({
        id: q.id,
        title: q.title || q.topic || 'Untitled assessment',
        subtitle: quizSubtitle(q),
        metaLabel: q.createdAt ? formatDate(q.createdAt) : '',
        to: `/teacher/assessments/${q.id}/edit`,
      })
    })
    return result
  }, [filteredGenerations, filteredQuizzes])

  const totalSaved = generations.length + quizzes.length
  const isSearching = term.length > 0
  const visibleSections = isSearching
    ? SECTIONS.filter((s) => sectionData[s.key].length > 0)
    : openFolder
      ? SECTIONS.filter((s) => s.key === openFolder.key)
      : []
  const headline = openFolder && !isSearching ? openFolder.label : 'Library'
  const subheadline = (() => {
    if (status !== 'ready') return 'Everything you have saved across studios.'
    if (isSearching) {
      const matches = visibleSections.reduce((sum, s) => sum + sectionData[s.key].length, 0)
      return `${matches} match${matches === 1 ? '' : 'es'} for “${search.trim()}”`
    }
    if (openFolder) {
      const count = sectionData[openFolder.key].length
      return `${count} saved ${count === 1 ? 'item' : 'items'} in this folder`
    }
    return `${totalSaved} saved item${totalSaved === 1 ? '' : 's'} across all studios`
  })()

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Teacher library" noIndex />
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            {openFolder && !isSearching ? (
              <button
                type="button"
                onClick={closeFolder}
                className="inline-flex items-center gap-1.5 mb-3 text-sm font-bold rounded-xl border-2 px-3 py-1.5 transition-colors cursor-pointer"
                style={{ borderColor: '#0e2a32', color: '#0e2a32', background: '#fff' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f5efe1' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
              >
                ← All folders
              </button>
            ) : (
              <Link
                to="/teacher"
                className="inline-flex items-center gap-1.5 mb-3 no-underline text-sm font-bold rounded-xl border-2 px-3 py-1.5 transition-colors"
                style={{ borderColor: '#0e2a32', color: '#0e2a32', background: '#fff' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f5efe1' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
              >
                ← Home
              </Link>
            )}
            <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 32, color: '#0e2a32', margin: 0, letterSpacing: '-.3px' }}>
              {headline}
            </h1>
            <p style={{ fontSize: 13, color: '#566f76', margin: '4px 0 0' }}>
              {subheadline}
            </p>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your library…"
            className="px-4 py-2.5 rounded-xl border-2 text-sm focus:outline-none w-full sm:w-72"
            style={{ borderColor: '#0e2a32', background: '#fff', color: '#0e2a32' }}
          />
        </div>

        {/* Body */}
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState message={errorMessage} />}

        {status === 'ready' && !isSearching && !openFolder && (
          <FolderGrid sections={SECTIONS} sectionData={sectionData} onOpen={openFolderByKey} />
        )}

        {status === 'ready' && (isSearching || openFolder) && (
          <div>
            {visibleSections.length === 0 && isSearching && (
              <div className="rounded-2xl border-2 border-dashed py-10 px-4 text-center" style={{ background: '#fff', borderColor: '#d4cab2' }}>
                <p style={{ fontSize: 13, color: '#8a9aa1', margin: 0 }}>
                  No matches for “{search.trim()}”.
                </p>
              </div>
            )}
            {visibleSections.map((section) => (
              <LibrarySection
                key={section.key}
                section={section}
                items={sectionData[section.key]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FolderGrid({ sections, sectionData, onOpen }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {sections.map((section) => {
        const count = sectionData[section.key].length
        return (
          <button
            key={section.key}
            type="button"
            onClick={() => onOpen(section.key)}
            className="text-left block no-underline rounded-2xl border-2 p-5 transition-all hover:-translate-y-0.5 cursor-pointer"
            style={{ background: '#fff', borderColor: '#0e2a32', minHeight: 160, color: '#0e2a32' }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 20px rgba(14,42,50,.1)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
          >
            <div style={{ width: 52, height: 52, borderRadius: 14, background: section.accent, display: 'grid', placeItems: 'center', fontSize: 26, marginBottom: 14 }}>
              {section.icon}
            </div>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 18, color: '#0e2a32', margin: '0 0 6px', lineHeight: 1.2 }}>
              {section.label}
            </p>
            <p style={{ fontSize: 12, color: '#8a9aa1', margin: 0, fontWeight: 600 }}>
              {count} saved {count === 1 ? 'item' : 'items'}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function LibrarySection({ section, items }) {
  return (
    <section
      id={`section-${section.key}`}
      className="mb-8 rounded-2xl"
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div style={{ width: 42, height: 42, borderRadius: 12, background: section.accent, display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0 }}>
            {section.icon}
          </div>
          <div>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 20, color: '#0e2a32', margin: 0, lineHeight: 1.1 }}>
              {section.label}
            </h2>
            <p style={{ fontSize: 12, color: '#8a9aa1', margin: '3px 0 0', fontWeight: 600 }}>
              {items.length} saved
            </p>
          </div>
        </div>
        {section.createTo && (
          <Link
            to={section.createTo}
            className="inline-flex items-center gap-1.5 rounded-xl font-bold no-underline transition-colors"
            style={{ background: '#0e2a32', color: '#fff', padding: '8px 14px', fontSize: 12.5 }}
          >
            + New
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div
          className="rounded-2xl border-2 border-dashed py-6 px-4 text-center"
          style={{ background: '#fff', borderColor: '#d4cab2' }}
        >
          <p style={{ fontSize: 13, color: '#8a9aa1', margin: 0 }}>
            {section.emptyHint}
          </p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {items.map((item) => (
            <LibraryCard
              key={item.id}
              icon={section.icon}
              accent={section.accent}
              title={item.title}
              subtitle={item.subtitle}
              meta={item.metaLabel}
              to={item.to}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function LibraryCard({ icon, accent, title, subtitle, meta, to }) {
  return (
    <Link
      to={to}
      className="block no-underline rounded-2xl border-2 p-4 transition-all hover:-translate-y-0.5"
      style={{ background: '#fff', borderColor: '#0e2a32', minHeight: 140, color: '#0e2a32' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 20px rgba(14,42,50,.1)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 11, background: accent, display: 'grid', placeItems: 'center', fontSize: 20, marginBottom: 10, flexShrink: 0 }}>
        {icon}
      </div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 15, color: '#0e2a32', margin: '0 0 4px', lineHeight: 1.25 }} className="line-clamp-2">
        {title}
      </p>
      {subtitle && (
        <p style={{ fontSize: 12, color: '#566f76', margin: 0, lineHeight: 1.4 }} className="line-clamp-1">
          {subtitle}
        </p>
      )}
      {meta && (
        <p style={{ fontSize: 11, color: '#8a9aa1', margin: '10px 0 0', fontWeight: 600 }}>
          {meta}
        </p>
      )}
    </Link>
  )
}

function LoadingState() {
  return (
    <div className="rounded-2xl border-2 border-dashed p-12 text-center" style={{ background: '#fff', borderColor: '#d4cab2' }}>
      <div className="text-4xl mb-3 animate-bounce">📚</div>
      <p style={{ fontSize: 13, color: '#8a9aa1' }}>Loading your library…</p>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="rounded-2xl border-2 border-dashed p-12 text-center" style={{ background: '#fff', borderColor: '#d4cab2' }}>
      <div className="text-4xl mb-3">⚠️</div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 16, color: '#0e2a32', marginBottom: 6 }}>
        Could not load your library
      </p>
      <p style={{ fontSize: 13, color: '#8a9aa1', margin: 0 }}>{message}</p>
    </div>
  )
}
