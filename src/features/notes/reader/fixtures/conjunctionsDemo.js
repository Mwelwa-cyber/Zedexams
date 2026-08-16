/**
 * conjunctionsDemo — the prototype's working demo note ("Conjunctions —
 * the joining words 🔗", Grade 7 English · Term 2 · Structure),
 * transcribed into the study-block schema as the reference content for
 * the reader engine. It doubles as the shape the generation pipeline
 * targets when notes are rebuilt (locked scope: existing learner notes
 * are deleted and regenerated through the pipeline, subject by subject).
 *
 * Every interactive element of the prototype is represented: keyword
 * bubbles backed by the glossary, tap-to-reveal, YOUR TURN practice,
 * three SECTION CHECKs with full remediation, and the closing exam
 * alert. (The digestive-system note adds the label diagram; see the
 * labeldiagram block type.)
 */

export const CONJUNCTIONS_NOTE = {
  title: 'Conjunctions — the joining words 🔗',
  kicker: 'ENGLISH · TERM 2 · STRUCTURE',
  subject: 'English',
  grade: '7',
}

export const CONJUNCTIONS_BLOCKS = [
  {
    id: 'g1',
    type: 'glossary',
    entries: [
      { word: 'conjunction', meaning: 'A joining word 🔗', how: 'It sticks two words or two sentences together to make one longer, smoother sentence.', examples: ['Mutale went to the market **and** bought tomatoes.'] },
      { word: 'and', meaning: 'Adds information ➕', how: 'Use it to add one more idea of the same kind.', examples: ['We bought bread **and** milk.', 'Chipo sings **and** dances.'] },
      { word: 'but', meaning: 'Shows contrast ↔️', how: 'Use it when the second idea goes against the first one.', examples: ['The bag is small **but** heavy.', 'He ran fast **but** missed the bus.'] },
      { word: 'or', meaning: 'Shows a choice 🤔', how: 'Use it when there are two options and only one will happen.', examples: ['Do you want tea **or** milk?', 'We can walk **or** take the bus.'] },
      { word: 'so', meaning: 'Shows a result ➡️', how: 'The first part is the reason; what comes after so is the result. Careful — because gives the reason, so gives the result.', examples: ['It was hot, **so** we opened the windows.', 'Bwalya studied hard, **so** he passed.'] },
      { word: 'yet', meaning: 'A surprising contrast 😮', how: 'Like but, only stronger — the second idea is really unexpected.', examples: ['It rained all day, **yet** the match continued.', 'She is young, **yet** very wise.'] },
      { word: 'because', meaning: 'Gives the reason — WHY 🎯', how: 'Use it when the second part explains why the first part happened.', examples: ['Chipo stayed home **because** she was sick.', 'We hurried **because** the bus was leaving.'] },
      { word: 'although', meaning: 'A surprise between two ideas 🎭', how: 'The second part is surprising after the first. It can even start the sentence — then add a comma.', examples: ['**Although** it was raining, we played.', 'He smiled **although** he lost the game.'] },
      { word: 'if', meaning: 'Sets a condition 🔑', how: 'One thing will only happen when the other happens first.', examples: ['**If** you study, you will pass.', '**If** it rains, we will stay inside.'] },
      { word: 'unless', meaning: "Means 'if you do not' 🚫", how: 'A negative condition — the first thing happens except when the second is done.', examples: ['You will miss the bus **unless** you hurry.', '**Unless** you water it, the plant will die.'] },
      { word: 'when', meaning: 'Tells the time ⏰', how: 'Use it to say at what moment something happened.', examples: ['The learners became quiet **when** the teacher entered.'] },
      { word: 'while', meaning: 'Two things at the same time ⏳', how: 'Both actions are happening together.', examples: ['Mother cooked **while** I swept the floor.'] },
      { word: 'before', meaning: 'Order of events — first this ⬅️', how: 'The action after before happens later in time.', examples: ['Wash your hands **before** you eat.'] },
      { word: 'after', meaning: 'Order of events — then this ➡️', how: 'The action after after happened first.', examples: ['We played **after** we finished homework.'] },
      { word: 'since', meaning: 'From that time, or a reason 📅', how: 'It can mean from a past moment, or work as a softer because.', examples: ['I have lived here **since** 2020.', '**Since** you are ready, let us go.'] },
      { word: 'either … or', meaning: 'A choice pair 🤝', how: 'Either opens the choice; or must follow with the second option.', examples: ['**Either** you come now, **or** we leave.'] },
      { word: 'neither … nor', meaning: 'A negative pair 🚫', how: 'Neither means not one; nor brings the second not. Never pair neither with or!', examples: ['**Neither** Bwalya **nor** Chipo was late.'] },
      { word: 'both … and', meaning: 'A together pair 👥', how: 'Both announces that two things are included; and joins them.', examples: ['**Both** Chanda **and** Mutale passed.'] },
      { word: 'not only … but also', meaning: 'An emphasis pair ⭐', how: 'It mentions two things, and the second is even more impressive.', examples: ['**Not only** did it rain, **but** it **also** hailed.'] },
    ],
  },

  { id: 'p1', type: 'paragraph', text: 'A [[conjunction]] is a **joining word**. It works like glue — it sticks two words or two sentences together to make one longer, smoother sentence.' },
  { id: 't1', type: 'tip', lines: ['There are **3 families** of joining words. Let’s meet them one by one — with a little game in each! 🎮'] },

  // ── Section 1 — Coordinating ─────────────────────────────────────
  { id: 'h1', type: 'heading', level: 2, text: 'Coordinating — joining equals' },
  { id: 'kp1', type: 'keypoints', items: ['[[and]] adds · [[but]] contrast · [[or]] choice · [[so]] result · [[yet]] surprise contrast', 'Both sides of the sentence are **equal**'] },
  { id: 'p2', type: 'paragraph', text: 'These join words or sentences of **equal importance** — two ideas that could each stand on their own.' },
  {
    id: 'kt1',
    type: 'keyterms',
    rows: [
      { term: 'and', def: 'adds information' },
      { term: 'but', def: 'shows contrast' },
      { term: 'or', def: 'shows a choice' },
      { term: 'so', def: 'shows a result' },
      { term: 'yet', def: 'an unexpected contrast' },
    ],
  },
  { id: 'ex1', type: 'picture', caption: 'Watch the glue work', lines: ['Mutale went to the market. **+** She bought tomatoes.', '→ Mutale went to the market **and** bought tomatoes. ✨'] },
  { id: 'qc1', type: 'quickcheck', q: 'Bwalya was tired. He kept on studying. Which joining word fits best?', a: 'Bwalya was tired **but** he kept on studying. 💪 The two ideas fight each other — so we use **but**.' },
  {
    id: 'pr1',
    type: 'practice',
    q: 'I like mangoes …… I do not like lemons.',
    options: [
      { text: 'but', correct: true },
      { text: 'because', correct: false },
      { text: 'so', correct: false },
    ],
    correctNote: '✓ Correct! The two ideas pull against each other.',
  },
  {
    id: 'sc1',
    type: 'sectioncheck',
    label: 'SECTION CHECK — Coordinating',
    q: 'It started raining, …… we ran inside.',
    options: [
      { text: 'or', correct: false },
      { text: 'so', correct: true },
      { text: 'yet', correct: false },
    ],
    remediation: {
      explain: '[[so]] shows a **result**. The rain is the reason — running inside is what happened **because of it**.',
      example: 'I was hungry, **so** I ate my nshima. The sun was hot, **so** we sat under the mango tree.',
      retryQ: 'Try a similar one: The test was easy, …… everyone passed.',
      retryOptions: [
        { text: 'yet', correct: false },
        { text: 'so', correct: true },
        { text: 'or', correct: false },
      ],
      retryHint: 'Hint: which word shows a RESULT?',
    },
  },

  // ── Section 2 — Subordinating ────────────────────────────────────
  { id: 'h2', type: 'heading', level: 2, text: 'Subordinating — one idea depends on the other' },
  { id: 'kp2', type: 'keypoints', items: ['Join a **main clause** to a **dependent clause**', '[[because]] = why · [[if]]/[[unless]] = condition · [[when]]/[[while]]/[[before]]/[[after]]/[[since]] = time · [[although]] = surprise'] },
  { id: 'p3', type: 'paragraph', text: 'These join a **main clause** to a **dependent clause** — one part of the sentence leans on the other, telling us **why**, **when** or **on what condition**.' },
  { id: 'p4', type: 'paragraph', text: '[[because]] [[although]] [[if]] [[when]] [[while]] [[before]] [[after]] [[since]] [[unless]]' },
  { id: 'ex2', type: 'picture', caption: 'Hear them in real sentences', lines: ['Chipo stayed at home **because** she was sick.', '**Although** it was raining, we continued playing.', 'Wash your hands **before** you eat.'] },
  {
    id: 'pr2',
    type: 'practice',
    q: 'Zacheus climbed a tree …… he was short.',
    options: [
      { text: 'and', correct: false },
      { text: 'because', correct: true },
      { text: 'but', correct: false },
    ],
    correctNote: '✓ Yes! because tells us WHY he climbed.',
  },
  {
    id: 'pr3',
    type: 'practice',
    q: 'The learners became quiet …… the teacher entered.',
    options: [
      { text: 'when', correct: true },
      { text: 'or', correct: false },
      { text: 'yet', correct: false },
    ],
    correctNote: '✓ Right! when tells us the TIME it happened.',
  },
  {
    id: 'sc2',
    type: 'sectioncheck',
    label: 'SECTION CHECK — Subordinating',
    q: '…… you study hard, you will pass the exam.',
    options: [
      { text: 'But', correct: false },
      { text: 'If', correct: true },
      { text: 'So', correct: false },
    ],
    remediation: {
      explain: '[[if]] sets a **condition** — the passing **depends** on the studying. One part of the sentence leans on the other.',
      example: '**If** you water the plant, it will grow. You will be late **unless** you hurry. (unless = if you do not)',
      retryQ: 'Try a similar one: You will miss the bus …… you run.',
      retryOptions: [
        { text: 'unless', correct: true },
        { text: 'although', correct: false },
        { text: 'when', correct: false },
      ],
      retryHint: "Hint: unless means 'if you do not'.",
    },
  },

  // ── Section 3 — Conjunction pairs ────────────────────────────────
  { id: 'h3', type: 'heading', level: 2, text: 'Conjunction pairs — words that work as a team' },
  { id: 'kp3', type: 'keypoints', items: ['[[either … or]] · [[neither … nor]] · [[both … and]] · [[not only … but also]]', 'Pairs always travel together — see one, expect its partner'] },
  { id: 'p5', type: 'paragraph', text: 'Some conjunctions are always used **in pairs**. If you see the first one, its partner must follow!' },
  { id: 'p6', type: 'paragraph', text: '[[either … or]] [[neither … nor]] [[both … and]] [[not only … but also]]' },
  { id: 'ex3', type: 'picture', caption: 'Pairs in action', lines: ['**Both** Chanda **and** Mutale passed the test.', '**Not only** did it rain, **but** it **also** hailed.'] },
  {
    id: 'pr4',
    type: 'practice',
    q: 'Neither Bwalya …… Chipo was late for class.',
    options: [
      { text: 'nor', correct: true },
      { text: 'or', correct: false },
      { text: 'and', correct: false },
    ],
    correctNote: '✓ Perfect! neither always brings its partner nor.',
  },
  {
    id: 'sc3',
    type: 'sectioncheck',
    label: 'SECTION CHECK — Conjunction pairs',
    q: '…… only did Mwansa sing, but she also danced.',
    options: [
      { text: 'Both', correct: false },
      { text: 'Not', correct: true },
      { text: 'Either', correct: false },
    ],
    remediation: {
      explain: 'The pair is [[not only … but also]]. When you see **but also** later in the sentence, its partner **not only** must come first. Pairs always travel together!',
      example: '**Not only** is Zed clever, **but** he is **also** friendly. **Either** you come now, **or** we leave.',
      retryQ: 'Try a similar one: …… Chanda or Taonga will bring the ball.',
      retryOptions: [
        { text: 'Neither', correct: false },
        { text: 'Either', correct: true },
        { text: 'Both', correct: false },
      ],
      retryHint: 'Hint: or pairs with Either; nor pairs with Neither.',
    },
  },

  { id: 'ex4', type: 'exam', q: 'Conjunction questions appear in **every** Grade 7 English paper — like Part 2 of the paper you practised.', a: 'Master these and those marks are yours.' },
]

export default { note: CONJUNCTIONS_NOTE, blocks: CONJUNCTIONS_BLOCKS }
