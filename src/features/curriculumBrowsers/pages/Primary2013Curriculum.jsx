import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, ChevronDown, ChevronUp } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { ZM_GREEN, ZM_GOLD, SOURCE_2013 } from '../lib/frameworkData2013'

const TABS = [
  { id: 'all',        label: 'All' },
  { id: 'lp',         label: 'Lower Primary (G 1–4)' },
  { id: 'up',         label: 'Upper Primary (G 5–7)' },
  { id: 'timetable',  label: 'Timetables' },
  { id: 'language',   label: 'Language & Assessment' },
]

/**
 * Learning areas by band (Chapter 4). Lower Primary offers five core learning
 * areas; Upper Primary offers seven. Content is faithful to the 2013 framework
 * — the framework does not publish per-grade topic tables, so this page shows
 * band-level learning areas + the official time allocations (Tables 4 & 5).
 */
const SUBJECTS = [
  {
    id: 'lit-lang-lp',
    tags: ['all', 'lp'],
    emoji: '📖',
    title: 'Literacy and Languages',
    meta: 'Lower Primary · 6 h 30 min / 13 periods',
    chips: [{ label: 'Lower Primary', tone: 'lp' }, { label: 'Core', tone: 'compulsory' }],
    text: 'literacy language zambian english sign braille reading writing nbtl eglp',
    details: {
      Focus: 'At Grades 1–2 much time is devoted to Initial Literacy and Numeracy so learners gain the competences for further learning.',
      Approach: 'The New Breakthrough to Literacy (NBTL) / Early Grade Literacy Programme (EGLP). Literacy begins in a familiar Zambian Language; literacy in English is introduced at Grade 2.',
      Options: 'Sign Language and Braille are offered as options for learners with Special Educational Needs.',
    },
  },
  {
    id: 'maths-lp',
    tags: ['all', 'lp'],
    emoji: '➕',
    title: 'Mathematics',
    meta: 'Lower Primary · 5 h / 10 periods',
    chips: [{ label: 'Lower Primary', tone: 'lp' }, { label: 'Core', tone: 'compulsory' }],
    text: 'mathematics number counting shapes measurement numeracy',
    details: {
      Focus: 'Consolidating basic mathematical skills — number, counting, shapes, measurement and early problem solving through concrete, hands-on activities.',
    },
  },
  {
    id: 'science-lp',
    tags: ['all', 'lp'],
    emoji: '🌿',
    title: 'Integrated Science',
    meta: 'Lower Primary · 2 h 30 min / 5 periods',
    chips: [{ label: 'Lower Primary', tone: 'lp' }, { label: 'Core', tone: 'compulsory' }],
    text: 'integrated science plants animals environment observation',
    details: {
      Focus: 'Exploratory science — observing plants, animals, weather and everyday materials in the child’s environment.',
    },
  },
  {
    id: 'social-lp',
    tags: ['all', 'lp'],
    emoji: '🌍',
    title: 'Social Studies',
    meta: 'Lower Primary · 2 h 30 min / 5 periods',
    chips: [{ label: 'Lower Primary', tone: 'lp' }, { label: 'Core', tone: 'compulsory' }],
    text: 'social studies family community citizenship',
    details: {
      Focus: 'The family, the community and the immediate environment — building early citizenship and social awareness.',
    },
  },
  {
    id: 'cts-lp',
    tags: ['all', 'lp'],
    emoji: '🎨',
    title: 'Creative & Technology Studies (CTS)',
    meta: 'Lower Primary · 4 h 30 min / 9 periods',
    chips: [{ label: 'Lower Primary', tone: 'lp' }, { label: 'Core', tone: 'compulsory' }],
    text: 'creative technology studies art music home economics expressive',
    details: {
      Strands: [
        'Technology Studies — tools, simple making and early digital skills',
        'Home Economics — hygiene, food and simple crafts',
        'Expressive Arts — art, music, dance and drama',
      ],
      'Why integrated?': 'At Grades 1–4 the key content of Technology Studies, Home Economics and Expressive Arts is integrated into a single learning area — Creative & Technology Studies.',
    },
  },
  {
    id: 'eng-up',
    tags: ['all', 'up'],
    emoji: '📝',
    title: 'English Language',
    meta: 'Upper Primary · 4 h / 6 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'english language reading writing comprehension grammar',
    details: {
      Focus: 'Listening, speaking, reading and writing — English becomes the medium of instruction across other learning areas at Upper Primary.',
    },
  },
  {
    id: 'maths-up',
    tags: ['all', 'up'],
    emoji: '➗',
    title: 'Mathematics',
    meta: 'Upper Primary · 4 h 40 min / 7 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'mathematics fractions decimals geometry measurement statistics',
    details: {
      Focus: 'Number and operations, fractions and decimals, measurement, geometry and data handling — building the foundation for Junior Secondary.',
    },
  },
  {
    id: 'science-up',
    tags: ['all', 'up'],
    emoji: '🔬',
    title: 'Integrated Science',
    meta: 'Upper Primary · 4 h / 6 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'integrated science living things matter energy environment inquiry',
    details: {
      Focus: 'Living things, matter and energy, the environment and simple scientific inquiry.',
    },
  },
  {
    id: 'zam-up',
    tags: ['all', 'up'],
    emoji: '🗣️',
    title: 'Zambian Languages',
    meta: 'Upper Primary · 4 h / 6 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'zambian language bemba nyanja tonga lozi kaonde lunda luvale oral literature',
    details: {
      Focus: 'Reading, writing and oral literature in a Zambian Language, carried on from Lower Primary and taught as a subject alongside English.',
    },
  },
  {
    id: 'social-up',
    tags: ['all', 'up'],
    emoji: '🌍',
    title: 'Social Studies',
    meta: 'Upper Primary · 3 h 20 min / 5 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'social studies history geography civic zambia governance',
    details: {
      Focus: 'History, geography and civic education — Zambia, the region and the world, with governance and national values.',
    },
  },
  {
    id: 'tech-up',
    tags: ['all', 'up'],
    emoji: '💻',
    title: 'Technology Studies',
    meta: 'Upper Primary · 2 h 40 min / 4 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'technology studies design making ict computer',
    details: {
      Focus: 'Design and making, tools and materials, and introductory computing — split out from the Lower-Primary CTS learning area.',
    },
  },
  {
    id: 'homeec-up',
    tags: ['all', 'up'],
    emoji: '🏠',
    title: 'Home Economics',
    meta: 'Upper Primary · 2 h 40 min / 4 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'home economics food nutrition clothing family consumer',
    details: {
      Focus: 'Food and nutrition, clothing care, family and consumer skills — split out from the Lower-Primary CTS learning area.',
    },
  },
  {
    id: 'arts-up',
    tags: ['all', 'up'],
    emoji: '🎭',
    title: 'Expressive Arts',
    meta: 'Upper Primary · 2 h 40 min / 4 periods',
    chips: [{ label: 'Upper Primary', tone: 'up' }, { label: 'Core', tone: 'compulsory' }],
    text: 'expressive arts visual music dance drama performance',
    details: {
      Focus: 'Visual art, music, dance and drama — split out from the Lower-Primary CTS learning area.',
    },
  },
]

function tabMatches(itemTags, activeTab) {
  return activeTab === 'all' || itemTags.includes(activeTab)
}

function searchMatches(haystack, query) {
  if (!query) return true
  return haystack.toLowerCase().includes(query.trim().toLowerCase())
}

function ChipStyle({ tone, children }) {
  const map = {
    lp:         { background: 'rgba(46, 134, 193, 0.14)', color: 'var(--info-fg)' },
    up:         { background: 'rgba(30, 132, 73, 0.14)',  color: 'var(--success-fg)' },
    compulsory: { background: 'rgba(30, 132, 73, 0.14)',  color: 'var(--success-fg)' },
  }
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.06em]"
      style={map[tone] || map.lp}
    >
      {children}
    </span>
  )
}

function SubjectCard({ subject, isOpen, onToggle }) {
  return (
    <article className="rounded-2xl border theme-border theme-card shadow-elev-md overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ background: 'rgba(26, 122, 74, 0.10)' }}
          aria-hidden
        >
          {subject.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black theme-text">{subject.title}</h3>
          <p className="mt-0.5 text-xs theme-text-muted">{subject.meta}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {subject.chips.map(c => (
          <ChipStyle key={c.label} tone={c.tone}>{c.label}</ChipStyle>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1.5 border-t theme-border px-4 py-2.5 text-xs font-black uppercase tracking-[0.08em] theme-text-muted transition hover:theme-bg-subtle"
        style={{ color: ZM_GREEN }}
      >
        <Icon as={isOpen ? ChevronUp : ChevronDown} size="xs" strokeWidth={2.2} />
        {isOpen ? 'Hide details' : 'Show details'}
      </button>
      {isOpen && (
        <div className="border-t theme-border px-4 py-3 text-sm theme-text">
          {Object.entries(subject.details).map(([heading, body]) => (
            <div key={heading} className="mt-1 first:mt-0">
              <h4 className="mb-1 text-[11px] font-black uppercase tracking-[0.08em] theme-text-muted">
                {heading}
              </h4>
              {Array.isArray(body) ? (
                <ul className="list-disc pl-5 space-y-1">
                  {body.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              ) : (
                <p className="leading-relaxed">{body}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function TimetableTable({ title, headers, rows, totalRow }) {
  return (
    <section className="overflow-hidden rounded-2xl border theme-border theme-card shadow-elev-md">
      <header className="border-b theme-border px-4 py-3" style={{ background: ZM_GREEN, color: '#fff' }}>
        <h3 className="text-sm font-black">{title}</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h} className="border-b theme-border px-4 py-2 text-left text-[11px] font-black uppercase tracking-[0.06em]"
                  style={{ background: 'rgba(212, 160, 23, 0.16)', color: 'var(--warning-fg)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'theme-bg-subtle' : ''}>
                {row.map((cell, j) => (
                  <td key={j} className="border-b theme-border px-4 py-2 theme-text align-top">{cell}</td>
                ))}
              </tr>
            ))}
            {totalRow && (
              <tr style={{ background: 'rgba(212, 160, 23, 0.16)' }}>
                {totalRow.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-sm font-black" style={{ color: 'var(--warning-fg)' }}>{cell}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Primary2013Curriculum() {
  const [activeTab, setActiveTab] = useState('all')
  const [query, setQuery] = useState('')
  const [openSubject, setOpenSubject] = useState(null)

  const filteredSubjects = useMemo(() => {
    return SUBJECTS.filter(s => {
      if (!tabMatches(s.tags, activeTab)) return false
      const hay = `${s.title} ${s.meta} ${s.text} ${Object.values(s.details).flat().join(' ')}`
      return searchMatches(hay, query)
    })
  }, [activeTab, query])

  const showLpTimetable = tabMatches(['all', 'lp', 'timetable'], activeTab)
  const showUpTimetable = tabMatches(['all', 'up', 'timetable'], activeTab)
  const showLanguage    = tabMatches(['all', 'language'], activeTab)

  return (
    <div>
      <SeoHelmet
        title="2013 Primary Curriculum (Grades 1–7)"
        description="2013 Zambia Primary Curriculum — Lower Primary (Grades 1–4) and Upper Primary (Grades 5–7) learning areas, official timetables and the language-of-instruction policy."
        path="/teacher/curriculum/2013/primary"
        noIndex
      />

      {/* Back link */}
      <Link
        to="/teacher/curriculum/2013"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.08em] theme-text-muted no-underline hover:theme-text"
      >
        <Icon as={ArrowLeft} size="xs" strokeWidth={2.2} />
        2013 Curriculum
      </Link>

      {/* Hero */}
      <section
        className="mb-5 overflow-hidden rounded-3xl border theme-border shadow-elev-md"
        style={{ background: `linear-gradient(135deg, #8a5a12 0%, #a4700f 50%, #7a3a1f 100%)` }}
      >
        <div className="px-5 py-6 text-white sm:px-7 sm:py-7">
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
            style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}
          >
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ZM_GOLD }} />
            2013 Framework · Grades 1–7
          </div>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">Zambia Primary Curriculum (2013)</h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.88)' }}>
            Lower Primary (Grades 1–4) offers five core learning areas; Upper Primary (Grades 5–7)
            offers seven. Search the learning areas or jump to the official timetables.
          </p>

          {/* Search */}
          <div className="mt-4 max-w-lg">
            <label className="relative flex items-center">
              <span className="sr-only">Search the primary curriculum</span>
              <span className="pointer-events-none absolute left-3 inline-flex h-4 w-4 items-center justify-center text-white/70">
                <Icon as={Search} size="xs" strokeWidth={2.2} />
              </span>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search learning areas…"
                className="w-full rounded-full border px-9 py-2 text-sm shadow-elev-md outline-none"
                style={{ background: 'var(--zt-card)', borderColor: 'rgba(255,255,255,0.3)', color: 'var(--zt-text)' }}
              />
            </label>
            {query && (
              <p className="mt-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {filteredSubjects.length
                  ? `Showing ${filteredSubjects.length} learning area${filteredSubjects.length !== 1 ? 's' : ''} matching "${query}"`
                  : `No learning areas match "${query}"`}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map(t => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              aria-pressed={active}
              className={`min-h-0 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                active ? 'border-transparent text-white shadow-elev-md' : 'theme-border theme-card theme-text-muted hover:theme-card-hover'
              }`}
              style={active ? { background: ZM_GREEN } : undefined}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="space-y-5">
        {/* Timetables */}
        {showLpTimetable && (
          <TimetableTable
            title="🕐 Timetable — Lower Primary (G 1–4) · 21 hrs / 42 periods · 30-min periods"
            headers={['#', 'Learning Area', 'Time / Week', 'Periods']}
            rows={[
              ['1', 'Literacy and Languages', '6 h 30 min', '13'],
              ['2', 'Mathematics', '5 h 00 min', '10'],
              ['3', 'Social Studies', '2 h 30 min', '5'],
              ['4', 'Integrated Science', '2 h 30 min', '5'],
              ['5', 'Creative and Technology Studies', '4 h 30 min', '9'],
            ]}
            totalRow={['', 'TOTAL', '21 hours', '42']}
          />
        )}

        {showUpTimetable && (
          <TimetableTable
            title="🕐 Timetable — Upper Primary (G 5–7) · 28 hrs / 42 periods · 40-min periods"
            headers={['#', 'Learning Area', 'Time / Week', 'Periods']}
            rows={[
              ['1', 'English Language', '4 h 00 min', '6'],
              ['2', 'Mathematics', '4 h 40 min', '7'],
              ['3', 'Integrated Science', '4 h 00 min', '6'],
              ['4', 'Zambian Languages', '4 h 00 min', '6'],
              ['5', 'Expressive Arts', '2 h 40 min', '4'],
              ['6', 'Social Studies', '3 h 20 min', '5'],
              ['7', 'Technology Studies', '2 h 40 min', '4'],
              ['8', 'Home Economics', '2 h 40 min', '4'],
            ]}
            totalRow={['', 'TOTAL', '28 hours', '42']}
          />
        )}

        {/* Subject cards */}
        {filteredSubjects.length > 0 && (
          <>
            <h2 className="pt-2 text-[11px] font-black uppercase tracking-[0.14em] theme-text-muted">
              Learning Areas
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSubjects.map(s => (
                <SubjectCard
                  key={s.id}
                  subject={s}
                  isOpen={openSubject === s.id}
                  onToggle={() => setOpenSubject(prev => (prev === s.id ? null : s.id))}
                />
              ))}
            </div>
          </>
        )}

        {/* Language & assessment */}
        {showLanguage && (
          <section className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
            <h2 className="text-sm font-black theme-text">Language of Instruction &amp; Assessment</h2>
            <ul className="mt-3 space-y-2 text-sm theme-text">
              {[
                'The language of instruction from Grades 1–4 in all learning areas is a familiar Zambian Language.',
                'Initial literacy is taught in the Zambian Language first; literacy in English is introduced at Grade 2.',
                'The New Breakthrough to Literacy (NBTL) / Early Grade Literacy Programme (EGLP) underpins early reading and writing.',
                'Learners take competence tests in Literacy and Numeracy in the early grades to identify those needing support.',
                'The Primary curriculum forms the foundation for Junior Secondary School education.',
              ].map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: ZM_GREEN }} />
                  <span className="leading-relaxed">{line}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <p className="mt-6 text-xs theme-text-muted">
        Source: <span className="font-bold theme-text">{SOURCE_2013}</span>
      </p>
    </div>
  )
}
