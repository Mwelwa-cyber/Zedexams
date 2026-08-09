import { Link } from 'react-router-dom'
import { ArrowLeft } from '../../../components/ui/icons'
import Icon from '../../../components/ui/Icon'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { ZM_GREEN, ZM_GOLD, SOURCE_2013 } from '../lib/frameworkData2013'

/**
 * Early Childhood Care, Development & Education (ECCDE) in the 2013 framework
 * (Chapter 4). Two broad levels — Day-Care and Early Childhood Education
 * (Nursery + Reception) — covering ages 0–6 before Grade 1.
 */
const STAGES = [
  { emoji: '🍼', title: 'Day-Care / Crèche', age: 'Ages 0 – 2', focus: 'Care, affection and safe routines for the youngest children while parents are at work — the centre stands in for the parent.' },
  { emoji: '🧸', title: 'Nursery', age: 'Ages 3 – 4', focus: 'Social, physical, mental and emotional development through play and social interaction with children from different backgrounds.' },
  { emoji: '✏️', title: 'Reception', age: 'Ages 5 – 6', focus: 'Preparatory stage for Grade 1 — largely guided and unguided play with ~40% pre-academic work for a smooth transition to formal school.' },
]

/**
 * The five early-education learning areas (Chapter 4 — "Curriculum for Early
 * Education"). Dominated by play and pre-learning activities and linked to
 * Grade 1.
 */
const LEARNING_AREAS = [
  { emoji: '📖', title: 'Literacy & Language', body: 'Listening, speaking, early mark-making and pre-reading — in a familiar Zambian Language.', bg: '#e8f5ee', color: 'var(--success-fg)' },
  { emoji: '🔢', title: 'Pre-Mathematics', body: 'Counting, sorting, comparing and early number sense through play.', bg: '#e8f0ff', color: 'var(--info-fg)' },
  { emoji: '🌿', title: 'Integrated / Environmental Science', body: 'Exploring the natural world — plants, animals, weather and everyday materials.', bg: '#e8fff0', color: 'var(--success-fg)' },
  { emoji: '🌍', title: 'Social Studies', body: 'The family, the community and getting along with others.', bg: '#fff3e8', color: '#8c4a00' },
  { emoji: '🎨', title: 'Expressive Arts', body: 'Art, music, movement, drama and creative play.', bg: '#fdf0ff', color: '#6b0080' },
]

/**
 * ECCDE focuses on the holistic development of the child across five
 * developmental areas (Chapter 4).
 */
const DOMAINS = [
  ['🏃', 'Physical', 'Fine and gross motor-skills development.'],
  ['❤️', 'Social, Emotional, Spiritual & Moral', 'Relationships, self-regulation, values and confidence.'],
  ['💬', 'Language', 'Receptive and expressive language development.'],
  ['✨', 'Aesthetic', 'Appreciation of beauty, creativity and imagination.'],
  ['🧠', 'Cognitive & Intellectual', 'Curiosity, memory, problem-solving and early reasoning.'],
]

/** Key competences a child should demonstrate at Early Education (Chapter 4). */
const KEY_COMPETENCES = [
  'Social interaction skills',
  'Elementary pre-literacy skills',
  'Elementary pre-numeracy skills',
  'Fine and gross motor skills',
]

/** Table 2 — time allocation at Early Education (15 hours per week). */
const TIME_ROWS = [
  ['Social Studies', '2 hours'],
  ['Environmental Science', '2½ hours'],
  ['Pre-Literacy and Language', '3½ hours'],
  ['Pre-Mathematics', '3½ hours'],
  ['Expressive Arts', '3½ hours'],
]

export default function ECE2013Curriculum() {
  return (
    <div>
      <SeoHelmet
        title="2013 Early Childhood Education (Ages 0–6)"
        description="2013 Zambia framework — Early Childhood Care, Development & Education: Day-Care, Nursery and Reception, the five early-education learning areas, developmental domains and time allocation."
        path="/teacher/curriculum/2013/ece"
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
            2013 Framework · Ages 0 – 6
          </div>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">
            Early Childhood Care, Development &amp; Education
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.88)' }}>
            The foundation stage — thematic, play-based learning in a familiar Zambian Language,
            standardised and linked to Grade 1.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.1em]" style={{ color: 'rgba(255,255,255,0.92)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🧸 Ages 0 – 6</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🏫 3 Stages</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>📚 5 Learning Areas</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>⏱️ 15 hrs / week</span>
          </div>
        </div>
      </section>

      {/* Stages */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            Structure · Chapter 4
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">From Birth to Grade 1</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            ECCDE caters for two broad levels — Day-Care and Early Childhood Education (Nursery and
            Reception) — across three stages before formal schooling begins at Grade 1.
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
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            What is taught
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">5 Early-Education Learning Areas</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            The curriculum is dominated by play and pre-learning activities across five learning
            areas, deliberately linked to Primary School.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZM_GREEN }}>
            How children grow
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">5 Developmental Areas</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            ECCDE develops the whole child in an integrated way across five developmental areas.
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

      {/* Time allocation + key competences */}
      <section className="mb-7 grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border theme-border theme-card shadow-elev-md">
          <header className="border-b theme-border px-4 py-3" style={{ background: ZM_GREEN, color: '#fff' }}>
            <h3 className="text-sm font-black">⏱️ Time Allocation — Table 2 · 15 hrs / week</h3>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Learning Area', 'Time / Week'].map(h => (
                    <th key={h} className="border-b theme-border px-4 py-2 text-left text-[11px] font-black uppercase tracking-[0.06em]"
                      style={{ background: 'rgba(212, 160, 23, 0.16)', color: 'var(--warning-fg)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIME_ROWS.map(([area, time], i) => (
                  <tr key={area} className={i % 2 === 1 ? 'theme-bg-subtle' : ''}>
                    <td className="border-b theme-border px-4 py-2 theme-text font-bold">{area}</td>
                    <td className="border-b theme-border px-4 py-2 theme-text whitespace-nowrap">{time}</td>
                  </tr>
                ))}
                <tr style={{ background: 'rgba(212, 160, 23, 0.16)' }}>
                  <td className="px-4 py-2 text-sm font-black" style={{ color: 'var(--warning-fg)' }}>Total</td>
                  <td className="px-4 py-2 text-sm font-black" style={{ color: 'var(--warning-fg)' }}>15 hours</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <article className="rounded-2xl border theme-border theme-card p-5 shadow-elev-md">
          <h3 className="text-sm font-black theme-text">Key Competences at Early Education</h3>
          <p className="mt-1 text-xs theme-text-muted">
            By the end of this level, the child should demonstrate:
          </p>
          <ul className="mt-3 space-y-2">
            {KEY_COMPETENCES.map(c => (
              <li key={c} className="flex items-start gap-2 text-sm theme-text">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: ZM_GREEN }} />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t theme-border pt-3 text-xs theme-text-muted">
            Assessment focuses on developmental milestones (e.g. the Child Development Assessment Tool
            for Zambia, CDAZ) and early identification of challenges — never for judging or comparing
            children.
          </p>
        </article>
      </section>

      <p className="mt-6 text-xs theme-text-muted">
        Source: <span className="font-bold theme-text">{SOURCE_2013}</span>
      </p>
    </div>
  )
}
