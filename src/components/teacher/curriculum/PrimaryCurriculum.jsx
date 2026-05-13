import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, ChevronDown, ChevronUp } from '../../ui/icons'
import Icon from '../../ui/Icon'
import SeoHelmet from '../../seo/SeoHelmet'

const ZAMBIA_GREEN = '#1a7a4a'
const ZAMBIA_GOLD = '#d4a017'

const TABS = [
  { id: 'all',         label: 'All' },
  { id: 'lp',          label: 'Lower Primary (G 1–3)' },
  { id: 'up',          label: 'Upper Primary (G 4–6)' },
  { id: 'g1',          label: 'Grade 1' },
  { id: 'g2',          label: 'Grade 2' },
  { id: 'g3',          label: 'Grade 3' },
  { id: 'g4',          label: 'Grade 4' },
  { id: 'g5',          label: 'Grade 5' },
  { id: 'g6',          label: 'Grade 6' },
  { id: 'timetable',   label: 'Timetables' },
  { id: 'assessment',  label: 'Assessment' },
  { id: 'themes',      label: 'Cross-Cutting Themes' },
]

const SUBJECTS = [
  {
    id: 'lit-lang-lp',
    tags: ['all', 'lp', 'g1', 'g2', 'g3'],
    emoji: '📖',
    title: 'Literacy and Language',
    meta: 'Lower Primary · 5 h 30 min / 11 periods each strand',
    chips: [
      { label: 'Lower Primary', tone: 'lp' },
      { label: 'Compulsory', tone: 'compulsory' },
    ],
    text: 'literacy language english zambian phonics reading writing oral',
    details: {
      Strands: [
        'English Language (5 h 30 min / 11 periods)',
        'Zambian Language — one of 7 zoned languages: Bemba, Nyanja, Tonga, Lozi, Kaonde, Lunda, Luvale (5 h 30 min / 11 periods)',
      ],
      Approach:
        'Early Grade Literacy Programme (EGLP): Phonological & Phonemic Awareness, Phonics, Vocabulary, Comprehension, Writing, Oral Reading Fluency. Sign Language for HI learners; Braille for VI learners.',
      'Indicative Outcomes by Grade 3':
        'Decode age-appropriate texts fluently in English and a Zambian Language; write simple connected sentences; listen and speak confidently; demonstrate basic comprehension and interpretation.',
    },
  },
  {
    id: 'math-sci-lp',
    tags: ['all', 'lp', 'g1', 'g2', 'g3'],
    emoji: '🔢',
    title: 'Mathematics and Science',
    meta: 'Lower Primary · 5 h / 10 periods per week',
    chips: [
      { label: 'Lower Primary', tone: 'lp' },
      { label: 'Compulsory', tone: 'compulsory' },
    ],
    text: 'mathematics science number counting shapes measurement',
    details: {
      Strands: [
        'Number sense, shape, measurement, data',
        'Natural and physical world: observation, experiments, classification',
      ],
      Approach:
        'Hands-on, concrete–pictorial–abstract progression. Learners count, compare, sort and measure with local materials before moving to symbolic notation. Science is exploratory — plants, animals, weather, everyday materials.',
      'Indicative Outcomes by Grade 3':
        'Numerate to 4-digit numbers; four operations on whole numbers; 2-D & 3-D shapes; tell time and use money; observe, describe and record simple natural phenomena.',
    },
  },
  {
    id: 'cts-lp',
    tags: ['all', 'lp', 'g1', 'g2', 'g3'],
    emoji: '🎨',
    title: 'Creative & Technology Studies (CTS)',
    meta: 'Lower Primary · 5 h / 10 periods per week',
    chips: [
      { label: 'Lower Primary', tone: 'lp' },
      { label: 'Compulsory', tone: 'compulsory' },
    ],
    text: 'creative technology studies art music drama home economics',
    details: {
      Strands: [
        'Technology Studies — tools, simple making, digital literacy, introductory keyboarding',
        'Home Economics — personal hygiene, food & nutrition basics, simple food preparation, clothing care',
        "Expressive Arts — visual art, music, dance and drama drawing on Zambia's cultural heritage",
      ],
      'Why integrated?':
        'CTS gives every Lower-Primary child a balanced creative and practical foundation and prepares them for the Expressive Arts vs. Home Economics choice at Upper Primary.',
    },
  },
  {
    id: 'eng-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '📝',
    title: 'English Language / Sign Language',
    meta: 'Upper Primary · 4 h / 6 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Compulsory', tone: 'compulsory' },
    ],
    text: 'english sign language reading writing comprehension grammar literature',
    details: {
      Strands: ['Listening', 'Speaking', 'Reading', 'Writing', 'Grammar & Usage', 'Literature appreciation'],
      'Key Competences':
        'Read fluently with comprehension; communicate effectively in speech and writing; use grammar and vocabulary correctly; appreciate a range of Zambian and global texts; write narrative, descriptive, expository texts, letters and reports.',
      Note:
        'Also the Language of Instruction across all other subjects. Sign Language for learners with hearing impairment.',
    },
  },
  {
    id: 'zam-lang-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '🗣️',
    title: 'Zambian Language',
    meta: 'Upper Primary · 3 h 20 min / 5 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Compulsory', tone: 'compulsory' },
    ],
    text: 'zambian language bemba nyanja tonga lozi kaonde lunda luvale oral literature',
    details: {
      'Zoned Languages':
        'Bemba, Nyanja, Tonga, Lozi, Kaonde, Lunda or Luvale — depending on the region.',
      Strands: [
        'Listening & Speaking',
        'Reading & Writing',
        'Local oral literature — folktales, riddles, proverbs, songs',
        'Cultural identity',
      ],
      'Key Competences':
        'Read and write fluently in the zoned language; understand and use grammar; appreciate cultural texts; translate simple ideas between English and the Zambian language; communicate confidently in community settings.',
    },
  },
  {
    id: 'math-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '➕',
    title: 'Mathematics',
    meta: 'Upper Primary · 4 h / 6 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Compulsory · STEM', tone: 'compulsory' },
    ],
    text: 'mathematics fractions decimals algebra geometry statistics data measurement',
    details: {
      Strands: [
        'Number & Operations',
        'Measurement',
        'Geometry / Shape and Space',
        'Statistics & Data Handling',
        'Algebra (introduced at Grade 6)',
        'Money & Personal Finance',
      ],
      'Key Competences':
        'Compute with whole numbers, fractions, decimals and percentages; solve multi-step word problems; measure length, mass, capacity, time and area; read and interpret tables, charts and graphs; recognise and use basic algebraic relationships.',
    },
  },
  {
    id: 'sci-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '🌱',
    title: 'Science (incl. Agricultural Science)',
    meta: 'Upper Primary · 4 h / 6 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Compulsory · STEM', tone: 'compulsory' },
    ],
    text: 'science agricultural farming crops livestock soils environment inquiry',
    details: {
      Strands: [
        'Living things (plants, animals, human body, health)',
        'Matter and energy',
        'Earth and the environment',
        'Agricultural science — soils, crops, livestock, tools',
        'Scientific inquiry & investigation skills',
      ],
      'Key Competences':
        'Plan and carry out simple investigations; classify living and non-living things; explain everyday physical phenomena; demonstrate basic crop and livestock care; apply science to nutrition, hygiene and environmental stewardship.',
    },
  },
  {
    id: 'social-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '🌍',
    title: 'Social Studies (incl. Mining content)',
    meta: 'Upper Primary · 3 h 20 min / 5 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Compulsory', tone: 'compulsory' },
    ],
    text: 'social studies history geography civic mining zambia minerals resources',
    details: {
      Strands: [
        'History of Zambia and the region',
        'Geography — physical, human, economic (incl. mining)',
        'Civic Education — governance, citizenship, national values, human rights, anti-corruption, gender',
        "Zambia's place in Africa and the world",
      ],
      'Key Competences':
        "Explain Zambia's history and political system; locate places and resources; describe how mining and economic activities shape the country; identify rights, responsibilities and national values; show concern for community wellbeing and environment.",
    },
  },
  {
    id: 'tech-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '💻',
    title: 'Technology Studies',
    meta: 'Upper Primary · 4 h 40 min / 7 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Compulsory · STEM', tone: 'compulsory' },
    ],
    text: 'technology studies ict digital literacy computer internet design making entrepreneurship',
    details: {
      Strands: [
        'Design & making',
        'Materials, tools and processes',
        'ICT & digital literacy — computer use, internet, simple productivity software, online safety',
        'Innovation and entrepreneurship',
      ],
      'Key Competences':
        'Use a computer for basic productivity tasks; evaluate information online; design and make simple useful objects; apply safe practice with tools; recognise how everyday technology solves problems.',
    },
  },
  {
    id: 'arts-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '🎭',
    title: 'Expressive Arts',
    meta: 'Upper Primary · 4 h 40 min / 7 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Optional — choose one', tone: 'optional' },
    ],
    text: 'expressive arts visual music dance drama performance optional',
    details: {
      Strands: ['Visual Art & Design', 'Music', 'Dance', 'Drama and Performance'],
      'Key Competences':
        'Use elements and principles of art across at least two media; perform vocal and instrumental music individually and in groups; participate in dance and drama productions; describe and appreciate creative work.',
      'Career Pathway':
        'Foundational for the Performing & Creative Arts pathway at Secondary Ordinary Level.',
    },
  },
  {
    id: 'home-ec-up',
    tags: ['all', 'up', 'g4', 'g5', 'g6'],
    emoji: '🏠',
    title: 'Home Economics',
    meta: 'Upper Primary · 4 h 40 min / 7 periods per week',
    chips: [
      { label: 'Upper Primary', tone: 'up' },
      { label: 'Optional — choose one', tone: 'optional' },
    ],
    text: 'home economics food nutrition clothing textiles family consumer hospitality optional',
    details: {
      Strands: ['Food & Nutrition', 'Clothing & Textiles', 'Family & Consumer Studies', 'Home Management & personal finance basics', 'Hospitality'],
      'Key Competences':
        'Prepare and serve simple nutritious meals safely and hygienically; carry out basic sewing and clothing care; manage personal and family resources; demonstrate hospitality and customer-care skills.',
      'Career Pathway':
        'Foundational for the Home Economics & Hospitality pathway at Secondary Ordinary Level.',
    },
  },
]

const GRADE_OVERVIEWS = [
  {
    id: 'g1',
    tags: ['all', 'g1', 'lp'],
    pillBg: '#2471A3',
    title: 'Grade 1 · Lower Primary · Age 6–7',
    rows: [
      ['Literacy & Language — English', '5 h 30 min / 11', 'Letter–sound recognition, oral language, sight words, simple sentence reading.'],
      ['Literacy & Language — Zambian Language', '5 h 30 min / 11', 'Listening, speaking and early phonics in the zoned language.'],
      ['Mathematics and Science', '5 h / 10', 'Counting to 100, comparing quantities, basic shapes, observation of plants, animals and weather.'],
      ['Creative and Technology Studies', '5 h / 10', 'Drawing, singing, simple crafts, hygiene routines, introduction to tools and computers.'],
    ],
    assessment: 'National Competence Assessment in Literacy & Numeracy at end of Grade 1 — identifies learners needing extra support, not for streaming.',
  },
  {
    id: 'g2',
    tags: ['all', 'g2', 'lp'],
    pillBg: '#1A8D74',
    title: 'Grade 2 · Lower Primary · Age 7–8',
    rows: [
      ['Literacy & Language — English', '5 h 30 min / 11', 'Decoding, sentence-level reading, simple writing, expanded vocabulary.'],
      ['Literacy & Language — Zambian Language', '5 h 30 min / 11', 'Reading short stories and writing simple sentences in the zoned language.'],
      ['Mathematics and Science', '5 h / 10', 'Operations to 999, time, money, simple experiments, classifying living things.'],
      ['Creative and Technology Studies', '5 h / 10', 'Crafts, simple cookery and food hygiene, songs and dances, beginning computing.'],
    ],
    assessment: 'School-based formative assessment; classroom observation against literacy and numeracy benchmarks.',
  },
  {
    id: 'g3',
    tags: ['all', 'g3', 'lp'],
    pillBg: '#A04000',
    title: 'Grade 3 · Lower Primary · Age 8–9',
    rows: [
      ['Literacy & Language — English', '5 h 30 min / 11', 'Fluent reading of short texts, paragraph writing, basic grammar.'],
      ['Literacy & Language — Zambian Language', '5 h 30 min / 11', 'Fluent reading and writing of paragraphs in the zoned language; simple translation.'],
      ['Mathematics and Science', '5 h / 10', 'Whole-number operations to 9,999; fractions intro; measurement; classification; simple inquiry.'],
      ['Creative and Technology Studies', '5 h / 10', 'Class projects, performance, digital literacy basics.'],
    ],
    assessment: 'School-based assessment + National Competence Assessment in Literacy & Numeracy at end of Grade 3 — gateway data for remediation before Upper Primary.',
  },
  {
    id: 'g4',
    tags: ['all', 'g4', 'up'],
    pillBg: '#6C3483',
    title: 'Grade 4 · Upper Primary · Age 9–10',
    rows: [
      ['English Language / Sign Language', '4 h / 6', 'Reading short texts, friendly letters, descriptive writing, expanded vocabulary.'],
      ['Mathematics', '4 h / 6', 'Whole numbers to millions, fractions, decimals, basic geometry, statistics.'],
      ['Science (incl. Agricultural)', '4 h / 6', 'Living things, simple experiments, soils and crops, the environment.'],
      ['Zambian Language', '3 h 20 min / 5', 'Reading and writing zonal-language texts, oral literature.'],
      ['Social Studies (incl. Mining)', '3 h 20 min / 5', 'History of the local community and Zambia; geography and resources; civic values.'],
      ['Technology Studies', '4 h 40 min / 7', 'Computer basics, online safety, simple making.'],
      ['Expressive Arts OR Home Economics', '4 h 40 min / 7', 'Foundations of art, music and drama — OR — food, nutrition and personal finance.'],
    ],
    assessment: 'School-Based Assessment (SBA) — contributes 10% of eventual final-mark profile.',
  },
  {
    id: 'g5',
    tags: ['all', 'g5', 'up'],
    pillBg: '#922B21',
    title: 'Grade 5 · Upper Primary · Age 10–11',
    rows: [
      ['English Language / Sign Language', '4 h / 6', 'Comprehension, summary writing, narrative and expository composition.'],
      ['Mathematics', '4 h / 6', 'Operations on fractions and decimals, measurement, area and volume, data handling.'],
      ['Science (incl. Agricultural)', '4 h / 6', 'Human body, matter and energy, plant production, sustainable practices.'],
      ['Zambian Language', '3 h 20 min / 5', 'More complex texts, grammar, oral literature.'],
      ["Social Studies (incl. Mining)", '3 h 20 min / 5', "Zambia's government and economy; mining and minerals; African Union."],
      ['Technology Studies', '4 h 40 min / 7', 'Productivity software, structured information searches, simple design tasks.'],
      ['Expressive Arts OR Home Economics', '4 h 40 min / 7', 'Performance and exhibition projects — OR — family resource management, simple meals.'],
    ],
    assessment: 'SBA — contributes a further 10% of the final-mark profile.',
  },
  {
    id: 'g6',
    tags: ['all', 'g6', 'up'],
    pillBg: '#1E8449',
    title: 'Grade 6 · Upper Primary · Age 11–12',
    rows: [
      ['English Language / Sign Language', '4 h / 6', 'Extended composition, formal letters, critical reading, basic literature appreciation.'],
      ['Mathematics', '4 h / 6', 'Percentages, ratio, simple algebra, geometry, statistics, problem-solving.'],
      ['Science (incl. Agricultural)', '4 h / 6', 'Health, simple physics and chemistry, livestock and crops, environmental science.'],
      ['Zambian Language', '3 h 20 min / 5', 'Mastery of reading, writing and oral literature in the zoned language.'],
      ['Social Studies (incl. Mining)', '3 h 20 min / 5', 'Zambia in the world; mining careers; human rights; financial citizenship.'],
      ['Technology Studies', '4 h 40 min / 7', 'Independent digital projects; safe and ethical online behaviour; introductory entrepreneurship.'],
      ['Expressive Arts OR Home Economics', '4 h 40 min / 7', 'Capstone project linked to a possible secondary career pathway.'],
    ],
    assessment: 'SBA final 10% (total 30% from G4–G6) + Primary School Leaving Examination (70%, ECZ-administered). Progression to Form 1 is NOT automatic.',
  },
]

const CROSS_THEMES = [
  ['Life Skills & Health Education (LSHE)', 'Science, Home Economics, CTS and assemblies.'],
  ['Gender', 'Social Studies, Literacy texts, classroom practice.'],
  ['Governance', 'Social Studies (civic education).'],
  ['Anti-corruption', 'Social Studies, school code of conduct.'],
  ['Human rights & freedoms', 'Social Studies, Literacy.'],
  ['National values & principles', 'All subjects, especially Social Studies.'],
  ['Entrepreneurship education', 'Technology Studies, Home Economics, Mathematics.'],
  ['HIV and AIDS', 'Science, Home Economics, LSHE.'],
  ['Environmental health & pollution management', 'Science, Social Studies, CTS projects.'],
  ['Climate change education', 'Science (esp. Agricultural Science), Social Studies.'],
  ['Health and nutrition', 'Home Economics, Science.'],
  ['Drug and substance use', 'Science, LSHE, school clubs.'],
  ['Mental health', 'LSHE, Home Economics, pastoral programmes.'],
  ['Social and Emotional Learning (SEL)', 'All subjects through teaching practice.'],
  ['Financial education', 'Mathematics, Home Economics, Social Studies.'],
  ['Special and inclusive education', 'All subjects — see LSEND provisions.'],
  ['Education for sustainable development', 'Science, Social Studies, projects.'],
  ['Digital literacy', 'Technology Studies (compulsory) and across all subjects.'],
]

const ASSESSMENT_ROWS = [
  ['Throughout primary', 'Continuous formative assessment by the teacher', 'Informs teaching; not graded externally'],
  ['End of Grade 1', 'National Competence Assessment in Literacy & Numeracy', 'Identifies learners needing intervention'],
  ['End of Grade 3', 'National Competence Assessment in Literacy & Numeracy', 'Establishes Lower-Primary exit competences'],
  ['Grade 4 SBA', 'School-Based Assessment, all subjects', '10% of the eventual final mark'],
  ['Grade 5 SBA', 'School-Based Assessment, all subjects', '10% of the eventual final mark'],
  ['Grade 6 SBA', 'School-Based Assessment, all subjects', '10% — total 30% across G4–G6'],
  ['End of Grade 6', 'Primary School Leaving Examination (ECZ-administered)', '70% of the final mark; gates progression to Form 1'],
]

const EXIT_PROFILE = [
  ['Literacy', 'Reads and writes fluently in English and a Zambian language; uses Sign Language or Braille where applicable.'],
  ['Numeracy', 'Confidently uses number, measurement and basic statistics in everyday life.'],
  ['Communication', 'Listens, speaks, reads and writes for a range of audiences and purposes.'],
  ['Critical & creative thinking', 'Reflects, reasons and produces original ideas and work.'],
  ['Problem-solving', 'Identifies problems and applies knowledge from across subjects to solve them.'],
  ['Practical skills', 'Has competences in Technology Studies and either Expressive Arts or Home Economics.'],
  ['Digital literacy', 'Uses computers safely and productively for learning.'],
  ['Civic & moral values', "Acts on Zambia's national values, respects human rights and demonstrates integrity."],
  ['Health & wellbeing', 'Takes care of personal hygiene, nutrition, mental health and the environment.'],
  ['Career awareness', 'Understands the secondary pathways and has begun to think about a personal direction.'],
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
    lp:        { background: 'rgba(46, 134, 193, 0.14)', color: '#1A5276' },
    up:        { background: 'rgba(30, 132, 73, 0.14)',  color: '#1E8449' },
    compulsory:{ background: 'rgba(30, 132, 73, 0.14)',  color: '#1E8449' },
    optional:  { background: 'rgba(212, 160, 23, 0.16)', color: '#9a7000' },
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
        style={{ color: ZAMBIA_GREEN }}
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

function ThemedTable({ title, headers, rows, totalRow }) {
  return (
    <section className="overflow-hidden rounded-2xl border theme-border theme-card shadow-elev-md">
      <header className="border-b theme-border px-4 py-3" style={{ background: ZAMBIA_GREEN, color: '#fff' }}>
        <h3 className="text-sm font-black">{title}</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {headers.map(h => (
                <th
                  key={h}
                  className="border-b theme-border px-4 py-2 text-left text-[11px] font-black uppercase tracking-[0.06em]"
                  style={{ background: 'rgba(212, 160, 23, 0.16)', color: '#7a5800' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'theme-bg-subtle' : ''}>
                {row.map((cell, j) => (
                  <td key={j} className="border-b theme-border px-4 py-2 theme-text align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {totalRow && (
              <tr style={{ background: 'rgba(212, 160, 23, 0.16)' }}>
                {totalRow.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-sm font-black" style={{ color: '#7a5800' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function GradeOverview({ overview, query }) {
  const tableText = `${overview.title} ${overview.rows.map(r => r.join(' ')).join(' ')} ${overview.assessment}`
  if (!searchMatches(tableText, query)) return null
  return (
    <section className="overflow-hidden rounded-2xl border theme-border theme-card shadow-elev-md">
      <header className="flex items-center gap-3 border-b theme-border px-4 py-3" style={{ background: '#0e2a32', color: '#fff' }}>
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-black"
          style={{ background: overview.pillBg, color: '#fff' }}
        >
          {overview.id.replace('g', '')}
        </span>
        <h3 className="text-sm font-black">{overview.title}</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {['Subject', 'Time / Week', 'Indicative Scope'].map(h => (
                <th key={h} className="border-b theme-border px-4 py-2 text-left text-[11px] font-black uppercase tracking-[0.06em]"
                  style={{ background: 'rgba(212, 160, 23, 0.16)', color: '#7a5800' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overview.rows.map(([subject, hrs, scope], i) => (
              <tr key={i} className={i % 2 === 1 ? 'theme-bg-subtle' : ''}>
                <td className="border-b theme-border px-4 py-2 theme-text align-top font-bold">{subject}</td>
                <td className="border-b theme-border px-4 py-2 theme-text align-top whitespace-nowrap">{hrs}</td>
                <td className="border-b theme-border px-4 py-2 theme-text align-top">{scope}</td>
              </tr>
            ))}
            <tr style={{ background: 'rgba(212, 160, 23, 0.16)' }}>
              <td colSpan={2} className="px-4 py-2 text-sm font-black" style={{ color: '#7a5800' }}>Assessment</td>
              <td className="px-4 py-2 text-sm theme-text">{overview.assessment}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function PrimaryCurriculum() {
  const [activeTab, setActiveTab] = useState('all')
  const [query, setQuery] = useState('')

  const filteredSubjects = useMemo(() => {
    return SUBJECTS.filter(s => {
      if (!tabMatches(s.tags, activeTab)) return false
      const hay = `${s.title} ${s.meta} ${s.text} ${Object.values(s.details).flat().join(' ')}`
      return searchMatches(hay, query)
    })
  }, [activeTab, query])

  const showOverview      = tabMatches(['all', 'timetable'], activeTab)
  const showLpTimetable   = tabMatches(['all', 'lp', 'timetable', 'g1', 'g2', 'g3'], activeTab)
  const showUpTimetable   = tabMatches(['all', 'up', 'timetable', 'g4', 'g5', 'g6'], activeTab)
  const showSubjectsLabel = filteredSubjects.length > 0
  const visibleGrades     = GRADE_OVERVIEWS.filter(g => tabMatches(g.tags, activeTab))
  const showThemes        = tabMatches(['all', 'themes'], activeTab)
  const showAssessment    = tabMatches(['all', 'assessment'], activeTab)

  const [openSubject, setOpenSubject] = useState(null)

  return (
    <div>
      <SeoHelmet
        title="Primary Curriculum (Grades 1–6)"
        description="2023 Zambia Primary Curriculum — subjects, timetables, grade-by-grade scope and assessment."
        path="/teacher/curriculum/primary"
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
        className="mb-5 overflow-hidden rounded-3xl border theme-border shadow-elev-md"
        style={{ background: `linear-gradient(135deg, ${ZAMBIA_GREEN} 0%, #166e42 55%, #0f4d31 100%)` }}
      >
        <div className="px-5 py-6 text-white sm:px-7 sm:py-7">
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
            style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}
          >
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ZAMBIA_GOLD }} />
            2023 Framework · Grades 1–6
          </div>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">Zambia Primary Curriculum</h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.88)' }}>
            A smart, searchable summary — subject breakdowns, grade overviews, timetables,
            cross-cutting themes and assessment.
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
                placeholder="Search subjects, grades, topics…"
                className="w-full rounded-full border px-9 py-2 text-sm theme-text shadow-elev-md outline-none"
                style={{
                  background: '#ffffff',
                  borderColor: 'rgba(255,255,255,0.3)',
                  color: '#0f172a',
                }}
              />
            </label>
            {query && (
              <p className="mt-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {filteredSubjects.length
                  ? `Showing ${filteredSubjects.length} subject${filteredSubjects.length !== 1 ? 's' : ''} matching "${query}"`
                  : `No subjects match "${query}"`}
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
                active
                  ? 'border-transparent text-white shadow-elev-md'
                  : 'theme-border theme-card theme-text-muted hover:theme-card-hover'
              }`}
              style={active ? { background: ZAMBIA_GREEN } : undefined}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="space-y-5">
        {/* Overview */}
        {showOverview && (
          <ThemedTable
            title="📊 Primary Education at a Glance"
            headers={['Category', 'Lower Primary (Grades 1–3)', 'Upper Primary (Grades 4–6)']}
            rows={[
              ['Grades', '1 – 3', '4 – 6'],
              ['Entry age', '6 years', '9 years'],
              ['Learning areas', '3 broad areas', '8 subjects (7 taken)'],
              ['Period length', '30 minutes', '40 minutes'],
              ['Contact time / week', '21 hours (42 periods)', '28 hours (42 periods)'],
              ['Language of instruction',
                'English + code-switching to Zambian Language; Sign Language for HI learners',
                'English; Sign Language for HI learners; Zambian Language taught as a subject'],
              ['Compulsory subjects',
                'All 3 learning areas',
                'English, Zambian Language, Mathematics, Science, Social Studies, Technology Studies'],
              ['Optional subjects', '—', 'Choose ONE: Expressive Arts OR Home Economics'],
              ['National assessment',
                'Competence Assessments at end of Grade 1 & Grade 3',
                'School-Based Assessments G4–G6 (30%) + Primary School Leaving Examination (70%)'],
            ]}
          />
        )}

        {/* Timetables */}
        {showLpTimetable && (
          <ThemedTable
            title="🕐 Timetable — Lower Primary (G 1–3) · 21 hrs / 42 periods per week"
            headers={['#', 'Learning Area', 'Time / Week', 'Periods']}
            rows={[
              ['1a', 'Literacy & Language — English Language', '5 h 30 min', '11'],
              ['1b', 'Literacy & Language — Zambian Language', '5 h 30 min', '11'],
              ['2',  'Mathematics and Science', '5 h 00 min', '10'],
              ['3',  'Creative and Technology Studies (CTS)', '5 h 00 min', '10'],
            ]}
            totalRow={['', 'TOTAL', '21 hours', '42']}
          />
        )}

        {showUpTimetable && (
          <ThemedTable
            title="🕐 Timetable — Upper Primary (G 4–6) · 28 hrs / 42 periods per week"
            headers={['#', 'Subject', 'Time / Week', 'Periods']}
            rows={[
              ['1', 'English Language', '4 h 00 min', '6'],
              ['2', 'Mathematics', '4 h 00 min', '6'],
              ['3', 'Science (incl. Agricultural Science)', '4 h 00 min', '6'],
              ['4', 'Zambian Language', '3 h 20 min', '5'],
              ['5', 'Social Studies (incl. Mining content)', '3 h 20 min', '5'],
              ['6', 'Technology Studies', '4 h 40 min', '7'],
              ['7', 'Expressive Arts OR Home Economics (optional)', '4 h 40 min', '7'],
            ]}
            totalRow={['', 'TOTAL', '28 hours', '42']}
          />
        )}

        {/* Subject cards */}
        {showSubjectsLabel && (
          <>
            <h2 className="pt-2 text-[11px] font-black uppercase tracking-[0.14em] theme-text-muted">
              Subjects
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

        {/* Grade overviews */}
        {visibleGrades.length > 0 && (
          <>
            <h2 className="pt-2 text-[11px] font-black uppercase tracking-[0.14em] theme-text-muted">
              Grade-by-Grade Overviews
            </h2>
            <div className="space-y-4">
              {visibleGrades.map(g => (
                <GradeOverview key={g.id} overview={g} query={query} />
              ))}
            </div>
          </>
        )}

        {/* Cross-Cutting Themes */}
        {showThemes && (
          <ThemedTable
            title="🔗 Cross-Cutting Themes (18 national concerns integrated across all subjects)"
            headers={['#', 'Theme', 'Where It Shows Up Most Strongly at Primary']}
            rows={CROSS_THEMES.map(([t, w], i) => [String(i + 1), t, w])}
          />
        )}

        {/* Assessment + Exit profile */}
        {showAssessment && (
          <>
            <ThemedTable
              title="📋 Assessment at Primary"
              headers={['Stage', 'What It Is', 'Weight / Use']}
              rows={ASSESSMENT_ROWS}
            />
            <ThemedTable
              title="🎓 Learner Exit Profile — End of Grade 6"
              headers={['Competence', 'What It Looks Like in Practice']}
              rows={EXIT_PROFILE}
            />
          </>
        )}
      </div>

      <p className="mt-6 text-xs theme-text-muted">
        Source: <span className="font-bold theme-text">2023 Approved National School Curriculum Framework</span>{' · '}
        Curriculum Development Centre, Ministry of Education.
      </p>
    </div>
  )
}
