/**
 * Hand-curated sample artifacts for the public /teachers landing page.
 *
 * Lesson plan, worksheet and flashcards render through the studios' own
 * presenter components (LessonPlanView / LessonPlanOfficialTable,
 * WorksheetView, FlashcardsView). The scheme of work and weekly forecast
 * use the new official CDC tables (SchemeOfWorkOfficialTable,
 * WeeklyForecastOfficialTable), keyed by `layout: 'official-table'`:
 *   • scheme  — flat `weeks[]` of { week, topic, subtopic,
 *     specificCompetences[], learningActivities[], expectedStandard,
 *     methods[], tlAids[], references }.
 *   • forecast — `header` (weekNumber, weekBeginning, weekEnding…) plus a
 *     `days[]` of { day, topic, subtopic, specificCompetence,
 *     learningActivities[], expectedStandard, resources[], remarks }.
 *
 * Editing/swapping a sample: paste the `output` field of any aiGenerations
 * doc over the matching `artifact` here and adjust the card meta. Keep the
 * lesson plan on schemaVersion "3.0" (official CDC stages INTRODUCTION →
 * LESSON DEVELOPMENT → EXERCISE / ASSESSMENT → HOMEWORK → CONCLUSION).
 */

// Extracted from the school's own Grade 4 Social Studies test paper and
// downscaled to 640px WebP (~49 kB). Used by the term-test labelling task.
import coatOfArmsImg from '../assets/marketing/zambia-coat-of-arms.webp'

// Letter callouts pinned on the Coat of Arms parts (x/y as % of the image)
// so learners can see exactly which element each blank refers to.
const COAT_OF_ARMS_MARKERS = [
  { letter: 'a', x: 50, y: 10 },  // eagle
  { letter: 'b', x: 40, y: 18 },  // hoe
  { letter: 'c', x: 60, y: 18 },  // pick
  { letter: 'd', x: 50, y: 49 },  // shield
  { letter: 'e', x: 28, y: 45 },  // man
  { letter: 'f', x: 74, y: 45 },  // woman
  { letter: 'g', x: 33, y: 72 },  // mining shaft
  { letter: 'h', x: 62, y: 76 },  // zebra
  { letter: 'i', x: 50, y: 90 },  // maize cob
]

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
    subject: 'Integrated Science',
    topic: 'Term 1 plan',
    // New official scheme-of-work format — the 9-column CDC layout schools
    // use (WEEK | TOPIC | SUBTOPIC | SPECIFIC COMPETENCES | LEARNING
    // ACTIVITIES | EXPECTED STANDARD | METHODS | T/L AIDS | REF), rendered by
    // SchemeOfWorkOfficialTable. Content is the real Grade 4 Integrated
    // Science Term 1 2026 scheme of work.
    blurb: 'The new CDC scheme-of-work format — every week mapped across specific competences, learning activities, expected standard, methods, teaching aids and references.',
    layout: 'official-table',
    artifact: {
      schemaVersion: 'sow-table-1.0',
      header: {
        subject: 'Integrated Science',
        grade: '4',
        term: 1,
        year: '2026',
        periodsPerWeek: '6 periods × 40 minutes',
      },
      weeks: [
      {
        week: "1",
        topic: "4.1 THE HUMAN BODY",
        subtopic: "4.1.1 The Respiratory System",
        specificCompetences: ["4.1.1.1 Demonstrate understanding of the respiratory system in the human body"],
        learningActivities: ["Describing the respiratory system in humans", "Analysing the main parts: nose, trachea, bronchi and lungs", "Drawing the human respiratory system", "Making models/charts illustrating movement of air into and out of the lungs"],
        expectedStandard: "Understanding of the respiratory system demonstrated satisfactorily",
        methods: ["Exposition", "Q & A", "Group work", "Demonstration", "Practical"],
        tlAids: ["Charts", "Models", "Diagrams", "Real objects", "Science Module"],
        references: "Grade 4 Science Syllabus p.1; Grade 4 Science Module",
      },
      {
        week: "2",
        topic: "4.1 THE HUMAN BODY",
        subtopic: "4.1.1 The Respiratory System (cont.)",
        specificCompetences: ["4.1.1.1 Demonstrate understanding of the respiratory system – respiratory diseases"],
        learningActivities: ["Investigating respiratory diseases: Bronchitis, Tuberculosis, Influenza, Asthma", "Discussing causes, symptoms and prevention of respiratory diseases", "Creating a self-care plan to promote respiratory health", "Role-playing healthy breathing habits"],
        expectedStandard: "Respiratory diseases identified and self-care plans created correctly",
        methods: ["Exposition", "Q & A", "Pair work", "Research", "Discussion"],
        tlAids: ["Charts", "Posters", "Health pamphlets", "Science Module"],
        references: "Grade 4 Science Syllabus p.1; Grade 4 Science Module",
      },
      {
        week: "3",
        topic: "4.1 THE HUMAN BODY",
        subtopic: "4.1.2 Blood Circulatory System",
        specificCompetences: ["4.1.2.1 Demonstrate understanding of the blood circulatory system in the human body"],
        learningActivities: ["Describing the Blood Circulatory System in humans", "Analysing the components of blood: red blood cells, white blood cells, platelets and plasma", "Drawing and labelling the parts of the human heart collaboratively", "Tracking the flow of blood in veins and arteries"],
        expectedStandard: "Blood circulatory system described and components of blood identified correctly",
        methods: ["Exposition", "Q & A", "Group work", "Collaborative drawing"],
        tlAids: ["Heart diagrams", "Charts", "Models", "Science Module"],
        references: "Grade 4 Science Syllabus p.2; Grade 4 Science Module",
      },
      {
        week: "4",
        topic: "4.1 THE HUMAN BODY",
        subtopic: "4.1.2 Blood Circulatory System (cont.)",
        specificCompetences: ["4.1.2.1 Demonstrate understanding of the blood circulatory system – cardiac health"],
        learningActivities: ["Making a simple longitudinal model of the blood circulatory system", "Calculating the pulse rate practically", "Investigating common cardiac diseases in the community (heart failure, coronary heart disease)", "Analysing causes of cardiac diseases: unhealthy diets, tobacco, alcohol, diabetes, high BP"],
        expectedStandard: "Understanding of the blood circulatory system demonstrated appropriately; CLASS TEST administered",
        methods: ["Practical", "Demonstration", "Q & A", "Research", "Discussion"],
        tlAids: ["Models", "Stopwatch", "Charts", "Science Module"],
        references: "Grade 4 Science Syllabus p.2; Grade 4 Science Module",
      },
      {
        week: "5",
        topic: "4.2 NUTRITION & HEALTH",
        subtopic: "4.2.1 Classification of Food",
        specificCompetences: ["4.2.1.1 Classify foods based on their nutritional content"],
        learningActivities: ["Collecting different foods found in the local environment (raw and processed)", "Sorting foods into groups: cereals & tubers, fish/insects/meat, pulses, dairy, vegetables & fruits", "Classifying food nutrients into proteins, carbohydrates, fats, vitamins and minerals", "Drawing and labelling a food classification chart"],
        expectedStandard: "Foods classified into their respective groups correctly",
        methods: ["Exposition", "Q & A", "Group work", "Practical", "Sorting activity"],
        tlAids: ["Food samples", "Charts", "Pictures of foods", "Science Module"],
        references: "Grade 4 Science Syllabus p.3; Grade 4 Science Module",
      },
      {
        week: "6",
        topic: "4.2 NUTRITION & HEALTH",
        subtopic: "4.2.1 Classification of Food (cont.)",
        specificCompetences: ["4.2.1.1 Classify foods based on their nutritional content – deep application"],
        learningActivities: ["Identifying sources of each nutrient in the local environment", "Making a food chart showing different food groups using pictures/drawings", "Comparing raw and processed food nutritional values", "Conducting a class survey on daily food intake"],
        expectedStandard: "Food nutrients correctly identified and classified with local examples",
        methods: ["Exposition", "Pair work", "Project work", "Survey"],
        tlAids: ["Food models", "Nutrition charts", "Food labels", "Science Module"],
        references: "Grade 4 Science Syllabus p.3; Grade 4 Science Module",
      },
      {
        week: "7",
        topic: "4.2 NUTRITION & HEALTH",
        subtopic: "4.2.2 Healthy Diets",
        specificCompetences: ["4.2.2.1 Practise eating healthy diets"],
        learningActivities: ["Designing healthy diets for persons with different dietary needs", "Discussing importance of eating smaller quantities from all food groups (Apportionment)", "Making informed choices about healthy living: exercise, BMI, adequate water intake", "Role-playing healthy and unhealthy eating scenarios"],
        expectedStandard: "Eating healthy diets practised and healthy diet plans designed accordingly",
        methods: ["Exposition", "Discussion", "Role play", "Group work", "Q & A"],
        tlAids: ["Food pyramid chart", "BMI chart", "Pictures", "Science Module"],
        references: "Grade 4 Science Syllabus p.3; Grade 4 Science Module",
      },
      {
        week: "8",
        topic: "4.2 NUTRITION & HEALTH",
        subtopic: "4.2.3 Air, Water and Foodborne Diseases",
        specificCompetences: ["4.2.3.1 Show the ability to prevent the transmission of air, water and foodborne diseases"],
        learningActivities: ["Investigating airborne, waterborne and foodborne diseases", "Identifying causative agents: fungi, bacteria, parasites and viruses", "Practising ways of preventing diseases: wearing masks, safe water handling, hand washing", "Designing prevention posters for the community"],
        expectedStandard: "Airborne, waterborne and foodborne diseases identified; prevention methods listed; CLASS TEST administered",
        methods: ["Exposition", "Research", "Pair work", "Q & A", "Poster making"],
        tlAids: ["Disease charts", "Pictures", "Posters", "Science Module"],
        references: "Grade 4 Science Syllabus p.4; Grade 4 Science Module",
      },
      {
        week: "9",
        topic: "4.2 NUTRITION & HEALTH",
        subtopic: "4.2.3 Air, Water and Foodborne Diseases (cont.)",
        specificCompetences: ["4.2.3.1 Show the ability to prevent the transmission of air, water and foodborne diseases – practical prevention"],
        learningActivities: ["Demonstrating correct handwashing technique (7 steps)", "Exploring safe food storage practices: containers, refrigeration, covering food", "Investigating community water sources and safety: boiling, chlorination, filtration", "Reducing smoke and planting trees for clean air campaigns"],
        expectedStandard: "Prevention methods for air, water and foodborne diseases demonstrated correctly",
        methods: ["Demonstration", "Practical", "Discussion", "Field work"],
        tlAids: ["Basin/soap for handwashing demo", "Pictures", "Charts", "Science Module"],
        references: "Grade 4 Science Syllabus p.4; Grade 4 Science Module",
      },
      {
        week: "10",
        topic: "4.3 THE ENVIRONMENT",
        subtopic: "4.3.1 Environmental Management",
        specificCompetences: ["4.3.1.1 Manage natural resources and waste in the environment"],
        learningActivities: ["Describing natural resources and wastes in the environment", "Exploring natural resources in the local environment: biotic (plants, animals) and abiotic (water, soil, air)", "Analysing the importance of natural resources: raw materials, fresh air, water, food, income, tourism", "Identifying types of wastes in the local environment (liquid and solid)"],
        expectedStandard: "Natural resources identified and their importance analysed correctly",
        methods: ["Exposition", "Field walk", "Group work", "Discussion", "Q & A"],
        tlAids: ["Environmental charts", "Pictures", "Real objects from environment", "Science Module"],
        references: "Grade 4 Science Syllabus p.4; Grade 4 Science Module",
      },
      {
        week: "11",
        topic: "4.3 THE ENVIRONMENT",
        subtopic: "4.3.1 Environmental Management (cont.)",
        specificCompetences: ["4.3.1.1 Manage natural resources and waste in the environment – waste management"],
        learningActivities: ["Devising ways of managing natural resources in the local environment", "Practising the Three Rs: Reuse, Recycle, Reduce", "Exploring incinerators and proper waste disposal methods", "Creating an environmental management action plan for the school"],
        expectedStandard: "Natural resources and waste in the environment managed correctly; action plan created",
        methods: ["Practical", "Group work", "Project work", "Discussion"],
        tlAids: ["Waste samples", "Recycling bins", "Charts", "Science Module"],
        references: "Grade 4 Science Syllabus p.4; Grade 4 Science Module",
      },
      {
        week: "12",
        topic: "REVISION & EXAMINATION",
        subtopic: "All Term 1 Topics",
        specificCompetences: ["Review all competences covered in Term 1"],
        learningActivities: ["Revising 4.1 The Human Body (Respiratory & Circulatory Systems)", "Revising 4.2 Nutrition & Health (Food Classification, Healthy Diets, Diseases)", "Revising 4.3 The Environment (Environmental Management)", "Administering End-of-Term 1 Examination"],
        expectedStandard: "All Term 1 competences reviewed; End-of-Term 1 Examination administered",
        methods: ["Revision", "Q & A", "Examination"],
        tlAids: ["Revision charts", "Examination papers", "Past exercises"],
        references: "Grade 4 Science Syllabus; Grade 4 Science Module",
      },
      ],
    },
  },

  {
    id: 'weekly-forecast',
    tool: 'weekly_forecast',
    label: 'Weekly forecast',
    icon: '📅',
    grade: 'Grade 4',
    subject: 'Integrated Science',
    topic: 'Week 1',
    // Official weekly-forecast format — the per-day plan teachers fill in
    // for the coming week (WEEK | DAY | TOPIC | SUB-TOPIC | SPECIFIC
    // COMPETENCE | LEARNING ACTIVITY | EXPECTED STANDARD | T/L RESOURCES |
    // REMARKS). Rendered by WeeklyForecastOfficialTable. Content is Week 1
    // of the real Grade 4 Integrated Science Term 1 2026 forecast.
    blurb: 'The official weekly-forecast document — the week broken down day by day, with a progress-remarks column to annotate after each lesson. One is generated per week.',
    layout: 'official-table',
    artifact: {
      schemaVersion: 'forecast-table-1.0',
      header: {
        subject: 'Integrated Science',
        grade: '4',
        term: 1,
        year: '2026',
        weekNumber: 1,
        weekBeginning: '12 Jan 2026',
        weekEnding: '16 Jan 2026',
      },
      days: [
        {
          day: '1',
          topic: '4.1 THE HUMAN BODY',
          subtopic: '4.1.1 The Respiratory System',
          specificCompetence: '4.1.1.1 Demonstrate understanding of the respiratory system in the human body',
          learningActivities: [
            'Describing the respiratory system in humans',
            'Analysing the main parts: nose, trachea, bronchi and lungs',
            'Drawing the human respiratory system',
            'Making models/charts illustrating movement of air into and out of the lungs',
          ],
          expectedStandard: 'Understanding of the respiratory system demonstrated satisfactorily',
          resources: ['Charts', 'Models', 'Diagrams', 'Real objects', 'Science Module', 'CDC Syllabus Grade 4–7'],
          remarks: '',
        },
        {
          day: '2',
          topic: '4.1 THE HUMAN BODY',
          subtopic: '4.1.1 The Respiratory System',
          specificCompetence: '4.1.1.1 Demonstrate understanding of the respiratory system in the human body',
          learningActivities: [
            'Describing the respiratory system in humans',
            'Analysing the main parts: nose, trachea, bronchi and lungs',
            'Drawing the human respiratory system',
            'Making models/charts illustrating movement of air into and out of the lungs',
          ],
          expectedStandard: 'Understanding of the respiratory system demonstrated satisfactorily',
          resources: ['Charts', 'Models', 'Diagrams', 'Real objects', 'Science Module', 'CDC Syllabus Grade 4–7'],
          remarks: '',
        },
        {
          day: '3',
          topic: '4.1 THE HUMAN BODY',
          subtopic: '4.1.1 The Respiratory System',
          specificCompetence: '4.1.1.1 Demonstrate understanding of the respiratory system in the human body',
          learningActivities: [
            'Describing the respiratory system in humans',
            'Analysing the main parts: nose, trachea, bronchi and lungs',
            'Drawing the human respiratory system',
            'Making models/charts illustrating movement of air into and out of the lungs',
          ],
          expectedStandard: 'Understanding of the respiratory system demonstrated satisfactorily',
          resources: ['Charts', 'Models', 'Diagrams', 'Real objects', 'Science Module', 'CDC Syllabus Grade 4–7'],
          remarks: '',
        },
      ],
    },
  },

  {
    id: 'term-tests',
    tool: 'term_test',
    label: 'Term test',
    icon: '📋',
    grade: 'Grade 4',
    subject: 'Social Studies',
    topic: 'Term 1',
    // Real Grade 4 Social Studies Term 1 2026 papers (mid-term + end of
    // term), rendered as the printed test paper (TestPaperOfficial). The
    // page toggles between the two variants. School name swapped to the
    // fictional one used across all samples; obvious source typos cleaned.
    blurb: 'Mid-term and end-of-term papers, ready to print — circle-the-answer sections, true/false, and a label-the-diagram task with a word bank.',
    madeWith: 'Assessment',
    layout: 'official-table',
    artifact: {
      schemaVersion: 'test-paper-1.0',
      midterm: {
        header: {
          school: 'Chilenje Primary School',
          title: 'Mid-Term 1 Test — 2026',
          subject: 'Social Studies',
          grade: '4',
        },
        instructions: 'Answer all the questions in this paper.',
        sections: [
          {
            title: 'Section A',
            intro: 'Circle the correct answer.',
            questions: [
              { type: 'mcq', n: 1, prompt: 'What does the motto "One Zambia One Nation" mean?', options: ['freedom', 'agriculture', 'mining', 'unity'] },
              { type: 'mcq', n: 2, prompt: 'On the Coat of Arms, what symbol represents mining?', options: ['The pick-axe', 'The hoe', 'The shield', 'The eagle'] },
              { type: 'mcq', n: 3, prompt: 'On the 24th day of which month do Zambians celebrate their independence?', options: ['May', 'December', 'April', 'October'] },
              { type: 'mcq', n: 4, prompt: 'A good leader must …………', options: ['insult others', 'fight others', 'lead by example', 'quarrel with others'] },
              { type: 'mcq', n: 5, prompt: 'How many provinces are in Zambia?', options: ['11', '9', '13', '10'] },
              { type: 'mcq', n: 6, prompt: 'Who was the first president of Zambia?', options: ['Levy Mwanawasa', 'Rupiah Banda', 'Kenneth Kaunda', 'Fredrick Chiluba'] },
              { type: 'subhead', text: 'Questions 7 – 10: True or False' },
              { type: 'mcq', n: 7, prompt: 'A good citizen must not obey the laws of a country.', options: ['True', 'False'] },
              { type: 'mcq', n: 8, prompt: 'The man and woman symbols represent all the people of Zambia.', options: ['True', 'False'] },
              { type: 'mcq', n: 9, prompt: 'Citizens should respect and obey the laws of their country.', options: ['True', 'False'] },
              { type: 'mcq', n: 10, prompt: 'Citizenship is being a member of a country.', options: ['True', 'False'] },
            ],
          },
          {
            title: 'Section B',
            intro: '',
            questions: [
              {
                type: 'label-diagram',
                n: 1,
                prompt: 'Label the Zambian Coat of Arms.',
                diagram: 'Zambian Coat of Arms diagram',
                image: coatOfArmsImg,
                markers: COAT_OF_ARMS_MARKERS,
                imageAlt: 'The Zambian Coat of Arms — eagle, crossed pick and hoe, shield, man and woman supporters, maize cob, mining shaft and zebra above the motto One Zambia One Nation',
                slots: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
              },
              {
                type: 'fill-letters',
                n: 2,
                prompt: 'Look at the Coat of Arms above. Which symbol represents:',
                parts: [
                  { letter: 'a', text: 'family' },
                  { letter: 'b', text: 'staple food' },
                  { letter: 'c', text: 'agriculture' },
                  { letter: 'd', text: 'wildlife' },
                  { letter: 'e', text: 'minerals' },
                ],
              },
            ],
          },
        ],
      },
      endOfTerm: {
        header: {
          school: 'Chilenje Primary School',
          title: 'End of Term 1 Test — 2026',
          subject: 'Social Studies',
          grade: '4',
        },
        instructions: 'Answer all the questions in this paper.',
        sections: [
          {
            title: 'Section A',
            intro: 'Circle the correct answer.',
            questions: [
              { type: 'mcq', n: 1, prompt: 'What does the motto "One Zambia One Nation" mean?', options: ['freedom', 'agriculture', 'mining', 'unity'] },
              { type: 'mcq', n: 2, prompt: 'On the Coat of Arms, what symbol represents mining?', options: ['The pick-axe', 'The hoe', 'The shield', 'The eagle'] },
              { type: 'mcq', n: 3, prompt: 'Which symbol on the Coat of Arms represents agriculture?', options: ['Eagle', 'Hoe', 'Man', 'Zebra'] },
              { type: 'mcq', n: 4, prompt: '…….. family is made up of father, mother and children.', options: ['An adoptive', 'An extended', 'A foster', 'A nuclear'] },
              { type: 'mcq', n: 5, prompt: 'Which one of these is NOT a community project?', options: ['feeding the hungry', 'planting trees', 'throwing litter', 'picking up litter'] },
              { type: 'mcq', n: 6, prompt: 'A good leader must …………', options: ['insult others', 'fight others', 'lead by example', 'quarrel with others'] },
              { type: 'mcq', n: 7, prompt: 'How many provinces are in Zambia?', options: ['11', '9', '13', '10'] },
              { type: 'mcq', n: 8, prompt: 'Who was the first president of Zambia?', options: ['Levy Mwanawasa', 'Rupiah Banda', 'Kenneth Kaunda', 'Fredrick Chiluba'] },
              { type: 'mcq', n: 9, prompt: 'People who are in need should be …………', options: ['helped', 'left alone', 'laughed at', 'beaten'] },
              { type: 'mcq', n: 10, prompt: 'A group of two or more people that are related by blood is called a …..', options: ['community', 'family', 'friendship', 'relationship'] },
              { type: 'mcq', n: 11, prompt: "The zebra on the Coat of Arms represents Zambia's ………", options: ['family wealth', 'freedom', 'mineral wealth', 'wildlife'] },
              { type: 'mcq', n: 12, prompt: 'A family made up of a mother, father and children only is a ……… family.', options: ['Extended', 'Nuclear', 'Orphanage', 'Single'] },
              { type: 'mcq', n: 13, prompt: 'The highest coin used in Zambia is ……….', options: ['five ngwee', 'one kwacha', 'five kwacha', 'two kwacha'] },
              { type: 'mcq', n: 14, prompt: 'Colour green on the Zambian flag means …….', options: ['blood', 'vegetation', 'wealth', 'people'] },
              { type: 'mcq', n: 15, prompt: 'A family provides …….. to its members.', options: ['fear', 'security', 'disobedience', 'indiscipline'] },
              { type: 'mcq', n: 16, prompt: "Working well with other people in the community shows a citizen's ……..", options: ['duty', 'privilege', 'responsibility', 'right'] },
              { type: 'mcq', n: 17, prompt: '………. children are brought up by parents who are not biologically theirs.', options: ['Adopted', 'Beautiful', 'Obedient', 'Tolerant'] },
              { type: 'mcq', n: 18, prompt: 'What is the capital city of Zambia?', options: ['Ndola', 'Lusaka', 'Kitwe', 'Livingstone'] },
              { type: 'mcq', n: 19, prompt: 'Which of the following is a duty of every citizen?', options: ['Getting educated', 'Moving freely', 'Paying taxes', 'Vandalising property'] },
              { type: 'mcq', n: 20, prompt: 'On the 24th day of which month do Zambians celebrate their independence?', options: ['May', 'December', 'April', 'October'] },
            ],
          },
          {
            title: 'Section B',
            intro: '',
            questions: [
              {
                type: 'label-diagram',
                n: 1,
                prompt: 'Label the Zambian Coat of Arms.',
                diagram: 'Zambian Coat of Arms diagram',
                image: coatOfArmsImg,
                markers: COAT_OF_ARMS_MARKERS,
                imageAlt: 'The Zambian Coat of Arms — eagle, crossed pick and hoe, shield, man and woman supporters, maize cob, mining shaft and zebra above the motto One Zambia One Nation',
                wordBank: ['eagle', 'zebra', 'shield', 'hoe', 'pick', 'mining shaft', 'maize cob', 'man', 'woman'],
                slots: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'mark-schedule',
    tool: 'mark_schedule',
    label: 'Mark schedule',
    icon: '🧮',
    grade: 'Grade 3',
    subject: 'All subjects',
    topic: 'Term 2',
    // Mirrors the school mark-schedule format (SN | PUPIL'S NAME | subject
    // columns | TOTAL | POSITION) with the studio's value-add: totals,
    // positions (dense ranking, ties share a place) and per-band suggested
    // comments are computed automatically. Pupils are FICTIONAL — the
    // reference XLSX contains real learner names that must never ship.
    blurb: 'Enter the marks — totals and class positions fill themselves in, and suggested report comments print on their own sheet (the A4 schedule stays clean, even for classes of 80+).',
    layout: 'official-table',
    artifact: {
      schemaVersion: 'mark-schedule-1.0',
      header: {
        school: 'Chilenje Primary School',
        grade: '3',
        term: 2,
        year: '2026',
      },
      subjects: [
        { key: 'maths', label: 'MATHS', max: 25 },
        { key: 'english', label: 'ENGLISH', max: 25 },
        { key: 'science', label: 'SCIENCE', max: 26 },
        { key: 'social', label: 'SOCIAL STUDIES', max: 26 },
        { key: 'cts', label: 'C.T.S', max: 25 },
      ],
      pupils: [
        {
          sn: 1, name: 'Natasha Zulu',
          marks: { maths: 23, english: 21, science: 24, social: 22, cts: 20 },
          total: 110, position: 1,
          comment: 'Excellent results! Keep it up, Natasha.',
        },
        {
          sn: 2, name: 'Emmanuel Tembo',
          marks: { maths: 20, english: 22, science: 23, social: 21, cts: 21 },
          total: 107, position: 2,
          comment: 'Very good work. Aim for number one next term, Emmanuel.',
        },
        {
          sn: 3, name: 'Chimwemwe Banda',
          marks: { maths: 19, english: 23, science: 20, social: 24, cts: 18 },
          total: 104, position: 3,
          comment: 'Very good performance. Keep working hard, Chimwemwe.',
        },
        {
          sn: 4, name: 'Joseph Mwewa',
          marks: { maths: 21, english: 18, science: 22, social: 20, cts: 23 },
          total: 104, position: 3,
          comment: 'Very good work, but put more effort in English, Joseph.',
        },
        {
          sn: 5, name: 'Lushomo Hamoonga',
          marks: { maths: 18, english: 20, science: 21, social: 19, cts: 20 },
          total: 98, position: 4,
          comment: 'Good work. With more practice in Maths you will do even better.',
        },
        {
          sn: 6, name: 'Grace Mulenga',
          marks: { maths: 17, english: 19, science: 18, social: 21, cts: 17 },
          total: 92, position: 5,
          comment: 'Good effort, but she can do better. Keep reading every day.',
        },
        {
          sn: 7, name: 'Kondwani Sakala',
          marks: { maths: 16, english: 15, science: 19, social: 18, cts: 20 },
          total: 88, position: 6,
          comment: 'A fair result. Pull up your socks in English, Kondwani.',
        },
        {
          sn: 8, name: 'Thandiwe Ngoma',
          marks: { maths: 14, english: 18, science: 16, social: 17, cts: 18 },
          total: 83, position: 7,
          comment: 'Fair work. More effort is needed in Mathematics.',
        },
        {
          sn: 9, name: 'Mapalo Kabwe',
          marks: { maths: 15, english: 13, science: 17, social: 16, cts: 15 },
          total: 76, position: 8,
          comment: 'Below average. Do not give up, keep practising your reading.',
        },
        {
          sn: 10, name: 'Chanda Mwansa',
          marks: { maths: 12, english: 14, science: 13, social: 15, cts: 14 },
          total: 68, position: 9,
          comment: 'Work extra hard next term, Chanda. Please see me for remedial lessons.',
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
