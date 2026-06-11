/**
 * Hand-curated sample artifacts for the public /teachers landing page.
 *
 * Each `artifact` matches the JSON contract of its generator schema in
 * functions/teacherTools/*Schema.js, so the page renders them through the
 * SAME presenter components the studios use (LessonPlanView, WorksheetView,
 * SchemeOfWorkView, FlashcardsView) — what a visitor sees is exactly what
 * the tool produces.
 *
 * Editing/swapping a sample: paste the `output` field of any aiGenerations
 * doc over the matching `artifact` here and adjust the card meta. Keep the
 * lesson plan on schemaVersion "3.0" (official CDC stages INTRODUCTION →
 * LESSON DEVELOPMENT → EXERCISE / ASSESSMENT → HOMEWORK → CONCLUSION).
 */

export const TEACHER_SAMPLES = [
  {
    id: 'lesson-plan',
    tool: 'lesson_plan',
    label: 'Lesson plan',
    icon: '📖',
    grade: 'Grade 5',
    subject: 'Mathematics',
    topic: 'Fractions & Decimals',
    blurb: 'The official CDC document the studio prints and exports — CAPS field lines and the bordered LESSON PROGRESSION table, exactly as head teachers expect it.',
    artifact: {
      schemaVersion: '3.0',
      header: {
        school: 'Chilenje Primary School',
        teacherName: 'Ms. Mwansa',
        durationMinutes: 40,
        class: '5B',
        subject: 'Mathematics',
        topic: 'Fractions & Decimals',
        subtopic: 'Adding fractions with the same denominator',
        termAndWeek: 'Term 1 · Week 3',
        mediumOfInstruction: 'English',
        boysPresent: 23,
        girlsPresent: 25,
        totalPupils: 48,
      },
      generalCompetences: [
        'Critical thinking — breaking a whole into equal parts and reasoning about their sum',
        'Communication — explaining a solution to a partner using fraction language',
        'Collaboration — working in pairs with shared counters',
        'Problem solving — applying fraction addition to everyday sharing situations',
      ],
      specificCompetence:
        '5.1.3.2 — Add fractions with the same denominator (sums up to 1) and use the result to solve simple practical problems.',
      lessonGoal:
        'By the end of the lesson, at least 40 of the 48 learners will correctly add two fractions with the same denominator and state the answer in its simplest form, scoring 4 out of 5 in the written exercise.',
      rationale:
        'Fractions describe fair sharing — of food, money, land and time. Adding like fractions builds directly on the Grade 4 idea of naming fractions and prepares learners for unlike denominators and decimals later this term. The lesson uses concrete objects first so the algorithm is grounded in meaning, not memorised.',
      priorKnowledge:
        'Learners can name fractions from shaded diagrams (half, quarter, third), identify the numerator and denominator, and shade a given fraction of a shape.',
      references: [
        "Mathematics Learner's Book Grade 5, pages 24–27",
        'CDC Mathematics Syllabus Grades 4–7 (2023 Competency-Based Curriculum)',
        "Teacher's Guide Grade 5 Mathematics, Unit 3",
      ],
      learningEnvironment: {
        natural: 'Stones and bottle tops collected from the school grounds used as counters for equal sharing.',
        artificial: 'Classroom arranged in pair seating; fraction wall chart and chalkboard fraction diagrams.',
        technological: 'Where available, a phone calculator is used only to CHECK answers after written working.',
      },
      materials: [
        'Fraction wall chart',
        'Bottle tops / stones as counters (10 per pair)',
        'Paper strips for folding into equal parts',
        'Chalkboard and ruler',
        "Learner's Book Grade 5, page 26 exercise",
      ],
      expectedStandard: 'Fractions with the same denominator added correctly and answers expressed in simplest form.',
      keyVocabulary: ['fraction', 'numerator', 'denominator', 'sum', 'simplest form', 'equal parts'],
      stages: [
        {
          name: 'INTRODUCTION',
          durationMinutes: 5,
          teacherActivities: [
            'Holds up a paper strip folded into 8 equal parts and shades 3/8, asking: "What fraction is shaded?"',
            'Reviews numerator and denominator with quick oral questions from yesterday\'s work.',
            'States the lesson focus: today we ADD fractions that have the same denominator.',
          ],
          learnerActivities: [
            'Answer oral revision questions on naming fractions.',
            'Fold their own paper strips into 8 equal parts and shade a named fraction.',
          ],
          assessmentCriteria: [
            'Fractions from diagrams named correctly during oral questioning.',
          ],
        },
        {
          name: 'LESSON DEVELOPMENT — Activity 1: Adding with counters',
          durationMinutes: 12,
          teacherActivities: [
            'Demonstrates 2/8 + 3/8 on the fraction wall, then with bottle tops grouped in eighths.',
            'Guides the rule from the examples: add the numerators, the denominator stays the same.',
            'Works 1/5 + 2/5 and 3/10 + 4/10 on the board with learner input.',
          ],
          learnerActivities: [
            'In pairs, model 2/8 + 3/8 with bottle tops and state the sum.',
            'Suggest the rule in their own words before the teacher confirms it.',
            'Solve 2/7 + 3/7 on mini chalkboards and hold up answers.',
          ],
          assessmentCriteria: [
            'Sum of two like fractions modelled correctly with counters.',
            'Rule stated correctly: numerators added, denominator unchanged.',
          ],
        },
        {
          name: 'LESSON DEVELOPMENT — Activity 2: Simplest form',
          durationMinutes: 8,
          teacherActivities: [
            'Poses 2/8 + 2/8 and asks whether 4/8 can be written more simply, using the fraction wall to show 4/8 = 1/2.',
            'Demonstrates dividing numerator and denominator by the same number.',
          ],
          learnerActivities: [
            'Use the fraction wall to find simpler names for 4/8 and 5/10.',
            'Explain to a partner why 4/8 and 1/2 are the same amount.',
          ],
          assessmentCriteria: [
            'Equivalent simpler form identified using the fraction wall.',
          ],
        },
        {
          name: 'EXERCISE / ASSESSMENT',
          durationMinutes: 10,
          teacherActivities: [
            "Assigns Learner's Book page 26, questions 1–5 (five like-denominator additions, two requiring simplest form).",
            'Moves around marking, noting learners who add denominators as well — the common error.',
          ],
          learnerActivities: [
            'Work the five questions individually in exercise books, showing the addition step.',
            'Exchange books for peer checking of question 1 and 2 against the board answers.',
          ],
          assessmentCriteria: [
            'At least 4 of 5 additions correct.',
            'Answers requiring simplification expressed in simplest form.',
          ],
        },
        {
          name: 'HOMEWORK',
          durationMinutes: 2,
          teacherActivities: [
            'Sets the task: "Mother gives you 2/6 of a chitenge length and later 3/6 more. What fraction do you have now? Draw it." plus three practice sums.',
          ],
          learnerActivities: [
            'Record the homework task and due date in their books.',
          ],
          assessmentCriteria: [
            'Homework recorded; checked for correct sums at the start of the next lesson.',
          ],
        },
        {
          name: 'CONCLUSION',
          durationMinutes: 3,
          teacherActivities: [
            'Asks three learners to state the rule for adding like fractions in their own words.',
            'Previews the next lesson: adding fractions whose denominators are different.',
          ],
          learnerActivities: [
            'Restate the rule and give one example orally.',
          ],
          assessmentCriteria: [
            'Rule recalled accurately without prompting.',
          ],
        },
      ],
      remedialWork:
        'Learners who added the denominators repeat Activity 1 with counters in a small group while the teacher names each step aloud.',
      extensionActivity:
        'Fast finishers attempt 1/6 + 2/6 + 3/6 and explain what a sum equal to 1 whole means using the paper strip.',
      coveredContent: [
        'Adding fractions with the same denominator',
        'Expressing a fraction in simplest form',
      ],
    },
  },

  {
    id: 'worksheet',
    tool: 'worksheet',
    label: 'Worksheet',
    icon: '📝',
    grade: 'Grade 6',
    subject: 'Integrated Science',
    topic: 'Ecosystems & Food Chains',
    blurb: 'Pupil-ready questions with marks, plus a one-tap answer key for marking — flip the toggle to see the teacher view.',
    artifact: {
      schemaVersion: '1.0',
      header: {
        title: 'Ecosystems & Food Chains — Practice Worksheet',
        subject: 'Integrated Science',
        grade: 'Grade 6',
        topic: 'Ecosystems & Food Chains',
        subtopic: 'Producers, consumers and energy flow',
        duration: '30 minutes',
        totalMarks: 15,
        instructions: 'Answer ALL questions. Write neatly and show your thinking where asked.',
      },
      sections: [
        {
          title: 'Section A — Multiple Choice',
          instructions: 'Circle the letter of the correct answer. 1 mark each.',
          questions: [
            {
              number: 1,
              type: 'multiple_choice',
              prompt: 'Which of these is a producer in a Zambian grassland ecosystem?',
              options: ['Grasshopper', 'Star grass', 'Guinea fowl', 'Side-striped jackal'],
              marks: 1,
              answer: 'B — Star grass. Producers make their own food using sunlight.',
              workingNotes: 'Accept any reasoning that links producers to photosynthesis.',
            },
            {
              number: 2,
              type: 'multiple_choice',
              prompt: 'In the food chain  maize → mouse → owl,  the mouse is a…',
              options: ['producer', 'primary consumer', 'secondary consumer', 'decomposer'],
              marks: 1,
              answer: 'B — primary consumer. It is the first animal to eat the producer.',
              workingNotes: '',
            },
            {
              number: 3,
              type: 'multiple_choice',
              prompt: 'What do the arrows in a food chain show?',
              options: [
                'Which animal is the largest',
                'The direction energy flows when one organism eats another',
                'Where each animal sleeps',
                'Which organism is the oldest',
              ],
              marks: 1,
              answer: 'B — the direction of energy flow, always pointing TO the eater.',
              workingNotes: 'A reversed-arrow answer in Section B should lose the arrow mark only once.',
            },
            {
              number: 4,
              type: 'multiple_choice',
              prompt: 'Termites and fungi that break down a fallen mopane tree are called…',
              options: ['predators', 'prey', 'decomposers', 'herbivores'],
              marks: 1,
              answer: 'C — decomposers. They return nutrients to the soil.',
              workingNotes: '',
            },
          ],
        },
        {
          title: 'Section B — Short Answer',
          instructions: 'Write your answers in full sentences where asked.',
          questions: [
            {
              number: 5,
              type: 'fill_in_blank',
              prompt: 'Complete the sentence: All the energy in a food chain comes first from the ______.',
              options: null,
              marks: 2,
              answer: 'Sun (sunlight).',
              workingNotes: '2 marks for "the sun"; 1 mark for "light" alone.',
            },
            {
              number: 6,
              type: 'short_answer',
              prompt: 'Write ONE complete food chain with four organisms found in Zambia. Use arrows.',
              options: null,
              marks: 4,
              answer: 'Example: star grass → grasshopper → lizard → snake eagle. Any sensible local chain of four with correct arrow direction earns full marks.',
              workingNotes: '1 mark per correctly placed organism; arrows must point toward the eater.',
            },
            {
              number: 7,
              type: 'short_answer',
              prompt: 'Farmers near Kafue sprayed chemicals that killed most grasshoppers. Explain what could happen to the birds that eat grasshoppers, and why.',
              options: null,
              marks: 3,
              answer: 'The birds would go hungry, leave the area, or die out (1), because their food source has been removed (1), showing how organisms in a food chain depend on one another (1).',
              workingNotes: 'Accept "birds eat something else" if the learner explains the chain disruption.',
            },
            {
              number: 8,
              type: 'short_answer',
              prompt: 'Give ONE reason decomposers are important in an ecosystem.',
              options: null,
              marks: 3,
              answer: 'They break down dead plants and animals and return nutrients to the soil, which producers need to grow.',
              workingNotes: 'Full marks needs both the breaking-down idea and the nutrient-return idea.',
            },
          ],
        },
      ],
      answerKey: {
        markingNotes:
          'Total 15 marks. Question 6 carries the most weight — insist on correct arrow direction. For question 7, reward cause-and-effect reasoning over memorised definitions.',
        totalMarks: 15,
      },
    },
  },

  {
    id: 'scheme-of-work',
    tool: 'scheme_of_work',
    label: 'Scheme of work',
    icon: '🗓️',
    grade: 'Grade 4',
    subject: 'English',
    topic: 'Term 1 plan',
    blurb: 'A full term mapped week by week — outcomes, activities, materials and assessment in the bordered table head teachers expect.',
    artifact: {
      schemaVersion: '1.0',
      header: {
        school: 'Chilenje Primary School',
        teacherName: 'Ms. Mwansa',
        class: '4A',
        subject: 'English',
        term: 1,
        numberOfWeeks: 10,
        academicYear: '2026',
        mediumOfInstruction: 'English',
      },
      overview: {
        termTheme:
          'From sounds to sentences: phonics revision into confident reading, speaking and first paragraph writing.',
        overallCompetencies: [
          'Communication — speaking and writing in clear, simple English',
          'Critical thinking — finding answers and meaning in short texts',
          'Creativity — composing own sentences and a short paragraph',
        ],
        overallValues: ['Confidence', 'Respect for others during pair talk', 'Neatness in written work'],
      },
      weeks: [
        {
          weekNumber: 1,
          topic: 'Phonics & Word Study — letter sounds revision',
          subtopics: ['Single letter sounds', 'Two-letter blends (st, br, cl)'],
          specificOutcomes: [
            'Sound out all single letters correctly',
            'Blend two-letter clusters into spoken words',
          ],
          keyCompetencies: ['Communication'],
          values: ['Confidence'],
          teachingLearningActivities: [
            'Flashcard drill of letter sounds in groups',
            'Sound walk: learners hunt classroom objects starting with a target sound',
            'Blending race on the chalkboard',
          ],
          materials: ['Letter flashcards', 'Chalkboard', 'Word wall'],
          assessment: 'Oral check: each learner sounds out five letters and two blends.',
          references: "Pupil's Book pp. 2–5",
        },
        {
          weekNumber: 2,
          topic: 'Phonics & Word Study — digraphs',
          subtopics: ['sh, ch, th words', 'Reading digraph words in sentences'],
          specificOutcomes: [
            'Read words containing sh, ch and th',
            'Spell six common digraph words correctly',
          ],
          keyCompetencies: ['Communication'],
          values: ['Perseverance'],
          teachingLearningActivities: [
            'Sorting game: word cards into sh / ch / th hoops',
            'Pair reading of digraph sentences',
            'Look–cover–write–check spelling practice',
          ],
          materials: ['Word cards', 'Spelling exercise books'],
          assessment: 'Friday spelling test of six digraph words.',
          references: "Pupil's Book pp. 6–9",
        },
        {
          weekNumber: 3,
          topic: 'Reading Comprehension — short stories',
          subtopics: ['Reading "The Clever Hare"', 'Answering who/what/where questions'],
          specificOutcomes: [
            'Read a 60-word story aloud with reasonable fluency',
            'Answer three literal questions about the story in full sentences',
          ],
          keyCompetencies: ['Critical thinking'],
          values: ['Attentiveness'],
          teachingLearningActivities: [
            'Teacher model reading, then echo reading',
            'Pair re-reading with finger tracking',
            'Question relay: groups answer who/what/where cards',
          ],
          materials: ["Pupil's Book story", 'Question cards'],
          assessment: 'Written answers to three comprehension questions, marked for full sentences.',
          references: "Pupil's Book pp. 10–13",
        },
        {
          weekNumber: 4,
          topic: 'Parts of Speech — nouns',
          subtopics: ['Naming words around us', 'Common vs proper nouns', 'Capital letters for names'],
          specificOutcomes: [
            'Identify nouns in spoken and written sentences',
            'Write proper nouns with capital letters',
          ],
          keyCompetencies: ['Communication'],
          values: ['Neatness'],
          teachingLearningActivities: [
            'Classroom noun hunt and class list',
            'Sorting chart: people / places / things / animals',
            'Fix-the-sentence: adding missing capitals to names like Lusaka and Mutale',
          ],
          materials: ['Sorting chart', 'Sentence strips'],
          assessment: 'Exercise: underline eight nouns in a passage; capitalise four proper nouns.',
          references: "Pupil's Book pp. 14–17",
        },
        {
          weekNumber: 5,
          topic: 'Parts of Speech — verbs',
          subtopics: ['Action words', 'Verbs in simple sentences'],
          specificOutcomes: [
            'Identify the verb in a simple sentence',
            'Use given verbs in own spoken and written sentences',
          ],
          keyCompetencies: ['Communication', 'Creativity'],
          values: ['Participation'],
          teachingLearningActivities: [
            'Mime-and-guess action words game',
            'Verb substitution drills (I walk / I run / I jump)',
            'Writing four own sentences using verbs from the word wall',
          ],
          materials: ['Action picture cards', 'Word wall'],
          assessment: 'Four learner-written sentences each containing a correct verb.',
          references: "Pupil's Book pp. 18–21",
        },
        {
          weekNumber: 6,
          topic: 'Punctuation',
          subtopics: ['Capital letters and full stops', 'Question marks'],
          specificOutcomes: [
            'Punctuate simple statements with capitals and full stops',
            'Recognise and punctuate questions with question marks',
          ],
          keyCompetencies: ['Critical thinking'],
          values: ['Accuracy'],
          teachingLearningActivities: [
            'Punctuation surgery: fixing faulty sentences on the board',
            'Statement or question? — oral sorting with response cards',
            'Dictation of four sentences for punctuation practice',
          ],
          materials: ['Faulty sentence strips', 'Response cards (. / ?)'],
          assessment: 'Dictation marked for correct capitals, full stops and question marks.',
          references: "Pupil's Book pp. 22–24",
        },
        {
          weekNumber: 7,
          topic: 'Creative Writing — from sentences to a paragraph',
          subtopics: ['Ordering jumbled sentences', 'Writing 4–5 sentences about my family'],
          specificOutcomes: [
            'Arrange four jumbled sentences into a sensible order',
            'Write a 4–5 sentence paragraph on a familiar topic',
          ],
          keyCompetencies: ['Creativity', 'Communication'],
          values: ['Pride in own work'],
          teachingLearningActivities: [
            'Group puzzle: ordering cut-up sentence strips into a story',
            'Shared writing of a model paragraph with the teacher as scribe',
            'Independent paragraph writing with a word bank',
          ],
          materials: ['Sentence strips', 'Word bank chart'],
          assessment: 'First draft paragraph assessed with a simple 5-point rubric.',
          references: "Pupil's Book pp. 25–28",
        },
        {
          weekNumber: 8,
          topic: 'Oral Communication',
          subtopics: ['Greetings and polite requests', 'Asking for and giving directions'],
          specificOutcomes: [
            'Use polite greetings and requests in role play',
            'Give simple directions using left, right, near and next to',
          ],
          keyCompetencies: ['Communication'],
          values: ['Respect', 'Courtesy'],
          teachingLearningActivities: [
            'Role play: greeting a visitor to the school',
            'Direction game using a simple map of the school grounds',
            'Pair practice: asking the way to the clinic / market',
          ],
          materials: ['Simple school map', 'Role play prompt cards'],
          assessment: 'Observed role play scored on a participation checklist.',
          references: "Pupil's Book pp. 29–31",
        },
        {
          weekNumber: 9,
          topic: 'Reading Comprehension — information texts',
          subtopics: ['Reading "Keeping Our Water Clean"', 'Finding facts in a text'],
          specificOutcomes: [
            'Locate two facts in a short information text',
            'Answer true/false questions with evidence from the text',
          ],
          keyCompetencies: ['Critical thinking'],
          values: ['Care for the environment'],
          teachingLearningActivities: [
            'Picture walk and prediction before reading',
            'Highlighting facts during guided re-reading',
            'True/false quiz with "prove it" follow-ups',
          ],
          materials: ['Information text', 'True/false cards'],
          assessment: 'Written true/false exercise with one supporting sentence copied from the text.',
          references: "Pupil's Book pp. 32–35",
        },
        {
          weekNumber: 10,
          topic: 'Revision and end-of-term assessment',
          subtopics: ['Phonics and spelling review', 'Grammar and punctuation review', 'Assessment'],
          specificOutcomes: [
            'Demonstrate term competences in a written assessment',
            'Read a seen passage aloud for the oral assessment',
          ],
          keyCompetencies: ['Critical thinking', 'Communication'],
          values: ['Honesty during assessment'],
          teachingLearningActivities: [
            'Stations revision: spelling, nouns/verbs, punctuation corners',
            'Practice paper walked through as a class',
            'End-of-term written and oral assessment',
          ],
          materials: ['Revision station cards', 'Assessment papers'],
          assessment: 'End-of-term test (40 marks) plus oral reading checklist.',
          references: 'Compiled from term work',
        },
      ],
    },
  },

  {
    id: 'flashcards',
    tool: 'flashcards',
    label: 'Flashcards',
    icon: '🃏',
    grade: 'Grade 7',
    subject: 'Mathematics',
    topic: 'Social and Commercial Arithmetic',
    blurb: 'Tap a card to flip it — drill definitions and formulas in class, or print as cut-outs for revision groups.',
    artifact: {
      schemaVersion: '1.0',
      header: {
        title: 'Social & Commercial Arithmetic — Quick Drill',
        subject: 'Mathematics',
        grade: 'Grade 7',
        topic: 'Unit 5: Social and Commercial Arithmetic',
        cardCount: 8,
      },
      cards: [
        {
          front: 'What is PROFIT?',
          back: 'The money gained when the selling price is higher than the cost price. Profit = Selling Price − Cost Price.',
          example: 'Bought a crate of drinks for K180, sold all for K240 → profit K60.',
          hint: 'Selling for MORE than you paid.',
          category: 'definition',
        },
        {
          front: 'What is LOSS?',
          back: 'The money lost when the selling price is lower than the cost price. Loss = Cost Price − Selling Price.',
          example: 'Bought a phone for K900, sold it for K750 → loss K150.',
          hint: 'Selling for LESS than you paid.',
          category: 'definition',
        },
        {
          front: 'Formula for SIMPLE INTEREST',
          back: 'I = (P × R × T) ÷ 100, where P is the principal, R the rate per year, and T the time in years.',
          example: 'K500 at 10% for 2 years: I = (500 × 10 × 2) ÷ 100 = K100.',
          hint: 'P, R and T multiplied, then divide by 100.',
          category: 'formula',
        },
        {
          front: 'What is a DISCOUNT?',
          back: 'An amount taken off the marked price to get the actual selling price.',
          example: 'A K200 chitenge at 15% discount costs K200 − K30 = K170.',
          hint: 'The shop "cuts" the price for you.',
          category: 'definition',
        },
        {
          front: 'What is COMMISSION?',
          back: 'Payment a salesperson earns calculated as a percentage of the value of goods they sell.',
          example: 'Selling K4,000 of airtime at 5% commission earns K200.',
          hint: 'Earned per sale, not a fixed salary.',
          category: 'definition',
        },
        {
          front: 'Percentage profit formula',
          back: 'Percentage profit = (Profit ÷ Cost Price) × 100.',
          example: 'Profit K60 on a cost of K180 → (60 ÷ 180) × 100 ≈ 33.3%.',
          hint: 'Always divide by the COST price, not the selling price.',
          category: 'formula',
        },
        {
          front: 'What is HIRE PURCHASE?',
          back: 'Buying now and paying in instalments: a deposit first, then regular payments. The total usually costs more than paying cash.',
          example: 'TV: K500 deposit + 6 instalments of K250 = K2,000 total.',
          hint: 'Pay slowly — but pay more overall.',
          category: 'concept',
        },
        {
          front: 'A trader buys tomatoes for K150 and sells them all for K195. Find the percentage profit.',
          back: 'Profit = 195 − 150 = K45. Percentage profit = (45 ÷ 150) × 100 = 30%.',
          example: null,
          hint: 'Find the profit in Kwacha first.',
          category: 'question',
        },
      ],
    },
  },
]
