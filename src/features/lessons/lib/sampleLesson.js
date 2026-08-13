import { createBlankSlide, ensureEndSlide, LESSON_SCHEMA_VERSION } from './lessonConstants'

const slides = ensureEndSlide([
  createBlankSlide('title', {
    title: 'The Respiratory System',
    subtitle: 'Grade 4 Integrated Science',
    body: 'Learn how your body takes in oxygen and removes carbon dioxide.',
  }),
  createBlankSlide('text', {
    title: 'Why We Breathe',
    body: 'Every part of your body needs oxygen to work. When you breathe in, air enters your body. Your blood carries oxygen to your brain, muscles, and organs.',
  }),
  createBlankSlide('imageText', {
    title: 'Main Parts',
    body: 'Air passes through the nose, windpipe, and into the lungs. The lungs are soft organs inside the chest. They help oxygen move into the blood.',
    imageAlt: 'Simple respiratory system diagram',
  }),
  createBlankSlide('bullets', {
    title: 'Breathing Steps',
    bullets: [
      'Air enters through the nose or mouth.',
      'The windpipe carries air down to the lungs.',
      'The lungs take oxygen from the air.',
      'Carbon dioxide leaves the body when we breathe out.',
    ],
  }),
  createBlankSlide('example', {
    title: 'Example: After Running',
    body: 'After running, you breathe faster because your muscles need more oxygen.',
    example: 'If you run across the playground, your chest moves quickly and your breathing becomes deeper.',
    explanation: 'The body is bringing in extra oxygen and removing extra carbon dioxide.',
  }),
  createBlankSlide('question', {
    title: 'Activity',
    prompt: 'Place your hand on your chest. Breathe in slowly, then breathe out. What do you notice?',
    answer: 'The chest rises when breathing in and falls when breathing out.',
    explanation: 'The lungs fill with air when you breathe in, so the chest expands. The chest relaxes as air leaves.',
  }),
  createBlankSlide('summary', {
    title: 'Summary',
    body: 'The respiratory system helps us breathe and gives the body oxygen.',
    bullets: [
      'We breathe in oxygen.',
      'The lungs help oxygen enter the blood.',
      'We breathe out carbon dioxide.',
      'Breathing changes when the body needs more oxygen.',
    ],
  }),
])

export const SAMPLE_RESPIRATORY_LESSON = {
  schemaVersion: LESSON_SCHEMA_VERSION,
  title: 'The Respiratory System',
  grade: '4',
  subject: 'Integrated Science',
  term: '1',
  topic: 'Respiratory System',
  creationMode: 'slide-builder',
  theme: 'bright',
  slides,
  activities: [
    {
      id: slides[5].id,
      slideId: slides[5].id,
      slideTitle: 'Activity',
      prompt: slides[5].prompt,
      order: 1,
    },
  ],
  answers: [
    {
      id: slides[5].id,
      slideId: slides[5].id,
      slideTitle: 'Activity',
      prompt: slides[5].prompt,
      answer: slides[5].answer,
      explanation: slides[5].explanation,
      order: 1,
    },
  ],
  linkedQuizId: '',
  linkedActivities: [],
  status: 'draft',
  isPublished: false,
}

export const SAMPLE_QUICK_NOTES = `Respiratory System

The respiratory system helps us breathe. Breathing brings oxygen into the body. Oxygen is needed by the brain, muscles, heart, and other organs.

Main parts:
- Nose and mouth
- Windpipe
- Lungs
- Chest muscles

When we breathe in, air enters the nose or mouth and moves down the windpipe into the lungs. The lungs pass oxygen into the blood.

When we breathe out, carbon dioxide leaves the body. Carbon dioxide is a waste gas that the body does not need.

Activity: Put your hand on your chest and breathe slowly. What happens to your chest when you breathe in and out?

Summary: The respiratory system helps the body get oxygen and remove carbon dioxide. The lungs are the main organs used for breathing.`
