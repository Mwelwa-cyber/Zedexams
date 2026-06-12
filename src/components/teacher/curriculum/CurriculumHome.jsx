import { Link } from 'react-router-dom'
import { BookOpen, GraduationCap, ArrowRight } from '../../ui/icons'
import Icon from '../../ui/Icon'
import SeoHelmet from '../../seo/SeoHelmet'

const ZAMBIA_GREEN = '#1a7a4a'
const ZAMBIA_GOLD = '#d4a017'
const ZAMBIA_RED = '#c0392b'

const LEVELS = [
  {
    to: '/teacher/curriculum/primary',
    icon: BookOpen,
    title: 'Primary',
    range: 'Grades 1 – 6',
    sub: 'Lower Primary (G1–3) + Upper Primary (G4–6)',
    bullets: [
      '3 broad learning areas at Lower Primary',
      '8 subjects (7 taken) at Upper Primary',
      'Per-grade scope, timetables, assessment',
    ],
    tint: ZAMBIA_GREEN,
  },
  {
    to: '/teacher/curriculum/secondary',
    icon: GraduationCap,
    title: 'Secondary',
    range: 'Forms 1 – 6',
    sub: 'Ordinary Level (4 yrs) + Advanced Level (2 yrs)',
    bullets: [
      '8 O-Level specialisation pathways',
      '25 subjects offered at A-Level',
      '10 key reforms in the 2023 framework',
    ],
    tint: ZAMBIA_GOLD,
  },
]

export default function CurriculumHome() {
  return (
    <div>
      <SeoHelmet
        title="Zambia Curriculum Reference"
        description="Browse the 2023 Zambia National School Curriculum — primary and secondary structure, subjects, pathways and assessment."
        path="/teacher/curriculum"
        noIndex
      />

      {/* Hero */}
      <section
        className="mb-6 overflow-hidden rounded-3xl border theme-border shadow-elev-md"
        style={{
          background: `linear-gradient(135deg, ${ZAMBIA_GREEN} 0%, #166e42 55%, #134f31 100%)`,
        }}
      >
        <div className="px-5 py-6 text-white sm:px-8 sm:py-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
               style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}>
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ZAMBIA_GOLD }} />
            <span>2023 Approved National Curriculum</span>
          </div>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">
            Zambia Curriculum Reference
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.85)' }}>
            A fast, browsable summary of the 2023 framework — structure, subjects, timetables,
            pathways and assessment. Use this alongside the official syllabi for quick lookups
            while you plan lessons.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.9)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>Grades 1 – 6</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>Forms 1 – 6</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>8 O-Level pathways</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>5 A-Level pathways</span>
          </div>
        </div>
      </section>

      {/* Level cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {LEVELS.map(level => (
          <Link
            key={level.to}
            to={level.to}
            className="group block rounded-3xl border theme-border theme-card p-5 shadow-elev-md no-underline transition-transform duration-fast hover:-translate-y-0.5 hover:theme-card-hover sm:p-6"
          >
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-elev-inner-hl"
                style={{ background: level.tint }}
                aria-hidden
              >
                <Icon as={level.icon} size="md" strokeWidth={2.1} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black uppercase tracking-[0.14em] theme-text-muted">
                  {level.range}
                </div>
                <h2 className="mt-0.5 text-xl font-black theme-text">
                  {level.title}
                </h2>
                <p className="mt-1 text-sm theme-text-muted">{level.sub}</p>
              </div>
              <Icon as={ArrowRight} size="sm" className="theme-text-muted transition-transform group-hover:translate-x-1" />
            </div>
            <ul className="mt-4 space-y-1.5 text-sm theme-text">
              {level.bullets.map(b => (
                <li key={b} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: level.tint }}
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </div>

      {/* Footer attribution */}
      <p className="mt-6 text-xs theme-text-muted">
        Source:{' '}
        <span className="font-bold theme-text">
          2023 Approved National School Curriculum Framework
        </span>
        {' · '}
        Curriculum Development Centre, Ministry of Education, Republic of Zambia.
      </p>

      {/* Visible Zambia accent strip (flag colours) */}
      <div className="mt-3 flex h-1 overflow-hidden rounded-full" aria-hidden>
        <span className="flex-1" style={{ background: ZAMBIA_GREEN }} />
        <span className="flex-1" style={{ background: ZAMBIA_RED }} />
        <span className="flex-1" style={{ background: '#1a1a1a' }} />
        <span className="flex-1" style={{ background: ZAMBIA_GOLD }} />
      </div>
    </div>
  )
}
