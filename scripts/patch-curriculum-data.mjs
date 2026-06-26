/**
 * Patches public/syllabi/curriculum-data.json to fill syllabus coverage gaps:
 *
 *  1. English Language Syllabus — adds Grade 5 & Grade 6 (section says "Grades 4-6"
 *     but only Grade 4 was imported from the CDC PDFs).
 *  2. Upper Primary — adds Grade 7 rows for Mathematics, English Language,
 *     Integrated Science, Social Studies, and Technology Studies.
 *  3. Senior Secondary — adds Form 5 (Grade 12) rows to every existing Forms 1-4
 *     section so G12 teachers get topic suggestions.
 *  4. Secondary Sciences — adds Biology and Chemistry sections (Forms 1-5) which
 *     were entirely absent from the original import.
 *  5. Upper Primary & Junior Secondary Civic Education — adds Civic Education
 *     section for Grades 5-7 and Forms 1-2 (G8-G9).
 *
 * Run once: node scripts/patch-curriculum-data.mjs
 * Idempotent — skips any sheet that already exists so re-runs are safe.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const TARGET = join(__dir, '../public/syllabi/curriculum-data.json')

const data = JSON.parse(readFileSync(TARGET, 'utf8'))

// ── Helpers ───────────────────────────────────────────────────────────────

function rows(...entries) {
  return {
    rows: entries.flatMap(([topic, ...subtopics]) => {
      return subtopics.map((sub, i) => ({
        type: 'data',
        cells: {
          TOPIC: i === 0 ? topic : '',
          'SUB-TOPIC': sub,
          'SPECIFIC COMPETENCES': '',
          'LEARNING ACTIVITIES': '',
          'EXPECTED STANDARD': '',
        },
      }))
    }),
  }
}

function addSheet(section, sheetName, sheetData) {
  if (!data[section]) {
    data[section] = {}
    console.log(`  Created section: ${section}`)
  }
  if (data[section][sheetName]) {
    console.log(`  Skipped (exists): [${section}] → ${sheetName}`)
    return
  }
  data[section][sheetName] = sheetData
  console.log(`  Added: [${section}] → ${sheetName}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ENGLISH LANGUAGE — Grade 5 and Grade 6
//    (section already exists with Grade 4; extend it)
// ─────────────────────────────────────────────────────────────────────────────

const ENG_SECTION = 'English Language Syllabus (Grades 4-6)'

console.log('\n── English Language Grade 5 & 6 ──')

addSheet(ENG_SECTION, 'Grade 5', rows(
  ['Reading Comprehension',
    'Skimming and scanning for information',
    'Identifying the main idea and supporting details',
    'Answering comprehension questions in full sentences',
    'Vocabulary in context'],
  ['Grammar — Tenses',
    'Simple present, past and future tenses',
    'Present and past continuous tenses',
    'Using tenses in sentences and short paragraphs'],
  ['Composition Writing',
    'Narrative composition (personal experience)',
    'Descriptive composition',
    'Planning and organising paragraphs',
    'Writing a composition of 80-120 words'],
  ['Oral Communication',
    'Giving and following instructions',
    'Making announcements',
    'Participating in discussions'],
  ['Spelling and Vocabulary',
    'Common homophones and homonyms',
    'Word families and word building',
    'Using a dictionary to find meaning and spelling'],
))

addSheet(ENG_SECTION, 'Grade 6', rows(
  ['Reading Comprehension',
    'Inference and deduction from texts',
    'Identifying the author\'s purpose and tone',
    'Answering comprehension questions using evidence from the text',
    'Reading poetry and identifying literary devices'],
  ['Grammar — Sentence Structure',
    'Clauses and phrases',
    'Complex sentences (main and subordinate clauses)',
    'Active and passive voice',
    'Reported (indirect) speech'],
  ['Composition Writing',
    'Argumentative / persuasive writing',
    'Narrative and descriptive compositions (120-150 words)',
    'Using discourse markers for coherence',
    'Editing and proofreading own work'],
  ['Letter Writing',
    'Informal letters to friends and family',
    'Semi-formal letters (e.g. to a school authority)',
    'Correct layout: address, date, salutation, body, close'],
  ['Oral Communication',
    'Debating a motion',
    'Storytelling and oral composition',
    'Public speaking — short prepared speech'],
))

// ─────────────────────────────────────────────────────────────────────────────
// 2. GRADE 7 — English Language, Mathematics, Integrated Science,
//             Social Studies, Technology Studies
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Grade 7 English Language ──')
addSheet(ENG_SECTION, 'Grade 7', rows(
  ['Reading Comprehension',
    'Critical reading — evaluating arguments in a passage',
    'Identifying bias and fact vs opinion',
    'Extended comprehension questions requiring evidence and personal response',
    'Reading and interpreting non-fiction texts (news articles, reports)'],
  ['Grammar — Advanced Structures',
    'Conditional sentences (If-clauses — types 1 and 2)',
    'Modal verbs (must, should, might, would)',
    'Relative clauses (who, which, that)',
    'Punctuation — semicolons, colons and parentheses'],
  ['Composition Writing',
    'Argumentative composition (for and against)',
    'Descriptive composition with figurative language',
    'Narrative composition with dialogue',
    'Composition of 150-200 words with plan, draft and edit stages'],
  ['Formal Letter Writing',
    'Layout of a formal letter (address, date, salutation, body, complimentary close)',
    'Letter of complaint',
    'Letter of enquiry',
    'Formal vs informal register'],
  ['Summary Writing',
    'Identifying key points in a passage',
    'Writing a summary in own words',
    'Reducing a 200-word passage to a 60-word summary'],
  ['Oral Literature',
    'Oral traditions — proverbs, riddles, folktales',
    'Storytelling techniques',
    'Performing and responding to oral literature'],
))

console.log('\n── Grade 7 Mathematics ──')
addSheet('Mathematics Syllabus (Grades 4-6)', 'Grade 7', rows(
  ['Number and Place Value',
    'Directed numbers (positive and negative integers)',
    'Operations with directed numbers (+, −, ×, ÷)',
    'Order of operations (BODMAS)',
    'Prime factorisation and LCM / HCF'],
  ['Algebra',
    'Algebraic notation and substitution',
    'Simplifying expressions by collecting like terms',
    'Expanding brackets',
    'Solving linear equations in one variable (ax + b = c)',
    'Forming and solving equations from word problems'],
  ['Ratio and Proportion',
    'Expressing ratios in simplest form',
    'Dividing a quantity in a given ratio',
    'Direct proportion and the unitary method',
    'Percentage increase and decrease'],
  ['Geometry — Triangles',
    'Types of triangles (scalene, isosceles, equilateral)',
    'Angle sum of a triangle',
    'Properties of isosceles and equilateral triangles',
    'Introduction to Pythagoras\' theorem'],
  ['Geometry — Circles and Mensuration',
    'Parts of a circle (radius, diameter, circumference)',
    'Circumference and area of a circle (using π)',
    'Surface area of cuboids and cylinders',
    'Volume of prisms'],
  ['Statistics',
    'Collecting and organising data into frequency tables',
    'Drawing bar charts, pie charts and line graphs',
    'Mean, median and mode of ungrouped data',
    'Interpreting and comparing data from graphs'],
  ['Probability',
    'Language of probability (certain, likely, unlikely, impossible)',
    'Theoretical probability as a fraction',
    'Simple probability experiments (coins, dice)',
    'Experimental vs theoretical probability'],
))

console.log('\n── Grade 7 Integrated Science ──')
addSheet('Science Syllabus (Grades 4-6)', 'Grade 7', rows(
  ['Nutrition and Digestion',
    'Nutrients and their functions (carbohydrates, proteins, fats, vitamins, minerals)',
    'Food tests (Benedict\'s, iodine, biuret)',
    'The human digestive system — organs and their roles',
    'Balanced diet and malnutrition'],
  ['Electricity',
    'Static and current electricity',
    'Simple electric circuits — components and symbols',
    'Conductors and insulators',
    'Series and parallel circuits',
    'Safety precautions with electricity at home and school'],
  ['Reproduction in Plants',
    'Parts of a flower and their functions',
    'Pollination — self and cross-pollination',
    'Fertilisation and seed development',
    'Seed dispersal mechanisms (wind, water, animals)'],
  ['Reproduction in Animals',
    'Types of reproduction (asexual and sexual)',
    'Life cycles of familiar animals (frog, butterfly, mosquito)',
    'Human reproductive system (basic)',
    'Puberty and personal hygiene'],
  ['Soil and Environment',
    'Components of soil and their importance',
    'Soil erosion — causes and prevention',
    'Farming practices and soil conservation',
    'Environmental pollution — types and effects'],
  ['Matter and Materials',
    'States of matter and particle theory',
    'Physical and chemical changes',
    'Common chemical reactions (burning, rusting, neutralisation)',
    'Separation techniques (filtration, distillation, chromatography)'],
))

console.log('\n── Grade 7 Social Studies ──')
addSheet('Social Studies Syllabus (Grades 4-6)', 'Grade 7', rows(
  ['Government of Zambia',
    'The Constitution of Zambia',
    'Three arms of government — Executive, Legislature, Judiciary',
    'The President and Cabinet',
    'Parliament and the law-making process',
    'Elections and democracy'],
  ['Local Government',
    'Roles of local councils and district authorities',
    'Community services provided by local government',
    'Ward development committees and citizen participation'],
  ['The Zambian Economy',
    'Main sectors of the economy (agriculture, mining, tourism, services)',
    'The importance of copper mining',
    'Agricultural products and their markets',
    'Entrepreneurship and small businesses'],
  ['African Regional Organisations',
    'SADC — purpose and member states',
    'COMESA — purpose and member states',
    'African Union (AU) — structure and goals',
    'Zambia\'s role in regional organisations'],
  ['HIV, AIDS and Health',
    'HIV transmission and prevention',
    'Living positively with HIV',
    'AIDS and its effects on families and the community',
    'Accessing health services and support'],
  ['Natural Resources and Conservation',
    'Zambia\'s natural resources (land, water, forests, wildlife)',
    'National parks and game management areas',
    'Conservation laws and citizen responsibility'],
))

console.log('\n── Grade 7 Technology Studies ──')
addSheet('Technology Studies Syllabus (Grades 4-6)', 'Grade 7', rows(
  ['Technology and Society',
    'Impact of technology on daily life in Zambia',
    'Appropriate technology for rural and urban communities',
    'Sustainable use of technology',
    'Careers in technology'],
  ['Design and Problem Solving',
    'The design process (identify, plan, make, evaluate)',
    'Sketching and drawing solutions',
    'Testing and evaluating a designed product',
    'Presentation of design work'],
  ['Structures',
    'Types of structures (natural and manufactured)',
    'Forces on structures (compression, tension, shear)',
    'Building and testing a simple bridge or frame',
    'Materials and their suitability for structures'],
  ['Mechanisms',
    'Levers — types and uses',
    'Pulleys — single and compound',
    'Gears — gear ratios and direction of rotation',
    'Simple machines in everyday life'],
  ['Energy',
    'Forms of energy and energy conversion',
    'Renewable and non-renewable energy sources',
    'Energy conservation at home and school',
    'Simple electrical circuits in technology projects'],
  ['Information and Communication Technology',
    'Using a computer for word processing and spreadsheets',
    'The internet — searching and evaluating information',
    'Online safety and responsible use of technology',
    'Presenting information using ICT tools'],
))

// ─────────────────────────────────────────────────────────────────────────────
// 3. FORM 5 (GRADE 12) — add to every existing Forms 1-4 section
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Form 5 / Grade 12 data ──')

addSheet('Mathematics Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Further Algebra',
    'Quadratic equations — factorising and the quadratic formula',
    'Simultaneous equations (linear and quadratic)',
    'Inequalities and their graphical representation',
    'Functions — domain, range, inverse and composite functions'],
  ['Calculus — Introduction',
    'Gradient of a curve at a point',
    'Differentiation — power rule and basic derivatives',
    'Finding maximum and minimum values',
    'Integration as the reverse of differentiation'],
  ['Vectors',
    'Column vectors and position vectors',
    'Vector addition, subtraction and scalar multiplication',
    'Magnitude and direction of a vector',
    'Application of vectors to geometry problems'],
  ['Further Statistics',
    'Cumulative frequency curves (ogives)',
    'Quartiles, deciles and percentiles',
    'Histograms with unequal class widths',
    'Correlation and lines of best fit'],
  ['Circle Theorems and Trigonometry',
    'Circle theorems (angle at centre, angles in the same segment, cyclic quadrilaterals)',
    'Trigonometric ratios for angles beyond 90°',
    'The sine rule and cosine rule',
    'Area of a triangle using ½ab sin C'],
  ['Revision and Exam Preparation',
    'ECZ Grade 12 Mathematics Paper 1 (non-calculator)',
    'ECZ Grade 12 Mathematics Paper 2 (calculator allowed)',
    'Strategies for time management in the examination',
    'Common errors and how to avoid them'],
))

addSheet('Mathematics II Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Advanced Pure Mathematics',
    'Binomial theorem',
    'Sequences and series (arithmetic and geometric)',
    'Logarithms — laws and equations',
    'Complex numbers — introduction'],
  ['Mechanics',
    'Motion under constant acceleration (SUVAT equations)',
    'Newton\'s laws of motion — application to particles',
    'Connected particles and Atwood\'s machine',
    'Momentum and impulse'],
  ['Further Statistics',
    'Normal distribution and standard scores (z-scores)',
    'Probability distributions (binomial distribution)',
    'Hypothesis testing — concepts',
    'Examination past-paper practice'],
))

addSheet('Geography Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Development Issues',
    'Indicators of development (GDP, HDI, literacy, health)',
    'Uneven development between nations',
    'Aid, trade and debt in developing countries',
    'Sustainable development goals (SDGs) and Zambia'],
  ['Population and Resources',
    'World population growth and projections',
    'Population pyramids — analysis and interpretation',
    'Migration — voluntary and forced, push and pull factors',
    'Managing population growth'],
  ['Environmental Management',
    'Global climate change — evidence, causes and impacts',
    'Deforestation — extent, causes and management',
    'Water scarcity and management',
    'Pollution — air, water and land management strategies'],
  ['Regional and Economic Geography of Zambia',
    'Physical regions of Zambia and their characteristics',
    'Agricultural zones and cash crops',
    'Mining industry — history, current status and diversification',
    'Tourism and its economic significance'],
  ['Fieldwork and Geographical Skills',
    'Topographic map reading at 1:50 000',
    'Sketch maps and transects',
    'Statistical techniques — spearman\'s rank correlation',
    'Presenting and interpreting geographical data'],
))

addSheet('History Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Independence and Post-Independence Africa',
    'The independence movement in Zambia and its key figures',
    'The First Republic under Kaunda (UNIP)',
    'The Second and Third Republics — transition to multi-party democracy',
    'Post-independence challenges (economic, political, social)'],
  ['Cold War and Its Impact on Africa',
    'Origins and nature of the Cold War',
    'Super-power rivalry in Africa',
    'Impact of the Cold War on Southern Africa (Angola, Mozambique)',
    'Frontline States and Zambia\'s role'],
  ['The United Nations and International Relations',
    'Founding and structure of the UN',
    'UN peacekeeping operations in Africa',
    'The Non-Aligned Movement and Zambia',
    'International co-operation and its limitations'],
  ['Post-Colonial Economic Development',
    'Economic challenges after independence in Africa',
    'Structural Adjustment Programmes (SAPs) and their effects',
    'SADC and regional economic integration',
    'Globalisation and its impact on African economies'],
  ['Historical Skills and Examination Preparation',
    'Source analysis — reliability, usefulness and bias',
    'Extended essay writing — structure and argument',
    'Evaluating historical interpretations',
    'ECZ History Paper 1 (sources) and Paper 2 (essays) strategies'],
))

addSheet('Physics Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Electricity and Magnetism — Advanced',
    'Electromagnetic induction — Faraday\'s and Lenz\'s laws',
    'Transformers — construction and efficiency',
    'The national grid and AC power transmission',
    'Capacitors — charging, discharging and energy stored'],
  ['Atomic Physics and Radioactivity',
    'Structure of the atom — protons, neutrons, electrons',
    'Types of radioactive decay (alpha, beta, gamma)',
    'Half-life and radioactive decay curves',
    'Applications of radioactivity (medicine, industry, energy)',
    'Nuclear fission and fusion — principles and energy release'],
  ['Electronics',
    'Diodes — rectification (half-wave and full-wave)',
    'Transistors as switches and amplifiers',
    'Logic gates (AND, OR, NOT, NAND, NOR) and truth tables',
    'Simple electronic systems'],
  ['Further Mechanics and Waves',
    'Circular motion — period, frequency and centripetal force',
    'Simple harmonic motion (SHM) — concepts and examples',
    'Stationary waves and resonance',
    'Diffraction and interference of waves'],
  ['Examination Preparation',
    'ECZ Physics Paper 1 (multiple choice)',
    'ECZ Physics Paper 2 (structured questions)',
    'ECZ Physics Paper 3 (practical — design and analysis)',
    'Common examination errors and mark-scheme strategies'],
))

addSheet('Religious Education Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Religious Ethics and Contemporary Issues',
    'Religious perspectives on human rights and dignity',
    'Environmental ethics — stewardship and care of creation',
    'Bioethics — euthanasia, abortion, cloning (religious views)',
    'Poverty and social justice — faith responses'],
  ['Family, Gender and Society',
    'Religious teachings on marriage and family',
    'Gender equality and religious traditions',
    'Child rights and responsibilities',
    'HIV and AIDS — religious responses and care'],
  ['Peace, Justice and Conflict',
    'Just war theory — criteria and application',
    'Peace-building and reconciliation in Africa',
    'Role of religion in conflict resolution',
    'Capital punishment — religious perspectives'],
  ['Faith and Reason',
    'Arguments for and against the existence of God',
    'Science and religion — conflict or complementarity?',
    'Religious responses to suffering and evil (theodicy)',
    'The nature of faith and doubt in religion'],
  ['Examination Preparation',
    'Structured essay writing for RE examinations',
    'Comparing religious perspectives on set topics',
    'Source interpretation — religious texts and stimuli',
    'ECZ RE past-paper practice and mark-scheme analysis'],
))

addSheet('Literature in English Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Set Texts — Prose',
    'Character analysis — major and minor characters',
    'Themes and their development',
    'Narrative technique — point of view, flashback, symbolism',
    'Close reading and quotation skills'],
  ['Set Texts — Drama',
    'Structure of a play (acts, scenes, stage directions)',
    'Dramatic devices (soliloquy, aside, dramatic irony)',
    'Character motivation and conflict',
    'Staging and performance elements'],
  ['Set Texts — Poetry',
    'Form and structure of poems on the set list',
    'Imagery, diction and tone',
    'Comparing two poems on a theme',
    'Unseen poetry — analysis techniques'],
  ['Examination Skills',
    'Writing well-argued literary essays',
    'Using textual evidence (quotation and reference)',
    'Comparison questions — similarities and differences',
    'ECZ Literature Paper 1 (set texts) and Paper 2 (unseen) strategies'],
))

addSheet('Physical Education Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Individual Sports — Athletics',
    'Sprinting technique and starting blocks',
    'Middle-distance running (800m / 1500m) — pace and tactics',
    'Field events — long jump, high jump, javelin',
    'Officiating and organising athletic events'],
  ['Team Sports',
    'Football — advanced tactics and team systems',
    'Netball — positional play and defensive strategies',
    'Volleyball — setting, spiking and blocking',
    'Officiating and coaching principles'],
  ['Health and Fitness',
    'Principles of training (FITT principle)',
    'Components of fitness testing and interpretation',
    'Sports injuries — prevention and first aid',
    'Nutrition for sport and athletic performance'],
  ['Leadership and Organisation',
    'Planning and running a sports event',
    'Coaching and officiating skills',
    'Sports administration and management',
    'Career opportunities in sport and physical education'],
))

addSheet('ICT Syllabus (Forms 1-4)', 'Form 5', rows(
  ['Advanced Spreadsheets',
    'Complex formulas and nested functions (IF, VLOOKUP, HLOOKUP)',
    'Pivot tables and charts for data analysis',
    'Macros — recording and using simple macros',
    'Spreadsheet design and data validation'],
  ['Database Management',
    'Relational database concepts (tables, primary keys, foreign keys)',
    'Creating and querying a database (SQL basics: SELECT, WHERE, ORDER BY)',
    'Forms and reports in database software',
    'Database design for a small organisation'],
  ['Networking and the Internet',
    'Network topologies (star, bus, ring)',
    'Internet protocols (IP addresses, TCP/IP, HTTP)',
    'Cloud computing — advantages and risks',
    'Cybersecurity — threats (malware, phishing) and countermeasures'],
  ['Programming Concepts',
    'Variables, data types and assignment',
    'Sequence, selection (if-else) and iteration (loops)',
    'Procedures and functions',
    'Pseudocode and flowcharts — designing algorithms'],
  ['ICT and Society',
    'Impact of ICT on employment and society',
    'Digital divide — access and equity issues in Zambia',
    'Data protection and privacy (legislation and ethics)',
    'Emerging technologies and their implications'],
))

// ─────────────────────────────────────────────────────────────────────────────
// 4. BIOLOGY (Forms 1-5) — entirely new section
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Biology (Forms 1-5) — new section ──')

addSheet('Biology Syllabus (Forms 1-5)', 'Form 1', rows(
  ['Cell Biology',
    'Cell theory and the significance of cells',
    'Structure and function of plant and animal cells',
    'Comparison of plant and animal cells',
    'Prokaryotic vs eukaryotic cells'],
  ['Classification of Living Things',
    'The five kingdoms — characteristics and examples',
    'Vertebrates and invertebrates',
    'Dichotomous keys and their use',
    'Binomial nomenclature'],
  ['Nutrition in Plants',
    'Photosynthesis — equation, light and dark reactions (overview)',
    'Factors affecting the rate of photosynthesis',
    'Leaf structure and its adaptation for photosynthesis',
    'Mineral nutrition — nitrogen cycle and deficiency symptoms'],
  ['Nutrition in Animals',
    'Classes of food and their functions',
    'Digestion — mechanical and chemical',
    'The human alimentary canal — structure and function',
    'Absorption and assimilation of nutrients'],
  ['Cell Division',
    'Mitosis — stages and significance',
    'Meiosis — stages and significance',
    'Comparison of mitosis and meiosis',
    'Cancer as uncontrolled cell division'],
))

addSheet('Biology Syllabus (Forms 1-5)', 'Form 2', rows(
  ['Transport in Plants',
    'Xylem — structure and transport of water and mineral salts',
    'Phloem — structure and translocation of organic compounds',
    'Osmosis, diffusion and active transport in plants',
    'Transpiration — factors affecting rate; stomatal guard cells'],
  ['Transport in Animals',
    'Components of blood and their functions',
    'The human heart — structure and cardiac cycle',
    'Blood vessels — arteries, veins and capillaries',
    'Blood groups (ABO and Rh) and transfusion'],
  ['Gaseous Exchange',
    'Diffusion surfaces — principles and adaptations',
    'Human respiratory system — structure and ventilation',
    'Gas exchange in the alveoli',
    'Gas exchange in plants (through stomata and lenticels)'],
  ['Excretion',
    'Definition of excretion; excretory products',
    'The human kidneys — structure and ultrafiltration',
    'Reabsorption and urine formation',
    'Kidney failure and dialysis'],
  ['Ecological Concepts',
    'Biotic and abiotic components of an ecosystem',
    'Food chains, food webs and energy flow',
    'Nutrient cycles — carbon and nitrogen cycles',
    'Population growth and limiting factors'],
))

addSheet('Biology Syllabus (Forms 1-5)', 'Form 3', rows(
  ['Coordination — Nervous System',
    'Neurons — structure and types',
    'The reflex arc — components and significance',
    'The brain — regions and functions',
    'Synaptic transmission'],
  ['Coordination — Endocrine System',
    'Hormones — definition, target organs, examples',
    'The pituitary gland and its hormones',
    'Insulin, glucagon and blood glucose regulation',
    'Adrenaline and the fight-or-flight response'],
  ['Reproduction in Flowering Plants',
    'Structure of a flower and pollination mechanisms',
    'Double fertilisation in angiosperms',
    'Seed structure and germination conditions',
    'Vegetative propagation — natural and artificial'],
  ['Human Reproduction',
    'Male and female reproductive systems — structure and function',
    'The menstrual cycle and ovulation',
    'Fertilisation, implantation and embryo development',
    'Contraception methods and their mechanisms'],
  ['Genetics — Introduction',
    'DNA structure — double helix model',
    'Protein synthesis — transcription and translation (overview)',
    'Mendelian inheritance — monohybrid crosses',
    'Dominant, recessive and codominant alleles'],
))

addSheet('Biology Syllabus (Forms 1-5)', 'Form 4', rows(
  ['Genetics — Advanced',
    'Dihybrid crosses and independent assortment',
    'Sex-linked inheritance (haemophilia, colour blindness)',
    'Mutations — types, causes and effects',
    'Genetic screening and ethical issues'],
  ['Evolution',
    'Theory of natural selection — Darwin\'s evidence',
    'Variation — continuous and discontinuous',
    'Speciation and adaptive radiation',
    'Fossil evidence and comparative anatomy'],
  ['Ecology — Applied',
    'Human impact on ecosystems (deforestation, pollution)',
    'Conservation — in-situ and ex-situ methods in Zambia',
    'Sustainable use of resources',
    'Environmental impact assessment (EIA)'],
  ['Disease and Immunity',
    'Types of pathogens (bacteria, viruses, fungi, parasites)',
    'Malaria — lifecycle of Plasmodium, symptoms, prevention',
    'HIV/AIDS — transmission, progression and treatment',
    'Immunity — non-specific and specific defence mechanisms; vaccines'],
  ['Biotechnology',
    'Genetic engineering — recombinant DNA technology',
    'Applications in medicine (insulin, vaccines)',
    'GM crops — benefits and concerns',
    'Fermentation and its industrial applications'],
))

addSheet('Biology Syllabus (Forms 1-5)', 'Form 5', rows(
  ['Comprehensive Revision — Cells and Biochemistry',
    'Cell ultrastructure — EM-level detail of organelles',
    'Enzyme kinetics — Michaelis-Menten, inhibition, immobilised enzymes',
    'Respiration — glycolysis, Krebs cycle, electron transport chain',
    'Photosynthesis — light-dependent and light-independent reactions'],
  ['Comprehensive Revision — Systems Biology',
    'Homeostasis — blood glucose, temperature and water balance',
    'The immune system — B-cells, T-cells, antibodies, monoclonal antibodies',
    'Neurotransmitters and psychoactive drugs',
    'Hormonal control of the menstrual cycle (FSH, LH, oestrogen, progesterone)'],
  ['Comprehensive Revision — Genetics and Evolution',
    'Chromosomal mutations — Down\'s syndrome, Turner\'s syndrome',
    'Polyploidy and its significance in plant breeding',
    'Molecular evidence for evolution',
    'Hardy-Weinberg principle'],
  ['Examination Preparation',
    'ECZ Biology Paper 1 (multiple choice)',
    'ECZ Biology Paper 2 (structured and extended writing)',
    'ECZ Biology Paper 3 (practical — planning, analysis, evaluation)',
    'Exam technique and common marking-scheme expectations'],
))

// ─────────────────────────────────────────────────────────────────────────────
// 5. CHEMISTRY (Forms 1-5) — entirely new section
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Chemistry (Forms 1-5) — new section ──')

addSheet('Chemistry Syllabus (Forms 1-5)', 'Form 1', rows(
  ['States of Matter and Particle Theory',
    'States of matter — properties and arrangement of particles',
    'Changes of state — melting, boiling, condensing, freezing',
    'Diffusion — evidence and explanation',
    'Gas pressure and temperature'],
  ['Atoms, Elements and the Periodic Table',
    'Atomic structure — protons, neutrons and electrons',
    'Proton number and mass number',
    'The Periodic Table — periods and groups',
    'Metals and non-metals'],
  ['Chemical Bonding',
    'Ionic bonding — electron transfer and formation of ions',
    'Covalent bonding — electron sharing in small molecules',
    'Metallic bonding — delocalised electrons',
    'Dot-and-cross diagrams for simple molecules'],
  ['Formulae and Equations',
    'Chemical formulae — valency and writing formulae',
    'Word equations and symbol equations',
    'Balancing chemical equations',
    'Relative formula mass (Mr) and moles (introduction)'],
  ['Separation Techniques',
    'Filtration, evaporation and crystallisation',
    'Distillation (simple and fractional)',
    'Chromatography — principles and Rf values',
    'Choosing an appropriate separation technique'],
))

addSheet('Chemistry Syllabus (Forms 1-5)', 'Form 2', rows(
  ['Acids, Bases and Salts',
    'Properties of acids and bases',
    'The pH scale and indicators',
    'Neutralisation reactions and salt formation',
    'Preparation of salts (titration, precipitation, direct combination)'],
  ['Metals and Their Reactions',
    'Physical and chemical properties of metals',
    'The reactivity series of metals',
    'Reactions of metals with oxygen, water and acids',
    'Displacement reactions and competition'],
  ['Extraction of Metals',
    'Native metals and ore-based extraction',
    'Reduction of metal oxides by carbon',
    'Electrolytic extraction — aluminium',
    'Copper purification by electrolysis (relevant to Zambia)'],
  ['Electricity and Chemistry',
    'Electrolysis — electrolytes and electrodes',
    'Products at anode and cathode',
    'Electrolysis of brine (NaCl solution)',
    'Industrial applications of electrolysis'],
  ['Quantitative Chemistry',
    'Mole concept — Avogadro\'s number',
    'Molar mass and moles calculations',
    'Percentage composition and empirical formulae',
    'Reacting masses and limiting reagents'],
))

addSheet('Chemistry Syllabus (Forms 1-5)', 'Form 3', rows(
  ['Electrochemistry — Cells and Corrosion',
    'Electrochemical cells — standard electrode potential (introduction)',
    'Rusting of iron — conditions required and prevention',
    'Sacrificial protection and galvanising',
    'Rechargeable batteries and fuel cells (concepts)'],
  ['Rates of Reaction',
    'Factors affecting rate (concentration, temperature, surface area, catalyst)',
    'Collision theory — frequency and energy of collisions',
    'Measuring rates (gas collection, colour change, mass loss)',
    'Catalysts — homogeneous and heterogeneous'],
  ['Organic Chemistry — Introduction',
    'Homologous series and functional groups',
    'Alkanes — naming, structure, combustion, substitution',
    'Alkenes — naming, structure, addition reactions',
    'Alcohols — naming, structure, oxidation and fermentation'],
  ['Chemical Equilibrium',
    'Reversible reactions and dynamic equilibrium',
    'Le Chatelier\'s principle — effect of concentration, temperature and pressure',
    'The Haber process (nitrogen to ammonia)',
    'The Contact process (sulfur to sulfuric acid)'],
  ['Atmosphere and Environment',
    'Composition of the atmosphere',
    'Air pollution — sources and effects (CO, NOx, SOx, CO2)',
    'The greenhouse effect and climate change',
    'Water treatment and the water cycle'],
))

addSheet('Chemistry Syllabus (Forms 1-5)', 'Form 4', rows(
  ['Further Organic Chemistry',
    'Carboxylic acids — structure, reactions and esterification',
    'Esters — preparation and uses (flavourings, perfumes)',
    'Polymers — addition and condensation polymerisation',
    'Proteins — amino acids and peptide bonds (introduction)'],
  ['Energetics and Thermochemistry',
    'Exothermic and endothermic reactions — enthalpy changes',
    'Hess\'s law and enthalpy cycles',
    'Bond enthalpies — calculations',
    'Measuring enthalpy changes by calorimetry'],
  ['Redox Chemistry',
    'Oxidation numbers — assigning and changes in redox',
    'Half-equations for oxidation and reduction',
    'Balancing redox equations',
    'Oxidising and reducing agents in reactions'],
  ['Industrial Chemistry',
    'The petrochemical industry — cracking and reforming',
    'Fertilisers — ammonia, nitric acid and NPK',
    'Sodium hydroxide and chlorine (chlor-alkali industry)',
    'Green chemistry principles'],
  ['Analytical Chemistry',
    'Identifying cations by flame tests and precipitate reactions',
    'Identifying anions (carbonate, halide, sulfate, nitrate)',
    'Chromatography — paper and thin-layer',
    'Titration calculations — acid-base and redox'],
))

addSheet('Chemistry Syllabus (Forms 1-5)', 'Form 5', rows(
  ['Comprehensive Revision — Physical Chemistry',
    'Atomic structure — quantum model and electron configuration',
    'Periodicity — trends across periods and down groups',
    'Chemical thermodynamics — entropy and Gibbs free energy (introduction)',
    'Kinetics and equilibrium constant (Kc and Kp)'],
  ['Comprehensive Revision — Organic Chemistry',
    'Reaction mechanisms — free radical, electrophilic addition, nucleophilic substitution',
    'Aromatic chemistry — benzene structure and reactions',
    'Carbonyl compounds — aldehydes and ketones',
    'Amino acids and protein structure'],
  ['Comprehensive Revision — Inorganic Chemistry',
    'Transition metals — properties, complexes and catalysis',
    'Electrochemistry — standard electrode potentials and EMF',
    'Qualitative analysis of unknowns',
    'Environmental and industrial applications'],
  ['Examination Preparation',
    'ECZ Chemistry Paper 1 (multiple choice)',
    'ECZ Chemistry Paper 2 (structured questions and calculations)',
    'ECZ Chemistry Paper 3 (practical — design, analysis, planning)',
    'Exam technique — showing working, significant figures, unit errors'],
))

// ─────────────────────────────────────────────────────────────────────────────
// 6. CIVIC EDUCATION (Grades 5-7 and Forms 1-2)
//    Already in SUBJECT_GRADE_MAP for G5-G12 but no section in the JSON
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Civic Education ──')

addSheet('Civic Education Syllabus (Grades 5-9)', 'Grade 5', rows(
  ['Democracy and Governance',
    'Meaning and importance of democracy',
    'Democratic elections in Zambia',
    'Voting rights and responsibilities',
    'The rule of law'],
  ['Human Rights',
    'Universal human rights — the UDHR',
    'Children\'s rights (UNCRC)',
    'Rights and responsibilities of citizens',
    'Human rights violations — reporting and redress'],
  ['Good Citizenship',
    'Qualities of a good citizen',
    'Civic participation — community service and volunteering',
    'Patriotism and national symbols of Zambia',
    'Responsible use of public resources'],
))

addSheet('Civic Education Syllabus (Grades 5-9)', 'Grade 6', rows(
  ['Constitution of Zambia',
    'Purpose and importance of a constitution',
    'Key rights and freedoms in the Zambian Constitution',
    'Constitutional amendments — how and why',
    'Bill of Rights'],
  ['Local Government and Community',
    'Structure of local government in Zambia',
    'Role of ward councillors',
    'Community development and citizen participation',
    'Petitioning local authorities'],
  ['Gender and Society',
    'Gender equality — rights and responsibilities',
    'Harmful traditional practices and the law',
    'Gender-based violence — prevention and reporting',
    'Women in leadership in Zambia'],
))

addSheet('Civic Education Syllabus (Grades 5-9)', 'Grade 7', rows(
  ['National Identity and Patriotism',
    'National symbols and their significance',
    'National values — Unity, Respect, Loyalty, Dignity',
    'National days and commemorations',
    'Contributions of Zambian heroes'],
  ['Electoral Process',
    'Electoral Commission of Zambia (ECZ)',
    'Political parties — role and registration',
    'The voting process — from nomination to announcement',
    'Fair elections and election monitoring'],
  ['Anti-Corruption and Integrity',
    'Meaning and types of corruption',
    'Effects of corruption on national development',
    'Role of the Anti-Corruption Commission (ACC)',
    'Whistle-blowing and citizen responsibility'],
))

addSheet('Civic Education Syllabus (Grades 5-9)', 'Form 1', rows(
  ['The State and Government',
    'Characteristics of a state',
    'Forms of government — presidential and parliamentary systems',
    'Separation of powers — executive, legislative, judicial',
    'Checks and balances'],
  ['Democracy and Human Rights',
    'Types of democracy (direct and representative)',
    'Conditions for genuine democracy',
    'International human rights instruments',
    'Enforcement of human rights at national and international level'],
  ['Citizenship Responsibilities',
    'Paying taxes and supporting public services',
    'Obeying the law',
    'Participating in elections and civic processes',
    'Environmental stewardship as a civic duty'],
))

addSheet('Civic Education Syllabus (Grades 5-9)', 'Form 2', rows(
  ['Zambian Government Institutions',
    'The National Assembly — composition and powers',
    'The Executive — President, Vice-President and Cabinet',
    'The Judiciary — High Court, Supreme Court, Constitutional Court',
    'Independent institutions (ACC, ECZ, Human Rights Commission)'],
  ['National and International Law',
    'Sources of Zambian law (constitution, legislation, case law, custom)',
    'International law and treaties Zambia has ratified',
    'Conflict between national and international law',
    'The International Criminal Court (ICC)'],
  ['Economic Rights and Responsibilities',
    'Right to work and fair wages',
    'Consumer rights and protection',
    'Property rights and land tenure in Zambia',
    'Responsibilities of businesses to the community (CSR)'],
))

// ─────────────────────────────────────────────────────────────────────────────
// 7. CINYANJA / ZAMBIAN LANGUAGE (Grades 4-9)
//    Missing from every section above Grade 3
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Cinyanja / Zambian Language (Grades 4-9) ──')

const CINYANJA_SECTION = 'Cinyanja Syllabus (Grades 4-9)'

addSheet(CINYANJA_SECTION, 'Grade 4', rows(
  ['Kusoma (Reading)',
    'Kuzindikira mawu atsopano mu nkhani',
    'Kuyankha mafunso pa nkhani yoŵereŵeredwa',
    'Kufotokoza malingaliro a nkhani'],
  ['Kulemba (Writing)',
    'Kulemba ziganizo zokhwima',
    'Kusimba nkhani yachifundo',
    'Kufotokoza zinthu zomwe amaona'],
  ['Kutchula (Speaking)',
    'Kufotokoza za ntchito zamasiku onse',
    'Kuyankha mafunso pa chilankhulo',
    'Kuuza nthano yachindindzi'],
  ['Mawu Atsopano (Vocabulary)',
    'Mawu okhudzana ndi nyumba ndi banja',
    'Mawu okhudzana ndi sukulu ndi zophunzira',
    'Mawu okhudzana ndi chilengedwe'],
))

addSheet(CINYANJA_SECTION, 'Grade 5', rows(
  ['Kusoma (Reading)',
    'Kuwereŵera nkhani ndi kumvetsetsa',
    'Kuzindikira maganizo akulu a nkhani',
    'Kuyankha mafunso potsatira zolemba'],
  ['Kulemba (Writing)',
    'Kulemba kalata yachifundo',
    'Kulemba nkhani ya tsiku lililonse',
    'Kufotokoza mmene chinthu chimachitikira'],
  ['Mawu ndi Ziganizo',
    'Mitundu ya mawu (maina, zolemba, zochitika)',
    'Kumanga ziganizo zosiyana-siyana',
    'Kugwiritsa ntchito mawu oyenera'],
))

addSheet(CINYANJA_SECTION, 'Grade 6', rows(
  ['Kusoma ndi Kumvetsetsa',
    'Kuwereŵera nkhani ndi kufotokoza maganizo',
    'Kuzindikira cholinga cha wolemba',
    'Kuyankha mafunso ovuta pa nkhani'],
  ['Kulemba Zinthu Zosiyana',
    'Kulemba kalata yotchulidwa',
    'Kulemba nkhani yapakhomo ndi zapadziko',
    'Kulemba malingaliro pa nkhani'],
  ['Chilankhulo (Grammar)',
    'Mitundu ya maina (oyimira, olembeka)',
    'Ziganizo zapadziko — nthawi, malo, njira',
    'Mawu osakanizidwa (zogwirizana ndi mazina)'],
))

addSheet(CINYANJA_SECTION, 'Grade 7', rows(
  ['Kusoma ndi Kulingalira',
    'Kuwereŵera zolemba zosiyanasiyana — nkhani, ndakatulo, kalata',
    'Kuzindikira kuchuluka kwa malingaliro a cholemba',
    'Kuyankha mafunso potsatira zolemba zakulukulungwa'],
  ['Kulemba Zolemba Zokhwima',
    'Kulemba nkhani yakulukulungwa (mapiri, lipalanka)',
    'Kulemba kalata yolembedwa bwino',
    'Kulemba zolemba za mitsogolo — ndondomeko ya maganizo'],
  ['Chilankhulo Chozama',
    'Ziganizo zophatikizana (zoima, zosagawa)',
    'Mawu a kusogola (adverbs of manner, time, place)',
    'Kulemba mfundo zoyamba ndi mfundo zosinthira'],
))

addSheet(CINYANJA_SECTION, 'Form 1', rows(
  ['Kusoma ndi Kuongola Maganizo',
    'Kuwereŵera ndakatulo — malingaliro ndi moyo wa wolemba',
    'Kuzindikira chifanizo, kamvekedwe ka mawu',
    'Kuyankha mafunso pokondweretsa mmene chikhala'],
  ['Kulemba ndi Kapangidwe',
    'Kulemba nkhani ya mapiri ndi lipalanka (200+ mawu)',
    'Kulemba kalata yaungoni — kapangidwe ndi chilankhulo',
    'Kufotokoza ndakatulo yawiriwirizano'],
  ['Chilankhulo Chozama',
    'Mitundu ya ziganizo (zoyimira, zolandiridwa)',
    'Kugwiritsa ntchito mawu osatengeka mosauka',
    'Kulemba zolemba zopanda zolakwa'],
))

addSheet(CINYANJA_SECTION, 'Form 2', rows(
  ['Kulemba ndi Kuwereŵera za Chipangano',
    'Kuwereŵera zolemba za umoyo — mipepala, makampani, boma',
    'Kulemba kalata yofulumira — muliro, madzi, thupi',
    'Kuzindikira cholinga ndi ophunzitsidwa a cholemba'],
  ['Ndakatulo ndi Nthano',
    'Kufotokoza nthano zachibantu — njira, mphunzitso',
    'Kulemba ndakatulo ya malingaliro ake',
    'Kuyezetsa ndi kuyamikira ndakatulo ya ena'],
  ['Chilankhulo Chosinthiratu',
    'Mawu a chilankhulo chachibantu — kungosintha',
    'Ziganizo zachilankhulo cha amayi — mtundu wa nkhani',
    'Kuphunzitsa eni a chilankhulo — kupima malemba'],
))

// ─────────────────────────────────────────────────────────────────────────────
// 8. ENGLISH LANGUAGE (Forms 1-4) — missing entirely; add it
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── English Language (Forms 1-4/5) ──')

const FORMS_ENG_SECTION = 'English Language Syllabus (Forms 1-5)'

addSheet(FORMS_ENG_SECTION, 'Form 1', rows(
  ['Reading Comprehension',
    'Identifying main idea, supporting details and author\'s purpose',
    'Inference and deduction from written texts',
    'Vocabulary in context — deducing meaning from surrounding text',
    'Reading and responding to different text types (report, article, story)'],
  ['Grammar and Language Use',
    'Tense review — simple, continuous and perfect tenses',
    'Conditional sentences — Types 1 and 2',
    'Modal verbs — must, should, could, might, would',
    'Active and passive voice'],
  ['Writing',
    'Formal letter — layout and appropriate register',
    'Narrative composition — planning, drafting, editing',
    'Descriptive writing — using sensory language',
    'Paragraph structure and coherence devices'],
  ['Oral English',
    'Giving clear oral presentations',
    'Participating in structured discussions',
    'Listening for specific information and responding',
    'Pronunciation and intonation'],
))

addSheet(FORMS_ENG_SECTION, 'Form 2', rows(
  ['Reading Comprehension',
    'Analysing argument and counter-argument in texts',
    'Evaluating the reliability and bias of a source',
    'Extended comprehension — personal response questions',
    'Comparing two texts on a similar theme'],
  ['Grammar and Language Use',
    'Relative clauses (defining and non-defining)',
    'Reported speech — statements, questions and commands',
    'Subjunctive mood — formal and literary use',
    'Punctuation for complex sentences'],
  ['Writing',
    'Argumentative essay — presenting a balanced case',
    'Summary writing — reducing a 300-word passage to 80 words',
    'Report writing — structure and formal register',
    'Editing and proofreading for accuracy'],
  ['Literature and Oral',
    'Responding to a short story extract — character and theme',
    'Interpreting a poem — imagery, tone and theme',
    'Group debates — proposing and opposing a motion',
    'Storytelling — structure and delivery'],
))

addSheet(FORMS_ENG_SECTION, 'Form 3', rows(
  ['Reading and Critical Response',
    'Critical reading — identifying assumptions and logical fallacies',
    'Evaluating the effectiveness of a writer\'s techniques',
    'Synthesising information from multiple sources',
    'Reading academic and non-fiction texts efficiently'],
  ['Advanced Grammar',
    'Participle clauses and absolute constructions',
    'Inversion for emphasis (Rarely has..., Only when...)',
    'Nominalisations and formal academic style',
    'Register shifts — formal, semi-formal and informal'],
  ['Extended Writing',
    'Discursive essay — evaluating different perspectives',
    'Directed writing — article, speech, interview transcript',
    'Controlled assessment: extended piece of writing',
    'Referencing and avoiding plagiarism'],
  ['Language and Context',
    'Language change — borrowing, coinage, semantic shift',
    'Dialect, accent and standard English',
    'Language and power in media texts',
    'Advertising language — techniques and evaluation'],
))

addSheet(FORMS_ENG_SECTION, 'Form 4', rows(
  ['Reading — Set Texts',
    'Novel/short stories — character, plot, theme and style',
    'Drama — staging, soliloquy, dramatic irony',
    'Poetry — imagery, voice, form and structure',
    'Comparing texts — similarities and differences in purpose and technique'],
  ['Writing — Advanced',
    'Literary essay — sustained argument using textual evidence',
    'Creative writing — using literary techniques (voice, structure)',
    'Analytical writing — close reading and language analysis',
    'Timed writing under examination conditions'],
  ['Language in Use',
    'Spoken language — features of speech and conversation',
    'Media language — newspapers, social media and rhetoric',
    'Language and identity — accent, dialect, code-switching',
    'Language and gender — linguistic features of gendered speech'],
  ['Examination Preparation',
    'ECZ English Language Paper 1 — reading and comprehension',
    'ECZ English Language Paper 2 — writing tasks',
    'Strategies for directed writing and summary writing',
    'Editing for accuracy under timed conditions'],
))

addSheet(FORMS_ENG_SECTION, 'Form 5', rows(
  ['Advanced Literary Study',
    'Comparing two texts in depth — method, purpose and effect',
    'Unseen poetry — confident analytical approach',
    'Evaluating how context shapes text meaning',
    'Independent reading — responding to a text of choice'],
  ['Extended Writing and Examination',
    'Crafting high-level argumentative essays',
    'Timed writing — precision and economy',
    'ECZ Paper 1 (comprehension and summary) — past-paper practice',
    'ECZ Paper 2 (composition and directed writing) — past-paper practice'],
  ['Language Investigation',
    'Investigating language change or variation (mini-project)',
    'Presenting linguistic evidence and argument',
    'Comparing findings with published research',
    'Oral presentation of investigation outcomes'],
))

// ─────────────────────────────────────────────────────────────────────────────
// Update STUDIO_SUBJECT_TO_KB for new sections (also needs syllabusMapping.js)
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: syllabusMapping.js must also be updated to include:
//   'Biology Syllabus (Forms 1-5)': 'biology'
//   'Chemistry Syllabus (Forms 1-5)': 'chemistry'
//   'Civic Education Syllabus (Grades 5-9)': 'civic_education'
//   'Cinyanja Syllabus (Grades 4-9)': 'cinyanja'
//   'English Language Syllabus (Forms 1-5)': 'english'
// This script only patches the JSON; see syllabusMapping.js for the code change.

// ─────────────────────────────────────────────────────────────────────────────

writeFileSync(TARGET, JSON.stringify(data, null, 2), 'utf8')
console.log('\n✓ curriculum-data.json written successfully.')

// Summary
console.log('\n── Summary ──')
for (const [section, sheets] of Object.entries(data)) {
  const keys = Object.keys(sheets)
  if (keys.length > 0) {
    console.log(`  ${section}: [${keys.join(', ')}]`)
  }
}
