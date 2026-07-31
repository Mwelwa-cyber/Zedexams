import { Link } from 'react-router-dom'
import { ArrowLeft } from '../../ui/icons'
import Icon from '../../ui/Icon'
import SeoHelmet from '../../seo/SeoHelmet'
import { ZM_GREEN, ZM_GOLD, SOURCE_2013 } from './frameworkData2013'

/** Junior Secondary — Academic pathway (Grades 8–9). */
const JUNIOR_ACADEMIC_COMPULSORY = [
  'Business Studies (Entrepreneurship integrated)',
  'English Language',
  'Computer Studies',
  'Integrated Science',
  'Social Studies',
  'Mathematics',
  'Religious Education',
  'Zambian Languages',
]
const JUNIOR_ACADEMIC_OPTIONAL = ['French', 'Chinese', 'Portuguese']

/** Table 6 — Grades 8 & 9 Academic pathway time allocation (30 hrs / 46 periods). */
const JUNIOR_TIMETABLE = [
  ['English Language', '4 h 00 min', '6'],
  ['Mathematics', '4 h 00 min', '6'],
  ['Zambian Languages', '3 h 20 min', '5'],
  ['Integrated Science', '4 h 00 min', '6'],
  ['Social Studies', '4 h 00 min', '6'],
  ['Business Studies', '3 h 20 min', '5'],
  ['Computer Studies', '2 h 40 min', '4'],
  ['Religious Education', '2 h 40 min', '4'],
  ['Foreign Languages', '2 h 40 min', '4'],
]

/** The five Vocational Career Pathway options (shared Junior + Senior). */
const VOCATIONAL_OPTIONS = [
  { emoji: '🌱', title: 'Agriculture', body: 'Agricultural Science (Entrepreneurship integrated) with Computer Studies, English and Mathematics as support subjects.', bg: '#e8fff0', color: 'var(--success-fg)' },
  { emoji: '🔧', title: 'Technology', body: 'Design & Technology / practical technology skills with academic support subjects.', bg: '#fff8e8', color: 'var(--warning-fg)' },
  { emoji: '🎭', title: 'Performing & Creative Arts (PCA)', body: 'Music, art, dance and drama, with academic support subjects.', bg: '#ffe8e8', color: 'var(--danger-fg)' },
  { emoji: '⚽', title: 'Physical Education & Sports (PES)', body: 'Physical education, sport and health, with academic support subjects.', bg: '#e8faff', color: 'var(--info-fg)' },
  { emoji: '🍳', title: 'Home Economics & Hospitality (HEH)', body: 'Food & nutrition, clothing, hospitality and catering, with academic support subjects.', bg: '#fdf0ff', color: '#6b0080' },
]

/** Senior Secondary — Academic Career Pathway options (Grades 10–12). */
const SENIOR_ACADEMIC = [
  {
    emoji: '🌍',
    title: 'Social Sciences',
    compulsory: ['Mathematics', 'English Language', 'Biology', 'Science', 'Geography / History', 'Civic Education', 'Literature in English'],
    optional: ['Zambian Languages', 'Religious Education', 'Foreign Languages'],
  },
  {
    emoji: '💼',
    title: 'Business Studies',
    compulsory: ['Mathematics', 'English Language', 'Biology', 'Civic Education', 'Principles of Accounts', 'Commerce', 'Science'],
    optional: ['Religious Education', 'Geography / History', 'Zambian Languages', 'Literature in English', 'Foreign Languages'],
  },
  {
    emoji: '🔬',
    title: 'Natural Sciences',
    compulsory: ['Mathematics', 'English Language', 'Chemistry', 'Physics', 'Biology', 'Additional Mathematics', 'Civic Education'],
    optional: ['Geography / History', 'Zambian Language', 'Religious Education'],
  },
]

function LevelCard({ tone, badge, title, sub, rows }) {
  return (
    <article className="overflow-hidden rounded-3xl border theme-border theme-card shadow-elev-md">
      <header className="flex items-center gap-3 p-5">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-2xl" style={{ background: tone.bg }} aria-hidden>
          {badge}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-black theme-text">{title}</h3>
          <p className="text-xs theme-text-muted">{sub}</p>
        </div>
      </header>
      <dl className="px-5 pb-5">
        {rows.map(([label, value], i) => (
          <div key={label} className={`flex items-center justify-between py-2 ${i !== rows.length - 1 ? 'border-b theme-border' : ''}`}>
            <dt className="text-xs theme-text-muted">{label}</dt>
            <dd className="text-sm font-black theme-text">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

function ChipList({ items }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map(s => (
        <li key={s} className="rounded-full border theme-border px-2.5 py-1 text-[11px] font-bold theme-text-muted theme-bg-subtle">
          {s}
        </li>
      ))}
    </ul>
  )
}

function CombinationCard({ option }) {
  return (
    <article className="overflow-hidden rounded-2xl border theme-border theme-card shadow-elev-md">
      <header className="flex items-center gap-2 border-b theme-border px-4 py-3">
        <span className="text-xl" aria-hidden>{option.emoji}</span>
        <h3 className="text-sm font-black theme-text">{option.title}</h3>
      </header>
      <div className="p-4">
        <h4 className="text-[11px] font-black uppercase tracking-[0.08em]" style={{ color: ZM_GREEN }}>Compulsory subjects</h4>
        <div className="mt-1.5">
          <ChipList items={option.compulsory} />
        </div>
        <h4 className="mt-3 text-[11px] font-black uppercase tracking-[0.08em]" style={{ color: ZM_GOLD }}>Optional — at least one</h4>
        <div className="mt-1.5">
          <ChipList items={option.optional} />
        </div>
      </div>
    </article>
  )
}

export default function Secondary2013Curriculum() {
  return (
    <div>
      <SeoHelmet
        title="2013 Secondary Curriculum (Grades 8–12)"
        description="2013 Zambia Secondary Curriculum — Junior Secondary (Grades 8–9) and Senior Secondary (Grades 10–12), the Academic and Vocational career pathways and their subject combinations."
        path="/teacher/curriculum/2013/secondary"
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
        className="mb-6 overflow-hidden rounded-3xl border theme-border shadow-elev-md"
        style={{ background: `linear-gradient(135deg, #8a5a12 0%, #a4700f 50%, #7a3a1f 100%)` }}
      >
        <div className="px-5 py-6 text-white sm:px-7 sm:py-7">
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
            style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}
          >
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ZM_GOLD }} />
            2013 Framework · Grades 8–12
          </div>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">Zambia Secondary Curriculum (2013)</h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.88)' }}>
            Secondary education runs from Grade 8 to Grade 12 across two career pathways — Academic and
            Vocational — offered in the same institution so learners progress by ability and interest.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.1em]" style={{ color: 'rgba(255,255,255,0.92)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🏫 Grades 8 – 12</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>📘 Academic pathway</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🔧 Vocational pathway</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🎓 TEVETA trade certs</span>
          </div>
        </div>
      </section>

      {/* Two levels */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            Structure · Chapter 4
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Two Levels of Secondary Education</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Junior Secondary builds the base for Senior Secondary; both offer the Academic and
            Vocational career pathways in the same school.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <LevelCard
            tone={{ bg: 'rgba(26, 122, 74, 0.12)' }}
            badge="📘"
            title="Junior Secondary School"
            sub="A two-year course"
            rows={[
              ['Grades', 'Grade 8 → Grade 9'],
              ['Pathways', 'Academic + Vocational'],
              ['Academic periods', '40 minutes each'],
              ['Certificate', 'Junior Secondary School Certificate (ECZ)'],
              ['Vocational award', 'TEVETA Level 3 trade certificate'],
            ]}
          />
          <LevelCard
            tone={{ bg: 'rgba(212, 160, 23, 0.16)' }}
            badge="📗"
            title="Senior Secondary School"
            sub="Grades 10 – 12"
            rows={[
              ['Grades', 'Grade 10 → Grade 12'],
              ['Academic options', 'Social Sciences · Business · Natural Sciences'],
              ['Vocational options', '5 (same as Junior)'],
              ['Final exam', 'School Certificate (ECZ)'],
              ['Vocational award', 'TEVETA Level 2 / Level 1 trade certificate'],
            ]}
          />
        </div>
      </section>

      {/* The two pathways explainer */}
      <section className="mb-7 rounded-3xl p-5 sm:p-6" style={{ background: 'rgba(26, 122, 74, 0.08)' }}>
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            The defining reform
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Academic &amp; Vocational Career Pathways</h2>
          <p className="mx-auto mt-1 max-w-2xl text-sm theme-text-muted">
            The 2013 framework opened two pathways from Grade 8. Each school offers both, so learners
            choose the direction that fits their ambitions — and vocational learners earn nationally
            recognised trade certificates alongside their school certificate.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border theme-border theme-card p-5 shadow-elev-md">
            <div className="flex items-center gap-3"><span className="text-2xl" aria-hidden>📘</span><h3 className="text-base font-black theme-text">Academic Pathway</h3></div>
            <p className="mt-2 text-sm theme-text-muted">For learners with a passion for academic subjects and careers in that direction, leading to the School Certificate and tertiary education.</p>
          </article>
          <article className="rounded-2xl border theme-border theme-card p-5 shadow-elev-md">
            <div className="flex items-center gap-3"><span className="text-2xl" aria-hidden>🔧</span><h3 className="text-base font-black theme-text">Vocational Pathway</h3></div>
            <p className="mt-2 text-sm theme-text-muted">For learners with technical and practical ambitions. A single vocational period runs 120 minutes; learners take up to seven subjects and earn TEVETA trade certificates.</p>
          </article>
        </div>
      </section>

      {/* Junior Secondary — Academic */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            Junior Secondary · Grades 8–9
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Academic Pathway — Subjects</h2>
        </header>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border theme-border theme-card p-5 shadow-elev-md">
            <h3 className="text-[11px] font-black uppercase tracking-[0.08em]" style={{ color: ZM_GREEN }}>Compulsory subjects</h3>
            <div className="mt-2"><ChipList items={JUNIOR_ACADEMIC_COMPULSORY} /></div>
            <h3 className="mt-4 text-[11px] font-black uppercase tracking-[0.08em]" style={{ color: ZM_GOLD }}>Optional foreign languages</h3>
            <div className="mt-2"><ChipList items={JUNIOR_ACADEMIC_OPTIONAL} /></div>
          </article>

          <section className="overflow-hidden rounded-2xl border theme-border theme-card shadow-elev-md">
            <header className="border-b theme-border px-4 py-3" style={{ background: ZM_GREEN, color: '#fff' }}>
              <h3 className="text-sm font-black">🕐 Table 6 · Grades 8–9 · 30 hrs / 46 periods</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {['Subject', 'Time / Week', 'Periods'].map(h => (
                      <th key={h} className="border-b theme-border px-4 py-2 text-left text-[11px] font-black uppercase tracking-[0.06em]"
                        style={{ background: 'rgba(212, 160, 23, 0.16)', color: 'var(--warning-fg)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {JUNIOR_TIMETABLE.map(([subject, time, periods], i) => (
                    <tr key={subject} className={i % 2 === 1 ? 'theme-bg-subtle' : ''}>
                      <td className="border-b theme-border px-4 py-2 theme-text font-bold">{subject}</td>
                      <td className="border-b theme-border px-4 py-2 theme-text whitespace-nowrap">{time}</td>
                      <td className="border-b theme-border px-4 py-2 theme-text">{periods}</td>
                    </tr>
                  ))}
                  <tr style={{ background: 'rgba(212, 160, 23, 0.16)' }}>
                    <td className="px-4 py-2 text-sm font-black" style={{ color: 'var(--warning-fg)' }}>TOTAL</td>
                    <td className="px-4 py-2 text-sm font-black" style={{ color: 'var(--warning-fg)' }}>30 hours</td>
                    <td className="px-4 py-2 text-sm font-black" style={{ color: 'var(--warning-fg)' }}>46</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      {/* Vocational options */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            Junior &amp; Senior Secondary
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Vocational Career Pathway — 5 Options</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Learners choose one option and study it with academic support subjects. Each school offers
            a limited number of options. Successful learners earn TEVETA trade certificates.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VOCATIONAL_OPTIONS.map(o => (
            <article
              key={o.title}
              className="flex flex-col gap-1 rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
              style={{ background: o.bg, color: o.color }}
            >
              <div className="text-2xl" aria-hidden>{o.emoji}</div>
              <h3 className="text-sm font-black">{o.title}</h3>
              <p className="text-xs" style={{ opacity: 0.85 }}>{o.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Senior Secondary — Academic options */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            Senior Secondary · Grades 10–12
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Academic Pathway — 3 Options</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            The Academic pathway specialises into three oriented curricula, each with a set of
            compulsory subjects and at least one optional subject.
          </p>
        </header>
        <div className="grid gap-4 lg:grid-cols-3">
          {SENIOR_ACADEMIC.map(o => (
            <CombinationCard key={o.title} option={o} />
          ))}
        </div>
      </section>

      {/* Senior vocational note */}
      <section className="mb-7 rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
        <h2 className="text-sm font-black theme-text">Senior Secondary — Vocational Pathway</h2>
        <p className="mt-2 text-sm theme-text-muted">
          The Vocational and Technical Career Pathway offers the same five options as Junior Secondary
          (Agriculture, Technology, Home Economics &amp; Hospitality, Performing &amp; Creative Arts, and
          Physical Education &amp; Sports). Learners who study vocational subjects up to Grade 10 and pass
          a level-two trade test are awarded a <span className="font-bold theme-text">TEVETA Level 2</span> trade certificate;
          a <span className="font-bold theme-text">Level 1</span> certificate is awarded to Grade 11 learners who complete the level-one course.
        </p>
      </section>

      <p className="mt-6 text-xs theme-text-muted">
        Source: <span className="font-bold theme-text">{SOURCE_2013}</span>
      </p>
    </div>
  )
}
