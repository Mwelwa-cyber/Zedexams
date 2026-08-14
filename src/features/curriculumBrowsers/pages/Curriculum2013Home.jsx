import { Link } from 'react-router-dom'
import { BookOpen, GraduationCap, PuzzlePieceIcon, ArrowRight, ArrowLeft, Sparkles, Lightbulb, Globe, ShieldCheck, Layers } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import {
  ZM_GREEN,
  ZM_GOLD,
  ZM_RED,
  SOURCE_2013,
  STRUCTURE_2013,
  CAREER_PATHWAYS_2013,
  FOCUS_AREAS_2013,
  GUIDING_PRINCIPLES_2013,
  NATIONAL_CONCERNS_2013,
  KEY_INSTRUMENTS_2013,
  OTHER_LEVELS_2013,
} from '../lib/frameworkData2013'

const LEVELS = [
  {
    to: '/teacher/curriculum/2013/ece',
    icon: PuzzlePieceIcon,
    title: 'Early Childhood',
    range: 'Ages 0 – 6',
    sub: 'Day-Care (0–2) + Nursery (3–4) + Reception (5–6)',
    bullets: [
      '5 early-education learning areas',
      'Play-based, in a familiar Zambian Language',
      '15 hours / week (Table 2)',
    ],
    tint: ZM_RED,
  },
  {
    to: '/teacher/curriculum/2013/primary',
    icon: BookOpen,
    title: 'Primary',
    range: 'Grades 1 – 7',
    sub: 'Lower Primary (G1–4) + Upper Primary (G5–7)',
    bullets: [
      '5 core learning areas at Lower Primary',
      '7 core learning areas at Upper Primary',
      'Per-grade timetables & contact time',
    ],
    tint: ZM_GREEN,
  },
  {
    to: '/teacher/curriculum/2013/secondary',
    icon: GraduationCap,
    title: 'Secondary',
    range: 'Grades 8 – 12',
    sub: 'Junior Secondary (G8–9) + Senior Secondary (G10–12)',
    bullets: [
      'Two career pathways: Academic + Vocational',
      '3 academic options at Senior Secondary',
      '5 vocational options → TEVETA trade certs',
    ],
    tint: ZM_GOLD,
  },
]

export default function Curriculum2013Home() {
  return (
    <div>
      <SeoHelmet
        title="2013 Curriculum Reference (Previous)"
        description="Browse the 2013 Zambia Education Curriculum Framework — the previous national curriculum still used by some grades: early childhood, primary and secondary structure, learning areas and the Academic/Vocational career pathways."
        path="/teacher/curriculum/2013"
        noIndex
      />

      {/* Back to the current-curriculum reference */}
      <Link
        to="/teacher/curriculum"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.08em] theme-text-muted no-underline hover:theme-text"
      >
        <Icon as={ArrowLeft} size="xs" strokeWidth={2.2} />
        Current (2023) curriculum
      </Link>

      {/* Hero — a warmer gold/red wash marks this as the previous curriculum */}
      <section
        className="mb-6 overflow-hidden rounded-3xl border theme-border shadow-elev-md"
        style={{
          background: `linear-gradient(135deg, #8a5a12 0%, #a4700f 50%, #7a3a1f 100%)`,
        }}
      >
        <div className="px-5 py-6 text-white sm:px-8 sm:py-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
               style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}>
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ZM_GOLD }} />
            <span>Previous Curriculum · 2013 Framework</span>
          </div>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">
            Zambia Curriculum Framework 2013
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.88)' }}>
            The previous national curriculum — still followed by some grades. This is a fast,
            browsable summary of its structure, learning areas and the Academic and Vocational
            career pathways it introduced, from Early Childhood through Secondary.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.92)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>Ages 0 – 6</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>Grades 1 – 12</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>2 Career Pathways</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>12 National Concerns</span>
          </div>

          {/* Switcher back to the current curriculum */}
          <Link
            to="/teacher/curriculum"
            className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.08em] no-underline transition"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
          >
            <Icon as={ArrowRight} size="xs" strokeWidth={2.2} />
            Switch to the current 2023 curriculum
          </Link>
        </div>
      </section>

      {/* Level cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      {/* ── The defining reform: two career pathways ── */}
      <section className="mt-8">
        <header className="mb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GOLD }}>
            <Icon as={Sparkles} size="xs" strokeWidth={2.2} />
            The defining reform
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Two Career Pathways at Secondary</h2>
          <p className="mt-1 max-w-3xl text-sm theme-text-muted">
            The biggest change the 2013 framework introduced was opening two career pathways from
            Grade 8, so learners progress according to their abilities and interests.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          {CAREER_PATHWAYS_2013.map(p => (
            <article key={p.title} className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>{p.emoji}</span>
                <h3 className="text-base font-black theme-text">{p.title}</h3>
              </div>
              <p className="mt-2 text-sm theme-text-muted">{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Education structure ── */}
      <section className="mt-8">
        <header className="mb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            <Icon as={Layers} size="xs" strokeWidth={2.2} />
            The whole system
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Structure of the Education System</h2>
          <p className="mt-1 max-w-3xl text-sm theme-text-muted">
            The 2013 framework spans Early Childhood to Tertiary, with Adult Literacy for those who
            missed formal schooling.
          </p>
        </header>
        <div className="overflow-hidden rounded-3xl border theme-border theme-card shadow-elev-md">
          <dl>
            {STRUCTURE_2013.map(([level, detail], i) => (
              <div
                key={level}
                className={`flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 ${
                  i !== STRUCTURE_2013.length - 1 ? 'border-b theme-border' : ''
                }`}
              >
                <dt className="w-full max-w-xs text-sm font-black theme-text">{level}</dt>
                <dd className="text-sm theme-text-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Other levels (Teacher Education · TEVET · Adult Literacy) ── */}
      <section className="mt-8">
        <header className="mb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            <Icon as={Globe} size="xs" strokeWidth={2.2} />
            Beyond school
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Other Levels in the Framework</h2>
        </header>
        <div className="grid gap-4 lg:grid-cols-3">
          {OTHER_LEVELS_2013.map(level => (
            <article key={level.title} className="flex flex-col rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>{level.emoji}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-black theme-text">{level.title}</h3>
                  <p className="text-[11px] font-bold theme-text-muted uppercase tracking-[0.08em]">
                    {level.range} · {level.section}
                  </p>
                </div>
              </div>
              <dl className="mt-3 space-y-2">
                {level.facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] font-black uppercase tracking-[0.06em] theme-text-muted">{label}</dt>
                    <dd className="text-sm theme-text">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t theme-border pt-3 text-xs leading-relaxed theme-text-muted">
                {level.notes}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Framework Foundations ── */}
      <section className="mt-8">
        <header className="mb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            <Icon as={Sparkles} size="xs" strokeWidth={2.2} />
            Foundations
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">What the 2013 Curriculum Set Out to Do</h2>
          <p className="mt-1 max-w-3xl text-sm theme-text-muted">
            The framework integrated related subjects into learning areas, spelt out key competences
            per level, and wove national concerns across the curriculum.
          </p>
        </header>

        {/* Focus areas */}
        <div className="overflow-hidden rounded-3xl border theme-border theme-card shadow-elev-md">
          <header className="flex items-center gap-2 border-b theme-border px-4 py-3" style={{ background: ZM_GREEN, color: '#fff' }}>
            <Icon as={Lightbulb} size="sm" strokeWidth={2.1} />
            <h3 className="text-sm font-black">Focus of the New Curriculum</h3>
            <span className="ml-auto text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>Chapter 2</span>
          </header>
          <div className="grid grid-cols-1 gap-px theme-bg-subtle sm:grid-cols-2">
            {FOCUS_AREAS_2013.map(([name, def]) => (
              <div key={name} className="theme-card p-4">
                <h4 className="text-sm font-black theme-text">{name}</h4>
                <p className="mt-1.5 text-xs leading-relaxed theme-text-muted">{def}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Guiding principles + key instruments */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: ZM_GREEN }} aria-hidden>
                <Icon as={ShieldCheck} size="sm" strokeWidth={2.1} />
              </span>
              <div>
                <h3 className="text-sm font-black theme-text">Education Guiding Principles</h3>
                <p className="text-[11px] font-bold theme-text-muted uppercase tracking-[0.08em]">Education Act, 2011 · Chapter 2</p>
              </div>
            </div>
            <ul className="mt-3 space-y-2.5">
              {GUIDING_PRINCIPLES_2013.map(([name, def]) => (
                <li key={name} className="text-sm theme-text">
                  <span className="font-black" style={{ color: ZM_GREEN }}>{name}.</span>{' '}
                  <span className="theme-text-muted">{def}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
            <h3 className="text-sm font-black theme-text">What the Framework Is Built On</h3>
            <p className="text-[11px] font-bold theme-text-muted uppercase tracking-[0.08em]">Key instruments · Chapter 2</p>
            <div className="mt-3 space-y-3">
              {Object.entries(KEY_INSTRUMENTS_2013).map(([group, items]) => (
                <div key={group}>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.06em]" style={{ color: ZM_GOLD }}>{group}</h4>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {items.map(item => (
                      <li
                        key={item}
                        className="rounded-full border theme-border px-2.5 py-1 text-[11px] font-bold theme-text-muted theme-bg-subtle"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </article>
        </div>

        {/* National concerns */}
        <div className="mt-4 overflow-hidden rounded-3xl border theme-border theme-card shadow-elev-md">
          <header className="flex items-center gap-2 border-b theme-border px-4 py-3" style={{ background: '#0e2a32', color: '#fff' }}>
            <h3 className="text-sm font-black">National Concerns (Cross-Cutting Themes)</h3>
            <span className="ml-auto text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.8)' }}>Chapter 3</span>
          </header>
          <p className="px-4 pt-3 text-xs theme-text-muted">
            Emerging challenges integrated across the curriculum at every level — not taught as
            stand-alone subjects.
          </p>
          <div className="grid grid-cols-1 gap-px theme-bg-subtle p-px sm:grid-cols-2">
            {NATIONAL_CONCERNS_2013.map(([name, def], i) => (
              <div key={name} className="theme-card p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-black" style={{ color: ZM_GOLD }}>{i + 1}</span>
                  <h4 className="text-xs font-black theme-text">{name}</h4>
                </div>
                <p className="mt-1 text-xs leading-relaxed theme-text-muted">{def}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer attribution */}
      <p className="mt-6 text-xs theme-text-muted">
        Source: <span className="font-bold theme-text">{SOURCE_2013}</span>
      </p>

      {/* Zambia flag accent strip */}
      <div className="mt-3 flex h-1 overflow-hidden rounded-full" aria-hidden>
        <span className="flex-1" style={{ background: ZM_GREEN }} />
        <span className="flex-1" style={{ background: ZM_RED }} />
        <span className="flex-1" style={{ background: '#1a1a1a' }} />
        <span className="flex-1" style={{ background: ZM_GOLD }} />
      </div>
    </div>
  )
}
