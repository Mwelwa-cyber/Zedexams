import { Link } from 'react-router-dom'
import { ArrowLeft } from '../../ui/icons'
import Icon from '../../ui/Icon'
import SeoHelmet from '../../seo/SeoHelmet'
import { LANGUAGE_OF_INSTRUCTION, NATIONAL_VALUES, CROSS_CUTTING_THEMES } from './frameworkData'

const ZAMBIA_GREEN = '#1a7a4a'
const ZAMBIA_GOLD = '#d4a017'

/**
 * The three sub-levels of Early Childhood Education (§4.1). Day-Care, Nursery
 * and Reception together cover ages 0–5 before a child enters Grade 1.
 */
const STAGES = [
  { emoji: '🍼', title: 'Day-Care', age: 'Ages 0 – 3', focus: 'Care, stimulation and safe routines that nurture early physical and social-emotional growth.' },
  { emoji: '🧸', title: 'Nursery',  age: 'Ages 3 – 4', focus: 'Guided play that builds language, curiosity and the first pre-literacy and pre-number skills.' },
  { emoji: '✏️', title: 'Reception', age: 'Ages 4 – 5', focus: 'School-readiness — extending pre-literacy, pre-mathematics and creativity ahead of Grade 1.' },
]

/**
 * The three ECE learning areas. Cut from five to three in the 2023 framework to
 * align with Primary, with Expressive Arts folded into Creative & Technology
 * Studies (CTS).
 */
const LEARNING_AREAS = [
  { emoji: '📖', title: 'Pre-Literacy & Language', body: 'Listening, speaking, early reading and mark-making — building communication and a love of stories in English and a Zambian Language.', bg: '#e8f5ee', color: 'var(--success-fg)' },
  { emoji: '🔢', title: 'Pre-Mathematics and Science', body: 'Counting, sorting, patterns, shapes and exploring the natural world through hands-on discovery.', bg: '#e8f0ff', color: 'var(--info-fg)' },
  { emoji: '🎨', title: 'Creative & Technology Studies (CTS)', body: 'Art, music, movement, play and simple making — replaces the old Expressive Arts area and aligns with Primary CTS.', bg: '#fff3e8', color: '#8c4a00' },
]

/**
 * Five developmental domains that the thematic, play-based approach develops in
 * an integrated way (§4.1).
 */
const DOMAINS = [
  ['🏃', 'Physical', 'Gross and fine motor skills, coordination, health and self-care.'],
  ['🧠', 'Cognitive', 'Curiosity, problem-solving, memory and early reasoning.'],
  ['💬', 'Language', 'Listening, speaking, vocabulary and the foundations of literacy.'],
  ['❤️', 'Social-Emotional', 'Self-regulation, relationships, sharing and confidence.'],
  ['✨', 'Aesthetic', 'Creativity, imagination and appreciation of art, music and beauty.'],
]

const PEDAGOGY = [
  { emoji: '🧩', title: 'Play-Based', body: 'Learning is delivered through structured and free play rather than formal lessons — play is the primary vehicle for development at this age.' },
  { emoji: '🗂️', title: 'Thematic', body: 'Activities are organised around themes (e.g. “My Family”, “Water”, “Animals”) so the learning areas connect naturally for the child.' },
  { emoji: '🌍', title: 'Mother-Tongue Friendly', body: 'Code-switching to a community Zambian Language is encouraged to ease the transition into English as the medium of instruction.' },
  { emoji: '👀', title: 'Observation-Led', body: 'Practitioners observe and record each child’s progress, using continuous, play-embedded assessment rather than written tests.' },
]

export default function ECECurriculum() {
  return (
    <div>
      <SeoHelmet
        title="Early Childhood Education (Ages 0–5)"
        description="2023 Zambia Early Childhood Education curriculum — Day-Care, Nursery and Reception stages, the three learning areas, developmental domains and play-based assessment."
        path="/teacher/curriculum/ece"
        noIndex
      />

      {/* Back link */}
      <Link
        to="/teacher/curriculum"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.08em] theme-text-muted no-underline hover:theme-text"
      >
        <Icon as={ArrowLeft} size="xs" strokeWidth={2.2} />
        Curriculum
      </Link>

      {/* Hero */}
      <section
        className="mb-6 overflow-hidden rounded-3xl border theme-border shadow-elev-md"
        style={{ background: `linear-gradient(135deg, ${ZAMBIA_GREEN} 0%, #166e42 55%, #0f4d31 100%)` }}
      >
        <div className="px-5 py-6 text-white sm:px-7 sm:py-7">
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
            style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}
          >
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ZAMBIA_GOLD }} />
            Republic of Zambia · Ministry of Education
          </div>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">
            2023 National School Curriculum<br />
            <span className="text-xl sm:text-2xl">Early Childhood Education</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.88)' }}>
            The foundation stage of the framework — thematic, play-based learning for the
            youngest learners, building the competences they carry into Grade 1.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.1em]" style={{ color: 'rgba(255,255,255,0.92)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🧸 Ages 0 – 5</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🏫 3 Stages</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>📚 3 Learning Areas</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>⏱️ 15 hrs / week</span>
          </div>
        </div>
      </section>

      {/* Three stages */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Structure · §4.1
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Three Stages Before Grade 1</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Early Childhood Education runs from birth to age five across three stages, each building
            on the last towards school-readiness.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-3">
          {STAGES.map(s => (
            <article key={s.title} className="rounded-3xl border theme-border theme-card p-5 shadow-elev-md">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-2xl"
                  style={{ background: 'rgba(26, 122, 74, 0.12)' }}
                  aria-hidden
                >
                  {s.emoji}
                </div>
                <div>
                  <h3 className="text-base font-black theme-text">{s.title}</h3>
                  <p className="text-[11px] font-black uppercase tracking-[0.08em] theme-text-muted">{s.age}</p>
                </div>
              </div>
              <p className="mt-3 text-sm theme-text-muted">{s.focus}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Learning areas */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            What is taught
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">3 Learning Areas</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            The 2023 framework cut ECE from five learning areas to three to align with Primary —
            Expressive Arts was replaced by Creative &amp; Technology Studies.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-3">
          {LEARNING_AREAS.map(a => (
            <article
              key={a.title}
              className="flex flex-col gap-1 rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
              style={{ background: a.bg, color: a.color }}
            >
              <div className="text-2xl" aria-hidden>{a.emoji}</div>
              <h3 className="text-sm font-black">{a.title}</h3>
              <p className="text-xs" style={{ opacity: 0.85 }}>{a.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Developmental domains */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            How children grow
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">5 Developmental Domains</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Play and themes are designed to develop the whole child across five interconnected domains.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {DOMAINS.map(([emoji, name, def]) => (
            <article key={name} className="rounded-2xl border theme-border theme-card p-4 text-center shadow-elev-md">
              <div className="text-2xl" aria-hidden>{emoji}</div>
              <h3 className="mt-1 text-sm font-black theme-text">{name}</h3>
              <p className="mt-1 text-xs theme-text-muted">{def}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Pedagogy + contact time */}
      <section className="mb-7 rounded-3xl p-5 sm:p-6" style={{ background: 'rgba(26, 122, 74, 0.08)' }}>
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            How it is taught
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">A Play-Based, Thematic Approach</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            ECE is delivered through <strong className="theme-text">15 hours / 30 periods per week</strong> of
            structured and free play — never formal, exam-style lessons.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PEDAGOGY.map(c => (
            <article key={c.title} className="rounded-2xl border theme-border theme-card p-5 shadow-elev-md">
              <div className="text-2xl" aria-hidden>{c.emoji}</div>
              <h3 className="mt-2 text-sm font-black theme-text">{c.title}</h3>
              <p className="mt-1 text-xs theme-text-muted">{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Language of instruction */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            §2.3.2
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Language of Instruction</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            English is the official medium from ECE onwards, with a Zambian Language used to explain
            concepts and ease the transition for the youngest learners.
          </p>
        </header>
        <ul className="mx-auto grid max-w-3xl gap-2">
          {LANGUAGE_OF_INSTRUCTION.map((line, i) => (
            <li key={i} className="flex items-start gap-2 rounded-2xl border theme-border theme-card p-4 text-sm theme-text shadow-elev-md">
              <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: ZAMBIA_GREEN }} />
              <span className="leading-relaxed">{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* National values */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Article 8 · §3.6
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">National Values &amp; Principles</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Seeded from the earliest years through play, routines and storytelling, then carried
            forward into Primary and Secondary.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NATIONAL_VALUES.map((value, i) => (
            <article key={value} className="flex items-start gap-3 rounded-2xl border theme-border theme-card p-4 shadow-elev-md">
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                style={{ background: ZAMBIA_GOLD }}
                aria-hidden
              >
                {i + 1}
              </span>
              <p className="text-sm font-bold theme-text">{value}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Cross-cutting themes */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Chapter 3
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">18 Cross-Cutting Themes</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            National concerns woven through ECE in age-appropriate ways — through health routines,
            play and stories rather than stand-alone subjects.
          </p>
        </header>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CROSS_CUTTING_THEMES.map(([name, def], i) => (
            <article key={name} className="rounded-2xl border theme-border theme-card p-3.5 shadow-elev-md">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-black" style={{ color: ZAMBIA_GOLD }}>{i + 1}</span>
                <h3 className="text-xs font-black theme-text">{name}</h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed theme-text-muted">{def}</p>
            </article>
          ))}
        </div>
      </section>

      <p className="mt-6 text-xs theme-text-muted">
        Source: <span className="font-bold theme-text">2023 Zambia Education Curriculum Framework</span>{' · '}
        Ministry of Education, Republic of Zambia · Curriculum Development Centre, Haile Selassie Ave, Lusaka.
      </p>
    </div>
  )
}
