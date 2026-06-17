/**
 * Seed the 2013 (OBC) Mathematics syllabus Grade 6 sheet into
 * curriculum-data-2013.json (both public/ and functions/ copies).
 *
 * Why: the existing Mathematics "Grade 6" sheet yielded 0 topics (its rows
 * didn't parse), so SBA Mathematics at Grade 6 had no topics/outcomes for the
 * dropdowns or AI grounding. This replaces it with a clean Grade 6 sheet
 * transcribed from the official Mathematics Syllabus (Grades 1–7, 2013),
 * pp. 38–43, in the shape the 2013 parser understands:
 *   columns: [<topic col>, TOPIC, SPECIFIC OUTCOMES, KNOWLEDGE, SKILLS, VALUES]
 *
 * Idempotent. Run: node scripts/seed-2013-maths-g6.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const SUBJECT = 'Mathematics Syllabus (Grades 1-7, 2013)'
const GRADE = 'Grade 6'
const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

// Transcribed from the syllabus PDF (Grade 6, pp. 38–43).
const ENTRIES = [
  { topic: '6.1 INDEX NOTATION', outcomes: '6.1.1 Describe index notation. 6.1.2 Change a number in index form to standard notation and vice versa. 6.1.3 Evaluate numbers in index notation with positive base and indices.', knowledge: ['Describing index notation as the repetition of multiplication of numbers with the same base (2x2x2 = 2³)', 'Expanded notation with positive bases and powers ranging from 1 to 5', 'Evaluating numbers in index notation with positive base and indices'] },
  { topic: '6.2 SETS', outcomes: '6.2.1 Describe the intersection and union in a Venn diagram. 6.2.2 Use symbols of intersection, union and subset. 6.2.3 Find number of subsets of a given set using the formula 2ⁿ. 6.2.4 Apply the knowledge of sets in real life situations.', knowledge: ['Intersection (including subset and disjoint sets) and union set in a Venn diagram', 'Symbolisation of intersection, union and subset', 'Subsets of a given set by listing and using the formula 2ⁿ', 'Applying the knowledge of sets in real life situations (intersection, union and subset)'] },
  { topic: '6.3 PRIME FACTORS', outcomes: '6.3.1 Identify prime and composite numbers. 6.3.2 Identify prime factors of given numbers.', knowledge: ['Prime and composite numbers', 'Prime factors of given numbers', 'Express a number as a product of its prime factors'] },
  { topic: '6.4 FRACTIONS', outcomes: '6.4.1 Multiply fractions by whole numbers. 6.4.2 Multiply a fraction by another fraction. 6.4.3 Divide fractions by whole numbers. 6.4.4 Divide whole numbers by fractions. 6.4.5 Divide fractions by fractions. 6.4.6 Apply fractions to solve problems in real life.', knowledge: ['Understanding the concept of multiplication of fractions', 'Multiplying fractions by whole numbers and a fraction by another fraction', 'Understanding the concept of division of fractions', 'Dividing fractions by whole numbers, whole numbers by fractions, and a fraction by another fraction', 'Applying multiplication and division of fractions to solve problems in real life'] },
  { topic: '6.5 DECIMALS', outcomes: '6.5.1 Describe decimal numbers by their names (up to 3 decimal places). 6.5.2 Add and subtract decimal numbers up to 3 decimal places. 6.5.3 Multiply decimal numbers. 6.5.4 Divide decimal numbers by decimal numbers (up to 3 decimal places, including remainder).', knowledge: ['Describing decimal numbers by their names (up to 3 decimal places)', 'Adding and subtracting decimal numbers up to 3 decimal places', 'Multiplication and division of decimals up to 3 decimal places'] },
  { topic: '6.6 APPROXIMATION', outcomes: '6.6.1 Round off to the nearest unit. 6.6.2 Round off to the nearest decimal places. 6.6.3 Solve simple problems involving required number of decimal places.', knowledge: ['Rounding off to the nearest ten, hundred and thousand', 'Rounding off to the given decimal places (1, 2 and 3 decimal places)', 'Applying approximation in real life situations', 'Relating approximation with measurements'] },
  { topic: '6.7 RATIO AND PROPORTION', outcomes: '6.7.1 Describe ratio and direct proportion. 6.7.2 Differentiate between ratio and direct proportion. 6.7.3 Express a given ratio in its lowest term. 6.7.4 Solve problems involving ratio and direct proportion.', knowledge: ['Describing ratio and direct proportion', 'Relating ratio and direct proportion with number patterns and mappings', 'Reduction of ratio to lowest term', 'Unitary and proportional methods', 'Real life problems involving direct proportion (e.g. exchange rates, measures)'] },
  { topic: '6.8 SOCIAL AND COMMERCIAL ARITHMETIC', outcomes: '6.8.1 Describe cost price, selling price, profit and loss. 6.8.2 Calculate cost price, selling price, profit and loss. 6.8.3 Calculate simple interest, discount, and profit and loss percentage. 6.8.4 Carry out calculations involving transportation.', knowledge: ['Cost price (CP) and Selling price', 'Profit and loss', 'Calculations involving cost price, selling price, profit and loss in real life', 'Time tabling in transportation; Fare chart (bus, train, marine and air)', 'Distance charts (ready reckoner)'] },
  { topic: '6.9 STATISTICS', outcomes: '6.9.1 Describe averages or measures of central tendency. 6.9.2 Solve problems involving averages.', knowledge: ['Averages or measures of central tendency (mean, mode and median)', 'Problems involving averages'] },
  { topic: '6.10 LINEAR EQUATIONS IN ONE VARIABLE', outcomes: '6.10.1 Describe an open sentence. 6.10.2 Solve linear equations in one variable.', knowledge: ['Open sentences', 'Linear equations in one variable', 'Applying linear equations in one variable in real life situations'] },
  { topic: '6.11 PLANE SHAPES', outcomes: '6.11.1 Identify regular polygons up to six sides. 6.11.2 Draw pentagon and hexagon.', knowledge: ['Identifying regular polygons up to six sides', 'Drawing pentagon and hexagon using set square, protractor and compass'] },
  { topic: '6.12 MEASUREMENT', outcomes: '6.12.1 Find the total length of edges of cube and cuboid. 6.12.2 Find the total surface area of cube and cuboid. 6.12.3 Describe the meaning of speed. 6.12.4 Calculate speed using distance and time.', knowledge: ['Faces, vertices and edges of cube and cuboid', 'Total length of edges of cube and cuboid', 'Total surface area of cube and cuboid', 'Meaning of speed (at this level avoid use of average speed)', 'Calculating speed, distance and time using their relationship (s × t = d)'] },
]

const topicCol = ENTRIES[0].topic
const sheet = {
  title: GRADE.toUpperCase(),
  columns: [topicCol, 'TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES'],
  rows: ENTRIES.map((e) => ({
    type: 'data',
    cells: {
      [topicCol]: e.topic,
      'TOPIC': '',
      'SPECIFIC OUTCOMES': e.outcomes,
      'KNOWLEDGE': e.knowledge.map((k) => `• ${k}`).join(' '),
      'SKILLS': 'Application of knowledge',
      'VALUES': 'Awareness and accuracy',
    },
  })),
}

for (const file of FILES) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data[SUBJECT]) throw new Error(`Subject not found in ${file}: ${SUBJECT}`)
  data[SUBJECT][GRADE] = sheet
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log(`Updated ${file}: Mathematics ${GRADE} (${ENTRIES.length} topics)`)
}
