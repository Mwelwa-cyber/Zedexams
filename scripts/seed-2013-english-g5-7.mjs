/**
 * Seed the 2013 (OBC) English Language syllabus for Grades 5, 6 and 7 into
 * curriculum-data-2013.json (both the public/ and functions/ copies).
 *
 * Why this exists: the 2013 English sheets shipped with Grade 2–4 only — the
 * Grade 5–7 content (which SBA is assessed against) was missing, so the SBA
 * Studio's topic/outcome pickers and the AI grounding had nothing to draw on
 * for English. This transcribes the official "English Language Syllabus
 * (Grades 2–7, 2013)" Grade 5–7 tables (Component → Topic → Specific outcomes
 * → Knowledge) into the same sheet shape the 2013 parser already understands:
 *
 *   columns: [<topic column>, "TOPIC", "SPECIFIC OUTCOMES", "KNOWLEDGE",
 *             "SKILLS", "VALUES"]
 *   rows:    one per topic; the first (topic) column carries the topic name,
 *            which detect2013TopicColumn() picks up; KNOWLEDGE bullets become
 *            sub-topic suggestions; SPECIFIC OUTCOMES are split on the numbered
 *            "x.y.z" prefixes by the server.
 *
 * Idempotent: re-running overwrites exactly the three Grade 5/6/7 sheets.
 *
 * Run: node scripts/seed-2013-english-g5-7.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const SUBJECT = 'English Language Syllabus (Grades 2-7, 2013)'
const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

// Transcribed from the official syllabus PDF (pp. 31–52). Each entry:
//   topic     — granular topic (becomes the lookup topic)
//   component — Listening and Speaking / Reading / Writing / Structure
//   outcomes  — specific outcome(s), numbered as in the syllabus
//   knowledge — knowledge points (become sub-topic suggestions)
const DATA = {
  'Grade 5': [
    { topic: '5.1.1 Stories', component: 'Listening and Speaking', outcomes: '5.1.1.1 Name major and minor characters in a story', knowledge: ['Major and minor characters (characterization)'] },
    { topic: '5.1.2 Language in a social setting', component: 'Listening and Speaking', outcomes: '5.1.2.1 Seek and give factual information', knowledge: ['Asking for directions to a place', 'Question: Where can I find the clinic? Answer: The clinic is near the market'] },
    { topic: '5.1.3 Proverbs and sayings', component: 'Listening and Speaking', outcomes: '5.1.3.1 Use proverbs and sayings', knowledge: ['Not all that glitters is gold', 'Once beaten, twice shy'] },
    { topic: '5.1.4 Drama', component: 'Listening and Speaking', outcomes: '5.1.4.1 Dramatise stories', knowledge: ['Role play', 'Voice projection', 'Confidence', 'Fluency'] },
    { topic: '5.1.5 Poetry', component: 'Listening and Speaking', outcomes: '5.1.5.1 Recite common praises', knowledge: ['Praises about God, chiefs, heroes and natural beauties', 'Intonation', 'Rhyming'] },
    { topic: '5.1.6 Processes', component: 'Listening and Speaking', outcomes: '5.1.6.1 Describe simple processes', knowledge: ['How to prepare nshima; how to make fire', 'Using sequence indicators eg First, Second, Then etc'] },
    { topic: '5.1.7 Calendar Vocabulary', component: 'Listening and Speaking', outcomes: '5.1.7.1 Recognise and discuss calendar vocabulary', knowledge: ['Dates, days, weekend, holiday, month, month end, year, leap year etc'] },
    { topic: '5.1.8 Polite requests', component: 'Listening and Speaking', outcomes: '5.1.8.1 Make polite requests', knowledge: ['Extension of an invitation eg: I would like to invite you…, May I invite…'] },
    { topic: '5.1.9 Debate', component: 'Listening and Speaking', outcomes: '5.1.9.1 Debate on familiar topics', knowledge: ['Gender stereotype; boys are stronger than girls', 'It is better to be a teacher than a nurse'] },
    { topic: '5.1.10 Messages', component: 'Listening and Speaking', outcomes: '5.1.10.1 Transmit messages to another person', knowledge: ['By word of mouth, phone or radio'] },
    { topic: '5.1.11 Language use in a social setting', component: 'Listening and Speaking', outcomes: '5.1.11.1 Deny and affirm statements. 5.1.11.2 Express and accept apologies', knowledge: ["I deny, I don't agree…, I accept……, I agree…", 'Eg I am sorry; I forgive you'] },
    { topic: '5.2.1 Intensive Reading', component: 'Reading', outcomes: '5.2.1.1 Read a passage and answer multiple choice, surface and inference questions. 5.2.1.2 Read and interpret information presented in print resources', knowledge: ['Knowledge of the text, back referencing, inferring meanings of unfamiliar words, phrases, idiomatic expressions, figurative language', 'Interpreting Charts, Graphs, Tables, Maps'] },
    { topic: '5.2.2 Skimming and Scanning', component: 'Reading', outcomes: '5.2.2.1 Demonstrate reading skills such as skimming and scanning', knowledge: ['Reading for specific information', 'Reading to get the general/overall impression of the passage'] },
    { topic: '5.2.3 Reading Aloud', component: 'Reading', outcomes: '5.2.3.1 Read a given passage at an appropriate pace, acceptable pronunciation and with understanding. 5.2.3.2 Observe good reading habits', knowledge: ['Reading with fluency and comprehension', 'Avoid finger pointing, head movement, whispering'] },
    { topic: '5.2.5 Extensive reading', component: 'Reading', outcomes: '5.2.5.1 Read materials from other subject areas', knowledge: ['E.g. Science, Social Studies etc'] },
    { topic: '5.3.4 Sequencing', component: 'Writing', outcomes: '5.3.4.1 Re-arrange sentences in logical order to form paragraphs', knowledge: ['Sequencing sentences to make paragraphs'] },
    { topic: '5.3 Narratives', component: 'Writing', outcomes: 'Narrate a story based on series of pictures', knowledge: ['Composing sentences on given picture strips'] },
    { topic: '5.3 Keeping and writing a Diary', component: 'Writing', outcomes: 'Keep and write a diary', knowledge: ['Note making, e.g. Sunday- went to church with mother; Mon- got 10/10 in maths; Tues – punished for reporting late at school'] },
    { topic: '5.3.3 Notices and advertisements', component: 'Writing', outcomes: '5.3.3.1 Write notices and advertisements', knowledge: ['Notices, e.g. Be aware/Take notice/Be informed that there will be…', 'Advertisements, e.g. Job opportunity; Baby seaters wanted, first come first served'] },
    { topic: '5.3.2 Letter writing', component: 'Writing', outcomes: '5.3.2.1 Write informal/friendly letters', knowledge: ['Informal letters', 'One address', 'Salutation', 'Body of letter', 'Ending', 'Signing off'] },
    { topic: '5.3.5 Summary', component: 'Writing', outcomes: '5.3.5.1 Identify titles and themes of stories', knowledge: ['Title and Theme'] },
    { topic: '5.3 Tenses', component: 'Structure', outcomes: 'Change word form to suitable tenses', knowledge: ['Regular verbs eg walk/walked', 'Irregular Verbs eg sleep/slept'] },
    { topic: '5.3.10 Punctuation', component: 'Structure', outcomes: '5.3.10.1 Punctuate given paragraphs', knowledge: ['Speech marks, Question and Exclamation marks'] },
    { topic: '5.3 Direct Speech', component: 'Structure', outcomes: 'Recognise and use direct speech', knowledge: ['Words directly spoken by someone and use of speech marks'] },
    { topic: '5.3 Synonyms and antonyms', component: 'Structure', outcomes: 'Write synonyms and antonyms of words', knowledge: ['Synonyms - words that have similar meaning eg halt/stop; red/scarlet', 'Antonyms - words that are opposite in meaning cold/hot; up/down'] },
    { topic: '5.3.12 Homographs', component: 'Structure', outcomes: '5.3.12.1 Identify homographs in sentences', knowledge: ['Similarly spelt words with different meanings e.g. A live debate / I live in Kitwe', 'Produce (noun) / produce (verb)'] },
    { topic: '5.3.11 Sentence construction', component: 'Structure', outcomes: '5.3.11.1 Change sentences from positive to negative form and vice versa', knowledge: ['E.g. I like nshima / I dislike nshima', 'This class is clean / This class is unclean', "I'll come with you / I'll not come with you"] },
    { topic: '5.3 The Noun', component: 'Structure', outcomes: 'Recognise and use different types of nouns', knowledge: ['Types of nouns: Proper, Common, Collective, Countable and uncountable'] },
    { topic: '5.3 The Verb', component: 'Structure', outcomes: 'Recognise and use different types of verbs', knowledge: ['Types of verbs: regular and irregular'] },
    { topic: '5.3 Conjunctions', component: 'Structure', outcomes: 'Join phrases using because, since and yet', knowledge: ['Eg I am late because I woke up late', 'Njekwa will write an exam this year, since she is in grade 7', 'Debora is still writing, yet it is time up'] },
    { topic: '5.3 Adjectives', component: 'Structure', outcomes: 'Recognise and use adjectives', knowledge: ['Adjectives - words that describe nouns e.g. small/big/tall/short/beautiful/handsome'] },
    { topic: '5.3 Adverbs', component: 'Structure', outcomes: 'Recognise and use adverbs', knowledge: ['Adverbs - words that describe how an action is taking place e.g. Mwamba is walking slowly'] },
    { topic: '5.3 Spellings', component: 'Structure', outcomes: 'Spell the given words correctly', knowledge: ['Phonemic awareness (Letter sounds)'] },
  ],
  'Grade 6': [
    { topic: '6.1.1 Processes and activities', component: 'Listening and Speaking', outcomes: '6.1.1.1 Describe different activities. 6.1.1.2 Describe simple processes', knowledge: ['Use descriptive language (adjectives) e.g. a wonderful sports day, drama, an enjoyable music and dance festival', 'eg How to make oral rehydration solution (ORS), use sequence indicators eg first, second, last'] },
    { topic: '6.1.2 Conversation', component: 'Listening and Speaking', outcomes: '6.1.2.1 Identify the main points in a conversation', knowledge: ['E.g. What happened?, where?, when?, who was involved?'] },
    { topic: '6.1.3 Language in a social setting', component: 'Listening and Speaking', outcomes: '6.1.3.1 Express condolences. 6.1.3.2 Decline an invitation and give an excuse', knowledge: ['E.g. Please, accept my condolences, I am sorry for your loss', 'Thank you for the invitation but …, however'] },
    { topic: '6.1.4 Stories', component: 'Listening and Speaking', outcomes: '6.1.4.1 Identify major and minor characters in a story', knowledge: ['Characterisation (their names, how they look, what they say, how the author describes them, what other characters say about them)'] },
    { topic: '6.1.5 Drama', component: 'Listening and Speaking', outcomes: '6.1.5.1 Dramatise legends and famous folklores', knowledge: ['Role play', 'Voice projection and articulation'] },
    { topic: '6.1.6 Poetry/Songs', component: 'Listening and Speaking', outcomes: '6.1.6.1 Compose songs and poems on cross cutting issues', knowledge: ['Features of poems and songs (rhyming, rhythm, stanza) e.g. HIV and AIDS, corruption, gender based violence'] },
    { topic: '6.1.7 Information', component: 'Listening and Speaking', outcomes: '6.1.7.1 Describe location of a place', knowledge: ['Use descriptive language: eg south/north of…, 10km from…, before or after…'] },
    { topic: '6.1.8 Debate', component: 'Listening and Speaking', outcomes: '6.1.8.1 Debate cross-cutting issues in a logical manner', knowledge: ['Salutation/protocol, voice projection, clarity, facts/justification e.g. on HIV/AIDS, Child labour, gender violence'] },
    { topic: '6.2.1 Intensive Reading', component: 'Reading', outcomes: '6.2.1.1 Read silently passages on cross cutting issues with understanding', knowledge: ['Reading different types of texts on cross cutting issues', 'Read and answer multiple choice, surface and inference questions'] },
    { topic: '6.2.2 Using reference books', component: 'Reading', outcomes: '6.2.2.1 Use reference books in respect to content, glossary and indexes', knowledge: ['Referencing', 'Table of content, glossary, dictionaries'] },
    { topic: '6.2.3 Skimming and scanning', component: 'Reading', outcomes: '6.2.3.1 Find information in passages using skimming and scanning', knowledge: ['Skimming and Scanning passages'] },
    { topic: '6.2.4 Reading aloud', component: 'Reading', outcomes: '6.2.4.1 Read a given passage at appropriate pace, with acceptable pronunciation and understanding', knowledge: ['Reading with appropriate expression and observing correct punctuation and pronunciation'] },
    { topic: '6.2.5 Extracting information from print resources', component: 'Reading', outcomes: '6.2.5.1 Extract information from print resources', knowledge: ['Print resources: maps, graphs, charts and tables'] },
    { topic: '6.2.6 Extensive Reading', component: 'Reading', outcomes: 'Read different types of texts with understanding', knowledge: ['Reading different types of texts with understanding'] },
    { topic: '6.3.1 Descriptive writing', component: 'Writing', outcomes: '6.3.1.1 Write short descriptive compositions on given topics', knowledge: ['Introduction, body, paragraphing, conclusion, descriptive language (use of adjectives)'] },
    { topic: '6.4.5 Punctuation', component: 'Writing', outcomes: '6.4.5.1 Use different Punctuation marks. Use correct punctuation marks in Direct speech', knowledge: ['Punctuation marks: speech marks, exclamation mark, colon, semicolon, comma'] },
    { topic: '6.3.1 Guided report writing', component: 'Writing', outcomes: '6.3.1.2 Write short reports on given situations', knowledge: ['Introduction, body, paragraphing, conclusion', 'Use of the past perfect tense'] },
    { topic: '6.3.1 Narratives', component: 'Writing', outcomes: '6.3.1.3 Write imaginative compositions', knowledge: ['Imaginative compositions (e.g. winning a lottery, winning a bursary) using future perfect tense'] },
    { topic: '6.3.2 Stories', component: 'Writing', outcomes: '6.3.2.1 Compose a story based on a picture in a correct sequence', knowledge: ['Figurative language e.g. similes, metaphors, idioms', 'Correct sequencing of events'] },
    { topic: '6.3.3 Diary', component: 'Writing', outcomes: '6.3.3.1 Maintain a diary', knowledge: ['Writing short forms of words e.g. Min of ed., abbreviations, acronyms'] },
    { topic: '6.3.4 Filling-in forms', component: 'Writing', outcomes: '6.3.4.1 Fill in simple forms', knowledge: ['Different forms e.g. application forms, money transfer, claim forms'] },
    { topic: '6.3.6 Notices', component: 'Writing', outcomes: '6.3.6.1 Write notices', knowledge: ['Different notices (fun fare, birth days, club meetings)'] },
    { topic: '6.3 Letters', component: 'Writing', outcomes: 'Write a semi-formal letter', knowledge: ['One address, date', 'Salutation', 'Main body', 'Conclusion', 'Ending'] },
    { topic: '6.3.9 Summary', component: 'Writing', outcomes: '6.3.9.1 Summarise given stories', knowledge: ['Content and functional words, the main points'] },
    { topic: '6.4.1 Tenses', component: 'Structure', outcomes: '6.4.1.1 Change from one tense to another', knowledge: ['Tenses – e.g. from past tense to future tense', 'I went yesterday / I will go tomorrow'] },
    { topic: '6.4.3 Nouns', component: 'Structure', outcomes: '6.4.3.1 Change irregular nouns from singular to plural. Make nouns from verbs', knowledge: ['Irregular nouns e.g. bully – bullies, shelf/shelves, stadium/stadia', 'Changing verbs into nouns (writer/write, driver/drive)'] },
    { topic: '6.4.4 Verbs', component: 'Structure', outcomes: '6.4.4.1 Identify and use interrogative forms of verbs', knowledge: ['E.g. How, what, who, when, why'] },
    { topic: '6.4 Adjectives', component: 'Structure', outcomes: 'Use adjectives to compare objects', knowledge: ['Comparatives eg clean/cleaner, intelligent/more intelligent, good/better'] },
    { topic: '6.4 Adverbs', component: 'Structure', outcomes: 'Recognise and use adverbs of manner', knowledge: ['Adverbs of manner eg slowly, quickly, fast, hungrily'] },
  ],
  'Grade 7': [
    { topic: '7.1.3 Drama', component: 'Listening and speaking', outcomes: '7.1.3.1 Act in plays', knowledge: ['Acting: Voice projection, stress, articulation'] },
    { topic: '7.1.4 Messages', component: 'Listening and speaking', outcomes: '7.1.4.1 Compose simple message', knowledge: ['E.g. Kindly tell the teacher that I am not able to come to school because I am sick'] },
    { topic: '7.1.5 Figures of speech', component: 'Listening and speaking', outcomes: '7.1.5.1 Explain riddles, proverbs and idioms. 7.1.5.2 Use riddles, proverbs and idioms in speech', knowledge: ['Riddles - I walk on four in the morning, two at midday and three in the evening. What am I?', 'Proverbs - Blood is thicker than water', 'Idioms - Pull up your socks'] },
    { topic: '7.1.6 Conversation', component: 'Listening and speaking', outcomes: '7.1.6.1 Identify and discuss the customs of a particular people', knowledge: ["e.g. Kuomboka, umutomboko, ukusefya pa Ng'wena", 'Use speech indicators such as: First, then, thereafter, finally etc'] },
    { topic: '7.1.7 Debate', component: 'Listening and speaking', outcomes: '7.1.7.1 Debate issues of national importance', knowledge: ['Debate formalities - Proposing, opposing, raising points of order, opinions, facts, interjections'] },
    { topic: '7.1.9 Language use in a social setting', component: 'Listening and speaking', outcomes: '7.1.9.1 Express personal opinions by stating preferences and intentions', knowledge: ['e.g. I like, I prefer, I would like'] },
    { topic: '7.1.10 Polite requests', component: 'Listening and speaking', outcomes: '7.1.10.1 Influence other people through polite requests and persuasion', knowledge: ['E.g. Could we vote for Mushaukwa? Please let me use your bicycle? May I go to the bathroom?'] },
    { topic: '7.1.11 Stories', component: 'Listening and speaking', outcomes: '7.1.11.1 Narrate stories about legends and myths', knowledge: ['Stories of heroes, heroines and myths', 'Logical arrangement of events, fluency'] },
    { topic: '7.2.1 Intensive reading', component: 'Reading', outcomes: '7.2.1.1 Read different types of text with understanding and do follow up activities', knowledge: ['Working out meanings of unfamiliar words and phrases', 'Following sequence of events', 'Retelling detail of texts', 'Recognizing main prepositions', 'Answering facts and inference questions'] },
    { topic: '7.2.2 Reading aloud', component: 'Reading', outcomes: '7.2.2.1 Read lively and expressively with understanding', knowledge: ['Reading expressively (i.e. intonation, stress, punctuation marks)'] },
    { topic: '7.2.3 Using References', component: 'Reading', outcomes: '7.2.3.1 Use reference and textbooks effectively', knowledge: ['Use of reference materials e.g. index, table of content, glossary, dictionary'] },
    { topic: '7.2.4 Extensive reading', component: 'Reading', outcomes: '7.2.4.1 Read a variety of materials including those from other subject areas', knowledge: ['Silent reading', 'Fast reading but with understanding', 'Inferring information directly or indirectly stated'] },
    { topic: '7.2 Interpreting information in Print Resources', component: 'Reading', outcomes: 'Read and interpret information in charts and graphs', knowledge: ['Maps, tables, charts and graphs'] },
    { topic: '7.3.2 Letters', component: 'Writing', outcomes: '7.3.2.1 Write formal letters', knowledge: ['Features of letters e.g. address(es), date, salutation, reference, introduction, main body, conclusion, farewell or valediction'] },
    { topic: '7.3.1 Guided Essays', component: 'Writing', outcomes: '7.3.1.1 Write essays on given topics', knowledge: ['Essay layout e.g. title, introduction, body, paragraphing, and conclusion'] },
    { topic: '7.3.4 Notices and adverts', component: 'Writing', outcomes: '7.3.4.1 Write notices and advertisements', knowledge: ['Persuasive and catchy language (e.g. mouth watering Scones on sale at 50 Ngwee)', 'Features of a report (The five WHs – what, where, when, who, why)'] },
    { topic: '7.3.5 Composing texts from print resources', component: 'Writing', outcomes: '7.3.5.1 Compose texts using information presented in print resources', knowledge: ['Interpreting charts, maps, graphs, tables'] },
    { topic: '7.3.3 Summary', component: 'Writing', outcomes: '7.3.3.1 Summarise stories', knowledge: ['Content and functional words'] },
    { topic: '7.3.7 Dictation', component: 'Writing', outcomes: '7.3.7.1 Write from dictation', knowledge: ['Correct spelling, punctuation'] },
    { topic: '7.4.8 Nouns', component: 'Structure', outcomes: '7.4.8.1 Identify and use different types of nouns', knowledge: ['Regular (e.g. Boy, girl)', 'Irregular (e.g. Man, sheep)', 'Countable (e.g. stone, book)', 'Uncountable (e.g. salt, water)', 'Proper (e.g. Peter, Jane)'] },
    { topic: '7.4.9 Adjectives', component: 'Structure', outcomes: '7.4.9.1 Identify and use adjectives to compare more than two objects', knowledge: ['Superlatives – biggest, tallest, heaviest, most intelligent, most handsome'] },
    { topic: '7.4.10 Adverbs', component: 'Structure', outcomes: '7.4.10.1 Use adverbs to qualify verbs in sentences', knowledge: ['E.g. The teacher walked into class quietly. You must finish writing quickly. She ate the scone slowly'] },
    { topic: '7.4.11 Active and passive voice', component: 'Structure', outcomes: '7.4.11.1 Use the active and passive voice', knowledge: ['Active (e.g. The dog bit Mary)', 'Passive (e.g. Mary was bitten by the dog)'] },
    { topic: '7.4.12 Punctuation', component: 'Structure', outcomes: '7.4.12.1 Punctuate different texts', knowledge: ['E.g. capital letter, comma, full stop, exclamation mark, colon, semicolon, question mark, speech marks'] },
    { topic: '7.4.13 Direct and indirect speech', component: 'Structure', outcomes: '7.4.13.1 Use direct and indirect speech', knowledge: ['Direct speech (e.g. John said, "I will come.")', 'Indirect (e.g. John said that he would go)'] },
    { topic: '7.4.14 Conjunctions', component: 'Structure', outcomes: '7.4.14.1 Connect sentences using conjunctions', knowledge: ['Therefore, Because of, As a result, since…, either…or…, neither…nor…, too…to…, so…that…'] },
  ],
}

function buildSheet(gradeLabel, entries) {
  // The first column is the topic column (detect2013TopicColumn picks the
  // first column whose name isn't TOPIC/SPECIFIC OUTCOMES/KNOWLEDGE/SKILLS/
  // VALUES). Name it after the first topic, matching the existing 2013 sheets.
  const topicCol = entries[0].topic
  const columns = [topicCol, 'TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES']
  const rows = entries.map((e) => ({
    type: 'data',
    cells: {
      [topicCol]: e.topic,
      'TOPIC': e.component,
      'SPECIFIC OUTCOMES': e.outcomes,
      'KNOWLEDGE': e.knowledge.map((k) => `• ${k}`).join(' '),
      'SKILLS': 'Application of knowledge',
      'VALUES': 'Knowledge and awareness of',
    },
  }))
  return { title: gradeLabel.toUpperCase(), columns, rows }
}

let wrote = 0
for (const file of FILES) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data[SUBJECT]) throw new Error(`Subject not found in ${file}: ${SUBJECT}`)
  for (const [gradeLabel, entries] of Object.entries(DATA)) {
    data[SUBJECT][gradeLabel] = buildSheet(gradeLabel, entries)
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  wrote += 1
  console.log(`Updated ${file}: English ${Object.keys(DATA).join(', ')}`)
}
console.log(`\nDone — wrote ${wrote} file(s). Topics: ` +
  Object.entries(DATA).map(([g, e]) => `${g}=${e.length}`).join(', '))
