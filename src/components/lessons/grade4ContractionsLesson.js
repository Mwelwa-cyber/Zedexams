import { createBlankSlide, ensureEndSlide, LESSON_SCHEMA_VERSION } from './lessonConstants.js'

// Grade 4 English lesson on contractions, authored as a slide-based lesson
// that follows the same shape as SAMPLE_RESPIRATORY_LESSON so it can be
// loaded into LessonEditor or seeded into the `lessons` collection.

const slides = ensureEndSlide([
  createBlankSlide('title', {
    title: 'Contractions',
    subtitle: 'Grade 4 English',
    body: 'Learn how to join two words into one short word using an apostrophe.',
  }),
  createBlankSlide('text', {
    title: 'What Is a Contraction?',
    body: 'A contraction is a short way of writing two words together. We take out some letters and put an apostrophe (’) in their place. For example, "do not" becomes "don\'t". The apostrophe shows where the missing letters used to be.',
  }),
  createBlankSlide('bullets', {
    title: 'Why We Use Contractions',
    bullets: [
      'They make our writing shorter and quicker to read.',
      'They sound more like the way we speak to friends and family.',
      'The apostrophe (’) always shows where letters are missing.',
      'They are used in friendly writing, like stories and letters.',
    ],
  }),
  createBlankSlide('imageText', {
    title: 'How an Apostrophe Works',
    body: 'Look at the two words "is not". When we join them, we remove the letter o. We put an apostrophe where the o used to be, and we get "isn\'t". The apostrophe takes the place of the missing letter.',
    imageAlt: 'The words "is not" joining into "isn\'t" with an apostrophe replacing the letter o',
  }),
  createBlankSlide('bullets', {
    title: 'Common Contractions to Know',
    bullets: [
      'is not → isn’t',
      'do not → don’t',
      'cannot → can’t',
      'I am → I’m',
      'you are → you’re',
      'we will → we’ll',
      'it is → it’s',
      'they are → they’re',
    ],
  }),
  createBlankSlide('example', {
    title: 'Example: Joining Two Words',
    body: 'Let us turn "she is" into a contraction.',
    example: 'she is → she’s\n\n"She is my friend." becomes "She’s my friend."',
    explanation: 'We removed the letter i from "is" and put an apostrophe in its place. The meaning stays exactly the same.',
  }),
  createBlankSlide('text', {
    title: 'Watch Out: it’s and its',
    body: 'Be careful! "It’s" with an apostrophe means "it is". For example, "It’s raining" means "It is raining". But "its" with no apostrophe shows that something belongs to it, like "The dog wagged its tail." Read the sentence to choose the right one.',
  }),
  createBlankSlide('question', {
    title: 'Activity: Make the Contraction',
    prompt: 'Write the contraction for each pair of words:\n1. we are\n2. did not\n3. you will\n4. he is',
    answer: '1. we’re  2. didn’t  3. you’ll  4. he’s',
    explanation: 'In each one we joined the two words and used an apostrophe to show the missing letter or letters: a in "are", o in "not", wi in "will", and i in "is".',
  }),
  createBlankSlide('question', {
    title: 'Activity: Spot the Contraction',
    prompt: 'Read the sentence and write the two full words for the contraction:\n"They can’t come to school today."',
    answer: 'can’t = cannot',
    explanation: '"Can’t" is the short form of "cannot". The apostrophe shows that the letters n and o were taken out.',
  }),
  createBlankSlide('summary', {
    title: 'Summary',
    body: 'Contractions join two words into one short word using an apostrophe.',
    bullets: [
      'A contraction is two words joined together.',
      'The apostrophe (’) shows where letters are missing.',
      'Examples: don’t, can’t, I’m, it’s, they’re.',
      'Remember: "it’s" means "it is", but "its" shows belonging.',
    ],
  }),
])

export const GRADE4_CONTRACTIONS_LESSON = {
  schemaVersion: LESSON_SCHEMA_VERSION,
  title: 'Contractions',
  grade: '4',
  subject: 'English',
  term: '1',
  topic: 'Contractions',
  creationMode: 'slide-builder',
  theme: 'bright',
  slides,
  activities: [
    {
      id: slides[7].id,
      slideId: slides[7].id,
      slideTitle: slides[7].title,
      prompt: slides[7].prompt,
      order: 1,
    },
    {
      id: slides[8].id,
      slideId: slides[8].id,
      slideTitle: slides[8].title,
      prompt: slides[8].prompt,
      order: 2,
    },
  ],
  answers: [
    {
      id: slides[7].id,
      slideId: slides[7].id,
      slideTitle: slides[7].title,
      prompt: slides[7].prompt,
      answer: slides[7].answer,
      explanation: slides[7].explanation,
      order: 1,
    },
    {
      id: slides[8].id,
      slideId: slides[8].id,
      slideTitle: slides[8].title,
      prompt: slides[8].prompt,
      answer: slides[8].answer,
      explanation: slides[8].explanation,
      order: 2,
    },
  ],
  linkedQuizId: '',
  linkedActivities: [],
  status: 'draft',
  isPublished: false,
}

export const GRADE4_CONTRACTIONS_QUICK_NOTES = `Contractions

A contraction is a short way of writing two words as one. We take out one or more letters and put an apostrophe (’) in their place. The apostrophe shows where the letters are missing.

Why we use contractions:
- They make writing shorter and quicker to read.
- They sound like the way we talk to friends and family.
- They are used in friendly writing, such as stories and letters.

Common contractions:
- is not → isn’t
- do not → don’t
- cannot → can’t
- I am → I’m
- you are → you’re
- it is → it’s
- they are → they’re

Watch out: "It’s" means "it is" (It’s raining). "Its" with no apostrophe shows belonging (The dog wagged its tail).

Activity: Write the contraction for each pair — we are, did not, you will, he is.

Summary: Contractions join two words into one short word using an apostrophe. The apostrophe always shows where letters are missing.`
