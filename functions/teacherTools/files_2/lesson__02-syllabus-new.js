// ============ Zambian CBC Syllabus Database ============
// =========== SYLLABUS VERSION SYSTEM ===========
// Two versions supported: 'new' (2023 ZECF) and 'old' (2013 CDC)
// Old syllabus uses different grade structure: G1-7 primary, G8-12 secondary
// Some grades (5, 6, 7, 10, 11, 12) are still officially using old syllabus
let syllabusVersion = 'new';

// === NEW (2023) ===
const gradeLevel = {
  'Grade 1':'lp','Grade 2':'lp','Grade 3':'lp',
  'Grade 4':'up','Grade 5':'up','Grade 6':'up',
  'Form 1':'js','Form 2':'js',
  'Form 3':'ss','Form 4':'ss',
  'Form 5':'al'
};

// === OLD (2013) ===
// Old syllabus is ONLY used by grades 5, 6, 7, 10, 11, 12 per current Zambian usage.
// G1-4 and G8-9 have transitioned to the new 2023 framework.
const oldGradeLevel = {
  'Grade 5':'oup','Grade 6':'oup','Grade 7':'oup',
  'Grade 10':'oss','Grade 11':'oss','Grade 12':'oss'
};
const oldClassOptions = ['Grade 5','Grade 6','Grade 7','Grade 10','Grade 11','Grade 12'];
const newClassOptions = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Form 1','Form 2','Form 3','Form 4','Form 5'];

const subjectsByLevel = {
  // Lower Primary G1-3 (per 2023 ZECF §4.2.1) — exactly 3 learning areas + individual components for teacher choice
  'lp': [
    'Literacy and Language (Learning Area)',
    'Mathematics and Science (Learning Area)',
    'Creative and Technology Studies (Learning Area)',
    'English Language',
    'Zambian Language',
    'Mathematics',
    'Science',
    'Creative and Technology Studies'
  ],
  // Upper Primary G4-6 (per 2023 ZECF §4.2.2 + Table 4) — 8 learning areas (learner takes 7)
  'up': [
    'English Language',
    'Zambian Language',
    'Mathematics',
    'Science',
    'Social Studies',
    'Technology Studies',
    'Expressive Arts',
    'Home Economics'
  ],
  // Junior Secondary F1-2 (per 2023 ZECF §4.3 + Table 7) — same 25-subject list as Senior; subjects split here
  'js': [
    'English Language',
    'Mathematics',
    'Biology',
    'Physics',
    'Chemistry',
    'Geography',
    'History',
    'Civic Education',
    'Religious Education',
    'Zambian Languages',
    'Literature in English',
    'Information and Communication Technology',
    'Computer Science',
    'Design and Technology',
    'Home Management',
    'Fashion and Fabrics',
    'Food and Nutrition',
    'Agricultural Science',
    'Art and Design',
    'Music',
    'Physical Education',
    'Commerce',
    'Principles of Accounts',
    'Travel and Tourism',
    'Foreign Languages (French)'
  ],
  // Senior Secondary F3-4 (Ordinary Level — same 25 subjects per Table 7)
  'ss': [
    'English Language',
    'Mathematics',
    'Biology',
    'Physics',
    'Chemistry',
    'Geography',
    'History',
    'Civic Education',
    'Religious Education',
    'Zambian Languages',
    'Literature in English',
    'Information and Communication Technology',
    'Computer Science',
    'Design and Technology',
    'Home Management',
    'Fashion and Fabrics',
    'Food and Nutrition',
    'Agricultural Science',
    'Art and Design',
    'Music',
    'Physical Education',
    'Commerce',
    'Principles of Accounts',
    'Travel and Tourism',
    'Foreign Languages (French)'
  ],
  // Advanced Level F5-6
  'al': [
    'Advanced Mathematics',
    'Further Mathematics',
    'Biology',
    'Chemistry',
    'Physics',
    'Geography',
    'History',
    'Literature in English',
    'Economics',
    'Computer Science'
  ]
};
const syllabus = {
  'lp': {
    // ===== 3 OFFICIAL LEARNING AREAS (G1-3 per 2023 ZECF §4.2.1) =====
    'Literacy and Language (Learning Area)': {
      'Oral Language (English)': ['Listening and speaking','Vocabulary building','Following instructions','Storytelling and conversation'],
      'Phonics and Reading (English)': ['Letter sounds','Blending sounds','Sight words','Reading simple sentences','Reading comprehension'],
      'Writing (English)': ['Letter formation','Writing words','Simple sentences','Punctuation basics'],
      'Zambian Language Literacy': ['Letter-sound correspondence','Reading short texts','Writing simple words','Oral expression'],
      'Vocabulary and Grammar': ['Common nouns','Action words','Describing words','Singular and plural']
    },
    'Mathematics and Science (Learning Area)': {
      'Numbers and Counting': ['Counting 1-100','Number names','Place value: tens and ones','Number patterns','Comparing numbers'],
      'Addition and Subtraction': ['Within 10','Within 20','Adding/subtracting tens','Word problems'],
      'Multiplication and Division': ['Times tables 1-10','Sharing equally','Word problems'],
      'Money, Time and Measurement': ['Kwacha coins and notes','Telling time','Length, mass, capacity'],
      'Shapes and Patterns': ['2D shapes','3D shapes','Patterns and sequences'],
      'Living Things': ['Plants around us','Animals around us','Parts of the body','Healthy living'],
      'Materials and Environment': ['Water and air','Weather and seasons','Caring for the environment','Soil and rocks']
    },
    'Creative and Technology Studies (Learning Area)': {
      'Expressive Arts': ['Drawing and colouring','Singing and rhymes','Dance and movement','Role-play and drama','Crafts'],
      'Home Economics (Practical Skills)': ['Personal hygiene','Caring for clothes','Healthy foods','Tidying the home'],
      'Technology Studies (Basic)': ['Tools we use','Simple machines','Working with paper, wood, fabric','Safety with tools'],
      'Digital Skills (Introductory)': ['Parts of a computer','Using a tablet','Safe screen use']
    },
    // ===== INDIVIDUAL COMPONENT SUBJECTS (G1-3) =====
    'English Language': {
      'G1': {
        'Listening and Speaking': ['Listening to simple instructions','Greetings and introductions','Naming objects in the classroom','Simple conversations','Singing and rhymes'],
        'Phonics': ['Single letter sounds a-z','Recognising letters','Letter-sound matching','Beginning sounds in words'],
        'Reading': ['Reading own name','Sight words: the, is, a, I, we','Reading 3-letter words','Reading short labels'],
        'Writing': ['Letter formation: lowercase a-z','Letter formation: uppercase A-Z','Writing own name','Copying simple words'],
        'Grammar (Basics)': ['Naming words','Capital letters at start of sentences','Full stops at end of sentences']
      },
      'G2': {
        'Listening and Speaking': ['Following 2-3 step instructions','Telling about my family','Asking and answering questions','Telling short stories','Reciting poems'],
        'Phonics': ['Consonant blends: bl, cl, fl, st, sp','Short vowel sounds','Long vowel sounds','Digraphs: sh, ch, th'],
        'Reading': ['Reading sentences','Sight words: 50+ common words','Reading short stories aloud','Answering simple comprehension questions'],
        'Writing': ['Writing simple sentences','Writing about pictures','Writing personal information','Spelling common words'],
        'Grammar': ['Nouns and verbs','Singular and plural','Question marks','Personal pronouns: I, you, he, she']
      },
      'G3': {
        'Listening and Speaking': ['Following multi-step instructions','Discussing class topics','Retelling stories','Asking for clarification','Speaking clearly to a group'],
        'Phonics and Word Study': ['Word families','Compound words','Prefixes (re-, un-)','Spelling patterns'],
        'Reading': ['Reading short paragraphs','Reading for meaning','Identifying main idea','Reading non-fiction'],
        'Writing': ['Writing 5-sentence paragraphs','Writing personal letters','Writing simple stories','Punctuation: capitals, full stops, question marks, commas'],
        'Grammar': ['Common and proper nouns','Verbs: action words','Adjectives: describing words','Simple present and past tense','Subject-verb agreement (intro)']
      }
    },
    'Zambian Language': {
      'Oral Language': ['Greetings and conversation','Songs and rhymes','Storytelling','Poems'],
      'Reading': ['Letter-sound recognition','Decoding words','Reading sentences','Short passages'],
      'Writing': ['Letter formation','Word writing','Simple sentences','Personal information'],
      'Cultural Content': ['Traditional stories','Cultural practices','Local environment vocabulary']
    },
    'Mathematics': {
      'G1': {
        'Numbers and Counting': ['Counting 1-20','Counting 1-50','Counting 1-100','Number names 1-20','Recognising numerals','Comparing numbers: more, less, equal','Ordering numbers'],
        'Addition': ['Adding within 10 using objects','Adding within 10 using number line','Vertical addition within 10','Word problems within 10'],
        'Subtraction': ['Taking away within 10','Subtraction within 10 using objects','Vertical subtraction within 10','Word problems within 10'],
        'Money': ['Recognising Kwacha coins','Recognising Kwacha notes','Buying simple items'],
        'Time': ['Days of the week','Morning, afternoon, evening','Yesterday, today, tomorrow'],
        'Shapes': ['2D shapes: triangle, square, circle, rectangle','Sorting shapes','Patterns with shapes'],
        'Measurement': ['Long and short','Heavy and light','Full and empty']
      },
      'G2': {
        'Numbers and Counting': ['Counting 1-200','Number names 1-100','Place value: tens and ones','Number patterns: counting in 2s, 5s, 10s','Comparing 2-digit numbers','Ordering numbers up to 100'],
        'Addition': ['Addition within 20','Adding 2-digit numbers without carrying','Addition with carrying (intro)','Word problems within 20'],
        'Subtraction': ['Subtraction within 20','Subtracting 2-digit numbers without borrowing','Word problems within 20'],
        'Multiplication': ['Repeated addition','Times tables: 2, 5, 10','Multiplication as groups'],
        'Division': ['Sharing equally into groups','Division as repeated subtraction','Division by 2, 5, 10'],
        'Money': ['Counting Kwacha coins and notes','Adding amounts of money','Making change with small amounts'],
        'Time': ['Telling time: o\'clock','Half past','Months of the year','Calendar reading'],
        'Shapes': ['2D shapes properties','3D shapes: cube, sphere, cylinder, cone','Sides and corners'],
        'Measurement': ['Length using non-standard units','Mass: comparing weights','Capacity: comparing containers']
      },
      'G3': {
        'Numbers and Counting': ['Counting 1-1000','Place value: hundreds, tens, ones','Number names 1-1000','Comparing 3-digit numbers','Ordering and rounding'],
        'Addition': ['Adding 3-digit numbers without carrying','Adding 3-digit numbers with carrying','Mental addition strategies','Word problems'],
        'Subtraction': ['Subtracting 3-digit numbers without borrowing','Subtracting 3-digit numbers with borrowing','Mental subtraction','Word problems'],
        'Multiplication': ['Times tables: 3, 4, 6, 7, 8, 9','Multiplying by 10','Multiplying 2-digit numbers by 1-digit','Word problems'],
        'Division': ['Division by 3, 4, 5','Division with remainder','Word problems'],
        'Fractions (Intro)': ['Halves','Quarters','Thirds','Fractions of a whole'],
        'Money': ['Adding and subtracting money amounts','Making change','Simple budgeting'],
        'Time': ['Telling time: quarter past, quarter to, minutes past','Reading the calendar','Duration of events'],
        'Shapes': ['Properties of 2D shapes in detail','Properties of 3D shapes','Right angles','Symmetry (intro)'],
        'Measurement': ['Length: cm and m','Mass: g and kg','Capacity: ml and l']
      }
    },
    'Science': {
      'G1': {
        'Living Things': ['Plants we see every day','Parts of a plant: leaves, flowers, roots','Common animals around us','Domestic vs wild animals','Parts of the body','The five senses'],
        'Healthy Living': ['Personal hygiene: bathing, brushing teeth','Healthy foods we eat','Why we exercise','Sleep and rest'],
        'Materials': ['Water and its uses','Air around us','Hot and cold things'],
        'Weather and Environment': ['Sunny, rainy, cloudy weather','Day and night','Keeping our environment clean']
      },
      'G2': {
        'Living Things': ['Living and non-living things','Plant needs: water, sunlight, soil','Animal homes','Body parts and their functions','How we use our senses'],
        'Healthy Living': ['Hand washing and germs','Food groups (basic)','Exercise and play','Common illnesses and prevention'],
        'Materials': ['Properties of water','Soil types','Hard and soft materials','Things that float and sink'],
        'Weather and Environment': ['Seasons in Zambia','Weather chart','Caring for plants and animals','Pollution: keeping things clean']
      },
      'G3': {
        'Living Things': ['Plant life cycle','Plant parts and their jobs','Classification of animals (basic)','Animal life cycles','Body systems intro','Healthy growth'],
        'Healthy Living': ['Balanced diet','Disease prevention','Personal and community hygiene','First aid (basic)'],
        'Materials': ['States of matter: solid, liquid, gas','Mixing materials','Useful and harmful materials','Recycling'],
        'Weather and Environment': ['Water cycle (intro)','Weather instruments (basic)','Conservation: trees, water','Environmental problems and solutions']
      }
    },
    'Creative and Technology Studies': {
      'Expressive Arts': ['Drawing','Painting','Songs and rhymes','Dance and movement','Role-play','Crafts'],
      'Home Economics': ['Personal hygiene','Healthy foods','Caring for clothes','Tidying the home','Family roles'],
      'Technology Studies': ['Tools we use','Simple machines','Working with paper, wood, fabric','Safety with tools','Building simple things'],
      'Digital Skills': ['Parts of a computer','Using a tablet','Safe screen use']
    }
  },
  'up': {
    // ===== Upper Primary G4-6 — 8 learning areas per 2023 ZECF §4.2.2 =====
    'English Language': {
      'G4': {
        'Listening and Speaking': ['Active listening to short texts','Following multi-step instructions','Asking and answering questions','Group discussions on familiar topics','Recitation and storytelling'],
        'Reading and Comprehension': ['Reading short passages aloud','Silent reading','Answering comprehension questions','Reading for main idea','Reading for specific information'],
        'Writing': ['Writing complete sentences','Writing short paragraphs (3-5 sentences)','Personal letters to family/friends','Filling forms with personal details','Simple descriptions'],
        'Grammar': ['Common and proper nouns','Singular and plural','Simple present tense','Simple past tense','Capital letters and full stops','Question marks'],
        'Vocabulary and Spelling': ['Word families','Common spelling patterns','Synonyms (intro)','Antonyms (intro)'],
        'Literature and Texts': ['Listening to short stories','Simple poems and rhymes','Folktales']
      },
      'G5': {
        'Listening and Speaking': ['Listening for main ideas and details','Pronunciation and intonation','Group debates on simple topics','Presentations to class','Role-play conversations'],
        'Reading and Comprehension': ['Reading longer passages','Inferring meaning from context','Identifying main idea and supporting details','Reading non-fiction texts','Vocabulary in context'],
        'Writing': ['Compositions of one to two pages','Friendly letters','Formal letters (simple)','Recounts and reports','Stories with a clear beginning, middle, end','Descriptive writing'],
        'Grammar': ['Pronouns and their agreement','Adjectives and adverbs','Simple, continuous, perfect tenses','Subject-verb agreement','Conjunctions','Punctuation: commas, apostrophes'],
        'Vocabulary and Spelling': ['Prefixes and suffixes','Compound words','Synonyms and antonyms','Homophones','Spelling rules'],
        'Literature and Texts': ['Short stories','Narrative poems','Zambian folktales','Simple non-fiction articles']
      },
      'G6': {
        'Listening and Speaking': ['Critical listening','Formal presentations','Class debates','Interviews','News reports'],
        'Reading and Comprehension': ['Reading complex passages','Inference and prediction','Summarising key points','Distinguishing fact and opinion','Reading for different purposes'],
        'Writing': ['Compositions: narrative, descriptive, argumentative','Formal letters: application, complaint','Reports','Notices and announcements','Summaries and note-making','Creative writing'],
        'Grammar': ['All verb tenses','Active and passive voice','Direct and indirect speech','Phrases and clauses','Complex sentences','Punctuation in detail'],
        'Vocabulary and Spelling': ['Idioms and idiomatic expressions','Phrasal verbs','Word formation','Confusing words','Advanced spelling rules'],
        'Literature and Texts': ['Longer short stories','Poetry analysis: theme, mood','Plays/drama excerpts','Non-fiction: articles, biographies']
      }
    },
    'Zambian Language': {
      'Oral Communication': ['Conversations','Storytelling','Recitation of poems','Speeches'],
      'Reading': ['Reading aloud','Silent reading','Comprehension','Cultural texts'],
      'Writing': ['Compositions','Letters','Stories','Reports','Notes'],
      'Grammar and Vocabulary': ['Word classes','Sentence structure','Idioms and proverbs','Spelling'],
      'Literature and Culture': ['Folktales','Proverbs','Traditional songs','Cultural practices']
    },
    'Mathematics': {
      // OFFICIAL grade-by-grade topics (OCR'd from 2023 Mathematics Syllabus for Upper Primary G4-6)
      'G4': {
        'Sets': ['Operations on Sets'],
        'Numbers': ['Numbers and Notation up to 1,000,000','Factors and Multiples','Highest Common Factor (HCF)','Lowest Common Multiple (LCM)','Number patterns'],
        'Fractions': ['Common Fractions: equivalent fractions','Common Fractions: improper and mixed numbers','Adding and subtracting fractions with same denominator','Decimal Fractions up to 2 decimal places','Adding and subtracting decimals','Multiplying decimals by whole numbers','Dividing decimals by whole numbers'],
        'Financial Arithmetic': ['Money and budgeting','Cost price and selling price'],
        'Angles': ['Types of angles: acute, right, obtuse, straight, reflex','Measuring angles up to 360° using a protractor','Drawing angles with a protractor'],
        'Shapes': ['Parallel and perpendicular lines','Polygons up to 6 sides: trapezium, kite, rhombus, parallelogram, pentagon, hexagon','Drawing polygons with set squares, protractor, compass','Drawing a circle: centre, diameter, radius','Solid shapes and their properties']
      },
      'G5': {
        'Sets': ['The Universal Set and notation','Venn Diagrams: two sets with common members','Venn Diagrams: disjoint sets','Subsets in Venn diagrams','Set notations: intersection and union'],
        'Numbers': ['Roman Numerals','Converting between Arabic and Roman numerals','Ordering Roman numerals','Prime numbers','Composite numbers','Prime factorisation'],
        'Fractions': ['Equivalent fractions by multiplying/dividing','Adding and subtracting fractions with different denominators','Multiplying fractions by whole numbers','Multiplying fractions by fractions','Ordering fractions','Decimal Fractions up to 3 decimal places','Adding and subtracting decimals to 3dp','Multiplying decimals by decimals','Dividing decimals by decimals','Ordering decimal fractions'],
        'Combined Operations': ['Commutative law of addition and multiplication','Associative law of addition and multiplication','Distributive law of multiplication over addition/subtraction','Order of operations (BODMAS)','Carrying out combined operations'],
        'Angles': ['Complementary angles','Supplementary angles','Calculations involving complementary and supplementary angles'],
        'Shapes': ['Line of symmetry','Completing symmetrical shapes','Drawing lines of symmetry on plane shapes','Properties of cylinders','Properties of triangular prisms','Drawing nets of cylinders and triangular prisms','Sketching cylinders and triangular prisms'],
        'Measures': ['Perimeter of triangle, parallelogram, trapezium, rhombus','Perimeter of composite shapes','Area formulae: triangle, parallelogram, trapezium, rhombus','Calculating areas of composite shapes','Concept of volume','Standard units (cm³, m³)','Volume formula for cubes and cuboids','Volume vs capacity'],
        'Statistics': ['Stem-and-Leaf plots','Pie charts','Presenting data on stem-leaf plots and pie charts','Interpreting data from stem-leaf plots and pie charts']
      },
      'G6': {
        'Sets': ['Subsets of a set','Empty set as subset of every set','Number of subsets formula 2ⁿ','Finding subsets up to 3 members','Calculating number of subsets'],
        'Index Notation': ['Concept of index notation: bases and powers','Rewriting numbers in index form and expanded notation','Evaluating numbers in index notation','Perfect squares','Cubic numbers','Generating sequences using squares and cubes'],
        'Fractions': ['Dividing fractions by whole numbers and vice versa','Dividing a fraction by another fraction','Four operations on fractions','Concept of percentages','Converting fractions and decimals to percentages','Calculations involving percentages'],
        'Integers': ['Concept of integers using number line','Operations on integers: addition and subtraction','Operations on integers: multiplication and division','Real-life integer problems'],
        'Estimation and Approximations': ['Estimating quantities in measurement','Rounding off to nearest ten, hundred, thousand','Rounding off to km, m, cm','Rounding off decimals to stated decimal places'],
        'Ratio and Proportion': ['Meaning of ratio with concrete objects','Equivalent ratios','Ratios in lowest terms','Calculations involving ratio','Concept of direct proportion','Calculations involving direct proportion','Unitary method','Indirect (inverse) proportion','Graphs of direct and indirect proportion'],
        'Equations and Inequations': ['Linear equations: open sentences','Forming linear equations in one variable','Solving linear equations in one variable','Linear inequations in life contexts','Forming linear inequations in one variable','Solving linear inequations'],
        'Financial Arithmetic': ['Discount','Profit and loss','Percentage discount, profit, loss','Simple interest','Calculating simple interest','Foreign currency conversion','Cost of goods in foreign currency'],
        'Measures': ['Total length of edges of cubes and cuboids','Total surface area of cubes and cuboids','Concept of speed','Calculating speed using distance and time','Calculating distance using speed and time','Calculating time using speed and distance'],
        'Statistics': ['Mean','Mode','Median','Calculating measures of central tendency from data sets']
      }
    },
    'Science': {
      // Note: 2023 ZECF integrates Agricultural Science into Science at Upper Primary
      'G4': {
        'The Human Body': ['The Respiratory System: parts (nose, trachea, bronchi, lungs)','Drawing the human respiratory system','Movement of air in and out of lungs','Respiratory diseases: bronchitis, TB, influenza, asthma','Self-care plan for respiratory health','The Blood Circulatory System: parts','Components of blood: red cells, white cells, platelets, plasma','Drawing the human heart','Flow of blood in veins and arteries','Pulse rate','Cardiac diseases and their causes'],
        'Plants and Crops (Intro)': ['Parts of a plant','Functions of plant parts','Common Zambian crops','Caring for plants'],
        'Animals (Intro)': ['Domestic animals','Wild animals','Animal habitats','Caring for animals'],
        'Matter and Materials': ['Solids, liquids, gases','Properties of common materials','Uses of materials'],
        'Energy and Forces (Intro)': ['Sources of energy','Push and pull forces','Light and shadow basics'],
        'Earth and Environment': ['Weather and seasons','Day and night','Importance of trees','Pollution']
      },
      'G5': {
        'The Human Body': ['The Digestive System: parts and function','Drawing the digestive system','Healthy digestion and diet','The Excretory System: kidneys, skin, lungs','Drawing the excretory system','Diseases of the excretory system'],
        'Plants': ['Plant structure and function in detail','Photosynthesis: process and importance','Reproduction in flowering plants','Pollination and seed dispersal'],
        'Animals': ['Classification of animals: vertebrates and invertebrates','Animal adaptations to habitats','Life cycles: butterfly, frog, chicken','Food chains'],
        'Matter and Materials': ['Mixtures and solutions','Methods of separating mixtures','Changes in matter: physical and chemical','Properties of metals and non-metals'],
        'Energy': ['Forms of energy and energy transfer','Heat and temperature','Light: reflection and shadows','Sound: how it travels'],
        'Forces and Motion': ['Friction','Simple machines: lever, pulley, wedge','Magnets and magnetism'],
        'Earth and Environment': ['Water cycle','Soil types and farming','Solar system: sun, moon, planets'],
        'Health and Disease': ['Communicable diseases: malaria, cholera','Personal hygiene','HIV and AIDS basics']
      },
      'G6': {
        'The Human Body': ['The Reproductive System','Puberty and adolescent changes','The Nervous System: brain, spinal cord, nerves','The senses and the nervous system'],
        'Plants and Agriculture': ['Crop production basics','Pest and disease control','Farming methods in Zambia'],
        'Animals and Animal Husbandry': ['Animal classification in detail','Animal husbandry: cattle, goats, poultry','Animal products and uses'],
        'Matter and Materials': ['Properties of matter in depth','Acids and bases (intro)','Useful chemicals at home'],
        'Energy': ['Electricity: simple circuits','Conductors and insulators','Renewable and non-renewable energy'],
        'Forces and Motion': ['Forces and their effects','Pressure'],
        'Earth and Environment': ['Climate change','Conservation of natural resources','Mining and the environment'],
        'Health and Disease': ['Non-communicable diseases: diabetes, hypertension','HIV and AIDS in depth','Drug and substance abuse','Community health']
      }
    },
    'Social Studies': {
      // Note: 2023 ZECF integrates mining/mineral wealth into Social Studies at Upper Primary
      'Our Country Zambia': ['Provinces and districts','Physical features','Climate and vegetation','Population and ethnic groups'],
      'History of Zambia': ['Pre-colonial Zambia','Colonial period','Independence and freedom fighters','Post-independence Zambia'],
      'Government and Citizenship': ['Government structure','Rights and responsibilities','National symbols','Democracy and good governance'],
      'Mining and Mineral Wealth': ['Zambia\'s minerals','Copper mining','Other minerals','Mining and the economy'],
      'Economic Activities': ['Agriculture','Industry and trade','Tourism','Transport'],
      'Geography Skills': ['Map reading','Compass directions','Scale and distance','Globe and continents'],
      'Culture and Heritage': ['Traditional ceremonies','Cultural diversity','Heritage sites']
    },
    'Technology Studies': {
      // 2023 ZECF: compulsory; equips learners with digital literacy
      'Materials and Tools': ['Wood, metal, plastics, fabrics','Hand tools','Tool safety'],
      'Design and Construction': ['Design process','Drawing and sketching','Building simple structures','Joining methods'],
      'Energy and Power': ['Sources of energy','Renewable vs non-renewable','Simple electrical circuits'],
      'Digital Literacy': ['Computer parts','Using productivity software','Internet basics','Online safety','Digital citizenship'],
      'Crafts and Practical Projects': ['Simple crafts','Processes and techniques','Mini-projects']
    },
    'Expressive Arts': {
      // Optional choice with Home Economics — career pathway foundation
      'Visual Arts': ['Drawing techniques','Painting','Printmaking','Sculpture and modelling','Crafts and design'],
      'Music': ['Singing','Rhythm and melody','Musical instruments (traditional and modern)','Music notation basics','Composition'],
      'Dance': ['Traditional Zambian dances','Modern dance','Choreography basics'],
      'Drama and Theatre': ['Acting and role-play','Mime','Scriptwriting','Stage performance']
    },
    'Home Economics': {
      // Optional choice with Expressive Arts — career pathway foundation
      'Foods and Nutrition': ['Food groups','Balanced diet','Food preparation and cooking methods','Food hygiene and safety','Meal planning'],
      'Clothing and Textiles': ['Types of fabrics','Care of clothes','Basic sewing and mending','Laundry'],
      'Home Management': ['Cleaning and maintenance','Family resources','Budgeting'],
      'Consumer Education': ['Wise shopping','Reading labels','Customer rights']
    }
  },
  'js': {
    // ===== Junior Secondary F1-2 (per 2023 ZECF Table 7) =====
    'English Language': {
      'Listening and Speaking': ['Formal and informal speech','Debates and discussions','Presentations','Interviews'],
      'Reading Comprehension': ['Skimming and scanning','Inference','Fact and opinion','Author\'s purpose'],
      'Writing': ['Compositions: narrative, descriptive, argumentative','Letters: formal, informal, application','Reports','Summaries','Creative writing'],
      'Grammar': ['Tenses (all forms)','Active and passive voice','Direct and indirect speech','Conditional sentences','Phrases and clauses'],
      'Vocabulary': ['Affixes','Synonyms and antonyms','Idioms','Phrasal verbs','Word formation'],
      'Literature': ['Short stories','Poetry analysis','Drama','Novel study','Figures of speech']
    },
    'Mathematics': {
      'F1': {
        'Number Theory': ['Sets: definition, types, set notation','Set operations: union, intersection, complement','Venn diagrams (2 sets)','Number systems: natural, whole, integers, rational','Indices: laws of indices','Standard form (scientific notation)'],
        'Algebra': ['Algebraic expressions: terms, like terms','Simplifying expressions','Substitution','Solving linear equations in one variable','Word problems involving linear equations'],
        'Geometry': ['Types of angles','Angles on a straight line and at a point','Angles in parallel lines','Properties of triangles','Properties of quadrilaterals'],
        'Mensuration': ['Perimeter of plane shapes','Area of rectangle, triangle, parallelogram, trapezium','Volume of cube and cuboid','Surface area of cube and cuboid'],
        'Statistics': ['Collection of data','Bar charts','Pictograms','Pie charts (intro)','Mean, median, mode of ungrouped data'],
        'Coordinate Geometry (Intro)': ['Cartesian plane','Plotting points','Reading coordinates'],
        'Financial Arithmetic': ['Percentages','Profit and loss','Discount','Simple interest']
      },
      'F2': {
        'Number Theory': ['Surds: introduction and simplification','Rationalising the denominator','Sequences: arithmetic patterns','Number bases (intro)'],
        'Algebra': ['Simultaneous linear equations: substitution and elimination','Inequalities in one variable','Graphs of inequalities','Quadratic expressions: factorisation','Solving quadratic equations by factorisation'],
        'Geometry': ['Angles in polygons (interior and exterior)','Congruent triangles: tests','Similar triangles: scale factor','Pythagoras\' theorem','Constructions with ruler and compass'],
        'Trigonometry (Intro)': ['Sine, cosine, tangent ratios','Trigonometric ratios in right-angled triangles','Solving right-angled triangle problems','Angles of elevation and depression'],
        'Mensuration': ['Area of compound shapes','Area and circumference of a circle','Surface area and volume of cylinder','Surface area and volume of cone and sphere (intro)'],
        'Statistics': ['Frequency tables','Histograms','Mean, median, mode of grouped data','Range','Probability: introduction','Simple probability problems'],
        'Coordinate Geometry': ['Distance between two points','Midpoint of a line segment','Gradient of a line','Equation of a straight line'],
        'Financial Arithmetic': ['Compound interest','Hire purchase','Currency exchange and conversion','Wages, salaries, commission']
      }
    },
    'Biology': {
      'Cells and Living Things': ['Cell structure','Cell division','Classification of living organisms','Microorganisms'],
      'Human Biology': ['Digestive system','Respiratory system','Circulatory system','Reproductive system','Nervous system','Excretory system'],
      'Plants': ['Plant structure','Photosynthesis','Transport in plants','Reproduction in plants'],
      'Genetics and Inheritance (Intro)': ['Variation','Inheritance basics','DNA (overview)'],
      'Ecology': ['Ecosystems','Food chains and webs','Adaptation','Conservation'],
      'Health and Disease': ['Communicable and non-communicable diseases','HIV and AIDS','Hygiene and prevention']
    },
    'Physics': {
      'Mechanics': ['Measurement','Motion: speed, velocity, acceleration','Forces','Work, energy, power'],
      'Heat': ['Temperature and thermometers','Heat transfer','States of matter and heat'],
      'Waves': ['Wave properties','Sound','Light: reflection and refraction'],
      'Electricity and Magnetism': ['Static electricity','Current electricity','Simple circuits','Magnets and magnetic fields'],
      'Modern Physics (Intro)': ['Atomic structure','Radioactivity (intro)']
    },
    'Chemistry': {
      'Matter': ['States of matter','Particle theory','Mixtures and separation'],
      'Atomic Structure': ['Atoms, elements, compounds','Periodic table (intro)'],
      'Chemical Bonding (Intro)': ['Ionic bonding','Covalent bonding'],
      'Acids, Bases and Salts': ['Properties of acids and bases','Indicators and pH','Neutralisation','Common salts'],
      'Reactions': ['Combustion','Oxidation and reduction (intro)','Rates of reaction (intro)']
    },
    'Geography': {
      'Physical Geography': ['Earth structure','Weathering and erosion','Rivers and drainage','Climate basics'],
      'Human Geography': ['Population','Settlement','Economic activities','Transport'],
      'Zambia and Africa': ['Physical features','Climate regions','Natural resources','Economic geography'],
      'Map Skills': ['Map reading','Latitude and longitude','Scale','Sketch maps','Field studies']
    },
    'History': {
      'Pre-colonial Africa': ['Early African societies','Trans-Saharan trade','Pre-colonial Zambian societies'],
      'Slavery and Slave Trade': ['Trans-Atlantic and East African slave trades','Abolition'],
      'Colonialism': ['Scramble for Africa','Berlin Conference','Colonial rule in Zambia (BSAC, Federation)','African resistance'],
      'Independence Era': ['Nationalism','Zambian independence (1964)','Post-independence Zambia'],
      'World History (Intro)': ['World Wars','Cold War (overview)']
    },
    'Civic Education': {
      'Constitution and Governance': ['Constitution of Zambia','Branches of government','Local government'],
      'Rights and Responsibilities': ['Bill of Rights','Children\'s rights','Civic duties'],
      'National Values': ['Patriotism','Integrity','Good citizenship'],
      'Contemporary Issues': ['Corruption','Gender equality','Environment']
    },
    'Religious Education': {
      // 2023 ZECF: 2044 and 2046 syllabi merged into one Religious Education syllabus
      'Christianity': ['Old Testament','New Testament','Christian denominations','Christian ethics'],
      'African Traditional Religion': ['Beliefs and practices','Rites of passage','Sacred places','Moral teachings'],
      'Islam': ['Beliefs and pillars','Sources of teaching','Islamic ethics'],
      'Comparative Religion': ['Similarities and differences','Religious tolerance','Interfaith dialogue'],
      'Contemporary Issues': ['Religion and society','Ethics and morality','Social justice']
    },
    'Zambian Languages': {
      'Oral Skills': ['Speeches','Debates','Storytelling','Poetry recitation'],
      'Reading': ['Comprehension','Critical reading','Cultural and literary texts'],
      'Writing': ['Compositions','Letters','Reports','Creative writing'],
      'Grammar': ['Word classes','Sentence structure','Tenses','Idioms and proverbs'],
      'Literature': ['Folktales','Poetry','Drama','Novels in the language']
    },
    'Literature in English': {
      'Poetry': ['Forms of poetry','Figurative language','Critical analysis'],
      'Prose Fiction': ['Short stories','Novel study (intro)','Themes and characterisation'],
      'Drama': ['Acting and performance','Studied plays','Dramatic techniques'],
      'Oral Literature': ['Folktales','Proverbs','Riddles']
    },
    'Information and Communication Technology': {
      // 2023 ZECF: ICT replaces Computer Studies as compulsory examinable subject
      'Computer Fundamentals': ['Hardware','Software','Operating systems'],
      'Productivity Software': ['Word processing','Spreadsheets','Presentations'],
      'Internet and Communication': ['Internet basics','Email','Search and research','Online safety'],
      'Digital Citizenship': ['Cyber security basics','Ethics in ICT','Information literacy']
    },
    'Computer Science': {
      // 2023 ZECF: introduced at this level for coding/CS competences
      'Computer Systems': ['Hardware components','Software types','How computers work'],
      'Programming Basics': ['Algorithms','Flowcharts','Pseudocode','Scratch / Python intro'],
      'Data Representation': ['Binary numbers','Data types'],
      'Networks': ['LAN, WAN, Internet basics','Network safety']
    },
    'Design and Technology': {
      'Design Process': ['Identifying needs','Research','Specifications','Design solutions'],
      'Materials': ['Wood','Metals','Plastics','Fabrics'],
      'Tools and Processes': ['Hand tools','Marking out','Cutting','Joining and finishing'],
      'Technical Drawing': ['Sketching','Orthographic projection','Pictorial drawings'],
      'Mechanisms and Structures': ['Levers, gears, pulleys','Forces in structures']
    },
    'Home Management': {
      // Replaces "Home Economics" naming at secondary level per 2023 framework
      'Family and Home': ['Family resources','Home management','Budgeting and saving'],
      'Consumer Education': ['Wise shopping','Reading labels','Consumer rights'],
      'Housing and Home Care': ['Cleaning','Care of furniture and appliances','Home decoration basics'],
      'Childcare': ['Care of young children','Family health','Hygiene at home']
    },
    'Fashion and Fabrics': {
      'Fibres and Fabrics': ['Natural fibres','Synthetic fibres','Fabric construction'],
      'Pattern Making (Intro)': ['Body measurements','Simple patterns','Layout and cutting'],
      'Garment Construction': ['Hand stitching','Machine sewing','Seams and hems','Simple garments'],
      'Care of Clothing': ['Laundry','Stain removal','Storage','Simple repairs']
    },
    'Food and Nutrition': {
      'Nutrients and Diet': ['Food groups','Nutrients and their functions','Balanced diet','Special diets'],
      'Food Preparation': ['Cookery methods','Kitchen tools and equipment','Recipes','Plating and serving'],
      'Food Hygiene and Safety': ['Food handling','Storage','Foodborne illnesses','Kitchen safety'],
      'Meal Planning': ['Daily meals','Special occasions','Costing']
    },
    'Agricultural Science': {
      'Soil Science': ['Soil formation','Soil types','Soil fertility','Conservation'],
      'Crop Production': ['Maize, cassava, vegetables','Land preparation','Planting','Pest and disease control'],
      'Animal Husbandry': ['Cattle, goats, pigs, poultry','Feeding','Animal health','Animal products'],
      'Farm Tools and Mechanisation': ['Hand tools','Simple farm machinery','Maintenance'],
      'Farm Records and Economics': ['Simple farm records','Marketing of produce']
    },
    'Art and Design': {
      'Drawing and Painting': ['Observational drawing','Still life','Painting techniques'],
      'Printmaking': ['Block printing','Stencil printing'],
      'Sculpture and 3D': ['Modelling','Carving','Construction'],
      'Design Basics': ['Elements of design','Principles of design','Composition'],
      'Art and Culture': ['Zambian art and crafts','African art traditions']
    },
    'Music': {
      'Music Theory': ['Notation basics','Scales','Rhythm and time signatures'],
      'Performance': ['Vocal performance','Instrumental performance','Ensemble work'],
      'Composition (Intro)': ['Simple melodies','Songwriting basics'],
      'Zambian and African Music': ['Traditional instruments','Folk music','Modern Zambian music'],
      'Listening and Appreciation': ['Aural skills','Music genres']
    },
    'Physical Education': {
      'Athletics': ['Track events','Field events','Training methods'],
      'Major Games': ['Football','Netball','Basketball','Volleyball','Handball'],
      'Gymnastics': ['Floor work','Balance','Tumbling'],
      'Health and Fitness': ['Components of fitness','Training principles','Nutrition for athletes'],
      'Theory of Sport': ['Anatomy basics','Sports rules and officiating','Sports safety']
    },
    'Commerce': {
      'Introduction to Commerce': ['Production and trade','Commerce and aids to trade','Forms of business'],
      'Marketing': ['Marketing concepts','Advertising','Channels of distribution'],
      'Banking and Finance': ['Money','Banks and bank services','Insurance basics'],
      'Trade Documents': ['Documents in domestic trade','Documents in international trade'],
      'Consumer Protection': ['Consumer rights','Government and business']
    },
    'Principles of Accounts': {
      'Introduction to Accounting': ['Purpose of accounting','Users of accounts','Accounting equation'],
      'Source Documents': ['Invoices, receipts, vouchers','Cash and credit transactions'],
      'Books of Original Entry': ['Cash book','Sales day book','Purchases day book','Journal'],
      'Ledger and Trial Balance': ['Double-entry','Posting','Trial balance'],
      'Final Accounts (Intro)': ['Trading account','Profit and loss','Balance sheet']
    },
    'Travel and Tourism': {
      // 2023 ZECF: new career path under Home Economics and Hospitality pathway
      'Introduction to Tourism': ['Definitions','Types of tourism','Tourism in Zambia'],
      'Tourism Industry': ['Accommodation','Transport','Travel agents and tour operators','Attractions'],
      'Tourism Geography': ['Tourist sites in Zambia','Regional and world destinations','Maps and itineraries'],
      'Customer Care': ['Communication skills','Customer service','Handling complaints'],
      'Sustainable Tourism': ['Eco-tourism','Cultural tourism','Tourism impacts']
    },
    'Foreign Languages (French)': {
      'Speaking and Pronunciation': ['Greetings','Self-introduction','Pronunciation rules','Conversations'],
      'Listening Comprehension': ['Audio dialogues','Songs','Instructions'],
      'Reading': ['Short texts','Cultural readings','Comprehension'],
      'Writing': ['Personal information','Short letters','Descriptions','Compositions'],
      'Grammar': ['Articles','Verbs (present, passé composé, futur)','Pronouns','Adjectives'],
      'Vocabulary and Culture': ['Family and home','School and work','Food and travel','French-speaking countries']
    }
  },
  'ss': {
    // ===== Senior Secondary F3-4 (Ordinary Level — same 25 subjects per Table 7) =====
    'English Language': {
      'Comprehension and Summary': ['Comprehension passages','Summary writing','Précis','Inference and analysis'],
      'Composition': ['Narrative essays','Descriptive essays','Argumentative essays','Expository essays','Imaginative writing'],
      'Functional Writing': ['Formal letters','Informal letters','Reports','Speeches','Articles','CVs and applications'],
      'Grammar and Usage': ['Advanced tenses','Concord','Punctuation','Sentence variety','Style and register'],
      'Oral Communication': ['Public speaking','Debates','Interviews','Pronunciation']
    },
    'Mathematics': {
      'F3': {
        'Algebra': ['Quadratic equations: factorisation, completing the square, formula','Simultaneous equations (one linear, one quadratic)','Functions and relations','Domain and range','Polynomials: addition, subtraction, multiplication','Logarithms: laws and applications'],
        'Geometry and Trigonometry': ['Circle theorems: angles in same segment, cyclic quadrilateral','Tangent properties of circles','Trigonometric ratios in any triangle','Sine rule','Cosine rule','Area of triangle using trigonometry'],
        'Coordinate Geometry': ['Equation of a straight line in different forms','Distance and midpoint formulae','Parallel and perpendicular lines'],
        'Statistics and Probability': ['Frequency distributions','Histograms and frequency polygons','Cumulative frequency curves','Median, quartiles, percentiles from cumulative frequency','Probability: addition and multiplication rules'],
        'Mensuration': ['Arc length and area of sector','Volume and surface area of cone, sphere, pyramid'],
        'Sets, Logic and Matrices': ['Set operations with 3 sets','Venn diagrams with 3 sets','Matrices: addition, subtraction, multiplication','Determinants of 2x2 matrices'],
        'Sequences and Series': ['Arithmetic progression: nth term and sum','Geometric progression: nth term and sum']
      },
      'F4': {
        'Algebra': ['Quadratic inequalities','Variation: direct, inverse, joint, partial','Indices: fractional and negative','Surds: rationalisation','Equations involving indices and logarithms'],
        'Geometry and Trigonometry': ['Vectors: magnitude, direction, addition','Position vectors','Bearings and navigation problems','3D trigonometry: angles between lines and planes','Transformations: translation, reflection, rotation, enlargement','Combination of transformations'],
        'Coordinate Geometry': ['Loci: locus of points equidistant from a point/line','Equation of a circle','Intersection of line and curve'],
        'Calculus (Intro)': ['Differentiation: power rule, sum rule, product rule','Tangent and normal to a curve','Stationary points: maxima and minima','Applications: rates of change','Integration as anti-differentiation','Definite integrals','Area under a curve'],
        'Statistics and Probability': ['Standard deviation and variance','Probability tree diagrams','Conditional probability','Mutually exclusive vs independent events'],
        'Mensuration': ['Compound shapes in 3D','Similar shapes: ratio of areas and volumes'],
        'Sets, Logic and Matrices': ['Inverse of a 2x2 matrix','Solving simultaneous equations using matrices','Logic: statements, truth tables','Compound statements'],
        'Sequences and Series': ['Sum to infinity of geometric series','Convergent and divergent series']
      }
    },
    'Biology': {
      'Cell Biology': ['Cell structure and ultrastructure','Mitosis and meiosis','Diffusion, osmosis, active transport','Enzymes'],
      'Plant Biology': ['Photosynthesis','Transport in plants','Reproduction in plants','Plant responses'],
      'Human Biology': ['Nutrition and digestion','Circulation','Respiration','Excretion','Coordination: nervous and endocrine','Reproduction','Immunity'],
      'Genetics and Evolution': ['DNA and inheritance','Monohybrid crosses','Variation','Natural selection'],
      'Ecology': ['Ecosystems','Energy flow and nutrient cycles','Population dynamics','Human impact on environment','Conservation'],
      'Microorganisms and Disease': ['Bacteria, viruses, fungi','Communicable diseases','HIV and AIDS','Malaria, TB']
    },
    'Physics': {
      'Mechanics': ['Kinematics: equations of motion','Newton\'s laws','Work, energy, power','Momentum and impulse','Circular motion'],
      'Heat and Thermodynamics': ['Temperature and thermometry','Heat capacity','Latent heat','Gas laws','Heat transfer'],
      'Waves and Optics': ['Properties of waves','Sound waves','Reflection and refraction','Lenses and mirrors','Electromagnetic spectrum'],
      'Electricity and Magnetism': ['Current, voltage, resistance','Ohm\'s law','Series and parallel circuits','Magnetic fields','Electromagnetic induction','Transformers'],
      'Modern Physics': ['Atomic structure','Radioactivity','Half-life','Nuclear reactions']
    },
    'Chemistry': {
      'Atomic Structure': ['Atoms, ions, isotopes','Electronic configuration','Periodic table trends'],
      'Chemical Bonding': ['Ionic bonding','Covalent bonding','Metallic bonding','Intermolecular forces'],
      'Stoichiometry': ['The mole','Empirical and molecular formulae','Concentration of solutions','Volumetric analysis'],
      'Acids, Bases and Salts': ['pH and indicators','Neutralisation','Salt preparation','Titrations'],
      'Energetics and Rates': ['Exothermic and endothermic reactions','Enthalpy changes','Rates of reaction','Catalysis','Equilibrium'],
      'Redox Chemistry': ['Oxidation states','Redox reactions','Electrolysis','Electrochemical cells'],
      'Organic Chemistry': ['Hydrocarbons (alkanes, alkenes, alkynes)','Alcohols','Carboxylic acids','Esters','Polymers'],
      'Inorganic Chemistry': ['Group 1, 2, 7 elements','Transition metals (intro)','Industrial processes']
    },
    'Geography': {
      'Physical Geography': ['Earth structure and plate tectonics','Weathering and erosion','Rivers and drainage','Climatology','Soils and vegetation'],
      'Human Geography': ['Population and migration','Settlement','Agriculture','Industry','Trade and transport','Tourism'],
      'Zambian Geography': ['Physical regions','Mining','Agriculture and farming systems','Urban development'],
      'Africa and the World': ['African physical and human geography','Global economic patterns','SADC and AU','Climate change and environment'],
      'Geographical Skills': ['Map reading and interpretation','Field studies','Statistical methods','Photographs and remote sensing']
    },
    'History': {
      'Pre-colonial Africa': ['Early African societies','Trans-Saharan trade','Great Zimbabwe and other states','Pre-colonial Zambian societies'],
      'Slavery and the Slave Trade': ['Trans-Atlantic slave trade','East African slave trade','Abolition'],
      'Colonialism in Africa': ['Scramble for Africa','Berlin Conference','Colonial administration','Resistance movements'],
      'Zambian History': ['BSAC rule','Federation','Nationalism','Independence (1964)','Post-independence Zambia','Multi-party democracy'],
      'World History': ['World Wars I and II','Cold War','Decolonisation','Globalisation'],
      'Themes': ['Apartheid and South Africa','Pan-Africanism','African Union']
    },
    'Civic Education': {
      'Constitution and Governance': ['Constitution of Zambia','Three branches of government','Electoral processes','Devolution and local government'],
      'Human Rights': ['Bill of Rights','Children\'s rights','Women\'s rights','Rights of persons with disabilities'],
      'Citizenship': ['Citizenship and nationality','Civic duties and responsibilities','Patriotism and national values'],
      'Economic and Social Issues': ['Corruption and integrity','Gender and development','Poverty','HIV/AIDS','Drug abuse'],
      'International Relations': ['United Nations','African Union','SADC','Global citizenship']
    },
    'Religious Education': {
      'Biblical Studies': ['Old Testament themes','New Testament themes','Life and teachings of Jesus','Letters of Paul'],
      'Church History': ['Early Church','Reformation','Christianity in Africa','Modern Christianity'],
      'Christian Ethics': ['Personal ethics','Social justice','Bioethics','Marriage and family'],
      'African Traditional Religion': ['Beliefs and practices','Worship and rituals','Ethics in ATR'],
      'Comparative Religion': ['Islam, Hinduism, Judaism, Buddhism','Religious tolerance and dialogue']
    },
    'Zambian Languages': {
      'Oral Communication': ['Speeches','Debates','Cultural performances'],
      'Reading and Comprehension': ['Literary texts','Non-literary texts','Cultural and historical texts'],
      'Writing': ['Compositions','Letters','Reports','Creative writing','Translation'],
      'Grammar and Linguistics': ['Phonology','Morphology','Syntax','Semantics'],
      'Literature': ['Oral literature: folktales, proverbs, riddles','Modern poetry','Drama','Novels']
    },
    'Literature in English': {
      'Poetry': ['Forms of poetry','Figurative language','Critical analysis','African and world poetry'],
      'Prose Fiction': ['Novel study','Short stories','Themes and characterisation','Narrative technique'],
      'Drama': ['Studied plays (Shakespeare or African drama)','Dramatic techniques','Performance and analysis'],
      'Set Books': ['5 set books (3 by Zambian authors per 2023 ZECF)','Comparative analysis'],
      'Literary Criticism': ['Practical criticism','Comparative literature','Context and theory']
    },
    'Information and Communication Technology': {
      'Computer Systems': ['Hardware components','Software types','Operating systems','Networks and the Internet'],
      'Productivity Applications': ['Advanced word processing','Spreadsheets and formulas','Databases','Presentations','Web design (intro)'],
      'Data and Information': ['Data representation (binary, hex)','Data security','Encryption','Privacy'],
      'Digital Citizenship': ['Cyber security','Information ethics','Digital footprint'],
      'Emerging Technologies': ['Cloud computing','AI and machine learning (intro)','Internet of Things']
    },
    'Computer Science': {
      'Programming and Algorithms': ['Data structures','Algorithm design','OOP basics','Recursion'],
      'Computer Systems': ['Computer architecture','Operating systems','Networks','Databases'],
      'Theory of Computation': ['Boolean logic','Number systems','Logic gates'],
      'Software Development': ['Software development lifecycle','Testing','Documentation'],
      'Cybersecurity': ['Threats','Defences','Cryptography basics']
    },
    'Design and Technology': {
      'Design Process': ['Identifying needs','Research and brief','Specifications','Design solutions','Evaluation'],
      'Materials and Processes': ['Wood: types and joinery','Metals: types and processes','Plastics and composites','Modern materials'],
      'Mechanisms and Structures': ['Levers, gears, pulleys','Forces in structures','Stability'],
      'Electronics': ['Components','Simple circuits','Microcontrollers (intro)'],
      'Manufacturing and CAD': ['Workshop processes','Computer-aided design','3D modelling']
    },
    'Home Management': {
      'Family Studies': ['Family structure and dynamics','Parenting and childcare','Family resources'],
      'Home and Living': ['Housing','Home decoration','Care of furniture and appliances'],
      'Consumer Studies': ['Consumer rights and responsibilities','Wise spending','Saving and investment'],
      'Family Health': ['Family nutrition','Hygiene','Common ailments and first aid']
    },
    'Fashion and Fabrics': {
      'Textile Fibres and Fabrics': ['Natural and synthetic fibres','Fabric construction','Fabric finishes'],
      'Pattern Making and Construction': ['Body measurements','Pattern drafting','Layout and cutting','Garment assembly'],
      'Fashion Design': ['Fashion illustration','Design elements and principles','Trends and history of fashion'],
      'Care of Clothing': ['Laundry','Stain removal','Storage','Repair and alteration']
    },
    'Food and Nutrition': {
      'Food Science': ['Composition of foods','Nutrients and metabolism','Food chemistry','Sensory evaluation'],
      'Meal Planning and Catering': ['Menu planning','Catering for special diets','Mass catering','Costing'],
      'Food Preparation': ['Cookery methods','Bakery and confectionery','Food garnish and presentation'],
      'Food Hygiene and Safety': ['Foodborne diseases','HACCP','Kitchen safety','Food storage'],
      'Food Preservation and Processing': ['Drying, canning, freezing','Fermentation','Food packaging']
    },
    'Agricultural Science': {
      'Soil Science': ['Soil formation and types','Soil fertility','Soil conservation','Soil testing'],
      'Crop Production': ['Maize, cassava, rice, vegetables','Land preparation','Planting and weeding','Pests and diseases','Harvesting and storage'],
      'Animal Husbandry': ['Cattle, goats, pigs, poultry','Feeding and breeding','Animal health','Animal products'],
      'Farm Management': ['Farm records','Farm economics','Marketing','Agribusiness'],
      'Agricultural Engineering': ['Farm tools and machinery','Irrigation','Farm structures']
    },
    'Art and Design': {
      'Drawing and Painting': ['Observational drawing','Still life','Portraiture','Landscape','Painting techniques'],
      'Sculpture and 3D': ['Modelling','Carving','Construction'],
      'Printmaking': ['Block printing','Screen printing','Etching basics'],
      'Graphic Design': ['Typography','Layout','Logo design','Digital design'],
      'Art History and Criticism': ['African art','Contemporary Zambian artists','Art appreciation']
    },
    'Music': {
      'Music Theory': ['Notation','Scales and key signatures','Intervals and chords','Harmony'],
      'Performance': ['Vocal performance','Instrumental performance','Ensemble work'],
      'Composition': ['Melodic composition','Songwriting','Arrangement'],
      'Music History and Culture': ['Western music history','Zambian and African music','World music'],
      'Listening and Analysis': ['Aural skills','Music appreciation','Score analysis']
    },
    'Physical Education': {
      'Theory of Sport': ['Anatomy and physiology','Biomechanics','Sports psychology','Training methods'],
      'Athletics': ['Track and field events','Officiating','Coaching basics'],
      'Major Games': ['Football','Basketball','Volleyball','Netball','Rugby'],
      'Health and Wellness': ['Nutrition for sport','Sports injuries','Doping and ethics']
    },
    'Commerce': {
      'Introduction to Commerce': ['Production and trade','Commerce and aids to trade','Forms of business organisations'],
      'Marketing and Selling': ['Marketing concepts','Channels of distribution','Advertising','Consumer protection'],
      'Banking and Finance': ['Money and banking','Bank services','Stock exchange','Insurance'],
      'Business Communication': ['Business letters','Reports','Documents in trade'],
      'Trade and Business Environment': ['Domestic trade','International trade','Government and business','E-commerce']
    },
    'Principles of Accounts': {
      'Introduction to Accounting': ['Purpose and users','Accounting equation','Source documents'],
      'Books of Original Entry': ['Cash book','Sales and purchases day books','General journal'],
      'Ledgers and Trial Balance': ['Double-entry','Posting','Trial balance','Errors'],
      'Final Accounts': ['Trading account','Profit and loss account','Balance sheet','Adjustments'],
      'Specialised Accounts': ['Manufacturing accounts','Partnership accounts','Non-profit organisations','Control accounts']
    },
    'Travel and Tourism': {
      'Introduction to Tourism': ['Definitions and concepts','Types of tourism','Tourism in Zambia and Africa'],
      'Tourism Industry Components': ['Accommodation','Transport','Tour operators and travel agents','Attractions'],
      'Tourism Geography': ['World tourist destinations','Zambian tourist sites','Maps and itineraries'],
      'Customer Care and Communication': ['Communication skills','Customer service','Handling complaints'],
      'Sustainable Tourism': ['Eco-tourism','Cultural tourism','Impact of tourism']
    },
    'Foreign Languages (French)': {
      'Listening and Speaking': ['Conversations','Presentations','Telephone French','Pronunciation'],
      'Reading': ['Comprehension texts','Cultural texts','Literature (intro)'],
      'Writing': ['Letters','Compositions','Translations','Creative writing'],
      'Grammar': ['All major tenses','Subjunctive','Pronouns and adjectives in detail','Complex sentences'],
      'Francophone Culture': ['France and francophone Africa','Literature and arts','Customs and traditions']
    }
  },
  'al': {
    // ===== Advanced Level F5-6 =====
    'Advanced Mathematics': {
      'Pure Mathematics': ['Functions','Quadratic functions','Polynomials','Exponential and logarithm','Trigonometry'],
      'Calculus': ['Differentiation','Integration','Applications','Differential equations (intro)'],
      'Coordinate Geometry': ['Line and circle','Conic sections','Parametric equations'],
      'Vectors': ['Vectors in 2D and 3D','Scalar and vector products','Lines and planes'],
      'Statistics': ['Probability','Discrete and continuous distributions','Hypothesis testing','Correlation and regression']
    },
    'Further Mathematics': {
      'Complex Numbers': ['Argand diagram','De Moivre\'s theorem','Roots of unity'],
      'Matrices and Linear Algebra': ['Matrix operations','Determinants','Inverse','Eigenvalues'],
      'Mechanics': ['Kinematics','Forces and equilibrium','Work, energy, power','Momentum'],
      'Numerical Methods': ['Iterative methods','Numerical integration'],
      'Advanced Pure': ['Polar coordinates','Hyperbolic functions','Series']
    },
    'Biology': {
      'Biochemistry and Cell Biology': ['Biological molecules','Cell ultrastructure','Cell membranes','Enzymes in depth'],
      'Genetics': ['Mendelian inheritance','Molecular genetics','Gene technology','Population genetics'],
      'Physiology': ['Mammalian transport','Gas exchange','Excretion','Coordination','Homeostasis'],
      'Ecology and Evolution': ['Ecosystems','Biodiversity','Evolution by natural selection','Speciation'],
      'Plants in Detail': ['Photosynthesis biochemistry','Plant transport','Plant responses']
    },
    'Chemistry': {
      'Physical Chemistry': ['Atomic structure (advanced)','Chemical thermodynamics','Kinetics','Equilibria','Electrochemistry'],
      'Inorganic Chemistry': ['Periodicity','s-block elements','p-block elements','Transition metals'],
      'Organic Chemistry': ['Hydrocarbons','Halogenoalkanes','Alcohols, aldehydes, ketones','Carboxylic acids and derivatives','Aromatic chemistry','Polymers','Reaction mechanisms'],
      'Analytical Chemistry': ['Spectroscopy (NMR, IR, Mass)','Chromatography','Volumetric analysis']
    },
    'Physics': {
      'Mechanics': ['Kinematics and dynamics','Circular motion','Gravitation','Simple harmonic motion'],
      'Waves and Quantum': ['Wave properties','Standing waves','Diffraction','Photoelectric effect','Wave-particle duality'],
      'Thermodynamics': ['Kinetic theory','Laws of thermodynamics','Heat engines'],
      'Electricity and Magnetism': ['DC circuits','Capacitance','Magnetic fields','Electromagnetic induction','Alternating current'],
      'Modern Physics': ['Atomic and nuclear physics','Radioactivity in depth','Particle physics (intro)','Cosmology (intro)']
    },
    'Geography': {
      'Physical Geography': ['Geomorphology','Climatology','Biogeography','Hydrology'],
      'Human Geography': ['Population studies','Urban geography','Economic geography','Political geography'],
      'Regional Geography': ['Zambia in detail','Africa','Selected world regions'],
      'Skills and Techniques': ['GIS and remote sensing','Statistical methods','Field research','Map analysis']
    },
    'History': {
      'Zambian History': ['Pre-colonial in depth','Colonialism and resistance','Nationalism and independence','Post-independence'],
      'African History': ['West, East, Southern Africa','Decolonisation','Apartheid and liberation'],
      'World History': ['World Wars','Cold War','International relations','Modern global history'],
      'Historiography': ['Sources and methods','Schools of historical thought']
    },
    'Literature in English': {
      'Poetry': ['Major poets','Critical analysis','Comparative study','Literary theory'],
      'Prose Fiction': ['Major novels (African, British, world)','Narrative theory','Themes and contexts'],
      'Drama': ['Shakespeare','Modern drama','African theatre'],
      'Literary Theory and Criticism': ['Critical approaches','Postcolonial theory','Feminist criticism']
    },
    'Economics': {
      'Microeconomics': ['Demand and supply','Market structures','Market failure','Labour markets'],
      'Macroeconomics': ['National income','Inflation and unemployment','Fiscal and monetary policy','Economic growth'],
      'International Economics': ['International trade','Exchange rates','Balance of payments','Globalisation'],
      'Development Economics': ['Economic development indicators','Poverty and inequality','Zambian economy']
    },
    'Computer Science': {
      'Programming and Algorithms': ['Data structures','Algorithm design and complexity','OOP','Recursion'],
      'Computer Systems': ['Computer architecture','Operating systems','Networks','Databases'],
      'Theory of Computation': ['Boolean logic','Automata','Computability'],
      'Software Engineering': ['Software development lifecycle','Testing','Project management'],
      'Emerging Topics': ['AI and machine learning','Cybersecurity','Cloud and distributed systems']
    }
  }
};
