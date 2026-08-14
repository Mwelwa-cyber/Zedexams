import { Link } from 'react-router-dom'
import { BookOpen, GraduationCap, PuzzlePieceIcon, ArrowRight, Sparkles, Lightbulb, Globe, ShieldCheck, Layers } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import {
  GENERAL_COMPETENCES,
  LANGUAGE_OF_INSTRUCTION,
  NATIONAL_VALUES,
  CROSS_CUTTING_THEMES,
  GUIDING_PRINCIPLES,
  KEY_INSTRUMENTS,
  OTHER_LEVELS,
} from '../lib/frameworkData'

const ZAMBIA_GREEN = '#1a7a4a'
const ZAMBIA_GOLD = '#d4a017'
const ZAMBIA_RED = '#c0392b'
// Ink for anything painted ON the gold fill. White measured 2.39:1 on
// #d4a017 in every theme; a near-black keeps the flag gold and clears 7:1.
const INK_ON_GOLD = '#1C1705'
// The flag green used AS text. As a fixed hex it measured 2.59:1 on the
// Night card; the semantic token keeps the hue family and flips per theme.
const GREEN_INK = 'var(--success-fg)'

const LEVELS = [
  {
    to: '/teacher/curriculum/ece',
    icon: PuzzlePieceIcon,
    title: 'Early Childhood',
    range: 'Ages 0 – 5',
    sub: 'Day-Care (0–3) + Nursery (3–4) + Reception (4–5)',
    bullets: [
      '3 learning areas, aligned with Primary',
      'Thematic, play-based across 5 developmental domains',
      '15 hours / 30 periods per week',
    ],
    tint: ZAMBIA_RED,
  },
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
        description="Browse the 2023 Zambia National School Curriculum — early childhood, primary and secondary structure, subjects, pathways and assessment."
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
            pathways and assessment, from Early Childhood through Secondary. Use this alongside
            the official syllabi for quick lookups while you plan lessons.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.9)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>Ages 0 – 5</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>Grades 1 – 6</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>Forms 1 – 6</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>8 O-Level pathways</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>5 A-Level pathways</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>12 general competences</span>
          </div>
        </div>
      </section>

      {/* Switcher to the previous (2013) curriculum — some grades still use it */}
      <Link
        to="/teacher/curriculum/2013"
        className="mb-4 flex items-center gap-3 rounded-2xl border theme-border theme-card p-4 shadow-elev-md no-underline transition hover:theme-card-hover"
      >
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: ZAMBIA_GOLD, color: INK_ON_GOLD }}
          aria-hidden
        >
          <Icon as={BookOpen} size="sm" strokeWidth={2.1} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black theme-text">
            Teaching a grade still on the previous curriculum?
          </span>
          <span className="block text-xs theme-text-muted">
            View the 2013 Zambia Education Curriculum Framework — structure, learning areas and career pathways.
          </span>
        </span>
        <Icon as={ArrowRight} size="sm" className="theme-text-muted" />
      </Link>

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

      {/* ── The rest of the education system (Tertiary · YALE) ── */}
      <section className="mt-8">
        <header className="mb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: GREEN_INK }}>
            <Icon as={Layers} size="xs" strokeWidth={2.2} />
            The whole system
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Other Levels in the Framework</h2>
          <p className="mt-1 max-w-3xl text-sm theme-text-muted">
            ZedExams covers Early Childhood, Primary and Secondary, but the 2023 framework spans the
            full education system. Here is how schooling connects to what comes after.
          </p>
        </header>
        <div className="grid gap-4 lg:grid-cols-2">
          {OTHER_LEVELS.filter(level => !level.title.includes('Early Childhood')).map(level => (
            <article key={level.title} className="flex flex-col rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>{level.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black theme-text">{level.title}</h3>
                  </div>
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

      {/* ── Framework Foundations (apply across every grade & subject) ── */}
      <section className="mt-8">
        <header className="mb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: GREEN_INK }}>
            <Icon as={Sparkles} size="xs" strokeWidth={2.2} />
            Foundations
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">The Competence-Based Curriculum</h2>
          <p className="mt-1 max-w-3xl text-sm theme-text-muted">
            In 2023 Zambia moved from an Outcome-Based to a <strong className="theme-text">Competence-Based
            Curriculum (CBC)</strong>. Teaching now centres on what learners can <em>do</em> — demonstrating
            competences — rather than only what they know. These foundations apply at every level and in every
            subject, so plan your lessons towards them whatever grade you teach.
          </p>
        </header>

        {/* 12 General Competences (Table 1) */}
        <div className="overflow-hidden rounded-3xl border theme-border theme-card shadow-elev-md">
          <header className="flex items-center gap-2 border-b theme-border px-4 py-3" style={{ background: ZAMBIA_GREEN, color: '#fff' }}>
            <Icon as={Lightbulb} size="sm" strokeWidth={2.1} />
            <h3 className="text-sm font-black">The 12 General Competences</h3>
            <span className="ml-auto text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>Table 1 · §2.3.1</span>
          </header>
          <div className="grid grid-cols-1 gap-px theme-bg-subtle sm:grid-cols-2 lg:grid-cols-3">
            {GENERAL_COMPETENCES.map(([emoji, name, def]) => (
              <div key={name} className="theme-card p-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>{emoji}</span>
                  <h4 className="text-sm font-black theme-text">{name}</h4>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed theme-text-muted">{def}</p>
              </div>
            ))}
          </div>
          <p className="border-t theme-border px-4 py-2.5 text-xs theme-text-muted">
            Each subject syllabus breaks these general competences down into specific, examinable competences.
          </p>
        </div>

        {/* Language of Instruction + National Values */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: ZAMBIA_GREEN }} aria-hidden>
                <Icon as={Globe} size="sm" strokeWidth={2.1} />
              </span>
              <div>
                <h3 className="text-sm font-black theme-text">Language of Instruction</h3>
                <p className="text-[11px] font-bold theme-text-muted uppercase tracking-[0.08em]">§2.3.2</p>
              </div>
            </div>
            <ul className="mt-3 space-y-2 text-sm theme-text">
              {LANGUAGE_OF_INSTRUCTION.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: ZAMBIA_GREEN }} />
                  <span className="leading-relaxed">{line}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: ZAMBIA_GOLD, color: INK_ON_GOLD }} aria-hidden>
                <Icon as={ShieldCheck} size="sm" strokeWidth={2.1} />
              </span>
              <div>
                <h3 className="text-sm font-black theme-text">National Values &amp; Principles</h3>
                <p className="text-[11px] font-bold theme-text-muted uppercase tracking-[0.08em]">Article 8 · §3.6</p>
              </div>
            </div>
            <p className="mt-2 text-xs theme-text-muted">
              Integrated across all subjects as a cross-cutting theme — especially through Social Studies and
              Civic Education.
            </p>
            <ol className="mt-3 grid gap-1.5 text-sm theme-text sm:grid-cols-2">
              {NATIONAL_VALUES.map((v, i) => (
                <li key={v} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                    style={{ background: ZAMBIA_GOLD, color: INK_ON_GOLD }}
                  >
                    {i + 1}
                  </span>
                  <span className="leading-snug">{v}</span>
                </li>
              ))}
            </ol>
          </article>
        </div>

        {/* 18 Cross-Cutting Themes */}
        <div className="mt-4 overflow-hidden rounded-3xl border theme-border theme-card shadow-elev-md">
          <header className="flex items-center gap-2 border-b theme-border px-4 py-3" style={{ background: '#0e2a32', color: '#fff' }}>
            <h3 className="text-sm font-black">The 18 Cross-Cutting Themes (National Concerns)</h3>
            <span className="ml-auto text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.8)' }}>Chapter 3</span>
          </header>
          <p className="px-4 pt-3 text-xs theme-text-muted">
            National concerns that must be integrated across the curriculum at every level — not taught as
            stand-alone subjects. The Primary page also maps each theme to the subjects it lands in.
          </p>
          <div className="grid grid-cols-1 gap-px theme-bg-subtle p-px sm:grid-cols-2">
            {CROSS_CUTTING_THEMES.map(([name, def], i) => (
              <div key={name} className="theme-card p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-black" style={{ color: ZAMBIA_GOLD }}>{i + 1}</span>
                  <h4 className="text-xs font-black theme-text">{name}</h4>
                </div>
                <p className="mt-1 text-xs leading-relaxed theme-text-muted">{def}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Guiding Principles + Key Instruments */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
            <h3 className="text-sm font-black theme-text">Education Guiding Principles</h3>
            <p className="text-[11px] font-bold theme-text-muted uppercase tracking-[0.08em]">§2.2</p>
            <ul className="mt-3 space-y-2.5">
              {GUIDING_PRINCIPLES.map(([name, def]) => (
                <li key={name} className="text-sm theme-text">
                  <span className="font-black" style={{ color: GREEN_INK }}>{name}.</span>{' '}
                  <span className="theme-text-muted">{def}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
            <h3 className="text-sm font-black theme-text">What the Framework Is Built On</h3>
            <p className="text-[11px] font-bold theme-text-muted uppercase tracking-[0.08em]">Key instruments · §2.1</p>
            <div className="mt-3 space-y-3">
              {Object.entries(KEY_INSTRUMENTS).map(([group, items]) => (
                <div key={group}>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.06em]" style={{ color: ZAMBIA_GOLD }}>{group}</h4>
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
      </section>

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
