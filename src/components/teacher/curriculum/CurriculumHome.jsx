import { Link } from 'react-router-dom'
import { BookOpen, GraduationCap, ArrowRight, Sparkles, Lightbulb, Globe, ShieldCheck } from '../../ui/icons'
import Icon from '../../ui/Icon'
import SeoHelmet from '../../seo/SeoHelmet'

const ZAMBIA_GREEN = '#1a7a4a'
const ZAMBIA_GOLD = '#d4a017'
const ZAMBIA_RED = '#c0392b'

/**
 * Table 1 — General Competences and Definition (2023 ZECF, §2.3.1).
 * The cross-curricular heart of the Competence-Based Curriculum: every
 * subject syllabus breaks these down into subject-specific competences, so
 * teachers plan towards them in every lesson regardless of grade or subject.
 */
const GENERAL_COMPETENCES = [
  ['🧩', 'Analytical Thinking', 'Breaking down complex information into its components and understanding how they are interconnected.'],
  ['🤝', 'Collaboration', 'Working with others to achieve results as a team.'],
  ['💬', 'Communication', 'Sharing ideas, thoughts, information and messages concisely and precisely.'],
  ['💡', 'Creativity & Innovation', 'Creating new ideas and products by applying processes and introducing new techniques that add value.'],
  ['🔎', 'Critical Thinking', 'Conceptualising, applying, analysing, synthesising and evaluating information to form a judgement or guide a belief or action.'],
  ['🏛️', 'Citizenship', 'Acting as a responsible citizen and participating fully in civic and social life, grounded in social, cultural, economic, legal and political principles, global trends and sustainability.'],
  ['💻', 'Digital Literacy', 'Using a broad range of ICTs — such as a phone, computer or calculator — in specific contexts.'],
  ['❤️', 'Emotional Intelligence', "Recognising one's own emotions and those of others, and using that to manage oneself and one's relationships in different situations."],
  ['🚀', 'Entrepreneurship', 'The knowledge, skills and behaviour needed to identify, create, develop, manage and grow a business venture.'],
  ['🌳', 'Environmental Sustainability', 'Appropriate and sustainable use of natural resources and preservation of the environment.'],
  ['💰', 'Financial Literacy', 'Applying knowledge of key financial concepts, products and services to financial management.'],
  ['🧠', 'Problem Solving', 'Identifying, analysing and finding solutions to challenging situations.'],
]

/** Language of Instruction policy (2023 ZECF, §2.3.2 + reforms in §4.2). */
const LANGUAGE_OF_INSTRUCTION = [
  'The Education Act of 2011 prescribes English as the official Language of Instruction from Early Childhood Education (ECE) through to Tertiary, building one continuous learning foundation.',
  'A Zambian Language may be used to explain concepts, while English stays the medium across the curriculum — except when a Zambian or foreign language is itself the subject being taught.',
  'At Lower Primary (Grades 1–3), code-switching to a community Zambian Language is encouraged to ease transition, supported by the Early Grade Literacy Programme (EGLP) in both English and a Zambian Language.',
  'Sign Language is the medium of instruction for learners with hearing impairment at all levels; Braille materials support learners with visual impairment.',
]

/** National Values & Principles — Article 8 of the Constitution (2023 ZECF, §3.6). */
const NATIONAL_VALUES = [
  'Morality and Ethics',
  'Patriotism and National Unity',
  'Democracy and Constitutionalism',
  'Good Governance and Integrity',
  'Human Dignity, Equity, Social Justice, Equality and Non-Discrimination',
  'Sustainable Development',
]

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
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>12 general competences</span>
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

      {/* ── Framework Foundations (apply across every grade & subject) ── */}
      <section className="mt-8">
        <header className="mb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
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
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: ZAMBIA_GOLD }} aria-hidden>
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
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
                    style={{ background: ZAMBIA_GOLD }}
                  >
                    {i + 1}
                  </span>
                  <span className="leading-snug">{v}</span>
                </li>
              ))}
            </ol>
          </article>
        </div>

        <p className="mt-3 text-xs theme-text-muted">
          The Primary page lists all <strong className="theme-text">18 cross-cutting themes</strong> (national
          concerns) and where they show up in each subject.
        </p>
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
