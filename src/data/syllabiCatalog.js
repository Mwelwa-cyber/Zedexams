// Official Zambian CDC syllabi catalog.
// `s` is the PDF size in bytes; `e` flags PDFs that have an embedded preview.
// `file` (optional) is the actual filename in Firebase Storage at /syllabi/
// when it differs from `${k}.pdf`. PDFs themselves live in Firebase Storage
// and are loaded by the viewer modal — see SyllabiLibrary.jsx for the
// no-download viewer.

export const SYLLABI_CATALOG = {
  new: [
    { k: 'new-framework',    t: 'National Curriculum Framework',          g: 'All grades',     l: 'Framework',           s: 1336532, e: true, file: '2023-approved-national-school-curriculum.pdf' },
    { k: 'new-ece-syllabi',  t: 'Early Childhood Education',              g: 'Ages 3-5',       l: 'ECE',                 s:  791294, e: true, file: 'early-childhood-education-syllabi-3-to-5-year-corrected.pdf' },
    { k: 'new-ece-jan2025',  t: 'ECE Syllabus (Jan 2025)',                g: 'Ages 3-5',       l: 'ECE',                 s: 3706262, e: true, file: 'finalised-ece-syllabus-jan-2025.pdf' },
    { k: 'new-ece-math',     t: 'ECE Mathematics',                        g: 'Ages 5-6',       l: 'ECE',                 s: 2756061, e: true, file: 'ece-5-6-mathematics.pdf' },
    { k: 'new-ece-lp',       t: 'ECE Lesson Plan Guide',                  g: 'Ages 3-5',       l: 'ECE',                 s:  202345, e: true  },
    { k: 'new-lp-syllabi',   t: 'Lower Primary Syllabi',                  g: 'Grades 1-3',     l: 'Lower Primary',       s: 1913157, e: true, file: 'lower-primary-syllabi-grade-1-3-final-camera-redy-1.pdf' },
    { k: 'new-lp-sign',      t: 'Zambian Sign Languages',                 g: 'Grades 1-3',     l: 'Lower Primary',       s:  916594, e: true, file: 'zambian-sign-languages-grades-1-3.pdf' },
    { k: 'new-lp-math-weekly', t: 'Mathematics Weekly Plan',              g: 'Grade 1 Term 1', l: 'Lower Primary',       s:  715831, e: true },
    { k: 'new-up-math',      t: 'Mathematics',                            g: 'Grades 4-6',     l: 'Upper Primary',       s: 1393181, e: true, file: 'mathematics-syllabus-for-upper-primary-g4-6.pdf' },
    { k: 'new-up-science',   t: 'Science',                                g: 'Grades 4-5',     l: 'Upper Primary',       s: 1468816, e: true, file: 'science-upper-primary-syllabus-g4-5.pdf' },
    { k: 'new-up-social',    t: 'Social Studies',                         g: 'Grades 4-6',     l: 'Upper Primary',       s: 1465143, e: true, file: 'social-studies-upper-primary-g4-6.pdf' },
    { k: 'new-up-tech',      t: 'Technology Studies',                     g: 'Grades 4-6',     l: 'Upper Primary',       s: 2297876, e: true, file: 'technology-studies-upper-primary-g4-6.pdf' },
    { k: 'new-up-tech2',     t: 'Technology Studies (alt)',               g: 'Grades 4-6',     l: 'Upper Primary',       s:  799080, e: true, file: 'technology-studies-upper-primary.pdf' },
    { k: 'new-up-heh',       t: 'Home Economics & Hospitality',           g: 'Grades 4-6',     l: 'Upper Primary',       s: 1457802, e: true, file: 'home-economics-and-hospitality-g4-6-upper-primary.pdf' },
    { k: 'new-up-heh2',      t: 'Home Economics & Hospitality (2025)',    g: 'Grades 4-6',     l: 'Upper Primary',       s:  534140, e: true },
    { k: 'new-up-arts',      t: 'Expressive Arts',                        g: 'Grades 4-6',     l: 'Upper Primary',       s:  547725, e: true, file: 'expressive-arts-upper-primary-finalised-31-01-25.pdf' },
    { k: 'new-up-arts2',     t: 'Expressive Arts (alt)',                  g: 'Grades 4-6',     l: 'Upper Primary',       s: 1243664, e: true, file: 'expressive-arts-upper-primary-2.pdf' },
    { k: 'new-tech-g5',      t: 'Technology Studies (Home)',              g: 'Grade 5',        l: 'Upper Primary',       s:   39254, e: true  },
    { k: 'new-sec-math',     t: 'Mathematics',                            g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  868348, e: true, file: 'mathematics-o-level-forms-1-4.pdf' },
    { k: 'new-sec-math2',    t: 'Mathematics I (Validated 2024)',         g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:       0, e: true },
    { k: 'new-sec-math2b',   t: 'Mathematics II',                         g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  844866, e: true, file: 'mathematics-ii-syllabus.pdf' },
    { k: 'new-sec-eng',      t: 'English Language',                       g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1758301, e: true, file: 'english-sylabus-form-1-4-o-levelcamera-ready.pdf' },
    { k: 'new-sec-bio',      t: 'Biology',                                g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  870477, e: true, file: 'biology-sylabus-o-level-form-1-4.pdf' },
    { k: 'new-sec-chem',     t: 'Chemistry',                              g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  731338, e: true, file: 'chemistry-syllabus.pdf' },
    { k: 'new-sec-phys',     t: 'Physics',                                g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1899208, e: true, file: 'physics-syllabus-o-level-form-1-4.pdf' },
    { k: 'new-sec-geog',     t: 'Geography',                              g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1568271, e: true, file: 'geography-syllabus.pdf' },
    { k: 'new-sec-hist',     t: 'History',                                g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1142375, e: true, file: 'history-syllabus-forms-1-4.pdf' },
    { k: 'new-sec-civic',    t: 'Civic Education',                        g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  895123, e: true, file: 'civic-education-syllabus-science-o-level-syllabus-form-1-4.pdf' },
    { k: 'new-sec-relig',    t: 'Religious Education',                    g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  911427, e: true, file: 'religious-education-syllabus.pdf' },
    { k: 'new-sec-zamb',     t: 'Zambian Languages',                      g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1246466, e: true, file: 'zambian-languages-ordinary-level-syllabus-form-1-4-final.pdf' },
    { k: 'new-sec-french',   t: 'French Language',                        g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1015461, e: true, file: 'french-language.pdf' },
    { k: 'new-sec-lit',      t: 'Literature in English',                  g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  993543, e: true, file: 'literature-in-english-sylabus-o-level-form-1-4.pdf' },
    { k: 'new-sec-agri',     t: 'Agricultural Science',                   g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1033424, e: true, file: 'agricultural-science-o-level-syllabus-form-1-4.pdf' },
    { k: 'new-sec-comm',     t: 'Commerce & Principles of Accounts',      g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  534037, e: true, file: 'commerce-and-principles-of-accounts-sylabus-camera-ready-o-level-form-1-4.pdf' },
    { k: 'new-sec-comp',     t: 'Computer Science',                       g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  871754, e: true, file: 'computer-science-ordinary-syllabi-form-1-4.pdf' },
    { k: 'new-sec-ict',      t: 'ICT',                                    g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1205223, e: true, file: 'ict-ordinary-level-syllabus-forms-1-4.pdf' },
    { k: 'new-sec-art',      t: 'Art and Design',                         g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1610614, e: true, file: 'art-and-design-syllabus-final.pdf' },
    { k: 'new-sec-music',    t: 'Music & Performing Arts',                g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1432141, e: true, file: 'music-arts-o-level-syllabus-form-1-4-camera-ready-1.pdf' },
    { k: 'new-sec-pe',       t: 'Physical Education',                     g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 2354896, e: true, file: 'physical-education-syllabus-form-1-4.pdf' },
    { k: 'new-sec-fash',     t: 'Fashion and Fabrics',                    g: 'Forms 1-4',      l: 'O-Level (Secondary)', s: 1173727, e: true, file: 'fashion-and-fabrics-sylabus-o-level-form-1-4.pdf' },
    { k: 'new-sec-food',     t: 'Food and Nutrition',                     g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  649185, e: true, file: 'food-and-nutrition-syllabus-final-07-02-2024.pdf' },
    { k: 'new-sec-dt',       t: 'Design & Technology Studies',            g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  883567, e: true, file: 'design-and-technology-studies.pdf' },
    { k: 'new-sec-hosp',     t: 'Hospitality Management',                 g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  620887, e: true, file: 'hospitality-management.pdf' },
    { k: 'new-sec-tour',     t: 'Travel and Tourism',                     g: 'Forms 1-4',      l: 'O-Level (Secondary)', s:  631524, e: true, file: 'travel-and-tourism-syllabus.pdf' },
    { k: 'new-sp-id-ece',    t: 'Intellectual Disability — ECE',                g: 'Special Ed',          l: 'Special Education',   s:  972799, e: true, file: 'intellectual-disability-ece-syllabus-1.pdf' },
    { k: 'new-sp-id-eng',    t: 'Intellectual Disability — English',            g: 'Special Ed Levels I-III', l: 'Special Education', s: 323108, e: true, file: 'intellectual-disability-english-language-syllabus-level-i-3.pdf' },
    { k: 'new-sp-id-mat',    t: 'Intellectual Disability — Learning Materials', g: 'Special Ed Level I',  l: 'Special Education',   s:  742059, e: true },
  ],
  old: [
    { k: 'old-math-g5-7',  t: 'Mathematics',                  g: 'Grades 1-7',  l: 'Upper Primary G5-7',     s:  529364, e: true  },
    { k: 'old-eng-g2-7',   t: 'English Language',             g: 'Grades 2-7',  l: 'Upper Primary G5-7',     s:  658441, e: true },
    { k: 'old-sci-g1-7',   t: 'Integrated Science',           g: 'Grades 1-7',  l: 'Upper Primary G5-7',     s: 1296435, e: true },
    { k: 'old-soc-g1-7',   t: 'Social Studies',               g: 'Grades 1-7',  l: 'Upper Primary G5-7',     s:  733389, e: true },
    { k: 'old-zamb-g5-7',  t: 'Zambian Languages',            g: 'Grades 5-7',  l: 'Upper Primary G5-7',     s:  838453, e: true },
    { k: 'old-home-g5-7',  t: 'Home Economics',               g: 'Grades 5-7',  l: 'Upper Primary G5-7',     s:  800932, e: true },
    { k: 'old-tech-g5-7',  t: 'Technology Studies',           g: 'Grades 5-7',  l: 'Upper Primary G5-7',     s:  858517, e: true },
    { k: 'old-cts',        t: 'Creative and Technology Studies', g: 'Grades 1-4', l: 'Lower Primary G1-4',   s:  925897, e: true },
    { k: 'old-math-g10',   t: 'Mathematics',                  g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  821097, e: true },
    { k: 'old-amath-g10',  t: 'Additional Mathematics',       g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  894982, e: true },
    { k: 'old-bio-g10',    t: 'Biology',                      g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  638032, e: true },
    { k: 'old-chem-g10',   t: 'Chemistry',                    g: 'Grades 10-12', l: 'Senior Secondary G10-12', s: 1155613, e: true },
    { k: 'old-phys-g10',   t: 'Physics',                      g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  925338, e: true },
    { k: 'old-sci-g10',    t: 'Science 5124',                 g: 'Grades 10-12', l: 'Senior Secondary G10-12', s: 1621024, e: true },
    { k: 'old-geog-g10',   t: 'Geography',                    g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  534813, e: true },
    { k: 'old-history',    t: 'History',                      g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  543520, e: true  },
    { k: 'old-lit-g10',    t: 'Literature in English',        g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  552623, e: true },
    { k: 'old-home-g10',   t: 'Home Management',              g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  609685, e: true },
    { k: 'old-food-g10',   t: 'Food and Nutrition',           g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  675605, e: true },
    { k: 'old-fash-g10',   t: 'Fashion and Fabrics',          g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  776018, e: true },
    { k: 'old-dt-g10',     t: 'Design and Technology',        g: 'Grades 10-12', l: 'Senior Secondary G10-12', s: 1045822, e: true },
    { k: 'old-agri-g10',   t: 'Agricultural Science',         g: 'Grades 10-12', l: 'Senior Secondary G10-12', s:  998295, e: true },
  ],
}

const SUBJECT_ICONS = {
  'Mathematics': '🔢', 'Mathematics I (Validated 2024)': '🔢', 'Mathematics II': '📐', 'Additional Mathematics': '📐',
  'English Language': '📖', 'Literature in English': '📚', 'Zambian Languages': '🗣️', 'Zambian Sign Languages': '🤟', 'French Language': '🇫🇷',
  'Biology': '🧬', 'Chemistry': '⚗️', 'Physics': '⚛️', 'Integrated Science': '🔬', 'Science': '🔬', 'Science 5124': '🔬',
  'Geography': '🗺️', 'History': '📜', 'Civic Education': '⚖️', 'Religious Education': '✝️', 'Social Studies': '🌍',
  'Home Economics': '🍳', 'Home Economics & Hospitality': '🍳', 'Home Economics & Hospitality (2025)': '🍳', 'Home Management': '🏠',
  'Food and Nutrition': '🥗', 'Fashion and Fabrics': '🧵', 'Hospitality Management': '🏨', 'Travel and Tourism': '✈️',
  'Technology Studies': '🔧', 'Technology Studies (alt)': '🔧', 'Technology Studies (Home)': '🔧',
  'Design & Technology Studies': '⚙️', 'Design and Technology': '⚙️', 'Creative and Technology Studies': '🎨',
  'Agricultural Science': '🌾', 'Computer Science': '💻', 'ICT': '💻',
  'Art and Design': '🎨', 'Music & Performing Arts': '🎵', 'Expressive Arts': '🎭', 'Expressive Arts (alt)': '🎭', 'Physical Education': '⚽',
  'Commerce & Principles of Accounts': '💼',
  'Early Childhood Education': '🧒', 'ECE Syllabus (Jan 2025)': '🧒', 'ECE Mathematics': '🧮', 'ECE Lesson Plan Guide': '📝',
  'Lower Primary Syllabi': '📚', 'Mathematics Weekly Plan': '📅', 'National Curriculum Framework': '📋',
  'Intellectual Disability — ECE': '♿', 'Intellectual Disability — English': '♿', 'Intellectual Disability — Learning Materials': '♿',
}

export function syllabusIcon(title) {
  return SUBJECT_ICONS[title] || '📄'
}

export function formatSyllabusSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export const SYLLABI_TOTAL_COUNT =
  SYLLABI_CATALOG.new.length + SYLLABI_CATALOG.old.length
