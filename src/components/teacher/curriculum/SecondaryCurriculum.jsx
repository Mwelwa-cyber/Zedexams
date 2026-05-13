import { Link } from 'react-router-dom'
import { ArrowLeft } from '../../ui/icons'
import Icon from '../../ui/Icon'
import SeoHelmet from '../../seo/SeoHelmet'

const ZAMBIA_GREEN = '#1a7a4a'
const ZAMBIA_GOLD = '#d4a017'

const PATHWAYS = [
  { id: 1, emoji: '🔬', title: 'Natural Sciences (STEM)',       subjects: 'Biology, Chemistry, Physics, Agricultural Science',       bg: '#e8f5ee', color: '#1a5c36' },
  { id: 2, emoji: '🌍', title: 'Social Sciences',                subjects: 'Geography, History, Civic Education',                     bg: '#e8f0ff', color: '#2d3a8c' },
  { id: 3, emoji: '💼', title: 'Business & Finance',             subjects: 'Principles of Accounts, Commerce',                        bg: '#fff3e8', color: '#8c4a00' },
  { id: 4, emoji: '🌱', title: 'Agriculture Science (STEM)',     subjects: 'Agricultural Science, Chemistry, Physics',                bg: '#e8fff0', color: '#006b2d' },
  { id: 5, emoji: '🍳', title: 'Home Economics & Hospitality',   subjects: 'Food & Nutrition, Fashion, Hospitality, Tourism',         bg: '#fdf0ff', color: '#6b0080' },
  { id: 6, emoji: '💻', title: 'Technology (STEM)',              subjects: 'Computer Science, Design & Technology, ICT',              bg: '#fff8e8', color: '#7a5800' },
  { id: 7, emoji: '🎭', title: 'Performing & Creative Arts',     subjects: 'Music, Art & Design, Literature',                          bg: '#ffe8e8', color: '#8c0000' },
  { id: 8, emoji: '⚽', title: 'Physical Education & Sport',     subjects: 'Physical Education, Biology',                              bg: '#e8faff', color: '#005c7a' },
]

const REFORMS = [
  ['Junior & Senior Secondary merged', 'into one Ordinary Level running Form 1–4 with non-stop progression.'],
  ['Secondary schooling extended from 5 to 6 years', '— 4 years O-Level plus 2 years A-Level.'],
  ['Computer Science introduced', 'as a new subject covering coding, robotics, cybersecurity, and data analysis.'],
  ['ICT replaces Computer Studies', 'and is now a compulsory examinable subject for all learners.'],
  ['Integrated Science split', 'into Biology, Chemistry, and Physics for better preparation for higher education.'],
  ['Social Studies split', 'into Civic Education, History, and Geography to allow earlier specialisation.'],
  ['Financial Literacy & Entrepreneurship', 'integrated into carrier subjects across all pathways.'],
  ['Religious Education syllabi merged', 'into a single unified syllabus to promote unity of purpose.'],
  ['Trade Test Certification', 'via TEVETA is now available for learners taking practical subjects.'],
  ['Travel & Tourism introduced', 'as a new career path within Home Economics & Hospitality, with a foreign language option.'],
]

const ASSESS_CARDS = [
  { emoji: '📝', title: 'School-Based Assessment (SBA)',
    body: 'Assignments, class tests, projects, practical work, research, and end-of-term tests conducted throughout the year.' },
  { emoji: '🏆', title: 'O-Level Final Exam',
    body: 'The School Certificate Ordinary Level Examination is administered at the end of Form 4 by the Examinations Council of Zambia (ECZ).' },
  { emoji: '🎓', title: 'A-Level Assessment',
    body: 'Includes practical assessments for hands-on subjects, coursework assignments, and independent research reports. Final exams by ECZ.' },
  { emoji: '🔧', title: 'Trade Tests (TEVETA)',
    body: 'Learners taking practical subjects may sit Trade Test Certification Exams at Levels III, II, and I administered by TEVETA.' },
]

const A_LEVEL_SUBJECTS = [
  { n: 1,  subject: 'Biology',              category: 'STEM' },
  { n: 2,  subject: 'Physics',              category: 'STEM' },
  { n: 3,  subject: 'Chemistry',            category: 'STEM' },
  { n: 4,  subject: 'Agricultural Science', category: 'STEM' },
  { n: 5,  subject: 'Computer Science',     category: 'STEM' },
  { n: 6,  subject: 'Mathematics',          category: 'STEM' },
  { n: 7,  subject: 'Design and Technology',category: 'STEM' },
  { n: 8,  subject: 'Geography',            category: 'Social Sciences' },
  { n: 9,  subject: 'Civic Education',      category: 'Social Sciences' },
  { n: 10, subject: 'History',              category: 'Social Sciences' },
  { n: 11, subject: 'Religious Studies',    category: 'Social Sciences' },
  { n: 12, subject: 'English Language',     category: 'Languages' },
  { n: 13, subject: 'Literature in English',category: 'Languages' },
  { n: 14, subject: 'Zambian Language',     category: 'Languages' },
  { n: 15, subject: 'Foreign Language (French, Chinese, Portuguese, Swahili)', category: 'Languages' },
  { n: 16, subject: 'Economics',            category: 'Business' },
  { n: 17, subject: 'Commerce',             category: 'Business' },
  { n: 18, subject: 'Accounting',           category: 'Business' },
  { n: 19, subject: 'Fashion and Fabrics',  category: 'Home Econ.' },
  { n: 20, subject: 'Food and Nutrition',   category: 'Home Econ.' },
  { n: 21, subject: 'Hospitality Management', category: 'Home Econ.' },
  { n: 22, subject: 'Travel and Tourism',   category: 'Home Econ.' },
  { n: 23, subject: 'Physical Education',   category: 'Sports' },
  { n: 24, subject: 'Art and Design',       category: 'Creative Arts' },
  { n: 25, subject: 'Music',                category: 'Creative Arts' },
]

const CATEGORY_TONE = {
  'STEM':            { bg: '#e8f0ff', color: '#2d3a8c' },
  'Social Sciences': { bg: '#e8f5ee', color: '#1a5c36' },
  'Languages':       { bg: '#e8f5ee', color: '#1a5c36' },
  'Business':        { bg: '#fff3e8', color: '#8c4a00' },
  'Home Econ.':      { bg: '#f0f0f0', color: '#555555' },
  'Sports':          { bg: '#fdf0ff', color: '#6b0080' },
  'Creative Arts':   { bg: '#fdf0ff', color: '#6b0080' },
}

const CO_CURRICULAR = [
  { emoji: '🏅', label: 'Clubs' },
  { emoji: '⚽', label: 'Sports' },
  { emoji: '🔧', label: 'Preventive Maintenance' },
  { emoji: '🏭', label: 'Production Units' },
  { emoji: '📖', label: 'Subject-Related Activities' },
]

function LevelCard({ tone, badge, title, sub, rows }) {
  return (
    <article className="overflow-hidden rounded-3xl border theme-border theme-card shadow-elev-md">
      <header className="flex items-center gap-3 p-5">
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-2xl"
          style={{ background: tone.bg }}
          aria-hidden
        >
          {badge}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-black theme-text">{title}</h3>
          <p className="text-xs theme-text-muted">{sub}</p>
        </div>
      </header>
      <dl className="px-5 pb-5">
        {rows.map(([label, value, valueTone], i) => (
          <div
            key={label}
            className={`flex items-center justify-between py-2 ${
              i !== rows.length - 1 ? 'border-b theme-border' : ''
            }`}
          >
            <dt className="text-xs theme-text-muted">{label}</dt>
            <dd className="text-sm font-black theme-text">
              {valueTone ? (
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.06em]"
                  style={valueTone}
                >
                  {value}
                </span>
              ) : value}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

export default function SecondaryCurriculum() {
  return (
    <div>
      <SeoHelmet
        title="Secondary Curriculum (Forms 1–6)"
        description="2023 Zambia Secondary Curriculum — Ordinary Level pathways, compulsory subjects, A-Level offerings and assessment."
        path="/teacher/curriculum/secondary"
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
            <span className="text-xl sm:text-2xl">Secondary Education</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.88)' }}>
            A comprehensive overview of the revised secondary curriculum framework —
            Ordinary and Advanced Levels.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.1em]" style={{ color: 'rgba(255,255,255,0.92)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>📅 Effective 2023</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>📚 8 O-Level Pathways</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🎓 5 A-Level Pathways</span>
            <span className="rounded-full px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.16)' }}>🏫 Forms 1 – 6</span>
          </div>
        </div>
      </section>

      {/* Two levels of secondary */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Structure
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Two Levels of Secondary Education</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Secondary education bridges primary school and tertiary education or the world of work,
            equipping learners with competencies, skills, and values for a productive life.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <LevelCard
            tone={{ bg: 'rgba(26, 122, 74, 0.12)' }}
            badge="📘"
            title="Ordinary Level (O-Level)"
            sub="Section 4.3.1"
            rows={[
              ['Duration', '4 Years', { background: 'rgba(26, 122, 74, 0.14)', color: '#1a5c36' }],
              ['Forms', 'Form 1 → Form 4'],
              ['Pathways available', '8 Pathways'],
              ['Subjects per learner', '6 – 7 subjects'],
              ['Final Exam', 'School Certificate (ECZ)'],
            ]}
          />
          <LevelCard
            tone={{ bg: 'rgba(212, 160, 23, 0.16)' }}
            badge="📗"
            title="Advanced Level (A-Level)"
            sub="Section 4.3.2"
            rows={[
              ['Duration', '2 Years', { background: 'rgba(212, 160, 23, 0.18)', color: '#9a7000' }],
              ['Forms', 'Form 5 → Form 6'],
              ['Pathways available', '5 Pathways'],
              ['Subjects per learner', '3 – 4 subjects'],
              ['Entry requirement', '3 Credits at O-Level'],
            ]}
          />
        </div>
      </section>

      {/* Pathways */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Ordinary Level
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">8 Specialisation Pathways</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Learners are placed into pathways based on their primary school examination results and
            personal interests, guiding their future career decisions.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PATHWAYS.map(p => (
            <article
              key={p.id}
              className="flex flex-col gap-1 rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
              style={{ background: p.bg, color: p.color }}
            >
              <div className="text-2xl" aria-hidden>{p.emoji}</div>
              <h3 className="text-sm font-black">{p.title}</h3>
              <p className="text-xs" style={{ opacity: 0.85 }}>{p.subjects}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Compulsory subjects */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            O-Level · All Pathways
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Compulsory Subjects</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            These four subjects are mandatory for every learner regardless of their chosen pathway.
          </p>
        </header>
        <div className="flex flex-wrap justify-center gap-2">
          {['English Language', 'Mathematics', 'Civic Education', 'Information & Communication Technology (ICT)'].map(s => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-black text-white shadow-elev-md"
              style={{ background: ZAMBIA_GREEN }}
            >
              <span aria-hidden style={{ opacity: 0.85, fontWeight: 900 }}>✓</span>
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* Key reforms */}
      <section className="mb-7 rounded-3xl p-5 sm:p-6" style={{ background: 'rgba(26, 122, 74, 0.08)' }}>
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            What's New
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Key Curriculum Reforms</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            The 2023 curriculum introduced significant structural and subject-level changes at
            secondary school level.
          </p>
        </header>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {REFORMS.map(([title, body], i) => (
            <li key={title} className="flex items-start gap-3 rounded-2xl border theme-border theme-card p-4 shadow-elev-md">
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-black text-white"
                style={{ background: ZAMBIA_GREEN }}
                aria-hidden
              >
                {i + 1}
              </span>
              <p className="text-sm theme-text">
                <span className="font-black">{title}</span> {body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Assessment */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Evaluation
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Assessment Approach</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            A blend of continuous school-based assessment and national examinations ensures
            holistic evaluation of learner competencies.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ASSESS_CARDS.map(c => (
            <article key={c.title} className="rounded-2xl border theme-border theme-card p-5 shadow-elev-md">
              <div className="text-2xl" aria-hidden>{c.emoji}</div>
              <h3 className="mt-2 text-sm font-black theme-text">{c.title}</h3>
              <p className="mt-1 text-xs theme-text-muted">{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* A-Level subjects table */}
      <section className="mb-7">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Advanced Level
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">25 Subjects Offered at A-Level</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            Learners choose <strong className="theme-text">3–4 subjects</strong> aligned to one of five pathways:
            STEM, Social Sciences & Languages, Business Studies, Sports Science, or Creative & Performing Arts.
          </p>
        </header>
        <div className="overflow-hidden rounded-2xl border theme-border theme-card shadow-elev-md">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#0e2a32', color: '#fff' }}>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.06em]">#</th>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.06em]">Subject</th>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.06em]">Category</th>
                </tr>
              </thead>
              <tbody>
                {A_LEVEL_SUBJECTS.map((s, i) => {
                  const tone = CATEGORY_TONE[s.category] || CATEGORY_TONE['Home Econ.']
                  return (
                    <tr key={s.n} className={i % 2 === 1 ? 'theme-bg-subtle' : ''}>
                      <td className="border-b theme-border px-4 py-2 theme-text">{s.n}</td>
                      <td className="border-b theme-border px-4 py-2 theme-text">{s.subject}</td>
                      <td className="border-b theme-border px-4 py-2">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.06em]"
                          style={tone}
                        >
                          {s.category}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Co-curricular */}
      <section className="mb-2">
        <header className="mb-3 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: ZAMBIA_GREEN }}>
            Beyond the Classroom
          </div>
          <h2 className="mt-1 text-xl font-black theme-text">Co-Curricular Activities</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm theme-text-muted">
            All learners at both O-Level and A-Level are expected to participate in activities
            that complement the curriculum.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {CO_CURRICULAR.map(c => (
            <article key={c.label} className="rounded-2xl border theme-border theme-card p-4 text-center shadow-elev-md">
              <div className="text-2xl" aria-hidden>{c.emoji}</div>
              <p className="mt-1 text-sm font-black theme-text">{c.label}</p>
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
