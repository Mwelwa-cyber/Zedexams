#!/usr/bin/env node
/**
 * repair-re-form1-topics.mjs
 * ==========================
 * Rebuilds the corrupted topics 1.1-1.4 of Religious Education Form 1.
 *
 * The PDF extraction badly mangled the top of this sheet: the topic headers
 * "1.1 LEARNING ABOUT RELIGION", "1.2 GROWING UP" and "1.4 CHOOSING AND
 * TALENTS" were dropped, several whole sub-topics (1.1.1, 1.2.1, 1.2.3, 1.3.2,
 * 1.4.1) went missing, and some competence cells were merged across rows (e.g.
 * 1.1.2.1 fused with 1.2.1.2). In the studio pickers this shows as orphaned
 * sub-topics (1.1.2, 1.2.2 with no parent; 1.4.2/1.4.3 under 1.3) and gaps.
 *
 * The first eight rows (indices 0-7, everything before the intact
 * "1.5 COMPETITION, CO-OPERATION AND TRUST" header) are replaced with the
 * complete 1.1-1.4 structure transcribed verbatim from
 * RELIGIOUS-EDUCATION-SYLLABUS.pdf pp.3-8. Topics 1.5 and 1.6 are already
 * correct and are left untouched. Nothing is invented — every title,
 * competence, activity and standard comes from the source pages.
 *
 * Idempotent: fires only while row 0 is not already the rebuilt
 * "1.1 LEARNING ABOUT RELIGION" / "1.1.1 The Idea of Religion". Keeps both data
 * copies byte-identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Religious Education Syllabus (Forms 1-4)'
const SHEET = 'Form 1'

const B = (...items) => items.map((s) => `• ${s}`).join('\n')
const row = (TOPIC, SUB, COMP, ACT, STD) => ({
  type: 'data',
  cells: { TOPIC, 'SUB-TOPIC': SUB, 'SPECIFIC COMPETENCES': COMP, 'LEARNING ACTIVITIES': ACT, 'EXPECTED STANDARD': STD },
})

// Topics 1.1-1.4, verbatim from RELIGIOUS-EDUCATION-SYLLABUS.pdf pp.3-8.
const REBUILT = [
  row('1.1 LEARNING ABOUT RELIGION', '1.1.1 The Idea of Religion', "1.1.1.1 Recognise other people's Religions",
    B('Describing Religion',
      'Evaluating how religion began (Songs, Proverbs, Laws, Myths, Theories…)',
      'Analysing ways of learning about religion (see and imitate, they read and are taught, they hear and repeat…)'),
    "• Other people's Religions recognised accordingly"),
  row('', '', '1.1.1.2 Appreciate Religious Education in day to day living',
    B('Describing Religious Education',
      "Explaining the purpose of Religious Education in school and society (Understanding different religions, respecting other people's faith, Promote tolerance…)",
      'Justifying the importance of Religious Education in society (Promotes Unity, tolerance, Creating order in Society, Helping solve problems)'),
    '• Religious Education in day today living appreciated accordingly.'),
  row('', '1.1.2 Four Religions in Zambia', '1.1.2.1 Evaluating the four Religions in Zambia',
    B('Identifying the four religions in Zambia (Christianity, Hinduism, Islam and Zambian Traditional Religion)',
      'Describing the historical development of four Religions in Zambia (Important dates)',
      'Identifying the scriptures of the four religions in Zambia (Christianity; Bible, Islam; Quran and Hadith, Hinduism; Vedas, Bhagavad-Gita, Mahabharata, Isha Upanishads; Zambian Traditional Religion; Proverbs and Songs…)',
      'Describing the composition of scriptures of the four religions.'),
    '• Four Religions evaluated accordingly'),
  row('1.2 GROWING UP', '1.2.1 Types of growth', '1.2.1.1 Analyse types of growth',
    B('Explaining the meaning of growth',
      'Identifying the types of growth (physical, intellectual, social, emotional, spiritual, aesthetic)',
      'Analysing each type of growth',
      'Comparing characteristics of living and non-living things (Plants, Animal, Human Beings, Stones…)'),
    '• Types of growth analysed appropriately'),
  row('', '', '1.2.1.2 Demonstrate responsible citizenship in growing up',
    B('Explaining responsible citizenship',
      'Identifying qualities of a responsible citizen',
      'Applying sense of responsibility as you grow up'),
    '• Responsible citizenship in growing up demonstrated accordingly'),
  row('', '', '1.2.1.3 Care for the environment',
    B('Identifying ways of using the environment properly (Afforestation, Re-afforestation, waste management…)',
      'Applying ways of caring for the environment'),
    '• Environment cared for appropriately'),
  row('', '1.2.2 Different ways people develop', '1.2.2.1 Demonstrate different ways people develop',
    B('Describing different ways in which people develop (Being with God, Being with other People and Using Natural resources wisely)',
      'Explaining ways of maintaining good relations with God and other people (Reading religious texts, prayer, sharing with others, belonging to groups…)'),
    '• Different ways people develop demonstrated adequately.'),
  row('', '1.2.3 Growing up in different religions (Hinduism, Islam, Christianity and ZTR)', '1.2.3.1 Communicate teachings of different religions on growing up',
    B('Discussing different teachings',
      'Analysing growing up in different religions; Zambian Traditional Religion (Learn from elders through stories, myths, and folk stories), Hinduism (Parents have responsibility to teach their children), Islam (Children are expected to grow into good Muslim adults), Christianity (Parents are to train children in the way they should go (Proverbs 22:6))',
      'Applying values of religious teachings on growing in real life situation.'),
    '• Teachings of different religions on growing up communicated accordingly'),
  row('1.3 MORALITY AND VALUES', '1.3.1 Morality', '1.3.1.1 Apply moral principles in daily living',
    B('Describing morality',
      'Discussing opinions on what is right and wrong',
      'Analysing consequences of moral and immoral actions',
      'Showing ways of applying moral principles in daily living'),
    '• Moral principles applied in daily living accordingly'),
  row('', '', '1.3.1.2 Analyse moral dilemmas',
    B('Describing moral dilemma',
      'Analysing moral dilemmas (difficult moral situations that people find themselves in; choosing between two conflicting morals or behaviours)',
      'Applying critical thinking in solving moral dilemmas'),
    '• Moral dilemmas analysed accordingly.'),
  row('', '1.3.2 Sources of moral codes', '1.3.2.1 Differentiate sources of religious and secular moral codes',
    B('Identifying Religious sources of moral codes (Christianity – Bible Exodus 20:1-17, Rom. 13:1-7, 8-14. Islam – Quran 82:13-14; 17:70 and Hadit Hinduism – Bhagavad Gita 2:56; 3:19, Zambia Traditional Religion - Proverbs, Songs)',
      'Identifying none Religious sources of moral codes (Family, School, Friends, Constitution and Community)',
      'Evaluating religious and secular moral codes'),
    '• Sources of religious and secular moral codes differentiated accordingly'),
  row('1.4 CHOOSING AND TALENTS', '1.4.1 Making Choices', "1.4.1.1 Accept responsibility for one's choices",
    B('Describing how people make choices (See, Judge and Act)',
      'Differentiating chosen and unchosen circumstances (Chosen circumstances: friends, hobbies, career, marriage: Unchosen circumstances Race, Gender, parentage)',
      'Identifying the different levels of choices (Individual, Family and Community)',
      'Role playing acceptance of responsibility of our choices'),
    "• Responsibility for one's choice accepted accordingly"),
  row('', '', '1.4.1.2 Evaluate decision making steps',
    B('Identifying steps of decision making see, Judge, Act',
      'Evaluating decision making in real life situation'),
    '• Decision making evaluated accordingly'),
  row('', '1.4.2 Central teachings on making choices in the four religions in Zambia', '1.4.2.1 Analyse central teachings on making choices in the four religions',
    B('Identifying Central teachings of the four religions in Zambia on making choices',
      'Evaluating Central teachings on making choices from four religions (Hinduism, Christianity, Islam and Zambian Traditional Religion)'),
    '• Central teachings on making choices in the four religions analysed accordingly'),
  row('', '1.4.3 Talents', '1.4.3.1 Use talent as a source of earning a living',
    B('Exploring ways talents could be a source of earning a living',
      'Exploring how one can discover talent (trying different things,)',
      'Demonstrating how one can develop a talent (Regular Practice)',
      'Demonstrating how one can lose a talent (the Parable of Talents Mt 25:14-30)'),
    '• Talent as a source of earning a living used skillfully'),
  row('', '', '1.4.3.2 Develop talent to promote entrepreneurship',
    B('Identifying talents that can develop into entrepreneurial ventures (Tailoring, hair dressing, sports…)',
      "Demonstrate how one's talent can promote entrepreneurship"),
    '• Talent to promote entrepreneurship developed accordingly'),
]

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  const alreadyDone = /^1\.1 LEARNING ABOUT RELIGION/.test(String(sheet.rows[0]?.cells?.TOPIC || '')) &&
    /^1\.1\.1 The Idea of Religion/.test(String(sheet.rows[0]?.cells?.['SUB-TOPIC'] || ''))
  const boundary = sheet.rows.findIndex((r) => r.type === 'data' && /^\s*1\.5\b/.test(String(r.cells?.TOPIC || '')))
  if (boundary < 0) throw new Error('1.5 boundary header not found — aborting')

  let changed = false
  if (!alreadyDone) {
    sheet.rows.splice(0, boundary, ...REBUILT)
    changed = true
  }

  console.log(`\n=== RE Form 1 · rebuild topics 1.1-1.4 ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  console.log(`  replaced ${boundary} corrupted row(s) with ${REBUILT.length} source-verified rows`)
  console.log(`  status: ${changed ? 'rebuilt' : 'already rebuilt (no-op)'}`)

  if (APPLY && changed) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && changed) {
    console.log('\nDry-run — re-run with --apply to write.')
  }
  return changed
}

run()
